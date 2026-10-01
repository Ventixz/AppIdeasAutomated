/*
 * tests.js — a dependency-free suite for the Dijkstra core.
 *
 *   node projects/phase2-graph/dijkstra/tests.js
 *
 * Strategy: the headline claim of this project — *these are the cheapest
 * distances from the source, and here is a path that realises each one* — is
 * pinned against INDEPENDENT oracles that share no code with Dijkstra:
 *
 *   - distances          ↔ Bellman–Ford (relax-every-edge |V|-1 times)
 *   - small distances    ↔ brute-force enumeration of every simple path
 *   - optimality         ↔ the relaxation invariant (no edge is relaxable)
 *   - each path          ↔ re-walked edge by edge, its cost re-summed
 *
 * Hand-worked classics (a line, a triangle with a shortcut, the CLRS graph, a
 * disconnected target, a directed-vs-undirected pair, zero weights, a parallel
 * edge that must collapse to the cheaper one, an ignored self-loop) nail down
 * the expected values; a randomised fuzz loop then throws hundreds of small
 * weighted graphs at Dijkstra and the oracles and demands they agree on every
 * one.
 */
"use strict";
var D = require("./dijkstra-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function approx(a, b, msg) { ok(Math.abs(a - b) < 1e-9, msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }

// Distances agree across every node of a graph.
function distsEqual(g, d1, d2) {
  for (var i = 0; i < g.nodes.length; i++) {
    var u = g.nodes[i];
    if (d1[u] === Infinity || d2[u] === Infinity) { if (d1[u] !== d2[u]) { return false; } }
    else if (Math.abs(d1[u] - d2[u]) > 1e-9) { return false; }
  }
  return true;
}

// ---------------------------------------------------------------------------
section("parsing: separators, weights, comments, isolated nodes");
(function () {
  var p = D.parseLinks("a -> b : 5");
  eq(p.edges.length, 1, "one edge parsed");
  eq(p.edges[0].from, "a", "from");
  eq(p.edges[0].to, "b", "to");
  eq(p.edges[0].w, 5, "weight via colon");

  eq(D.parseLinks("a -- b = 2.5").edges[0].w, 2.5, "weight via = and a decimal");
  eq(D.parseLinks("a b @ 3").edges[0].w, 3, "weight via @ on whitespace sep");
  eq(D.parseLinks("a - b (10)").edges[0].w, 10, "weight in parentheses");
  eq(D.parseLinks("a -> b").edges[0].w, 1, "default weight is 1");

  // a digit inside a NAME must not be eaten as a weight
  var nm = D.parseLinks("node2 -> node3");
  eq(nm.edges[0].from, "node2", "name keeps trailing digit (from)");
  eq(nm.edges[0].to, "node3", "name keeps trailing digit (to)");
  eq(nm.edges[0].w, 1, "no weight marker ⇒ default 1 even though names end in digits");

  // explicit separators keep hyphens inside names
  var hy = D.parseLinks("node-1 -> node-2 : 4");
  eq(hy.edges[0].from, "node-1", "hyphen kept in from");
  eq(hy.edges[0].to, "node-2", "hyphen kept in to");

  // comments and isolated nodes
  var c = D.parseLinks("a -> b : 2  # cost two\nlonely\n# whole line comment");
  eq(c.edges.length, 1, "comment stripped, one edge");
  eq(c.singles.length, 1, "one isolated node");
  eq(c.singles[0], "lonely", "the isolated node name");

  // negative weight is flagged
  var neg = D.parseLinks("a -> b : -3");
  eq(neg.edges[0].w, -3, "negative weight parsed");
  ok(neg.anyNegative, "anyNegative flag set");
})();

// ---------------------------------------------------------------------------
section("building: parallel edges collapse to the cheaper, self-loops ignored");
(function () {
  // two a->b edges, costs 9 then 4: the cheaper (4) must win, one duplicate
  var g = D.fromText("a -> b : 9\na -> b : 4", { directed: true });
  eq(g.weightOf("a", "b"), 4, "parallel edges collapse to the cheaper weight");
  eq(g.duplicates, 1, "one duplicate counted");
  eq(g.edgeCount, 1, "edge count counts the single kept edge");

  // self-loop kept only as a count
  var s = D.fromText("a -> a : 5\na -> b : 2", { directed: true });
  eq(s.selfLoops, 1, "self-loop counted");
  eq(s.weightOf("a", "a"), Infinity, "self-loop absent from adjacency");

  // undirected mirrors both ways, counts the edge once
  var u = D.fromText("a -- b : 3", { directed: false });
  eq(u.weightOf("a", "b"), 3, "undirected a→b");
  eq(u.weightOf("b", "a"), 3, "undirected b→a");
  eq(u.edgeCount, 1, "undirected edge counted once");
})();

// ---------------------------------------------------------------------------
section("Dijkstra: a straight line a-b-c-d");
(function () {
  var g = D.fromText("a -> b : 1\nb -> c : 2\nc -> d : 3", { directed: true });
  var r = D.dijkstra(g, "a");
  eq(r.dist["a"], 0, "dist to source is 0");
  eq(r.dist["b"], 1, "dist a→b");
  eq(r.dist["c"], 3, "dist a→c = 1+2");
  eq(r.dist["d"], 6, "dist a→d = 1+2+3");
  var pc = D.pathTo(r, "d");
  eq(pc.path.join(">"), "a>b>c>d", "path a→d");
  eq(pc.cost, 6, "path cost a→d");
  // settle order is by increasing distance
  eq(r.order.map(function (o) { return o.node; }).join(""), "abcd", "settle order by distance");
})();

// ---------------------------------------------------------------------------
section("Dijkstra: a triangle where the long way round is cheaper");
(function () {
  // direct a->c costs 10, but a->b->c costs 1+2=3
  var g = D.fromText("a -> b : 1\nb -> c : 2\na -> c : 10", { directed: true });
  var r = D.dijkstra(g, "a");
  eq(r.dist["c"], 3, "takes the cheaper two-hop route");
  eq(D.pathTo(r, "c").path.join(">"), "a>b>c", "path goes the long way round");
})();

// ---------------------------------------------------------------------------
section("Dijkstra: the CLRS textbook graph");
(function () {
  // Cormen et al., Introduction to Algorithms, the canonical single-source
  // example. Source s; known distances: s0 t8 x9 y5 z7.
  var g = D.fromText([
    "s -> t : 10", "s -> y : 5",
    "t -> y : 2", "t -> x : 1",
    "y -> t : 3", "y -> x : 9", "y -> z : 2",
    "x -> z : 4",
    "z -> x : 6", "z -> s : 7"
  ].join("\n"), { directed: true });
  var r = D.dijkstra(g, "s");
  eq(r.dist["s"], 0, "s");
  eq(r.dist["t"], 8, "t = 8 (s→y→t = 5+3)");
  eq(r.dist["x"], 9, "x = 9 (s→y→t→x = 5+3+1)");
  eq(r.dist["y"], 5, "y = 5");
  eq(r.dist["z"], 7, "z = 7 (s→y→z = 5+2)");
  eq(D.pathTo(r, "x").path.join(">"), "s>y>t>x", "path to x");
  // agree with Bellman–Ford
  ok(distsEqual(g, r.dist, D.bellmanFord(g, "s")), "CLRS distances match Bellman–Ford");
  // the labelling is optimal: no edge is relaxable
  ok(D.firstRelaxableEdge(g, r.dist) === null, "no relaxable edge remains");
})();

// ---------------------------------------------------------------------------
section("unreachable target & zero-weight edges");
(function () {
  var g = D.fromText("a -> b : 4\nc -> d : 1", { directed: true });
  var r = D.dijkstra(g, "a");
  eq(r.dist["c"], Infinity, "c unreachable from a");
  eq(D.pathTo(r, "c").path.length, 0, "no path to unreachable node");
  eq(D.pathTo(r, "c").cost, Infinity, "unreachable cost is Infinity");

  var z = D.fromText("a -> b : 0\nb -> c : 0", { directed: true });
  var rz = D.dijkstra(z, "a");
  eq(rz.dist["c"], 0, "zero-weight edges give distance 0");
  eq(D.pathTo(rz, "c").path.join(">"), "a>b>c", "zero-weight path still reconstructed");
})();

// ---------------------------------------------------------------------------
section("directed vs undirected differ");
(function () {
  var dir = D.fromText("a -> b : 1\nb -> c : 1", { directed: true });
  eq(D.dijkstra(dir, "c").dist["a"], Infinity, "directed: can't get back from c to a");

  var und = D.fromText("a - b : 1\nb - c : 1", { directed: false });
  eq(D.dijkstra(und, "c").dist["a"], 2, "undirected: c→b→a = 2");
})();

// ---------------------------------------------------------------------------
section("path verification oracle");
(function () {
  var g = D.fromText("a -> b : 2\nb -> c : 3\na -> c : 10", { directed: true });
  var r = D.dijkstra(g, "a");
  ok(D.verifyPath(g, r, "c").ok, "re-walked path to c has matching cost");
  ok(D.verifyPath(g, r, "a").ok, "trivial path to source verifies");
  // an in-graph but unreachable target: empty path, and verifyPath confirms it
  var g2 = D.fromText("a -> b : 1\nc -> d : 1", { directed: true });
  var vp = D.verifyPath(g2, D.dijkstra(g2, "a"), "d");
  ok(vp.ok && vp.reason === "unreachable", "verifyPath confirms an unreachable target");
})();

// ---------------------------------------------------------------------------
section("analyze: one-shot for the UI");
(function () {
  var a = D.analyze("s -> t : 10\ns -> y : 5\ny -> t : 3", { directed: true, source: "s" });
  eq(a.source, "s", "chosen source");
  eq(a.reached, 3, "all three nodes reached");
  eq(a.unreached, 0, "none unreached");
  eq(a.farthest, "t", "farthest node is t");
  eq(a.farDist, 8, "farthest distance 8");

  // a bad/absent source falls back to the first node
  var b = D.analyze("a -> b : 1", { directed: true, source: "nope" });
  eq(b.source, "a", "absent source falls back to first node");
})();

// ---------------------------------------------------------------------------
section("heap: pops in non-decreasing order");
(function () {
  var h = new D.MinHeap();
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
  var g = D.fromText("a -> b : 1\nb -> c : 1\nc -> a : 1\nd -> a : 1", { directed: true });
  var p1 = D.layout(g, { seed: 42, iterations: 120, width: 800, height: 560 });
  var p2 = D.layout(g, { seed: 42, iterations: 120, width: 800, height: 560 });
  var same = true, inBounds = true;
  for (var i = 0; i < g.nodes.length; i++) {
    var n = g.nodes[i];
    if (p1[n].x !== p2[n].x || p1[n].y !== p2[n].y) { same = false; }
    if (!(p1[n].x >= 0 && p1[n].x <= 800 && p1[n].y >= 0 && p1[n].y <= 560)) { inBounds = false; }
    if (!isFinite(p1[n].x) || !isFinite(p1[n].y)) { inBounds = false; }
  }
  ok(same, "same seed ⇒ identical coordinates");
  ok(inBounds, "every node placed at a finite, in-bounds point");
  // degenerate sizes don't throw
  var zero = D.fromText("", {});
  ok(Object.keys(D.layout(zero, {})).length === 0, "empty graph lays out to nothing");
  var one = D.fromText("solo", {});
  ok(D.layout(one, {})["solo"] != null, "single node is placed");
})();

// ---------------------------------------------------------------------------
section("randomised fuzz: Dijkstra vs Bellman–Ford, brute force & the invariant");
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
  var trials = 500, checks = 0, mismatches = 0;
  for (var trial = 0; trial < trials; trial++) {
    var n = 2 + Math.floor(rnd() * 6);          // 2..7 nodes
    var directed = rnd() < 0.5;
    var names = [];
    for (var i = 0; i < n; i++) { names.push("n" + i); }
    var lines = [];
    var pEdge = 0.3 + rnd() * 0.5;
    for (var a = 0; a < n; a++) {
      for (var b = 0; b < n; b++) {
        if (a === b) { continue; }
        if (!directed && b < a) { continue; }
        if (rnd() < pEdge) {
          var w = Math.floor(rnd() * 20);        // non-negative 0..19
          lines.push(names[a] + (directed ? " -> " : " -- ") + names[b] + " : " + w);
        }
      }
    }
    var g = D.fromText(lines.join("\n"), { directed: directed, singles: names });
    var src = names[Math.floor(rnd() * n)];
    var r = D.dijkstra(g, src);

    // (1) Bellman–Ford agreement
    if (!distsEqual(g, r.dist, D.bellmanFord(g, src))) { mismatches++; }
    checks++;

    // (2) no edge is relaxable ⇒ labelling is optimal
    if (D.firstRelaxableEdge(g, r.dist) !== null) { mismatches++; }
    checks++;

    // (3) brute force on a random target (small graphs only)
    if (n <= 6) {
      var tgt = names[Math.floor(rnd() * n)];
      var brute = D.bruteShortest(g, src, tgt);
      var got = r.dist[tgt];
      var bruteInf = (brute === Infinity), gotInf = (got === Infinity);
      if (bruteInf !== gotInf || (!bruteInf && Math.abs(brute - got) > 1e-9)) { mismatches++; }
      checks++;
    }

    // (4) every reconstructed path re-walks to its claimed cost
    for (var t = 0; t < n; t++) {
      var vp = D.verifyPath(g, r, names[t]);
      if (!vp.ok) { mismatches++; }
      checks++;
    }
  }
  eq(mismatches, 0, "no Dijkstra/oracle mismatches across " + checks + " fuzz checks");
})();

// ---------------------------------------------------------------------------
console.log("\n----------------------------------------");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("----------------------------------------");
if (fail > 0) { process.exit(1); }
