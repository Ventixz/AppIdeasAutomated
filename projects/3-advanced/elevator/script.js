// script.js — DOM wiring for the elevator simulator.
//
// All the state-machine work lives in elevator-core.js. This file is only the
// presentation layer: it builds the floor DOM, forwards button clicks into the
// engine, reads position/phase back once per animation frame, and paints the
// building. The "single event handler" constraint from the spec is honoured
// twice — once for the hall buttons on the building, and once for the panel
// buttons inside the car — using event delegation so a listener count of two
// covers *every* button in the interface.

'use strict';

(function () {
  const {
    createElevator,
    STATE,
    DEFAULT_FLOORS,
    DEFAULT_QUEUE_CAPACITY,
  } = window.ElevatorCore;

  // ---- Theme (persists between reloads, matches other projects) --------
  const THEME_KEY = 'elevator-theme';
  const themeBtn = document.getElementById('theme-btn');
  function applyTheme(theme) {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    themeBtn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  // ---- Elevator engine ------------------------------------------------
  const NUM_FLOORS = DEFAULT_FLOORS;
  const el = createElevator({
    floors: NUM_FLOORS,
    speed: 1.3,               // floors/second — a gentle 3s-per-floor pace
    dwellSeconds: 5,
    queueCapacity: DEFAULT_QUEUE_CAPACITY,
  });

  // ---- DOM handles -----------------------------------------------------
  const floorsEl = document.getElementById('floors');
  const shaftEl = document.getElementById('shaft');
  const carEl = document.getElementById('car');
  const carLabelEl = document.getElementById('car-label');
  const panelBtnsEl = document.getElementById('panel-buttons');
  const queueEl = document.getElementById('queue');
  const queueCountEl = document.getElementById('queue-count');
  const queueFullHint = document.getElementById('queue-full-hint');
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('log');
  const dwellFill = document.getElementById('dwell-fill');
  const dwellLabel = document.getElementById('dwell-label');
  const soundBtn = document.getElementById('sound-btn');
  const occupantsBtn = document.getElementById('occupants-btn');
  const occupantIntervalInput = document.getElementById('occupant-interval');
  const capacityInput = document.getElementById('capacity-input');

  // ---- Build the floor DOM -------------------------------------------
  // Floor rows are laid out bottom-up via column-reverse in CSS, so we just
  // append 1..N here.
  const OCCUPANT_EMOJI = ['🧑', '👩', '👨', '🧓', '👶', '🧑‍💼', '🧑‍🎓'];
  const floorState = {}; // floorNum -> { row, body, upBtn, downBtn, occupants: [] }

  for (let f = 1; f <= NUM_FLOORS; f += 1) {
    const li = document.createElement('li');
    li.className = 'floor';
    li.dataset.floor = String(f);

    const num = document.createElement('span');
    num.className = 'floor-num';
    num.textContent = `Floor ${f}`;

    const body = document.createElement('span');
    body.className = 'floor-body';
    body.innerHTML = '&nbsp;'; // occupants go here

    const btns = document.createElement('span');
    btns.className = 'hall-buttons';

    // Top floor has no up button; ground floor has no down button.
    if (f < NUM_FLOORS) {
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'hall-btn hall-up';
      up.dataset.floor = String(f);
      up.dataset.direction = 'up';
      up.textContent = '▲';
      up.setAttribute('aria-label', `Call up from floor ${f}`);
      btns.appendChild(up);
    }
    if (f > 1) {
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'hall-btn hall-down';
      down.dataset.floor = String(f);
      down.dataset.direction = 'down';
      down.textContent = '▼';
      down.setAttribute('aria-label', `Call down from floor ${f}`);
      btns.appendChild(down);
    }

    li.appendChild(num);
    li.appendChild(body);
    li.appendChild(btns);
    floorsEl.appendChild(li);

    floorState[f] = { row: li, body, occupants: [] };
  }

  // Build the panel of destination buttons (also delegated).
  for (let f = 1; f <= NUM_FLOORS; f += 1) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'panel-btn';
    b.dataset.floor = String(f);
    b.textContent = String(f);
    b.setAttribute('aria-label', `Select floor ${f}`);
    panelBtnsEl.appendChild(b);
  }

  // ---- Single hall-button handler (constraint from the spec) ---------
  // One listener on the floors <ol> covers all up/down buttons on every floor.
  floorsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.hall-btn');
    if (!btn) return;
    const floor = Number(btn.dataset.floor);
    const dir = btn.dataset.direction;
    const idx = el.pressHall({ floor, direction: dir });
    if (idx >= 0) {
      btn.classList.add('active');
      beep(880, 0.05);
    }
  });

  // ---- Single panel-button handler (constraint from the spec) --------
  // One listener on the panel <div> covers all N destination buttons.
  panelBtnsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.panel-btn');
    if (!btn) return;
    const floor = Number(btn.dataset.floor);
    const idx = el.pressPanel(floor);
    if (idx >= 0) {
      btn.classList.add('active');
      beep(660, 0.05);
    }
  });

  // ---- Log helpers ---------------------------------------------------
  function log(kind, message) {
    const li = document.createElement('li');
    li.className = `log-${kind}`;
    li.textContent = message;
    logEl.insertBefore(li, logEl.firstChild);
    // Keep the log bounded so it doesn't grow forever.
    while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
  }

  // ---- Sound (WebAudio; toggleable) ---------------------------------
  let soundOn = true;
  let audioCtx = null;
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.textContent = soundOn ? '🔊 Sound' : '🔇 Muted';
  });
  function beep(freq, duration) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.stop(audioCtx.currentTime + duration + 0.02);
    } catch (_) { /* audio not available — silently continue */ }
  }
  function ding() { // arrival sound
    beep(1200, 0.12);
    setTimeout(() => beep(900, 0.14), 90);
  }
  function alarm() { // queue-full alarm
    beep(440, 0.15);
    setTimeout(() => beep(330, 0.15), 130);
    setTimeout(() => beep(440, 0.15), 260);
  }

  // ---- Occupants: bonus feature -------------------------------------
  // When enabled, random people appear on random floors at a configurable
  // frequency and press the appropriate hall button so the elevator has
  // something to do. They stay visible until the elevator arrives at their
  // floor to pick them up.
  let occupantsOn = false;
  let occupantIntervalMs = Number(occupantIntervalInput.value) * 1000;
  let occupantTimer = null;

  occupantIntervalInput.addEventListener('change', () => {
    const v = Number(occupantIntervalInput.value);
    if (!Number.isFinite(v) || v < 2) {
      occupantIntervalInput.value = 12;
      occupantIntervalMs = 12 * 1000;
    } else {
      occupantIntervalMs = v * 1000;
    }
    if (occupantsOn) scheduleOccupant();
  });

  occupantsBtn.addEventListener('click', () => {
    occupantsOn = !occupantsOn;
    occupantsBtn.setAttribute('aria-pressed', String(occupantsOn));
    occupantsBtn.textContent = `👤 Occupants: ${occupantsOn ? 'on' : 'off'}`;
    if (occupantsOn) scheduleOccupant();
    else if (occupantTimer) { clearTimeout(occupantTimer); occupantTimer = null; }
  });

  function scheduleOccupant() {
    if (occupantTimer) clearTimeout(occupantTimer);
    occupantTimer = setTimeout(spawnOccupant, occupantIntervalMs);
  }
  function spawnOccupant() {
    if (!occupantsOn) return;
    const floor = 1 + Math.floor(Math.random() * NUM_FLOORS);
    const goingUp = floor === 1 ? true : floor === NUM_FLOORS ? false : Math.random() < 0.5;
    const emoji = OCCUPANT_EMOJI[Math.floor(Math.random() * OCCUPANT_EMOJI.length)];
    addOccupantOnFloor(floor, emoji);
    el.pressHall({ floor, direction: goingUp ? 'up' : 'down' });
    scheduleOccupant();
  }
  function addOccupantOnFloor(floor, emoji) {
    const fs = floorState[floor];
    if (!fs) return;
    const span = document.createElement('span');
    span.className = 'occupant';
    span.textContent = emoji;
    if (fs.body.innerHTML === '&nbsp;') fs.body.innerHTML = '';
    fs.body.appendChild(span);
    fs.occupants.push(span);
  }
  function clearOccupantsOnFloor(floor) {
    const fs = floorState[floor];
    if (!fs) return;
    fs.occupants.forEach((n) => n.remove());
    fs.occupants = [];
    if (!fs.body.children.length) fs.body.innerHTML = '&nbsp;';
  }

  // ---- Capacity input ----------------------------------------------
  capacityInput.addEventListener('change', () => {
    const v = Number(capacityInput.value);
    if (Number.isInteger(v) && v >= 2 && v <= 16) {
      el.state.queueCapacity = v;
    } else {
      capacityInput.value = el.state.queueCapacity;
    }
  });

  // ---- Rendering the building each frame ----------------------------
  // Position 1..N maps to a bottom offset in the shaft. The car takes ~1
  // floor's worth of vertical space so it's centred inside its floor's row.
  function paintCar() {
    const shaftH = shaftEl.clientHeight;
    const rowH = shaftH / NUM_FLOORS;
    const carH = Math.max(48, rowH - 12);
    carEl.style.height = `${carH}px`;
    // position=1 => car sits at the ground floor. We want the *centre* of the
    // car to align with the centre of that floor's row.
    const centreFromBottom = (el.position - 0.5) * rowH;
    const bottomPx = Math.max(6, centreFromBottom - carH / 2);
    carEl.style.bottom = `${bottomPx}px`;
    carLabelEl.textContent = String(Math.round(el.position));
    carEl.classList.toggle('moving', el.phase === STATE.MOVING);
  }

  function paintHallButtons() {
    // Highlight active hall calls: queued ones, and the one being served.
    const active = new Set();
    for (const c of el.state.calls) active.add(`${c.floor}:${c.direction}`);
    if (el.state.activeCall) {
      active.add(`${el.state.activeCall.floor}:${el.state.activeCall.direction}`);
    }
    floorsEl.querySelectorAll('.hall-btn').forEach((btn) => {
      const key = `${btn.dataset.floor}:${btn.dataset.direction}`;
      btn.classList.toggle('active', active.has(key));
    });
  }

  function paintPanelButtons() {
    const current = Math.round(el.position);
    const pending = new Set(el.state.panel);
    if (el.state.activePanel != null) pending.add(el.state.activePanel);
    panelBtnsEl.querySelectorAll('.panel-btn').forEach((btn) => {
      const f = Number(btn.dataset.floor);
      btn.classList.toggle('active', pending.has(f));
      btn.classList.toggle('current', f === current && el.phase !== STATE.MOVING);
      btn.disabled = f === current && el.phase === STATE.WAITING;
    });
  }

  function paintQueue() {
    const items = el.queue;
    queueEl.innerHTML = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'queue-empty';
      li.textContent = el.state.activeCall
        ? `serving: ${el.state.activeCall.direction === 'up' ? '▲' : '▼'} floor ${el.state.activeCall.floor}`
        : 'empty';
      queueEl.appendChild(li);
    } else {
      items.forEach((c, i) => {
        const li = document.createElement('li');
        if (i === 0) li.className = 'head';
        li.textContent = `${i + 1}. ${c.direction === 'up' ? '▲' : '▼'} floor ${c.floor}`;
        queueEl.appendChild(li);
      });
    }
    queueCountEl.textContent = String(items.length + el.state.panel.length);
    queueFullHint.hidden = !el.isQueueFull();
  }

  function paintDwell() {
    if (el.phase === STATE.WAITING) {
      const pct = Math.max(0, Math.min(100, (el.dwellRemaining / el.state.dwellSeconds) * 100));
      dwellFill.style.width = `${pct}%`;
      dwellLabel.textContent = `${el.dwellRemaining.toFixed(1)}s`;
    } else {
      dwellFill.style.width = '0%';
      dwellLabel.textContent = el.phase === STATE.MOVING ? 'moving' : 'idle';
    }
  }

  function paintStatus() {
    if (el.phase === STATE.MOVING) {
      statusEl.textContent = `Moving ${el.direction} to floor ${el.target} (at ${el.position.toFixed(2)}).`;
    } else if (el.phase === STATE.WAITING) {
      const f = Math.round(el.position);
      statusEl.textContent = `Waiting on floor ${f} — ${el.dwellRemaining.toFixed(1)}s left to pick a panel button.`;
    } else {
      statusEl.textContent = `Idle on floor ${Math.round(el.position)}.`;
    }
  }

  function paint() {
    paintCar();
    paintHallButtons();
    paintPanelButtons();
    paintQueue();
    paintDwell();
    paintStatus();
  }

  // ---- Handle events emitted by the engine --------------------------
  function handleEvents(events) {
    for (const e of events) {
      if (e.type === 'dispatch') {
        const target = e.to;
        if (e.servedCall) {
          log('dispatch', `▶ dispatch to floor ${target} (call ${e.servedCall.direction === 'up' ? '▲' : '▼'} floor ${e.servedCall.floor})`);
        } else {
          log('dispatch', `▶ dispatch to floor ${target} (panel)`);
        }
      } else if (e.type === 'return-home') {
        log('return-home', `↩ return to floor ${e.to} (idle)`);
      } else if (e.type === 'arrive') {
        const f = Math.round(e.floor);
        log('arrive', `● arrived at floor ${f}`);
        ding();
        clearOccupantsOnFloor(f);
      } else if (e.type === 'dwell-timeout') {
        log('dispatch', `⏱ dwell window closed on floor ${Math.round(e.floor)}`);
      } else if (e.type === 'queue-full') {
        log('queue-full', `🚨 request queue full (${e.size})`);
        alarm();
        const shellPanel = queueEl.closest('.queue-panel');
        if (shellPanel) {
          shellPanel.classList.remove('alarm-flash');
          // reflow to restart the animation
          // eslint-disable-next-line no-unused-expressions
          void shellPanel.offsetWidth;
          shellPanel.classList.add('alarm-flash');
        }
      }
    }
  }

  // ---- Main tick loop -----------------------------------------------
  let lastTs = null;
  function tick(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.1, (ts - lastTs) / 1000); // clamp big gaps (e.g. tab hidden)
    lastTs = ts;
    if (dt > 0) handleEvents(el.step(dt));
    paint();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
