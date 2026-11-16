/*
 * tests.js — zero-dependency checks for captcha-core.js. Run: `node tests.js`.
 */

'use strict';

const C = require('./captcha-core.js');
const {
  ALPHABET, makeSeededRng, randomText, randomToken, entropyBits,
  normalize, constantTimeEqual, CaptchaStore, buildGlyphs, buildNoise,
} = C;

let passed = 0;
let failed = 0;

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else { failed++; console.error(`FAIL: ${msg}\n   expected: ${e}\n   actual:   ${a}`); }
}
function ok(cond, msg) { eq(Boolean(cond), true, msg); }
function excludes(hay, needle, msg) {
  if (!String(hay).includes(needle)) passed++;
  else { failed++; console.error(`FAIL: ${msg}\n   "${needle}" SHOULD NOT appear in "${hay}"`); }
}

/* ============================================================= */
/* Trap 1 — the alphabet is the fix for human/bot legibility     */
{
  for (const bad of ['0', 'O', '1', 'I', 'L']) {
    excludes(ALPHABET, bad, `alphabet omits confusable "${bad}"`);
  }
  eq(new Set(ALPHABET.split('')).size, ALPHABET.length, 'alphabet has no duplicates');
  ok(ALPHABET.length === 31, 'alphabet is 31 symbols (23 letters + 8 digits)');
  ok(/^[A-Z0-9]+$/.test(ALPHABET), 'alphabet is upper-case letters and digits only');
}

/* randomText — length, charset, and seeded determinism */
{
  const rng = makeSeededRng(42);
  const t = randomText(6, rng);
  eq(t.length, 6, 'randomText honours requested length');
  ok(t.split('').every((ch) => ALPHABET.includes(ch)), 'randomText only emits alphabet glyphs');

  const a = randomText(8, makeSeededRng(7));
  const b = randomText(8, makeSeededRng(7));
  eq(a, b, 'same seed -> identical challenge (reproducible)');
  const c = randomText(8, makeSeededRng(8));
  ok(a !== c, 'different seed -> different challenge (overwhelmingly)');
}

/* randomToken — hex, length, uniqueness */
{
  const tok = randomToken(16, makeSeededRng(1));
  eq(tok.length, 32, '16-byte token is 32 hex chars');
  ok(/^[0-9a-f]+$/.test(tok), 'token is lower-case hex');
  const seen = new Set();
  const rng = makeSeededRng(99);
  for (let i = 0; i < 500; i++) seen.add(randomToken(16, rng));
  eq(seen.size, 500, '500 tokens are all distinct');
}

/* entropyBits */
{
  const bits = entropyBits(6, 31);
  ok(Math.abs(bits - 6 * Math.log2(31)) < 1e-9, 'entropyBits = length * log2(size)');
  ok(entropyBits(6) > 29 && entropyBits(6) < 30, '6-char default challenge is ~29.7 bits');
  ok(entropyBits(8) > entropyBits(6), 'longer challenge means more entropy');
}

/* normalize — case fold + whitespace strip */
{
  eq(normalize('  aB cD '), 'ABCD', 'normalize folds case and strips inner/outer spaces');
  eq(normalize('a\tb\nc'), 'ABC', 'normalize strips tabs and newlines');
  eq(normalize(null), '', 'normalize(null) is empty string');
  eq(normalize(undefined), '', 'normalize(undefined) is empty string');
  eq(normalize(1234), '1234', 'normalize coerces numbers');
}

/* constantTimeEqual */
{
  ok(constantTimeEqual('ABC123', 'ABC123'), 'equal strings compare equal');
  ok(!constantTimeEqual('ABC123', 'ABC124'), 'one-char difference compares unequal');
  ok(!constantTimeEqual('ABC', 'ABCD'), 'different length compares unequal');
  ok(!constantTimeEqual('', 'A'), 'empty vs non-empty compares unequal');
  ok(constantTimeEqual('', ''), 'empty vs empty compares equal');
}

/* ============================================================= */
/* CaptchaStore — issue + the happy path                         */
{
  let t = 1000;
  const store = new CaptchaStore({ now: () => t, rng: makeSeededRng(5), ttlMs: 1000 });
  const ch = store.issue({ length: 6 });
  ok(typeof ch.token === 'string' && ch.token.length === 32, 'issue returns a 32-char token');
  eq(ch.text.length, 6, 'issue returns challenge text of requested length');
  ok(ch.text.split('').every((c) => ALPHABET.includes(c)), 'issued text uses only the alphabet');
  eq(store.size(), 1, 'store holds one live challenge');

  const res = store.verify(ch.token, ch.text);
  eq(res, { ok: true, reason: 'ok' }, 'correct guess verifies ok');
  eq(store.size(), 0, 'solved challenge is removed from the store');
}

/* case- and space-insensitive verification */
{
  let t = 0;
  const store = new CaptchaStore({ now: () => t, rng: makeSeededRng(11) });
  const ch = store.issue({ length: 5 });
  const messy = ' ' + ch.text.toLowerCase().split('').join(' ') + ' ';
  const res = store.verify(ch.token, messy);
  ok(res.ok, 'lower-case, space-padded guess still verifies');
}

/* Trap 2 — single-use: a solved token cannot be replayed */
{
  let t = 0;
  const store = new CaptchaStore({ now: () => t, rng: makeSeededRng(21) });
  const ch = store.issue({});
  ok(store.verify(ch.token, ch.text).ok, 'first correct verify succeeds');
  eq(store.verify(ch.token, ch.text), { ok: false, reason: 'unknown' }, 'replay of solved token is unknown');
}

/* unknown / never-issued token */
{
  const store = new CaptchaStore({ rng: makeSeededRng(3) });
  eq(store.verify('deadbeef', 'WHATEVER'), { ok: false, reason: 'unknown' }, 'bogus token is unknown');
}

/* Trap 3 — attempt budget: wrong guesses count down, then lock */
{
  let t = 0;
  const store = new CaptchaStore({ now: () => t, rng: makeSeededRng(31), maxAttempts: 3 });
  const ch = store.issue({ length: 6 });
  const wrong = ch.text === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';

  const r1 = store.verify(ch.token, wrong);
  eq(r1, { ok: false, reason: 'incorrect', attemptsLeft: 2 }, 'first wrong guess: 2 left');
  const r2 = store.verify(ch.token, wrong);
  eq(r2, { ok: false, reason: 'incorrect', attemptsLeft: 1 }, 'second wrong guess: 1 left');
  const r3 = store.verify(ch.token, wrong);
  eq(r3, { ok: false, reason: 'locked', attemptsLeft: 0 }, 'budget exhausted: locked');

  ok(!store.has(ch.token), 'locked token is burned from the store');
  // Even the CORRECT answer can no longer save a burned token.
  eq(store.verify(ch.token, ch.text), { ok: false, reason: 'unknown' }, 'burned token rejects even the right answer');
}

/* a correct guess before the budget is spent still wins */
{
  let t = 0;
  const store = new CaptchaStore({ now: () => t, rng: makeSeededRng(32), maxAttempts: 3 });
  const ch = store.issue({ length: 6 });
  const wrong = ch.text === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
  store.verify(ch.token, wrong); // burn one attempt
  ok(store.verify(ch.token, ch.text).ok, 'correct guess within budget still verifies');
}

/* expiry — a challenge past its TTL fails and is burned */
{
  let t = 0;
  const store = new CaptchaStore({ now: () => t, rng: makeSeededRng(41), ttlMs: 1000 });
  const ch = store.issue({});
  t = 1001; // one ms past expiry
  eq(store.verify(ch.token, ch.text), { ok: false, reason: 'expired' }, 'expired challenge rejects correct answer');
  ok(!store.has(ch.token), 'expired token is burned on verify');
}

/* a challenge exactly at the TTL boundary is still valid */
{
  let t = 0;
  const store = new CaptchaStore({ now: () => t, rng: makeSeededRng(42), ttlMs: 1000 });
  const ch = store.issue({});
  t = 1000; // exactly at expiry, not past it
  ok(store.verify(ch.token, ch.text).ok, 'challenge valid up to and including its expiry instant');
}

/* sweep — removes only the expired */
{
  let t = 0;
  const store = new CaptchaStore({ now: () => t, rng: makeSeededRng(51), ttlMs: 100 });
  const a = store.issue({});            // expires at 100
  t = 50;
  const b = store.issue({});            // expires at 150
  eq(store.size(), 2, 'two live challenges before sweep');
  t = 120;                              // a is expired, b is not
  eq(store.sweep(), 1, 'sweep removes exactly the one expired challenge');
  eq(store.size(), 1, 'one challenge survives sweep');
  ok(store.has(b.token) && !store.has(a.token), 'sweep kept the live one, dropped the dead one');
}

/* token uniqueness across many issues from one store */
{
  const store = new CaptchaStore({ rng: makeSeededRng(61) });
  const toks = new Set();
  for (let i = 0; i < 1000; i++) toks.add(store.issue({}).token);
  eq(toks.size, 1000, '1000 issued tokens are all unique');
}

/* ============================================================= */
/* Rendering geometry — buildGlyphs                               */
{
  const W = 280, H = 90;
  const glyphs = buildGlyphs('ABC234', { width: W, height: H, rng: makeSeededRng(5) });
  eq(glyphs.length, 6, 'one glyph per character');
  eq(glyphs.map((g) => g.char).join(''), 'ABC234', 'glyphs keep the challenge string, in order');
  ok(glyphs.every((g) => g.x >= 0 && g.x <= W), 'every glyph x is within the canvas width');
  ok(glyphs.every((g) => g.y >= 0 && g.y <= H), 'every glyph y is within the canvas height');
  ok(glyphs.every((g) => g.fontSize >= 34 && g.fontSize <= 46), 'font sizes stay within bounds');

  // Glyphs must read left-to-right: x strictly increases despite jitter.
  let ordered = true;
  for (let i = 1; i < glyphs.length; i++) if (glyphs[i].x <= glyphs[i - 1].x) ordered = false;
  ok(ordered, 'glyph x-positions are strictly left-to-right (jitter never reorders)');

  // Deterministic under a fixed seed.
  const again = buildGlyphs('ABC234', { width: W, height: H, rng: makeSeededRng(5) });
  eq(JSON.stringify(glyphs), JSON.stringify(again), 'same seed -> identical glyph geometry');
}

/* buildGlyphs with empty text is harmless */
{
  eq(buildGlyphs('', { rng: makeSeededRng(1) }).length, 0, 'empty text yields no glyphs');
}

/* buildNoise — counts and bounds */
{
  const W = 280, H = 90;
  const noise = buildNoise({ width: W, height: H, lines: 5, dots: 140, rng: makeSeededRng(9) });
  eq(noise.lines.length, 5, 'requested number of distractor lines');
  eq(noise.dots.length, 140, 'requested number of speckle dots');
  ok(noise.lines.every((l) => l.x1 >= 0 && l.x1 <= W && l.x2 >= 0 && l.x2 <= W), 'line x-coords on canvas');
  ok(noise.lines.every((l) => l.y1 >= 0 && l.y1 <= H && l.y2 >= 0 && l.y2 <= H), 'line y-coords on canvas');
  ok(noise.dots.every((d) => d.x >= 0 && d.x <= W && d.y >= 0 && d.y <= H), 'dots on canvas');
  ok(noise.dots.every((d) => d.r >= 1 && d.r <= 3), 'dot radii in range');

  const again = buildNoise({ width: W, height: H, lines: 5, dots: 140, rng: makeSeededRng(9) });
  eq(JSON.stringify(noise), JSON.stringify(again), 'same seed -> identical noise');
}

/* ============================================================= */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
