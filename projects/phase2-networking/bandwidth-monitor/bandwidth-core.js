/*
 * bandwidth-core.js — the bandwidth-monitoring engine, transport-agnostic and
 * DOM-free. It knows nothing about browsers, sockets, /proc, timers or charts.
 * It does exactly one thing, and does it honestly: turn a stream of *cumulative*
 * interface byte counters into rates, totals and a multi-day history — coping
 * with the two things that make that harder than `curr - prev`:
 *
 *   1. counters WRAP (a 32-bit counter rolls over at 2^32), and
 *   2. counters RESET (the interface is taken down and back up, so the counter
 *      restarts from 0 — a decrease that is NOT a wrap).
 *
 * Getting (1) and (2) right is the whole game. A naive monitor that does
 * `rate = (curr - prev) / dt` reports a gigantic negative spike on a reset and
 * a gigantic positive one... also on a reset, depending on which way it rounds.
 *
 * Everything here works the same whether the counters come from a simulated
 * interface in a browser, this page's real Resource Timing bytes, or a real NIC
 * read out of /proc/net/dev under Node (see bandwidth-node.js).
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Exact counters
 *
 * Real interface counters are unsigned integers — 32-bit on old/embedded
 * stacks, 64-bit on modern Linux. A 64-bit value (up to ~1.8e19) does not fit
 * exactly in a JS double (safe only to 2^53), so we hold counters as BigInt and
 * only convert the *delta* to a Number for rate display, where a double is
 * plenty. toBig() is the one gate: it rejects anything that is not a
 * non-negative integer, so a bad sample fails loudly instead of poisoning the
 * arithmetic.
 * ------------------------------------------------------------------ */
function toBig(v) {
  if (typeof v === 'bigint') {
    if (v < 0n) throw new RangeError('counter must be non-negative');
    return v;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || Math.floor(v) !== v) {
      throw new RangeError('counter must be a non-negative integer');
    }
    return BigInt(v);
  }
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    return BigInt(v.trim());
  }
  throw new TypeError('counter must be a non-negative integer, bigint or digit string');
}

const MOD32 = 1n << 32n;
const MOD64 = 1n << 64n;

/* ------------------------------------------------------------------ *
 * RateSampler — the heart of it.
 *
 * Feed it (timestampMs, cumulativeCounter) over and over. The first sample
 * establishes a baseline and returns null (you need two points to have a rate).
 * Every sample after that returns how many bytes passed since the previous one
 * and the rate that implies — after deciding whether a backwards step was a
 * counter WRAP or an interface RESET.
 *
 * The wrap/reset call is a judgement, so it is made out loud and tunably: a
 * backwards step is treated as a single wrap only if the wrapped delta implies a
 * rate at or below `maxRateBytesPerSec` (a physical ceiling — nothing moved more
 * than a 10 Gbps link's worth of bytes in the gap). Anything faster than that
 * cannot be a wrap, so it is a reset, and on a reset the byte count is reported
 * as a best-effort lower bound while the rate is reported as null — because we
 * genuinely cannot know how long the interface was up before this sample, so any
 * instantaneous rate would be a lie.
 * ------------------------------------------------------------------ */
class RateSampler {
  /**
   * @param {object}  [opts]
   * @param {bigint|null} [opts.modulus] counter modulus: 2n**32n for a 32-bit
   *        counter, 2n**64n for 64-bit, or null to say "this counter never
   *        wraps" — in which case every backwards step is a reset. Default null.
   * @param {number} [opts.maxRateBytesPerSec] physical rate ceiling used to tell
   *        a plausible wrap from a reset. Default 1.25e9 B/s (= 10 Gbps).
   */
  constructor({ modulus = null, maxRateBytesPerSec = 1.25e9 } = {}) {
    if (modulus !== null) {
      modulus = toBig(modulus);
      if (modulus <= 0n) throw new RangeError('modulus must be positive');
    }
    if (!(maxRateBytesPerSec > 0)) throw new RangeError('maxRateBytesPerSec must be > 0');
    this.modulus = modulus;
    this.maxRateBytesPerSec = maxRateBytesPerSec;
    this._prevTs = null;
    this._prevCounter = null;
    this._last = null;
  }

  /** Forget the baseline — the next sample starts a fresh interval. */
  reset() {
    this._prevTs = null;
    this._prevCounter = null;
  }

  get last() { return this._last; }

  /**
   * @param {number} timestampMs  monotonic-ish wall clock in milliseconds.
   * @param {number|bigint|string} counter  cumulative byte counter.
   * @returns {null | {bytes:number, rate:number|null, dtSeconds:number,
   *                   wrapped:boolean, reset:boolean}}
   *          null on the very first sample (baseline) or when no time has
   *          elapsed since the previous one (dt <= 0 → no rate is definable).
   */
  update(timestampMs, counter) {
    if (!Number.isFinite(timestampMs)) throw new TypeError('timestamp must be a finite number');
    const cur = toBig(counter);

    if (this._prevTs === null) {
      this._prevTs = timestampMs;
      this._prevCounter = cur;
      return null;
    }

    const dtMs = timestampMs - this._prevTs;
    if (dtMs <= 0) {
      // Time didn't advance (or went backwards). Re-baseline on the newer
      // counter but refuse to invent a rate over a zero/negative interval.
      this._prevTs = timestampMs;
      this._prevCounter = cur;
      return null;
    }
    const dtSeconds = dtMs / 1000;
    const prev = this._prevCounter;

    let bytes;        // BigInt bytes in this interval
    let wrapped = false;
    let reset = false;
    let rateKnown = true;

    if (cur >= prev) {
      bytes = cur - prev;                 // the common case
    } else {
      // Counter went backwards: wrap or reset?
      const wrappedDelta = this.modulus !== null ? cur + (this.modulus - prev) : null;
      const plausibleWrap =
        wrappedDelta !== null &&
        Number(wrappedDelta) / dtSeconds <= this.maxRateBytesPerSec;
      if (plausibleWrap) {
        bytes = wrappedDelta;
        wrapped = true;
      } else {
        // Reset: the counter restarted from 0 at some unknown moment in the
        // gap. Best-effort bytes observed = the new absolute value; rate is
        // unknowable, so we report it as null rather than a fiction.
        bytes = cur;
        reset = true;
        rateKnown = false;
      }
    }

    this._prevTs = timestampMs;
    this._prevCounter = cur;

    const out = {
      bytes: Number(bytes),
      rate: rateKnown ? Number(bytes) / dtSeconds : null,
      dtSeconds,
      wrapped,
      reset,
    };
    this._last = out;
    return out;
  }
}

/* ------------------------------------------------------------------ *
 * RingBuffer — a fixed-capacity circular buffer for the live sparkline. Push is
 * O(1) and never grows; toArray() returns oldest→newest. Nothing clever, but
 * it keeps the browser from accumulating an unbounded array of samples.
 * ------------------------------------------------------------------ */
class RingBuffer {
  constructor(capacity = 120) {
    if (!(capacity > 0)) throw new RangeError('capacity must be > 0');
    this.capacity = capacity;
    this._buf = [];
    this._head = 0;
  }
  push(v) {
    if (this._buf.length < this.capacity) this._buf.push(v);
    else { this._buf[this._head] = v; this._head = (this._head + 1) % this.capacity; }
    return this;
  }
  get length() { return this._buf.length; }
  toArray() {
    if (this._buf.length < this.capacity) return this._buf.slice();
    return this._buf.slice(this._head).concat(this._buf.slice(0, this._head));
  }
  clear() { this._buf = []; this._head = 0; return this; }
}

/* ------------------------------------------------------------------ *
 * DailyLedger — "keep track of it over several days".
 *
 * Bytes are bucketed by calendar day (the day key is injectable so tests, and
 * callers in other time zones, stay in control of what "a day" means). Only the
 * most recent `retainDays` buckets are kept; older ones are evicted so a monitor
 * left running for a year does not grow without bound. Each day tracks total
 * rx/tx bytes and the peak rx/tx rate seen that day.
 * ------------------------------------------------------------------ */
function localDayKey(timestampMs) {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class DailyLedger {
  constructor({ retainDays = 30, dayKey = localDayKey } = {}) {
    if (!(retainDays > 0)) throw new RangeError('retainDays must be > 0');
    this.retainDays = retainDays;
    this.dayKey = dayKey;
    this._days = new Map();   // key -> {key, rxBytes, txBytes, rxPeak, txPeak}
  }

  /**
   * Record an interval's worth of traffic against the day it ended on.
   * @param {number} timestampMs when the interval ended.
   * @param {object} v { rxBytes, txBytes, rxRate?, txRate? }
   */
  record(timestampMs, { rxBytes = 0, txBytes = 0, rxRate = null, txRate = null } = {}) {
    const key = this.dayKey(timestampMs);
    let bucket = this._days.get(key);
    if (!bucket) {
      bucket = { key, rxBytes: 0, txBytes: 0, rxPeak: 0, txPeak: 0 };
      this._days.set(key, bucket);
      this._evict();
    }
    bucket.rxBytes += rxBytes;
    bucket.txBytes += txBytes;
    if (rxRate !== null && rxRate > bucket.rxPeak) bucket.rxPeak = rxRate;
    if (txRate !== null && txRate > bucket.txPeak) bucket.txPeak = txRate;
    return bucket;
  }

  _evict() {
    while (this._days.size > this.retainDays) {
      // Maps preserve insertion order, so the first key is the oldest day seen.
      const oldest = this._days.keys().next().value;
      this._days.delete(oldest);
    }
  }

  /** Days oldest→newest. */
  days() { return [...this._days.values()]; }

  /** Grand totals across every retained day. */
  totals() {
    let rxBytes = 0, txBytes = 0;
    for (const b of this._days.values()) { rxBytes += b.rxBytes; txBytes += b.txBytes; }
    return { rxBytes, txBytes, totalBytes: rxBytes + txBytes, days: this._days.size };
  }

  clear() { this._days.clear(); return this; }
}

/* ------------------------------------------------------------------ *
 * BandwidthMonitor — the convenience front door that ties it together: one
 * RateSampler per direction (rx = download, tx = upload), a RingBuffer per
 * direction for the chart, and a shared DailyLedger. Callers just hand it the
 * two cumulative counters each tick; it returns the rates and keeps the history.
 * ------------------------------------------------------------------ */
class BandwidthMonitor {
  constructor({ modulus = null, maxRateBytesPerSec = 1.25e9,
                retainDays = 30, ringSize = 120, dayKey = localDayKey } = {}) {
    this.rxSampler = new RateSampler({ modulus, maxRateBytesPerSec });
    this.txSampler = new RateSampler({ modulus, maxRateBytesPerSec });
    this.ledger = new DailyLedger({ retainDays, dayKey });
    this.rxRing = new RingBuffer(ringSize);
    this.txRing = new RingBuffer(ringSize);
    this._samples = 0;
  }

  /**
   * @param {number} timestampMs
   * @param {object} counters { rx, tx } cumulative byte counters.
   * @returns {null | {timestampMs, rxRate, txRate, rxBytes, txBytes,
   *                   reset, wrapped, dtSeconds}}
   *          null on the first (baseline) sample.
   */
  sample(timestampMs, { rx, tx }) {
    const r = this.rxSampler.update(timestampMs, rx);
    const t = this.txSampler.update(timestampMs, tx);
    if (r === null || t === null) return null;
    this._samples++;

    this.ledger.record(timestampMs, {
      rxBytes: r.bytes, txBytes: t.bytes, rxRate: r.rate, txRate: t.rate,
    });
    this.rxRing.push(r.rate);
    this.txRing.push(t.rate);

    return {
      timestampMs,
      rxRate: r.rate, txRate: t.rate,
      rxBytes: r.bytes, txBytes: t.bytes,
      reset: r.reset || t.reset,
      wrapped: r.wrapped || t.wrapped,
      dtSeconds: r.dtSeconds,
    };
  }

  /** Average of the defined (non-null) rate samples currently in the ring. */
  static ringAverage(arr) {
    const nums = arr.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  get sampleCount() { return this._samples; }
}

/* ------------------------------------------------------------------ *
 * Human-readable formatting
 *
 * The oldest confusion in bandwidth tooling: data volume is counted in BYTES
 * (and conventionally in binary KiB/MiB/GiB), while a link's throughput is
 * quoted in BITS per second (SI kilo/mega/giga, 1000-based). An "8 MB/s"
 * download is a "64 Mbps" link; mixing them up is a factor-of-8-and-then-some
 * error. These two functions keep the two worlds honestly separate.
 * ------------------------------------------------------------------ */
const IEC = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
function formatBytes(n, digits = 2) {
  if (!Number.isFinite(n) || n < 0) return '—';
  let i = 0;
  while (n >= 1024 && i < IEC.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? n : n.toFixed(digits)} ${IEC[i]}`;
}

const BITS_UNITS = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s'];
const BYTE_RATE_UNITS = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s'];
/**
 * @param {number|null} bytesPerSec
 * @param {object} [opts] { bits:true } quote throughput in bits/s (SI, 1000),
 *        otherwise in bytes/s (IEC, 1024). Default bits:true — the networking
 *        convention.
 */
function formatRate(bytesPerSec, { bits = true, digits = 2 } = {}) {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '—';
  if (bits) {
    let v = bytesPerSec * 8, i = 0;
    while (v >= 1000 && i < BITS_UNITS.length - 1) { v /= 1000; i++; }
    return `${i === 0 ? Math.round(v) : v.toFixed(digits)} ${BITS_UNITS[i]}`;
  }
  let v = bytesPerSec, i = 0;
  while (v >= 1024 && i < BYTE_RATE_UNITS.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? Math.round(v) : v.toFixed(digits)} ${BYTE_RATE_UNITS[i]}`;
}

/* ------------------------------------------------------------------ *
 * parseProcNetDev — read real Linux interface counters.
 *
 * /proc/net/dev is the canonical source of per-interface byte counts on Linux.
 * It is a fixed-column text table whose first two lines are headers. Pulling it
 * apart is a pure string operation, so it lives here (testable against a
 * fixture) and bandwidth-node.js just feeds it the file contents.
 *
 * Returns { iface: { rxBytes, rxPackets, txBytes, txPackets } } with counts as
 * BigInt (they are 64-bit on modern kernels).
 * ------------------------------------------------------------------ */
function parseProcNetDev(text) {
  const out = {};
  const lines = String(text).split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !line.includes(':')) continue;      // skip the two header lines
    const idx = line.indexOf(':');
    const iface = line.slice(0, idx).trim();
    const cols = line.slice(idx + 1).trim().split(/\s+/);
    // Receive: bytes packets errs drop fifo frame compressed multicast (8)
    // Transmit: bytes packets errs drop fifo colls carrier compressed (8)
    if (cols.length < 16) continue;
    out[iface] = {
      rxBytes: toBig(cols[0]),
      rxPackets: toBig(cols[1]),
      txBytes: toBig(cols[8]),
      txPackets: toBig(cols[9]),
    };
  }
  return out;
}

const exported = {
  toBig,
  MOD32, MOD64,
  RateSampler,
  RingBuffer,
  DailyLedger, localDayKey,
  BandwidthMonitor,
  formatBytes, formatRate,
  parseProcNetDev,
};

// Work as a CommonJS module under Node and as a plain global in the browser.
if (typeof module !== 'undefined' && module.exports) module.exports = exported;
else if (typeof window !== 'undefined') window.BandwidthCore = exported;
