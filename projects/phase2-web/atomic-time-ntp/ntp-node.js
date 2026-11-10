#!/usr/bin/env node
/*
 * ntp-node.js — the real I/O layer around ntp-core.js.
 *
 * This is the part the core deliberately does NOT do: open a UDP socket, send
 * the 48-byte request to a real internet time server on port 123, and record
 * the exact moment the reply comes back. It uses only Node's built-in `dgram`
 * module — zero dependencies — and hands every byte to ntp-core for building,
 * parsing and the offset/delay arithmetic, so the thing that is actually hard
 * (getting the time *right*, not just reading a number off the wire) is shared
 * with the browser demo and the tests.
 *
 * Why UDP and not HTTP? Because an atomic clock on the internet speaks NTP, and
 * NTP is a UDP protocol. An HTTP `Date:` header is rounded to the whole second
 * and already stale by the response time; NTP gives sub-millisecond offset by
 * measuring the round trip. That measurement is the entire reason this exists.
 *
 * Usage:
 *   node ntp-node.js [server] [options]
 *
 * Options:
 *   --server HOST     NTP server to query (default: pool.ntp.org)
 *   --port N          UDP port (default: 123)
 *   --version N       NTP version to send, 3 or 4 (default: 4)
 *   --samples N       query N times and keep the best (lowest-delay) sample
 *   --timeout MS      per-request timeout in ms (default: 3000)
 *   --json            print the full result as JSON
 *   --set-hint        print a ready-to-run `date` command for the correction
 *   --demo            no network: solve a canned four-timestamp exchange
 *
 * Examples:
 *   node ntp-node.js --demo
 *   node ntp-node.js time.cloudflare.com
 *   node ntp-node.js --server time.google.com --samples 4 --json
 */
'use strict';

const core = require('./ntp-core.js');

/* ----------------------------- CLI parsing ----------------------------- */
function parseArgs(argv) {
  const opts = {
    server: 'pool.ntp.org',
    port: 123,
    version: 4,
    samples: 1,
    timeout: 3000,
    json: false,
    setHint: false,
    demo: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--server': opts.server = argv[++i]; break;
      case '--port': opts.port = parseInt(argv[++i], 10); break;
      case '--version': opts.version = parseInt(argv[++i], 10); break;
      case '--samples': opts.samples = Math.max(1, parseInt(argv[++i], 10) || 1); break;
      case '--timeout': opts.timeout = parseInt(argv[++i], 10); break;
      case '--json': opts.json = true; break;
      case '--set-hint': opts.setHint = true; break;
      case '--demo': opts.demo = true; break;
      case '-h': case '--help': opts.help = true; break;
      default:
        if (a.startsWith('--')) { console.error(`unknown option: ${a}`); process.exit(2); }
        rest.push(a);
    }
  }
  if (rest.length) opts.server = rest[0]; // positional server overrides default
  return opts;
}

const HELP = `get atomic time from an internet clock (NTP / RFC 5905)

  node ntp-node.js [server] [options]

  --server HOST   NTP server (default pool.ntp.org)
  --port N        UDP port (default 123)
  --version N     NTP version 3 or 4 (default 4)
  --samples N     take N samples, keep the lowest-delay one
  --timeout MS    per-request timeout (default 3000)
  --json          machine-readable output
  --set-hint      also print a 'date' command for the correction
  --demo          offline: solve a canned exchange, no socket
`;

/* --------------------------- one UDP exchange --------------------------- */
/**
 * Send one NTP request and resolve with the parsed reply plus the precise T4.
 * T1 (transmit) is stamped the instant before send; T4 (destination) the instant
 * the datagram arrives. Both are read from the SAME local clock, so the offset
 * math is internally consistent even if that clock is wrong — which is the point.
 */
function queryOnce(server, port, version, timeoutMs) {
  const dgram = require('dgram');
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch (_) { /* already closing */ }
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);

    socket.on('error', (e) => finish(e));
    socket.on('message', (msg) => {
      const t4 = Date.now();
      try {
        const reply = core.parseReplyPacket(msg, t4);
        finish(null, reply);
      } catch (e) { finish(e); }
    });

    const t1 = Date.now();
    const packet = core.buildRequestPacket(t1, version);
    socket.send(packet, 0, packet.length, port, server, (e) => {
      if (e) finish(e);
    });
  });
}

/* --------------------------- formatting --------------------------- */
function fmtMs(ms) {
  const sign = ms >= 0 ? '+' : '-';
  const a = Math.abs(ms);
  if (a < 1) return `${sign}${(a * 1000).toFixed(1)} µs`;
  if (a < 1000) return `${sign}${a.toFixed(3)} ms`;
  return `${sign}${(a / 1000).toFixed(3)} s`;
}

function isoWithMs(ms) {
  return new Date(Math.round(ms)).toISOString();
}

function printHuman(opts, reply, solved, usable) {
  console.log(`server         : ${opts.server}:${opts.port}  (NTP v${reply.version})`);
  console.log(`stratum        : ${reply.stratum} — ${reply.stratumText}`);
  console.log(`reference      : ${reply.refIdText}`);
  console.log(`leap indicator : ${reply.leapIndicator} (${reply.leapText})`);
  console.log(`precision      : 2^${reply.precision} s ≈ ${fmtMs(reply.precisionSeconds * 1000)}`);
  console.log('');
  console.log('four-timestamp exchange');
  console.log(`  T1 client tx : ${isoWithMs(solved.t1)}`);
  console.log(`  T2 srv  rx   : ${isoWithMs(solved.t2)}`);
  console.log(`  T3 srv  tx   : ${isoWithMs(solved.t3)}`);
  console.log(`  T4 client rx : ${isoWithMs(solved.t4)}`);
  console.log('');
  console.log(`round-trip δ   : ${fmtMs(solved.delayMs)}`);
  console.log(`clock offset θ : ${fmtMs(solved.offsetMs)}   (local clock is ${solved.offsetMs >= 0 ? 'behind' : 'ahead of'} the server)`);
  console.log('');
  console.log(`true time now  : ${isoWithMs(solved.correctedNowMs)}   ← T4 + θ`);
  console.log(`naive answer   : ${isoWithMs(solved.naiveNowMs)}   (just trust the server's T3)`);
  console.log(`naive is off by: ${fmtMs(solved.naiveErrorMs)}   — the reply's travel time it forgot to add`);
  if (!usable.ok) {
    console.log('');
    console.log(`⚠ reply is NOT usable: ${usable.reasons.join('; ')}`);
  }
  if (opts.setHint) {
    const corr = solved.offsetMs;
    console.log('');
    console.log('# to step the system clock by the measured offset (needs root):');
    console.log(`#   sudo date -s @${(solved.correctedNowMs / 1000).toFixed(3)}`);
    console.log(`# (offset ${fmtMs(corr)})`);
  }
}

/* ------------------------------ demo ------------------------------ */
// A canned exchange with a deliberately ASYMMETRIC-looking-but-symmetric trip,
// so the naive error is visible and the numbers are checkable by hand.
// Local clock here is 200 ms BEHIND the server; round trip is 100 ms.
function demoExchange() {
  // Pick a fixed wall time so output is reproducible.
  const serverBase = Date.UTC(2026, 10, 10, 12, 0, 0); // 2026-11-10T12:00:00Z
  // Local clock reads 200ms less than reality.
  const skew = -200;
  const t1 = serverBase + skew + 0;        // client sends (local clock)
  const t2 = serverBase + 50;              // 50ms later, server receives (true)
  const t3 = serverBase + 60;              // server spends 10ms, then replies
  const t4 = serverBase + skew + 110;      // 50ms return trip, client receives (local)
  // Build a reply packet carrying T1(orig), T2(rx), T3(tx), then parse it with T4,
  // exercising the real packet path rather than hand-feeding solveExchange.
  const buf = new Uint8Array(core.NTP_PACKET_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint8(0, (0 << 6) | (4 << 3) | 4); // LI0, v4, mode 4 (server)
  view.setUint8(1, 1); // stratum 1
  view.setInt8(3, -20); // precision ~1µs
  // reference id "DEMO"
  view.setUint32(12, 0x44454d4f, false);
  const put = (off, ms) => {
    const { seconds, fraction } = core.unixMsToNtp(ms);
    view.setUint32(off, seconds, false);
    view.setUint32(off + 4, fraction, false);
  };
  put(16, serverBase - 1000); // reference timestamp
  put(24, t1); // originate (echo of client transmit)
  put(32, t2); // receive
  put(40, t3); // transmit
  const reply = core.parseReplyPacket(buf, t4);
  return reply;
}

/* ------------------------------ main ------------------------------ */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP); return; }

  if (opts.demo) {
    const reply = demoExchange();
    const solved = core.solveExchange(reply);
    const usable = core.isReplyUsable(reply);
    opts.server = '(demo, no network)';
    opts.port = 123;
    if (opts.json) {
      console.log(JSON.stringify({ reply, solved, usable }, null, 2));
    } else {
      printHuman(opts, reply, solved, usable);
    }
    return;
  }

  // Take N samples; keep the one with the lowest round-trip delay, which is the
  // most trustworthy (least queuing jitter). This is NTP's clock-filter idea in
  // miniature.
  let best = null;
  const errors = [];
  for (let i = 0; i < opts.samples; i++) {
    try {
      const reply = await queryOnce(opts.server, opts.port, opts.version, opts.timeout);
      const solved = core.solveExchange(reply);
      if (!best || solved.delayMs < best.solved.delayMs) best = { reply, solved };
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (!best) {
    console.error(`could not reach ${opts.server}:${opts.port} over UDP.`);
    if (errors.length) console.error('  ' + errors.join('\n  '));
    console.error('\n(NTP is UDP/123 and is often blocked on restricted networks.');
    console.error(' Try `node ntp-node.js --demo` to see the arithmetic offline.)');
    process.exitCode = 1;
    return;
  }

  const usable = core.isReplyUsable(best.reply);
  if (opts.json) {
    console.log(JSON.stringify({
      server: opts.server, port: opts.port, samples: opts.samples,
      reply: best.reply, solved: best.solved, usable,
    }, null, 2));
  } else {
    printHuman(opts, best.reply, best.solved, usable);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { parseArgs, queryOnce, demoExchange, fmtMs };
