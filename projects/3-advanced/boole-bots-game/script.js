// script.js — the browser presentation layer for Boole Bots.
//
// Not a line of game logic lives here. Every collision, bounce and Boolean
// verdict comes from boole-core.js (window.BooleCore). This file only reads the
// config panel, feeds it to createArena(), draws the arena each frame, and
// mirrors the engine's leaderboard / log / clock into the DOM.

(function () {
  'use strict';

  const {
    OPERATION_NAMES,
    CARDINAL_NAMES,
    ALL_DIRECTION_NAMES,
    createArena,
  } = window.BooleCore;

  // Four preset bots so the game is playable the instant the page loads.
  const PRESETS = [
    { name: 'Ada', value: 1, operation: 'AND', direction: 'E', icon: '🤖', color: '#5ad1ff' },
    { name: 'Boole', value: 0, operation: 'OR', direction: 'W', icon: '👾', color: '#4ade80' },
    { name: 'Turing', value: 1, operation: 'XOR', direction: 'S', icon: '🛸', color: '#fbbf24' },
    { name: 'Lovelace', value: 0, operation: 'NOT', direction: 'N', icon: '🦾', color: '#f472b6' },
  ];
  const ICONS = ['🤖', '👾', '🛸', '🦾', '🐙', '⚡', '🔺', '🟣', '🎯', '💠'];

  const configRoot = document.getElementById('bot-configs');
  const battleBtn = document.getElementById('battle-btn');
  const clockEl = document.getElementById('clock');
  const sizeSel = document.getElementById('arena-size');
  const diagChk = document.getElementById('diagonals');
  const canvas = document.getElementById('arena');
  const ctx = canvas.getContext('2d');
  const boardBody = document.getElementById('leaderboard-body');
  const logEl = document.getElementById('log');

  // --- Build the four configuration cards --------------------------------

  function directionOptions(selected) {
    const names = diagChk.checked ? ALL_DIRECTION_NAMES : CARDINAL_NAMES;
    return names
      .map((n) => `<option value="${n}" ${n === selected ? 'selected' : ''}>${n}</option>`)
      .join('');
  }

  function buildCards() {
    configRoot.innerHTML = '';
    PRESETS.forEach((preset, i) => {
      const card = document.createElement('div');
      card.className = 'bot-card';
      card.style.setProperty('--bot-color', preset.color);
      card.innerHTML = `
        <div class="enable-row">
          <label class="checkbox">
            <input type="checkbox" class="enable" ${i < 2 ? 'checked' : i < 4 ? 'checked' : ''} />
            <span class="icon">${preset.icon}</span>
            <input type="text" class="name" value="${preset.name}" maxlength="14" />
          </label>
        </div>
        <div class="row">
          <label class="inline">value
            <select class="value">
              <option value="0" ${preset.value === 0 ? 'selected' : ''}>0</option>
              <option value="1" ${preset.value === 1 ? 'selected' : ''}>1</option>
            </select>
          </label>
          <label class="inline">op
            <select class="operation">
              ${OPERATION_NAMES.map(
                (op) => `<option value="${op}" ${op === preset.operation ? 'selected' : ''}>${op}</option>`,
              ).join('')}
            </select>
          </label>
          <label class="inline">dir
            <select class="direction">${directionOptions(preset.direction)}</select>
          </label>
        </div>
        <div class="row">
          <label style="flex:1">speed <span class="speed-val">1.4</span>
            <input type="range" class="speed" min="0.6" max="3" step="0.1" value="1.4" />
          </label>
          <label class="inline">icon
            <select class="icon-sel">
              ${ICONS.map((ic) => `<option value="${ic}" ${ic === preset.icon ? 'selected' : ''}>${ic}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="err" aria-live="polite"></div>
      `;
      configRoot.appendChild(card);

      const speed = card.querySelector('.speed');
      const speedVal = card.querySelector('.speed-val');
      speed.addEventListener('input', () => {
        speedVal.textContent = Number(speed.value).toFixed(1);
      });
      const iconSel = card.querySelector('.icon-sel');
      iconSel.addEventListener('change', () => {
        card.querySelector('.icon').textContent = iconSel.value;
      });
      // Live duplicate-name validation.
      card.querySelector('.name').addEventListener('input', validateNames);
      card.querySelector('.enable').addEventListener('change', validateNames);
      card.style.setProperty('--bot-color', preset.color);
      card.dataset.color = preset.color;
    });
  }

  // Refresh the direction dropdowns when the diagonals option toggles.
  diagChk.addEventListener('change', () => {
    document.querySelectorAll('.bot-card').forEach((card) => {
      const sel = card.querySelector('.direction');
      const current = sel.value;
      sel.innerHTML = directionOptions();
      if ([...sel.options].some((o) => o.value === current)) sel.value = current;
    });
  });

  // --- Read config / validate --------------------------------------------

  function enabledCards() {
    return [...document.querySelectorAll('.bot-card')].filter(
      (c) => c.querySelector('.enable').checked,
    );
  }

  // Spec: show an error on duplicate bot names. Returns true when valid.
  function validateNames() {
    const cards = enabledCards();
    const seen = new Map();
    cards.forEach((c) => {
      c.querySelector('.err').textContent = '';
      const name = c.querySelector('.name').value.trim();
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name).push(c);
    });
    let valid = cards.length >= 2;
    seen.forEach((list, name) => {
      if (!name) {
        list.forEach((c) => (c.querySelector('.err').textContent = 'Name required.'));
        valid = false;
      } else if (list.length > 1) {
        list.forEach((c) => (c.querySelector('.err').textContent = 'Duplicate name.'));
        valid = false;
      }
    });
    return valid;
  }

  function readConfigs() {
    return enabledCards().map((c) => ({
      name: c.querySelector('.name').value.trim(),
      value: Number(c.querySelector('.value').value),
      operation: c.querySelector('.operation').value,
      speed: Number(c.querySelector('.speed').value),
      direction: c.querySelector('.direction').value,
      icon: c.querySelector('.icon').textContent,
      color: c.dataset.color,
    }));
  }

  // --- Battle loop -------------------------------------------------------

  let arena = null;
  let running = false;
  let rafId = null;
  let lastTs = 0;
  let lastClockSec = -1;

  function startBattle() {
    if (!validateNames()) return;
    const configs = readConfigs();
    if (configs.length < 2) return;

    const size = Number(sizeSel.value);
    arena = createArena(configs, { size });
    running = true;
    lastTs = 0;
    lastClockSec = -1;
    logEl.innerHTML = '';
    battleBtn.textContent = 'Stop!';
    battleBtn.classList.add('stop');
    setConfigDisabled(true);
    renderLeaderboard();
    rafId = requestAnimationFrame(tick);
  }

  function stopBattle() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    battleBtn.textContent = 'Battle!';
    battleBtn.classList.remove('stop');
    setConfigDisabled(false);
  }

  function setConfigDisabled(disabled) {
    document
      .querySelectorAll('.bot-card input, .bot-card select, #arena-size, #diagonals')
      .forEach((el) => (el.disabled = disabled));
  }

  function tick(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.1) dt = 0.1; // clamp after tab-switches so nobody tunnels

    const events = arena.step(dt);
    events.forEach(logEvent);
    if (events.some((e) => e.type === 'collision' || e.type === 'win')) {
      renderLeaderboard();
    }

    draw();
    updateClock();

    if (arena.settled()) {
      renderLeaderboard();
      stopBattle();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  // --- Rendering ---------------------------------------------------------

  function draw() {
    const size = arena.size;
    const px = canvas.width;
    const scale = px / size;
    ctx.clearRect(0, 0, px, px);

    // Grid.
    ctx.strokeStyle = 'rgba(90,209,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * scale, 0);
      ctx.lineTo(i * scale, px);
      ctx.moveTo(0, i * scale);
      ctx.lineTo(px, i * scale);
      ctx.stroke();
    }

    // Bots.
    const r = arena.radius * scale;
    arena.bots.forEach((bot) => {
      if (!bot.alive) return;
      const x = bot.x * scale;
      const y = bot.y * scale;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = bot.color || '#5ad1ff';
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();

      // Icon + the bot's value badge.
      ctx.font = `${Math.round(r * 1.1)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bot.icon || '🤖', x, y - r * 0.05);

      ctx.font = `bold ${Math.round(r * 0.7)}px monospace`;
      ctx.fillStyle = '#05122a';
      const badge = `${bot.operation}·${bot.value}`;
      const bw = ctx.measureText(badge).width + 6;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x - bw / 2, y + r + 2, bw, r * 0.9);
      ctx.fillStyle = '#05122a';
      ctx.fillText(badge, x, y + r + 2 + r * 0.45);
    });
  }

  function renderLeaderboard() {
    const board = arena.leaderboard();
    const topWins = Math.max(0, ...board.map((b) => b.wins));
    const colors = {};
    arena.bots.forEach((b) => (colors[b.name] = b.color));
    boardBody.innerHTML = board
      .map((b) => {
        const dead = b.alive ? '' : ' dead';
        const leader = b.alive && b.wins === topWins && topWins > 0 ? ' leader' : '';
        const dot = `<span class="dot" style="background:${colors[b.name] || '#888'}"></span>`;
        return `<tr class="${(dead + leader).trim()}">
          <td>${dot}${escapeHtml(b.name)}</td>
          <td>${b.operation}·${b.value}</td>
          <td>${b.wins}</td>
          <td>${b.losses}</td>
        </tr>`;
      })
      .join('');
  }

  function logEvent(e) {
    const li = document.createElement('li');
    const t = formatTime(e.time || arena.elapsed);
    if (e.type === 'win') {
      li.className = 'win';
      li.innerHTML = `<span class="t">${t}</span>🏆 ${escapeHtml(e.winner)} is the last bot standing!`;
    } else if (e.type === 'stalemate') {
      li.className = 'win';
      li.innerHTML = `<span class="t">${t}</span>🤝 Stalemate — ${e.survivors
        .map(escapeHtml)
        .join(' & ')} tie forever. It's a draw.`;
    } else if (e.type === 'collision') {
      if (e.outcome === 'tie') {
        li.innerHTML = `<span class="t">${t}</span>${escapeHtml(e.a)} (${e.resultA}) ⟷ ${escapeHtml(
          e.b,
        )} (${e.resultB}) — tie, both resume`;
      } else {
        li.className = 'ko';
        li.innerHTML = `<span class="t">${t}</span>💥 ${escapeHtml(e.winner)} beats ${escapeHtml(
          e.loser,
        )} (${e.resultA} vs ${e.resultB})`;
      }
    }
    logEl.insertBefore(li, logEl.firstChild);
  }

  function updateClock() {
    const sec = Math.floor(arena.elapsed);
    if (sec !== lastClockSec) {
      lastClockSec = sec;
      clockEl.textContent = formatTime(sec);
    }
  }

  function formatTime(totalSeconds) {
    const s = Math.floor(totalSeconds);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  // --- Wire up -----------------------------------------------------------

  battleBtn.addEventListener('click', () => {
    if (running) stopBattle();
    else startBattle();
  });

  buildCards();
  validateNames();

  // Draw an initial idle arena so the canvas isn't blank on load.
  arena = createArena(readConfigs(), { size: Number(sizeSel.value) });
  draw();
  renderLeaderboard();
  arena = null;
})();
