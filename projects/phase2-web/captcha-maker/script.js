/*
 * script.js — browser UI for the CAPTCHA Maker.
 *
 * All the security-relevant logic (generation, the one-time store, verification,
 * attempt budget, expiry) lives in captcha-core.js. This file only: draws the
 * challenge onto a canvas from the engine's pure geometry, wires the controls,
 * and shows results. It never knows the answer — it holds a token and asks the
 * store to verify, exactly as a real client would ask a server.
 */
(function () {
  'use strict';

  const C = window.CaptchaCore;
  const $ = (id) => document.getElementById(id);

  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  // One store, standing in for "the server". It keeps the secrets; we keep a token.
  const store = new C.CaptchaStore();

  let current = null;       // { token, text, expiresAt }
  let config = { length: 6, tilt: 45, lines: 5, ttl: 120 };
  let countdown = null;

  // -- drawing --------------------------------------------------------------
  function hsl(h, s, l) { return `hsl(${h} ${s}% ${l}%)`; }

  function draw(text) {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Paper background with a faint wash.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const wash = ctx.createLinearGradient(0, 0, W, H);
    wash.addColorStop(0, 'rgba(109,139,255,0.06)');
    wash.addColorStop(1, 'rgba(74,217,154,0.06)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);

    const maxTilt = (config.tilt / 100) * 0.9;
    const noise = C.buildNoise({ width: W, height: H, lines: config.lines, dots: 150 });
    const glyphs = C.buildGlyphs(text, { width: W, height: H, maxTilt: maxTilt });

    // Speckle first, behind the text.
    for (const d of noise.dots) {
      ctx.fillStyle = `rgba(30,40,80,${0.05 + Math.random() * 0.12})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Glyphs.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const g of glyphs) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.rotation);
      ctx.font = `700 ${g.fontSize}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = hsl(g.hue, 70, 38);
      ctx.fillText(g.char, 0, 0);
      ctx.restore();
    }

    // Distractor lines on top, cutting through the glyphs.
    ctx.lineWidth = 2;
    for (const l of noise.lines) {
      ctx.strokeStyle = `hsla(${l.hue} 65% 45% / 0.55)`;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    }
  }

  // -- metadata panel -------------------------------------------------------
  function paintMeta() {
    $('m-alpha').textContent = `${C.ALPHABET.length} symbols`;
    $('m-entropy').textContent = `${C.entropyBits(config.length).toFixed(1)} bits`;
  }

  function startCountdown() {
    if (countdown) clearInterval(countdown);
    const tick = () => {
      if (!current) return;
      const left = Math.max(0, Math.round((current.expiresAt - Date.now()) / 1000));
      $('m-expires').textContent = `${left}s`;
      if (left <= 0) {
        clearInterval(countdown);
        setStatus('This challenge expired. Here is a fresh one.', 'warn');
        issue();
      }
    };
    tick();
    countdown = setInterval(tick, 500);
  }

  function setStatus(msg, kind) {
    const el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setAttemptsLeft(n) {
    $('m-attempts').textContent = n == null ? '—' : String(n);
  }

  // -- lifecycle ------------------------------------------------------------
  function issue() {
    current = store.issue({ length: config.length, ttlMs: config.ttl * 1000 });
    draw(current.text);
    paintMeta();
    setAttemptsLeft(store.defaults.maxAttempts);
    $('answer').value = '';
    $('answer').focus();
    startCountdown();
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!current) return issue();
    const guess = $('answer').value;
    if (!guess.trim()) { setStatus('Type the characters first.', 'warn'); return; }

    const res = store.verify(current.token, guess);
    if (res.ok) {
      setStatus('✓ Verified — you look human. Issuing a new one…', 'ok');
      setAttemptsLeft('—');
      current = null;
      setTimeout(issue, 900);
    } else if (res.reason === 'incorrect') {
      setStatus(`✗ Not quite. ${res.attemptsLeft} attempt(s) left.`, 'bad');
      setAttemptsLeft(res.attemptsLeft);
      $('answer').select();
    } else if (res.reason === 'locked') {
      setStatus('✗ Too many tries — that challenge is burned. New one below.', 'bad');
      setAttemptsLeft(0);
      current = null;
      setTimeout(issue, 900);
    } else if (res.reason === 'expired') {
      setStatus('That challenge expired. Here is a fresh one.', 'warn');
      issue();
    } else {
      setStatus('That challenge is no longer valid. Here is a fresh one.', 'warn');
      issue();
    }
  }

  // -- controls -------------------------------------------------------------
  function tiltWord(v) {
    if (v < 25) return 'low';
    if (v < 60) return 'medium';
    return 'high';
  }

  function wireControls() {
    $('reload').addEventListener('click', () => { setStatus(''); issue(); });
    $('form').addEventListener('submit', onSubmit);

    const bind = (slider, output, key, fmt) => {
      const s = $(slider), o = $(output);
      s.addEventListener('input', () => {
        config[key] = Number(s.value);
        o.textContent = fmt ? fmt(Number(s.value)) : s.value;
      });
      s.addEventListener('change', () => { setStatus(''); issue(); });
    };
    bind('s-length', 'o-length', 'length');
    bind('s-tilt', 'o-tilt', 'tilt', tiltWord);
    bind('s-lines', 'o-lines', 'lines');
    bind('s-ttl', 'o-ttl', 'ttl');
  }

  wireControls();
  issue();
})();
