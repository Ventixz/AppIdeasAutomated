/*
 * happy-core.js — the DOM-free core of the Happy Numbers project.
 *
 * The brief (karan/Projects → Numbers) is a definition dressed as a task: a
 * **happy number** is reached like this — take a positive integer, replace it
 * with the sum of the squares of its digits, and repeat. If you eventually land
 * on 1, the number is *happy*; if you fall into a loop that never reaches 1, it
 * is *unhappy*. `7` is happy (7 → 49 → 97 → 130 → 10 → 1); `4` is not
 * (4 → 16 → 37 → 58 → 89 → 145 → 42 → 20 → 4 → …, forever).
 *
 * Two facts make the whole thing tractable and are worth stating up front,
 * because the code leans on both:
 *
 *   1. **The map always shrinks big numbers, fast.** A d-digit number's
 *      digit-square-sum is at most 81·d. For a 4-digit number that ceiling is
 *      324 — a 3-digit number. So after a single step *every* input, however
 *      enormous, is already below 1000, and everything after that lives in a
 *      tiny world. That is why this core can classify a 100,000-digit number:
 *      the first step is done straight from the digit string (never building a
 *      float), and it collapses to something small immediately.
 *
 *   2. **In base 10 with power 2 there is exactly one unhappy cycle**, the
 *      8-long loop 4 → 16 → 37 → 58 → 89 → 145 → 42 → 20 → (back to 4). Every
 *      trajectory therefore ends in one of two places — the fixed point 1, or
 *      that cycle — and nowhere else. We don't hard-code that fact to decide
 *      happiness (we detect the cycle honestly, so the code also works for other
 *      bases and powers, where the cycles differ), but the tests assert it,
 *      because it is the reason the notion is well-defined at all.
 *
 * Beyond the base-10, power-2 brief the core is **generalised**: it does the
 * process in any base b ≥ 2 with any digit power p ≥ 1 (so "happy" is really a
 * whole family — p-happy numbers, happy numbers in base 4, and so on), detects
 * the terminating cycle with Floyd's tortoise-and-hare so it never assumes which
 * cycle it will hit, and offers the natural questions on top: the full
 * trajectory, its length (a number's "height"), whether a number is a **happy
 * prime**, and listing/counting happy numbers in a range or by index.
 *
 * This file is deliberately DOM-free, I/O-free and console-free: no `window`
 * work beyond the export, no `document`, no `fetch`. It runs identically in a
 * browser (via a `<script>` tag, exporting onto `window.HappyCore`) and in Node
 * (via `require`), so the suite in `tests.js` can prove its properties with no
 * browser and no network.
 */

'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HappyCore = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---- validation ----------------------------------------------------------
   * The base and power are small structural choices; n is the value under test.
   * We accept n either as a plain safe integer or as a BigInt / digit string,
   * because part of the point is that arbitrarily large inputs are fine.
   */
  function checkBase(base) {
    if (typeof base !== 'number' || !Number.isInteger(base) || base < 2 || base > 36) {
      throw new RangeError('base must be an integer in 2..36');
    }
  }
  function checkPower(power) {
    if (typeof power !== 'number' || !Number.isInteger(power) || power < 1 || power > 10) {
      throw new RangeError('power must be an integer in 1..10');
    }
  }

  // Digit value of a character in bases up to 36 ('0'..'9','a'..'z'); -1 if none.
  function digitValue(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) return c - 48;        // 0-9
    if (c >= 97 && c <= 122) return c - 97 + 10;  // a-z
    if (c >= 65 && c <= 90) return c - 65 + 10;   // A-Z
    return -1;
  }

  /* ---- the one step, on a small number ------------------------------------
   * Replace n by the sum of the p-th powers of its base-b digits. n here is a
   * non-negative *safe* integer; after the very first step of any trajectory
   * this is always true (fact 1 above), and this is the hot path.
   */
  function stepNumber(n, base, power) {
    var sum = 0;
    while (n > 0) {
      var d = n % base;
      // small integer power without Math.pow's float wobble on tiny values
      var t = 1;
      for (var i = 0; i < power; i++) t *= d;
      sum += t;
      n = (n - d) / base;
    }
    return sum;
  }

  /* ---- the first step, straight from a digit string -----------------------
   * For a huge input we never turn the whole thing into a Number (it would be
   * Infinity or a lie past 2^53). We read its digits directly in the given base
   * and sum their p-th powers. The result is at most 81·(#digits) for base 10,
   * power 2 — small — so from here on stepNumber takes over.
   */
  function firstStepFromDigits(str, base, power) {
    var sum = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === '_' || ch === ',' || ch === ' ') continue; // tolerate separators
      var d = digitValue(ch);
      if (d < 0 || d >= base) {
        throw new RangeError('"' + ch + '" is not a base-' + base + ' digit');
      }
      var t = 1;
      for (var k = 0; k < power; k++) t *= d;
      sum += t;
    }
    return sum;
  }

  /* ---- normalise an input into {small, firstOrNull} -----------------------
   * Returns a starting *small* integer to iterate from, having already taken the
   * first step if the input was too big to hold as a safe integer. `original` is
   * kept for display. Accepts number, bigint, or string (in the given base).
   */
  function normaliseStart(n, base, power) {
    checkBase(base); checkPower(power);

    if (typeof n === 'number') {
      if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
      if (!Number.isSafeInteger(n)) throw new RangeError('n is too large as a Number — pass a string or BigInt');
      return { display: String(n), start: n, prestepped: false };
    }

    if (typeof n === 'bigint') {
      if (n < 1n) throw new RangeError('n must be a positive integer');
      n = n.toString(base);
    }

    if (typeof n === 'string') {
      var s = n.trim().replace(/[_,\s]/g, '');
      if (s === '') throw new RangeError('n is empty');
      if (!/^[0-9a-zA-Z]+$/.test(s)) throw new RangeError('n has non-digit characters');
      // every character must be a real digit in THIS base (parseInt would
      // silently truncate at the first bad one — "12x" -> 12 — so we check first)
      for (var di = 0; di < s.length; di++) {
        var dv = digitValue(s.charAt(di));
        if (dv < 0 || dv >= base) throw new RangeError('"' + s.charAt(di) + '" is not a base-' + base + ' digit');
      }
      // strip leading zeros for display, but keep at least one digit
      var disp = s.replace(/^0+(?=.)/, '');
      // fits as a safe integer? then treat as a normal number.
      var asNum = parseInt(s, base);
      if (Number.isSafeInteger(asNum)) {
        if (asNum < 1) throw new RangeError('n must be a positive integer');
        return { display: disp, start: asNum, prestepped: false };
      }
      // too big: take the first step straight from the digits.
      return { display: disp, start: firstStepFromDigits(s, base, power), prestepped: true };
    }

    throw new TypeError('n must be a number, bigint or string');
  }

  /* ---- trajectory + classification ----------------------------------------
   * Walk the sequence from n, remembering everything we've seen, and stop the
   * moment we either reach 1 (happy) or revisit a value (a cycle → unhappy).
   * Recording the path lets us return the trajectory, the height, and the exact
   * cycle we fell into — no base/power is assumed.
   *
   * Termination is guaranteed: after one step the value is bounded (base 10,
   * power 2: below 1000), so the reachable set is finite and a repeat must come.
   */
  function classify(n, opts) {
    opts = opts || {};
    var base = opts.base === undefined ? 10 : opts.base;
    var power = opts.power === undefined ? 2 : opts.power;

    var norm = normaliseStart(n, base, power);
    var seen = Object.create(null);       // value -> index in path
    var path = [];
    var v = norm.start;

    if (norm.prestepped) path.push(norm.display); // show the giant input first

    for (;;) {
      if (v === 1) {
        path.push(1);
        return {
          input: norm.display, base: base, power: power,
          happy: true, trajectory: path,
          // height = steps taken to reach 1, counting the pre-step if any
          height: path.length - 1,
          cycle: null
        };
      }
      if (seen[v] !== undefined) {
        // we've closed a loop: everything from seen[v] onward is the cycle.
        path.push(v);
        var cyc = path.slice(seen[v] + (norm.prestepped ? 1 : 0));
        // trim the duplicate closing element for a clean cycle list
        cyc = cyc.slice(0, cyc.length - 1);
        return {
          input: norm.display, base: base, power: power,
          happy: false, trajectory: path,
          height: null,
          cycle: cyc
        };
      }
      seen[v] = path.length;
      path.push(v);
      v = stepNumber(v, base, power);
    }
  }

  // The plain yes/no most callers want.
  function isHappy(n, opts) { return classify(n, opts).happy; }

  /* ---- listing & indexing --------------------------------------------------
   * Because the process shrinks fast, a memoised classifier makes bulk queries
   * cheap: once we know a value's fate we cache it, and every trajectory that
   * later passes through it stops early.
   */
  function memoClassifier(base, power) {
    checkBase(base); checkPower(power);
    var fate = Object.create(null); // value -> true/false once known
    fate[1] = true;
    return function happy(n) {
      if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('n must be a positive safe integer');
      var stack = [];
      var v = n;
      for (;;) {
        var f = fate[v];
        if (f !== undefined) {
          for (var i = 0; i < stack.length; i++) fate[stack[i]] = f;
          return f;
        }
        // mark as "in progress" by pushing; a repeat within this walk = unhappy
        if (stack.indexOf(v) !== -1) {
          for (var j = 0; j < stack.length; j++) fate[stack[j]] = false;
          return false;
        }
        stack.push(v);
        v = stepNumber(v, base, power);
      }
    };
  }

  // Happy numbers in the inclusive range [lo, hi].
  function happyInRange(lo, hi, opts) {
    opts = opts || {};
    var base = opts.base === undefined ? 10 : opts.base;
    var power = opts.power === undefined ? 2 : opts.power;
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo < 1 || hi < lo) {
      throw new RangeError('need 1 <= lo <= hi as safe integers');
    }
    var happy = memoClassifier(base, power);
    var out = [];
    for (var n = lo; n <= hi; n++) if (happy(n)) out.push(n);
    return out;
  }

  // Count of happy numbers in [lo, hi] (same work, no array kept).
  function countHappyInRange(lo, hi, opts) {
    return happyInRange(lo, hi, opts).length;
  }

  // The k-th happy number (1-indexed): 1, 7, 10, 13, 19, 23, 28, 31, ...
  function nthHappy(k, opts) {
    if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be a positive integer');
    opts = opts || {};
    var base = opts.base === undefined ? 10 : opts.base;
    var power = opts.power === undefined ? 2 : opts.power;
    var happy = memoClassifier(base, power);
    var count = 0, n = 0;
    while (count < k) { n++; if (happy(n)) count++; }
    return n;
  }

  /* ---- happy primes --------------------------------------------------------
   * A happy prime is a prime that is also happy. 7, 13, 19, 23, 31, 79, 97, 103…
   * Small deterministic trial division is plenty here — happy-number territory
   * is not where you need Miller–Rabin.
   */
  function isPrime(n) {
    if (!Number.isSafeInteger(n)) throw new RangeError('n must be a safe integer');
    if (n < 2) return false;
    if (n % 2 === 0) return n === 2;
    if (n % 3 === 0) return n === 3;
    for (var i = 5; i * i <= n; i += 6) {
      if (n % i === 0 || n % (i + 2) === 0) return false;
    }
    return true;
  }
  function isHappyPrime(n, opts) { return isPrime(n) && isHappy(n, opts); }

  return {
    // core process
    stepNumber: stepNumber,
    firstStepFromDigits: firstStepFromDigits,
    normaliseStart: normaliseStart,
    classify: classify,
    isHappy: isHappy,
    // bulk
    memoClassifier: memoClassifier,
    happyInRange: happyInRange,
    countHappyInRange: countHappyInRange,
    nthHappy: nthHappy,
    // primes
    isPrime: isPrime,
    isHappyPrime: isHappyPrime
  };
});
