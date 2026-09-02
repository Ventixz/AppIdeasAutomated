/*
 * pi-core.js — compute π to the Nth digit, exactly, with no dependencies.
 *
 * The whole point of "Find PI to the Nth Digit" is arbitrary precision: a
 * JavaScript `number` is a 64-bit float and gives out after ~15 significant
 * digits, so `Math.PI` cannot answer the question for N = 50, let alone 1000.
 * Everything here is done in **integers** using BigInt, which is exact and
 * unbounded, and the only floating-point value in the file is the one we never
 * use for the maths.
 *
 * Method: Machin's formula (1706),
 *
 *     π = 16·arctan(1/5) − 4·arctan(1/239)
 *
 * arctan(1/x) is summed from its Taylor series
 *
 *     arctan(1/x) = 1/x − 1/(3·x³) + 1/(5·x⁵) − …
 *
 * entirely in scaled integers: we multiply through by 10^(N+guard), so every
 * term is a big integer, and the alternating series converges fast because
 * 1/5 and 1/239 are small. A handful of guard digits absorb the truncation
 * error so the last digit we report is correct.
 *
 * This file is pure logic — no DOM, no console, no I/O — so it runs unchanged
 * in the browser (index.html) and under Node (tests.js).
 */

'use strict';

/**
 * arctan(1/x), scaled by `scale` (a power of ten), as an exact BigInt.
 * Returns round(arctan(1/x) * scale).
 *
 * @param {bigint} x     the reciprocal base, e.g. 5n or 239n
 * @param {bigint} scale 10^k — the fixed-point scaling factor
 * @returns {bigint}
 */
function arctanReciprocal(x, scale) {
  if (x <= 1n) {
    throw new RangeError('arctanReciprocal expects x > 1 for convergence');
  }
  const x2 = x * x;
  // First term: (1/x)*scale.
  let power = scale / x; // running value of scale / x^(2k+1)
  let total = power;
  let divisor = 1n; // the odd number 1, 3, 5, ...
  let subtract = true; // signs alternate: -, +, -, +, ...
  while (power !== 0n) {
    power = power / x2; // advance to the next odd power of 1/x
    divisor += 2n;
    const term = power / divisor;
    total = subtract ? total - term : total + term;
    subtract = !subtract;
  }
  return total;
}

/**
 * Compute π as an integer equal to round(π * 10^digits).
 *
 * @param {number} digits number of digits AFTER the decimal point (>= 0)
 * @returns {bigint} e.g. digits=5 -> 314159n
 */
function piScaledInteger(digits) {
  if (!Number.isInteger(digits) || digits < 0) {
    throw new RangeError('digits must be a non-negative integer');
  }
  // Extra guard digits so the final reported digit is not spoiled by the
  // series truncation. Ten is comfortably more than Machin's formula needs.
  const guard = 10;
  const scale = 10n ** BigInt(digits + guard);
  const pi = 16n * arctanReciprocal(5n, scale) - 4n * arctanReciprocal(239n, scale);
  // Drop the guard digits by truncation. "The Nth digit of pi" means the digit
  // that actually appears there, so we take the exact expansion and cut it off
  // (floor) rather than rounding the last place up. The guard digits ensure the
  // series truncation cannot disturb any digit we keep.
  return pi / (10n ** BigInt(guard));
}

/**
 * π as a decimal string "3.1415…" with exactly `digits` digits after the
 * decimal point. `digits = 0` yields "3".
 *
 * @param {number} digits
 * @returns {string}
 */
function piString(digits) {
  const n = piScaledInteger(digits);
  const s = n.toString(); // "3" followed by `digits` more characters
  if (digits === 0) return s;
  return s[0] + '.' + s.slice(1);
}

/**
 * The single Nth digit of π, where N is 1-indexed:
 *   N = 1 -> "3" (the integer part)
 *   N = 2 -> "1" (first decimal), N = 3 -> "4", ...
 *
 * @param {number} n 1-indexed digit position (>= 1)
 * @returns {string} a single character '0'..'9'
 */
function nthDigit(n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError('n must be a positive integer (1-indexed)');
  }
  // Digit N sits `N-1` places after "3.", so compute that many decimals.
  const s = piScaledInteger(n - 1).toString();
  return s[n - 1];
}

// Export for Node (tests.js); attach to window for the browser (index.html).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { arctanReciprocal, piScaledInteger, piString, nthDigit };
} else if (typeof window !== 'undefined') {
  window.PiCore = { arctanReciprocal, piScaledInteger, piString, nthDigit };
}
