/*
 * tests.js — dependency-free checks for the bandwidth monitor, run under Node:
 *   node projects/phase2-networking/bandwidth-monitor/tests.js
 *
 * Four layers:
 *   1. Pure rate math — the baseline, steady rates, and the hard parts:
 *      32-bit wrap, interface reset, and telling the two apart.
 *   2. Ledger & buffers — per-day rollup across day boundaries, retention/
 *      eviction, ring-buffer wraparound, formatting (bits vs bytes).
 *   3. /proc/net/dev parsing — against a fixed fixture.
 *   4. Real interface read — the live kernel counters, when this host is Linux
 *      (skipped, not faked, otherwise).
 */
'use strict';

const assert = require('assert');
const {
  toBig, MOD32, MOD64,
  RateSampler, RingBuffer, DailyLedger, BandwidthMonitor,
  formatBytes, formatRate, parseProcNetDev,
} = require('./bandwidth-core.js');
const nodeAdapter = require('./bandwidth-node.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push([name, e]); }
}
function approx(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ~${b}, got ${a}`);
}

/* ---------------------------------------------------------------- *
 * 1. Pure rate math
 * ---------------------------------------------------------------- */

check('first sample is a baseline (null), no rate yet', () => {
  const s = new RateSampler();
  assert.strictEqual(s.update(1000, 0), null);
});

check('steady rate: 1,000,000 bytes over 1s = 1 MB/s', () => {
  const s = new RateSampler();
  s.update(0, 0);
  const r = s.update(1000, 1_000_000);
  assert.strictEqual(r.bytes, 1_000_000);
  approx(r.rate, 1_000_000, 1e-6, 'rate');
  assert.strictEqual(r.wrapped, false);
  assert.strictEqual(r.reset, false);
});

check('rate honours the real elapsed time, not a fixed tick', () => {
  const s = new RateSampler();
  s.update(0, 0);
  const r = s.update(500, 1000); // 1000 bytes in 0.5s = 2000 B/s
  approx(r.rate, 2000, 1e-6, 'rate');
  assert.strictEqual(r.dtSeconds, 0.5);
});

check('dt <= 0 re-baselines and returns null (no divide-by-zero rate)', () => {
  const s = new RateSampler();
  s.update(1000, 0);
  assert.strictEqual(s.update(1000, 5000), null); // same timestamp
  // next real interval is measured from the re-baselined point
  const r = s.update(2000, 6000);
  assert.strictEqual(r.bytes, 1000);
});

check('32-bit WRAP is handled: tiny forward delta across 2^32', () => {
  const s = new RateSampler({ modulus: MOD32 });
  const near = Number(MOD32) - 100;     // 100 bytes short of rollover
  s.update(0, near);
  const r = s.update(1000, 50);         // wrapped: 100 + 50 = 150 bytes
  assert.strictEqual(r.wrapped, true);
  assert.strictEqual(r.reset, false);
  assert.strictEqual(r.bytes, 150);
  approx(r.rate, 150, 1e-6, 'wrapped rate');
});

check('RESET is handled: decrease too large to be a wrap', () => {
  // A 64-bit-ish counter with no modulus: any decrease is a reset.
  const s = new RateSampler({ modulus: null });
  s.update(0, 5_000_000_000);
  const r = s.update(1000, 2000);       // counter restarted from 0, now at 2000
  assert.strictEqual(r.reset, true);
  assert.strictEqual(r.wrapped, false);
  assert.strictEqual(r.bytes, 2000);    // best-effort bytes since reset
  assert.strictEqual(r.rate, null);     // rate is unknowable across a reset
});

check('wrap vs reset: an implausibly fast "wrap" is treated as a reset', () => {
  // 32-bit modulus, but the wrapped delta would imply > 10 Gbps → reset.
  const s = new RateSampler({ modulus: MOD32, maxRateBytesPerSec: 1.25e9 });
  s.update(0, 10);
  // cur=5 => wrappedDelta = 5 + (2^32 - 10) ≈ 4.29e9 bytes in 1s ≈ 34 Gbps.
  const r = s.update(1000, 5);
  assert.strictEqual(r.wrapped, false);
  assert.strictEqual(r.reset, true);
});

check('64-bit counters stay exact via BigInt (no double rounding)', () => {
  const s = new RateSampler({ modulus: MOD64 });
  const base = (1n << 60n);             // far beyond 2^53
  s.update(0, base);
  const r = s.update(1000, base + 123_456_789n);
  assert.strictEqual(r.bytes, 123_456_789);
});

check('reset() clears the baseline', () => {
  const s = new RateSampler();
  s.update(0, 1000);
  s.reset();
  assert.strictEqual(s.update(1000, 9999), null); // fresh baseline, no rate
});

check('toBig rejects negatives, floats and junk', () => {
  assert.throws(() => toBig(-1));
  assert.throws(() => toBig(1.5));
  assert.throws(() => toBig('abc'));
  assert.strictEqual(toBig('42'), 42n);
  assert.strictEqual(toBig(42), 42n);
});

/* ---------------------------------------------------------------- *
 * 2. Ledger, ring buffer, formatting
 * ---------------------------------------------------------------- */

check('DailyLedger buckets bytes by day key', () => {
  // Deterministic day key: one "day" per 1000ms bucket.
  const dayKey = (ts) => `d${Math.floor(ts / 1000)}`;
  const l = new DailyLedger({ dayKey });
  l.record(100, { rxBytes: 10, txBytes: 1, rxRate: 5 });
  l.record(500, { rxBytes: 20, txBytes: 2, rxRate: 9 });  // same day d0
  l.record(1500, { rxBytes: 30, txBytes: 3, rxRate: 4 }); // day d1
  const days = l.days();
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].key, 'd0');
  assert.strictEqual(days[0].rxBytes, 30);
  assert.strictEqual(days[0].txBytes, 3);
  assert.strictEqual(days[0].rxPeak, 9);   // peak of 5 and 9
  assert.strictEqual(days[1].rxBytes, 30);
});

check('DailyLedger evicts beyond retainDays, oldest first', () => {
  const dayKey = (ts) => `d${ts}`;
  const l = new DailyLedger({ retainDays: 3, dayKey });
  for (let i = 0; i < 5; i++) l.record(i, { rxBytes: i });
  const days = l.days();
  assert.strictEqual(days.length, 3);
  assert.deepStrictEqual(days.map((d) => d.key), ['d2', 'd3', 'd4']);
});

check('DailyLedger totals sum across retained days', () => {
  const dayKey = (ts) => `d${ts}`;
  const l = new DailyLedger({ dayKey });
  l.record(0, { rxBytes: 100, txBytes: 10 });
  l.record(1, { rxBytes: 200, txBytes: 20 });
  const t = l.totals();
  assert.strictEqual(t.rxBytes, 300);
  assert.strictEqual(t.txBytes, 30);
  assert.strictEqual(t.totalBytes, 330);
  assert.strictEqual(t.days, 2);
});

check('RingBuffer keeps the last N in order through wraparound', () => {
  const r = new RingBuffer(3);
  [1, 2, 3, 4, 5].forEach((v) => r.push(v));
  assert.deepStrictEqual(r.toArray(), [3, 4, 5]);
  assert.strictEqual(r.length, 3);
});

check('RingBuffer below capacity returns what it has', () => {
  const r = new RingBuffer(5);
  r.push(1).push(2);
  assert.deepStrictEqual(r.toArray(), [1, 2]);
});

check('ringAverage ignores null (unknown-rate) samples', () => {
  approx(BandwidthMonitor.ringAverage([10, null, 20, null]), 15, 1e-9);
  assert.strictEqual(BandwidthMonitor.ringAverage([null, null]), 0);
});

check('formatBytes uses IEC units', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(1023), '1023 B');
  assert.strictEqual(formatBytes(1024), '1.00 KiB');
  assert.strictEqual(formatBytes(1024 * 1024), '1.00 MiB');
  assert.strictEqual(formatBytes(-1), '—');
});

check('formatRate keeps bits (SI) and bytes (IEC) honestly separate', () => {
  // 1,000,000 B/s = 8 Mbit/s (bits, 1000-based)...
  assert.strictEqual(formatRate(1_000_000, { bits: true }), '8.00 Mbit/s');
  // ...and the same number in bytes/s is ~0.95 MiB/s (1024-based)
  assert.strictEqual(formatRate(1_000_000, { bits: false }), '976.56 KiB/s');
  assert.strictEqual(formatRate(null), '—');
  assert.strictEqual(formatRate(100, { bits: true }), '800 bit/s');
  assert.strictEqual(formatRate(125, { bits: true }), '1.00 kbit/s'); // 1000 bit/s rolls up
});

check('BandwidthMonitor end-to-end: rates, daily rollup, reset flag', () => {
  const dayKey = (ts) => `d${Math.floor(ts / 10000)}`;
  const m = new BandwidthMonitor({ modulus: null, dayKey, ringSize: 4 });
  assert.strictEqual(m.sample(0, { rx: 0, tx: 0 }), null); // baseline
  const a = m.sample(1000, { rx: 1000, tx: 100 });
  approx(a.rxRate, 1000, 1e-6, 'rx'); approx(a.txRate, 100, 1e-6, 'tx');
  const b = m.sample(2000, { rx: 3000, tx: 300 });
  assert.strictEqual(b.rxBytes, 2000);
  // a reset on the rx counter
  const c = m.sample(3000, { rx: 500, tx: 500 });
  assert.strictEqual(c.reset, true);
  const days = m.ledger.days();
  assert.strictEqual(days.length, 1);           // all within d0
  assert.strictEqual(days[0].rxBytes, 1000 + 2000 + 500);
  assert.strictEqual(m.sampleCount, 3);
});

/* ---------------------------------------------------------------- *
 * 3. /proc/net/dev parsing (fixture)
 * ---------------------------------------------------------------- */

const PROC_FIXTURE = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  123456     789    0    0    0     0          0         0   123456     789    0    0    0     0       0          0
  eth0: 9876543210 1234567 0    0    0     0          0        12  5555555555  654321 0    0    0     0       0          0
`;

check('parseProcNetDev pulls rx/tx bytes for each interface', () => {
  const ifaces = parseProcNetDev(PROC_FIXTURE);
  assert.ok(ifaces.lo && ifaces.eth0, 'both interfaces present');
  assert.strictEqual(ifaces.eth0.rxBytes, 9876543210n);
  assert.strictEqual(ifaces.eth0.txBytes, 5555555555n);
  assert.strictEqual(ifaces.eth0.rxPackets, 1234567n);
  assert.strictEqual(ifaces.lo.rxBytes, 123456n);
});

check('parseProcNetDev skips header lines and blanks', () => {
  const ifaces = parseProcNetDev(PROC_FIXTURE);
  assert.deepStrictEqual(Object.keys(ifaces).sort(), ['eth0', 'lo']);
});

check('pickInterface prefers an active non-loopback interface', () => {
  const ifaces = parseProcNetDev(PROC_FIXTURE);
  assert.strictEqual(nodeAdapter.pickInterface(ifaces), 'eth0');
});

check('sampler drives real 64-bit /proc counters without rounding', () => {
  // Two synthetic /proc reads 1s apart: eth0 rx advances by exactly 1,500,000.
  const t0 = parseProcNetDev(PROC_FIXTURE).eth0;
  const s = new RateSampler({ modulus: null });
  s.update(0, t0.rxBytes);
  const r = s.update(1000, t0.rxBytes + 1_500_000n);
  assert.strictEqual(r.bytes, 1_500_000);
  approx(r.rate, 1_500_000, 1e-6, 'real-counter rate');
});

/* ---------------------------------------------------------------- *
 * 4. Real interface read (Linux only; skipped, not faked, elsewhere)
 * ---------------------------------------------------------------- */

if (nodeAdapter.hasProcNetDev()) {
  check('LIVE: reads this host\'s real interface counters', () => {
    const ifaces = nodeAdapter.readInterfaces();
    assert.ok(Object.keys(ifaces).length > 0, 'at least one interface');
    const name = nodeAdapter.pickInterface(ifaces);
    assert.ok(typeof ifaces[name].rxBytes === 'bigint', 'rxBytes is a BigInt');
  });
} else {
  console.log('  (skipped LIVE /proc/net/dev read — not a Linux host)');
}

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
