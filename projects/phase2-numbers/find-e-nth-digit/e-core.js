/*
 * e-core.js — compute e (Euler's number) to the Nth digit, exactly, with no
 * dependencies.
 *
 * As with π, the point of "Find e to the Nth Digit" is arbitrary precision: a
 * JavaScript `number` is a 64-bit float and gives out after ~15 significant
 * digits, so `Math.E` cannot answer the question for N = 50, let alone 1000.
 * Everything here is done in **integers** using BigInt, which is exact and
 * unbounded. There is no floating-point value used anywhere in the maths.
 *
 * Method: the defining Taylor series (Euler, 1748),
 *
 *     e = 1/0! + 1/1! + 1/2! + 1/3! + 1/4! + …  =  Σ 1/k!
 *
 * summed entirely in scaled integers: we multiply through by 10^(N+guard), so
 * every term 10^(N+guard)/k! is a big integer. Factorials grow faster than any
 * exponential, so the series converges extremely fast — only a few thousand
 * terms are needed even for tens of thousands of digits, and each term is a
 * single BigInt division. A handful of guard digits absorb the truncation error
 * so the last digit we report is correct.
 *
 * This file is pure logic — no DOM, no console, no I/O — so it runs unchanged in
 * the browser (index.html) and under Node (tests.js).
 */

'use strict';

/**
 * The scaled Taylor sum for e: returns round-down(e * scale) computed as an
 * exact BigInt, where `scale` is a power of ten.
 *
 * We keep a running factorial term `term = scale / k!` by dividing by k each
 * step, and add it in. When `term` reaches 0 (k! has outgrown `scale`) every
 * remaining term is 0 too, so the loop stops. Each division floors, so the
 * result is at most a few units below the true e*scale — the caller's guard
 * digits soak that up.
 *
 * @param {bigint} scale 10^k — the fixed-point scaling factor (> 0)
 * @returns {bigint}
 */
function eSeriesScaled(scale) {
  if (scale <= 0n) {
    throw new RangeError('eSeriesScaled expects a positive scale');
  }
  let term = scale; // k = 0: scale / 0! = scale
  let total = term;
  let k = 1n;
  while (term !== 0n) {
    term = term / k; // scale / k!  =  (scale / (k-1)!) / k
    total += term;
    k += 1n;
  }
  return total;
}

/**
 * Compute e as an integer equal to floor(e * 10^digits).
 *
 * @param {number} digits number of digits AFTER the decimal point (>= 0)
 * @returns {bigint} e.g. digits=5 -> 271828n
 */
function eScaledInteger(digits) {
  if (!Number.isInteger(digits) || digits < 0) {
    throw new RangeError('digits must be a non-negative integer');
  }
  // Extra guard digits so the final reported digit is not spoiled by the
  // series truncation. Twelve is comfortably more than the series needs: the
  // total truncation deficit is under one unit per term (a few thousand at
  // most), far below 10^12.
  const guard = 12;
  const scale = 10n ** BigInt(digits + guard);
  const e = eSeriesScaled(scale);
  // Drop the guard digits by truncation. "The Nth digit of e" means the digit
  // that actually appears there, so we take the exact expansion and cut it off
  // (floor) rather than rounding the last place up.
  return e / (10n ** BigInt(guard));
}

/**
 * e as a decimal string "2.71828…" with exactly `digits` digits after the
 * decimal point. `digits = 0` yields "2".
 *
 * @param {number} digits
 * @returns {string}
 */
function eString(digits) {
  const n = eScaledInteger(digits);
  const s = n.toString(); // "2" followed by `digits` more characters
  if (digits === 0) return s;
  return s[0] + '.' + s.slice(1);
}

/**
 * The single Nth digit of e, where N is 1-indexed:
 *   N = 1 -> "2" (the integer part)
 *   N = 2 -> "7" (first decimal), N = 3 -> "1", N = 4 -> "8", ...
 *
 * @param {number} n 1-indexed digit position (>= 1)
 * @returns {string} a single character '0'..'9'
 */
function nthDigit(n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError('n must be a positive integer (1-indexed)');
  }
  // Digit N sits `N-1` places after "2.", so compute that many decimals.
  const s = eScaledInteger(n - 1).toString();
  return s[n - 1];
}

// Export for Node (tests.js); attach to window for the browser (index.html).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { eSeriesScaled, eScaledInteger, eString, nthDigit };
} else if (typeof window !== 'undefined') {
  window.ECore = { eSeriesScaled, eScaledInteger, eString, nthDigit };
}
