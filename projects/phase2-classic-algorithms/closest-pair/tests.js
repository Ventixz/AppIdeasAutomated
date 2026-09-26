/*
 * tests.js — a dependency-free suite for the closest-pair core.
 *
 *   node projects/phase2-classic-algorithms/closest-pair/tests.js
 *
 * The strategy throughout: brute force is short enough to be *obviously*
 * correct, so it is the oracle. Divide-and-conquer is the clever one, so every
 * test pins its answer against brute force (by distance, since ties mean the
 * pair of ids can legitimately differ) across many random and adversarial
 * inputs — and separately checks that its distance-evaluation count really is
 * sub-quadratic where brute force is exactly quadratic.
 */
"use strict";
var C = require("./closest-pair-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function approx(a, b, msg) { ok(C.almostEqual(a, b), msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }

// ---------------------------------------------------------------------------
section("tiny hand-checked cases");
// ---------------------------------------------------------------------------
(function () {
  // Two points: the only pair.
  var r = C.divide([[0, 0], [3, 4]]);
  approx(r.dist, 5, "two points → distance 5 (3-4-5)");
  ok((r.i === 0 && r.j === 1) || (r.i === 1 && r.j === 0), "two points → pair (0,1)");

  // Three points, closest is the last two.
  var r3 = C.divide([[0, 0], [10, 0], [11, 0]]);
  approx(r3.dist, 1, "three collinear → closest distance 1");

  // A known five-point set. Closest pair is (1,1)-(2,2): distance √2.
  var pts = [[0, 0], [5, 5], [1, 1], [2, 2], [9, 1]];
  approx(C.brute(pts).dist, Math.SQRT2, "brute finds √2 on the five-point set");
  approx(C.divide(pts).dist, Math.SQRT2, "divide finds √2 on the five-point set");
})();

// ---------------------------------------------------------------------------
section("divide-and-conquer matches brute force (random, many trials)");
// ---------------------------------------------------------------------------
(function () {
  var rng = C.seeded(12345);
  var allMatch = true, worst = "";
  for (var trial = 0; trial < 400; trial++) {
    var n = 2 + Math.floor(rng() * 60);
    var pts = C.makePoints("uniform", n, { rng: rng, w: 500, h: 500 });
    var b = C.brute(pts), d = C.divide(pts);
    if (!C.almostEqual(b.dist, d.dist)) {
      allMatch = false; worst = "n=" + n + " brute=" + b.dist + " divide=" + d.dist;
    }
  }
  ok(allMatch, "400 random trials agree on the closest distance" + (worst ? " — " + worst : ""));
})();

// ---------------------------------------------------------------------------
section("agreement across every generator shape");
// ---------------------------------------------------------------------------
(function () {
  var rng = C.seeded(999);
  ["uniform", "clustered", "grid", "circle"].forEach(function (kind) {
    var allMatch = true;
    [2, 3, 4, 5, 8, 16, 50, 137].forEach(function (n) {
      var pts = C.makePoints(kind, n, { rng: rng });
      if (pts.length < 2) { return; }
      var b = C.brute(pts), d = C.divide(pts);
      if (!C.almostEqual(b.dist, d.dist)) { allMatch = false; }
    });
    ok(allMatch, "divide matches brute on '" + kind + "' points across sizes");
  });
})();

// ---------------------------------------------------------------------------
section("duplicate points → distance zero");
// ---------------------------------------------------------------------------
(function () {
  // Two coincident points anywhere in the set: the minimum distance is 0, and
  // both algorithms must find it.
  var pts = [[10, 10], [40, 90], [10, 10], [7, 3], [55, 55]];
  eq(C.brute(pts).dist, 0, "brute finds the coincident pair (dist 0)");
  eq(C.divide(pts).dist, 0, "divide finds the coincident pair (dist 0)");

  // A grid has many tied closest pairs (all adjacent cells). Distances must
  // still match exactly.
  var grid = C.makePoints("grid", 100);
  approx(C.brute(grid).dist, C.divide(grid).dist, "grid: tied closest pairs still agree");
})();

// ---------------------------------------------------------------------------
section("the reported pair really is that distance apart");
// ---------------------------------------------------------------------------
(function () {
  var rng = C.seeded(7);
  var good = true;
  for (var t = 0; t < 50; t++) {
    var pts = C.makePoints("uniform", 30, { rng: rng });
    var r = C.divide(pts);
    // Recompute the distance between the reported original points directly.
    var actual = C.dist(pts[r.i], pts[r.j]);
    if (!C.almostEqual(actual, r.dist)) { good = false; }
  }
  ok(good, "the pair of ids returned is genuinely r.dist apart");
})();

// ---------------------------------------------------------------------------
section("brute force does exactly n(n-1)/2 distance evaluations");
// ---------------------------------------------------------------------------
(function () {
  [2, 5, 10, 50, 100].forEach(function (n) {
    var pts = C.makePoints("uniform", n, { rng: C.seeded(n) });
    var r = C.brute(pts);
    eq(r.evals, n * (n - 1) / 2, "brute evals = n(n-1)/2 at n=" + n);
  });
})();

// ---------------------------------------------------------------------------
section("divide-and-conquer is genuinely sub-quadratic");
// ---------------------------------------------------------------------------
(function () {
  // At n=2000, brute does ~2,000,000 evaluations. Divide-and-conquer should do
  // dramatically fewer — we require at least a 10× reduction, which is a very
  // loose bound on the real O(n log n) behaviour and leaves room for clustered
  // and adversarial inputs.
  [1000, 2000].forEach(function (n) {
    var pts = C.makePoints("uniform", n, { rng: C.seeded(n * 3) });
    var b = C.brute(pts), d = C.divide(pts);
    approx(b.dist, d.dist, "n=" + n + ": same answer");
    ok(d.evals * 10 < b.evals, "n=" + n + ": divide uses <10% of brute's evals (" + d.evals + " vs " + b.evals + ")");
  });

  // Clustered points are the strip's stress case (many points near the split).
  // It must still stay well under brute's quadratic count.
  var cl = C.makePoints("clustered", 2000, { rng: C.seeded(42) });
  var cb = C.brute(cl), cd = C.divide(cl);
  approx(cb.dist, cd.dist, "clustered n=2000: same answer");
  ok(cd.evals * 5 < cb.evals, "clustered: divide still far below brute (" + cd.evals + " vs " + cb.evals + ")");
})();

// ---------------------------------------------------------------------------
section("recorded frames: compares reference real points, best decreases");
// ---------------------------------------------------------------------------
(function () {
  var pts = C.makePoints("uniform", 40, { rng: C.seeded(2024) });
  ["brute", "divide"].forEach(function (key) {
    var r = C.run(key, pts, { record: true });
    ok(r.frames && r.frames.length > 0, key + " records frames");
    // Every compare/best frame must reference valid point ids.
    var idsOk = r.frames.every(function (f) {
      if (f.type === "compare" || f.type === "best") {
        return f.i >= 0 && f.i < pts.length && f.j >= 0 && f.j < pts.length;
      }
      return true;
    });
    ok(idsOk, key + " frame ids are all valid point indices");
    // The "best" frames must be monotonically non-increasing in distance.
    var mono = true, prev = Infinity;
    r.frames.forEach(function (f) { if (f.type === "best") { if (f.dist > prev + 1e-9) { mono = false; } prev = f.dist; } });
    ok(mono, key + " best-so-far frames never increase");
    // The final best frame's distance equals the reported answer.
    var lastBest = null;
    r.frames.forEach(function (f) { if (f.type === "best") { lastBest = f; } });
    ok(lastBest && C.almostEqual(lastBest.dist, r.dist), key + " last best frame equals the result");
  });
})();

// ---------------------------------------------------------------------------
section("race() cross-checks and reports a speedup");
// ---------------------------------------------------------------------------
(function () {
  var pts = C.makePoints("uniform", 800, { rng: C.seeded(555) });
  var out = C.race(pts);
  ok(out.equalDist, "race: brute and divide agree on distance");
  ok(out.speedup > 5, "race: divide is >5× fewer evaluations (speedup " + out.speedup.toFixed(1) + "×)");
})();

// ---------------------------------------------------------------------------
section("degenerate inputs don't throw");
// ---------------------------------------------------------------------------
(function () {
  ok(C.brute([]).dist === Infinity, "brute on 0 points → Infinity, no pair");
  ok(C.divide([]).dist === Infinity, "divide on 0 points → Infinity");
  ok(C.brute([[1, 1]]).dist === Infinity, "single point → no pair");
  ok(C.divide([[1, 1]]).dist === Infinity, "single point (divide) → no pair");
  // All points on a vertical line (all x equal) — the split comparator must
  // still produce a total order and the strip logic must still work.
  var vert = [];
  for (var i = 0; i < 30; i++) { vert.push([5, i * 3]); }
  approx(C.divide(vert).dist, 3, "all-collinear vertical points → min gap 3");
  // All points identical.
  var same = [[2, 2], [2, 2], [2, 2], [2, 2]];
  eq(C.divide(same).dist, 0, "all-identical points → 0");
})();

// ---------------------------------------------------------------------------
console.log("");
if (fail === 0) { console.log("ALL PASSED — " + pass + " checks"); }
else { console.log(pass + " passed, " + fail + " FAILED"); process.exit(1); }
