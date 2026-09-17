/*
 * factorial-core.js — the exact-arithmetic core of the Factorial Finder.
 *
 * The brief (karan/Projects → Numbers) is small and specific: "the factorial of
 * a positive integer n is the product n · (n-1) · … · 1, and 0! is defined as 1;
 * solve it using **both loops and recursion**." Both are here (`factorialLoop`
 * and `factorialRecursive`), and they agree exactly — because the one thing a
 * factorial cannot afford is to be approximate. `13!` is already `6227020800`,
 * past a 32-bit int; `21!` is past `Number.MAX_SAFE_INTEGER`, so `factorial(21)`
 * in plain float arithmetic is silently *wrong* in its low digits; `100!` is a
 * 158-digit number that a float can only render as `9.33e157`, having thrown
 * away 150 digits. So this core never uses a float for the value: every factorial
 * is an exact `BigInt`.
 *
 * On top of the two textbook methods it does three things the brief doesn't:
 *   1. a **fast** factorial (`factorialFast`) — a balanced divide-and-conquer
 *      product tree that is dramatically quicker than the linear method for large
 *      n, because it keeps the two operands of every multiply close in size;
 *   2. two facts about n! computed **without ever building n!** — the count of
 *      **trailing zeros** (Legendre's formula, exact) and the number of **decimal
 *      digits** (a sum of logs), each in a tiny fraction of the work the full
 *      number would cost; and
 *   3. the **inverse** — given a value, decide whether it is a factorial and, if
 *      so, of what n.
 *
 * This file is deliberately DOM-free, I/O-free and console-free: no `window`, no
 * `document`, no `fetch`. It runs identically in a browser (via a `<script>` tag,
 * exporting onto `window.FactorialCore`) and in Node (via `require`), so the test
 * suite in `tests.js` can prove its properties without a browser or a network.
 */

'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FactorialCore = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---- input validation ----------------------------------------------------
   * n is a *count* — a small, plain non-negative integer — even though n! is
   * enormous. We keep it as a Number and check it hard, because "factorial of
   * 3.5" or "factorial of -1" is not undefined behaviour to paper over, it is a
   * bad question that deserves an error.
   */
  function checkCount(n) {
    if (typeof n !== 'number' || !Number.isInteger(n)) {
      throw new TypeError('n must be an integer');
    }
    if (n < 0) throw new RangeError('n must be non-negative (0! is 1)');
    return n;
  }

  /* ---- parsing -------------------------------------------------------------
   * "1,000" / " 20 " -> 1000 / 20. Rejects decimals, signs and junk rather than
   * letting parseInt truncate "3.9" to 3 or read "12x" as 12.
   */
  function parseCount(str) {
    if (typeof str !== 'string') throw new TypeError('expected a string');
    var s = str.replace(/[,\s_]/g, '');
    if (!/^\d+$/.test(s)) {
      throw new SyntaxError('enter a whole non-negative number');
    }
    // A leading run of zeros ("007") is fine; parse in base 10.
    var n = Number(s);
    if (!Number.isSafeInteger(n)) {
      // We never need n anywhere near 2^53; refuse it up front with a clear
      // message instead of hanging trying to multiply that many terms.
      throw new RangeError('that count is far too large to compute');
    }
    return n;
  }

  /* ---- method 1: the loop --------------------------------------------------
   * The workhorse. One pass, one accumulator, exact BigInt throughout. This is
   * what everything else is checked against.
   */
  function factorialLoop(n) {
    checkCount(n);
    var acc = 1n;
    for (var i = 2; i <= n; i++) acc *= BigInt(i);
    return acc;
  }

  /* ---- method 2: the recursion ---------------------------------------------
   * The textbook definition, written as the textbook writes it: n! = n · (n-1)!,
   * with 0! = 1 as the base case. It is here because the brief asks for it, and
   * it is correct — but recursion depth grows with n, and a JS engine's call
   * stack is finite (a few thousand frames), so a naive `factorialRecursive(1e6)`
   * would overflow the stack, not run slowly. We guard that explicitly: past a
   * conservative depth we refuse and point the caller at the loop or the fast
   * method, rather than crashing with an opaque "Maximum call stack" error.
   */
  var RECURSION_LIMIT = 8000;
  function factorialRecursive(n) {
    checkCount(n);
    if (n > RECURSION_LIMIT) {
      throw new RangeError(
        'recursion is limited to n ≤ ' + RECURSION_LIMIT +
        ' (deeper would overflow the call stack); use factorialLoop / factorialFast');
    }
    return recur(n);
  }
  function recur(n) {
    if (n <= 1) return 1n;          // 0! and 1! are both 1 — the base case.
    return BigInt(n) * recur(n - 1);
  }

  /* ---- method 3: the fast one ----------------------------------------------
   * The linear methods do n-1 multiplications, but the accumulator gets huge, so
   * the *last* multiplies are (giant) × (tiny) — the worst shape for a bignum
   * multiply, which is fastest when its two operands are about the same size.
   * A balanced product tree fixes exactly that: split 2..n in half, recurse on
   * each half, multiply the two roughly-equal-sized results. Same exact answer,
   * but for large n it is far quicker (schoolbook/Karatsuba multiplication all
   * reward balanced operands). This is the method the UI uses for big inputs.
   */
  function factorialFast(n) {
    checkCount(n);
    if (n < 2) return 1n;
    return productRange(2, n);
  }
  // Product of the integers lo..hi inclusive, by divide and conquer.
  function productRange(lo, hi) {
    if (lo > hi) return 1n;
    if (lo === hi) return BigInt(lo);
    if (hi - lo === 1) return BigInt(lo) * BigInt(hi);
    var mid = lo + ((hi - lo) >> 1);
    return productRange(lo, mid) * productRange(mid + 1, hi);
  }

  /* ---- trailing zeros, without building n! ---------------------------------
   * n! ends in a run of zeros — one for every factor of 10 it contains, i.e. one
   * for every matched (2,5) pair among its factors. There are always more 2s than
   * 5s, so the count is just the number of 5s, and Legendre's formula gives that
   * directly: floor(n/5) + floor(n/25) + floor(n/125) + … . No multiplication,
   * no BigInt — you learn that 1000! ends in 249 zeros without forming its 2568
   * digits.
   */
  function trailingZeros(n) {
    checkCount(n);
    var count = 0;
    for (var p = 5; p <= n; p *= 5) count += Math.floor(n / p);
    return count;
  }

  /* ---- how many digits, without building n! --------------------------------
   * The number of decimal digits of a positive integer x is floor(log10 x) + 1,
   * and log10(n!) = log10(1) + log10(2) + … + log10(n) — a sum of n cheap floats
   * instead of a product of n growing bignums. So we can say "1,000,000! has
   * 5,565,709 digits" by adding a million logs, never forming the five-million-
   * digit number. This is a float estimate; it is exact for every n the tests
   * check it against, and the honest failure mode (a value landing a hair below
   * an integer power of ten) can only ever be off by one, never wildly wrong.
   */
  function digitCount(n) {
    checkCount(n);
    if (n < 2) return 1;                 // 0! = 1! = 1, one digit.
    var log10 = 0;
    for (var k = 2; k <= n; k++) log10 += Math.log10(k);
    return Math.floor(log10) + 1;
  }

  /* ---- the inverse ---------------------------------------------------------
   * Given a value, is it a factorial? Divide out 1, 2, 3, … : a factorial peels
   * cleanly down to 1, anything else leaves a remainder or shoots past. Accepts a
   * BigInt or an integer string. Returns n where value === n!, or null.
   */
  function inverseFactorial(value) {
    var v;
    if (typeof value === 'bigint') v = value;
    else if (typeof value === 'string') {
      if (!/^\d+$/.test(value.replace(/[,\s_]/g, ''))) return null;
      v = BigInt(value.replace(/[,\s_]/g, ''));
    } else if (typeof value === 'number' && Number.isInteger(value)) {
      v = BigInt(value);
    } else {
      return null;
    }
    if (v < 1n) return null;
    if (v === 1n) return 1;   // both 0! and 1! are 1; report the canonical n=1.
    var divisor = 1n;
    var k = 1;
    while (v > 1n) {
      k += 1;
      divisor = BigInt(k);
      if (v % divisor !== 0n) return null;
      v /= divisor;
    }
    return k;
  }

  /* ---- a compact report the UI can render ----------------------------------
   * One call that returns everything worth showing: the exact value plus the two
   * cheap facts, using the fast method for the value. Big values are returned as
   * a string so the caller never has to touch BigInt formatting.
   */
  function describe(n) {
    checkCount(n);
    var value = factorialFast(n);
    var str = value.toString();
    return {
      n: n,
      value: value,
      valueStr: str,
      exactDigits: str.length,        // exact, from the real number
      estimatedDigits: digitCount(n), // from the log sum, without the number
      trailingZeros: trailingZeros(n)
    };
  }

  return {
    checkCount: checkCount,
    parseCount: parseCount,
    factorialLoop: factorialLoop,
    factorialRecursive: factorialRecursive,
    factorialFast: factorialFast,
    productRange: productRange,
    trailingZeros: trailingZeros,
    digitCount: digitCount,
    inverseFactorial: inverseFactorial,
    describe: describe,
    RECURSION_LIMIT: RECURSION_LIMIT
  };
});
