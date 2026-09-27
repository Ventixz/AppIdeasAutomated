/*
 * tests.js — a dependency-free suite for the sieve core.
 *
 *   node projects/phase2-classic-algorithms/sieve-of-eratosthenes/tests.js
 *
 * The strategy throughout: trial division is short enough to be *obviously*
 * correct, so it is the oracle. The three sieves are the clever ones, so every
 * test pins their answer against trial division across many ranges, checks the
 * documented invariants that make each sieve fast (start-at-p², cross-out
 * counts, the linear sieve's exactly-once property), and confirms the recorded
 * animation frames stay consistent with the answer.
 */
"use strict";
var S = require("./sieve-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }

// A tiny, independent, unmistakably-correct primality check for cross-checking
// (independent of the core's own trial division so a shared bug can't hide).
function isPrimeRef(k) {
  if (k < 2) { return false; }
  for (var d = 2; d * d <= k; d++) { if (k % d === 0) { return false; } }
  return true;
}
function primesUpTo(n) {
  var out = [];
  for (var k = 2; k <= n; k++) { if (isPrimeRef(k)) { out.push(k); } }
  return out;
}

// ---------------------------------------------------------------------------
section("tiny hand-checked cases");
// ---------------------------------------------------------------------------
(function () {
  eq(S.sieve(1).count, 0, "no primes ≤ 1");
  eq(S.sieve(2).count, 1, "one prime ≤ 2");
  ok(S.sameList(S.sieve(2).primes, [2]), "primes ≤ 2 = [2]");
  ok(S.sameList(S.sieve(10).primes, [2, 3, 5, 7]), "primes ≤ 10 = [2,3,5,7]");
  ok(S.sameList(S.sieve(30).primes, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]),
     "primes ≤ 30 correct");
  eq(S.sieve(0).count, 0, "n=0 → no primes, no throw");
  eq(S.sieve(-5).count, 0, "negative n → no primes, no throw");
})();

// ---------------------------------------------------------------------------
section("known prime-counting values π(n)");
// ---------------------------------------------------------------------------
(function () {
  // Classic reference values of the prime-counting function.
  eq(S.primeCount(10), 4, "π(10) = 4");
  eq(S.primeCount(100), 25, "π(100) = 25");
  eq(S.primeCount(1000), 168, "π(1000) = 168");
  eq(S.primeCount(10000), 1229, "π(10000) = 1229");
  eq(S.primeCount(100000), 9592, "π(100000) = 9592");
})();

// ---------------------------------------------------------------------------
section("all four algorithms agree with the independent oracle");
// ---------------------------------------------------------------------------
(function () {
  var ns = [0, 1, 2, 3, 7, 8, 9, 16, 25, 49, 100, 121, 500, 997, 1000, 2500];
  var allMatch = true, worst = "";
  for (var t = 0; t < ns.length; t++) {
    var n = ns[t];
    var want = primesUpTo(n);
    var algos = ["trial", "sieve", "linear", "segmented"];
    for (var a = 0; a < algos.length; a++) {
      var got = S.run(algos[a], n).primes;
      if (!S.sameList(got, want)) {
        allMatch = false;
        worst = algos[a] + " n=" + n + " len " + got.length + " vs " + want.length;
      }
    }
  }
  ok(allMatch, "trial/sieve/linear/segmented all match the oracle across sizes" +
     (worst ? " — " + worst : ""));
})();

// ---------------------------------------------------------------------------
section("race: everyone returns the identical prime list");
// ---------------------------------------------------------------------------
(function () {
  var ns = [50, 500, 5000, 12345];
  var allAgree = true;
  for (var i = 0; i < ns.length; i++) {
    var r = S.race(ns[i]);
    if (!r.agree) { allAgree = false; }
  }
  ok(allAgree, "race() agrees across n ∈ {50, 500, 5000, 12345}");

  // Segment boundaries are a classic off-by-one trap: force several odd segment
  // sizes and confirm the segmented sieve still nails it.
  var segOk = true;
  [1, 2, 3, 7, 13, 64, 1000].forEach(function (segSize) {
    var got = S.segmented(5000, { segSize: segSize }).primes;
    if (!S.sameList(got, primesUpTo(5000))) { segOk = false; }
  });
  ok(segOk, "segmented sieve is correct for many segment sizes (boundaries)");
})();

// ---------------------------------------------------------------------------
section("cross-out counts prove the complexity gap");
// ---------------------------------------------------------------------------
(function () {
  var n = 100000;
  var trial = S.trial(n).ops;
  var sieve = S.sieve(n).ops;
  var linear = S.linear(n).ops;

  // The whole reason the sieve exists: it does far less work than trial division.
  ok(sieve < trial / 10, "sieve does <10% of trial division's work at n=1e5 " +
     "(sieve=" + sieve + ", trial=" + trial + ")");

  // The linear sieve crosses each composite exactly once, so its cross-out count
  // equals the number of composites ≤ n = (n − 1) − π(n).
  var composites = (n - 1) - S.primeCount(n);
  eq(linear, composites, "linear sieve crosses each composite exactly once");

  // The classic sieve re-crosses numbers with several prime factors, so it must
  // do strictly more cross-outs than the linear sieve — but still O(n log log n),
  // i.e. within a small constant of n.
  ok(sieve > linear, "classic sieve re-crosses, so it does more than the linear sieve");
  ok(sieve < 3 * n, "classic sieve stays within a small constant of n (log log n)");
})();

// ---------------------------------------------------------------------------
section("the 'start at p²' optimisation is actually in effect");
// ---------------------------------------------------------------------------
(function () {
  // If the sieve started crossing at 2p instead of p², the smallest crossed
  // multiple of a prime p would be 2p. Starting at p² means no number below p²
  // is ever crossed *by p*. We verify by replaying frames: for every "cross k
  // by p" frame, k ≥ p·p.
  var r = S.sieve(200, { record: true });
  var okStart = true;
  r.frames.forEach(function (f) {
    if (f.type === "cross" && f.k < f.by * f.by) { okStart = false; }
  });
  ok(okStart, "every cross-out k is ≥ p² for its prime p (start-at-p²)");
})();

// ---------------------------------------------------------------------------
section("recorded frames are consistent with the answer");
// ---------------------------------------------------------------------------
(function () {
  var r = S.sieve(120, { record: true });
  var announced = [];
  var crossed = {};
  r.frames.forEach(function (f) {
    if (f.type === "prime") { announced.push(f.p); }
    if (f.type === "cross") { crossed[f.k] = true; }
  });
  // The primes announced in frames match the returned prime list, in order.
  ok(S.sameList(announced, r.primes), "announced primes match the returned list");
  // No number is ever both announced prime and crossed out.
  var conflict = r.primes.some(function (p) { return crossed[p]; });
  ok(!conflict, "no number is both announced prime and crossed out");
  // Every composite in range is crossed at least once.
  var everyComposite = true;
  for (var k = 4; k <= 120; k++) {
    if (!isPrimeRef(k) && !crossed[k]) { everyComposite = false; }
  }
  ok(everyComposite, "every composite ≤ 120 is crossed out at least once");
})();

// ---------------------------------------------------------------------------
section("smallest-prime-factor table and factorisation");
// ---------------------------------------------------------------------------
(function () {
  var lin = S.linear(1000);
  var spf = lin.spf;
  // spf[p] === p for primes, and spf[c] is a genuine prime factor for composites.
  var spfOk = true;
  for (var k = 2; k <= 1000; k++) {
    if (isPrimeRef(k)) { if (spf[k] !== k) { spfOk = false; } }
    else { if (k % spf[k] !== 0 || !isPrimeRef(spf[k])) { spfOk = false; } }
  }
  ok(spfOk, "spf[] is p for primes and a real prime divisor for composites");

  // Factorisation reproduces the number and uses only primes.
  var facOk = true;
  [2, 12, 360, 997, 1000, 840].forEach(function (k) {
    var f = S.factorize(k, spf);
    var prod = 1;
    f.forEach(function (e) {
      if (!isPrimeRef(e.prime)) { facOk = false; }
      prod *= Math.pow(e.prime, e.power);
    });
    if (prod !== k) { facOk = false; }
  });
  ok(facOk, "factorize() reproduces each number as a product of prime powers");
})();

// ---------------------------------------------------------------------------
section("larger cross-check against the oracle");
// ---------------------------------------------------------------------------
(function () {
  var n = 20000;
  var want = primesUpTo(n);
  ok(S.sameList(S.sieve(n).primes, want), "sieve matches oracle at n=20000");
  ok(S.sameList(S.linear(n).primes, want), "linear matches oracle at n=20000");
  ok(S.sameList(S.segmented(n).primes, want), "segmented matches oracle at n=20000");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (fail === 0 ? "ALL PASS" : "SOME FAILED") +
            " — " + pass + " passed, " + fail + " failed (" + (pass + fail) + " checks)");
if (fail > 0) { process.exit(1); }
