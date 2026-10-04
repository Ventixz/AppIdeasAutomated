/*
 * tests.js — a dependency-free suite for the Fizz Buzz engine.
 *
 *   node projects/phase2-text/fizz-buzz/tests.js
 *
 * Fizz Buzz is small, so the test is mostly about pinning the exact behaviour
 * the spec asks for and proving the *generalised* engine agrees with an
 * INDEPENDENT oracle that shares no code with it:
 *
 *   - `labelledRange` (the engine) ↔ `oracleLine` (a from-scratch re-statement
 *     of the rules). They must produce the identical sequence — on the canonical
 *     1..100 game AND on a long randomised fuzz loop over random rule sets and
 *     random ranges.
 *   - `stats` ↔ a hand re-count of the same range.
 *
 * Hand-worked cases nail down the exact spec (multiples of 3 → Fizz, 5 → Buzz,
 * both → FizzBuzz), rule order, zero/negative handling, descending ranges, the
 * span cap, and input validation.
 */
"use strict";
var FB = require("./fizzbuzz-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function arrEq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function throws(fn, msg) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(threw, msg + " (expected a throw)");
}
function section(name) { console.log("\n== " + name + " =="); }

// --- the independent oracle -------------------------------------------------
// A deliberately naive re-implementation of the rules, with no call into the
// engine. If the engine and this ever disagree, one of them is wrong.
function oracleLine(n, rules) {
  var s = "";
  rules.forEach(function (r) {
    if (n % r.divisor === 0) s += r.word;
  });
  return s === "" ? ("" + n) : s;
}
function oracleRange(start, end, rules) {
  var out = [];
  var step = end >= start ? 1 : -1;
  for (var n = start; ; n += step) {
    out.push({ n: n, text: oracleLine(n, rules) });
    if (n === end) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
section("the exact spec: 1..100 classic Fizz Buzz");
(function () {
  var rows = FB.range(1, 100);
  eq(rows.length, 100, "100 lines for 1..100");
  // The textbook first fifteen.
  arrEq(rows.slice(0, 15).map(function (r) { return r.text; }),
    ["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz",
     "11", "Fizz", "13", "14", "FizzBuzz"],
    "lines 1..15 match the textbook");
  eq(rows[14].text, "FizzBuzz", "15 is FizzBuzz (multiple of both)");
  eq(rows[29].text, "FizzBuzz", "30 is FizzBuzz");
  eq(rows[89].text, "FizzBuzz", "90 is FizzBuzz");
  eq(rows[98].text, "Fizz", "99 is Fizz");
  eq(rows[99].text, "Buzz", "100 is Buzz");
  eq(rows[0].text, "1", "1 is just the number");
})();

section("single labels and rule order");
(function () {
  eq(FB.label(3), "Fizz", "3 → Fizz");
  eq(FB.label(5), "Buzz", "5 → Buzz");
  eq(FB.label(15), "FizzBuzz", "15 → FizzBuzz, Fizz before Buzz");
  eq(FB.label(7), "7", "7 → \"7\"");
  // Rule order drives concatenation order.
  var rev = [{ divisor: 5, word: "Buzz" }, { divisor: 3, word: "Fizz" }];
  eq(FB.label(15, rev), "BuzzFizz", "reversed rules → BuzzFizz");
  // More than two rules.
  var three = [{ divisor: 3, word: "Fizz" }, { divisor: 5, word: "Buzz" }, { divisor: 7, word: "Bazz" }];
  eq(FB.label(105, three), "FizzBuzzBazz", "105 = 3·5·7 → all three words");
  eq(FB.label(21, three), "FizzBazz", "21 = 3·7 → Fizz then Bazz, Buzz skipped");
})();

section("zero, negatives, and descending ranges");
(function () {
  // 0 is a multiple of everything.
  eq(FB.label(0), "FizzBuzz", "0 is divisible by every divisor → FizzBuzz");
  // Divisibility is sign-agnostic.
  eq(FB.label(-3), "Fizz", "-3 → Fizz");
  eq(FB.label(-15), "FizzBuzz", "-15 → FizzBuzz");
  eq(FB.label(-7), "-7", "-7 → \"-7\"");
  // Descending range counts down and still labels correctly.
  var down = FB.range(5, 1);
  arrEq(down.map(function (r) { return r.n; }), [5, 4, 3, 2, 1], "descending ids");
  arrEq(down.map(function (r) { return r.text; }), ["Buzz", "4", "Fizz", "2", "1"], "descending labels");
  // A range straddling zero.
  var span = FB.range(-5, 5);
  eq(span.length, 11, "-5..5 is 11 numbers");
  eq(span[5].text, "FizzBuzz", "the 0 in the middle is FizzBuzz");
})();

section("stats re-counts the range");
(function () {
  var s = FB.stats(1, 100);
  eq(s.total, 100, "100 numbers total");
  eq(s.perWord.Fizz, 33, "33 multiples of 3 in 1..100");
  eq(s.perWord.Buzz, 20, "20 multiples of 5 in 1..100");
  // labelled = multiples of 3 or 5 = 33 + 20 - 6 (multiples of 15) = 47.
  eq(s.labelled, 47, "47 numbers get a word");
  eq(s.plain, 53, "53 numbers stay plain");
  eq(s.labelled + s.plain, s.total, "labelled + plain = total");
})();

section("validation: bad rules and bad ranges are rejected");
(function () {
  throws(function () { FB.label(5, [{ divisor: 0, word: "X" }]); }, "divisor 0 rejected");
  throws(function () { FB.label(5, [{ divisor: -3, word: "X" }]); }, "negative divisor rejected");
  throws(function () { FB.label(5, [{ divisor: 2.5, word: "X" }]); }, "non-integer divisor rejected");
  throws(function () { FB.label(5, [{ divisor: 3, word: "" }]); }, "empty word rejected");
  throws(function () { FB.label(5, "nope"); }, "non-array rules rejected");
  throws(function () { FB.label(1.5); }, "non-integer n rejected");
  throws(function () { FB.range(1, FB.MAX_SPAN + 1); }, "oversized range rejected");
  // The cap boundary itself is allowed.
  var atCap = FB.range(1, FB.MAX_SPAN);
  eq(atCap.length, FB.MAX_SPAN, "a range exactly at the cap is allowed");
})();

section("ORACLE: engine ↔ independent re-statement (hand cases)");
(function () {
  var sets = [
    FB.classicRules(),
    [{ divisor: 2, word: "Even" }],
    [{ divisor: 3, word: "Fizz" }, { divisor: 5, word: "Buzz" }, { divisor: 7, word: "Bazz" }],
    [{ divisor: 4, word: "A" }, { divisor: 6, word: "B" }, { divisor: 9, word: "C" }]
  ];
  sets.forEach(function (rules, i) {
    var got = FB.range(1, 120, rules).map(function (r) { return r.text; });
    var want = oracleRange(1, 120, rules).map(function (r) { return r.text; });
    arrEq(got, want, "rule set #" + i + ": engine matches oracle on 1..120");
  });
})();

section("ORACLE: randomised fuzz — engine ↔ re-statement, thousands of lines");
(function () {
  var seed = 1234567;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function ri(lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }

  var mismatches = 0, checked = 0;
  for (var t = 0; t < 400; t++) {
    // A random rule set.
    var k = ri(1, 4);
    var rules = [];
    for (var j = 0; j < k; j++) rules.push({ divisor: ri(1, 12), word: "W" + j });
    // A random range (sometimes descending, sometimes across zero).
    var a = ri(-50, 50), b = ri(-50, 50);
    var got = FB.range(a, b, rules);
    var want = oracleRange(a, b, rules);
    for (var m = 0; m < got.length; m++) {
      checked++;
      if (got[m].n !== want[m].n || got[m].text !== want[m].text) mismatches++;
    }
  }
  eq(mismatches, 0, "no engine/oracle mismatches across " + checked + " fuzzed lines");
})();

section("ORACLE: stats ↔ a hand re-count of a fuzzed range");
(function () {
  var rules = [{ divisor: 3, word: "F" }, { divisor: 4, word: "G" }, { divisor: 5, word: "H" }];
  var s = FB.stats(-30, 70, rules);
  // Re-count independently via the oracle.
  var rows = oracleRange(-30, 70, rules);
  var plain = 0, labelled = 0, per = { F: 0, G: 0, H: 0 };
  rows.forEach(function (r) {
    var any = false;
    rules.forEach(function (rule) { if (r.n % rule.divisor === 0) { per[rule.word]++; any = true; } });
    if (any) labelled++; else plain++;
  });
  eq(s.total, rows.length, "stats total matches");
  eq(s.labelled, labelled, "stats labelled matches hand re-count");
  eq(s.plain, plain, "stats plain matches hand re-count");
  arrEq(s.perWord, per, "stats per-word matches hand re-count");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (fail === 0
  ? "OK: " + pass + " passed, 0 failed"
  : "FAILED: " + fail + " of " + (pass + fail)));
if (fail > 0) process.exit(1);
