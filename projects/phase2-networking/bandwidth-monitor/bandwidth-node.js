/*
 * bandwidth-node.js — bind the engine to a REAL network interface under Node.
 *
 * The browser demo feeds the engine a simulated (but honestly cumulative)
 * counter. This module proves the same engine works against genuine hardware
 * counters: on Linux it reads /proc/net/dev — the kernel's own per-interface
 * byte totals — and samples them on an interval exactly as a real `vnstat`-style
 * monitor would.
 *
 * It degrades honestly: off Linux (no /proc/net/dev) `readInterfaces()` throws a
 * clear error rather than pretending, so the tests skip the live read when the
 * file is absent instead of faking a pass.
 */
'use strict';

const fs = require('fs');
const { parseProcNetDev, BandwidthMonitor, RateSampler } = require('./bandwidth-core.js');

const PROC_PATH = '/proc/net/dev';

/** True if this host exposes Linux interface counters. */
function hasProcNetDev() {
  try { return fs.existsSync(PROC_PATH); } catch { return false; }
}

/** Read and parse the kernel counters right now. Throws off Linux. */
function readInterfaces(path = PROC_PATH) {
  const text = fs.readFileSync(path, 'utf8');   // throws ENOENT off Linux — by design
  return parseProcNetDev(text);
}

/**
 * Pick a sensible default interface: the first non-loopback one that has seen
 * any traffic, falling back to the first interface, falling back to 'lo'.
 */
function pickInterface(ifaces) {
  const names = Object.keys(ifaces);
  const active = names.find((n) => n !== 'lo' && ifaces[n].rxBytes + ifaces[n].txBytes > 0n);
  return active || names.find((n) => n !== 'lo') || names[0] || 'lo';
}

/**
 * Monitor a real interface for a while, sampling /proc/net/dev on an interval.
 * Node counters are 64-bit, so wrapping effectively never happens and a
 * decrease means a reset — hence modulus defaults to null here.
 *
 * @returns {Promise<{iface, samples:Array, monitor:BandwidthMonitor}>}
 */
function monitorInterface({ iface, intervalMs = 1000, durationMs = 5000,
                            path = PROC_PATH } = {}) {
  return new Promise((resolve, reject) => {
    let selected = iface;
    let monitor;
    const samples = [];
    let timer = null;
    const started = Date.now();

    function tick() {
      try {
        const now = Date.now();
        const ifaces = readInterfaces(path);
        if (!selected) selected = pickInterface(ifaces);
        const row = ifaces[selected];
        if (!row) throw new Error(`interface not found: ${selected}`);
        if (!monitor) monitor = new BandwidthMonitor({ modulus: null });
        const s = monitor.sample(now, { rx: row.rxBytes, tx: row.txBytes });
        if (s) samples.push(s);
        if (now - started >= durationMs) {
          clearInterval(timer);
          resolve({ iface: selected, samples, monitor });
        }
      } catch (err) {
        if (timer) clearInterval(timer);
        reject(err);
      }
    }

    timer = setInterval(tick, intervalMs);
    tick(); // take the baseline immediately
  });
}

module.exports = {
  PROC_PATH,
  hasProcNetDev,
  readInterfaces,
  pickInterface,
  monitorInterface,
  // re-exported for convenience in scripts
  RateSampler,
  BandwidthMonitor,
};
