/*
 * tests.js — dependency-free test suite for factor-core.js.
 * Run with:  node projects/phase2-numbers/prime-factorization/tests.js
 */

'use strict';

const {
  factorize,
  formatFactorization,
  product,
  isProbablePrime,
  gcd,
  isqrt,
} = require('./factor-core');

let passed = 0;
let failed = 0;

function eq(actual, expected, label) {
  const a = String(actual);
  const e = String(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function ok(cond, label) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function throws(fn, label) {
  try {
    fn();
    failed++;
    console.error(`FAIL: ${label} — expected an error but none was thrown`);
  } catch (_) {
    passed++;
  }
}

// ---- small, hand-checkable factorizations -------------------------------
eq(formatFactorization(factorize(1n)), '1', '1 has the empty factorization');
eq(formatFactorization(factorize(2n)), '2', '2 is prime');
eq(formatFactorization(factorize(12n)), '2^2 * 3', '12 = 2^2 * 3');
eq(formatFactorization(factorize(17n)), '17', '17 is prime');
eq(formatFactorization(factorize(360n)), '2^3 * 3^2 * 5', '360 = 2^3 * 3^2 * 5');
eq(formatFactorization(factorize(1000000n)), '2^6 * 5^6', '10^6 = 2^6 * 5^6');
eq(formatFactorization(factorize(97n)), '97', '97 is prime');
eq(formatFactorization(factorize(1024n)), '2^10', '1024 = 2^10');

// A prime power and a highly composite number.
eq(formatFactorization(factorize(2187n)), '3^7', '2187 = 3^7');
eq(formatFactorization(factorize(720720n)), '2^4 * 3^2 * 5 * 7 * 11 * 13', '720720 factorization');

// ---- the fundamental invariant: the product of the factors is the input -
// This is the strongest possible check — if it holds for random inputs, the
// factorization is correct regardless of how it was computed.
{
  let allOk = true;
  // A small deterministic LCG so the "random" inputs are reproducible.
  let s = 123456789n;
  const nextBig = (bits) => {
    let v = 0n;
    for (let i = 0; i < bits; i += 30) {
      s = (s * 1103515245n + 12345n) & 0x7fffffffn;
      v = (v << 30n) | s;
    }
    return (v & ((1n << BigInt(bits)) - 1n)) + 1n; // >= 1
  };
  for (let i = 0; i < 400; i++) {
    const n = nextBig(40); // up to ~12-digit numbers
    if (product(factorize(n)) !== n) {
      allOk = false;
      console.error('   product mismatch for n =', n.toString());
      break;
    }
  }
  ok(allOk, 'product(factorize(n)) === n for 400 random ~12-digit numbers');
}

// Every factor returned must actually be prime, and exponents must be >= 1.
{
  let allOk = true;
  for (const n of [2n, 12n, 360n, 999999937n, 600851475143n]) {
    for (const [p, e] of factorize(n)) {
      if (!isProbablePrime(p) || e < 1n) allOk = false;
    }
  }
  ok(allOk, 'every returned factor is prime with a positive exponent');
}

// ---- large inputs where naive trial division would hang -----------------
// A 12-digit number famous from Project Euler problem 3.
eq(formatFactorization(factorize(600851475143n)), '71 * 839 * 1471 * 6857', '600851475143 (Euler #3)');

// A hard semiprime: the product of two 10-digit primes (~20 digits total).
// Trial division to sqrt would be ~10^10 steps; rho does it instantly.
{
  const p = 32416190071n; // prime
  const q = 32416187567n; // prime
  const n = p * q; // 1050809243812641968057n, 22 digits
  eq(product(factorize(n)), n, 'semiprime of two 10-digit primes reproduces n');
  eq(factorize(n).length, 2, 'the 22-digit semiprime has exactly two distinct prime factors');
  ok(factorize(n).every(([, e]) => e === 1n), 'both factors of the semiprime have exponent 1');
}

// A large prime must come back as itself (base case: rho never called).
{
  const bigPrime = 1000000000039n; // 13-digit prime
  ok(isProbablePrime(bigPrime), '1000000000039 is recognised as prime');
  eq(formatFactorization(factorize(bigPrime)), '1000000000039', 'a 13-digit prime is its own factorization');
}

// ---- Miller–Rabin spot checks -------------------------------------------
eq(isProbablePrime(1n), false, '1 is not prime');
eq(isProbablePrime(0n), false, '0 is not prime');
eq(isProbablePrime(2n), true, '2 is prime');
eq(isProbablePrime(561n), false, '561 (a Carmichael number) is composite');
eq(isProbablePrime(41041n), false, '41041 (a Carmichael number) is composite');
eq(isProbablePrime(7919n), true, '7919 (the 1000th prime) is prime');
eq(isProbablePrime(2n ** 61n - 1n), true, 'the Mersenne prime 2^61 - 1 is prime');

// ---- helpers ------------------------------------------------------------
eq(gcd(462n, 1071n), 21n, 'gcd(462, 1071) = 21');
eq(isqrt(0n), 0n, 'isqrt(0) = 0');
eq(isqrt(15n), 3n, 'isqrt(15) = 3');
eq(isqrt(16n), 4n, 'isqrt(16) = 4');
eq(isqrt(10n ** 24n), 10n ** 12n, 'isqrt(10^24) = 10^12');

// ---- input validation ---------------------------------------------------
throws(() => factorize(0n), 'factorize rejects 0');
throws(() => factorize(-6n), 'factorize rejects negatives');
throws(() => factorize(12), 'factorize rejects a plain Number (needs BigInt)');

// ---- report -------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
