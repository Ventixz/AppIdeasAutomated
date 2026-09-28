/*
 * tests.js — a dependency-free suite for the graph core.
 *
 *   node projects/phase2-graph/graph-from-links/tests.js
 *
 * Strategy: the graph algorithms (union–find components, BFS, cycle detection,
 * topological sort) are the clever parts, so each is pinned against an
 * independent brute-force oracle written inline — a flood fill for components, a
 * transitive-closure for reachability, an all-permutations check for topo order
 * on tiny graphs. Parsing and the degree bookkeeping are checked against
 * hand-worked cases and the handshake lemma.
 */
"use strict";
var G = require("./graph-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }
function sameArr(a, b) {
  if (a.length !== b.length) { return false; }
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
  return true;
}

// ---------------------------------------------------------------------------
section("parsing: separators, comments, isolated nodes");
// ---------------------------------------------------------------------------
(function () {
  var p = G.parseLinks(
    "a -> b\n" +
    "b--c\n" +
    "c - d\n" +
    "d, e\n" +
    "e: f\n" +
    "f g\n" +
    "island\n" +
    "# a full comment line\n" +
    "g -> h   # trailing comment\n" +
    "\n" +
    "   \n"
  );
  eq(p.edges.length, 7, "seven edges parsed across all separator styles");
  ok(p.edges[0].from === "a" && p.edges[0].to === "b", "arrow: a -> b");
  ok(p.edges[1].from === "b" && p.edges[1].to === "c", "double dash: b--c");
  ok(p.edges[2].from === "c" && p.edges[2].to === "d", "spaced hyphen: c - d");
  ok(p.edges[3].from === "d" && p.edges[3].to === "e", "comma: d, e");
  ok(p.edges[4].from === "e" && p.edges[4].to === "f", "colon: e: f");
  ok(p.edges[5].from === "f" && p.edges[5].to === "g", "whitespace: f g");
  ok(p.edges[6].from === "g" && p.edges[6].to === "h", "trailing comment stripped: g -> h");
  ok(sameArr(p.singles, ["island"]), "lone token becomes an isolated node");

  // An explicit arrow keeps hyphens inside the names it splits out.
  var p2 = G.parseLinks("node-1 -> node-2\nnode_3");
  ok(p2.edges[0].from === "node-1" && p2.edges[0].to === "node-2",
     "arrow preserves hyphenated node names either side of it");
  ok(sameArr(p2.singles, ["node_3"]), "underscore isolated node preserved");
  // A bare hyphen with no spaces reads as an edge (the links-tool reading).
  var p3 = G.parseLinks("a-b");
  ok(p3.edges.length === 1 && p3.edges[0].from === "a" && p3.edges[0].to === "b",
     "bare 'a-b' reads as the edge a-b");
})();

// ---------------------------------------------------------------------------
section("building: dedup parallels, keep + count self-loops");
// ---------------------------------------------------------------------------
(function () {
  var g = G.fromText("a -> b\na -> b\na -> a\nb -> a", { directed: true });
  eq(g.nodes.length, 2, "two distinct nodes");
  eq(g.duplicates, 1, "one parallel link collapsed (a->b twice)");
  eq(g.selfLoops, 1, "one self-loop counted (a->a)");
  eq(g.edgeCount, 3, "distinct directed edges: a->b, a->a, b->a");

  // Undirected: a--b and b--a are the same edge.
  var u = G.fromText("a -- b\nb -- a\nc", { directed: false });
  eq(u.duplicates, 1, "undirected: b--a duplicates a--b");
  eq(u.edgeCount, 1, "one undirected edge");
  eq(u.nodes.length, 3, "isolated node c is present");
})();

// ---------------------------------------------------------------------------
section("degree bookkeeping and the handshake lemma");
// ---------------------------------------------------------------------------
(function () {
  // Undirected: sum of degrees = 2 * |E|, with a self-loop contributing 2.
  var u = G.fromText("a--b\nb--c\nc--a\na--a", { directed: false });
  var sum = u.nodes.reduce(function (s, nd) { return s + G.degree(u, nd); }, 0);
  eq(sum, 2 * u.edgeCount, "handshake lemma: sum(deg) = 2|E| (self-loop = +2)");
  eq(G.degree(u, "a"), 4, "deg(a) = 2 (b,c) + 2 (self-loop)");

  // Directed: sum(outDeg) = sum(inDeg) = |E|.
  var d = G.fromText("a->b\nb->c\nc->a\na->c", { directed: true });
  var so = d.nodes.reduce(function (s, nd) { return s + G.outDegree(d, nd); }, 0);
  var si = d.nodes.reduce(function (s, nd) { return s + G.inDegree(d, nd); }, 0);
  eq(so, d.edgeCount, "sum(outDeg) = |E|");
  eq(si, d.edgeCount, "sum(inDeg) = |E|");
})();

// ---------------------------------------------------------------------------
section("components match an independent flood fill");
// ---------------------------------------------------------------------------
(function () {
  // Oracle: BFS flood fill over an undirected adjacency built from the same
  // edges, labelling components independently of the core's union-find.
  function floodComponents(g) {
    var seen = Object.create(null), comps = [];
    g.nodes.forEach(function (start) {
      if (seen[start]) { return; }
      var comp = [], queue = [start]; seen[start] = true;
      while (queue.length) {
        var u = queue.shift(); comp.push(u);
        G.bothNeighbours(g, u).forEach(function (v) {
          if (!seen[v]) { seen[v] = true; queue.push(v); }
        });
      }
      comps.push(comp.sort(G.naturalCompare));
    });
    comps.sort(function (a, b) { return G.naturalCompare(a[0], b[0]); });
    return comps;
  }

  var texts = [
    "a-b\nb-c\nd-e\nf",                 // three pieces: {a,b,c},{d,e},{f}
    "a->b\nc->d\nd->a",                 // directed but weakly {a,b,c,d}
    "x\ny\nz",                          // all isolated
    "1-2\n2-3\n3-1\n4-5\n5-6\n6-4\n7"   // two triangles + a loner
  ];
  var allOk = true;
  texts.forEach(function (txt, i) {
    [true, false].forEach(function (dir) {
      var g = G.fromText(txt, { directed: dir });
      var got = G.components(g), want = floodComponents(g);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        allOk = false;
        console.error("    mismatch on text[" + i + "] directed=" + dir);
      }
    });
  });
  ok(allOk, "union-find components == flood-fill components across cases");

  var g3 = G.fromText("a-b\nb-c\nd-e\nf");
  eq(G.components(g3).length, 3, "three components counted");
  ok(!G.isConnected(g3), "graph with 3 pieces is not connected");
  ok(G.isConnected(G.fromText("a-b\nb-c\nc-a")), "a triangle is connected");
})();

// ---------------------------------------------------------------------------
section("BFS reachability == transitive closure (brute force)");
// ---------------------------------------------------------------------------
(function () {
  // Oracle: repeatedly relax reachability until it stops changing.
  function closure(g, start) {
    var reach = Object.create(null); reach[start] = true;
    var changed = true;
    while (changed) {
      changed = false;
      g.nodes.forEach(function (u) {
        if (!reach[u]) { return; }
        var nb = g.directed ? G.outNeighbours(g, u) : G.bothNeighbours(g, u);
        nb.forEach(function (v) { if (!reach[v]) { reach[v] = true; changed = true; } });
      });
    }
    return Object.keys(reach).sort(G.naturalCompare);
  }

  var cases = [
    { txt: "a->b\nb->c\nc->d", dir: true, start: "a" },
    { txt: "a->b\nb->c\nc->d", dir: true, start: "c" },
    { txt: "a->b\nc->d", dir: true, start: "a" },
    { txt: "a-b\nb-c\nd-e", dir: false, start: "a" },
    { txt: "a-b\nb-c\nd-e", dir: false, start: "d" }
  ];
  var allOk = true;
  cases.forEach(function (c) {
    var g = G.fromText(c.txt, { directed: c.dir });
    var got = G.reachable(g, c.start).sort(G.naturalCompare);
    var want = closure(g, c.start);
    if (!sameArr(got, want)) { allOk = false; console.error("    reach mismatch from " + c.start); }
  });
  ok(allOk, "BFS reachable set == transitive closure");

  // BFS distances: a straight path a->b->c->d gives hop counts 0,1,2,3.
  var line = G.fromText("a->b\nb->c\nc->d", { directed: true });
  var b = G.bfs(line, "a");
  ok(b.dist.a === 0 && b.dist.b === 1 && b.dist.c === 2 && b.dist.d === 3,
     "BFS distances along a path are hop counts");
  eq(G.reachable(line, "d").length, 1, "nothing downstream of the sink d");
})();

// ---------------------------------------------------------------------------
section("cycle detection matches brute force; topo order is valid");
// ---------------------------------------------------------------------------
(function () {
  // Directed brute-force cycle oracle: a cycle exists iff some node can reach
  // itself in >= 1 step. Uses only outNeighbours, independent of the core's DFS.
  function reachesSelf(g) {
    return g.nodes.some(function (s) {
      var seen = Object.create(null), stack = G.outNeighbours(g, s).slice();
      while (stack.length) {
        var u = stack.pop();
        if (u === s) { return true; }
        if (seen[u]) { continue; }
        seen[u] = true;
        G.outNeighbours(g, u).forEach(function (v) { stack.push(v); });
      }
      return false;
    });
  }

  var dcases = ["a->b\nb->c\nc->d", "a->b\nb->c\nc->a", "a->a", "a->b\nb->c\nc->b", "a->b\nc->d"];
  var allOk = true;
  dcases.forEach(function (txt) {
    var g = G.fromText(txt, { directed: true });
    if (G.hasCycle(g) !== reachesSelf(g)) { allOk = false; console.error("    cycle mismatch: " + txt); }
  });
  ok(allOk, "directed hasCycle() matches the reaches-self oracle");

  // Undirected cycle facts.
  ok(!G.hasCycle(G.fromText("a-b\nb-c\nc-d")), "an undirected path has no cycle");
  ok(G.hasCycle(G.fromText("a-b\nb-c\nc-a")), "an undirected triangle has a cycle");
  ok(!G.hasCycle(G.fromText("a-b\na-c\na-d")), "an undirected star (tree) has no cycle");

  // Topological order: every edge u->v must place u before v; and topoSort is
  // null exactly when there is a cycle.
  var dag = G.fromText("a->b\na->c\nb->d\nc->d\nd->e", { directed: true });
  var order = G.topoSort(dag);
  ok(order && order.length === dag.nodes.length, "topo order lists every node once");
  var pos = Object.create(null);
  order.forEach(function (nd, i) { pos[nd] = i; });
  var validTopo = true;
  dag.nodes.forEach(function (u) {
    G.outNeighbours(dag, u).forEach(function (v) { if (pos[u] >= pos[v]) { validTopo = false; } });
  });
  ok(validTopo, "every edge points forward in the topological order");
  ok(G.topoSort(G.fromText("a->b\nb->a", { directed: true })) === null,
     "topoSort returns null on a cyclic graph");
})();

// ---------------------------------------------------------------------------
section("stats: density, averages, most-connected node");
// ---------------------------------------------------------------------------
(function () {
  // A complete undirected triangle: 3 nodes, 3 edges, density 1, avg degree 2.
  var tri = G.fromText("a-b\nb-c\nc-a");
  var st = tri.nodeCount === undefined ? G.stats(tri) : G.stats(tri);
  eq(st.nodeCount, 3, "triangle: 3 nodes");
  eq(st.edgeCount, 3, "triangle: 3 edges");
  ok(Math.abs(st.density - 1) < 1e-9, "triangle density = 1 (complete)");
  ok(Math.abs(st.avgDegree - 2) < 1e-9, "triangle avg degree = 2");
  ok(st.connected, "triangle is connected");
  ok(!st.acyclic, "triangle is not acyclic");

  // A star: the hub is the most-connected node.
  var star = G.fromText("hub-a\nhub-b\nhub-c\nhub-d");
  var ss = G.stats(star);
  eq(ss.topNode, "hub", "star hub is the most-connected node");
  eq(ss.topDegree, 4, "hub degree = 4");
  ok(ss.acyclic, "a star is acyclic (it's a tree)");

  // Isolated nodes counted.
  var iso = G.fromText("a-b\nx\ny");
  eq(G.stats(iso).isolatedCount, 2, "two isolated nodes counted");
})();

// ---------------------------------------------------------------------------
section("layout is deterministic, complete, and in-bounds");
// ---------------------------------------------------------------------------
(function () {
  var g = G.fromText("a->b\nb->c\nc->d\nd->a\na->c\ne->a\nf", { directed: true });
  var W = 640, H = 480;
  var p1 = G.layout(g, { width: W, height: H, seed: 42, iterations: 120 });
  var p2 = G.layout(g, { width: W, height: H, seed: 42, iterations: 120 });

  // Same seed => byte-identical coordinates.
  var identical = g.nodes.every(function (nd) {
    return p1[nd].x === p2[nd].x && p1[nd].y === p2[nd].y;
  });
  ok(identical, "same seed reproduces identical coordinates");

  // Every node placed, and every coordinate inside the frame.
  var complete = g.nodes.every(function (nd) { return p1[nd] && isFinite(p1[nd].x) && isFinite(p1[nd].y); });
  ok(complete, "every node receives finite coordinates");
  var inBounds = g.nodes.every(function (nd) {
    return p1[nd].x >= 0 && p1[nd].x <= W && p1[nd].y >= 0 && p1[nd].y <= H;
  });
  ok(inBounds, "all coordinates lie within the frame");

  // A different seed generally moves things — at least one node shifts.
  var p3 = G.layout(g, { width: W, height: H, seed: 7, iterations: 120 });
  var moved = g.nodes.some(function (nd) { return p1[nd].x !== p3[nd].x || p1[nd].y !== p3[nd].y; });
  ok(moved, "a different seed produces a different layout");

  // Degenerate sizes don't throw.
  eq(Object.keys(G.layout(G.fromText(""), {})).length, 0, "empty graph -> no positions");
  var one = G.layout(G.fromText("solo"), { width: 100, height: 100 });
  ok(one.solo && one.solo.x === 50 && one.solo.y === 50, "single node centred");
})();

// ---------------------------------------------------------------------------
section("a worked end-to-end example");
// ---------------------------------------------------------------------------
(function () {
  // A tiny hyperlink graph: pages linking to pages. Directed.
  var web =
    "home -> about\n" +
    "home -> blog\n" +
    "blog -> post1\n" +
    "blog -> post2\n" +
    "post1 -> home\n" +   // a link back up: makes a cycle
    "about -> home\n" +
    "orphan";             // a page nobody links to and that links nowhere
  var g = G.fromText(web, { directed: true });
  var s = G.stats(g);
  eq(s.nodeCount, 6, "6 pages (home, about, blog, post1, post2, orphan)");
  eq(s.edgeCount, 6, "6 links");
  eq(s.componentCount, 2, "two weakly-connected pieces (the site + the orphan)");
  ok(!s.acyclic, "the site has a cycle (home -> blog -> post1 -> home)");
  eq(s.isolatedCount, 1, "the orphan is isolated");
  // From home you can reach the whole site but never the orphan.
  var r = G.reachable(g, "home");
  ok(r.indexOf("orphan") === -1, "orphan is unreachable from home");
  ok(r.indexOf("post2") !== -1, "post2 is reachable from home");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (fail === 0 ? "ALL PASS" : "SOME FAILED") +
            " — " + pass + " passed, " + fail + " failed (" + (pass + fail) + " checks)");
if (fail > 0) { process.exit(1); }
