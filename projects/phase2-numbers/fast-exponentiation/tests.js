/*
 * tests.js — a dependency-free suite for the Fast Exponentiation core.
 *
 *   node projects/phase2-numbers/fast-exponentiation/tests.js
 *
 * It checks four layers: the plain BigInt power (against JS's own `**`), the
 * modular power (including cryptographic identities like Fermat's little
 * theorem), the multiplication counter, and the matrix-powered Fibonacci.
 */
"use strict";
var C = require("./fastexp-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }

var B = BigInt;

// ---------------------------------------------------------------------------
section("bits + popcount helpers");
// ---------------------------------------------------------------------------
(function () {
  ok(C.bitsOf(B(13)).join("") === "1101", "13 = 1101");
  ok(C.bitsOf(B(1)).join("") === "1", "1 = 1");
  ok(C.bitsOf(B(0)).join("") === "0", "0 = 0");
  ok(C.bitsOf(B(1024)).join("") === "10000000000", "1024 = 2^10");
  eq(C.popcount(B(13)), 3, "popcount(13) = 3");
  eq(C.popcount(B(255)), 8, "popcount(255) = 8");
  eq(C.popcount(B(0)), 0, "popcount(0) = 0");
})();

// ---------------------------------------------------------------------------
section("plain power vs JS **");
// ---------------------------------------------------------------------------
(function () {
  var cases = [[2, 10], [3, 7], [5, 0], [7, 1], [10, 20], [2, 64], [13, 13], [1, 999], [0, 5], [0, 0]];
  cases.forEach(function (c) {
    var base = B(c[0]), exp = B(c[1]);
    var got = C.power(base, exp).value;
    var want = base ** exp;
    eq(got, want, c[0] + "^" + c[1]);
  });

  // A genuinely large power that only BigInt (and the fast ladder) can hold.
  var big = C.power(B(2), B(1000)).value;
  eq(big, B(2) ** B(1000), "2^1000");
  eq(String(big).length, 302, "2^1000 has 302 decimal digits");

  // Negative base, parity of exponent.
  eq(C.power(B(-3), B(3)).value, B(-27), "(-3)^3 = -27");
  eq(C.power(B(-2), B(10)).value, B(1024), "(-2)^10 = 1024");

  // Rejects a negative exponent and non-integers.
  var threw = false;
  try { C.power(B(2), B(-1)); } catch (e) { threw = true; }
  ok(threw, "negative exponent rejected");
  threw = false;
  try { C.power("2.5", B(2)); } catch (e) { threw = true; }
  ok(threw, "non-integer base rejected");
})();

// ---------------------------------------------------------------------------
section("square-and-multiply step trace");
// ---------------------------------------------------------------------------
(function () {
  // 3^13: 13 = 1101, so after the seed we expect square, square+multiply,
  // square, square+multiply -> 1 seed + 3 squares + 2 multiplies.
  var r = C.power(B(3), B(13));
  eq(r.value, B(3) ** B(13), "3^13 value");
  eq(r.squarings, 3, "3^13 does 3 squarings");
  eq(r.multiplies, 2, "3^13 does 2 multiplies");
  eq(r.steps[0].op, "seed", "first step is the seed");
  // The last recorded value always equals the answer.
  eq(r.steps[r.steps.length - 1].value, r.value, "trace ends at the answer");

  // A pure power of two is all squarings, no interior multiplies.
  var p = C.power(B(5), B(16));
  eq(p.multiplies, 0, "5^16 needs no multiplies (16 = 10000)");
  eq(p.squarings, 4, "5^16 needs 4 squarings");

  // Exponent 0 seeds straight to 1 with no work.
  var z = C.power(B(7), B(0));
  eq(z.value, B(1), "7^0 = 1");
  eq(z.squarings + z.multiplies, 0, "7^0 does no multiplications");
})();

// ---------------------------------------------------------------------------
section("modular exponentiation");
// ---------------------------------------------------------------------------
(function () {
  eq(C.modPow(B(7), B(1000000), B(13)).value, (B(7) ** B(1000000)) % B(13),
    "7^1000000 mod 13 matches the direct (slow) computation");
  eq(C.modPow(B(4), B(13), B(497)).value, B(445), "4^13 mod 497 = 445 (classic textbook case)");
  eq(C.modPow(B(2), B(0), B(5)).value, B(1), "2^0 mod 5 = 1");

  // Fermat's little theorem: for prime p and a not divisible by p, a^(p-1) ≡ 1.
  var primes = [13, 17, 101, 7919];
  primes.forEach(function (pp) {
    var p = B(pp);
    for (var a = 2; a <= 6; a++) {
      eq(C.modPow(B(a), p - B(1), p).value, B(1), a + "^(" + pp + "-1) mod " + pp + " = 1");
    }
  });

  // Modulus stays small the whole way — the point of modular exponentiation.
  var trace = C.modPow(B(7), B(1000000), B(13)).steps;
  var allSmall = trace.every(function (s) { return s.value < B(13); });
  ok(allSmall, "every modular step stays below the modulus");

  var threw = false;
  try { C.modPow(B(2), B(4), B(1)); } catch (e) { threw = true; }
  ok(threw, "modulus of 1 rejected");
})();

// ---------------------------------------------------------------------------
section("multiplication counter");
// ---------------------------------------------------------------------------
(function () {
  var c = C.multiplyCounts(B(1000));
  // 1000 = 1111101000, 10 bits, 6 one-bits.
  eq(c.bitLength, 10, "1000 has 10 bits");
  eq(c.oneBits, 6, "1000 has 6 one-bits");
  eq(c.naive, B(999), "naive 2^1000 uses 999 multiplies");
  eq(c.fast, B((10 - 1) + (6 - 1)), "fast 2^1000 uses 14 multiplies");
  eq(c.saved, c.naive - c.fast, "saved = naive - fast");

  // Small exponents need no multiplications either way.
  eq(C.multiplyCounts(B(0)).naive, B(0), "exp 0: no naive multiplies");
  eq(C.multiplyCounts(B(1)).fast, B(0), "exp 1: no fast multiplies");

  // Cross-check the counter against the actual trace for many exponents.
  for (var e = 2; e <= 200; e++) {
    var counts = C.multiplyCounts(B(e));
    var run = C.power(B(2), B(e));
    eq(BigInt(run.squarings + run.multiplies), counts.fast,
      "counter matches trace work for 2^" + e);
  }
})();

// ---------------------------------------------------------------------------
section("matrix-powered Fibonacci");
// ---------------------------------------------------------------------------
(function () {
  var seq = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
  seq.forEach(function (want, n) {
    eq(C.fibonacci(B(n)).value, B(want), "F(" + n + ") = " + want);
  });

  // A big one, checked against an independent slow iterative Fibonacci.
  function slowFib(n) {
    var a = B(0), b = B(1);
    for (var i = 0; i < n; i++) { var t = a + b; a = b; b = t; }
    return a;
  }
  eq(C.fibonacci(B(100)).value, slowFib(100), "F(100) matches the iterative value");
  eq(String(C.fibonacci(B(500)).value).length, String(slowFib(500)).length, "F(500) digit count matches");

  // O(log n): F(1,000,000) uses far fewer than a million matrix multiplies.
  var big = C.fibonacci(B(1000000));
  ok(big.multiplies < 60, "F(1,000,000) uses < 60 matrix multiplies (got " + big.multiplies + ")");

  // Modular Fibonacci (Pisano-style reduction) agrees with reducing the full value.
  eq(C.fibonacci(B(100), B(1000)).value, slowFib(100) % B(1000), "F(100) mod 1000");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (fail ? "✗ " : "✓ ") + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
