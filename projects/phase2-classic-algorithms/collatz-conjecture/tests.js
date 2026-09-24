/*
 * tests.js — a dependency-free suite for the Collatz Conjecture core.
 *
 *   node projects/phase2-classic-algorithms/collatz-conjecture/tests.js
 *
 * It checks four layers: the single-step map (parity rules), the full
 * trajectory analysis (against hand-verified sequences and independent
 * recomputation), the accelerated shortcut map, and the memoised records
 * sweep (cross-checked against a slow, direct scan and against published
 * record-holders).
 */
"use strict";
var C = require("./collatz-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }

var B = BigInt;

// ---------------------------------------------------------------------------
section("single step + parity");
// ---------------------------------------------------------------------------
(function () {
  eq(C.step(B(1)).toString(), "4", "step(1) = 4 (3*1+1)");
  eq(C.step(B(2)).toString(), "1", "step(2) = 1");
  eq(C.step(B(3)).toString(), "10", "step(3) = 10");
  eq(C.step(B(16)).toString(), "8", "step(16) = 8");
  ok(C.isEven(B(10)), "10 is even");
  ok(!C.isEven(B(7)), "7 is odd");
  // shortcut map folds the 3n+1 with its guaranteed halving.
  eq(C.shortcutStep(B(3)).toString(), "5", "shortcutStep(3) = (3*3+1)/2 = 5");
  eq(C.shortcutStep(B(6)).toString(), "3", "shortcutStep(6) = 3");
})();

// ---------------------------------------------------------------------------
section("analyze: hand-verified trajectories");
// ---------------------------------------------------------------------------
(function () {
  // 6 -> 3 -> 10 -> 5 -> 16 -> 8 -> 4 -> 2 -> 1  (8 steps, peak 16)
  var r = C.analyze(6);
  eq(r.sequence.map(String).join(","), "6,3,10,5,16,8,4,2,1", "sequence of 6");
  eq(r.steps, 8, "6 takes 8 steps");
  eq(r.peak.toString(), "16", "6 peaks at 16");
  eq(r.peakIndex, 4, "6's peak is the 5th value");
  eq(r.evens + r.odds, r.steps, "even+odd steps == total steps");

  // 1 is already home.
  var one = C.analyze(1);
  eq(one.steps, 0, "1 takes 0 steps");
  eq(one.sequence.length, 1, "1's sequence is just [1]");

  // Well-known counts (OEIS A006577, total stopping time).
  eq(C.analyze(7).steps, 16, "7 takes 16 steps");
  eq(C.analyze(27).steps, 111, "27 takes 111 steps");
  eq(C.analyze(97).steps, 118, "97 takes 118 steps");
  // 27 is famous for climbing to 9232 despite being small.
  eq(C.analyze(27).peak.toString(), "9232", "27 peaks at 9232");

  // Powers of two fall straight down: 2^k takes exactly k steps, no odd steps.
  var p = C.analyze(B(1024));
  eq(p.steps, 10, "1024 = 2^10 takes 10 steps");
  eq(p.odds, 0, "1024 has no odd steps");
  eq(p.peak.toString(), "1024", "1024 never climbs above itself");

  // Every entry must actually be the previous entry's Collatz step, and the
  // last entry must be 1 — an independent re-check of the whole orbit.
  [3, 7, 27, 63, 871, 6171].forEach(function (n) {
    var a = C.analyze(n);
    var good = a.sequence[a.sequence.length - 1] === B(1);
    for (var i = 1; i < a.sequence.length && good; i++) {
      if (a.sequence[i] !== C.step(a.sequence[i - 1])) good = false;
    }
    ok(good, "trajectory of " + n + " is internally consistent and ends at 1");
    // stoppingTime() must agree with analyze().steps.
    eq(C.stoppingTime(n), a.steps, "stoppingTime(" + n + ") matches analyze");
  });
})();

// ---------------------------------------------------------------------------
section("analyze: exact BigInt peaks");
// ---------------------------------------------------------------------------
(function () {
  // 703 is a modest number whose orbit soars past 250,000 — a good BigInt-ish
  // altitude check (still within Number range, but proves the peak is exact).
  var r = C.analyze(703);
  eq(r.peak.toString(), "250504", "703 peaks at 250504");
  // 63,728,127 has one of the largest known peaks for a small-ish seed.
  var big = C.analyze(B(63728127));
  eq(big.steps, 949, "63728127 takes 949 steps");
  eq(big.peak.toString(), "966616035460", "63728127 peaks at 966,616,035,460");
  ok(big.peak > B("900000000000"), "63728127 climbs above 900 billion");
})();

// ---------------------------------------------------------------------------
section("shortcut map");
// ---------------------------------------------------------------------------
(function () {
  var s = C.shortcut(6);
  // 6 -> 3 -> 5 -> 8 -> 4 -> 2 -> 1  (6 steps under the shortcut map)
  eq(s.sequence.map(String).join(","), "6,3,5,8,4,2,1", "shortcut sequence of 6");
  eq(s.steps, 6, "shortcut(6) takes 6 steps");
  // The shortcut orbit is never longer than the standard one and every value
  // it visits also appears in the standard orbit.
  [3, 7, 27, 97].forEach(function (n) {
    var std = C.analyze(n), sc = C.shortcut(n);
    ok(sc.steps <= std.steps, "shortcut(" + n + ") no longer than standard");
    var stdSet = new Set(std.sequence.map(String));
    var subset = sc.sequence.every(function (v) { return stdSet.has(v.toString()); });
    ok(subset, "shortcut(" + n + ") orbit is a subset of the standard orbit");
    ok(sc.ups + sc.downs === sc.steps, "shortcut(" + n + ") up+down == steps");
  });
})();

// ---------------------------------------------------------------------------
section("records: memoised sweep vs direct scan");
// ---------------------------------------------------------------------------
(function () {
  // Brute-force the same range and compare the two record-holders.
  function directScan(limit) {
    var bestSteps = { n: 1, steps: 0 };
    var bestPeak = { n: 1, peak: B(1) };
    for (var start = 1; start <= limit; start++) {
      var a = C.analyze(start);
      if (a.steps > bestSteps.steps) bestSteps = { n: start, steps: a.steps };
      if (a.peak > bestPeak.peak) bestPeak = { n: start, peak: a.peak };
    }
    return { longest: bestSteps, highest: bestPeak };
  }

  [10, 100, 1000, 10000].forEach(function (lim) {
    var fast = C.records(lim);
    var slow = directScan(lim);
    eq(fast.longest.n, slow.longest.n, "longest-orbit holder up to " + lim);
    eq(fast.longest.steps, slow.longest.steps, "longest-orbit length up to " + lim);
    eq(fast.highest.n, slow.highest.n, "highest-altitude holder up to " + lim);
    eq(fast.highest.peak.toString(), slow.highest.peak.toString(), "highest altitude up to " + lim);
  });

  // Published record-holders (OEIS A006877 for stopping-time records).
  var r1000 = C.records(1000);
  eq(r1000.longest.n, 871, "longest orbit under 1000 is 871");
  eq(r1000.longest.steps, 178, "871 takes 178 steps");
  var r10000 = C.records(10000);
  eq(r10000.longest.n, 6171, "longest orbit under 10000 is 6171");
  eq(r10000.longest.steps, 261, "6171 takes 261 steps");

  // The record lists must be strictly increasing and end at the reported best.
  var r = C.records(5000);
  var mono = true;
  for (var i = 1; i < r.recordSteps.length; i++) {
    if (r.recordSteps[i].steps <= r.recordSteps[i - 1].steps) mono = false;
    if (r.recordSteps[i].n <= r.recordSteps[i - 1].n) mono = false;
  }
  ok(mono, "step records strictly increase in both n and steps");
  eq(r.recordSteps[r.recordSteps.length - 1].n, r.longest.n, "last step record == reported longest");
})();

// ---------------------------------------------------------------------------
section("input validation");
// ---------------------------------------------------------------------------
(function () {
  function throws(fn, label) {
    var t = false;
    try { fn(); } catch (e) { t = true; }
    ok(t, label);
  }
  throws(function () { C.analyze(0); }, "0 is rejected");
  throws(function () { C.analyze(-5); }, "negative is rejected");
  throws(function () { C.analyze("12.5"); }, "non-integer is rejected");
  throws(function () { C.analyze("abc"); }, "junk is rejected");
  throws(function () { C.analyze(""); }, "empty is rejected");
  throws(function () { C.records(3000000); }, "over-large range is rejected");
  // Strings and numbers both work.
  eq(C.analyze("27").steps, 111, 'analyze("27") accepts a string');
  eq(C.toPositiveInt("42").toString(), "42", "toPositiveInt parses a string");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (fail === 0 ? "ALL PASSED" : fail + " FAILED") + " — " + pass + " checks");
if (fail > 0) process.exit(1);
