/*
 * script.js — browser glue for the Bandwidth Monitor.
 *
 * It owns no protocol logic. Its whole job is to (a) produce a *cumulative*
 * byte counter from one of several sources, (b) hand it to the engine in
 * bandwidth-core.js on a fixed tick, and (c) paint the result. Three sources
 * are simulated (steady / bursty / a deliberately 32-bit-wrapping counter) and
 * one is REAL — the bytes this very page has downloaded, read out of the
 * Resource Timing API.
 */
'use strict';

// Wrapped in an IIFE so our local bindings (BandwidthMonitor, etc.) stay
// function-scoped and don't collide with the same-named classes that
// bandwidth-core.js declares in the global scope of its own <script>.
(function () {

const {
  BandwidthMonitor, MOD32, formatBytes, formatRate,
} = window.BandwidthCore;

const TICK_MS = 1000;
const RING = 120;

const $ = (id) => document.getElementById(id);
const el = {
  rxRate: $('rx-rate'), txRate: $('tx-rate'),
  rxAvg: $('rx-avg'), txAvg: $('tx-avg'),
  rxPeak: $('rx-peak'), txPeak: $('tx-peak'),
  sessionTotal: $('session-total'), sampleCount: $('sample-count'),
  chart: $('chart'), unitBits: $('unit-bits'), source: $('source'),
  run: $('btn-run'), reset: $('btn-reset'), seed: $('btn-seed'),
  days: $('days').querySelector('tbody'),
  ftRx: $('ft-rx'), ftTx: $('ft-tx'), ftTot: $('ft-tot'),
  daysEmpty: $('days-empty'), eventChip: $('event-chip'), windowSpan: $('window-span'),
};

/* ---------------------------------------------------------------- *
 * Sources — each returns a cumulative {rx, tx} counter and advances
 * its own internal state. The counter only ever grows (except the
 * wrap source, which rolls over 2^32 on purpose, and after a reset).
 * ---------------------------------------------------------------- */
function makeSteadySource() {
  let rx = 0, tx = 0;
  return {
    modulus: null,
    next() { rx += 900_000 + Math.random() * 120_000; tx += 90_000 + Math.random() * 30_000;
             return { rx: Math.floor(rx), tx: Math.floor(tx) }; },
  };
}
function makeBurstySource() {
  let rx = 0, tx = 0, burst = 0;
  return {
    modulus: null,
    next() {
      if (burst <= 0 && Math.random() < 0.25) burst = 2 + Math.floor(Math.random() * 4);
      const hot = burst > 0;
      if (hot) burst--;
      rx += hot ? 3_500_000 + Math.random() * 3_000_000 : 120_000 + Math.random() * 400_000;
      tx += hot ? 500_000 + Math.random() * 400_000 : 40_000 + Math.random() * 120_000;
      return { rx: Math.floor(rx), tx: Math.floor(tx) };
    },
  };
}
function makeWrapSource() {
  // A 32-bit counter started just below rollover, so a wrap happens within a
  // few ticks — the engine must recognise it instead of reporting a spike.
  const MOD = Number(MOD32);
  let rx = MOD - 4_000_000, tx = MOD - 800_000;
  return {
    modulus: MOD32,
    next() {
      rx = (rx + 1_400_000 + Math.random() * 600_000) % MOD;
      tx = (tx + 260_000 + Math.random() * 140_000) % MOD;
      return { rx: Math.floor(rx), tx: Math.floor(tx) };
    },
  };
}
function makeRealSource() {
  // The honest one: cumulative bytes this page actually pulled over the network,
  // from the Resource Timing API. Upload bytes are NOT observable in a browser,
  // so tx stays 0 — we don't invent it. Each tick we cache-bust a small
  // same-origin fetch so there is real, fresh traffic to measure.
  function totalRx() {
    let sum = 0;
    try {
      for (const e of performance.getEntriesByType('resource')) {
        sum += e.transferSize || e.encodedBodySize || e.decodedBodySize || 0;
      }
    } catch { /* Resource Timing unavailable (e.g. file://) — report 0 honestly */ }
    return sum;
  }
  return {
    modulus: null,
    async warmup() {},
    next() {
      // fire-and-forget real traffic; the counter picks it up on later ticks
      try { fetch(`bandwidth-core.js?_=${Date.now()}`, { cache: 'no-store' }).catch(() => {}); } catch {}
      return { rx: Math.floor(totalRx()), tx: 0 };
    },
  };
}
const SOURCES = {
  'sim-steady': makeSteadySource,
  'sim-bursty': makeBurstySource,
  'sim-wrap': makeWrapSource,
  'real': makeRealSource,
};

/* ---------------------------------------------------------------- *
 * Runtime state
 * ---------------------------------------------------------------- */
let source, monitor, timer = null, running = true;
let sessionRx = 0, sessionTx = 0;
const eventMarks = []; // {i, kind} relative to ring index, for chart ticks

function build() {
  const make = SOURCES[el.source.value];
  source = make();
  monitor = new BandwidthMonitor({ modulus: source.modulus, retainDays: 30, ringSize: RING });
  sessionRx = sessionTx = 0;
  eventMarks.length = 0;
  monitor.sample(Date.now(), source.next()); // baseline (wall-clock, for day bucketing)
}

function tick() {
  const now = Date.now(); // wall-clock: rate uses only the delta, the ledger needs real days
  const s = monitor.sample(now, source.next());
  if (!s) return;
  sessionRx += s.rxBytes; sessionTx += s.txBytes;
  if (s.reset) noteEvent('reset');
  else if (s.wrapped) noteEvent('wrap');
  render(s);
}

function noteEvent(kind) {
  eventMarks.push({ i: monitor.rxRing.length - 1, kind });
  el.eventChip.hidden = false;
  el.eventChip.textContent = kind === 'reset' ? '⟲ counter reset handled' : '↻ counter wrap handled';
}

/* ---------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------- */
function fmtRate(v) { return formatRate(v, { bits: el.unitBits.checked }); }

function render(s) {
  el.rxRate.textContent = fmtRate(s.rxRate);
  el.txRate.textContent = fmtRate(s.txRate);

  const rxArr = monitor.rxRing.toArray();
  const txArr = monitor.txRing.toArray();
  el.rxAvg.textContent = 'avg ' + fmtRate(BandwidthMonitor.ringAverage(rxArr));
  el.txAvg.textContent = 'avg ' + fmtRate(BandwidthMonitor.ringAverage(txArr));

  const today = monitor.ledger.days().slice(-1)[0];
  el.rxPeak.textContent = 'peak ' + fmtRate(today ? today.rxPeak : 0);
  el.txPeak.textContent = 'peak ' + fmtRate(today ? today.txPeak : 0);

  el.sessionTotal.textContent = '▼ ' + formatBytes(sessionRx) + '  ▲ ' + formatBytes(sessionTx);
  el.sampleCount.textContent = monitor.sampleCount + ' samples';

  drawChart(rxArr, txArr);
  renderDays();
}

function drawChart(rx, tx) {
  const W = 800, H = 220, pad = 6;
  const n = Math.max(rx.length, tx.length);
  const defined = [...rx, ...tx].filter((v) => typeof v === 'number' && Number.isFinite(v));
  const max = Math.max(1, ...defined) * 1.15;
  const x = (i) => pad + (i / Math.max(1, RING - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v == null || !Number.isFinite(v) ? 0 : v) / max) * (H - 2 * pad);

  const line = (arr, cls) => {
    let d = '', pen = false;
    arr.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; } // break the line across unknown-rate gaps
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d ? `<path class="${cls}" d="${d.trim()}" fill="none" stroke-width="2" />` : '';
  };

  // gridlines at 25/50/75%
  let grid = '';
  for (const f of [0.25, 0.5, 0.75]) {
    const gy = (pad + f * (H - 2 * pad)).toFixed(1);
    grid += `<line x1="${pad}" y1="${gy}" x2="${W - pad}" y2="${gy}" stroke="#2b3550" stroke-width="1" />`;
  }
  // event markers (reset/wrap)
  let marks = '';
  for (const m of eventMarks) {
    if (m.i < 0 || m.i >= n) continue;
    const mx = x(m.i).toFixed(1);
    marks += `<line x1="${mx}" y1="${pad}" x2="${mx}" y2="${H - pad}" stroke="#f5b942" stroke-width="1" stroke-dasharray="3 3" opacity="0.7" />`;
  }
  const scaleLabel = `<text x="${pad + 4}" y="${pad + 14}" fill="#97a2ba" font-size="11">${fmtRate(max / 1.15)} full-scale</text>`;

  el.chart.innerHTML =
    grid + marks +
    line(tx, 'tx-line') + line(rx, 'rx-line') +
    scaleLabel;
}
// inline stroke colours so the SVG needs no extra stylesheet rules
const chartStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
chartStyle.textContent = '.rx-line{stroke:#46d17f}.tx-line{stroke:#b48cf0}';
el.chart.appendChild(chartStyle);

function renderDays() {
  const days = monitor.ledger.days();
  const todayKey = new Date().toISOString().slice(0, 10);
  el.daysEmpty.hidden = days.length > 0;
  el.days.innerHTML = days.map((d) => {
    const tot = d.rxBytes + d.txBytes;
    const cls = d.key === todayKey ? ' class="today"' : '';
    return `<tr${cls}><td>${d.key}</td><td>${formatBytes(d.rxBytes)}</td>` +
           `<td>${formatBytes(d.txBytes)}</td><td>${formatBytes(tot)}</td>` +
           `<td>${fmtRate(d.rxPeak)}</td></tr>`;
  }).join('');
  const t = monitor.ledger.totals();
  el.ftRx.textContent = formatBytes(t.rxBytes);
  el.ftTx.textContent = formatBytes(t.txBytes);
  el.ftTot.textContent = formatBytes(t.totalBytes);
}

/* ---------------------------------------------------------------- *
 * Controls
 * ---------------------------------------------------------------- */
function setRunning(on) {
  running = on;
  el.run.textContent = on ? '⏸ Pause' : '▶ Resume';
  if (on && !timer) timer = setInterval(tick, TICK_MS);
  if (!on && timer) { clearInterval(timer); timer = null; }
}

el.run.addEventListener('click', () => setRunning(!running));
el.reset.addEventListener('click', () => { build(); el.chart.innerHTML = ''; el.chart.appendChild(chartStyle); renderDays(); });
el.source.addEventListener('change', () => { build(); });
el.unitBits.addEventListener('change', () => { if (monitor.rxSampler.last) render({ rxRate: monitor.rxSampler.last.rate, txRate: monitor.txSampler.last.rate, rxBytes: 0, txBytes: 0 }); });

// Seed a few days of plausible history so the "over several days" table is
// populated without waiting a week. Uses the ledger's injectable day key via a
// temporary monitor whose clock we fast-forward one day per step.
el.seed.addEventListener('click', () => {
  const dayMs = 86_400_000;
  const base = Date.now() - 5 * dayMs;
  for (let d = 0; d < 5; d++) {
    const ts = base + d * dayMs;
    const rx = (2 + Math.random() * 8) * 1e9;   // 2–10 GB/day
    const tx = (0.2 + Math.random() * 1) * 1e9;
    monitor.ledger.record(ts, {
      rxBytes: Math.floor(rx), txBytes: Math.floor(tx),
      rxRate: (5 + Math.random() * 40) * 1e6, txRate: (1 + Math.random() * 6) * 1e6,
    });
  }
  renderDays();
});

/* ---------------------------------------------------------------- */
build();
renderDays();
setRunning(true);

})();
