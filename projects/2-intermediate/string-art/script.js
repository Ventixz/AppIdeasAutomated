/*
 * script.js — canvas rendering + controls for String Art.
 *
 * All geometry lives in stringart-core.js; this file only owns the canvas,
 * the requestAnimationFrame loop (throttled to ~20ms per the spec), and the
 * UI controls for line count, length, velocity, and trail length.
 */
'use strict';

(function () {
  const Core = window.StringArtCore;
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const bounds = { w: canvas.width, h: canvas.height };

  const el = (id) => document.getElementById(id);
  const controls = {
    lines: el('lines'),
    length: el('length'),
    speed: el('speed'),
    trail: el('trail'),
  };
  const outs = {
    lines: el('linesOut'),
    length: el('lengthOut'),
    speed: el('speedOut'),
    trail: el('trailOut'),
  };

  const rng = Math.random;
  const STEP_MS = 20; // spec: redraw every 20ms

  // Each "strand" is a live line plus a ring buffer of its recent positions.
  let strands = [];
  let running = true;
  let lastTick = 0;

  function settings() {
    return {
      count: +controls.lines.value,
      length: +controls.length.value,
      speed: +controls.speed.value,
      trail: +controls.trail.value,
    };
  }

  function buildStrands() {
    const s = settings();
    strands = [];
    for (let i = 0; i < s.count; i++) {
      const line = Core.createLine(bounds, s.length, s.speed, rng);
      strands.push({ line, history: [line] });
    }
  }

  function tick() {
    const s = settings();
    for (const strand of strands) {
      strand.line = Core.advanceLine(strand.line, bounds, rng, 0.35);
      strand.history.push(strand.line);
      while (strand.history.length > s.trail) strand.history.shift();
    }
  }

  function draw() {
    const s = settings();
    ctx.clearRect(0, 0, bounds.w, bounds.h);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    for (const strand of strands) {
      const h = strand.history;
      for (let i = 0; i < h.length; i++) {
        // Fade so only the most recent ~2/3 of the trail is clearly visible.
        const alpha = Core.trailAlpha(i, h.length, Math.ceil(s.trail * 0.75));
        if (alpha <= 0) continue;
        const ln = h[i];
        ctx.strokeStyle = `hsla(${ln.hue}, 90%, 60%, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(ln.a.x, ln.a.y);
        ctx.lineTo(ln.b.x, ln.b.y);
        ctx.stroke();
      }
    }
  }

  function frame(now) {
    if (running && now - lastTick >= STEP_MS) {
      lastTick = now;
      tick();
      draw();
    }
    requestAnimationFrame(frame);
  }

  // --- wiring ----------------------------------------------------------
  function syncOutputs() {
    outs.lines.textContent = controls.lines.value;
    outs.length.textContent = controls.length.value;
    outs.speed.textContent = controls.speed.value;
    outs.trail.textContent = controls.trail.value;
  }

  // Line count / length / velocity changes rebuild the strands so the new
  // value takes effect immediately; trail length is read live each frame.
  ['lines', 'length', 'speed'].forEach((k) => {
    controls[k].addEventListener('input', () => { syncOutputs(); buildStrands(); });
  });
  controls.trail.addEventListener('input', syncOutputs);

  el('pause').addEventListener('click', (e) => {
    running = !running;
    e.target.textContent = running ? 'Pause' : 'Resume';
  });
  el('reset').addEventListener('click', () => { buildStrands(); draw(); });

  syncOutputs();
  buildStrands();
  draw();
  requestAnimationFrame(frame);
})();
