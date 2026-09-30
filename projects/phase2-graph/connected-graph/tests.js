/*
 * tests.js — a dependency-free suite for the connectivity core.
 *
 *   node projects/phase2-graph/connected-graph/tests.js
 *
 * Strategy: the headline claims of this project — *is it connected*, *which
 * vertices/edges are single points of failure*, *which nodes are mutually
 * reachable* — are each pinned against an INDEPENDENT brute-force oracle:
 *
 *   - connectivity            ↔ a second flood fill (verifyConnectedByFlood)
 *   - articulation points     ↔ remove each vertex, recount pieces
 *   - bridges                 ↔ remove each edge, recount pieces
 *   - strongly-connected comps ↔ all-pairs mutual reachability
 *
 * Hand-worked classics (a path, a cycle, a star, two islands, a barbell, a
 * directed chain) nail down the expected values; a randomised fuzz loop then
 * throws 600 small graphs at the fast algorithms and the oracles and demands
 * they agree on every one.
 */
"use strict";
var C = require("./connectivity-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }
function sameArr(a, b) {
  if (a.length !== b.length) { return false; }
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
  return true;
}
// Compare two lists of pairs ([[a,b],...]) for equality.
function samePairs(a, b) {
  if (a.length !== b.length) { return false; }
  for (var i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) { return false; }
  }
  return true;
}
// Compare two lists of node-lists (components), each already canonicalised.
function sameGroups(a, b) {
  if (a.length !== b.length) { return false; }
  for (var i = 0; i < a.length; i++) { if (!sameArr(a[i], b[i])) { return false; } }
  return true;
}

// ---------------------------------------------------------------------------
section("parsing: separators, comments, isolated nodes");
// ---------------------------------------------------------------------------
(function () {
  var p = C.parseLinks(
    "a -> b\n" + "b--c\n" + "c - d\n" + "d, e\n" + "e: f\n" + "f g\n" +
    "island\n" + "# whole comment\n" + "g -> h  # trailing\n" + "\n" + "   \n"
  );
  eq(p.edges.length, 7, "seven edges across all separator styles");
  ok(p.edges[0].from === "a" && p.edges[0].to === "b", "arrow a -> b");
  ok(p.edges[2].from === "c" && p.edges[2].to === "d", "spaced hyphen c - d");
  ok(p.edges[6].from === "g" && p.edges[6].to === "h", "trailing comment stripped");
  ok(sameArr(p.singles, ["island"]), "lone token is an isolated node");

  var p2 = C.parseLinks("node-1 -> node-2\nsolo_3");
  ok(p2.edges[0].from === "node-1" && p2.edges[0].to === "node-2",
     "arrow preserves hyphenated names on both sides");
  ok(sameArr(p2.singles, ["solo_3"]), "underscored isolated node kept");
})();

// ---------------------------------------------------------------------------
section("building: simple graph, duplicates, self-loops, multiplicity");
// ---------------------------------------------------------------------------
(function () {
  var g = C.buildGraph(C.parseLinks("a-b\nb-a\na-b\nc-c\nd"), { directed: false });
  ok(sameArr(g.nodes, ["a", "b", "c", "d"]), "nodes collected and sorted");
  eq(g.duplicates, 2, "two parallel a-b links collapsed and counted");
  eq(g.selfLoops, 1, "one self-loop c-c counted");
  eq(g.edgeCount, 2, "distinct edges: a-b and the c self-loop");
  eq(C.degree(g, "a"), 1, "degree(a) = 1 in the simple graph");
  eq(C.degree(g, "c"), 2, "self-loop adds 2 to undirected degree");
  eq(C.degree(g, "d"), 0, "isolated node has degree 0");
  // multiplicity is recorded for the bridge finder
  eq(g._mult["a\u0000b"], 3, "three parsed links recorded between a and b");

  var dg = C.buildGraph(C.parseLinks("a->b\nb->a"), { directed: true });
  eq(dg.edgeCount, 2, "directed a->b and b->a are two distinct edges");
})();

// ---------------------------------------------------------------------------
section("connectivity: the headline yes/no, against a flood-fill oracle");
// ---------------------------------------------------------------------------
(function () {
  function conn(text, dir) { return C.isConnected(C.fromText(text, { directed: !!dir })); }

  ok(conn("a-b\nb-c\nc-d"), "a path is connected");
  ok(conn("a-b\nb-c\nc-a"), "a triangle is connected");
  ok(!conn("a-b\nc-d"), "two disjoint edges are NOT connected (two islands)");
  ok(!conn("a-b\nb-c\nisland"), "an isolated node breaks connectivity");
  ok(conn("solo"), "a single node is trivially connected");
  ok(C.isConnected(C.fromText("")), "the empty graph is vacuously connected");

  // directed connected() is WEAK connectivity: a->b->c is one weak piece
  ok(conn("a->b\nb->c", true), "directed chain is weakly connected");
  ok(!conn("a->b\nc->d", true), "two directed edges apart are not weakly connected");

  // agreement with the independent flood fill on a spread of inputs
  var cases = ["a-b\nb-c", "a-b\nc-d", "x", "", "a-b\nb-c\nc-a\nd-a", "p q r s"];
  cases.forEach(function (t) {
    var g = C.fromText(t);
    eq(C.isConnected(g), C.verifyConnectedByFlood(g),
       "components() and flood fill agree on connectivity of " + JSON.stringify(t));
  });
})();

// ---------------------------------------------------------------------------
section("components: weak pieces are found and canonicalised");
// ---------------------------------------------------------------------------
(function () {
  var g = C.fromText("a-b\nb-c\nx-y\nlonely");
  var comps = C.components(g);
  eq(comps.length, 3, "three weak pieces");
  ok(sameArr(comps[0], ["a", "b", "c"]), "piece 1 = {a,b,c}");
  ok(sameArr(comps[1], ["lonely"]), "piece 2 = {lonely}");
  ok(sameArr(comps[2], ["x", "y"]), "piece 3 = {x,y}");
})();

// ---------------------------------------------------------------------------
section("articulation points & bridges: classics + brute-force oracle");
// ---------------------------------------------------------------------------
(function () {
  // A path a-b-c-d-e: the interior nodes b,c,d are cut vertices; every edge is a
  // bridge.
  var path = C.fromText("a-b\nb-c\nc-d\nd-e");
  var pab = C.articulationAndBridges(path);
  ok(sameArr(pab.articulationPoints, ["b", "c", "d"]), "path: interior nodes are cut vertices");
  ok(samePairs(pab.bridges, [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]]),
     "path: every edge is a bridge");

  // A cycle a-b-c-d-a: no cut vertex, no bridge (2-connected).
  var cyc = C.fromText("a-b\nb-c\nc-d\nd-a");
  var cab = C.articulationAndBridges(cyc);
  eq(cab.articulationPoints.length, 0, "cycle: no articulation points");
  eq(cab.bridges.length, 0, "cycle: no bridges");

  // A star hub-{a,b,c}: the hub is the one cut vertex; every spoke is a bridge.
  var star = C.fromText("hub-a\nhub-b\nhub-c");
  var sab = C.articulationAndBridges(star);
  ok(sameArr(sab.articulationPoints, ["hub"]), "star: hub is the sole cut vertex");
  eq(sab.bridges.length, 3, "star: three spokes, all bridges");

  // Two triangles joined by a single edge (a "barbell"): the two joint nodes are
  // cut vertices, and the connecting edge is the one bridge.
  var bar = C.fromText("a-b\nb-c\nc-a\nc-d\nd-e\ne-f\nf-d");
  var bab = C.articulationAndBridges(bar);
  ok(sameArr(bab.articulationPoints, ["c", "d"]), "barbell: the two joints are cut vertices");
  ok(samePairs(bab.bridges, [["c", "d"]]), "barbell: the link between triangles is the bridge");

  // Parallel edge defeats the bridge: a=b twice, then b-c. a-b is doubled (not a
  // bridge), b-c is single (a bridge); b is still a cut vertex.
  var par = C.fromText("a-b\na-b\nb-c");
  var parab = C.articulationAndBridges(par);
  ok(samePairs(parab.bridges, [["b", "c"]]), "doubled a-b is not a bridge; b-c is");
  ok(sameArr(parab.articulationPoints, ["b"]), "b still separates a from c");

  // Brute-force agreement over a spread of shapes.
  var shapes = [
    "a-b\nb-c\nc-d\nd-e",
    "a-b\nb-c\nc-a\nc-d\nd-e\ne-f\nf-d",
    "hub-a\nhub-b\nhub-c\nhub-d",
    "a-b\nb-c\nc-a",
    "a-b\nc-d",
    "1-2\n2-3\n3-4\n4-2\n4-5"
  ];
  shapes.forEach(function (t) {
    var g = C.fromText(t);
    var fast = C.articulationAndBridges(g);
    ok(sameArr(fast.articulationPoints, C.bruteArticulationPoints(g)),
       "AP fast==brute for " + JSON.stringify(t));
    ok(samePairs(fast.bridges, C.bruteBridges(g)),
       "bridge fast==brute for " + JSON.stringify(t));
  });
})();

// ---------------------------------------------------------------------------
section("strong connectivity: SCCs, classics + brute-force oracle");
// ---------------------------------------------------------------------------
(function () {
  // a->b->c is weakly but NOT strongly connected: three singleton SCCs.
  var chain = C.fromText("a->b\nb->c", { directed: true });
  ok(C.isConnected(chain), "directed chain is weakly connected");
  ok(!C.isStronglyConnected(chain), "directed chain is NOT strongly connected");
  eq(C.stronglyConnectedComponents(chain).length, 3, "chain has 3 singleton SCCs");

  // a->b->c->a is one SCC — strongly connected.
  var ring = C.fromText("a->b\nb->c\nc->a", { directed: true });
  ok(C.isStronglyConnected(ring), "directed ring is strongly connected");
  eq(C.stronglyConnectedComponents(ring).length, 1, "ring is a single SCC");

  // Two cycles joined one-way: {a,b,c} <- one-way -> {d,e,f}. Two SCCs.
  var two = C.fromText("a->b\nb->c\nc->a\nc->d\nd->e\ne->f\nf->d", { directed: true });
  var sccs = C.stronglyConnectedComponents(two);
  eq(sccs.length, 2, "two SCCs when the bridge between cycles is one-way");
  ok(sameArr(sccs[0], ["a", "b", "c"]) || sameArr(sccs[0], ["d", "e", "f"]),
     "an SCC is exactly one of the two cycles");

  // undirected: SCC decomposition equals weak components
  var undir = C.fromText("a-b\nx-y");
  eq(C.stronglyConnectedComponents(undir).length, 2, "undirected SCCs == weak comps");

  // Brute-force agreement.
  var dirs = [
    "a->b\nb->c",
    "a->b\nb->c\nc->a",
    "a->b\nb->a\nc->d\nd->c\nb->c",
    "1->2\n2->3\n3->1\n3->4\n4->5\n5->4",
    "p->q\nq->r\nr->p\ns"
  ];
  dirs.forEach(function (t) {
    var g = C.fromText(t, { directed: true });
    ok(sameGroups(C.stronglyConnectedComponents(g), C.bruteSCCs(g)),
       "SCC fast==brute for " + JSON.stringify(t));
  });
})();

// ---------------------------------------------------------------------------
section("analyze: the one-shot verdict object");
// ---------------------------------------------------------------------------
(function () {
  var u = C.analyze(C.fromText("a-b\nb-c\nc-d\nd-a"));  // a 4-cycle
  ok(u.connected, "4-cycle: connected");
  ok(u.biconnected, "4-cycle: biconnected (no cut vertex)");
  ok(u.twoEdgeConnected, "4-cycle: 2-edge-connected (no bridge)");

  var p = C.analyze(C.fromText("a-b\nb-c"));            // a path of 3
  ok(p.connected, "path: connected");
  ok(!p.biconnected, "path: not biconnected (b is a cut vertex)");
  ok(!p.twoEdgeConnected, "path: not 2-edge-connected (edges are bridges)");

  var d = C.analyze(C.fromText("a->b\nb->c", { directed: true }));
  ok(d.weaklyConnected, "directed chain: weakly connected");
  ok(!d.stronglyConnected, "directed chain: not strongly connected");
  eq(d.sccCount, 3, "directed chain: 3 SCCs reported");
})();

// ---------------------------------------------------------------------------
section("layout: deterministic, in-bounds, robust");
// ---------------------------------------------------------------------------
(function () {
  var g = C.fromText("a-b\nb-c\nc-a\nc-d");
  var p1 = C.layout(g, { seed: 7, width: 800, height: 560, iterations: 120 });
  var p2 = C.layout(g, { seed: 7, width: 800, height: 560, iterations: 120 });
  var same = g.nodes.every(function (n) { return p1[n].x === p2[n].x && p1[n].y === p2[n].y; });
  ok(same, "same seed ⇒ identical coordinates");

  var different = C.layout(g, { seed: 8, width: 800, height: 560, iterations: 120 });
  var moved = g.nodes.some(function (n) { return p1[n].x !== different[n].x; });
  ok(moved, "a different seed moves nodes");

  var inBounds = g.nodes.every(function (n) {
    var q = p1[n];
    return isFinite(q.x) && isFinite(q.y) && q.x >= 0 && q.x <= 800 && q.y >= 0 && q.y <= 560;
  });
  ok(inBounds, "every node lands at a finite, in-frame point");

  ok(Object.keys(C.layout(C.fromText(""), { seed: 1 })).length === 0, "empty graph ⇒ empty layout");
  var one = C.layout(C.fromText("solo"), { seed: 1, width: 800, height: 560 });
  ok(one["solo"].x === 400 && one["solo"].y === 280, "single node is centred");
})();

// ---------------------------------------------------------------------------
section("fuzz: fast algorithms vs brute-force oracles on 600 random graphs");
// ---------------------------------------------------------------------------
(function () {
  // Seeded PRNG so the fuzz run is reproducible.
  var seed = 123456789;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function randInt(n) { return Math.floor(rnd() * n); }

  var trials = 600, mismatches = 0, checked = 0;
  for (var t = 0; t < trials; t++) {
    var directed = rnd() < 0.5;
    var n = 1 + randInt(7);                 // 1..7 nodes
    var names = [];
    for (var i = 0; i < n; i++) { names.push("n" + i); }
    var lines = [];
    // random edges
    var m = randInt(n * 2);
    for (var e = 0; e < m; e++) {
      var a = names[randInt(n)], b = names[randInt(n)];
      lines.push(a + (directed ? "->" : "--") + b);
    }
    // occasionally declare a lone node so isolated vertices show up
    if (rnd() < 0.3) { lines.push(names[randInt(n)]); }
    var g = C.fromText(lines.join("\n"), { directed: directed });

    // connectivity vs flood fill
    if (C.isConnected(g) !== C.verifyConnectedByFlood(g)) { mismatches++; }
    checked++;

    if (directed) {
      if (!sameGroups(C.stronglyConnectedComponents(g), C.bruteSCCs(g))) { mismatches++; }
      checked++;
    } else {
      var fast = C.articulationAndBridges(g);
      if (!sameArr(fast.articulationPoints, C.bruteArticulationPoints(g))) { mismatches++; }
      if (!samePairs(fast.bridges, C.bruteBridges(g))) { mismatches++; }
      checked += 2;
    }
  }
  eq(mismatches, 0, "no fast/brute mismatches across " + checked + " fuzz checks");
})();

// ---------------------------------------------------------------------------
console.log("\n----------------------------------------");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("----------------------------------------");
if (fail > 0) { process.exit(1); }
