'use strict';
/*
 * script.js — the browser glue for "Scheduled Auto Login and Action".
 *
 * All logic (next-fire, backoff, session, redaction, the whole simulator) lives
 * in scheduler-core.js. This file only reads the controls, calls the core, and
 * paints the result. No network, no real clock — the simulation runs on the core's
 * virtual clock with a seeded RNG, so what you see here matches the Node --demo
 * and the test suite exactly.
 */
const C = window.SchedulerCore;
const $ = (id) => document.getElementById(id);

// A small seeded RNG (mulberry32) so a given simulation is reproducible.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Section 1 — the schedule simulator
// ---------------------------------------------------------------------------
function syncScheduleControls() {
  const kind = $('sched-kind').value;
  $('wrap-every').hidden = kind !== 'interval';
  $('wrap-weekday').hidden = kind !== 'weeklyAt';
  $('wrap-time').hidden = kind === 'interval';
}

function scheduleFromControls(startMs) {
  const kind = $('sched-kind').value;
  if (kind === 'interval') {
    return { kind: 'interval', everyMs: Number($('every').value), anchorMs: startMs };
  }
  const [h, m] = $('at-time').value.split(':').map(Number);
  if (kind === 'dailyAt') return { kind: 'dailyAt', hour: h, minute: m };
  return { kind: 'weeklyAt', weekday: Number($('weekday').value), hour: h, minute: m };
}

// Classify an event type into a colour class for the log.
function evClass(type) {
  if (type === 'fire') return 'fire';
  if (type.endsWith('-ok')) return 'ok';
  if (type === 'session-expired' || type.endsWith('-failed')) return 'warn';
  if (type === 'give-up' || type.endsWith('-rejected')) return 'bad';
  return '';
}

function runSimulation() {
  // Anchor the simulated window at a fixed wall-clock midnight so results are
  // stable and easy to read, in UTC (offset 0) for clean timestamps.
  const tz = 0;
  const start = C.wallToMs({ year: 2026, month: 10, day: 12, hour: 0, minute: 0 }, tz);
  const days = Number($('window').value);
  const end = start + days * C.MS.day - 1;
  const schedule = scheduleFromControls(start);
  const ttlMs = Number($('ttl').value);

  const flaky = $('flaky').value;
  const rng = makeRng(0xC0FFEE);
  let site;
  if (flaky === 'reject') {
    // Always-reject credentials: every fire gives up at login, no retry storm.
    site = { kind: 'reject', login: () => 'reject', action: () => 'ok' };
  } else {
    const p = Number(flaky);
    site = C.makeMockSite({ pLoginFail: p, pActionFail: p, pExpire: p / 2 }, rng);
  }

  let result;
  try {
    result = C.simulate({
      schedule, tzOffsetMinutes: tz, startMs: start, endMs: end,
      sessionTtlMs: ttlMs, site,
      backoff: { baseMs: 1000, factor: 2, maxMs: 60000, jitter: 'full' },
      maxAttempts: 5, rng,
    });
  } catch (err) {
    const logEl = $('sim-log');
    logEl.hidden = false;
    logEl.innerHTML = `<div class="row"><span class="ev bad">Error: ${err.message}</span></div>`;
    $('sim-stats').hidden = true;
    return;
  }

  const st = result.stats;
  const statsEl = $('sim-stats');
  statsEl.hidden = false;
  const cell = (n, k, cls) => `<div class="stat"><span class="n ${cls || ''}">${n}</span><span class="k">${k}</span></div>`;
  statsEl.innerHTML =
    cell(st.fires, 'fires') +
    cell(st.actionsOk, 'actions ok') +
    cell(st.logins, 'logins') +
    cell(st.reauths, 're-auths') +
    cell(st.failures, 'failures') +
    cell(st.givenUp, 'given up');

  const logEl = $('sim-log');
  logEl.hidden = false;
  logEl.innerHTML = result.log.map((ev) => {
    const p = C.wallParts(ev.timeMs, tz);
    const stamp = `${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
      `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
    const d = ev.detail || {};
    let extra = '';
    if (d.backoffMs != null) extra = `attempt ${d.attempt} · back off ${Math.round(d.backoffMs)}ms`;
    else if (d.status) extra = `session ${d.status}`;
    else if (d.stage) extra = `at ${d.stage}`;
    else if (d.expiresAtMs) {
      const e = C.wallParts(d.expiresAtMs, tz);
      extra = `expires ${String(e.hour).padStart(2, '0')}:${String(e.minute).padStart(2, '0')}`;
    }
    return `<div class="row"><span class="t">${stamp}</span>` +
      `<span class="ev ${evClass(ev.type)}">${ev.type}</span>` +
      `<span class="d">${extra}</span></div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Section 2 — the backoff visualizer
// ---------------------------------------------------------------------------
function drawBackoff() {
  const baseMs = Number($('b-base').value);
  const factor = Number($('b-factor').value);
  const maxMs = Number($('b-max').value);
  const jitter = $('b-jitter').value;
  $('b-base-out').textContent = baseMs + ' ms';
  $('b-factor-out').textContent = factor.toFixed(1) + '×';
  $('b-max-out').textContent = maxMs + ' ms';

  const opts = { baseMs, factor, maxMs, jitter };
  // The ideal (jitter-off) delay sets the bar length and the scale; the jittered
  // band shows the random range a real retry would land in.
  const rows = [];
  let scale = 1;
  for (let a = 1; a <= 7; a++) scale = Math.max(scale, C.backoffDelay(a, { ...opts, jitter: 'none' }));

  for (let a = 1; a <= 7; a++) {
    const ideal = C.backoffDelay(a, { ...opts, jitter: 'none' });
    // Low/high of the jitter band for this attempt.
    let lo = ideal, hi = ideal;
    if (jitter === 'full') { lo = 0; hi = ideal; }
    else if (jitter === 'equal') { lo = ideal / 2; hi = ideal; }
    const pctHi = (hi / scale) * 100;
    const pctLo = (lo / scale) * 100;
    const capped = ideal >= maxMs ? ' (capped)' : '';
    rows.push(
      `<div class="bar-row">` +
        `<span class="lab">attempt ${a}</span>` +
        `<div class="bar-track">` +
          `<div class="bar-fill" style="width:${pctLo}%"></div>` +
          (jitter !== 'none'
            ? `<div class="bar-fill jit" style="width:${pctHi}%"></div>`
            : '') +
          `<span class="bar-val">${Math.round(ideal)}ms${capped}</span>` +
        `</div>` +
      `</div>`
    );
  }
  $('backoff-bars').innerHTML = rows.join('');

  const notes = {
    none: 'No jitter: every client that failed at the same moment retries at the exact same moment — a synchronised spike. Useful only for reasoning about the ideal curve.',
    full: 'Full jitter: each retry waits a random time in [0, delay]. Spreads retries the most; expected wait is half the ideal. The striped band is the random range.',
    equal: 'Equal jitter: half fixed, half random — [delay/2, delay]. Keeps a guaranteed minimum spacing while still de-synchronising clients.',
  };
  $('backoff-note').textContent = notes[jitter];
}

// ---------------------------------------------------------------------------
// Section 3 — credential redaction
// ---------------------------------------------------------------------------
const SAMPLE_CONFIG = {
  url: 'https://example.test/login',
  username: 'scheduler-bot',
  password: 'hunter2-do-not-log-me',
  apiKey: 'sk-live-9f8e7d6c5b4a3210',
  schedule: { kind: 'dailyAt', hour: 9, minute: 0 },
  sessionCookie: 'sid=AbCdEf1234567890',
  retries: 5,
  note: 'this field is safe to log',
};

function drawRedaction() {
  const outEl = $('redact-out');
  let parsed;
  try {
    parsed = JSON.parse($('redact-in').value);
    outEl.classList.remove('err');
  } catch (err) {
    outEl.classList.add('err');
    outEl.textContent = 'Invalid JSON: ' + err.message;
    return;
  }
  const redacted = C.redactSecrets(parsed);
  // Render, highlighting the masked (***) parts so the eye jumps to them.
  const json = JSON.stringify(redacted, null, 2);
  outEl.innerHTML = json.replace(/("[^"]*\*\*\*[^"]*")/g, '<span class="mask">$1</span>');
}

// ---------------------------------------------------------------------------
// Wire-up
// ---------------------------------------------------------------------------
$('sched-kind').addEventListener('change', syncScheduleControls);
$('run-sim').addEventListener('click', runSimulation);

['b-base', 'b-factor', 'b-max', 'b-jitter'].forEach((id) =>
  $(id).addEventListener('input', drawBackoff));

$('redact-in').value = JSON.stringify(SAMPLE_CONFIG, null, 2);
$('redact-in').addEventListener('input', drawRedaction);

// First paint
syncScheduleControls();
runSimulation();
drawBackoff();
drawRedaction();
