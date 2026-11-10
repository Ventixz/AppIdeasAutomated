/*
 * tests.js — dependency-free checks for the NTP engine, run under Node:
 *   node projects/phase2-web/atomic-time-ntp/tests.js
 *
 * The centre of gravity is the two things that make "get the time off the
 * internet" actually hard and actually get written wrong:
 *
 *   1. The NTP 64-bit timestamp format — the 1900 epoch, the 1/2^32-second
 *      fraction, and the 136-year era that first rolls over on 2036-02-07. The
 *      conversions are checked against values computed independently, including
 *      one on the far side of the 2036 rollover.
 *
 *   2. The offset / round-trip-delay arithmetic (RFC 5905 §8). The worked
 *      example from the RFC's own reckoning is checked to the millisecond, and
 *      a hand-built symmetric exchange confirms a known clock skew is recovered
 *      exactly while the naive "trust the server" answer is shown to be wrong by
 *      the return-trip time.
 *
 * Plus a full round-trip through buildRequestPacket -> parseReplyPacket so the
 * byte layout and the math are tested together, the way the client uses them.
 */
'use strict';

const assert = require('assert');
const core = require('./ntp-core.js');
const {
  NTP_UNIX_DELTA, TWO_POW_32,
  ntpSecondsToUnix, ntpToUnixMs, unixMsToNtp,
  buildRequestPacket, parseReplyPacket,
  computeOffsetDelay, solveExchange, isReplyUsable,
} = core;

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push([name, e]); }
}
const approx = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${a} ≈ ${b} (±${eps})`);

/* ------------------------------------------------------------------ *
 * 1. The epoch constant itself
 * ------------------------------------------------------------------ */
check('NTP_UNIX_DELTA is exactly 2208988800 (70 years, 17 leap days)', () => {
  assert.strictEqual(NTP_UNIX_DELTA, 2208988800);
  assert.strictEqual(NTP_UNIX_DELTA, (70 * 365 + 17) * 86400);
});

/* ------------------------------------------------------------------ *
 * 2. NTP seconds -> Unix seconds, including the 2036 era rollover
 * ------------------------------------------------------------------ */
check('ntp seconds 0 is the 1900 epoch = Unix -2208988800', () => {
  assert.strictEqual(ntpSecondsToUnix(0, 0 - NTP_UNIX_DELTA), -2208988800);
});

check('the Unix epoch (1970-01-01) is NTP seconds 2208988800', () => {
  // Pivot near 1970 so era 0 is chosen.
  assert.strictEqual(ntpSecondsToUnix(2208988800, 0), 0);
});

check('a 2026 timestamp converts in era 0', () => {
  const unix = Date.UTC(2026, 0, 1) / 1000; // 2026-01-01
  const ntpSec = unix + NTP_UNIX_DELTA;
  assert.ok(ntpSec < TWO_POW_32, 'still inside era 0 before 2036');
  assert.strictEqual(ntpSecondsToUnix(ntpSec, unix), unix);
});

check('era rollover: a 2040 time has wrapped the 32-bit field but still converts', () => {
  const unix2040 = Date.UTC(2040, 0, 1) / 1000;
  const rawNtp = unix2040 + NTP_UNIX_DELTA;       // > 2^32
  const wireField = rawNtp % TWO_POW_32;          // what actually travels in 32 bits
  assert.ok(rawNtp >= TWO_POW_32, 'past the 2036 rollover');
  assert.ok(wireField < rawNtp, 'wire field is the wrapped value');
  // With a pivot near 2040, the era-1 interpretation must be chosen:
  assert.strictEqual(ntpSecondsToUnix(wireField, unix2040), unix2040);
});

/* ------------------------------------------------------------------ *
 * 3. The fractional part — 1/2^32-second units
 * ------------------------------------------------------------------ */
check('fraction 0x80000000 is exactly half a second', () => {
  const ms = ntpToUnixMs(2208988800, 0x80000000, 0); // Unix epoch + 0.5s
  approx(ms, 500, 1e-6, 'half-second fraction');
});

check('fraction 0xC0000000 is 0.75 s', () => {
  const ms = ntpToUnixMs(2208988800, 0xC0000000, 0);
  approx(ms, 750, 1e-6, 'three-quarter-second fraction');
});

/* ------------------------------------------------------------------ *
 * 4. ms -> NTP -> ms round-trips to (near) exact
 * ------------------------------------------------------------------ */
check('unixMsToNtp then ntpToUnixMs recovers the time within rounding', () => {
  const samples = [0, 1, 500, 1000, 1731240000123, Date.UTC(2026, 10, 10, 12, 0, 0, 456)];
  for (const ms of samples) {
    const { seconds, fraction } = unixMsToNtp(ms);
    const back = ntpToUnixMs(seconds, fraction, ms / 1000);
    approx(back, ms, 0.001, `round trip for ${ms}`); // < 1 microsecond
  }
});

check('unixMsToNtp sets the right seconds field for the Unix epoch', () => {
  const { seconds, fraction } = unixMsToNtp(0);
  assert.strictEqual(seconds, NTP_UNIX_DELTA);
  assert.strictEqual(fraction, 0);
});

/* ------------------------------------------------------------------ *
 * 5. The offset / delay arithmetic — RFC 5905 §8 worked example
 * ------------------------------------------------------------------ *
 * The classic illustration: server clock is AHEAD of the client; a symmetric
 * trip. We assert both the formulas and that the naive answer is wrong by the
 * inbound travel time.
 */
check('computeOffsetDelay matches the textbook symmetric example', () => {
  // Client clock 100ms behind server. Each leg 20ms. Server busy 5ms.
  //   T1 = 0    (client)
  //   T2 = 120  (server:   true 20 + offset 100)
  //   T3 = 125  (server:   +5ms processing)
  //   T4 = 45   (client:   true 45; i.e. 20+5+20 = 45 after T1)
  const { offset, delay } = computeOffsetDelay(0, 120, 125, 45);
  approx(offset, 100, 1e-9, 'offset');  // ((120-0)+(125-45))/2 = (120+80)/2 = 100
  approx(delay, 40, 1e-9, 'delay');     // (45-0)-(125-120) = 45-5 = 40
});

check('solveExchange recovers a known skew and exposes the naive error', () => {
  // Build a reply for: local clock 200ms behind, 50ms each way, 10ms server work.
  const serverBase = Date.UTC(2026, 10, 10, 12, 0, 0);
  const skew = -200;
  const t1 = serverBase + skew;         // client sends (reads low)
  const t2 = serverBase + 50;           // server receives (true)
  const t3 = serverBase + 60;           // server replies
  const t4 = serverBase + skew + 110;   // client receives (reads low)

  const reply = {
    originateTimeMs: t1, receiveTimeMs: t2,
    transmitTimeMs: t3, destinationTimeMs: t4,
  };
  const s = solveExchange(reply);
  approx(s.offsetMs, 200, 1e-6, 'offset recovers the +200ms skew');
  approx(s.delayMs, 100, 1e-6, 'round-trip delay');
  approx(s.correctedNowMs, serverBase + 110, 1e-6, 'corrected time matches the true clock');
  // Naive = trust T3; it is behind the truth by the return leg (~50ms).
  approx(s.naiveNowMs, t3, 1e-9, 'naive uses T3');
  approx(s.naiveErrorMs, -50, 1e-6, 'naive is wrong by the inbound travel time');
});

/* ------------------------------------------------------------------ *
 * 6. Full packet round-trip: build a request, craft a reply, parse, solve
 * ------------------------------------------------------------------ */
check('buildRequestPacket makes a valid 48-byte client packet', () => {
  const t1 = Date.UTC(2026, 10, 10, 12, 0, 0, 250);
  const pkt = buildRequestPacket(t1, 4);
  assert.strictEqual(pkt.length, 48);
  const b0 = pkt[0];
  assert.strictEqual((b0 >> 6) & 0x3, 0, 'LI = 0');
  assert.strictEqual((b0 >> 3) & 0x7, 4, 'version = 4');
  assert.strictEqual(b0 & 0x7, 3, 'mode = 3 (client)');
  // Transmit timestamp (bytes 40..47) must equal T1 when parsed back.
  const view = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
  const sec = view.getUint32(40, false);
  const frac = view.getUint32(44, false);
  approx(ntpToUnixMs(sec, frac, t1 / 1000), t1, 0.001, 'transmit ts == T1');
});

check('parseReplyPacket reads every field a server sets', () => {
  // Hand-assemble a stratum-1 "GPS" reply.
  const buf = new Uint8Array(48);
  const view = new DataView(buf.buffer);
  view.setUint8(0, (0 << 6) | (4 << 3) | 4); // LI0 v4 mode4
  view.setUint8(1, 1);        // stratum 1
  view.setInt8(2, 6);         // poll
  view.setInt8(3, -20);       // precision
  view.setUint32(4, 0.01 * 65536, false);  // root delay 10ms in 16.16
  view.setUint32(8, 0.02 * 65536, false);  // root dispersion 20ms
  view.setUint32(12, 0x47505300, false);   // "GPS\0"
  const put = (off, ms) => {
    const { seconds, fraction } = unixMsToNtp(ms);
    view.setUint32(off, seconds, false);
    view.setUint32(off + 4, fraction, false);
  };
  const base = Date.UTC(2026, 10, 10, 12, 0, 0);
  put(16, base - 2000);
  put(24, base);        // originate
  put(32, base + 10);   // receive
  put(40, base + 12);   // transmit
  const r = parseReplyPacket(buf, base + 25);

  assert.strictEqual(r.stratum, 1);
  assert.strictEqual(r.mode, 4);
  assert.strictEqual(r.leapIndicator, 0);
  assert.strictEqual(r.refIdText, 'GPS');
  approx(r.rootDelay, 0.01, 1e-4, 'root delay');
  approx(r.rootDispersion, 0.02, 1e-4, 'root dispersion');
  approx(r.originateTimeMs, base, 0.001, 'T1');
  approx(r.receiveTimeMs, base + 10, 0.001, 'T2');
  approx(r.transmitTimeMs, base + 12, 0.001, 'T3');
  assert.strictEqual(r.destinationTimeMs, base + 25, 'T4 passed in');

  const s = solveExchange(r);
  // offset ((10)+(12-25))/2 = (10-13)/2 = -1.5 ; delay (25)-(2) = 23
  approx(s.offsetMs, -1.5, 0.01, 'offset');
  approx(s.delayMs, 23, 0.01, 'delay');
});

check('stratum >= 2 reference id is an IPv4 dotted quad', () => {
  const buf = new Uint8Array(48);
  const view = new DataView(buf.buffer);
  view.setUint8(0, (0 << 6) | (4 << 3) | 4);
  view.setUint8(1, 2); // stratum 2
  view.setUint32(12, (203 << 24) | (0 << 16) | (113 << 8) | 7, false); // 203.0.113.7
  view.setUint32(40, NTP_UNIX_DELTA + 1, false); // non-zero transmit so it's usable
  const r = parseReplyPacket(buf, Date.now());
  assert.strictEqual(r.refIdText, '203.0.113.7');
});

/* ------------------------------------------------------------------ *
 * 7. The sanity gate rejects what RFC 5905 §8 says to reject
 * ------------------------------------------------------------------ */
check('isReplyUsable rejects leap=3, bad mode, stratum 0, zero transmit', () => {
  const good = { leapIndicator: 0, mode: 4, stratum: 2, transmitTimeMs: 1 };
  assert.ok(isReplyUsable(good).ok);

  assert.ok(!isReplyUsable({ ...good, leapIndicator: 3 }).ok, 'leap 3 rejected');
  assert.ok(!isReplyUsable({ ...good, mode: 3 }).ok, 'client-mode reply rejected');
  assert.ok(!isReplyUsable({ ...good, stratum: 0 }).ok, 'stratum 0 (KoD) rejected');
  assert.ok(!isReplyUsable({ ...good, stratum: 16 }).ok, 'stratum 16 rejected');
  assert.ok(!isReplyUsable({ ...good, transmitTimeMs: null }).ok, 'zero transmit rejected');
});

check('parseReplyPacket throws on a short buffer', () => {
  assert.throws(() => parseReplyPacket(new Uint8Array(10), 0), /too short/);
});

check('solveExchange throws when a timestamp is missing', () => {
  assert.throws(
    () => solveExchange({ originateTimeMs: 1, receiveTimeMs: null, transmitTimeMs: 3, destinationTimeMs: 4 }),
    /incomplete/,
  );
});

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
if (failures.length === 0) {
  console.log(`  ✓ all ${passed} checks passing`);
} else {
  console.log(`  ${passed} passing, ${failures.length} FAILING:\n`);
  for (const [name, e] of failures) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e && e.message ? e.message : e}`);
  }
  process.exitCode = 1;
}
