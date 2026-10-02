/*
 * mst-core.js — take a weighted, undirected graph as input and answer the one
 * question this project is about: *what is the cheapest set of edges that keeps
 * every node connected?*
 *
 * A Source 2 (karan/Projects) "Graph" project. The karan spec reads:
 *
 *   "Minimum Spanning Tree — Prim's and Kruskal's algorithm[s]."
 *
 * A **minimum spanning tree** (MST) of a connected, undirected, weighted graph
 * is a subset of its edges that (a) touches every node, (b) forms a tree (no
 * cycle), and (c) has the smallest possible total weight among all such trees.
 * When the graph is *not* connected there is no single spanning tree; the
 * natural answer is a **minimum spanning forest** — one MST per connected
 * component — and this module computes that.
 *
 * It runs BOTH classic algorithms and, because "trust me, this is minimal" is
 * not good enough, backs every answer with INDEPENDENT checks the tests lean on:
 *
 *   - Kruskal's total       ↔ Prim's total (two different algorithms, same sum)
 *   - small-graph total     ↔ brute-force: enumerate every spanning forest and
 *                             take the lightest
 *   - optimality itself     ↔ the CYCLE PROPERTY: a spanning forest is minimal
 *                             iff for every NON-tree edge (u,v,w), w is ≥ the
 *                             heaviest edge on the tree path between u and v.
 *                             (If some non-tree edge were lighter than an edge
 *                             on that path, swapping them would give a cheaper
 *                             tree — so "no such edge exists" is a self-contained
 *                             proof of minimality.)
 *   - the result is a forest ↔ re-checked to be acyclic and to span every
 *                             component: exactly (nodes − components) edges, no
 *                             cycle, every component connected.
 *
 * If the two algorithms, the oracle and the invariants ever disagree, the tests
 * fail.
 *
 * Design choices, stated up front:
 *   - The graph is UNDIRECTED. An MST is defined on undirected graphs; a
 *     direction on an edge is meaningless here, so `a -> b` and `a -- b` are
 *     treated the same.
 *   - The stored graph is SIMPLE: parallel links between the same pair collapse
 *     to the **cheaper** one (the only one an MST would ever use), counted in
 *     `duplicates`; a self-loop can never be in a tree, so it is kept only as a
 *     count (`selfLoops`), never in the edge list.
 *   - Negative weights are fine. Unlike shortest paths, MST algorithms work with
 *     any real weights — the cut and cycle properties never assume a sign.
 *   - Layout is deterministic (seeded PRNG), so the picture is reproducible and
 *     the tests can assert on coordinates.
 *
 * UMD-ish: works under Node's require() and as a browser global (window.MstCore).
 * No dependencies, no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.MstCore = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ===========================================================================
  // 1. Parsing weighted links
  // ===========================================================================
  // Each non-blank, non-comment line is either one node (isolated) or two nodes
  // joined by a separator, optionally followed by a WEIGHT. The graph is
  // undirected, so an arrow is read as a plain link.
  //
  //   a -- b : 7      edge a–b of cost 7
  //   a - b = 2.5     edge of cost 2.5
  //   a b @ 3         whitespace-separated nodes, cost 3
  //   a - b (10)      weight in parentheses
  //   a -- b          no weight given ⇒ cost defaults to 1
  //   lonely          a single word ⇒ an isolated node
  //
  // The weight is peeled FIRST, and only when introduced by an explicit marker
  // ( : = @ | ) or wrapped in parentheses — so a digit that is part of a node
  // NAME ("node2 -- node3") is never mistaken for a weight. What remains is the
  // edge, split by a separator tried in PRIORITY order; the first match splits
  // the line once, at the earliest separator, so an explicit separator keeps
  // hyphens inside names ("node-1 -- node-2"). The bare hyphen is lowest
  // priority so "a-b" reads as the edge a–b.
  var SEPARATORS = [
    /^(.+?)\s*->\s*(.+)$/,     // arrow (read as undirected)
    /^(.+?)\s*→\s*(.+)$/,      // unicode arrow
    /^(.+?)\s*--\s*(.+)$/,     // double dash
    /^(.+?)\s+-\s+(.+)$/,      // spaced single hyphen
    /^(.+?)\s+(.+)$/,          // whitespace
    /^(.+?)\s*-\s*(.+)$/       // bare hyphen (lowest priority)
  ];
  // A trailing weight: an explicit marker (: = @ |) and a number, OR a number
  // wrapped in parentheses. Capturing group 1 is the numeric text.
  var WEIGHT_RE = /\s*(?:[:=@|]\s*(-?\d+(?:\.\d+)?)|\(\s*(-?\d+(?:\.\d+)?)\s*\))\s*$/;

  // parseLinks(text) ->
  //   { edges:[{from,to,w}], singles:[name], warnings:[...], anyNegative:bool }
  function parseLinks(text) {
    var edges = [], singles = [], warnings = [], anyNegative = false;
    var lines = String(text == null ? "" : text).split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var hash = raw.indexOf("#");
      if (hash >= 0) { raw = raw.slice(0, hash); }
      var line = raw.trim();
      if (line === "") { continue; }

      // Peel an optional explicit weight off the end.
      var w = 1, hasWeight = false;
      var wm = WEIGHT_RE.exec(line);
      if (wm) {
        var numText = wm[1] != null ? wm[1] : wm[2];
        w = parseFloat(numText);
        hasWeight = true;
        line = line.slice(0, wm.index).trim();
        if (line === "") {
          warnings.push("line " + (i + 1) + ": a weight with no edge, skipped (" + JSON.stringify(lines[i]) + ")");
          continue;
        }
      }

      var matched = null;
      for (var s = 0; s < SEPARATORS.length; s++) {
        var m = SEPARATORS[s].exec(line);
        if (m) { matched = m; break; }
      }
      if (!matched) {
        if (hasWeight) {
          warnings.push("line " + (i + 1) + ": a weight on a single node, treated as isolated node (" + JSON.stringify(lines[i]) + ")");
        }
        singles.push(line);
        continue;
      }

      var from = matched[1].trim(), to = matched[2].trim();
      if (from === "" || to === "") {
        warnings.push("line " + (i + 1) + ": empty node name, skipped (" + JSON.stringify(lines[i]) + ")");
        continue;
      }
      if (!isFinite(w)) {
        warnings.push("line " + (i + 1) + ": unreadable weight, skipped (" + JSON.stringify(lines[i]) + ")");
        continue;
      }
      if (w < 0) { anyNegative = true; }
      edges.push({ from: from, to: to, w: w });
    }
    return { edges: edges, singles: singles, warnings: warnings, anyNegative: anyNegative };
  }

  // ===========================================================================
  // 2. Building the undirected weighted graph
  // ===========================================================================
  // Stored graph is SIMPLE and UNDIRECTED: between a given unordered pair we keep
  // the CHEAPEST edge (the only one an MST would ever use), counting collapsed
  // parallels in `duplicates`. Self-loops are dropped (they can never be in a
  // tree) but counted in `selfLoops`.
  //
  // Shape of the returned graph:
  //   { nodes:[name,...] (sorted, natural order),
  //     edges:[{u, v, w}] with u<v canonical, sorted,
  //     adj: { name: [{to, w}, ...] },
  //     weightOf: function(a, b) -> w | Infinity,
  //     edgeCount, duplicates, selfLoops, anyNegative,
  //     warnings:[...] }
  function buildGraph(parsed, opts) {
    opts = opts || {};
    var rawEdges = Array.isArray(parsed) ? parsed : (parsed.edges || []);
    var singles = (parsed && parsed.singles) || [];
    if (opts.singles) { singles = singles.concat(opts.singles); }
    var warnings = (parsed && parsed.warnings) ? parsed.warnings.slice() : [];
    var anyNegative = !!(parsed && parsed.anyNegative);

    var nodeSet = Object.create(null);
    function ensure(name) { if (!(name in nodeSet)) { nodeSet[name] = true; } }
    for (var s = 0; s < singles.length; s++) { ensure(singles[s]); }

    // best[canonicalKey] = { u, v, w } cheapest edge for that unordered pair
    var best = Object.create(null);
    var duplicates = 0, selfLoops = 0;

    for (var e = 0; e < rawEdges.length; e++) {
      var a = rawEdges[e].from, b = rawEdges[e].to, w = rawEdges[e].w;
      if (w == null) { w = 1; }
      ensure(a); ensure(b);
      if (a === b) { selfLoops++; continue; }
      var u = a, v = b;
      if (naturalCompare(u, v) > 0) { var tmp = u; u = v; v = tmp; }
      var key = u + "\u0000" + v;
      if (key in best) {
        duplicates++;
        if (w < best[key].w) { best[key].w = w; }
      } else {
        best[key] = { u: u, v: v, w: w };
      }
    }

    var nodes = Object.keys(nodeSet).sort(naturalCompare);
    var edges = [];
    for (var k in best) { edges.push(best[k]); }
    edges.sort(function (x, y) {
      var c = naturalCompare(x.u, y.u);
      if (c !== 0) { return c; }
      return naturalCompare(x.v, y.v);
    });

    var adj = Object.create(null);
    for (var n = 0; n < nodes.length; n++) { adj[nodes[n]] = []; }
    for (var i = 0; i < edges.length; i++) {
      adj[edges[i].u].push({ to: edges[i].v, w: edges[i].w });
      adj[edges[i].v].push({ to: edges[i].u, w: edges[i].w });
    }
    for (var m = 0; m < nodes.length; m++) {
      adj[nodes[m]].sort(function (x, y) { return naturalCompare(x.to, y.to); });
    }

    function weightOf(a2, b2) {
      var list = adj[a2];
      if (!list) { return Infinity; }
      for (var i2 = 0; i2 < list.length; i2++) { if (list[i2].to === b2) { return list[i2].w; } }
      return Infinity;
    }

    return {
      nodes: nodes,
      edges: edges,
      adj: adj,
      weightOf: weightOf,
      edgeCount: edges.length,
      duplicates: duplicates,
      selfLoops: selfLoops,
      anyNegative: anyNegative,
      warnings: warnings
    };
  }

  function fromText(text, opts) { return buildGraph(parseLinks(text), opts); }

  // natural comparison: "node2" < "node10"
  function naturalCompare(a, b) {
    var re = /(\d+)|(\D+)/g;
    var ax = String(a).match(re) || [], bx = String(b).match(re) || [];
    for (var i = 0; i < Math.min(ax.length, bx.length); i++) {
      var an = ax[i], bn = bx[i];
      var aNum = /^\d/.test(an), bNum = /^\d/.test(bn);
      if (aNum && bNum) {
        var d = parseInt(an, 10) - parseInt(bn, 10);
        if (d !== 0) { return d < 0 ? -1 : 1; }
      } else if (an !== bn) { return an < bn ? -1 : 1; }
    }
    return ax.length - bx.length;
  }

  // Stable, deterministic edge ordering by (weight, u, v). Both Kruskal and the
  // Kruskal animation walk edges in exactly this order, so ties break the same
  // way everywhere and the picture is reproducible.
  function sortedEdges(g) {
    return g.edges.slice().sort(function (x, y) {
      if (x.w !== y.w) { return x.w < y.w ? -1 : 1; }
      var c = naturalCompare(x.u, y.u);
      if (c !== 0) { return c; }
      return naturalCompare(x.v, y.v);
    });
  }

  // ===========================================================================
  // 3. Disjoint-set union (union-find) — the heart of Kruskal's algorithm
  // ===========================================================================
  // Path compression + union by rank, so every operation is effectively O(1).
  function DisjointSet(items) {
    this.parent = Object.create(null);
    this.rank = Object.create(null);
    this.count = 0;
    if (items) { for (var i = 0; i < items.length; i++) { this.add(items[i]); } }
  }
  DisjointSet.prototype.add = function (x) {
    if (!(x in this.parent)) { this.parent[x] = x; this.rank[x] = 0; this.count++; }
  };
  DisjointSet.prototype.find = function (x) {
    var root = x;
    while (this.parent[root] !== root) { root = this.parent[root]; }
    // path compression
    while (this.parent[x] !== root) { var nxt = this.parent[x]; this.parent[x] = root; x = nxt; }
    return root;
  };
  DisjointSet.prototype.union = function (a, b) {
    var ra = this.find(a), rb = this.find(b);
    if (ra === rb) { return false; }           // already connected ⇒ would form a cycle
    if (this.rank[ra] < this.rank[rb]) { var t = ra; ra = rb; rb = t; }
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) { this.rank[ra]++; }
    this.count--;
    return true;
  };

  // How many connected components the graph has (over ALL nodes, isolated ones
  // included).
  function componentCount(g) {
    var ds = new DisjointSet(g.nodes);
    for (var i = 0; i < g.edges.length; i++) { ds.union(g.edges[i].u, g.edges[i].v); }
    return ds.count;
  }

  // ===========================================================================
  // 4. Kruskal's algorithm
  // ===========================================================================
  // Walk edges from lightest to heaviest; keep an edge iff its endpoints are in
  // different components so far (adding it never closes a cycle), merging the two
  // components. On a connected graph this yields an MST; on a disconnected one it
  // yields a minimum spanning FOREST (one MST per component). `steps` records
  // every edge considered, accepted or rejected, for the animation.
  function kruskal(g) {
    var ds = new DisjointSet(g.nodes);
    var order = sortedEdges(g);
    var chosen = [], steps = [], total = 0;
    for (var i = 0; i < order.length; i++) {
      var e = order[i];
      var accepted = ds.union(e.u, e.v);
      steps.push({ u: e.u, v: e.v, w: e.w, accepted: accepted });
      if (accepted) { chosen.push({ u: e.u, v: e.v, w: e.w }); total += e.w; }
    }
    var comps = ds.count;
    return {
      algorithm: "kruskal",
      edges: chosen,
      steps: steps,
      total: total,
      componentCount: comps,
      nodeCount: g.nodes.length,
      connected: comps <= 1 && g.nodes.length > 0,
      isForest: comps > 1
    };
  }

  // ===========================================================================
  // 5. Prim's algorithm
  // ===========================================================================
  // Grow a tree from a seed node, each step adding the cheapest edge that crosses
  // from the tree to a node outside it (a binary min-heap of crossing edges, with
  // lazy deletion of stale entries). To cover a disconnected graph, restart from
  // the next unvisited node once a component is exhausted — giving the same
  // minimum spanning forest Kruskal does, by a completely different route.
  function prim(g, startPref) {
    var inTree = Object.create(null), chosen = [], order = [], total = 0, componentsGrown = 0;
    var nodes = g.nodes.slice();
    // Seed order: prefer the requested start, then natural order. This only
    // affects WHICH equally-good forest is returned, never its total weight.
    if (startPref != null && g.nodes.indexOf(startPref) >= 0) {
      nodes = [startPref].concat(nodes.filter(function (n) { return n !== startPref; }));
    }

    for (var s = 0; s < nodes.length; s++) {
      var seed = nodes[s];
      if (inTree[seed]) { continue; }
      componentsGrown++;
      inTree[seed] = true;
      var heap = new MinHeap();
      pushCrossing(g, heap, seed);
      while (heap.size() > 0) {
        var top = heap.pop();
        var edge = top.node;            // {to, from, w}
        if (inTree[edge.to]) { continue; } // stale: node already absorbed
        inTree[edge.to] = true;
        var ce = canonEdge(edge.from, edge.to, edge.w);
        chosen.push(ce);
        order.push({ u: ce.u, v: ce.v, w: ce.w, accepted: true });
        total += edge.w;
        pushCrossing(g, heap, edge.to);
      }
    }
    chosen.sort(edgeSort);
    return {
      algorithm: "prim",
      edges: chosen,
      order: order,
      total: total,
      componentCount: componentsGrown,
      nodeCount: g.nodes.length,
      connected: componentsGrown <= 1 && g.nodes.length > 0,
      isForest: componentsGrown > 1
    };
  }

  function pushCrossing(g, heap, node) {
    var list = g.adj[node] || [];
    for (var i = 0; i < list.length; i++) {
      heap.push(list[i].w, { from: node, to: list[i].to, w: list[i].w });
    }
  }
  function canonEdge(a, b, w) {
    if (naturalCompare(a, b) > 0) { var t = a; a = b; b = t; }
    return { u: a, v: b, w: w };
  }
  function edgeSort(x, y) {
    var c = naturalCompare(x.u, y.u);
    if (c !== 0) { return c; }
    return naturalCompare(x.v, y.v);
  }

  // ===========================================================================
  // 6. A binary min-heap priority queue (lazy deletion)
  // ===========================================================================
  // Keyed entries {dist, node}. `dist` is the edge weight; `node` is the payload
  // (an edge object, for Prim). We never implement decrease-key: stale entries
  // are simply discarded when popped, keeping the heap O(E) and every op O(log E).
  function MinHeap() { this.a = []; }
  MinHeap.prototype.size = function () { return this.a.length; };
  MinHeap.prototype.push = function (dist, node) {
    var a = this.a; a.push({ dist: dist, node: node });
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].dist <= a[i].dist) { break; }
      var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  MinHeap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length > 0) {
      a[0] = last; var i = 0, n = a.length;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < n && a[l].dist < a[m].dist) { m = l; }
        if (r < n && a[r].dist < a[m].dist) { m = r; }
        if (m === i) { break; }
        var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  // ===========================================================================
  // 7. One-shot analysis for the UI
  // ===========================================================================
  function analyze(text, opts) {
    opts = opts || {};
    var g = fromText(text, opts);
    var kr = kruskal(g);
    var pr = prim(g, opts.start);
    return {
      graph: g,
      kruskal: kr,
      prim: pr,
      total: kr.total,
      componentCount: kr.componentCount,
      connected: kr.connected,
      isForest: kr.isForest,
      edgeCount: g.edgeCount
    };
  }

  // ===========================================================================
  // 8. INDEPENDENT ORACLES & INVARIANTS (the tests' conscience)
  // ===========================================================================

  // (a) Is `edges` a spanning forest of g? i.e. acyclic, and connecting each
  // component fully. Returns { ok, reason, edgeCount, want }. For a forest the
  // number of tree edges must be exactly (nodes − components), with no cycle.
  function isSpanningForest(g, edges) {
    var ds = new DisjointSet(g.nodes);
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (g.weightOf(e.u, e.v) === Infinity) { return { ok: false, reason: "edge " + e.u + "–" + e.v + " is not in the graph" }; }
      if (!ds.union(e.u, e.v)) { return { ok: false, reason: "edge " + e.u + "–" + e.v + " closes a cycle" }; }
    }
    var comps = componentCount(g);
    var want = g.nodes.length - comps;
    if (edges.length !== want) {
      return { ok: false, reason: "has " + edges.length + " edges, a spanning forest needs " + want, edgeCount: edges.length, want: want };
    }
    // The forest must have merged everything down to exactly `comps` components.
    if (ds.count !== comps) {
      return { ok: false, reason: "tree edges leave " + ds.count + " components, graph has " + comps };
    }
    return { ok: true, reason: "spans every component without a cycle", edgeCount: edges.length, want: want };
  }

  // (b) The CYCLE PROPERTY — a self-contained optimality proof. Build the tree's
  // adjacency; for every NON-tree edge (u,v,w), find the unique path between u
  // and v in the tree and the heaviest edge on it. If w is EVER less than that
  // heaviest edge, the tree is not minimal (swap would improve it). Returns the
  // first violating non-tree edge, or null if none — which proves minimality.
  function firstCyclePropertyViolation(g, treeEdges) {
    var tadj = Object.create(null);
    var inTree = Object.create(null);
    for (var n = 0; n < g.nodes.length; n++) { tadj[g.nodes[n]] = []; }
    for (var i = 0; i < treeEdges.length; i++) {
      var e = treeEdges[i];
      tadj[e.u].push({ to: e.v, w: e.w });
      tadj[e.v].push({ to: e.u, w: e.w });
      inTree[canonKey(e.u, e.v)] = true;
    }
    for (var j = 0; j < g.edges.length; j++) {
      var ge = g.edges[j];
      if (inTree[canonKey(ge.u, ge.v)]) { continue; }     // a tree edge
      var heaviest = heaviestOnTreePath(tadj, ge.u, ge.v);
      // If u and v are in different tree-components there is no path; a correct
      // forest would never leave them joinable, so flag that too.
      if (heaviest === null) {
        return { u: ge.u, v: ge.v, w: ge.w, reason: "non-tree edge joins two components the forest left split" };
      }
      if (ge.w < heaviest.w - 1e-9) {
        return { u: ge.u, v: ge.v, w: ge.w, reason: "lighter (" + ge.w + ") than the heaviest edge (" + heaviest.w + ") on the tree path " + ge.u + "…" + ge.v };
      }
    }
    return null;
  }

  function canonKey(a, b) { return naturalCompare(a, b) > 0 ? b + "\u0000" + a : a + "\u0000" + b; }

  // BFS from a to b over the tree, tracking the heaviest edge on the path.
  // Returns { w } for the heaviest edge, or null if b is unreachable from a.
  function heaviestOnTreePath(tadj, a, b) {
    if (a === b) { return { w: -Infinity }; }
    var prev = Object.create(null), prevW = Object.create(null), seen = Object.create(null);
    var queue = [a]; seen[a] = true;
    var found = false;
    while (queue.length) {
      var u = queue.shift();
      if (u === b) { found = true; break; }
      var list = tadj[u] || [];
      for (var i = 0; i < list.length; i++) {
        var v = list[i].to;
        if (!seen[v]) { seen[v] = true; prev[v] = u; prevW[v] = list[i].w; queue.push(v); }
      }
    }
    if (!found && b !== a && !seen[b]) { return null; }
    var cur = b, heavy = -Infinity;
    while (cur !== a) {
      if (prevW[cur] > heavy) { heavy = prevW[cur]; }
      cur = prev[cur];
    }
    return { w: heavy };
  }

  // (c) Brute force: the lightest spanning forest by exhaustive enumeration.
  // Works per connected component — within a component with k nodes and its edge
  // set, enumerate every (k−1)-edge subset that forms a spanning tree and keep
  // the minimum total; sum across components. Exponential, so the tests only use
  // it on tiny graphs. Returns a number (the minimum total weight).
  function bruteForestWeight(g) {
    // group nodes into components and collect each component's edges
    var ds = new DisjointSet(g.nodes);
    for (var i = 0; i < g.edges.length; i++) { ds.union(g.edges[i].u, g.edges[i].v); }
    var compNodes = Object.create(null), compEdges = Object.create(null);
    for (var n = 0; n < g.nodes.length; n++) {
      var r = ds.find(g.nodes[n]);
      (compNodes[r] = compNodes[r] || []).push(g.nodes[n]);
      compEdges[r] = compEdges[r] || [];
    }
    for (var e = 0; e < g.edges.length; e++) {
      var rr = ds.find(g.edges[e].u);
      compEdges[rr].push(g.edges[e]);
    }
    var total = 0;
    for (var root in compNodes) {
      total += bruteTreeWeight(compNodes[root], compEdges[root]);
    }
    return total;
  }

  // Minimum spanning tree weight of a single connected component by brute force.
  function bruteTreeWeight(nodes, edges) {
    var k = nodes.length;
    if (k <= 1) { return 0; }
    var need = k - 1;
    var idx = Object.create(null);
    for (var i = 0; i < k; i++) { idx[nodes[i]] = i; }
    var best = Infinity;
    var m = edges.length;
    // choose `need` of the m edges. NOTE: no "sum ≥ best" pruning — weights may
    // be NEGATIVE, so a partial sum is not a lower bound on the final total.
    var combo = [];
    (function choose(start, depth, sum) {
      if (m - start < need - depth) { return; }    // not enough edges left to finish
      if (depth === need) {
        // does this subset connect all k nodes acyclically? (acyclic is implied
        // by |E|=k−1 AND connected)
        var p = []; for (var z = 0; z < k; z++) { p[z] = z; }
        function find(x) { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
        var okAcyclic = true, merged = 0;
        for (var c = 0; c < combo.length; c++) {
          var a = find(idx[combo[c].u]), b = find(idx[combo[c].v]);
          if (a === b) { okAcyclic = false; break; }
          p[a] = b; merged++;
        }
        if (okAcyclic && merged === need) { if (sum < best) { best = sum; } }
        return;
      }
      for (var s = start; s < m; s++) {
        combo[depth] = edges[s];
        choose(s + 1, depth + 1, sum + edges[s].w);
      }
      combo.length = depth;
    })(0, 0, 0);
    return best;
  }

  // ===========================================================================
  // 9. Deterministic force-directed layout (Fruchterman–Reingold, seeded)
  // ===========================================================================
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function layout(g, opts) {
    opts = opts || {};
    var W = opts.width || 800, H = opts.height || 560;
    var iterations = opts.iterations || 300;
    var rnd = mulberry32(opts.seed == null ? 1 : (opts.seed | 0));
    var nodes = g.nodes, n = nodes.length, pos = Object.create(null);
    if (n === 0) { return pos; }
    if (n === 1) { pos[nodes[0]] = { x: W / 2, y: H / 2 }; return pos; }

    for (var i = 0; i < n; i++) { pos[nodes[i]] = { x: rnd() * W, y: rnd() * H }; }

    var k = Math.sqrt((W * H) / n);
    var t = Math.min(W, H) * 0.1, cool = t / (iterations + 1);

    var edgeList = g.edges.map(function (e) { return [e.u, e.v]; });

    var disp = Object.create(null);
    for (var it = 0; it < iterations; it++) {
      for (var d0 = 0; d0 < n; d0++) { disp[nodes[d0]] = { x: 0, y: 0 }; }
      for (var iu = 0; iu < n; iu++) {
        for (var iv = iu + 1; iv < n; iv++) {
          var pu = pos[nodes[iu]], pv = pos[nodes[iv]];
          var dx = pu.x - pv.x, dy = pu.y - pv.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          var rep = (k * k) / dist;
          var rx = (dx / dist) * rep, ry = (dy / dist) * rep;
          disp[nodes[iu]].x += rx; disp[nodes[iu]].y += ry;
          disp[nodes[iv]].x -= rx; disp[nodes[iv]].y -= ry;
        }
      }
      for (var ie = 0; ie < edgeList.length; ie++) {
        var pa = pos[edgeList[ie][0]], pb = pos[edgeList[ie][1]];
        var ex = pa.x - pb.x, ey = pa.y - pb.y;
        var elen = Math.sqrt(ex * ex + ey * ey) || 0.01;
        var att = (elen * elen) / k;
        var axx = (ex / elen) * att, ayy = (ey / elen) * att;
        disp[edgeList[ie][0]].x -= axx; disp[edgeList[ie][0]].y -= ayy;
        disp[edgeList[ie][1]].x += axx; disp[edgeList[ie][1]].y += ayy;
      }
      for (var im = 0; im < n; im++) {
        var p = pos[nodes[im]], dsp = disp[nodes[im]];
        var dl = Math.sqrt(dsp.x * dsp.x + dsp.y * dsp.y) || 0.01;
        p.x += (dsp.x / dl) * Math.min(dl, t);
        p.y += (dsp.y / dl) * Math.min(dl, t);
        p.x = Math.max(0, Math.min(W, p.x));
        p.y = Math.max(0, Math.min(H, p.y));
      }
      t -= cool;
    }
    return pos;
  }

  // ===========================================================================
  // Exports
  // ===========================================================================
  return {
    parseLinks: parseLinks,
    buildGraph: buildGraph,
    fromText: fromText,
    sortedEdges: sortedEdges,
    componentCount: componentCount,
    kruskal: kruskal,
    prim: prim,
    analyze: analyze,
    // oracles / invariants
    isSpanningForest: isSpanningForest,
    firstCyclePropertyViolation: firstCyclePropertyViolation,
    bruteForestWeight: bruteForestWeight,
    // layout + util
    layout: layout,
    naturalCompare: naturalCompare,
    DisjointSet: DisjointSet,
    MinHeap: MinHeap
  };
});
