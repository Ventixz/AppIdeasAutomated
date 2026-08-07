/*
 * tests.js — dependency-free, Jest-compatible tests for stringart-core.
 *
 * Runs two ways:
 *   node projects/2-intermediate/string-art/tests.js
 *   npx jest projects/2-intermediate/string-art/tests.js
 */
'use strict';

const C = require('./stringart-core.js');

// --- tiny test shim so this runs under plain node OR jest --------------
const isJest = typeof describe === 'function' && typeof test === 'function';
const cases = [];
function test_(name, fn) {
  if (isJest) test(name, fn);
  else cases.push({ name, fn });
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg || 'not equal') + `\n  expected ${e}\n  got      ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }
function approx(a, b, eps, msg) {
  if (Math.abs(a - b) > (eps || 1e-9)) throw new Error((msg || 'not approx') + ` (${a} vs ${b})`);
}

const BOUNDS = { w: 100, h: 100 };

// --- stepPoint: free movement -----------------------------------------
test_('point in the interior just advances by its velocity', () => {
  const s = C.stepPoint({ x: 50, y: 50, vx: 3, vy: -2 }, BOUNDS, 1);
  eq({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, bounced: s.bounced },
     { x: 53, y: 48, vx: 3, vy: -2, bounced: false });
});

// --- stepPoint: reflection --------------------------------------------
test_('crossing the left wall reflects x and flips vx', () => {
  const s = C.stepPoint({ x: 2, y: 50, vx: -5, vy: 0 }, BOUNDS, 1);
  eq(s.x, 3);          // -( 2 + -5 ) = 3
  eq(s.vx, 5);
  ok(s.bounced);
});

test_('crossing the right wall reflects back inside', () => {
  const s = C.stepPoint({ x: 98, y: 50, vx: 5, vy: 0 }, BOUNDS, 1);
  eq(s.x, 97);         // 2*100 - (98+5) = 97
  eq(s.vx, -5);
  ok(s.bounced);
});

test_('crossing top and bottom reflects y and flips vy', () => {
  const top = C.stepPoint({ x: 50, y: 1, vx: 0, vy: -4 }, BOUNDS, 1);
  eq(top.y, 3); eq(top.vy, 4); ok(top.bounced);
  const bot = C.stepPoint({ x: 50, y: 99, vx: 0, vy: 4 }, BOUNDS, 1);
  eq(bot.y, 97); eq(bot.vy, -4); ok(bot.bounced);
});

test_('a reflected point lands back inside the bounds', () => {
  const s = C.stepPoint({ x: 1, y: 1, vx: -10, vy: -10 }, BOUNDS, 1);
  ok(s.x >= 0 && s.x <= BOUNDS.w, 'x in bounds');
  ok(s.y >= 0 && s.y <= BOUNDS.h, 'y in bounds');
});

// --- jitterVelocity: magnitude preserved ------------------------------
test_('jitter preserves speed (rotation only)', () => {
  const before = Math.hypot(3, 4);
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const j = C.jitterVelocity(3, 4, () => r, 0.5);
    approx(Math.hypot(j.vx, j.vy), before, 1e-9, 'speed preserved for r=' + r);
  }
});

test_('jitter of 0 magnitude with rng midpoint is a no-op', () => {
  const j = C.jitterVelocity(2, -1, () => 0.5, 0.4); // delta = 0
  approx(j.vx, 2); approx(j.vy, -1);
});

// --- advanceLine -------------------------------------------------------
test_('advanceLine moves both endpoints and cycles the hue', () => {
  const line = { a: { x: 10, y: 10, vx: 1, vy: 1 }, b: { x: 20, y: 20, vx: 1, vy: 1 }, hue: 359 };
  const next = C.advanceLine(line, BOUNDS, () => 0.5, 0.3);
  eq(next.a.x, 11); eq(next.a.y, 11);
  eq(next.b.x, 21); eq(next.b.y, 21);
  eq(next.hue, 0, 'hue wraps 359 -> 0');
});

test_('advanceLine does not mutate the input', () => {
  const line = { a: { x: 10, y: 10, vx: 1, vy: 1 }, b: { x: 20, y: 20, vx: 1, vy: 1 }, hue: 5 };
  const snapshot = JSON.stringify(line);
  C.advanceLine(line, BOUNDS, () => 0.5, 0.3);
  eq(JSON.stringify(line), snapshot, 'input unchanged');
});

test_('endpoints stay in bounds over a long run', () => {
  let line = C.createLine(BOUNDS, 30, 5, seededRng(42));
  const r = seededRng(7);
  for (let i = 0; i < 5000; i++) {
    line = C.advanceLine(line, BOUNDS, r, 0.4);
    for (const p of [line.a, line.b]) {
      ok(p.x >= -0.001 && p.x <= BOUNDS.w + 0.001, `a.x in bounds at step ${i}: ${p.x}`);
      ok(p.y >= -0.001 && p.y <= BOUNDS.h + 0.001, `p.y in bounds at step ${i}: ${p.y}`);
    }
  }
});

// --- createLine --------------------------------------------------------
test_('createLine builds a line of the requested length, fully in-bounds', () => {
  const r = seededRng(123);
  for (let i = 0; i < 200; i++) {
    const line = C.createLine(BOUNDS, 40, 6, r);
    approx(Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y), 40, 1e-6, 'length');
    for (const p of [line.a, line.b]) {
      ok(p.x >= -1e-6 && p.x <= BOUNDS.w + 1e-6, 'x in bounds');
      ok(p.y >= -1e-6 && p.y <= BOUNDS.h + 1e-6, 'y in bounds');
    }
    approx(Math.hypot(line.a.vx, line.a.vy), 6, 1e-6, 'speed');
  }
});

// --- trailAlpha --------------------------------------------------------
test_('newest line in the trail is fully opaque', () => {
  eq(C.trailAlpha(9, 10, 10), 1); // index 9 == newest of 10
});

test_('alpha fades linearly toward older lines', () => {
  // trail of 10, visible window 10: newest=1, one older=0.9, ...
  approx(C.trailAlpha(8, 10, 10), 0.9);
  approx(C.trailAlpha(7, 10, 10), 0.8);
});

test_('lines older than the visible window are invisible', () => {
  // visible = 5 within a trail of 20 → the 15 oldest are 0
  eq(C.trailAlpha(0, 20, 5), 0);
  eq(C.trailAlpha(14, 20, 5), 0);
  ok(C.trailAlpha(15, 20, 5) > 0, 'first visible line shows');
});

// --- deterministic rng for the property-style tests -------------------
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    // mulberry32
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- standalone runner -------------------------------------------------
if (!isJest) {
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    try { c.fn(); pass++; }
    catch (e) {
      fail++;
      console.error('✗ ' + c.name);
      console.error('  ' + String(e.message).split('\n').join('\n  '));
    }
  }
  if (fail === 0) console.log(`All ${pass} tests passed.`);
  else { console.log(`${pass} passed, ${fail} failed.`); process.exitCode = 1; }
}
