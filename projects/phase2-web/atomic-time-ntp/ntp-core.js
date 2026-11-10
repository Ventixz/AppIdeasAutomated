/*
 * ntp-core.js — the pure engine behind "Get Atomic Time from an Internet Clock".
 *
 * Getting the exact time from an atomic clock on the internet IS the Network
 * Time Protocol (NTP / its stateless subset SNTP, RFC 5905). The hard part is
 * NOT opening a socket. It is two things this file does and nothing else:
 *
 *   1. The on-the-wire format — the 48-byte packet and, inside it, NTP's own
 *      64-bit timestamp: 32 bits of seconds since 1900-01-01 plus 32 bits of
 *      fraction. That format has a 1900 epoch (not Unix's 1970), a fixed-point
 *      fraction, and a 136-year "era" that first rolls over on 2036-02-07.
 *
 *   2. The clock-filter arithmetic — given the four timestamps of one exchange,
 *      compute the *offset* between the two clocks and the *round-trip delay*,
 *      in a way that cancels symmetric network latency. This is the whole point
 *      of NTP and the thing the naive "just read the server's clock" skips.
 *
 * No sockets, no Date.now() calls baked into the math, no dependencies. The
 * same file backs the Node UDP client, the browser demo, and the tests, so the
 * arithmetic that actually matters is shared and tested in one place.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

// Seconds between the NTP epoch (1900-01-01 00:00:00 UTC) and the Unix epoch
// (1970-01-01). 70 years, 17 of them leap years:
//   70*365 + 17 = 25567 days -> 25567 * 86400 = 2208988800 seconds.
const NTP_UNIX_DELTA = 2208988800;

// One NTP era is 2^32 seconds (~136 years). Era 0 ends 2036-02-07 06:28:16 UTC.
const TWO_POW_32 = 4294967296; // 2^32

const NTP_PACKET_SIZE = 48;

// Leap Indicator field (top 2 bits of byte 0 in the reply).
const LEAP = {
  0: 'no warning',
  1: 'last minute has 61 seconds',
  2: 'last minute has 59 seconds',
  3: 'unsynchronized (clock not valid — reject)',
};

// Mode field (low 3 bits of byte 0).
const MODE = {
  0: 'reserved', 1: 'symmetric active', 2: 'symmetric passive',
  3: 'client', 4: 'server', 5: 'broadcast', 6: 'control', 7: 'private',
};

/* ------------------------------------------------------------------ *
 * NTP 64-bit timestamp  <->  JavaScript time (ms since Unix epoch)
 * ------------------------------------------------------------------ *
 * An NTP timestamp is two unsigned 32-bit integers: whole seconds since 1900,
 * then a fraction of a second measured in units of 1/2^32 s. These helpers do
 * the conversion both ways, and — critically — get the *era* right.
 */

/**
 * Convert an NTP seconds field to Unix seconds, resolving the 136-year era.
 *
 * The seconds field is only 32 bits, so the same value repeats every ~136
 * years. Subtracting NTP_UNIX_DELTA assumes era 0 (1900–2036); after 2036 that
 * is wrong by 2^32 seconds. We disambiguate the way every correct SNTP client
 * does: pick the era whose resulting time is closest to a pivot (default: now).
 * That keeps the function correct across the 2036 rollover without a clock that
 * is more than ~68 years off.
 *
 * @param {number} ntpSeconds  the raw 32-bit seconds field (0 .. 2^32-1)
 * @param {number} [pivotUnixSec]  a Unix-seconds hint for which era we're in
 * @returns {number} Unix seconds (may be fractional? no — integer seconds)
 */
function ntpSecondsToUnix(ntpSeconds, pivotUnixSec) {
  if (pivotUnixSec === undefined) pivotUnixSec = Date.now() / 1000;
  const base = ntpSeconds - NTP_UNIX_DELTA; // era-0 interpretation
  let best = base;
  let bestDiff = Infinity;
  // Eras -1..+2 span roughly 1764 .. 2308 — far more than any sane clock skew.
  for (let era = -1; era <= 2; era++) {
    const candidate = base + era * TWO_POW_32;
    const diff = Math.abs(candidate - pivotUnixSec);
    if (diff < bestDiff) { bestDiff = diff; best = candidate; }
  }
  return best;
}

/**
 * Full 64-bit NTP timestamp (seconds + fraction) -> milliseconds since the
 * Unix epoch, as a float. The fraction is exact to ~0.23 nanoseconds; we return
 * ms, which is all a JS Date can hold anyway.
 */
function ntpToUnixMs(ntpSeconds, ntpFraction, pivotUnixSec) {
  const unixSec = ntpSecondsToUnix(ntpSeconds, pivotUnixSec);
  const fracSec = ntpFraction / TWO_POW_32; // 0 <= fracSec < 1
  return unixSec * 1000 + fracSec * 1000;
}

/**
 * Milliseconds since the Unix epoch -> NTP { seconds, fraction }, with the
 * seconds field reduced modulo 2^32 (i.e. the era-0/era-N wire representation).
 */
function unixMsToNtp(ms) {
  const totalSec = Math.floor(ms / 1000);
  const msRemainder = ms - totalSec * 1000; // 0 .. <1000
  // Reduce to the 32-bit field. ((x % N) + N) % N keeps it non-negative.
  const rawSeconds = totalSec + NTP_UNIX_DELTA;
  const seconds = ((rawSeconds % TWO_POW_32) + TWO_POW_32) % TWO_POW_32;
  let fraction = Math.round((msRemainder / 1000) * TWO_POW_32);
  if (fraction >= TWO_POW_32) fraction = TWO_POW_32 - 1; // guard rounding up
  return { seconds, fraction };
}

/* ------------------------------------------------------------------ *
 * Packet: build a client request, parse a server reply
 * ------------------------------------------------------------------ *
 * The 48-byte layout (RFC 5905 §7.3):
 *   byte 0   : LI(2) | VN(3) | Mode(3)
 *   byte 1   : Stratum
 *   byte 2   : Poll (log2 seconds)
 *   byte 3   : Precision (signed, log2 seconds)
 *   4..7     : Root Delay       (16.16 fixed point)
 *   8..11    : Root Dispersion  (16.16 fixed point)
 *   12..15   : Reference ID
 *   16..23   : Reference Timestamp   (64-bit)
 *   24..31   : Originate Timestamp   T1  (server echoes the client's transmit)
 *   32..39   : Receive  Timestamp    T2
 *   40..47   : Transmit Timestamp    T3  (client writes its T1 here on request)
 */

/**
 * Build a 48-byte client request. All fields are zero except byte 0 and the
 * Transmit Timestamp, which carries T1 — the client's send time. The server
 * copies that value back into the Originate field, which is how the client
 * later recognises the reply and recovers T1 exactly even if its own clock has
 * ticked on.
 *
 * @param {number} t1Ms          client transmit time, ms since Unix epoch
 * @param {number} [version=4]   NTP version (3 or 4)
 * @returns {Uint8Array} the 48-byte request
 */
function buildRequestPacket(t1Ms, version) {
  if (version === undefined) version = 4;
  const buf = new ArrayBuffer(NTP_PACKET_SIZE);
  const view = new DataView(buf);
  // LI = 0 (no warning), VN = version, Mode = 3 (client).
  view.setUint8(0, (0 << 6) | ((version & 0x7) << 3) | (3 & 0x7));
  if (t1Ms !== undefined && t1Ms !== null) {
    const { seconds, fraction } = unixMsToNtp(t1Ms);
    view.setUint32(40, seconds, false); // transmit timestamp seconds
    view.setUint32(44, fraction, false); // transmit timestamp fraction
  }
  return new Uint8Array(buf);
}

/** Read a 64-bit NTP timestamp at byteOffset as { seconds, fraction }. */
function readTimestamp(view, byteOffset) {
  return {
    seconds: view.getUint32(byteOffset, false),
    fraction: view.getUint32(byteOffset + 4, false),
  };
}

/**
 * Parse a 48-byte server reply into its fields, with timestamps already
 * converted to ms since the Unix epoch. Does not need the network — give it any
 * 48 bytes. `t4Ms` (when the client received the reply) is passed in because it
 * is measured by the caller, not carried in the packet.
 *
 * @param {Uint8Array|Buffer} bytes
 * @param {number} [t4Ms]  destination time; defaults to now
 */
function parseReplyPacket(bytes, t4Ms) {
  if (!bytes || bytes.length < NTP_PACKET_SIZE) {
    throw new Error(`NTP reply too short: ${bytes ? bytes.length : 0} bytes (need ${NTP_PACKET_SIZE})`);
  }
  const view = bytes.buffer
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes);
  const b0 = view.getUint8(0);
  const li = (b0 >> 6) & 0x3;
  const version = (b0 >> 3) & 0x7;
  const mode = b0 & 0x7;
  const stratum = view.getUint8(1);
  const poll = view.getInt8(2);
  const precision = view.getInt8(3);
  // Root delay / dispersion are 32-bit values in 16.16 seconds fixed point.
  const rootDelay = view.getUint32(4, false) / 65536;
  const rootDispersion = view.getUint32(8, false) / 65536;
  const refId = view.getUint32(12, false);

  const refTs = readTimestamp(view, 16);
  const origTs = readTimestamp(view, 24); // echoed T1
  const rxTs = readTimestamp(view, 32); // T2
  const txTs = readTimestamp(view, 40); // T3

  const toMs = (ts) =>
    (ts.seconds === 0 && ts.fraction === 0)
      ? null // field not set
      : ntpToUnixMs(ts.seconds, ts.fraction);

  return {
    leapIndicator: li,
    leapText: LEAP[li],
    version,
    mode,
    modeText: MODE[mode] || `unknown(${mode})`,
    stratum,
    stratumText: describeStratum(stratum),
    poll,
    precision,
    precisionSeconds: Math.pow(2, precision),
    rootDelay,
    rootDispersion,
    refId,
    refIdText: stratumRefIdText(stratum, refId),
    referenceTimeMs: toMs(refTs),
    originateTimeMs: toMs(origTs), // T1 as the server saw it
    receiveTimeMs: toMs(rxTs), // T2
    transmitTimeMs: toMs(txTs), // T3
    destinationTimeMs: t4Ms === undefined ? Date.now() : t4Ms, // T4
  };
}

function describeStratum(s) {
  if (s === 0) return 'kiss-o\'-death / unspecified';
  if (s === 1) return 'primary (directly attached reference clock)';
  if (s >= 2 && s <= 15) return `secondary (${s} hops from a reference clock)`;
  return 'reserved / unsynchronized';
}

// For stratum 1, the reference ID is a 4-char ASCII code naming the clock
// source (e.g. "GPS\0", "PPS\0"). For stratum >= 2 in IPv4 it is the server's
// upstream IPv4 address. Stratum 0 carries a "kiss code".
function stratumRefIdText(stratum, refId) {
  const bytes = [
    (refId >>> 24) & 0xff, (refId >>> 16) & 0xff,
    (refId >>> 8) & 0xff, refId & 0xff,
  ];
  if (stratum <= 1) {
    const ascii = bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '')).join('').trim();
    return ascii || bytes.join('.');
  }
  return bytes.join('.'); // IPv4 dotted quad of the upstream server
}

/* ------------------------------------------------------------------ *
 * The arithmetic that is the whole point: offset and round-trip delay
 * ------------------------------------------------------------------ *
 * Four timestamps describe one request/reply exchange:
 *
 *   T1  client transmit   (client clock)
 *   T2  server receive    (server clock)
 *   T3  server transmit   (server clock)
 *   T4  client receive    (client clock)
 *
 *   offset  θ = ((T2 - T1) + (T3 - T4)) / 2
 *   delay   δ = (T4 - T1) - (T3 - T2)
 *
 * θ is how far the client clock is behind (θ > 0) or ahead (θ < 0) of the
 * server. The derivation assumes the outbound and return paths take the same
 * time; the algebra then makes the one-way latency cancel. δ is the total
 * network round trip minus the server's own processing time (T3 - T2), i.e.
 * the time actually spent on the wire.
 */
function computeOffsetDelay(t1, t2, t3, t4) {
  const offset = ((t2 - t1) + (t3 - t4)) / 2;
  const delay = (t4 - t1) - (t3 - t2);
  return { offset, delay };
}

/**
 * Turn a parsed reply (which already carries T1..T4 as ms) into the full
 * result a client cares about: the clock offset, the round-trip delay, and the
 * corrected "true" time at the moment of reception (T4 + offset).
 *
 * It also reports the *naive* answer — just trusting the server's transmit
 * timestamp T3 as "now" — and the error that naive answer carries, so callers
 * can show exactly what the four-timestamp dance buys you. That error is the
 * return leg of the trip: T4 - T3, i.e. the reply's travel time, which for a
 * symmetric path is about δ/2.
 */
function solveExchange(reply) {
  const t1 = reply.originateTimeMs;
  const t2 = reply.receiveTimeMs;
  const t3 = reply.transmitTimeMs;
  const t4 = reply.destinationTimeMs;
  if ([t1, t2, t3, t4].some((v) => v === null || v === undefined || Number.isNaN(v))) {
    throw new Error('incomplete timestamps: cannot solve the exchange');
  }
  const { offset, delay } = computeOffsetDelay(t1, t2, t3, t4);
  const correctedNowMs = t4 + offset;        // NTP's answer for "true time now"
  const naiveNowMs = t3;                      // just believe the server's clock
  const naiveErrorMs = naiveNowMs - correctedNowMs; // = t3 - t4 - offset
  return {
    t1, t2, t3, t4,
    offsetMs: offset,
    delayMs: delay,
    correctedNowMs,
    naiveNowMs,
    naiveErrorMs,
  };
}

/* ------------------------------------------------------------------ *
 * Sanity gate — when a reply must be thrown away (RFC 5905 §8)
 * ------------------------------------------------------------------ */
function isReplyUsable(reply) {
  const reasons = [];
  if (reply.leapIndicator === 3) reasons.push('leap indicator = 3 (server unsynchronized)');
  if (reply.mode !== 4 && reply.mode !== 5) reasons.push(`mode is ${reply.modeText}, expected server`);
  if (reply.stratum === 0) reasons.push('stratum 0 (kiss-o\'-death packet)');
  if (reply.stratum > 15) reasons.push(`stratum ${reply.stratum} out of range`);
  if (reply.transmitTimeMs === null) reasons.push('transmit timestamp is zero');
  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ */

const API = {
  NTP_UNIX_DELTA,
  TWO_POW_32,
  NTP_PACKET_SIZE,
  LEAP,
  MODE,
  ntpSecondsToUnix,
  ntpToUnixMs,
  unixMsToNtp,
  buildRequestPacket,
  readTimestamp,
  parseReplyPacket,
  computeOffsetDelay,
  solveExchange,
  isReplyUsable,
  describeStratum,
  stratumRefIdText,
};

// Universal export: CommonJS under Node, a global under the browser. The same
// file backs the CLI, the tests, and index.html.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else if (typeof window !== 'undefined') {
  window.NtpCore = API;
}
