/*
 * progress-core.js — the download-progress engine, transport-agnostic and
 * DOM-free. It knows nothing about sockets, HTTP, the filesystem, terminals,
 * timers or the DOM. It does exactly one thing: take a stream of updates from
 * several *concurrent* download workers and turn them into one honest picture —
 * an overall fraction, a smoothed transfer rate, an ETA, and a text bar.
 *
 * This is the Threading category, so the whole point is what happens when many
 * workers touch the same progress at once. The naive version has every worker
 * do `shared.done += chunk.length` — a read-modify-write on shared state. Two
 * chunks that land "at the same time" both read the old value and one write is
 * lost, so the bar silently under-counts and never reaches 100% even though the
 * bytes all arrived. People "fix" it with a lock around the `+=`, which works
 * but serialises every worker on the hot path and still corrupts the moment one
 * update is dropped, retried or delivered twice.
 *
 * The design here removes the race instead of guarding it:
 *
 *   Each worker reports its OWN cumulative bytes-so-far — an absolute,
 *   monotonic position, never a delta. The aggregator stores the latest
 *   position PER WORKER and the total is the sum of those positions.
 *
 * An absolute update is idempotent and order-independent: replay it, drop it,
 * deliver it twice or out of order, and the sum is still correct as soon as the
 * next real update lands, because it carries the true position, not an
 * increment relative to a number the aggregator might have missed. There is no
 * read-modify-write to lose — a worker never reads the shared total at all, it
 * only writes down where *it* has got to. That is the one idea this project is
 * built to teach.
 *
 * Everything works the same whether the updates come from a simulated download
 * in a browser (script.js) or N real concurrent HTTPS range-requests under Node
 * (progress-node.js).
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Small helpers — a non-negative finite integer gate, and a clamp. A bad
 * sample should fail loudly here, not silently poison the aggregate.
 * ------------------------------------------------------------------ */

function reqUint(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      Math.floor(value) !== value) {
    throw new TypeError(`${name} must be a non-negative integer, got ${value}`);
  }
  return value;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/* ------------------------------------------------------------------ *
 * EwmaRate — exponentially-weighted moving average of the transfer rate.
 *
 * A download's instantaneous rate (bytes since last tick / seconds since last
 * tick) is wildly jittery: TCP delivers in bursts, the OS buffers, and a bar
 * whose ETA jumps between "2s" and "4 min" every refresh is useless. An EWMA
 * smooths it with one tunable: `halfLife`, the time over which an old sample's
 * weight decays by half. Unlike a fixed-N moving average it needs no history
 * buffer and adapts correctly to irregular sample spacing (which is exactly
 * what you get from real I/O).
 * ------------------------------------------------------------------ */

class EwmaRate {
  constructor(halfLifeSec = 3) {
    if (!(halfLifeSec > 0)) throw new RangeError('halfLifeSec must be > 0');
    this.halfLife = halfLifeSec;
    this.rate = null;       // bytes/sec, or null until the first interval
    this._lastBytes = null;
    this._lastT = null;
  }

  /** Feed a cumulative byte count observed at time t (seconds). */
  sample(cumulativeBytes, t) {
    reqUint(cumulativeBytes, 'cumulativeBytes');
    if (this._lastT === null) {
      this._lastBytes = cumulativeBytes;
      this._lastT = t;
      return this.rate;
    }
    const dt = t - this._lastT;
    if (dt <= 0) return this.rate;               // ignore zero/negative intervals
    const dBytes = cumulativeBytes - this._lastBytes;
    const inst = Math.max(0, dBytes) / dt;       // clamp to non-negative
    // weight of the PREVIOUS estimate after dt seconds: 0.5 ^ (dt / halfLife)
    const w = Math.pow(0.5, dt / this.halfLife);
    this.rate = this.rate === null ? inst : w * this.rate + (1 - w) * inst;
    this._lastBytes = cumulativeBytes;
    this._lastT = t;
    return this.rate;
  }
}

/* ------------------------------------------------------------------ *
 * ProgressAggregator — the one owner of the shared progress.
 *
 * Workers never touch each other's state and never read the global total; each
 * only reports its own absolute position through report(). The aggregator is
 * the single place the per-worker positions are summed, so there is exactly one
 * writer of the aggregate and the "race" simply does not exist.
 * ------------------------------------------------------------------ */

class ProgressAggregator {
  /**
   * @param {object} opts
   * @param {number} [opts.halfLifeSec=3] smoothing half-life for the rate
   * @param {() => number} [opts.now] clock returning seconds (injectable for tests)
   */
  constructor(opts = {}) {
    this._now = opts.now || (() => Date.now() / 1000);
    this._rate = new EwmaRate(opts.halfLifeSec == null ? 3 : opts.halfLifeSec);
    this._workers = new Map();   // id -> { total, done }
    this._startedAt = null;
    this._finishedAt = null;
  }

  /**
   * Register a worker (a part/segment/file being downloaded) and its total
   * size in bytes. `total` may be 0 for an empty part, or null if the size is
   * not known up front (a chunked response); an unknown total makes the overall
   * fraction unknown until it is learned via setTotal().
   */
  addWorker(id, total) {
    if (this._workers.has(id)) throw new Error(`worker ${id} already registered`);
    if (total != null) reqUint(total, 'total');
    this._workers.set(id, { total: total == null ? null : total, done: 0 });
    if (this._startedAt === null) this._startedAt = this._now();
    return this;
  }

  /** Learn (or correct) a worker's total size after the fact. */
  setTotal(id, total) {
    const w = this._req(id);
    reqUint(total, 'total');
    if (total < w.done) {
      throw new RangeError(`total ${total} is below already-reported ${w.done}`);
    }
    w.total = total;
    return this;
  }

  /**
   * The hot path. A worker reports its OWN cumulative bytes so far — an
   * absolute position, not a delta. Idempotent and order-independent: calling
   * report(id, 100) then report(id, 100) again is a no-op, and a stale value
   * that arrives late is ignored because position only ever moves forward.
   */
  report(id, cumulativeBytes) {
    const w = this._req(id);
    reqUint(cumulativeBytes, 'cumulativeBytes');
    // monotonic guard: never let a worker's position go backwards. A late or
    // duplicated packet carrying an older position is simply dropped.
    if (cumulativeBytes <= w.done) return this;
    if (w.total != null && cumulativeBytes > w.total) {
      // a worker cannot exceed its declared size; treat the total as the cap
      cumulativeBytes = w.total;
    }
    w.done = cumulativeBytes;
    const snap = this._sum();
    this._rate.sample(snap.done, this._now());
    if (snap.total != null && snap.done >= snap.total && this._finishedAt === null) {
      this._finishedAt = this._now();
    }
    return this;
  }

  _req(id) {
    const w = this._workers.get(id);
    if (!w) throw new Error(`unknown worker ${id}`);
    return w;
  }

  _sum() {
    let done = 0, total = 0, totalKnown = true;
    for (const w of this._workers.values()) {
      done += w.done;
      if (w.total == null) totalKnown = false;
      else total += w.total;
    }
    return { done, total: totalKnown ? total : null };
  }

  /**
   * A full immutable snapshot of the current state — the only thing a renderer
   * needs. `fraction` is null when any worker's size is still unknown.
   */
  snapshot() {
    const { done, total } = this._sum();
    const rate = this._rate.rate;
    const fraction = total == null ? null : (total === 0 ? 1 : clamp(done / total, 0, 1));
    const remaining = total == null ? null : Math.max(0, total - done);
    let etaSec = null;
    if (remaining != null) {
      if (remaining === 0) etaSec = 0;
      else if (rate && rate > 0) etaSec = remaining / rate;
    }
    const now = this._finishedAt != null ? this._finishedAt : this._now();
    const elapsedSec = this._startedAt == null ? 0 : Math.max(0, now - this._startedAt);
    return {
      done, total, fraction,
      bytesPerSec: rate,
      etaSec,
      elapsedSec,
      done_: done, // kept for symmetry; renderers use `done`
      workers: this._workers.size,
      finished: this._finishedAt != null,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Human formatting — IEC byte sizes, rates, and clock-style durations.
 * ------------------------------------------------------------------ */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

function formatBytes(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  reqUint(Math.floor(Math.max(0, n)), 'n');
  let u = 0, v = n;
  while (v >= 1024 && u < UNITS.length - 1) { v /= 1024; u++; }
  const d = u === 0 ? 0 : digits;
  return `${v.toFixed(d)} ${UNITS[u]}`;
}

function formatRate(bytesPerSec) {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec)) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * renderBar — a pure string renderer for a snapshot. Width is the number of
 * cells in the bar itself. An unknown fraction renders an indeterminate
 * "marquee" using the elapsed time so the caller still sees life.
 * ------------------------------------------------------------------ */

function renderBar(snap, opts = {}) {
  const width = opts.width || 30;
  const fill = opts.fill || '█';
  const empty = opts.empty || '░';
  let bar, pctText;

  if (snap.fraction == null) {
    // indeterminate: a single block bouncing across the track
    const pos = Math.floor((snap.elapsedSec * 4) % (width * 2 - 2));
    const i = pos < width ? pos : (width * 2 - 2 - pos);
    bar = empty.repeat(i) + fill + empty.repeat(Math.max(0, width - i - 1));
    pctText = '  ?%';
  } else {
    const cells = Math.round(snap.fraction * width);
    bar = fill.repeat(cells) + empty.repeat(width - cells);
    pctText = `${String(Math.floor(snap.fraction * 100)).padStart(3, ' ')}%`;
  }

  const size = snap.total == null
    ? formatBytes(snap.done)
    : `${formatBytes(snap.done)}/${formatBytes(snap.total)}`;
  const rate = formatRate(snap.bytesPerSec);
  const eta = snap.finished ? 'done' : `ETA ${formatDuration(snap.etaSec)}`;
  return `[${bar}] ${pctText}  ${size}  ${rate}  ${eta}`;
}

/* ------------------------------------------------------------------ *
 * Module export — works under Node (require) and the browser (global).
 * ------------------------------------------------------------------ */

const coreApi = {
  EwmaRate,
  ProgressAggregator,
  formatBytes,
  formatRate,
  formatDuration,
  renderBar,
  // internal, exposed for the tests
  _reqUint: reqUint,
  _clamp: clamp,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.ProgressCore = coreApi;
