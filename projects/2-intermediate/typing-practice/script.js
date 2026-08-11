// script.js — the one impure boundary: DOM, timers, Web Audio, and localStorage.
// All game rules live in typing-core.js; this file just drives them.

(function () {
  'use strict';

  const core = window.typingCore || require('./typing-core.js');
  const {
    createSession, start, stop, submit, expire,
    normalizeStats, mergeStats, emptyStats,
  } = core;

  const STORAGE_KEY = 'typing-practice-stats';

  const el = {
    prompt: document.getElementById('prompt'),
    entry: document.getElementById('entry'),
    score: document.getElementById('score'),
    timer: document.getElementById('timer'),
    streak: document.getElementById('streak'),
    message: document.getElementById('message'),
    timerFill: document.getElementById('timerFill'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    soundToggle: document.getElementById('soundToggle'),
    lifetime: document.getElementById('lifetime'),
  };

  let state = createSession();
  let deadline = 0; // timestamp when the current word expires
  let rafId = null;

  // --- tiny Web Audio blip generator (bonus: distinct tones) -----------------
  let audioCtx = null;
  function tone(freq, durationMs, type) {
    if (!el.soundToggle.checked) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + durationMs / 1000);
    } catch (_) { /* audio not available — silent */ }
  }
  const sound = {
    newWord: () => tone(660, 90, 'triangle'),
    correct: () => { tone(880, 90, 'sine'); setTimeout(() => tone(1175, 120, 'sine'), 90); },
    wrong: () => tone(160, 180, 'sawtooth'),
  };

  // --- persistence -----------------------------------------------------------
  function loadStats() {
    try {
      return normalizeStats(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (_) {
      return emptyStats();
    }
  }
  function saveStats(stats) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch (_) { /* ignore */ }
  }

  // --- shuffle a working copy of the word list each session ------------------
  function shuffled(words) {
    const a = words.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // --- rendering -------------------------------------------------------------
  function render() {
    el.prompt.textContent = state.running ? state.currentWord : '— — —';
    el.score.textContent = `${state.successes} / ${state.attempts}`;
    el.timer.textContent = `${(state.intervalMs / 1000).toFixed(1)}s`;
    el.streak.textContent = String(state.streak);
    el.message.textContent = state.message;
    el.message.className = 'message' +
      (state.lastResult === 'correct' ? ' ok' : state.lastResult === 'incorrect' ? ' bad' : '');
    el.prompt.classList.toggle('correct', state.lastResult === 'correct');
    el.entry.disabled = !state.running;
    el.startBtn.disabled = state.running;
    el.stopBtn.disabled = !state.running;
  }

  function renderLifetime() {
    const s = loadStats();
    if (s.sessions === 0) {
      el.lifetime.textContent = 'No sessions yet.';
      return;
    }
    const pct = s.totalAttempts ? Math.round((s.totalSuccesses / s.totalAttempts) * 100) : 0;
    el.lifetime.textContent =
      `${s.sessions} session${s.sessions === 1 ? '' : 's'} · ` +
      `${s.totalSuccesses}/${s.totalAttempts} correct (${pct}%) · best streak ${s.bestStreak}`;
  }

  // --- the per-word countdown ------------------------------------------------
  function armTimer() {
    deadline = Date.now() + state.intervalMs;
    cancelAnimationFrame(rafId);
    tick();
  }
  function tick() {
    const remaining = deadline - Date.now();
    const frac = Math.max(0, remaining / state.intervalMs);
    el.timerFill.style.transform = `scaleX(${frac})`;
    if (remaining <= 0) {
      state = expire(state);
      sound.wrong();
      flashBad();
      render();
      if (state.running) armTimer();
      return;
    }
    if (state.running) rafId = requestAnimationFrame(tick);
  }

  function flashBad() {
    el.entry.classList.remove('flash-bad');
    void el.entry.offsetWidth; // reflow so the animation restarts
    el.entry.classList.add('flash-bad');
  }

  // --- control flow ----------------------------------------------------------
  function beginSession() {
    state = start(createSession(shuffled(core.DEFAULT_WORDS)));
    render();
    renderLifetime();
    el.entry.value = '';
    el.entry.focus();
    sound.newWord();
    armTimer();
  }

  function endSession() {
    if (state.running) {
      const merged = mergeStats(loadStats(), state);
      saveStats(merged);
    }
    state = stop(state);
    cancelAnimationFrame(rafId);
    el.timerFill.style.transform = 'scaleX(0)';
    render();
    renderLifetime();
  }

  function handleEntry(value) {
    const before = state;
    state = submit(state, value);
    if (state === before) return; // not running
    if (state.lastResult === 'correct') {
      el.entry.value = '';
      sound.correct();
      setTimeout(() => { if (state.running) sound.newWord(); }, 140);
      render();
      armTimer();
    } else {
      el.entry.value = '';
      sound.wrong();
      flashBad();
      render();
    }
  }

  // --- events ----------------------------------------------------------------
  el.startBtn.addEventListener('click', beginSession);
  el.stopBtn.addEventListener('click', endSession);
  el.entry.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEntry(el.entry.value);
    }
  });

  renderLifetime();
  render();
})();
