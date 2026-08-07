/*
 * stringart-core.js — pure geometry/physics for the String Art animation.
 *
 * No DOM, no canvas, no randomness of its own: every function that needs a
 * random number takes an `rng` (a function returning [0, 1)), so the whole
 * thing is deterministic and testable under plain node.
 *
 * A "line" is two endpoints, each a moving point:
 *   { a: {x, y, vx, vy}, b: {x, y, vx, vy}, hue }
 * Bounds are { w, h } — the line lives inside [0, w] x [0, h].
 */
'use strict';

// Reflect a single moving point off the walls of a w×h box. Returns a new
// point object; when a wall is hit the matching velocity component flips and
// `bounced` is set so the caller can decide to jitter the angle.
function stepPoint(p, bounds, dt) {
  const step = typeof dt === 'number' ? dt : 1;
  let x = p.x + p.vx * step;
  let y = p.y + p.vy * step;
  let vx = p.vx;
  let vy = p.vy;
  let bounced = false;

  if (x < 0) { x = -x; vx = -vx; bounced = true; }
  else if (x > bounds.w) { x = 2 * bounds.w - x; vx = -vx; bounced = true; }

  if (y < 0) { y = -y; vy = -vy; bounced = true; }
  else if (y > bounds.h) { y = 2 * bounds.h - y; vy = -vy; bounced = true; }

  return { x, y, vx, vy, bounced };
}

// Rotate a velocity vector by a random angle in [-maxDelta, +maxDelta].
// Speed (magnitude) is preserved so lines never slow to a crawl or run away.
function jitterVelocity(vx, vy, rng, maxDelta) {
  const delta = (rng() * 2 - 1) * maxDelta;
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  return {
    vx: vx * cos - vy * sin,
    vy: vx * sin + vy * cos,
  };
}

// Advance a whole line one tick. Both endpoints move; any endpoint that hit a
// wall gets its direction jittered. Returns a brand-new line (no mutation).
function advanceLine(line, bounds, rng, maxJitter) {
  const jitter = typeof maxJitter === 'number' ? maxJitter : 0.4;

  function nextEnd(p) {
    const s = stepPoint(p, bounds, 1);
    if (s.bounced) {
      const j = jitterVelocity(s.vx, s.vy, rng, jitter);
      return { x: s.x, y: s.y, vx: j.vx, vy: j.vy };
    }
    return { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  }

  return {
    a: nextEnd(line.a),
    b: nextEnd(line.b),
    hue: (line.hue + 1) % 360, // slow color cycle → "multicolored"
  };
}

// Build a random line of the given `length` and `speed`, placed fully inside
// the bounds. Angle of the line and its travel direction both come from rng.
function createLine(bounds, length, speed, rng) {
  const angle = rng() * Math.PI * 2;
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;

  // Keep both endpoints in-bounds by clamping the anchor's spawn box.
  const minX = Math.max(0, -Math.min(0, dx));
  const maxX = bounds.w - Math.max(0, dx);
  const minY = Math.max(0, -Math.min(0, dy));
  const maxY = bounds.h - Math.max(0, dy);

  const ax = minX + rng() * Math.max(0, maxX - minX);
  const ay = minY + rng() * Math.max(0, maxY - minY);

  const travel = rng() * Math.PI * 2;
  const vx = Math.cos(travel) * speed;
  const vy = Math.sin(travel) * speed;

  return {
    a: { x: ax, y: ay, vx, vy },
    b: { x: ax + dx, y: ay + dy, vx, vy },
    hue: Math.floor(rng() * 360),
  };
}

// Map a trail index to an alpha so the newest line is brightest and only the
// most recent `visible` lines register at all. index 0 = oldest in trail.
function trailAlpha(index, trailLength, visible) {
  const vis = typeof visible === 'number' ? visible : trailLength;
  const ageFromNewest = trailLength - 1 - index;
  if (ageFromNewest >= vis) return 0;
  return 1 - ageFromNewest / vis;
}

const api = {
  stepPoint,
  jitterVelocity,
  advanceLine,
  createLine,
  trailAlpha,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.StringArtCore = api;
