/*
 * tests.js — a dependency-free suite for the Eulerian-trail core.
 *
 *   node projects/phase2-graph/eulerian-path/tests.js
 *
 * Strategy: the two claims worth pinning down are (1) the CLASSIFICATION —
 * whether a trail exists and where it must start/end — and (2) the TRAIL itself.
 *
 *   - Classification is checked against hand-worked graphs whose answer is known
 *     from Euler's theorem (Königsberg has 4 odd vertices -> none; a single
 *     bridge fixed makes exactly 2 -> path; a square is all-even -> circuit),
 *     and against a brute-force ORACLE that decides Euler-existence by actually
 *     searching for a trail with backtracking on small graphs.
 *   - Every trail the solver returns is fed to an INDEPENDENT verifier
 *     (verifyTrail) that re-walks it edge by edge: it never trusts the solver's
 *     own bookkeeping. On top of that, a randomised fuzz loop builds hundreds of
 *     small multigraphs and asserts solver-says-yes iff oracle-says-yes, and
 *     that every produced trail verifies.
 */
"use strict";
var G = require("./graph-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function section(name) { console.log("\n== " + name + " =="); }

function build(text, directed) {
  return G.buildMultigraph(G.parseLinks(text), { directed: !!directed });
}

// ---------------------------------------------------------------------------
// A brute-force oracle: does an Eulerian trail exist? Try every edge as the
// first step from every possible start and backtrack. Exponential — only ever
// used on tiny fuzz graphs (<= ~9 edges). Returns { exists, isCircuit }.
// ---------------------------------------------------------------------------
function oracle(g) {
  var m = g.edges.length;
  if (m === 0) { return { exists: true, isCircuit: true }; }
  // adjacency of stubs {to, id}
  var stubs = Object.create(null);
  for (var i = 0; i < g.nodes.length; i++) { stubs[g.nodes[i]] = []; }
  for (var e = 0; e < g.edges.length; e++) {
    var a = g.edges[e].from, b = g.edges[e].to;
    stubs[a].push({ to: b, id: e });
    if (!g.directed) { stubs[b].push({ to: a, id: e }); }
  }
  var used = new Array(m);
  var foundCircuit = false, foundPath = false;

  function dfs(v, count, startV) {
    if (count === m) {
      if (v === startV) { foundCircuit = true; }
      else { foundPath = true; }
      return;
    }
    var list = stubs[v];
    for (var k = 0; k < list.length; k++) {
      if (used[list[k].id]) { continue; }
      used[list[k].id] = true;
      dfs(list[k].to, count + 1, startV);
      used[list[k].id] = false;
      // Keep searching: we want to know if BOTH a circuit and a path are
      // possible, so we don't early-return on first success.
    }
  }
  for (var s = 0; s < g.nodes.length; s++) {
    if (G.totalDegree(g, g.nodes[s]) === 0) { continue; }
    dfs(g.nodes[s], 0, g.nodes[s]);
  }
  return { exists: foundCircuit || foundPath, isCircuit: foundCircuit };
}

// ---------------------------------------------------------------------------
section("parsing / building: multigraph keeps parallels and self-loops");
// ---------------------------------------------------------------------------
(function () {
  var g = build("a -- b\nb -- a\na -- a\nc", false);
  eq(g.edges.length, 3, "three distinct edges kept (parallel a-b, and self-loop a-a)");
  eq(g.parallels, 1, "one parallel link counted (b--a duplicates a--b)");
  eq(g.selfLoops, 1, "one self-loop counted");
  eq(G.degreeOf(g, "a").degree, 4, "a: degree 4 (two parallels = 2, self-loop = +2)");
  eq(G.degreeOf(g, "b").degree, 2, "b: degree 2");
  eq(G.degreeOf(g, "c").degree, 0, "c: isolated, degree 0");

  var d = build("x -> y\nx -> y\ny -> x", true);
  eq(d.edges.length, 3, "directed multigraph keeps parallel arcs");
  eq(G.degreeOf(d, "x").out, 2, "x out-degree 2");
  eq(G.degreeOf(d, "x").in, 1, "x in-degree 1");
})();

// ---------------------------------------------------------------------------
section("classification: the classic hand-worked graphs");
// ---------------------------------------------------------------------------
(function () {
  // Seven Bridges of Königsberg: 4 land masses, 7 bridges, degrees 5,3,3,3 —
  // all four odd. Euler's answer: no walk crosses every bridge once.
  var k = build(
    "A -- B\nA -- B\nA -- C\nA -- C\nA -- D\nB -- D\nC -- D", false);
  var kc = G.classifyEulerian(k);
  eq(kc.kind, "none", "Konigsberg: no Eulerian trail");
  eq(kc.oddVertices.length, 4, "Konigsberg: four odd-degree vertices");

  // Remove one A–B bridge -> degrees A:4 B:2 C:3 D:3 — exactly two odd (C, D):
  // an Eulerian PATH from C to D (or D to C).
  var k2 = build("A -- B\nA -- C\nA -- C\nA -- D\nB -- D\nC -- D", false);
  var k2c = G.classifyEulerian(k2);
  eq(k2c.kind, "path", "Konigsberg minus one bridge: Eulerian path");
  ok((k2c.start === "C" && k2c.end === "D") || (k2c.start === "D" && k2c.end === "C"),
     "path runs between the two odd vertices C and D");

  // A 4-cycle (square): every vertex even -> Eulerian circuit.
  var sq = build("a -- b\nb -- c\nc -- d\nd -- a", false);
  var sc = G.classifyEulerian(sq);
  eq(sc.kind, "circuit", "square: Eulerian circuit");
  eq(sc.oddVertices.length, 0, "square: no odd vertices");

  // A path graph a-b-c: endpoints odd (deg 1), middle even (deg 2) -> path.
  var pth = build("a -- b\nb -- c", false);
  eq(G.classifyEulerian(pth).kind, "path", "a-b-c is an Eulerian path");

  // Two disjoint edges -> disconnected -> none.
  var dis = build("a -- b\nc -- d", false);
  var disc = G.classifyEulerian(dis);
  eq(disc.kind, "none", "two disjoint edges: none");
  eq(disc.connected, false, "and reported disconnected");

  // No edges: trivially a circuit.
  eq(G.classifyEulerian(build("lonely", false)).kind, "circuit", "no edges: trivial circuit");
})();

// ---------------------------------------------------------------------------
section("classification: directed graphs");
// ---------------------------------------------------------------------------
(function () {
  // Directed 3-cycle: every vertex in==out -> circuit.
  var cyc = build("a -> b\nb -> c\nc -> a", true);
  eq(G.classifyEulerian(cyc).kind, "circuit", "directed 3-cycle: circuit");

  // Directed path a->b->c: a has out-in=+1 (start), c has in-out=+1 (end) -> path.
  var dp = build("a -> b\nb -> c", true);
  var dpc = G.classifyEulerian(dp);
  eq(dpc.kind, "path", "directed a->b->c: path");
  eq(dpc.start, "a", "directed path starts at a (the +1 out vertex)");
  eq(dpc.end, "c", "directed path ends at c (the +1 in vertex)");

  // Two starts / two ends -> none.
  var bad = build("a -> c\nb -> c\nc -> d\nc -> e", true);
  eq(G.classifyEulerian(bad).kind, "none", "two sources & two sinks: none");

  // Directed self-loop keeps balance: a->a alone is a one-edge circuit.
  eq(G.classifyEulerian(build("a -> a", true)).kind, "circuit", "directed self-loop: circuit");
})();

// ---------------------------------------------------------------------------
section("trail construction + independent verification");
// ---------------------------------------------------------------------------
(function () {
  // Square circuit: 4 edges, trail length 5, returns to start.
  var sq = build("a -- b\nb -- c\nc -- d\nd -- a", false);
  var r = G.findEulerianTrail(sq);
  ok(r !== null, "square: trail found");
  eq(r.edgeOrder.length, 4, "square: all 4 edges used");
  eq(r.trail.length, 5, "square: trail visits 5 vertices (E+1)");
  ok(r.isCircuit, "square: it is a circuit");
  ok(G.verifyTrail(sq, r).ok, "square: trail independently verifies");

  // Königsberg minus a bridge: path from odd to odd.
  var k2 = build("A -- B\nA -- C\nA -- C\nA -- D\nB -- D\nC -- D", false);
  var rk = G.findEulerianTrail(k2);
  ok(rk !== null, "Konigsberg-1: trail found");
  eq(rk.edgeOrder.length, 6, "Konigsberg-1: all 6 bridges crossed once");
  ok(!rk.isCircuit, "Konigsberg-1: it is a path, not a circuit");
  ok((rk.trail[0] === "C" || rk.trail[0] === "D"), "Konigsberg-1: starts at an odd vertex");
  ok(G.verifyTrail(k2, rk).ok, "Konigsberg-1: trail independently verifies");

  // Königsberg itself: no trail.
  var k = build("A -- B\nA -- B\nA -- C\nA -- C\nA -- D\nB -- D\nC -- D", false);
  eq(G.findEulerianTrail(k), null, "Konigsberg: no trail returned");

  // Self-loop must be traversed: a--a plus a--b, a: deg 3 odd, b: deg 1 odd.
  var sl = build("a -- a\na -- b", false);
  var rs = G.findEulerianTrail(sl);
  ok(rs !== null, "self-loop graph: trail found");
  eq(rs.edgeOrder.length, 2, "self-loop graph: both edges (loop + bridge) used");
  ok(G.verifyTrail(sl, rs).ok, "self-loop graph: verifies");

  // Directed path.
  var dp = build("a -> b\nb -> c\nc -> a\na -> c", true);
  // degrees: a out2 in1 (+1), c out1 in2 (-1), b out1 in1 -> path a..c
  var rd = G.findEulerianTrail(dp);
  ok(rd !== null, "directed: trail found");
  eq(rd.edgeOrder.length, 4, "directed: all 4 arcs used");
  eq(rd.trail[0], "a", "directed: starts at a");
  eq(rd.trail[rd.trail.length - 1], "c", "directed: ends at c");
  ok(G.verifyTrail(dp, rd).ok, "directed: trail independently verifies");

  // verifyTrail rejects a tampered trail.
  var tampered = { trail: rd.trail.slice(), edgeOrder: rd.edgeOrder.slice() };
  tampered.edgeOrder[0] = tampered.edgeOrder[1];       // reuse an edge, drop another
  ok(!G.verifyTrail(dp, tampered).ok, "verifier rejects a trail that reuses an edge");
})();

// ---------------------------------------------------------------------------
section("fuzz: solver agrees with brute-force oracle, every trail verifies");
// ---------------------------------------------------------------------------
(function () {
  // deterministic PRNG so a failure reproduces
  var seed = 12345;
  function rnd() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

  var trials = 400;
  var mism = 0, badTrail = 0, circuitMism = 0;
  for (var t = 0; t < trials; t++) {
    var directed = rnd() < 0.5;
    var names = ["a", "b", "c", "d", "e"].slice(0, 3 + Math.floor(rnd() * 3)); // 3..5 nodes
    var m = 1 + Math.floor(rnd() * 8); // 1..8 edges
    var text = "";
    for (var e = 0; e < m; e++) {
      var u = pick(names), w = pick(names);
      text += u + (directed ? " -> " : " -- ") + w + "\n";
    }
    var g = build(text, directed);
    var cls = G.classifyEulerian(g);
    var solverSaysYes = cls.kind !== "none";
    var orc = oracle(g);

    if (solverSaysYes !== orc.exists) {
      mism++;
      if (mism <= 3) { console.error("  mismatch (exists) on:\n" + text); }
    } else if (solverSaysYes) {
      // classification of circuit-vs-path should match the oracle when it exists
      var solverCircuit = cls.kind === "circuit";
      if (solverCircuit !== orc.isCircuit) {
        circuitMism++;
        if (circuitMism <= 3) { console.error("  mismatch (circuit) on:\n" + text); }
      }
      var r = G.findEulerianTrail(g);
      if (!r || !G.verifyTrail(g, r).ok) {
        badTrail++;
        if (badTrail <= 3) { console.error("  bad trail on:\n" + text); }
      }
    }
  }
  eq(mism, 0, "existence: solver matched the brute-force oracle on all " + trials + " graphs");
  eq(circuitMism, 0, "circuit-vs-path: solver matched the oracle every time");
  eq(badTrail, 0, "every trail the solver returned independently verified");
})();

// ---------------------------------------------------------------------------
section("layout is deterministic and in-bounds");
// ---------------------------------------------------------------------------
(function () {
  var g = build("a -- b\nb -- c\nc -- d\nd -- a\na -- c", false);
  var L1 = G.layout(g, { seed: 7, width: 400, height: 300, iterations: 120 });
  var L2 = G.layout(g, { seed: 7, width: 400, height: 300, iterations: 120 });
  var same = true, inBounds = true;
  for (var i = 0; i < g.nodes.length; i++) {
    var n = g.nodes[i];
    var p1 = L1.positions[n], p2 = L2.positions[n];
    if (p1.x !== p2.x || p1.y !== p2.y) { same = false; }
    if (!(p1.x >= 0 && p1.x <= 400 && p1.y >= 0 && p1.y <= 300)) { inBounds = false; }
    if (!isFinite(p1.x) || !isFinite(p1.y)) { inBounds = false; }
  }
  ok(same, "same graph + same seed => identical coordinates");
  ok(inBounds, "every node placed at a finite, in-bounds coordinate");
  // degenerate sizes must not throw
  var okEmpty = true;
  try { G.layout(build("", false), { seed: 1 }); G.layout(build("solo", false), { seed: 1 }); }
  catch (err) { okEmpty = false; }
  ok(okEmpty, "empty and single-node graphs lay out without throwing");
})();

// ---------------------------------------------------------------------------
console.log("\n----------------------------------------");
console.log("Eulerian-path core: " + pass + " passed, " + fail + " failed.");
if (fail > 0) { process.exit(1); }
