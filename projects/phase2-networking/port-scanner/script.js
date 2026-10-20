/*
 * script.js — browser glue for the Port Scanner demo.
 *
 * All the real work is in portscan-core.js (window.PortScan). This file only:
 *   - builds a simulated host profile from the dropdown,
 *   - wires the port-spec / timeout / concurrency inputs,
 *   - runs a PortScanner against the simulated probe, and
 *   - paints the progress bar, port-map heatmap, summary and results table as
 *     each port's verdict comes back.
 *
 * A browser cannot open an arbitrary TCP socket, so the probe here is simulated
 * — but it honours the exact same contract the real net-socket probe does, so
 * the scanner, timeout and classifier are the genuine article.
 */
'use strict';

const {
  parsePortSpec, PortScanner, makeSimulatedHost, serviceName, STATE,
} = window.PortScan;

const $ = (id) => document.getElementById(id);
const els = {
  host: $('host'), ports: $('ports'), timeout: $('timeout'),
  concurrency: $('concurrency'), scan: $('btn-scan'), cancel: $('btn-cancel'),
  err: $('err'), bar: $('bar'), progText: $('prog-text'), progTime: $('prog-time'),
  portmap: $('portmap'), results: $('results').querySelector('tbody'),
  resultsEmpty: $('results-empty'), resultNote: $('result-note'),
  onlyInteresting: $('only-interesting'),
  s: { open: $('s-open'), closed: $('s-closed'), filtered: $('s-filtered'), error: $('s-error') },
};

/* ---- simulated host profiles -------------------------------------------- *
 * Each returns a profile object for makeSimulatedHost. "filtered" ports never
 * answer, so the scanner's real timeout fires and classifies them FILTERED;
 * "closed" ports actively refuse (a simulated ECONNREFUSED); everything else
 * defaults to closed, like a reachable host with nothing else listening. */
const PROFILES = {
  web:    { open: [22, 80, 443], default: STATE.CLOSED },
  db:     { open: [22, 3306, 5432], filtered: [80, 8080, 143], default: STATE.CLOSED },
  locked: { open: [443], filtered: [22, 80, 110, 143, 3306, 5432, 8080, 53], default: STATE.FILTERED },
  dead:   { open: [], default: STATE.CLOSED },
};

let scanner = null;        // the in-flight PortScanner, if any
let cellByPort = null;     // Map<port, HTMLElement> for the heatmap

function setRunning(running) {
  els.scan.disabled = running;
  els.cancel.disabled = !running;
  for (const el of [els.host, els.ports, els.timeout, els.concurrency]) el.disabled = running;
}

function latency(ms) { return ms < 1 ? '<1 ms' : `${ms} ms`; }

function badge(state) {
  const b = document.createElement('span');
  b.className = `badge ${state}`;
  b.textContent = state;
  return b;
}

function renderRow(r) {
  const tr = document.createElement('tr');
  tr.dataset.state = r.state;
  if (els.onlyInteresting.checked && r.state === STATE.CLOSED) tr.hidden = true;

  const port = document.createElement('td');
  port.className = 'port';
  port.textContent = `${r.port}/tcp`;

  const st = document.createElement('td');
  st.appendChild(badge(r.state));

  const svc = document.createElement('td');
  svc.className = 'muted';
  svc.textContent = r.service || '—';

  const lat = document.createElement('td');
  lat.className = 'muted small';
  lat.textContent = r.state === STATE.SKIPPED ? '—' : latency(r.latencyMs);

  const detail = document.createElement('td');
  detail.className = 'muted small';
  detail.textContent = r.reason;

  tr.append(port, st, svc, lat, detail);
  return tr;
}

function applyFilter() {
  for (const tr of els.results.querySelectorAll('tr')) {
    tr.hidden = els.onlyInteresting.checked && tr.dataset.state === STATE.CLOSED;
  }
}

async function runScan() {
  els.err.textContent = '';
  let ports;
  try {
    ports = parsePortSpec(els.ports.value, { maxPorts: 2000 });
  } catch (e) {
    els.err.textContent = e.message;
    return;
  }
  const timeoutMs = Math.max(50, Number(els.timeout.value) || 600);
  const concurrency = Math.max(1, Number(els.concurrency.value) || 8);

  // Build the heatmap, one cell per port, in order.
  els.portmap.textContent = '';
  cellByPort = new Map();
  for (const p of ports) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.title = `${p}${serviceName(p) ? ' · ' + serviceName(p) : ''}`;
    els.portmap.appendChild(cell);
    cellByPort.set(p, cell);
  }

  // Reset table + summary.
  els.results.textContent = '';
  els.resultsEmpty.hidden = true;
  const counts = { open: 0, closed: 0, filtered: 0, error: 0 };
  for (const k of Object.keys(counts)) els.s[k].textContent = '0';
  els.resultNote.textContent = '';

  const probe = makeSimulatedHost({
    ...PROFILES[els.host.value],
    latencyMs: 15 + Math.floor(Math.random() * 25), // a little jitter, like a real link
  });

  scanner = new PortScanner({
    host: els.host.value, ports, probe, timeoutMs, concurrency,
    onProgress: (row, prog) => {
      const cell = cellByPort.get(row.port);
      if (cell) { cell.className = `cell ${row.state}`; }
      if (counts[row.state] !== undefined) {
        counts[row.state]++;
        els.s[row.state].textContent = String(counts[row.state]);
      }
      els.results.appendChild(renderRow(row));
      const pct = Math.round((prog.done / prog.total) * 100);
      els.bar.style.width = pct + '%';
      els.progText.textContent = `scanning… ${prog.done} / ${prog.total} ports`;
    },
  });

  setRunning(true);
  const started = performance.now();
  try {
    const { summary } = await scanner.scan();
    const elapsed = Math.round(performance.now() - started);
    els.progText.textContent =
      `done — ${summary.counts.open} open of ${summary.total} scanned`;
    els.progTime.textContent = `${elapsed} ms`;
    els.resultNote.textContent = summary.openPorts.length
      ? `open: ${summary.openPorts.join(', ')}`
      : 'no open ports found';
    if (summary.total === 0) els.resultsEmpty.hidden = false;
  } finally {
    setRunning(false);
    scanner = null;
  }
}

els.scan.addEventListener('click', runScan);
els.cancel.addEventListener('click', () => { if (scanner) scanner.cancel(); });
els.onlyInteresting.addEventListener('change', applyFilter);

// A first scan on load so the page isn't empty.
runScan();
