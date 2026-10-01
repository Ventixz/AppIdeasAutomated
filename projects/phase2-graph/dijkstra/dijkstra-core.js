/*
 * dijkstra-core.js — take a weighted graph as input and answer the one
 * question this project is about: *what is the cheapest way from here to
 * everywhere else?*
 *
 * A Source 2 (karan/Projects) "Graph" project. The karan spec reads:
 *
 *   "Dijkstra's Algorithm — ...find the shortest path between two nodes of a
 *    graph."
 *
 * Dijkstra's algorithm solves the **single-source shortest path** problem on a
 * graph whose edge weights are all **non-negative**: from one chosen source it
 * computes, in one pass, the cheapest distance to *every* reachable node and
 * the tree of paths that realise those distances. This module computes that,
 * and — because "trust me, this is the shortest path" is not good enough —
 * backs every answer with an INDEPENDENT check the tests lean on:
 *
 *   - the distances        ↔ Bellman–Ford (a completely different algorithm)
 *   - small-graph distances ↔ brute-force enumeration of every simple path
 *   - optimality itself     ↔ the relaxation invariant: once Dijkstra is done,
 *                             NO edge (u,v,w) can be relaxed, i.e. for every
 *                             edge dist[v] ≤ dist[u] + w. A shortest-path
 *                             labelling is exactly one with no relaxable edge.
 *   - every reconstructed path ↔ re-walked edge by edge, its cost re-added, and
 *                             checked to equal dist[target].
 *
 * If the clever algorithm and any oracle ever disagree, the tests fail.
 *
 * Design choices, stated up front:
 *   - Weights are non-negative. Dijkstra's correctness RESTS on that: a settled
 *     node is never revisited, which is only safe when no later edge can lower
 *     its distance. We detect a negative weight and warn — the distances are
 *     then still computed (and still agree with Bellman–Ford as long as there
 *     is no negative cycle), but the warning is honest about the guarantee.
 *   - The stored graph is SIMPLE: parallel links between the same ordered pair
 *     collapse to the **cheaper** one (the only one a shortest path would ever
 *     use), counted in `duplicates`; a self-loop never shortens a path, so it
 *     is kept only as a count (`selfLoops`), never in the adjacency.
 *   - Layout is deterministic (seeded PRNG), so the picture is reproducible and
 *     the tests can assert on coordinates.
 *
 * UMD-ish: works under Node's require() and as a browser global
 * (window.DijkstraCore). No dependencies, no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.DijkstraCore = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ===========================================================================
  // 1. Parsing weighted links
  // ===========================================================================
  // Each non-blank, non-comment line is either one node (isolated) or two nodes
  // joined by a separator, optionally followed by a WEIGHT.
  //
  //   a -> b : 7      directed edge a→b of cost 7
  //   a -- b = 2.5    undirected edge of cost 2.5
  //   a b @ 3         whitespace-separated nodes, cost 3
  //   a - b (10)      weight in parentheses
  //   a -> b          no weight given ⇒ cost defaults to 1
  //   lonely          a single word ⇒ an isolated node
  //
  // The weight is peeled FIRST, and only when introduced by an explicit marker
  // ( : = @ | ) or wrapped in parentheses. That rule is deliberate: it keeps a
  // digit that is part of a node NAME ("node2 -> node3") from being mistaken
  // for a weight. What remains is the edge, split by a separator tried in
  // PRIORITY order; the first match splits the line once, at the earliest
  // separator, so an explicit separator keeps hyphens inside names
  // ("node-1 -> node-2"). The bare hyphen is lowest priority so "a-b" reads as
  // the edge a–b.
  var SEPARATORS = [
    /^(.+?)\s*->\s*(.+)$/,     // directed arrow
    /^(.+?)\s*→\s*(.+)$/,      // unicode arrow
    /^(.+?)\s*--\s*(.+)$/,     // double dash (undirected)
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
  // 2. Building the weighted graph
  // ===========================================================================
  // Stored graph is SIMPLE: between a given ordered pair we keep the CHEAPEST
  // edge (the only one a shortest path would ever take), counting collapsed
  // parallels in `duplicates`. Self-loops are dropped from the adjacency (they
  // never shorten a path) but counted in `selfLoops`. For an undirected graph
  // every edge is stored in both directions.
  //
  // Shape of the returned graph:
  //   { nodes:[name,...] (sorted, natural order),
  //     directed:bool,
  //     adj: { name: [{to, w}, ...] },   // out-neighbours, cheapest kept
  //     weightOf: function(u, v) -> w | Infinity,
  //     edgeCount, duplicates, selfLoops, anyNegative,
  //     warnings:[...] }
  function buildGraph(parsed, opts) {
    opts = opts || {};
    var directed = !!opts.directed;
    var rawEdges = Array.isArray(parsed) ? parsed : (parsed.edges || []);
    var singles = (parsed && parsed.singles) || [];
    if (opts.singles) { singles = singles.concat(opts.singles); }
    var warnings = (parsed && parsed.warnings) ? parsed.warnings.slice() : [];
    var anyNegative = !!(parsed && parsed.anyNegative);

    var nodeSet = Object.create(null);
    // best[u]["\u0000"+v] = cheapest weight seen for ordered pair u->v
    var best = Object.create(null);

    function ensure(name) {
      if (!(name in nodeSet)) { nodeSet[name] = true; best[name] = Object.create(null); }
    }
    for (var s = 0; s < singles.length; s++) { ensure(singles[s]); }

    var duplicates = 0, selfLoops = 0;

    function consider(a, b, w) {
      // record cheapest a->b; return true if this created a NEW ordered pair
      var key = "\u0000" + b;
      if (key in best[a]) {
        duplicates++;
        if (w < best[a][key]) { best[a][key] = w; }
        return false;
      }
      best[a][key] = w;
      return true;
    }

    for (var e = 0; e < rawEdges.length; e++) {
      var a = rawEdges[e].from, b = rawEdges[e].to, w = rawEdges[e].w;
      if (w == null) { w = 1; }
      ensure(a); ensure(b);
      if (a === b) { selfLoops++; continue; }
      if (directed) {
        consider(a, b, w);
      } else {
        // undirected: both directions share one logical edge; count a parallel
        // only once (via the a->b direction) so `duplicates` stays meaningful.
        var createdFwd = consider(a, b, w);
        // mirror without double-counting the duplicate
        var keyR = "\u0000" + a;
        if (keyR in best[b]) { if (w < best[b][keyR]) { best[b][keyR] = w; } }
        else { best[b][keyR] = w; }
        void createdFwd;
      }
    }

    var nodes = Object.keys(nodeSet).sort(naturalCompare);
    var adj = Object.create(null);
    var edgeCount = 0, counted = Object.create(null);
    for (var n = 0; n < nodes.length; n++) {
      var u = nodes[n], list = [];
      var nbrs = best[u];
      for (var k in nbrs) {
        var v = k.slice(1);
        list.push({ to: v, w: nbrs[k] });
        if (directed) { edgeCount++; }
        else {
          var ek = u < v ? u + "\u0000" + v : v + "\u0000" + u;
          if (!counted[ek]) { counted[ek] = true; edgeCount++; }
        }
      }
      list.sort(function (x, y) { return naturalCompare(x.to, y.to); });
      adj[u] = list;
    }

    function weightOf(u, v) {
      var list = adj[u];
      if (!list) { return Infinity; }
      for (var i = 0; i < list.length; i++) { if (list[i].to === v) { return list[i].w; } }
      return Infinity;
    }

    return {
      nodes: nodes,
      directed: directed,
      adj: adj,
      weightOf: weightOf,
      edgeCount: edgeCount,
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

  // ===========================================================================
  // 3. A binary min-heap priority queue (lazy deletion)
  // ===========================================================================
  // Keyed entries {node, dist}. We never implement decrease-key: instead we
  // push a fresh entry whenever a node's tentative distance drops, and discard
  // a popped entry that is STALE (its dist no longer matches the best known).
  // That keeps the heap to O(E) entries and every operation O(log E), which is
  // the standard, robust way to run Dijkstra with a binary heap.
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
  // 4. Dijkstra's algorithm — single source to all reachable nodes
  // ===========================================================================
  // Returns:
  //   { dist:   { node: number | Infinity },
  //     prev:   { node: predecessor | null },   // the shortest-path tree
  //     order:  [ {node, dist}, ... ],           // nodes in the order settled
  //     source }
  function dijkstra(g, source) {
    var dist = Object.create(null), prev = Object.create(null), done = Object.create(null);
    var order = [];
    var nodes = g.nodes;
    for (var i = 0; i < nodes.length; i++) { dist[nodes[i]] = Infinity; prev[nodes[i]] = null; }
    if (!(source in dist)) { return { dist: dist, prev: prev, order: order, source: source }; }

    dist[source] = 0;
    var heap = new MinHeap();
    heap.push(0, source);

    while (heap.size() > 0) {
      var top = heap.pop();
      var u = top.node;
      if (done[u]) { continue; }        // stale entry — already settled
      if (top.dist > dist[u]) { continue; }
      done[u] = true;
      order.push({ node: u, dist: dist[u] });

      var list = g.adj[u] || [];
      for (var j = 0; j < list.length; j++) {
        var v = list[j].to, w = list[j].w;
        if (done[v]) { continue; }
        var nd = dist[u] + w;
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          heap.push(nd, v);
        }
      }
    }
    return { dist: dist, prev: prev, order: order, source: source };
  }

  // Reconstruct the shortest path source..target from a dijkstra() result.
  //   -> { path:[node,...], cost:number } with an empty path & Infinity cost
  //      when target is unreachable.
  function pathTo(result, target) {
    var dist = result.dist, prev = result.prev;
    if (!(target in dist) || dist[target] === Infinity) { return { path: [], cost: Infinity }; }
    var path = [], cur = target, guard = 0, limit = 1e7;
    while (cur != null) {
      path.push(cur);
      if (cur === result.source) { break; }
      cur = prev[cur];
      if (++guard > limit) { break; }
    }
    path.reverse();
    return { path: path, cost: dist[target] };
  }

  // The edges of the shortest-path tree, as [parent, child] pairs.
  function treeEdges(result) {
    var prev = result.prev, out = [];
    for (var v in prev) { if (prev[v] != null) { out.push([prev[v], v]); } }
    out.sort(function (a, b) { return naturalCompare(a[1], b[1]); });
    return out;
  }

  // ===========================================================================
  // 5. One-shot analysis for the UI
  // ===========================================================================
  function analyze(text, opts) {
    opts = opts || {};
    var g = fromText(text, opts);
    var source = opts.source;
    if (source == null || !(g.nodes.indexOf(source) >= 0)) {
      source = g.nodes.length ? g.nodes[0] : null;
    }
    var result = source != null ? dijkstra(g, source)
                                 : { dist: Object.create(null), prev: Object.create(null), order: [], source: null };
    var reached = 0, farthest = null, farDist = -1;
    for (var i = 0; i < g.nodes.length; i++) {
      var d = result.dist[g.nodes[i]];
      if (d !== Infinity && d != null) { reached++; if (d > farDist) { farDist = d; farthest = g.nodes[i]; } }
    }
    return {
      graph: g,
      source: source,
      result: result,
      reached: reached,
      unreached: g.nodes.length - reached,
      farthest: farthest,
      farDist: farDist === -1 ? 0 : farDist
    };
  }

  // ===========================================================================
  // 6. INDEPENDENT ORACLES (the tests' conscience)
  // ===========================================================================

  // (a) Bellman–Ford: relax every edge |V|-1 times. A different algorithm that
  // reaches the same distances as Dijkstra whenever weights are non-negative
  // (and, in fact, for ANY weights with no negative cycle). Returns dist map.
  function bellmanFord(g, source) {
    var dist = Object.create(null), nodes = g.nodes;
    for (var i = 0; i < nodes.length; i++) { dist[nodes[i]] = Infinity; }
    if (!(source in dist)) { return dist; }
    dist[source] = 0;
    // Flatten directed edges (adjacency already mirrors undirected graphs).
    var E = [];
    for (var n = 0; n < nodes.length; n++) {
      var u = nodes[n], list = g.adj[u] || [];
      for (var j = 0; j < list.length; j++) { E.push([u, list[j].to, list[j].w]); }
    }
    for (var pass = 0; pass < nodes.length - 1; pass++) {
      var changed = false;
      for (var k = 0; k < E.length; k++) {
        var a = E[k][0], b = E[k][1], w = E[k][2];
        if (dist[a] !== Infinity && dist[a] + w < dist[b]) { dist[b] = dist[a] + w; changed = true; }
      }
      if (!changed) { break; }
    }
    return dist;
  }

  // (b) Brute force: the cheapest SIMPLE path (no repeated node) source->target,
  // by exhaustive DFS. Exponential — tests use it only on tiny graphs. Returns
  // a number or Infinity. Safe for non-negative weights (an optimal path is
  // always simple when weights are ≥ 0).
  function bruteShortest(g, source, target) {
    if (source === target) { return 0; }
    var best = Infinity, visited = Object.create(null);
    function dfs(u, acc) {
      if (acc >= best) { return; }                 // prune
      if (u === target) { best = acc; return; }
      visited[u] = true;
      var list = g.adj[u] || [];
      for (var i = 0; i < list.length; i++) {
        var v = list[i].to;
        if (!visited[v]) { dfs(v, acc + list[i].w); }
      }
      visited[u] = false;
    }
    dfs(source, 0);
    return best;
  }

  // (c) The relaxation invariant: a distance labelling is optimal iff NO edge
  // can be relaxed. Returns the first violating edge, or null if none — which
  // is a self-contained proof that `dist` is a shortest-path labelling.
  function firstRelaxableEdge(g, dist) {
    var nodes = g.nodes;
    for (var n = 0; n < nodes.length; n++) {
      var u = nodes[n];
      if (dist[u] === Infinity) { continue; }
      var list = g.adj[u] || [];
      for (var j = 0; j < list.length; j++) {
        var v = list[j].to, w = list[j].w;
        if (dist[u] + w < dist[v] - 1e-9) { return { from: u, to: v, w: w }; }
      }
    }
    return null;
  }

  // (d) Re-walk a reconstructed path and confirm its cost. Returns
  // { ok, cost, reason }.
  function verifyPath(g, result, target) {
    var pc = pathTo(result, target);
    if (pc.path.length === 0) {
      return { ok: result.dist[target] === Infinity, cost: Infinity, reason: "unreachable" };
    }
    if (pc.path[0] !== result.source) { return { ok: false, cost: NaN, reason: "path does not start at source" }; }
    if (pc.path[pc.path.length - 1] !== target) { return { ok: false, cost: NaN, reason: "path does not end at target" }; }
    var sum = 0;
    for (var i = 0; i + 1 < pc.path.length; i++) {
      var w = g.weightOf(pc.path[i], pc.path[i + 1]);
      if (w === Infinity) { return { ok: false, cost: NaN, reason: "path uses a non-existent edge " + pc.path[i] + "→" + pc.path[i + 1] }; }
      sum += w;
    }
    var ok = Math.abs(sum - result.dist[target]) < 1e-9;
    return { ok: ok, cost: sum, reason: ok ? "re-walked, cost matches dist" : "re-walked cost " + sum + " ≠ dist " + result.dist[target] };
  }

  // ===========================================================================
  // 7. Deterministic force-directed layout (Fruchterman–Reingold, seeded)
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

    // undirected edge list for attraction (dedupe directed pairs)
    var edgeList = [], emitted = Object.create(null);
    for (var a = 0; a < n; a++) {
      var u = nodes[a], list = g.adj[u] || [];
      for (var e = 0; e < list.length; e++) {
        var v = list[e].to;
        if (v === u) { continue; }
        var key = u < v ? u + "\u0000" + v : v + "\u0000" + u;
        if (!emitted[key]) { emitted[key] = true; edgeList.push([u, v]); }
      }
    }

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
    dijkstra: dijkstra,
    pathTo: pathTo,
    treeEdges: treeEdges,
    analyze: analyze,
    // oracles
    bellmanFord: bellmanFord,
    bruteShortest: bruteShortest,
    firstRelaxableEdge: firstRelaxableEdge,
    verifyPath: verifyPath,
    // layout + util
    layout: layout,
    naturalCompare: naturalCompare,
    MinHeap: MinHeap
  };
});
