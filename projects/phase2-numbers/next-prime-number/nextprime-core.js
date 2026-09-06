/*
 * nextprime-core.js — the number theory for "Next Prime Number".
 *
 * DOM-free, console-free and I/O-free on purpose: the exact same file is loaded
 * by the browser (via <script>) and by Node (via require) so the tests exercise
 * the real code, not a copy. Everything is BigInt — a JavaScript `number` is a
 * 64-bit float and silently loses integer exactness past 2^53 - 1, and "the next
 * prime" question is one you naturally ask of numbers far larger than that.
 */

'use strict';

(function (root) {

  // ---- exact-integer helpers -------------------------------------------------

  // Modular exponentiation by squaring: base^exp mod m, without ever forming the
  // giant intermediate base^exp. The engine of Miller–Rabin.
  function powmod(base, exp, m) {
    base %= m;
    var result = 1n;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % m;
      base = (base * base) % m;
      exp >>= 1n;
    }
    return result;
  }

  // The primes below 1000, used to cheaply reject most composites before the
  // (relatively) expensive Miller–Rabin test ever runs. Built once by a small
  // sieve so the list stays honest instead of being pasted by hand.
  var SMALL_PRIMES = (function sieve(limit) {
    var mark = new Uint8Array(limit + 1);
    var out = [];
    for (var i = 2; i <= limit; i++) {
      if (mark[i]) continue;
      out.push(BigInt(i));
      for (var j = i * i; j <= limit; j += i) mark[j] = 1;
    }
    return out;
  })(1000);

  // ---- primality -------------------------------------------------------------

  // Deterministic Miller–Rabin. With this fixed set of witnesses (the first 12
  // primes) the test is *provably exact* for every n below 3.317 × 10^24 — far
  // past anything typed into the box — and a very strong probabilistic test
  // above it. It rejects Carmichael numbers (561, 41041, …), which fool the
  // naive Fermat test.
  var MR_WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

  function isProbablePrime(n) {
    if (typeof n !== 'bigint') n = BigInt(n);
    if (n < 2n) return false;

    // Trial-divide by the small primes first: knocks out the overwhelming
    // majority of composites in a handful of cheap operations.
    for (var i = 0; i < SMALL_PRIMES.length; i++) {
      var p = SMALL_PRIMES[i];
      if (n === p) return true;
      if (n % p === 0n) return false;
    }
    // n now has no factor below 1000; if n < 1000^2 that already makes it prime.
    if (n < 1000n * 1000n) return true;

    // Write n - 1 = d · 2^r with d odd.
    var d = n - 1n;
    var r = 0n;
    while ((d & 1n) === 0n) { d >>= 1n; r += 1n; }

    witnessLoop:
    for (var w = 0; w < MR_WITNESSES.length; w++) {
      var a = MR_WITNESSES[w];
      if (a >= n) continue;             // witness must be in [2, n-2]
      var x = powmod(a, d, n);
      if (x === 1n || x === n - 1n) continue;
      for (var k = 1n; k < r; k++) {
        x = (x * x) % n;
        if (x === n - 1n) continue witnessLoop;
      }
      return false;                      // a is a witness to n being composite
    }
    return true;
  }

  // ---- next / previous prime -------------------------------------------------

  // A 2·3·5 wheel: the residues mod 30 that can be prime (everything else shares
  // a factor with 30). Stepping the candidate along these residues skips 22 of
  // every 30 integers outright, so Miller–Rabin runs far fewer times.
  var WHEEL = [1n, 7n, 11n, 13n, 17n, 19n, 23n, 29n];

  // The smallest prime strictly greater than n. Works for any BigInt (or value
  // BigInt() accepts), negative ones included — the next prime after -5 is 2.
  function nextPrime(n) {
    if (typeof n !== 'bigint') n = BigInt(n);
    if (n < 2n) return 2n;
    if (n < 3n) return 3n;
    if (n < 5n) return 5n;
    if (n < 7n) return 7n;

    // Advance to the first wheel residue > n, then walk the wheel forever. The
    // gap between consecutive primes near n is on average ~ln(n), so this loop
    // tests only a handful of candidates even for 100-digit inputs.
    var base = n - (n % 30n);            // multiple of 30 at or below n
    var start = n + 1n;
    for (;;) {
      for (var i = 0; i < WHEEL.length; i++) {
        var cand = base + WHEEL[i];
        if (cand >= start && isProbablePrime(cand)) return cand;
      }
      base += 30n;
    }
  }

  // The largest prime strictly less than n, or null when none exists (n ≤ 2).
  // The mirror of nextPrime, handy for showing the gap the next prime sits in.
  function prevPrime(n) {
    if (typeof n !== 'bigint') n = BigInt(n);
    if (n <= 2n) return null;
    if (n <= 3n) return 2n;
    if (n <= 5n) return 3n;
    if (n <= 7n) return 5n;

    var base = n - (n % 30n);
    for (;;) {
      for (var i = WHEEL.length - 1; i >= 0; i--) {
        var cand = base + WHEEL[i];
        if (cand < n && cand >= 2n && isProbablePrime(cand)) return cand;
      }
      base -= 30n;
      if (base < 0n) return 2n;          // fell through the small cases already
    }
  }

  // The next `count` primes after n, in order. Convenience over nextPrime.
  function nextPrimes(n, count) {
    if (typeof n !== 'bigint') n = BigInt(n);
    var out = [];
    var cur = n;
    for (var i = 0; i < count; i++) {
      cur = nextPrime(cur);
      out.push(cur);
    }
    return out;
  }

  var api = {
    powmod: powmod,
    isProbablePrime: isProbablePrime,
    nextPrime: nextPrime,
    prevPrime: prevPrime,
    nextPrimes: nextPrimes,
    SMALL_PRIMES: SMALL_PRIMES
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;          // Node / tests
  } else {
    root.NextPrimeCore = api;      // browser
  }

})(typeof window !== 'undefined' ? window : this);
