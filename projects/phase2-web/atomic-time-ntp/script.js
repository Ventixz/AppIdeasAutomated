/*
 * script.js — the browser demo for the NTP project.
 *
 * A browser can't open a UDP socket, so this does two things that need no
 * network and lean entirely on ntp-core.js (the same engine the Node client and
 * the tests use):
 *
 *   1. Simulates one request/reply exchange from sliders you control (clock
 *      skew, each-way delay, server processing) and draws the four timestamps,
 *      then runs the REAL offset/delay arithmetic on them.
 *   2. Decodes raw 48-byte NTP reply bytes you paste as hex.
 *
 * Everything numeric comes from window.NtpCore so the page can never disagree
 * with the server or the tests.
 */
'use strict';

const C = window.NtpCore;
const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

/* A fixed reference wall-clock for reproducibility. "True" time at T1. */
const TRUE_BASE = Date.UTC(2026, 10, 10, 12, 0, 0); // 2026-11-10T12:00:00Z

/* ---------- formatting ---------- */
function fmtMs(ms) {
  const sign = ms >= 0 ? '+' : '−'; // proper minus sign
  const a = Math.abs(ms);
  if (a < 1) return `${sign}${(a * 1000).toFixed(1)} µs`;
  if (a < 1000) return `${sign}${a.toFixed(1)} ms`;
  return `${sign}${(a / 1000).toFixed(3)} s`;
}
function clockTime(ms) {
  // HH:MM:SS.mmm of the given instant (UTC).
  return new Date(Math.round(ms)).toISOString().slice(11, 23);
}

/* ---------- the simulation ---------- *
 * We model wall time as "ms since TRUE_BASE". The server's clock reads true
 * time. The client's clock reads true + skew. Build the four timestamps on the
 * clock that actually measures each event, then hand them to ntp-core exactly as
 * a real exchange would.
 */
function simulate() {
  const skew = parseInt($('skew').value, 10);   // client clock error (ms)
  const out = parseInt($('out').value, 10);     // request travel time
  const back = parseInt($('back').value, 10);   // reply travel time
  const proc = parseInt($('proc').value, 10);   // server processing time

  // True timeline (ms from TRUE_BASE):
  //   t=0            client sends            -> T1 on client clock
  //   t=out          server receives         -> T2 on server clock
  //   t=out+proc     server replies          -> T3 on server clock
  //   t=out+proc+back client receives        -> T4 on client clock
  const T1 = TRUE_BASE + 0 + skew;              // client clock
  const T2 = TRUE_BASE + out;                   // server clock (true)
  const T3 = TRUE_BASE + out + proc;            // server clock (true)
  const T4 = TRUE_BASE + out + proc + back + skew; // client clock

  const reply = {
    originateTimeMs: T1, receiveTimeMs: T2,
    transmitTimeMs: T3, destinationTimeMs: T4,
  };
  const solved = C.solveExchange(reply);
  // The genuinely-true time at the moment of reception, for scoring accuracy:
  const trueNowAtT4 = TRUE_BASE + out + proc + back;
  return { skew, out, back, proc, solved, trueNowAtT4 };
}

/* ---------- diagram ---------- */
function drawDiagram(sim) {
  const svg = $('diagram');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const W = 640, H = 260;
  const clientY = 46, serverY = 214;
  const xL = 70, xR = 570;

  const el = (name, attrs, text) => {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    svg.appendChild(n);
    return n;
  };

  // lanes
  el('line', { x1: xL, y1: clientY, x2: xR, y2: clientY, stroke: 'var(--client)', 'stroke-width': 2, opacity: 0.5 });
  el('line', { x1: xL, y1: serverY, x2: xR, y2: serverY, stroke: 'var(--server)', 'stroke-width': 2, opacity: 0.5 });
  el('text', { x: xL - 8, y: clientY + 4, 'text-anchor': 'end', class: 'tssub', fill: 'var(--client)' }, 'client');
  el('text', { x: xL - 8, y: serverY + 4, 'text-anchor': 'end', class: 'tssub', fill: 'var(--server)' }, 'server');

  // Map true-time (0 .. total) to x. Total trip spans xL..xR.
  const total = sim.out + sim.proc + sim.back || 1;
  const xAt = (trueT) => xL + (trueT / total) * (xR - xL);

  const tT1 = 0, tT2 = sim.out, tT3 = sim.out + sim.proc, tT4 = sim.out + sim.proc + sim.back;

  // request arrow (client -> server), reply arrow (server -> client)
  const arrow = (x1, y1, x2, y2, color) => {
    el('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 2.5, 'marker-end': 'url(#ah)' });
  };
  // marker def
  const defs = el('defs', {});
  const marker = document.createElementNS(SVGNS, 'marker');
  marker.setAttribute('id', 'ah'); marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '8'); marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6'); marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const mp = document.createElementNS(SVGNS, 'path');
  mp.setAttribute('d', 'M0,0 L10,5 L0,10 z'); mp.setAttribute('fill', 'var(--accent)');
  marker.appendChild(mp); defs.appendChild(marker);

  arrow(xAt(tT1), clientY + 6, xAt(tT2), serverY - 6, 'var(--accent)');
  arrow(xAt(tT3), serverY - 6, xAt(tT4), clientY + 6, 'var(--accent-2)');

  // server processing bar
  if (sim.proc > 0) {
    el('line', { x1: xAt(tT2), y1: serverY, x2: xAt(tT3), y2: serverY, stroke: 'var(--server)', 'stroke-width': 6, opacity: 0.9, 'stroke-linecap': 'round' });
  }

  // timestamp dots + labels
  const dot = (x, y, label, sub, color, above, extraDown) => {
    extraDown = extraDown || 0;
    el('circle', { cx: x, cy: y, r: 5, fill: color, stroke: '#07101f', 'stroke-width': 1.5 });
    const ly = (above ? y - 14 : y + 20) + (above ? 0 : extraDown);
    el('text', { x, y: ly, 'text-anchor': 'middle', class: 'tslabel', fill: color }, label);
    el('text', { x, y: ly + (above ? -13 : 13), 'text-anchor': 'middle', class: 'tssub' }, sub);
  };
  const s = sim.solved;
  // T2 and T3 sit close together on the server lane when processing time is
  // small; stagger T3's labels one row lower so the timestamps never collide.
  dot(xAt(tT1), clientY, 'T1', clockTime(s.t1), 'var(--client)', true);
  dot(xAt(tT2), serverY, 'T2', clockTime(s.t2), 'var(--server)', false, 0);
  dot(xAt(tT3), serverY, 'T3', clockTime(s.t3), 'var(--server)', false, 26);
  dot(xAt(tT4), clientY, 'T4', clockTime(s.t4), 'var(--client)', true);

  // mid labels for the two legs
  el('text', { x: (xAt(tT1) + xAt(tT2)) / 2, y: (clientY + serverY) / 2 - 6, 'text-anchor': 'middle', class: 'tssub', fill: 'var(--accent)' }, `out ${sim.out}ms`);
  el('text', { x: (xAt(tT3) + xAt(tT4)) / 2, y: (clientY + serverY) / 2 + 12, 'text-anchor': 'middle', class: 'tssub', fill: 'var(--accent-2)' }, `back ${sim.back}ms`);
}

/* ---------- results cards ---------- */
function renderResults(sim) {
  const s = sim.solved;
  const naiveErr = s.naiveNowMs - sim.trueNowAtT4;       // how wrong "trust T3" is
  const ntpErr = s.correctedNowMs - sim.trueNowAtT4;     // how wrong NTP is
  const asym = sim.back - sim.out;                       // path asymmetry

  const results = $('results');
  results.innerHTML = `
    <div class="cards">
      <div class="card offset">
        <h3>Clock offset  θ</h3>
        <div class="big">${fmtMs(s.offsetMs)}</div>
        <div class="sub">your clock is ${s.offsetMs >= 0 ? 'behind' : 'ahead of'} the server</div>
        <div class="formula">θ = ((T2−T1) + (T3−T4)) / 2</div>
      </div>
      <div class="card delay">
        <h3>Round-trip delay  δ</h3>
        <div class="big">${fmtMs(s.delayMs)}</div>
        <div class="sub">time on the wire, both ways</div>
        <div class="formula">δ = (T4−T1) − (T3−T2)</div>
      </div>
      <div class="card bad">
        <h3>Naive: just trust the server's T3</h3>
        <div class="big warn">${fmtMs(naiveErr)}</div>
        <div class="sub">error vs. true time — it forgot the reply's ${sim.back}ms trip home</div>
      </div>
      <div class="card good">
        <h3>NTP: corrected time = T4 + θ</h3>
        <div class="big ok">${fmtMs(ntpErr)}</div>
        <div class="sub">error vs. true time${Math.abs(asym) > 0.5 ? ` — residual is half the ${Math.abs(asym)}ms path asymmetry` : ' — exact on a symmetric path'}</div>
      </div>
    </div>
    <div class="verdict">
      ${verdictText(sim, naiveErr, ntpErr, asym)}
    </div>
  `;
}

function verdictText(sim, naiveErr, ntpErr, asym) {
  const improve = Math.abs(naiveErr) - Math.abs(ntpErr);
  if (Math.abs(asym) <= 0.5) {
    return `On a <strong>symmetric</strong> path NTP is <span class="hl">exact</span>:
      it recovers your clock's ${fmtMs(sim.solved.offsetMs)} offset perfectly, even though
      your clock itself is wrong by that much. Trusting the server's transmit timestamp
      instead leaves you <span class="hl">${fmtMs(naiveErr)}</span> off — precisely the
      time the reply spent travelling back to you.`;
  }
  return `The path is <strong>asymmetric</strong> (back − out = ${fmtMs(asym)}), the one
    thing NTP can't see. Its answer is off by <span class="hl">${fmtMs(ntpErr)}</span> —
    about half the asymmetry — because the formula splits the round trip evenly. That's
    still <strong>${improve >= 0 ? fmtMs(improve) + ' better' : 'worse'}</strong> than the
    naive ${fmtMs(naiveErr)}. Symmetric routing is the assumption the whole protocol rests on.`;
}

/* ---------- live update ---------- */
function updateLabels() {
  $('skewVal').textContent = fmtMs(parseInt($('skew').value, 10));
  $('outVal').textContent = parseInt($('out').value, 10) + ' ms';
  $('backVal').textContent = parseInt($('back').value, 10) + ' ms';
  $('procVal').textContent = parseInt($('proc').value, 10) + ' ms';
}

function recompute() {
  updateLabels();
  const sim = simulate();
  $('clientClockNote').textContent = `clock error ${fmtMs(sim.skew)}`;
  drawDiagram(sim);
  renderResults(sim);
}

function wireControls() {
  const ids = ['skew', 'out', 'back', 'proc'];
  ids.forEach((id) => $(id).addEventListener('input', () => {
    if ($('symlock').checked && (id === 'out' || id === 'back')) {
      const v = $(id).value;
      $('out').value = v; $('back').value = v;
    }
    recompute();
  }));
  $('symlock').addEventListener('change', () => {
    if ($('symlock').checked) { $('back').value = $('out').value; recompute(); }
  });
  $('animate').addEventListener('click', animate);
}

/* A tiny "replay": sweep a pulse along each arrow. Pure eye candy, no logic. */
function animate() {
  recompute();
  const svg = $('diagram');
  const pulse = document.createElementNS(SVGNS, 'circle');
  pulse.setAttribute('r', '4'); pulse.setAttribute('fill', '#fff');
  svg.appendChild(pulse);
  const sim = simulate();
  const total = sim.out + sim.proc + sim.back || 1;
  const xL = 70, xR = 570, clientY = 46, serverY = 214;
  const xAt = (t) => xL + (t / total) * (xR - xL);
  const start = performance.now();
  const dur = 1400;
  function frame(now) {
    const p = Math.min(1, (now - start) / dur);
    const tt = p * total;
    let x, y;
    if (tt <= sim.out) { const k = tt / sim.out; x = xAt(0) + (xAt(sim.out) - xAt(0)) * k; y = clientY + (serverY - clientY) * k; }
    else if (tt <= sim.out + sim.proc) { x = xAt(tt); y = serverY; }
    else { const k = (tt - sim.out - sim.proc) / (sim.back || 1); x = xAt(sim.out + sim.proc) + (xAt(total) - xAt(sim.out + sim.proc)) * k; y = serverY + (clientY - serverY) * k; }
    pulse.setAttribute('cx', x); pulse.setAttribute('cy', y);
    if (p < 1) requestAnimationFrame(frame);
    else svg.removeChild(pulse);
  }
  requestAnimationFrame(frame);
}

/* ---------- packet decoder ---------- */
const SAMPLE_HEX =
  '24 02 06 ec 00 00 03 ff 00 00 03 7d 5d c5 1c 2b ' +
  'eb ce 92 00 00 00 00 00 eb ce 92 00 00 00 00 00 ' +
  'eb ce 92 1a 00 00 00 00 eb ce 92 1b 40 00 00 00';

function hexToBytes(str) {
  const clean = str.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2 !== 0) throw new Error('odd number of hex digits');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function decodePacket() {
  const outEl = $('decodeOut');
  try {
    const bytes = hexToBytes($('hexIn').value);
    if (bytes.length < 48) throw new Error(`got ${bytes.length} bytes, need 48`);
    const r = C.parseReplyPacket(bytes.subarray(0, 48), Date.now());
    const usable = C.isReplyUsable(r);
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const ts = (ms) => ms == null ? '<span class="err">zero</span>' : new Date(Math.round(ms)).toISOString();
    outEl.innerHTML = `
      <dl class="kv">
        ${row('leap', `${r.leapIndicator} — ${r.leapText}`)}
        ${row('version', r.version)}
        ${row('mode', `${r.mode} — ${r.modeText}`)}
        ${row('stratum', `${r.stratum} — ${r.stratumText}`)}
        ${row('reference id', r.refIdText)}
        ${row('precision', `2^${r.precision} s`)}
        ${row('root delay', (r.rootDelay * 1000).toFixed(2) + ' ms')}
        ${row('root dispersion', (r.rootDispersion * 1000).toFixed(2) + ' ms')}
        ${row('reference ts', ts(r.referenceTimeMs))}
        ${row('transmit ts (T3)', ts(r.transmitTimeMs))}
      </dl>
      <p class="${usable.ok ? '' : 'err'}" style="margin-top:10px">
        ${usable.ok ? '✓ reply passes the RFC 5905 §8 sanity gate.' : '✗ not usable: ' + usable.reasons.join('; ')}
      </p>`;
  } catch (e) {
    outEl.innerHTML = `<p class="err">✗ ${e.message}</p>`;
  }
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  wireControls();
  $('hexIn').value = SAMPLE_HEX;
  $('decodeBtn').addEventListener('click', decodePacket);
  recompute();
});
