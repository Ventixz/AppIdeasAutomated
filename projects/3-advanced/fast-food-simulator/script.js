// script.js — the browser front-end for the Fast Food Simulator.
//
// All the shop logic lives in fastfood-core.js. This file only reads inputs,
// drives the simulator forward with requestAnimationFrame, and paints the
// stations, counters, and event log. It knows nothing about how orders flow;
// it just renders snapshots and reacts to the events step() returns.

'use strict';

(function () {
  // fastfood-core.js is loaded first as a classic script, so its top-level
  // `validateInterval` and `createSimulator` are available as globals here.

  // --- element handles ---------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const form = $('setup-form');
  const startBtn = $('start-btn');
  const stopBtn = $('stop-btn');
  const speedSel = $('speed');

  const inputs = {
    arrival: $('arrival-interval'),
    fulfill: $('fulfill-interval'),
    taker: $('taker-time'),
    server: $('server-time'),
    duration: $('duration'),
  };
  const warns = {
    arrival: $('arrival-warn'),
    fulfill: $('fulfill-warn'),
    taker: $('taker-warn'),
    server: $('server-warn'),
    duration: $('duration-warn'),
  };

  const els = {
    clock: $('clock'),
    servedTotal: $('served-total'),
    pendingTotal: $('pending-total'),
    lineCount: $('line-count'),
    linePeople: $('line-people'),
    takerOrder: $('taker-order'),
    takerSub: $('taker-sub'),
    kitchenOrder: $('kitchen-order'),
    kitchenQueue: $('kitchen-queue'),
    cookFill: $('cook-fill'),
    pickupOrder: $('pickup-order'),
    servingLine: $('serving-line'),
    doneCount: $('done-count'),
    log: $('log'),
  };

  let sim = null;
  let rafId = null;
  let lastTs = null;

  // --- input validation & warnings --------------------------------------
  //
  // "Display customized warning messages when incorrect entries are made."
  // Each field has a tailored message keyed off the validator's reason.
  const MESSAGES = {
    empty: 'Please enter a value.',
    'not-a-number': 'Enter a number, not text.',
    'non-positive': 'Must be greater than zero.',
    'too-small': 'That is too fast — use at least 0.1s.',
    'too-large': 'That is too slow — keep it under 600s.',
  };

  // The duration field is special: 0 is allowed (means "run until stopped").
  function validateField(key) {
    const raw = inputs[key].value;
    if (key === 'duration' && String(raw).trim() === '0') {
      warns.duration.textContent = '';
      inputs.duration.classList.remove('invalid');
      return true;
    }
    const result = validateInterval(raw);
    if (result.ok) {
      warns[key].textContent = '';
      inputs[key].classList.remove('invalid');
      return true;
    }
    warns[key].textContent = MESSAGES[result.reason] || 'Invalid value.';
    inputs[key].classList.add('invalid');
    return false;
  }

  function validateAll() {
    // Validate every field; return whether all passed (no short-circuit so
    // every bad field gets its warning).
    return Object.keys(inputs).map(validateField).every(Boolean);
  }

  Object.keys(inputs).forEach((key) => {
    inputs[key].addEventListener('input', () => validateField(key));
  });

  // --- rendering ---------------------------------------------------------

  const LABELS = {
    arrive: (e) => `🚶 Customer #${e.customer} joined the order line (${e.lineLength} waiting).`,
    'take-start': (e) => `🧾 Taking order #${e.orderNumber} from customer #${e.customer}.`,
    'order-placed': (e) => `📝 Order #${e.orderNumber} placed → kitchen queue (${e.kitchenQueueLength}).`,
    'cook-start': (e) => `👨‍🍳 Cook started order #${e.orderNumber}.`,
    'cook-done': (e) => `🍳 Order #${e.orderNumber} is ready to serve.`,
    'pickup-ready': (e) => `🛎️ Now serving order #${e.orderNumber}.`,
    served: (e) => `✅ Order #${e.orderNumber} handed to customer #${e.customer} (total ${e.total}).`,
    stopped: (e) => `⏹️ Simulation stopped (${e.reason}).`,
  };

  function logEvent(event) {
    const li = document.createElement('li');
    li.className = `log-${event.type}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = `${event.at.toFixed(1)}s`;
    const text = document.createElement('span');
    text.textContent = (LABELS[event.type] || (() => event.type))(event);
    li.append(time, text);
    els.log.prepend(li);
    // Keep the log from growing without bound.
    while (els.log.children.length > 120) els.log.lastChild.remove();
  }

  function render() {
    const s = sim.snapshot();
    els.clock.textContent = `${s.elapsed.toFixed(1)}s`;
    els.servedTotal.textContent = s.servedCount;
    els.pendingTotal.textContent = s.pending;

    els.lineCount.textContent = s.orderLine;
    // A little crowd of emoji, capped so the row never overflows.
    const heads = Math.min(s.orderLine, 12);
    els.linePeople.textContent = '🧍'.repeat(heads) + (s.orderLine > 12 ? '…' : '');

    if (s.taking != null) {
      els.takerOrder.textContent = `#${s.takingOrderNumber}`;
      els.takerSub.textContent = `writing for customer #${s.taking}`;
    } else {
      els.takerOrder.textContent = '—';
      els.takerSub.textContent = 'idle';
    }

    els.kitchenOrder.textContent = s.cooking != null ? `#${s.cooking}` : '—';
    els.kitchenQueue.textContent = s.kitchenQueue;
    // Cook progress bar: how far through the current order the cook is.
    if (sim.cooking) {
      const frac = 1 - Math.max(0, sim.cooking.remaining) / sim.fulfillInterval;
      els.cookFill.style.width = `${Math.min(100, frac * 100)}%`;
    } else {
      els.cookFill.style.width = '0%';
    }

    els.pickupOrder.textContent = s.readyOrderNumber != null ? `#${s.readyOrderNumber}` : '—';
    els.servingLine.textContent = s.servingLine;
    els.doneCount.textContent = s.servedCount;

    // Highlight stations that are actively doing something.
    toggleActive('station-taker', s.taking != null);
    toggleActive('station-kitchen', s.cooking != null);
    toggleActive('station-pickup', s.readyOrderNumber != null);
  }

  function toggleActive(id, on) {
    document.getElementById(id).classList.toggle('active', on);
  }

  // --- the animation loop ------------------------------------------------

  function frame(ts) {
    if (!sim || !sim.running) return;
    if (lastTs == null) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    // Clamp so a background tab that pauses rAF doesn't fast-forward the shop.
    dt = Math.min(dt, 0.25) * Number(speedSel.value);

    for (const event of sim.step(dt)) logEvent(event);
    render();

    if (sim.running) {
      rafId = requestAnimationFrame(frame);
    } else {
      finish();
    }
  }

  // --- lifecycle ---------------------------------------------------------

  function start() {
    if (!validateAll()) return;
    sim = createSimulator({
      arrivalInterval: Number(inputs.arrival.value),
      fulfillInterval: Number(inputs.fulfill.value),
      orderTakerTime: Number(inputs.taker.value),
      serverTime: Number(inputs.server.value),
      duration: Number(inputs.duration.value) || 0,
    });
    els.log.innerHTML = '';
    lastTs = null;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setInputsDisabled(true);
    render();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (sim && sim.running) {
      for (const event of sim.step(0)) logEvent(event); // flush any tail events
      sim.stop('user');
      logEvent(sim.log[sim.log.length - 1]);
    }
    finish();
  }

  function finish() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setInputsDisabled(false);
    if (sim) render();
  }

  function setInputsDisabled(disabled) {
    Object.values(inputs).forEach((el) => {
      el.disabled = disabled;
    });
    speedSel.disabled = false; // speed can be changed mid-run
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    start();
  });
  stopBtn.addEventListener('click', stop);

  // --- theme toggle (matches the other projects) -------------------------
  const themeBtn = $('theme-btn');
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
  let theme = 'light';
  try {
    theme = localStorage.getItem('ffs-theme') || 'light';
  } catch (_) {
    /* storage may be unavailable */
  }
  applyTheme(theme);
  themeBtn.addEventListener('click', () => {
    theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try {
      localStorage.setItem('ffs-theme', theme);
    } catch (_) {
      /* ignore */
    }
  });

  // Initial validation pass so warnings show for pre-filled bad edits.
  validateAll();
})();
