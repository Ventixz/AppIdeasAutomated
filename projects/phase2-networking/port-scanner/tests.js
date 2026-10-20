/*
 * tests.js — dependency-free checks for the port scanner, run under Node:
 *   node projects/phase2-networking/port-scanner/tests.js
 *
 * Four layers:
 *   1. Port-spec parsing — ranges, dedup, ordering, and strict errors.
 *   2. The classifier & scanner — the open/closed/filtered three-way split
 *      driven by a simulated host, plus the concurrency bound, progress,
 *      cancellation and the summary. These use real (but tiny) timers so the
 *      scanner's real timeout path is exercised, not stubbed.
 *   3. Service-name lookup & helpers.
 *   4. Real TCP sockets — start a real server on loopback and scan it (open),
 *      scan a refused port (closed), and scan a non-routable address (filtered),
 *      all over actual `net` connections.
 */
'use strict';

const assert = require('assert');
const net = require('net');
const {
  STATE, classifyError,
  parsePort, parsePortSpec, serviceName,
  PortScanner, summarize, makeSimulatedHost, runPool,
} = require('./portscan-core.js');
const { scanHost } = require('./portscan-node.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push([name, e]); }
}
// Async checks are collected and awaited in order at the end (real timers).
const asyncChecks = [];
function acheck(name, fn) { asyncChecks.push([name, fn]); }

/* ---------------------------------------------------------------- *
 * 1. Port-spec parsing
 * ---------------------------------------------------------------- */

check('single port parses', () => {
  assert.deepStrictEqual(parsePortSpec('80'), [80]);
});

check('comma list parses, sorts and de-dupes', () => {
  assert.deepStrictEqual(parsePortSpec('443, 80, 80, 22'), [22, 80, 443]);
});

check('a range expands inclusively', () => {
  assert.deepStrictEqual(parsePortSpec('8000-8003'), [8000, 8001, 8002, 8003]);
});

check('mixed list and ranges merge and de-dupe', () => {
  assert.deepStrictEqual(parsePortSpec('22,80,79-81'), [22, 79, 80, 81]);
});

check('whitespace and empty tokens are tolerated', () => {
  assert.deepStrictEqual(parsePortSpec('  22 , , 80 ,'), [22, 80]);
});

check('boundary ports 1 and 65535 are valid', () => {
  assert.deepStrictEqual(parsePortSpec('1,65535'), [1, 65535]);
});

check('port 0 is rejected', () => {
  assert.throws(() => parsePortSpec('0'), RangeError);
});

check('port 65536 is rejected', () => {
  assert.throws(() => parsePortSpec('65536'), RangeError);
});

check('non-numeric token is rejected (not silently dropped)', () => {
  assert.throws(() => parsePortSpec('80,http'), RangeError);
});

check('backwards range is rejected', () => {
  assert.throws(() => parsePortSpec('443-80'), RangeError);
});

check('empty spec is rejected', () => {
  assert.throws(() => parsePortSpec('   '), SyntaxError);
});

check('maxPorts cap is enforced', () => {
  assert.throws(() => parsePortSpec('1-1000', { maxPorts: 100 }), RangeError);
});

check('parsePort rejects overlong digit strings', () => {
  assert.throws(() => parsePort('123456'), RangeError);
});

/* ---------------------------------------------------------------- *
 * 2. The classifier & scanner — open / closed / filtered
 * ---------------------------------------------------------------- */

check('classifyError maps socket codes to states', () => {
  assert.strictEqual(classifyError('ECONNREFUSED'), STATE.CLOSED);
  assert.strictEqual(classifyError('ETIMEDOUT'), STATE.FILTERED);
  assert.strictEqual(classifyError('EHOSTUNREACH'), STATE.ERROR);
  assert.strictEqual(classifyError('ENETUNREACH'), STATE.ERROR);
  assert.strictEqual(classifyError('ECONNRESET'), STATE.CLOSED);
  assert.strictEqual(classifyError('WAT'), STATE.ERROR);
});

acheck('scan classifies open / closed / filtered correctly', async () => {
  const probe = makeSimulatedHost({
    open: [22, 80, 443], closed: [23], filtered: [8080],
    default: STATE.CLOSED, latencyMs: 10,
  });
  const scanner = new PortScanner({
    host: 'sim', ports: [22, 23, 80, 443, 8080], probe,
    timeoutMs: 120, concurrency: 8,
  });
  const { results, summary } = await scanner.scan();
  const byPort = Object.fromEntries(results.map((r) => [r.port, r.state]));
  assert.strictEqual(byPort[22], STATE.OPEN);
  assert.strictEqual(byPort[23], STATE.CLOSED);
  assert.strictEqual(byPort[80], STATE.OPEN);
  assert.strictEqual(byPort[443], STATE.OPEN);
  assert.strictEqual(byPort[8080], STATE.FILTERED, 'silence → filtered, not closed');
  assert.deepStrictEqual(summary.openPorts, [22, 80, 443]);
  assert.strictEqual(summary.counts.open, 3);
  assert.strictEqual(summary.counts.closed, 1);
  assert.strictEqual(summary.counts.filtered, 1);
});

acheck('closed and filtered are kept distinct (the whole point)', async () => {
  const probe = makeSimulatedHost({
    closed: [1], filtered: [2], default: STATE.CLOSED, latencyMs: 5,
  });
  const scanner = new PortScanner({
    host: 'sim', ports: [1, 2], probe, timeoutMs: 100,
  });
  const { results } = await scanner.scan();
  assert.strictEqual(results.find((r) => r.port === 1).state, STATE.CLOSED);
  assert.strictEqual(results.find((r) => r.port === 2).state, STATE.FILTERED);
  assert.notStrictEqual(results[0].state, results[1].state);
});

acheck('results come back in port order regardless of finish order', async () => {
  // Make port 80 slower so it finishes last, then assert order is still 80,81,82.
  const probe = (host, port, signal) => new Promise((resolve) => {
    const delay = port === 80 ? 60 : 10;
    const id = setTimeout(() => { if (!signal.aborted) resolve({ connected: true }); }, delay);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });
  const scanner = new PortScanner({
    host: 'sim', ports: [80, 81, 82], probe, timeoutMs: 500,
  });
  const { results } = await scanner.scan();
  assert.deepStrictEqual(results.map((r) => r.port), [80, 81, 82]);
});

acheck('concurrency bound is never exceeded', async () => {
  let inFlight = 0, maxInFlight = 0;
  const probe = (host, port, signal) => new Promise((resolve) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    const id = setTimeout(() => { inFlight--; resolve({ connected: true }); }, 15);
    signal.addEventListener('abort', () => { clearTimeout(id); inFlight--; }, { once: true });
  });
  const ports = Array.from({ length: 20 }, (_, k) => 1000 + k);
  const scanner = new PortScanner({
    host: 'sim', ports, probe, timeoutMs: 500, concurrency: 4,
  });
  await scanner.scan();
  assert.ok(maxInFlight <= 4, `max in flight ${maxInFlight} should be ≤ 4`);
  assert.ok(maxInFlight >= 2, 'should actually run in parallel');
});

acheck('onProgress fires once per port with running totals', async () => {
  const probe = makeSimulatedHost({ open: [1, 2, 3], latencyMs: 5 });
  const seen = [];
  const scanner = new PortScanner({
    host: 'sim', ports: [1, 2, 3], probe, timeoutMs: 100,
    onProgress: (row, prog) => seen.push(prog.done),
  });
  const { summary } = await scanner.scan();
  assert.strictEqual(seen.length, 3);
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), [1, 2, 3]);
  assert.strictEqual(summary.total, 3);
});

acheck('cancel() marks not-yet-started ports as SKIPPED', async () => {
  const probe = makeSimulatedHost({ open: [1, 2, 3, 4, 5, 6], latencyMs: 20 });
  const scanner = new PortScanner({
    host: 'sim', ports: [1, 2, 3, 4, 5, 6], probe, timeoutMs: 200, concurrency: 2,
  });
  const p = scanner.scan();
  scanner.cancel();          // cancel before any probe resolves
  const { results, summary } = await p;
  assert.strictEqual(results.length, 6, 'every port is still accounted for');
  assert.ok(summary.counts.skipped >= 1, 'some ports were skipped');
  const accounted = summary.counts.open + summary.counts.skipped
    + summary.counts.closed + summary.counts.filtered;
  assert.strictEqual(accounted, 6);
});

acheck('an empty port list scans cleanly', async () => {
  const scanner = new PortScanner({ host: 'sim', ports: [], probe: () => Promise.resolve({}) });
  const { results, summary } = await scanner.scan();
  assert.strictEqual(results.length, 0);
  assert.strictEqual(summary.total, 0);
  assert.deepStrictEqual(summary.openPorts, []);
});

acheck('runPool preserves per-item work and handles n < concurrency', async () => {
  const order = [];
  await runPool([1, 2, 3], 10, async (x) => { order.push(x); });
  assert.deepStrictEqual(order.sort(), [1, 2, 3]);
});

/* ---------------------------------------------------------------- *
 * 3. Service names & summary helper
 * ---------------------------------------------------------------- */

check('well-known service names resolve', () => {
  assert.strictEqual(serviceName(22), 'ssh');
  assert.strictEqual(serviceName(80), 'http');
  assert.strictEqual(serviceName(443), 'https');
  assert.strictEqual(serviceName(5432), 'postgresql');
  assert.strictEqual(serviceName(49231), '');
});

check('summarize counts states and lists open ports sorted', () => {
  const s = summarize([
    { port: 443, state: STATE.OPEN }, { port: 22, state: STATE.OPEN },
    { port: 23, state: STATE.CLOSED }, { port: 81, state: STATE.FILTERED },
  ]);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.counts.open, 2);
  assert.deepStrictEqual(s.openPorts, [22, 443]);
});

/* ---------------------------------------------------------------- *
 * 4. Real TCP sockets (loopback) — proves the probe against the kernel
 * ---------------------------------------------------------------- */

acheck('LIVE: a real listening port scans as OPEN', async () => {
  const server = net.createServer((sock) => sock.end());
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  try {
    const { results } = await scanHost('127.0.0.1', [port], { timeoutMs: 1000 });
    assert.strictEqual(results[0].state, STATE.OPEN, 'listening port must be open');
    assert.ok(results[0].latencyMs >= 0);
  } finally {
    await new Promise((res) => server.close(res));
  }
});

acheck('LIVE: an unused port scans as CLOSED (real ECONNREFUSED)', async () => {
  // Bind then immediately release a port to get one that is almost surely free.
  const probe = net.createServer();
  await new Promise((res) => probe.listen(0, '127.0.0.1', res));
  const freePort = probe.address().port;
  await new Promise((res) => probe.close(res));
  const { results } = await scanHost('127.0.0.1', [freePort], { timeoutMs: 1000 });
  assert.notStrictEqual(results[0].state, STATE.OPEN);
  assert.ok([STATE.CLOSED, STATE.FILTERED].includes(results[0].state),
    `expected closed/filtered, got ${results[0].state}`);
});

acheck('LIVE: a non-routable address never scans as OPEN', async () => {
  // 192.0.2.0/24 is TEST-NET-1 (RFC 5737): reserved, non-routable. Depending on
  // the network, a SYN there is either black-holed (→ FILTERED, via the real
  // timeout) or refused by a local stack/proxy (→ CLOSED/ERROR). Both are
  // correct reactions to what the kernel reports; the one thing that must never
  // happen is a false OPEN. (The timeout→FILTERED path itself is proven
  // deterministically by the simulated-host checks above, where an 8080 that
  // never answers is classified FILTERED by the scanner's real 120 ms timeout.)
  const { results } = await scanHost('192.0.2.1', [80], { timeoutMs: 300 });
  assert.ok([STATE.FILTERED, STATE.ERROR, STATE.CLOSED].includes(results[0].state),
    `expected a non-open verdict, got ${results[0].state}`);
  assert.notStrictEqual(results[0].state, STATE.OPEN, 'must never be a false open');
});

acheck('LIVE: scanning several loopback ports at once stays correct', async () => {
  const servers = [];
  for (let i = 0; i < 3; i++) {
    const s = net.createServer((sock) => sock.end());
    await new Promise((res) => s.listen(0, '127.0.0.1', res));
    servers.push(s);
  }
  const openPorts = servers.map((s) => s.address().port);
  try {
    const { results, summary } = await scanHost('127.0.0.1', openPorts, { timeoutMs: 1000, concurrency: 3 });
    assert.strictEqual(summary.counts.open, 3, 'all three listeners open');
    assert.deepStrictEqual(summary.openPorts, [...openPorts].sort((a, b) => a - b));
    assert.strictEqual(results.length, 3);
  } finally {
    for (const s of servers) await new Promise((res) => s.close(res));
  }
});

/* ---------------------------------------------------------------- *
 * Run the async checks in order, then report.
 * ---------------------------------------------------------------- */
(async () => {
  for (const [name, fn] of asyncChecks) {
    try { await fn(); passed++; }
    catch (e) { failures.push([name, e]); }
  }
  if (failures.length) {
    console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
    for (const [name, err] of failures) {
      console.error(`  ✗ ${name}\n    ${err && err.message ? err.message : err}`);
    }
    process.exit(1);
  } else {
    console.log(`\n✓ all ${passed} checks passing\n`);
  }
})();
