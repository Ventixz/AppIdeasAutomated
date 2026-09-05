/*
 * factor-core.js — prime factorization, exactly, with no dependencies.
 *
 * The spec ("Prime Factorization — Have the user enter a number and find all
 * Prime Factors") looks like a one-liner: divide out 2, then every odd number
 * up to sqrt(n). And for small inputs it is. The trap is the same one the π, e
 * and Fibonacci projects hit — scale:
 *
 *   1. Trial division to sqrt(n) is O(sqrt(n)) divisions. For a 12-digit
 *      semiprime that's ~10^6 steps (fine); for a 20-digit one it's ~10^10
 *      (a browser tab hanging for minutes). Factoring is genuinely hard.
 *   2. A JavaScript `number` loses integer precision past 2^53 − 1 (16 digits),
 *      so "the number the user typed" and "the number being divided" quietly
 *      stop being equal. Everything here is therefore BigInt — exact, unbounded.
 *
 * So this core does trial division only for the small factors, then switches to
 * **Pollard's rho** (with a **Miller–Rabin** primality test to know when to
 * stop). That factors 18–20 digit numbers in milliseconds instead of minutes,
 * which is what makes "enter a number" actually usable rather than a toy.
 *
 * This file is pure logic — no DOM, no console, no I/O — so it runs unchanged in
 * the browser (index.html) and under Node (tests.js).
 */

'use strict';

/* ---- modular arithmetic helpers (all BigInt) ---------------------------- */

// (a * b) mod m, with a, b, m all BigInt. BigInt multiply is already exact and
// unbounded, so no need for the add-and-double trick used in fixed-width langs.
function mulmod(a, b, m) {
  return ((a % m) * (b % m)) % m;
}

// (base ^ exp) mod m, by square-and-multiply. exp >= 0.
function powmod(base, exp, m) {
  let result = 1n;
  base %= m;
  while (exp > 0n) {
    if (exp & 1n) result = mulmod(result, base, m);
    base = mulmod(base, base, m);
    exp >>= 1n;
  }
  return result;
}

// Greatest common divisor (Euclid), on BigInt. Always returns a non-negative.
function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

// Integer square root of a non-negative BigInt, via Newton's method. Used only
// to size the trial-division bound; correctness never depends on it being tight.
function isqrt(n) {
  if (n < 0n) throw new RangeError('isqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/* ---- primality: deterministic Miller–Rabin ------------------------------ */

// A fixed set of witnesses that makes Miller–Rabin *deterministic* for every
// n < 3.3 * 10^24 — comfortably past anything a person types into the box.
// (The first 12 primes are a known-sufficient witness set for that range.)
const MR_WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

/**
 * Is `n` prime? Deterministic for all n < ~3.3e24 (see MR_WITNESSES), and a
 * strong probabilistic test beyond that.
 * @param {bigint} n
 * @returns {boolean}
 */
function isProbablePrime(n) {
  if (typeof n !== 'bigint') throw new TypeError('isProbablePrime expects a BigInt');
  if (n < 2n) return false;
  for (const p of MR_WITNESSES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  // write n - 1 = d * 2^r with d odd
  let d = n - 1n;
  let r = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    r++;
  }
  witness: for (const a of MR_WITNESSES) {
    let x = powmod(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 1n; i < r; i++) {
      x = mulmod(x, x, n);
      if (x === n - 1n) continue witness;
    }
    return false;
  }
  return true;
}

/* ---- one non-trivial factor: Pollard's rho ------------------------------ */

// Pollard's rho with Brent's cycle detection. Returns a non-trivial factor of
// the *composite* n (never call it on a prime or on n <= 3). It's randomised, so
// it retries with a different polynomial constant if a run degenerates.
function pollardRho(n) {
  if (n % 2n === 0n) return 2n;
  if (n % 3n === 0n) return 3n;

  // A small deterministic PRNG so results are reproducible across runs/tests.
  let seed = 2n;
  const rand = (limit) => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return (seed % limit) + 1n;
  };

  while (true) {
    const c = rand(n - 1n);
    const f = (x) => (mulmod(x, x, n) + c) % n;
    let x = rand(n - 1n);
    let y = x;
    let d = 1n;
    while (d === 1n) {
      x = f(x);
      y = f(f(y));
      const diff = x > y ? x - y : y - x;
      d = gcd(diff, n);
    }
    if (d !== n) return d; // a proper factor
    // d === n: this constant failed, pick another and try again.
  }
}

/* ---- the public API ----------------------------------------------------- */

/**
 * The full prime factorization of `n`, as an array of [prime, exponent] pairs,
 * both BigInt, sorted by ascending prime.
 *
 *   factorize(1n)     -> []                       (1 has no prime factors)
 *   factorize(12n)    -> [[2n, 2n], [3n, 1n]]     (12 = 2^2 * 3)
 *   factorize(17n)    -> [[17n, 1n]]              (a prime is its own factor)
 *   factorize(360n)   -> [[2n, 3n], [3n, 2n], [5n, 1n]]
 *
 * Trial-divides the small primes first (which strips the common factors cheaply
 * and leaves a hard core), then uses Pollard's rho + Miller–Rabin on whatever
 * remains.
 *
 * @param {bigint} n integer >= 1
 * @returns {Array<[bigint, bigint]>}
 */
function factorize(n) {
  if (typeof n !== 'bigint') throw new TypeError('factorize expects a BigInt');
  if (n < 1n) throw new RangeError('factorize expects an integer >= 1');
  if (n === 1n) return [];

  const counts = new Map(); // prime(BigInt as string) -> exponent(BigInt)
  const add = (p) => counts.set(p.toString(), (counts.get(p.toString()) || 0n) + 1n);

  // 1) Strip small primes by trial division. This alone finishes numbers whose
  //    factors are all small, and shrinks the rest before the expensive stage.
  const SMALL_BOUND = 100000n;
  let m = n;
  for (let p = 2n; p <= SMALL_BOUND && p * p <= m; p += p === 2n ? 1n : 2n) {
    while (m % p === 0n) {
      add(p);
      m /= p;
    }
  }

  // 2) Whatever's left has no factor below SMALL_BOUND. Factor it recursively
  //    with rho, using Miller–Rabin to recognise primes (the base case).
  const stack = [];
  if (m > 1n) stack.push(m);
  while (stack.length) {
    const v = stack.pop();
    if (v === 1n) continue;
    if (isProbablePrime(v)) {
      add(v);
      continue;
    }
    const d = pollardRho(v);
    stack.push(d, v / d);
  }

  // Sort pairs by ascending prime and return as [bigint, bigint].
  return [...counts.entries()]
    .map(([p, e]) => [BigInt(p), e])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Render a factorization as a human string, e.g. "2^2 * 3 * 5".
 * factorize(1n) -> "1" (the empty product).
 * @param {Array<[bigint, bigint]>} pairs
 * @returns {string}
 */
function formatFactorization(pairs) {
  if (!pairs.length) return '1';
  return pairs
    .map(([p, e]) => (e === 1n ? p.toString() : p.toString() + '^' + e.toString()))
    .join(' * ');
}

/**
 * Multiply a factorization back out — used by the tests to prove the product of
 * the factors equals the original number.
 * @param {Array<[bigint, bigint]>} pairs
 * @returns {bigint}
 */
function product(pairs) {
  let acc = 1n;
  for (const [p, e] of pairs) acc *= p ** e;
  return acc;
}

// Export for Node (tests.js); attach to window for the browser (index.html).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    factorize,
    formatFactorization,
    product,
    isProbablePrime,
    gcd,
    isqrt,
    powmod,
  };
} else if (typeof window !== 'undefined') {
  window.FactorCore = { factorize, formatFactorization, product, isProbablePrime, gcd, isqrt, powmod };
}
