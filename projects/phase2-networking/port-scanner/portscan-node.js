/*
 * portscan-node.js — binds the transport-agnostic engine in portscan-core.js to
 * *real* TCP sockets using Node's built-in `net` module (no third-party
 * packages). This is what proves the classifier isn't just talking to a
 * simulation: the integration tests start a real server on a loopback ephemeral
 * port and scan it (→ open), scan a port nothing is listening on (→ closed, via
 * a real ECONNREFUSED), and scan a non-routable address (→ filtered, via a real
 * timeout). Loopback / local only; it never reaches off the machine.
 *
 * The probe is deliberately a *connect* scan — the only kind an unprivileged
 * program can do (SYN/stealth scans need raw sockets and root). It opens a full
 * TCP connection and, the instant it succeeds, closes it again: we want the
 * verdict, not to hold the socket.
 */
'use strict';

const net = require('net');
const { PortScanner, parsePortSpec } = require('./portscan-core.js');

/**
 * A real TCP-connect probe.
 *
 * Contract (exactly what the core expects):
 *   - resolves when the connection completes          → core marks OPEN
 *   - rejects with err.code === 'ECONNREFUSED'         → core marks CLOSED
 *   - rejects with ETIMEDOUT / host-unreachable        → core marks FILTERED/ERROR
 *   - honours the AbortSignal: when the core's timeout fires it aborts, and we
 *     destroy the half-open socket so no descriptor leaks (→ core marks FILTERED)
 *
 * The core owns the timeout, so this probe sets none of its own; it just reacts.
 */
function tcpProbe(host, port, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;

    const cleanup = () => {
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // No resolve/reject: the core's timeout branch already won the race.
    };

    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      cleanup();            // we only wanted to know it opened
      resolve({ connected: true });
    });
    socket.once('error', (err) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      cleanup();
      reject(err);          // err.code drives the core's classification
    });
  });
}

/**
 * Convenience: scan a host with the real TCP probe.
 * @param {string} host
 * @param {string|number[]} ports  a port spec string or an array of ports
 * @param {object} [opts]          forwarded to PortScanner (timeoutMs, concurrency, onProgress)
 */
function scanHost(host, ports, opts = {}) {
  const portList = Array.isArray(ports) ? ports : parsePortSpec(String(ports));
  const scanner = new PortScanner({
    host,
    ports: portList,
    probe: tcpProbe,
    timeoutMs: opts.timeoutMs ?? 1500,
    concurrency: opts.concurrency ?? 64,
    onProgress: opts.onProgress,
  });
  return scanner.scan();
}

module.exports = { tcpProbe, scanHost, PortScanner };

/* ------------------------------------------------------------------ *
 * Tiny CLI so the module is runnable by hand:
 *   node portscan-node.js <host> <ports> [timeoutMs] [concurrency]
 *   node portscan-node.js scanme.nmap.org 22,80,443 1500 64
 * (Only scan hosts you are authorised to scan.)
 * ------------------------------------------------------------------ */
if (require.main === module) {
  const [host = '127.0.0.1', spec = '1-1024', timeoutMs, concurrency] = process.argv.slice(2);
  scanHost(host, spec, {
    timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
    concurrency: concurrency ? Number(concurrency) : undefined,
  }).then(({ host: h, results, summary, elapsedMs }) => {
    console.log(`\nScan of ${h} — ${summary.total} ports in ${elapsedMs} ms\n`);
    for (const r of results) {
      if (r.state === 'closed' || r.state === 'skipped') continue; // show the interesting ones
      const svc = r.service ? ` ${r.service}` : '';
      console.log(`  ${String(r.port).padStart(5)}/tcp  ${r.state.padEnd(8)}${svc}  — ${r.reason}`);
    }
    const c = summary.counts;
    console.log(`\n  open ${c.open} · closed ${c.closed} · filtered ${c.filtered} · error ${c.error}\n`);
  }).catch((err) => {
    console.error('scan failed:', err.message);
    process.exit(1);
  });
}
