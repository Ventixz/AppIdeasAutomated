/*
 * fib-core.js — generate the Fibonacci sequence, exactly, with no dependencies.
 *
 * The spec ("Enter a number and generate the Fibonacci sequence to that number,
 * or to the Nth number") hides the same trap as the π and e projects: Fibonacci
 * numbers grow exponentially — F(79) already exceeds Number.MAX_SAFE_INTEGER
 * (2^53 − 1) — so a plain JavaScript `number` silently starts returning wrong,
 * rounded values. Everything here is therefore done in **integers** with BigInt,
 * which is exact and unbounded. No floating-point value is used in the maths.
 *
 * Indexing convention (0-indexed, the mathematical standard):
 *     F(0) = 0, F(1) = 1, F(2) = 1, F(3) = 2, F(4) = 3, F(5) = 5, F(6) = 8, …
 *     F(n) = F(n-1) + F(n-2)
 *
 * Two generators cover the two things the spec asks for:
 *   - the first N terms of the sequence            (fibSequence)
 *   - every term not exceeding a given value        (fibUpTo)
 * plus a single-term lookup that uses fast doubling so even F(1_000_000) is a
 * fraction of a second rather than a million additions.
 *
 * This file is pure logic — no DOM, no console, no I/O — so it runs unchanged in
 * the browser (index.html) and under Node (tests.js).
 */

'use strict';

/**
 * The first `count` Fibonacci numbers, as an array of BigInt, starting from
 * F(0) = 0. `count = 0` yields [].
 *
 *   fibSequence(1)  -> [0n]
 *   fibSequence(2)  -> [0n, 1n]
 *   fibSequence(7)  -> [0n, 1n, 1n, 2n, 3n, 5n, 8n]
 *
 * Built iteratively: each new term is the sum of the previous two, so producing
 * N terms costs N-1 BigInt additions — no wasted recomputation.
 *
 * @param {number} count how many terms to produce (>= 0)
 * @returns {bigint[]}
 */
function fibSequence(count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('count must be a non-negative integer');
  }
  const out = [];
  let a = 0n; // F(0)
  let b = 1n; // F(1)
  for (let i = 0; i < count; i++) {
    out.push(a);
    const next = a + b;
    a = b;
    b = next;
  }
  return out;
}

/**
 * Every Fibonacci number less than or equal to `max`, as an array of BigInt,
 * starting from F(0) = 0.
 *
 *   fibUpTo(0n)  -> [0n]
 *   fibUpTo(1n)  -> [0n, 1n, 1n]        (both F(1) and F(2) equal 1)
 *   fibUpTo(10n) -> [0n, 1n, 1n, 2n, 3n, 5n, 8n]
 *
 * @param {bigint} max inclusive upper bound (>= 0)
 * @returns {bigint[]}
 */
function fibUpTo(max) {
  if (typeof max !== 'bigint') {
    throw new TypeError('max must be a BigInt');
  }
  if (max < 0n) {
    throw new RangeError('max must be non-negative');
  }
  const out = [];
  let a = 0n;
  let b = 1n;
  while (a <= max) {
    out.push(a);
    const next = a + b;
    a = b;
    b = next;
  }
  return out;
}

/**
 * The single Nth Fibonacci number, 0-indexed, via fast doubling.
 *
 *   fibAt(0) -> 0n, fibAt(1) -> 1n, fibAt(10) -> 55n, fibAt(100) -> 354224848179261915075n
 *
 * Fast doubling uses the identities
 *     F(2k)   = F(k) · (2·F(k+1) − F(k))
 *     F(2k+1) = F(k+1)² + F(k)²
 * to climb the binary expansion of n, so it needs only ~log2(n) steps instead of
 * n additions — F(1_000_000) returns almost instantly.
 *
 * @param {number} n 0-indexed position (>= 0)
 * @returns {bigint}
 */
function fibAt(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError('n must be a non-negative integer');
  }
  return fibPair(n)[0];
}

/**
 * Returns the pair [F(n), F(n+1)] as BigInt, computed by fast doubling.
 * @param {number} n
 * @returns {[bigint, bigint]}
 */
function fibPair(n) {
  if (n === 0) return [0n, 1n];
  const [a, b] = fibPair(Math.floor(n / 2)); // a = F(k), b = F(k+1)
  const c = a * (2n * b - a);                // F(2k)
  const d = a * a + b * b;                    // F(2k+1)
  if (n % 2 === 0) {
    return [c, d];
  }
  return [d, c + d]; // [F(2k+1), F(2k+2)]
}

// Export for Node (tests.js); attach to window for the browser (index.html).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fibSequence, fibUpTo, fibAt, fibPair };
} else if (typeof window !== 'undefined') {
  window.FibCore = { fibSequence, fibUpTo, fibAt, fibPair };
}
