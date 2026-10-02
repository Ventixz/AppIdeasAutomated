/*
 * tests.js — a dependency-free suite for the Minimum Spanning Tree core.
 *
 *   node projects/phase2-graph/minimum-spanning-tree/tests.js
 *
 * Strategy: the headline claim of this project — *this is the cheapest set of
 * edges that keeps every node connected* — is pinned against INDEPENDENT oracles
 * that share no code with the algorithm under test:
 *
 *   - Kruskal's total    ↔ Prim's total (two different algorithms, same sum)
 *   - small totals       ↔ brute force (enumerate every spanning forest)
 *   - optimality         ↔ the cycle property (no non-tree edge is lighter than
 *                          the heaviest edge on the tree path it would close)
 *   - structure          ↔ re-checked to be an acyclic forest spanning every
 *                          component
 *
 * Hand-worked classics (a line, a triangle where the heavy edge is dropped, the
 * CLRS textbook graph, a disconnected graph that becomes a forest, a square with
 * a diagonal, a parallel edge that must collapse to the cheaper one, an ignored
 * self-loop, negative weights) nail down the expected values; a randomised fuzz
 * loop then throws hundreds of small weighted graphs at both algorithms and the
 * oracles and demands they agree on every one.
 */
"use strict";
var M = require("./mst-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function approx(a, b, msg) { ok(Math.abs(a - b) < 1e-9, msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }

function edgeStr(edges) {
  return edges.map(function (e) { return e.u + "-" + e.v + "(" + e.w + ")"; }).join(" ");
}

// ---------------------------------------------------------------------------
section("parsing: separators, weights, comments, isolated nodes");
(function () {
  var p = M.parseLinks("a -- b : 5");
  eq(p.edges.length, 1, "one edge parsed");
  eq(p.edges[0].from, "a", "from");
  eq(p.edges[0].to, "b", "to");
  eq(p.edges[0].w, 5, "weight via colon");

  eq(M.parseLinks("a - b = 2.5").edges[0].w, 2.5, "weight via = and a decimal");
  eq(M.parseLinks("a b @ 3").edges[0].w, 3, "weight via @ on whitespace sep");
  eq(M.parseLinks("a - b (10)").edges[0].w, 10, "weight in parentheses");
  eq(M.parseLinks("a -- b").edges[0].w, 1, "default weight is 1");

  // a digit inside a NAME must not be eaten as a weight
  var nm = M.parseLinks("node2 -- node3");
  eq(nm.edges[0].from, "node2", "name keeps trailing digit (from)");
  eq(nm.edges[0].to, "node3", "name keeps trailing digit (to)");

  // comments and isolated nodes
  var c = M.parseLinks("a -- b : 2  # cost two\nlonely\n# whole line comment");
  eq(c.edges.length, 1, "comment stripped, one edge");
  eq(c.singles.length, 1, "one isolated node");
  eq(c.singles[0], "lonely", "the isolated node name");

  // negative weight parsed & flagged (legal for MST)
  var neg = M.parseLinks("a -- b : -3");
  eq(neg.edges[0].w, -3, "negative weight parsed");
  ok(neg.anyNegative, "anyNegative flag set");
})();

// ---------------------------------------------------------------------------
section("building: undirected, parallels collapse to cheaper, self-loops ignored");
(function () {
  // arrow is read as undirected; both directions present
  var g = M.fromText("a -> b : 3");
  eq(g.weightOf("a", "b"), 3, "a–b weight");
  eq(g.weightOf("b", "a"), 3, "b–a weight (undirected)");
  eq(g.edgeCount, 1, "one undirected edge");

  // two a–b edges, costs 9 then 4: the cheaper (4) must win, one duplicate
  var d = M.fromText("a -- b : 9\nb -- a : 4");
  eq(d.weightOf("a", "b"), 4, "parallel edges collapse to the cheaper weight");
  eq(d.duplicates, 1, "one duplicate counted");
  eq(d.edgeCount, 1, "edge count counts the single kept edge");

  // self-loop kept only as a count
  var s = M.fromText("a -- a : 5\na -- b : 2");
  eq(s.selfLoops, 1, "self-loop counted");
  eq(s.weightOf("a", "a"), Infinity, "self-loop absent from adjacency");
  eq(s.edgeCount, 1, "only the real edge counts");
})();

// ---------------------------------------------------------------------------
section("MST: a straight line a-b-c-d");
(function () {
  var g = M.fromText("a -- b : 1\nb -- c : 2\nc -- d : 3");
  var kr = M.kruskal(g), pr = M.prim(g);
  eq(kr.total, 6, "line total = 1+2+3 (every edge is needed)");
  eq(pr.total, 6, "Prim agrees");
  eq(kr.edges.length, 3, "a tree on 4 nodes has 3 edges");
  ok(kr.connected, "connected");
  ok(M.isSpanningForest(g, kr.edges).ok, "Kruskal result is a spanning forest");
  ok(M.firstCyclePropertyViolation(g, kr.edges) === null, "no cycle-property violation");
})();

// ---------------------------------------------------------------------------
section("MST: a triangle drops its heaviest edge");
(function () {
  // triangle a-b 1, b-c 2, a-c 3: MST keeps the two light edges, drops the 3
  var g = M.fromText("a -- b : 1\nb -- c : 2\na -- c : 3");
  var kr = M.kruskal(g);
  eq(kr.total, 3, "keeps 1+2, drops the 3");
  eq(edgeStr(kr.edges), "a-b(1) b-c(2)", "the two light edges chosen");
  // the dropped non-tree edge (a-c,3) must be ≥ heaviest on path a..c (=2) ✓
  ok(M.firstCyclePropertyViolation(g, kr.edges) === null, "cycle property holds");
})();

// ---------------------------------------------------------------------------
section("MST: the CLRS textbook graph (total 37)");
(function () {
  // Cormen et al., Introduction to Algorithms — the canonical MST example.
  var g = M.fromText([
    "a -- b : 4", "a -- h : 8",
    "b -- h : 11", "b -- c : 8",
    "c -- d : 7", "c -- f : 4", "c -- i : 2",
    "d -- e : 9", "d -- f : 14",
    "e -- f : 10",
    "f -- g : 2",
    "g -- h : 1", "g -- i : 6",
    "h -- i : 7"
  ].join("\n"));
  var kr = M.kruskal(g), pr = M.prim(g);
  eq(kr.total, 37, "Kruskal total is the textbook 37");
  eq(pr.total, 37, "Prim total is the textbook 37");
  ok(kr.connected, "graph is connected");
  eq(kr.edges.length, g.nodes.length - 1, "spanning tree edge count = n-1");
  ok(M.isSpanningForest(g, kr.edges).ok, "it is a spanning tree");
  ok(M.firstCyclePropertyViolation(g, kr.edges) === null, "cycle property proves minimality");
  approx(M.bruteForestWeight(g), 37, "brute force confirms 37");
})();

// ---------------------------------------------------------------------------
section("MST: a square with a diagonal");
(function () {
  //  a - b  (top 1), b - c (right 1), c - d (bottom 1), d - a (left 1),
  //  a - c diagonal 5: the MST is any 3 of the four unit edges = total 3.
  var g = M.fromText("a -- b : 1\nb -- c : 1\nc -- d : 1\nd -- a : 1\na -- c : 5");
  var kr = M.kruskal(g);
  eq(kr.total, 3, "three unit edges, diagonal dropped");
  approx(M.bruteForestWeight(g), 3, "brute force agrees");
  ok(M.firstCyclePropertyViolation(g, kr.edges) === null, "cycle property holds");
})();

// ---------------------------------------------------------------------------
section("minimum spanning FOREST on a disconnected graph");
(function () {
  // two islands: {a,b,c} and {x,y}, plus an isolated node z
  var g = M.fromText("a -- b : 1\nb -- c : 2\na -- c : 5\nx -- y : 4\nz");
  var kr = M.kruskal(g), pr = M.prim(g);
  eq(g.nodes.length, 6, "six nodes incl. isolated z");
  eq(kr.componentCount, 3, "three components");
  ok(kr.isForest, "it's a forest, not a single tree");
  ok(!kr.connected, "graph is not connected");
  eq(kr.total, 1 + 2 + 4, "forest total = (a-b)+(b-c)+(x-y)");
  eq(pr.total, kr.total, "Prim agrees on the forest total");
  // n − components edges: 6 − 3 = 3
  eq(kr.edges.length, 3, "forest has n - c = 3 edges");
  ok(M.isSpanningForest(g, kr.edges).ok, "valid spanning forest");
  ok(M.firstCyclePropertyViolation(g, kr.edges) === null, "cycle property holds across components");
  approx(M.bruteForestWeight(g), kr.total, "brute force agrees on the forest");
})();

// ---------------------------------------------------------------------------
section("negative weights are allowed");
(function () {
  var g = M.fromText("a -- b : -5\nb -- c : -2\na -- c : 3");
  var kr = M.kruskal(g), pr = M.prim(g);
  eq(kr.total, -7, "keeps the two negative edges (-5 and -2)");
  eq(pr.total, -7, "Prim agrees with negatives");
  ok(M.firstCyclePropertyViolation(g, kr.edges) === null, "cycle property holds with negatives");
  approx(M.bruteForestWeight(g), -7, "brute force agrees with negatives");
})();

// ---------------------------------------------------------------------------
section("Kruskal steps: edges considered lightest-first, cycles rejected");
(function () {
  var g = M.fromText("a -- b : 1\nb -- c : 2\na -- c : 3\nc -- d : 4");
  var kr = M.kruskal(g);
  // steps in weight order: (a-b,1)✓ (b-c,2)✓ (a-c,3)✗cycle (c-d,4)✓
  var seq = kr.steps.map(function (s) { return s.w + (s.accepted ? "+" : "-"); }).join(" ");
  eq(seq, "1+ 2+ 3- 4+", "steps accept/reject in sorted order, a-c rejected as a cycle");
  var accepted = kr.steps.filter(function (s) { return s.accepted; }).length;
  eq(accepted, kr.edges.length, "accepted steps match chosen edge count");
})();

// ---------------------------------------------------------------------------
section("a detector that must FIRE on a wrong (non-minimal) tree");
(function () {
  // triangle a-b 1, b-c 2, a-c 3. A WRONG spanning tree picks {a-c(3), b-c(2)}
  // = total 5. The non-tree edge a-b(1) is lighter than the heaviest edge on the
  // tree path a..b (which goes a-c-b, heaviest 3), so the cycle property MUST
  // flag it. This proves the oracle catches non-minimal trees, not just blesses
  // correct ones.
  var g = M.fromText("a -- b : 1\nb -- c : 2\na -- c : 3");
  var wrong = [{ u: "a", v: "c", w: 3 }, { u: "b", v: "c", w: 2 }];
  ok(M.isSpanningForest(g, wrong).ok, "the wrong set is still a valid spanning tree (just not minimal)");
  var viol = M.firstCyclePropertyViolation(g, wrong);
  ok(viol !== null, "cycle property FIRES on the non-minimal tree");
  ok(viol && viol.u === "a" && viol.v === "b", "it fingers the lighter non-tree edge a-b");
})();

// ---------------------------------------------------------------------------
section("isSpanningForest rejects cycles and wrong edge counts");
(function () {
  var g = M.fromText("a -- b : 1\nb -- c : 1\nc -- a : 1");
  // all three edges = a cycle, not a tree
  var cyc = M.isSpanningForest(g, [{ u: "a", v: "b", w: 1 }, { u: "b", v: "c", w: 1 }, { u: "a", v: "c", w: 1 }]);
  ok(!cyc.ok, "three edges on a triangle is rejected (cycle / too many)");
  // too few edges
  var few = M.isSpanningForest(g, [{ u: "a", v: "b", w: 1 }]);
  ok(!few.ok, "one edge can't span three connected nodes");
  // a non-existent edge
  var ghost = M.isSpanningForest(g, [{ u: "a", v: "b", w: 1 }, { u: "a", v: "zzz", w: 1 }]);
  ok(!ghost.ok, "an edge not in the graph is rejected");
})();

// ---------------------------------------------------------------------------
section("analyze: one-shot for the UI");
(function () {
  var a = M.analyze("a -- b : 1\nb -- c : 2\na -- c : 3", { start: "a" });
  eq(a.total, 3, "total weight");
  eq(a.componentCount, 1, "one component");
  ok(a.connected, "connected");
  ok(!a.isForest, "not a forest");
  eq(a.kruskal.total, a.prim.total, "Kruskal and Prim totals match in analyze");
})();

// ---------------------------------------------------------------------------
section("union-find basics");
(function () {
  var ds = new M.DisjointSet(["a", "b", "c", "d"]);
  eq(ds.count, 4, "four singletons");
  ok(ds.union("a", "b"), "union a,b merges");
  ok(!ds.union("a", "b"), "re-union returns false (already together)");
  eq(ds.count, 3, "count drops to 3");
  ds.union("c", "d"); ds.union("b", "c");
  eq(ds.count, 1, "all merged");
  eq(ds.find("a"), ds.find("d"), "a and d share a root");
})();

// ---------------------------------------------------------------------------
section("heap: pops in non-decreasing order");
(function () {
  var h = new M.MinHeap();
  var vals = [5, 3, 8, 1, 9, 2, 7, 0, 4, 6];
  for (var i = 0; i < vals.length; i++) { h.push(vals[i], "n" + i); }
  var out = [];
  while (h.size() > 0) { out.push(h.pop().dist); }
  var sorted = vals.slice().sort(function (x, y) { return x - y; });
  eq(out.join(","), sorted.join(","), "heap emptied in sorted order");
})();

// ---------------------------------------------------------------------------
section("layout is deterministic and in-bounds");
(function () {
  var g = M.fromText("a -- b : 1\nb -- c : 1\nc -- a : 1\nd -- a : 1");
  var p1 = M.layout(g, { seed: 42, iterations: 120, width: 800, height: 560 });
  var p2 = M.layout(g, { seed: 42, iterations: 120, width: 800, height: 560 });
  var same = true, inBounds = true;
  for (var i = 0; i < g.nodes.length; i++) {
    var n = g.nodes[i];
    if (p1[n].x !== p2[n].x || p1[n].y !== p2[n].y) { same = false; }
    if (!(p1[n].x >= 0 && p1[n].x <= 800 && p1[n].y >= 0 && p1[n].y <= 560)) { inBounds = false; }
    if (!isFinite(p1[n].x) || !isFinite(p1[n].y)) { inBounds = false; }
  }
  ok(same, "same seed ⇒ identical coordinates");
  ok(inBounds, "every node placed at a finite, in-bounds point");
  var zero = M.fromText("", {});
  ok(Object.keys(M.layout(zero, {})).length === 0, "empty graph lays out to nothing");
  var one = M.fromText("solo", {});
  ok(M.layout(one, {})["solo"] != null, "single node is placed");
})();

// ---------------------------------------------------------------------------
section("randomised fuzz: Kruskal vs Prim vs brute force & the cycle property");
(function () {
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(2026);
  var trials = 600, checks = 0, mismatches = 0;
  for (var trial = 0; trial < trials; trial++) {
    var n = 2 + Math.floor(rnd() * 6);          // 2..7 nodes
    var names = [];
    for (var i = 0; i < n; i++) { names.push("n" + i); }
    var lines = [];
    var pEdge = 0.25 + rnd() * 0.55;
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        if (rnd() < pEdge) {
          var w = Math.floor(rnd() * 20) - 3;    // weights -3..16 (negatives too)
          lines.push(names[a] + " -- " + names[b] + " : " + w);
        }
      }
    }
    var g = M.fromText(lines.join("\n"), { singles: names });
    var kr = M.kruskal(g), pr = M.prim(g, names[Math.floor(rnd() * n)]);

    // (1) Kruskal and Prim agree on total weight
    if (Math.abs(kr.total - pr.total) > 1e-9) { mismatches++; }
    checks++;

    // (2) both results are valid spanning forests
    if (!M.isSpanningForest(g, kr.edges).ok) { mismatches++; }
    if (!M.isSpanningForest(g, pr.edges).ok) { mismatches++; }
    checks += 2;

    // (3) neither has a cycle-property violation ⇒ both are minimal
    if (M.firstCyclePropertyViolation(g, kr.edges) !== null) { mismatches++; }
    if (M.firstCyclePropertyViolation(g, pr.edges) !== null) { mismatches++; }
    checks += 2;

    // (4) brute force agrees on the forest total (small graphs only)
    if (n <= 6 && g.edgeCount <= 14) {
      var brute = M.bruteForestWeight(g);
      if (Math.abs(brute - kr.total) > 1e-9) { mismatches++; }
      checks++;
    }

    // (5) component count is consistent between the two algorithms
    if (kr.componentCount !== pr.componentCount) { mismatches++; }
    checks++;
  }
  eq(mismatches, 0, "no MST/oracle mismatches across " + checks + " fuzz checks");
})();

// ---------------------------------------------------------------------------
console.log("\n----------------------------------------");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("----------------------------------------");
if (fail > 0) { process.exit(1); }
