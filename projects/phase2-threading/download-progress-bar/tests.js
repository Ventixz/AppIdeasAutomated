/*
 * tests.js — dependency-free checks for the download progress engine, run under
 * Node:
 *   node projects/phase2-threading/download-progress-bar/tests.js
 *
 * The centre of gravity is the concurrency property: because each worker
 * reports its own ABSOLUTE position (not a delta), updates are idempotent,
 * order-independent and self-healing. The tests below actively try to break
 * that by replaying, reordering, dropping and duplicating updates the way real
 * concurrent I/O would, and assert the aggregate is still exactly right.
 *
 * Layers:
 *   1. The race that isn't — absolute reporting under adversarial delivery.
 *   2. Aggregator bookkeeping — multi-worker sums, unknown totals, monotonicity.
 *   3. Rate / ETA math — EWMA smoothing, snapshot fraction and ETA.
 *   4. Formatting & bar rendering — pure string output.
 */
'use strict';

const assert = require('assert');
const {
  EwmaRate, ProgressAggregator,
  formatBytes, formatRate, formatDuration, renderBar,
} = require('./progress-core.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push([name, e]); }
}
function approx(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ~${b}, got ${a}`);
}
// a controllable clock so time-dependent code is deterministic
function fakeClock(start = 0) {
  let t = start;
  const now = () => t;
  now.advance = (dt) => { t += dt; return t; };
  now.set = (v) => { t = v; };
  return now;
}

/* ---------------------------------------------------------------- *
 * 1. The race that isn't
 * ---------------------------------------------------------------- */

check('absolute reporting: replaying the same update is a no-op', () => {
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', 1000);
  agg.report('a', 400);
  agg.report('a', 400);           // duplicate delivery
  agg.report('a', 400);           // and again
  assert.strictEqual(agg.snapshot().done, 400);
});

check('absolute reporting: out-of-order (stale) updates are dropped', () => {
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', 1000);
  agg.report('a', 700);
  agg.report('a', 300);           // a late packet carrying an OLD position
  assert.strictEqual(agg.snapshot().done, 700, 'position must not go backwards');
});

check('self-healing: a dropped update does not permanently lose bytes', () => {
  // delta-based counting would under-count forever if an update is lost.
  // absolute counting corrects itself on the very next real update.
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', 1000);
  agg.report('a', 100);
  /* the update for 500 is "lost" — never delivered */
  agg.report('a', 900);           // next real position arrives
  assert.strictEqual(agg.snapshot().done, 900);
});

check('two workers interleaved in any order reach the exact total', () => {
  // simulate chunks from two concurrent streams landing in a scrambled order.
  const positionsA = [0, 128, 256, 400, 512];   // worker a cumulative
  const positionsB = [0, 64, 300, 460, 500];    // worker b cumulative
  const events = [];
  for (let i = 1; i < positionsA.length; i++) events.push(['a', positionsA[i]]);
  for (let i = 1; i < positionsB.length; i++) events.push(['b', positionsB[i]]);
  // deterministic shuffle
  for (let i = events.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [events[i], events[j]] = [events[j], events[i]];
  }
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', 512);
  agg.addWorker('b', 500);
  for (const [id, pos] of events) agg.report(id, pos);
  const snap = agg.snapshot();
  assert.strictEqual(snap.done, 1012);
  assert.strictEqual(snap.total, 1012);
  assert.strictEqual(snap.fraction, 1);
  assert.strictEqual(snap.finished, true);
});

check('a worker cannot exceed its declared size (clamped to total)', () => {
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', 100);
  agg.report('a', 150);           // server sent more than advertised
  assert.strictEqual(agg.snapshot().done, 100);
});

/* ---------------------------------------------------------------- *
 * 2. Aggregator bookkeeping
 * ---------------------------------------------------------------- */

check('duplicate worker id is rejected', () => {
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', 10);
  assert.throws(() => agg.addWorker('a', 20), /already registered/);
});

check('reporting to an unknown worker throws', () => {
  const agg = new ProgressAggregator({ now: fakeClock() });
  assert.throws(() => agg.report('ghost', 5), /unknown worker/);
});

check('negative / non-integer byte counts are rejected', () => {
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', 100);
  assert.throws(() => agg.report('a', -1), /non-negative integer/);
  assert.throws(() => agg.report('a', 1.5), /non-negative integer/);
});

check('unknown total → fraction and ETA are null until learned', () => {
  const clock = fakeClock();
  const agg = new ProgressAggregator({ now: clock });
  agg.addWorker('a', null);       // chunked response, size unknown
  clock.advance(1);
  agg.report('a', 5000);
  let snap = agg.snapshot();
  assert.strictEqual(snap.total, null);
  assert.strictEqual(snap.fraction, null);
  assert.strictEqual(snap.etaSec, null);
  agg.setTotal('a', 10000);       // size discovered mid-flight
  snap = agg.snapshot();
  assert.strictEqual(snap.total, 10000);
  approx(snap.fraction, 0.5, 1e-9, 'fraction');
});

check('setTotal below already-reported bytes is rejected', () => {
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', null);
  agg.report('a', 500);
  assert.throws(() => agg.setTotal('a', 400), /below already-reported/);
});

check('zero-byte download is immediately complete', () => {
  const agg = new ProgressAggregator({ now: fakeClock() });
  agg.addWorker('a', 0);
  const snap = agg.snapshot();
  assert.strictEqual(snap.fraction, 1);
  assert.strictEqual(snap.etaSec, 0);
});

/* ---------------------------------------------------------------- *
 * 3. Rate / ETA math
 * ---------------------------------------------------------------- */

check('EWMA: steady rate converges to that rate', () => {
  const r = new EwmaRate(2);
  let bytes = 0, t = 0;
  r.sample(bytes, t);                      // baseline
  for (let i = 0; i < 100; i++) { bytes += 1000; t += 1; r.sample(bytes, t); }
  approx(r.rate, 1000, 1, 'steady 1000 B/s');
});

check('EWMA: first sample yields no rate (null)', () => {
  const r = new EwmaRate(3);
  assert.strictEqual(r.sample(0, 0), null);
});

check('EWMA: zero/negative dt is ignored', () => {
  const r = new EwmaRate(3);
  r.sample(0, 5);
  r.sample(1000, 5);          // same timestamp → ignored
  assert.strictEqual(r.rate, null);
});

check('snapshot ETA = remaining / smoothed rate', () => {
  const clock = fakeClock();
  const agg = new ProgressAggregator({ halfLifeSec: 100, now: clock });
  agg.addWorker('a', 10000);
  clock.set(1); agg.report('a', 1000);
  clock.set(2); agg.report('a', 2000);     // ~1000 B/s, 8000 left → ~8s
  const snap = agg.snapshot();
  assert.ok(snap.bytesPerSec > 0, 'has a rate');
  assert.ok(snap.etaSec > 4 && snap.etaSec < 16, `ETA plausible, got ${snap.etaSec}`);
});

check('elapsed stops advancing once finished', () => {
  const clock = fakeClock();
  const agg = new ProgressAggregator({ now: clock });
  agg.addWorker('a', 100);
  clock.set(0); agg.addWorker('b', 0);     // ensure start recorded at 0
  clock.set(5); agg.report('a', 100);      // finishes at t=5
  const e1 = agg.snapshot().elapsedSec;
  clock.set(50);
  const e2 = agg.snapshot().elapsedSec;
  assert.strictEqual(e1, e2, 'elapsed frozen at finish time');
  approx(e2, 5, 1e-9, 'elapsed');
});

/* ---------------------------------------------------------------- *
 * 4. Formatting & bar rendering
 * ---------------------------------------------------------------- */

check('formatBytes uses IEC units', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(1023), '1023 B');
  assert.strictEqual(formatBytes(1024), '1.0 KiB');
  assert.strictEqual(formatBytes(1536), '1.5 KiB');
  assert.strictEqual(formatBytes(1048576), '1.0 MiB');
});

check('formatRate / formatDuration', () => {
  assert.strictEqual(formatRate(2048), '2.0 KiB/s');
  assert.strictEqual(formatRate(null), '—');
  assert.strictEqual(formatDuration(0), '0:00');
  assert.strictEqual(formatDuration(65), '1:05');
  assert.strictEqual(formatDuration(3661), '1:01:01');
});

check('renderBar: determinate bar shows the right fill and %', () => {
  const clock = fakeClock();
  const agg = new ProgressAggregator({ now: clock });
  agg.addWorker('a', 100);
  clock.set(1); agg.report('a', 50);
  const line = renderBar(agg.snapshot(), { width: 10 });
  assert.ok(line.includes('█████░░░░░'), `half-full bar, got: ${line}`);
  assert.ok(line.includes(' 50%'), `shows 50%, got: ${line}`);
});

check('renderBar: unknown total renders an indeterminate bar with ?%', () => {
  const clock = fakeClock();
  const agg = new ProgressAggregator({ now: clock });
  agg.addWorker('a', null);
  clock.set(1); agg.report('a', 1234);
  const line = renderBar(agg.snapshot(), { width: 10 });
  assert.ok(line.includes('?%'), `shows ?%, got: ${line}`);
});

check('renderBar: finished snapshot says "done"', () => {
  const clock = fakeClock();
  const agg = new ProgressAggregator({ now: clock });
  agg.addWorker('a', 100);
  clock.set(1); agg.report('a', 100);
  const line = renderBar(agg.snapshot(), { width: 10 });
  assert.ok(line.includes('done'), `says done, got: ${line}`);
  assert.ok(line.includes('100%'), `100%, got: ${line}`);
});

/* ---------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const [name, err] of failures) {
    console.error(`  ✗ ${name}\n    ${err && err.message ? err.message : err}`);
  }
  process.exit(1);
} else {
  console.log(`\n✓ all ${passed} checks passing\n`);
}
