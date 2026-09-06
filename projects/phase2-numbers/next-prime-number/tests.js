/*
 * tests.js — dependency-free test suite for nextprime-core.js.
 * Run with:  node projects/phase2-numbers/next-prime-number/tests.js
 */

'use strict';

var core = require('./nextprime-core.js');

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + name); }
}
function eq(name, got, want) {
  ok(name + ' (got ' + got + ', want ' + want + ')', String(got) === String(want));
}

// --- isProbablePrime: hand-verifiable ---------------------------------------

var knownPrimes = [2, 3, 5, 7, 11, 13, 97, 101, 7919, 104729];
knownPrimes.forEach(function (p) {
  ok('isPrime(' + p + ')', core.isProbablePrime(BigInt(p)));
});

var knownComposites = [0, 1, 4, 9, 15, 21, 100, 1000, 7917, 104730];
knownComposites.forEach(function (c) {
  ok('!isPrime(' + c + ')', !core.isProbablePrime(BigInt(c)));
});

// Carmichael numbers — composite but Fermat-pseudoprime to many bases. A naive
// Fermat test says "prime"; Miller–Rabin must not.
[561, 1105, 1729, 2465, 41041, 825265].forEach(function (c) {
  ok('Carmichael ' + c + ' rejected', !core.isProbablePrime(BigInt(c)));
});

// A large Mersenne prime, 2^61 - 1, and its neighbours.
ok('2^61-1 is prime', core.isProbablePrime((1n << 61n) - 1n));
ok('2^61 is not prime', !core.isProbablePrime(1n << 61n));

// --- nextPrime: exact small values ------------------------------------------

eq('nextPrime(0)', core.nextPrime(0n), 2n);
eq('nextPrime(1)', core.nextPrime(1n), 2n);
eq('nextPrime(2)', core.nextPrime(2n), 3n);      // strictly greater
eq('nextPrime(3)', core.nextPrime(3n), 5n);
eq('nextPrime(7)', core.nextPrime(7n), 11n);
eq('nextPrime(13)', core.nextPrime(13n), 17n);
eq('nextPrime(29)', core.nextPrime(29n), 31n);   // across a multiple of 30
eq('nextPrime(30)', core.nextPrime(30n), 31n);
eq('nextPrime(89)', core.nextPrime(89n), 97n);   // start of a gap of 8
eq('nextPrime(100)', core.nextPrime(100n), 101n);
eq('nextPrime(-5)', core.nextPrime(-5n), 2n);    // negatives → 2

// Accepts plain numbers and numeric strings, not only BigInt.
eq('nextPrime("13")', core.nextPrime('13'), 17n);
eq('nextPrime(13 number)', core.nextPrime(13), 17n);

// A famous large prime gap: after 370261 the next prime is 370373 (gap 112).
eq('nextPrime(370261)', core.nextPrime(370261n), 370373n);

// Large inputs: exact known next primes.
eq('nextPrime(10^18)', core.nextPrime(10n ** 18n), 1000000000000000003n);
eq('nextPrime(2^64)', core.nextPrime(1n << 64n), 18446744073709551629n);

// --- prevPrime ---------------------------------------------------------------

eq('prevPrime(3)', core.prevPrime(3n), 2n);
eq('prevPrime(10)', core.prevPrime(10n), 7n);
eq('prevPrime(31)', core.prevPrime(31n), 29n);
eq('prevPrime(97)', core.prevPrime(97n), 89n);
ok('prevPrime(2) is null', core.prevPrime(2n) === null);
ok('prevPrime(0) is null', core.prevPrime(0n) === null);

// --- invariants over a random sweep -----------------------------------------
// For each random n, q = nextPrime(n) must be (a) prime, (b) strictly > n, and
// (c) the *smallest* such — i.e. every integer strictly between n and q is
// composite. This proves nextPrime independently of how it computed the answer.
var rng = (function () { var s = 123456789n; return function (m) {
  s = (s * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
  return s % m;
}; })();

var sweepOK = true;
for (var t = 0; t < 300; t++) {
  var n = rng(10n ** 15n);
  var q = core.nextPrime(n);
  if (!core.isProbablePrime(q)) { sweepOK = false; break; }
  if (!(q > n)) { sweepOK = false; break; }
  for (var m = n + 1n; m < q; m++) {
    if (core.isProbablePrime(m)) { sweepOK = false; break; } // a prime was skipped
  }
  if (!sweepOK) break;
}
ok('300 random nextPrime results are minimal, prime, and > n', sweepOK);

// nextPrimes returns a strictly increasing run of primes.
var run = core.nextPrimes(100n, 5);
eq('nextPrimes(100,5)', run.join(','), '101,103,107,109,113');

// Chaining nextPrime equals nextPrimes.
var chainOK = true, cur = 500n;
for (var i = 0; i < 10; i++) {
  cur = core.nextPrime(cur);
  if (cur !== core.nextPrimes(500n, i + 1)[i]) { chainOK = false; break; }
}
ok('nextPrime chained matches nextPrimes', chainOK);

// --- report ------------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
