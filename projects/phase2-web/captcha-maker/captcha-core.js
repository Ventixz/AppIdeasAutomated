/*
 * captcha-core.js — the engine behind the CAPTCHA Maker.
 *
 * Zero dependencies. Runs unchanged in Node (for `tests.js`) and in the browser
 * (for `script.js`). It knows nothing about canvas or the DOM: it produces the
 * challenge *text*, keeps the verifiable secret in a server-side-style store,
 * and emits pure geometry that the UI turns into pixels.
 *
 * The three things a CAPTCHA actually has to get right — a human-readable yet
 * bot-hostile alphabet, a secret that never leaves the "server" and verifies
 * safely, and a challenge that can't be replayed or brute-forced — all live
 * here so they can be tested without a browser.
 */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CaptchaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Node's crypto, if we're in Node. Guarded so the browser build ignores it.
  let nodeCrypto = null;
  if (typeof module !== 'undefined' && module.exports) {
    try { nodeCrypto = require('crypto'); } catch (e) { nodeCrypto = null; }
  }

  // ---------------------------------------------------------------------------
  // Trap 1's fix lives in this one string.
  //
  // The generation alphabet deliberately omits every glyph pair a tired human
  // confuses: 0/O, 1/I/L. If those never appear in a challenge, we never have to
  // "accept O for 0" at verify time, and a human is never failed for a machine's
  // ambiguity. 23 letters + 8 digits = 31 symbols, ~4.95 bits each.
  // ---------------------------------------------------------------------------
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  // -- secure randomness, uniform in [0, max) ---------------------------------
  // Everything random in a CAPTCHA is security-relevant, so the default source
  // is a CSPRNG. Tests inject a seeded rng of the same shape for determinism.
  function cryptoRandomInt(max) {
    if (!Number.isInteger(max) || max <= 0) throw new RangeError('max must be a positive integer');
    if (nodeCrypto && typeof nodeCrypto.randomInt === 'function') return nodeCrypto.randomInt(max);
    const g = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;
    if (g && typeof g.getRandomValues === 'function') {
      // Rejection sampling for a modulo-bias-free uniform draw.
      const limit = Math.floor(0x100000000 / max) * max;
      const buf = new Uint32Array(1);
      let x;
      do { g.getRandomValues(buf); x = buf[0]; } while (x >= limit);
      return x % max;
    }
    throw new Error('no secure RNG available in this environment');
  }

  // A seeded rng (mulberry32) with the SAME signature: rng(max) -> int [0,max).
  // Only for tests and reproducible demos — never the default.
  function makeSeededRng(seed) {
    let a = seed >>> 0;
    return function (max) {
      if (!Number.isInteger(max) || max <= 0) throw new RangeError('max must be a positive integer');
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(u * max);
    };
  }

  function randomText(length, rng) {
    const r = rng || cryptoRandomInt;
    let s = '';
    for (let i = 0; i < length; i++) s += ALPHABET[r(ALPHABET.length)];
    return s;
  }

  function randomToken(bytes, rng) {
    const r = rng || cryptoRandomInt;
    const hex = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < bytes * 2; i++) s += hex[r(16)];
    return s;
  }

  // Shannon entropy of a challenge, in bits — length * log2(alphabet size).
  function entropyBits(length, alphabetSize) {
    const size = alphabetSize || ALPHABET.length;
    return length * (Math.log(size) / Math.log(2));
  }

  // -- answer handling --------------------------------------------------------
  // Humans type with stray case and spaces; those are never the challenge, so
  // we fold them away before comparing. Everything is compared in this space.
  function normalize(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
  }

  // Constant-time string comparison: the loop runs over the longer string and
  // never short-circuits, so a timing attacker learns neither the length of a
  // match nor how many leading characters were right.
  function constantTimeEqual(a, b) {
    const x = String(a), y = String(b);
    const n = Math.max(x.length, y.length);
    let diff = x.length ^ y.length;
    for (let i = 0; i < n; i++) {
      diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    }
    return diff === 0;
  }

  // ---------------------------------------------------------------------------
  // CaptchaStore — stands in for the server.
  //
  // `issue()` hands the caller a token and the challenge *text* (the UI needs
  // the text to draw the image). The verifiable secret — the normalized answer,
  // the expiry, the attempt budget — is kept HERE, keyed by an opaque token, and
  // is never part of what a real deployment would ship to the browser.
  //
  // Trap 2 (replay) and Trap 3 (brute force) are both enforced in `verify()`:
  // a token is single-use on success AND burned after too many wrong guesses or
  // once expired, so a short code can't be hammered.
  // ---------------------------------------------------------------------------
  function CaptchaStore(opts) {
    opts = opts || {};
    this._m = new Map();
    this._now = opts.now || Date.now;
    this._rng = opts.rng || cryptoRandomInt;
    this._tokenBytes = opts.tokenBytes || 16;
    this.defaults = {
      length: opts.length || 6,
      ttlMs: opts.ttlMs != null ? opts.ttlMs : 2 * 60 * 1000,
      maxAttempts: opts.maxAttempts || 4,
    };
  }

  CaptchaStore.prototype._clock = function () {
    return typeof this._now === 'function' ? this._now() : Date.now();
  };

  CaptchaStore.prototype.issue = function (o) {
    o = o || {};
    const length = o.length || this.defaults.length;
    const ttlMs = o.ttlMs != null ? o.ttlMs : this.defaults.ttlMs;
    const maxAttempts = o.maxAttempts || this.defaults.maxAttempts;
    const text = randomText(length, this._rng);
    let token;
    do { token = randomToken(this._tokenBytes, this._rng); } while (this._m.has(token));
    this._m.set(token, {
      answer: normalize(text),
      expiresAt: this._clock() + ttlMs,
      attempts: 0,
      maxAttempts: maxAttempts,
    });
    return { token: token, text: text, expiresAt: this._clock() + ttlMs };
  };

  // Returns { ok, reason, attemptsLeft? }. reasons:
  //   'ok'        correct — token consumed, cannot be reused
  //   'unknown'   no such token (never issued, already used, or burned)
  //   'expired'   past its TTL — token burned
  //   'incorrect' wrong guess — attemptsLeft remain
  //   'locked'    wrong guess that exhausted the budget — token burned
  CaptchaStore.prototype.verify = function (token, guess) {
    const rec = this._m.get(token);
    if (!rec) return { ok: false, reason: 'unknown' };

    if (this._clock() > rec.expiresAt) {
      this._m.delete(token);
      return { ok: false, reason: 'expired' };
    }

    if (constantTimeEqual(rec.answer, normalize(guess))) {
      this._m.delete(token); // single-use: a solved challenge cannot be replayed
      return { ok: true, reason: 'ok' };
    }

    rec.attempts += 1;
    if (rec.attempts >= rec.maxAttempts) {
      this._m.delete(token); // brute-force budget spent — force a re-issue
      return { ok: false, reason: 'locked', attemptsLeft: 0 };
    }
    return { ok: false, reason: 'incorrect', attemptsLeft: rec.maxAttempts - rec.attempts };
  };

  // Drop every expired challenge; returns how many were swept. A real server
  // would call this on a timer so dead tokens don't accumulate.
  CaptchaStore.prototype.sweep = function () {
    const now = this._clock();
    let removed = 0;
    for (const entry of Array.from(this._m.entries())) {
      if (now > entry[1].expiresAt) { this._m.delete(entry[0]); removed++; }
    }
    return removed;
  };

  CaptchaStore.prototype.has = function (token) { return this._m.has(token); };
  CaptchaStore.prototype.size = function () { return this._m.size; };

  // ---------------------------------------------------------------------------
  // Pure rendering geometry — no canvas here, just numbers the UI draws.
  // Keeping it pure means the layout (glyphs on-canvas, in reading order,
  // non-degenerate) is unit-testable without a headless browser.
  // ---------------------------------------------------------------------------
  function buildGlyphs(text, opts) {
    opts = opts || {};
    const width = opts.width || 280;
    const height = opts.height || 90;
    const rng = opts.rng || cryptoRandomInt;
    const pad = opts.pad != null ? opts.pad : 18;
    const maxTilt = opts.maxTilt != null ? opts.maxTilt : 0.45; // radians
    const minFont = opts.minFont || 34;
    const maxFont = opts.maxFont || 46;
    const n = text.length;
    const slot = n > 0 ? (width - 2 * pad) / n : 0;
    const glyphs = [];
    for (let i = 0; i < n; i++) {
      const center = pad + slot * (i + 0.5);
      // Jitter is capped well under half a slot, so glyph centers stay in
      // reading order and never collide into their neighbour's slot.
      const jitterX = (rng(1000) / 1000 - 0.5) * slot * 0.3;
      const cy = height / 2 + (rng(1000) / 1000 - 0.5) * height * 0.18;
      const rotation = (rng(1000) / 1000 - 0.5) * 2 * maxTilt;
      const fontSize = minFont + rng(maxFont - minFont + 1);
      glyphs.push({
        char: text[i],
        x: center + jitterX,
        y: cy,
        rotation: rotation,
        fontSize: fontSize,
        hue: rng(360),
      });
    }
    return glyphs;
  }

  function buildNoise(opts) {
    opts = opts || {};
    const width = opts.width || 280;
    const height = opts.height || 90;
    const rng = opts.rng || cryptoRandomInt;
    const lineCount = opts.lines != null ? opts.lines : 5;
    const dotCount = opts.dots != null ? opts.dots : 140;
    const lines = [];
    for (let i = 0; i < lineCount; i++) {
      lines.push({
        x1: rng(width), y1: rng(height),
        x2: rng(width), y2: rng(height),
        hue: rng(360),
      });
    }
    const dots = [];
    for (let i = 0; i < dotCount; i++) {
      dots.push({ x: rng(width), y: rng(height), r: 1 + rng(2) });
    }
    return { lines: lines, dots: dots };
  }

  return {
    ALPHABET: ALPHABET,
    cryptoRandomInt: cryptoRandomInt,
    makeSeededRng: makeSeededRng,
    randomText: randomText,
    randomToken: randomToken,
    entropyBits: entropyBits,
    normalize: normalize,
    constantTimeEqual: constantTimeEqual,
    CaptchaStore: CaptchaStore,
    buildGlyphs: buildGlyphs,
    buildNoise: buildNoise,
  };
});
