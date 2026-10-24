/*
 * script.js — browser glue for the Site Checker demo.
 *
 * All the real work (scheduling, probe classification, confirmation debounce,
 * time-weighted uptime) lives in checker-core.js (window.SiteChecker). The data
 * is the scripted scenarios in checker-fixtures.js. This file only drives the
 * engine in SIMULATED time — a real setInterval ticks the clock forward by the
 * configured check interval — and renders the status, timeline, stats, incidents
 * and log. Nothing here knows how uptime is computed; it just asks the Monitor.
 */
'use strict';

(function () {
  const C = window.SiteChecker;
  const FX = window.SiteCheckerFixtures;

  const el = (id) => document.getElementById(id);
  const $scenario = el('scenario'), $interval = el('interval'), $confirm = el('confirm');
  const $start = el('start'), $pause = el('pause'), $step = el('step'), $reset = el('reset');
  const $status = el('status'), $dot = el('dot'), $vt = el('verdict-title'), $vs = el('verdict-sub');
  const $uptime = el('uptime'), $clock = el('clock'), $nextLabel = el('next-label'), $meter = el('meterfill');
  const $timeline = el('timeline'), $logbody = el('logbody'), $incidents = el('incidents');

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // Populate the scenario dropdown from the fixtures.
  for (const key of Object.keys(FX.SCRIPTS)) {
    const o = document.createElement('option');
    o.value = key; o.textContent = `${FX.SCRIPTS[key].label}  —  ${key}`;
    $scenario.appendChild(o);
  }

  const REAL_TICK_MS = 700; // wall-clock time between simulated checks
  let state = null, timer = null;

  function buildState() {
    const key = $scenario.value;
    const spec = FX.SCRIPTS[key];
    const intervalMs = Math.max(1, parseInt($interval.value, 10) || 60) * 1000;
    const confirmations = Math.max(1, parseInt($confirm.value, 10) || 1);
    return {
      key, spec,
      intervalMs, confirmations,
      probe: FX.scriptedProbe(spec.script),
      monitor: new C.Monitor({ confirmations }),
      schedule: C.createSchedule({ startAt: 0, intervalMs }),
      now: 0,
      firstTick: true,
      log: [], // {t, raw, reason, confirmed, ms, change}
    };
  }

  function fmtSimTime(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }

  // Advance simulated time by one interval and run whatever ticks come due.
  function tick() {
    if (!state) return;
    if (!state.firstTick) state.now += state.intervalMs;
    state.firstTick = false;

    const poll = state.schedule.poll(state.now);
    for (const tickAt of poll.fire) {
      const raw = state.probe();
      const cls = C.classify(raw, state.spec.rules);
      const res = state.monitor.push(tickAt, cls);
      state.log.unshift({
        t: tickAt, raw: cls.state, reason: cls.reason,
        confirmed: res.confirmedState, ms: cls.ms, change: res.changed,
      });
    }
    render();

    // Stop automatically once the script is spent and the last state is settled.
    if (state.probe.remaining() === 0) stop();
  }

  function render() {
    if (!state) return;
    const s = state.monitor.summary(state.now);

    // --- verdict ---
    const cur = s.current;
    $status.className = `panel status ${cur}`;
    const live = timer ? ' live' : '';
    const icon = cur === 'up' ? '🟢' : cur === 'down' ? '🔴' : '⏳';
    $dot.className = `dot${live}`;
    $dot.textContent = icon;
    $vt.textContent = cur === 'up' ? 'UP' : cur === 'down' ? 'DOWN' : 'Monitoring…';
    const last = state.log[0];
    if (cur === 'unknown') {
      $vs.textContent = state.log.length ? 'waiting for confirmation…' : 'running first check…';
    } else {
      $vs.innerHTML = `since <code>${fmtSimTime(s.currentSince)}</code> · ` +
        `last: ${esc(last ? last.reason : '—')}`;
    }
    $uptime.textContent = s.uptimePct == null ? '—' : `${s.uptimePct}%`;

    // --- next-check meter + sim clock ---
    $clock.innerHTML = `sim clock <code>${fmtSimTime(state.now)}</code>`;
    if (timer) {
      $nextLabel.textContent = `checking every ${state.intervalMs / 1000}s (simulated)`;
      // animate the meter across the real-time gap to the next tick
      $meter.style.transition = 'none'; $meter.style.width = '0%';
      requestAnimationFrame(() => {
        $meter.style.transition = `width ${REAL_TICK_MS}ms linear`;
        $meter.style.width = '100%';
      });
    } else {
      $nextLabel.textContent = 'paused';
      $meter.style.transition = 'none'; $meter.style.width = '0%';
    }

    // --- timeline (proportional segments) ---
    const segs = s.segments;
    const span = Math.max(1, s.totalMs);
    $timeline.innerHTML = segs.map((g) => {
      const pct = (g.ms / span) * 100;
      const title = `${g.state} · ${C.humanDuration(g.ms)} (${fmtSimTime(g.from)}–${fmtSimTime(g.to)})`;
      return `<span class="seg ${g.state}" style="width:${pct}%" title="${esc(title)}"></span>`;
    }).join('');

    // --- stats ---
    el('s-checks').textContent = s.checks;
    el('s-outages').textContent = s.outages;
    el('s-longest').textContent = s.longestOutageMs ? C.humanDuration(s.longestOutageMs) : '—';
    el('s-measured').textContent = s.measuredMs ? C.humanDuration(s.measuredMs) : '—';

    // --- incidents ---
    if (!s.incidents.length) {
      $incidents.innerHTML = '<p class="none">No outages yet.</p>';
    } else {
      $incidents.innerHTML = '<ul>' + s.incidents.map((inc) =>
        `<li class="${inc.ongoing ? 'ongoing' : ''}">` +
        `<span class="when">${fmtSimTime(inc.from)} → ${inc.ongoing ? 'ongoing' : fmtSimTime(inc.to)}</span>` +
        `<span class="dur">${C.humanDuration(inc.ms)}</span></li>`
      ).join('') + '</ul>';
    }

    // --- check log ---
    $logbody.innerHTML = state.log.slice(0, 60).map((r) =>
      `<tr class="${r.change ? 'change' : ''}">` +
      `<td>${fmtSimTime(r.t)}</td>` +
      `<td class="state-${r.raw}">${r.raw === 'up' ? '🟢 up' : '🔴 down'}</td>` +
      `<td>${esc(r.reason)}</td>` +
      `<td class="state-${r.confirmed}">${r.confirmed}${r.change ? ' ⟵' : ''}</td>` +
      `<td class="ms">${r.ms == null ? '—' : r.ms + 'ms'}</td>` +
      `</tr>`
    ).join('');
  }

  function start() {
    if (!state) reset(true);
    if (timer) return;
    $start.disabled = true; $pause.disabled = false;
    $start.textContent = '▶ Running…';
    tick(); // immediate first check (tick 0 is due at t=0)
    timer = setInterval(tick, REAL_TICK_MS);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    $start.disabled = false; $pause.disabled = true;
    $start.textContent = '▶ Start monitoring';
    render();
  }
  function reset(silent) {
    stop();
    state = buildState();
    if (!silent) render();
  }

  $start.addEventListener('click', start);
  $pause.addEventListener('click', stop);
  $step.addEventListener('click', () => { if (!state) reset(true); stop(); tick(); });
  $reset.addEventListener('click', () => reset());
  // Changing any control rebuilds the run from scratch.
  for (const ctrl of [$scenario, $interval, $confirm]) ctrl.addEventListener('change', () => reset());

  // Boot: build initial state and draw the idle panel.
  reset();
})();
