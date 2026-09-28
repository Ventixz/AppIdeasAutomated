/*
 * graph-core.js — build a graph (a network) from a plain list of links, then
 * measure its shape.
 *
 * A Source 2 (karan/Projects) "Graph" project. The karan spec reads:
 *
 *   "Graph from links — create a program that will create a graph or network
 *    from a series of links."
 *
 * A "link" is just a line of text naming two things that are connected:
 *
 *     alice -> bob            # a directed link (alice points at bob)
 *     paris -- london         # an undirected link (a road runs both ways)
 *     home, work              # comma, whitespace, ": " all work as separators
 *     island                  # a lone token is an isolated node, no edges
 *
 * From a pile of those lines this module builds a real graph object — a sorted
 * node list and adjacency maps — and then answers the questions you actually
 * ask of a network:
 *
 *   - How many nodes and edges? How dense is it? Who is the most-connected node?
 *   - Which nodes fall into the same connected piece? Is the whole thing one
 *     connected network, or several islands?
 *   - What can you reach from here (a breadth-first walk)?
 *   - Does it contain a cycle, or is it a DAG you can topologically order?
 *
 * Two deliberate design choices worth stating up front:
 *
 *   - **The graph is a *simple* graph.** Parallel links (the same edge given
 *     twice) are collapsed to one, and we *count* how many we collapsed rather
 *     than silently dropping the information. Self-loops (`a -> a`) are kept —
 *     they are legal and they matter to cycle detection — and also counted.
 *     Keeping the stored graph simple is what makes the handshake lemma
 *     (`sum of degrees = 2·|E|`) hold exactly, which the tests lean on.
 *   - **Layout is deterministic.** The force-directed layout that positions the
 *     nodes for the picture is driven by a *seeded* PRNG, so the same graph and
 *     seed always produce the same coordinates. That is what lets the tests
 *     assert the layout is reproducible instead of hand-waving at "looks about
 *     right".
 *
 * The module is UMD-ish: it works with Node's require() and as a browser global
 * (window.GraphCore). No dependencies, no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.GraphCore = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ===========================================================================
  // 1. Parsing links into edges
  // ===========================================================================
  // Each non-blank, non-comment line names either one node (isolated) or two
  // nodes joined by a separator. Separators are tried in PRIORITY order and the
  // first that matches splits the line once (the left group is non-greedy, so we
  // split at the earliest separator). Because a line is only ever split once, an
  // explicit separator keeps hyphens inside the names it produces: "node-1 ->
  // node-2" splits at "->" into "node-1" and "node-2", untouched. The bare
  // hyphen is the *lowest*-priority separator, so "a-b" (no spaces, no arrow)
  // reads as the edge a–b — the reading a links tool wants. (The one casualty is
  // a standalone hyphenated token like "big-city" on its own line, which reads
  // as the edge big–city; use an underscore, or pair it with an arrow, if you
  // mean a single node.)
  var SEPARATORS = [
    /^(.+?)\s*->\s*(.+)$/,     // directed arrow
    /^(.+?)\s*→\s*(.+)$/,      // unicode arrow
    /^(.+?)\s*--\s*(.+)$/,     // double dash (undirected)
    /^(.+?)\s+-\s+(.+)$/,      // spaced single hyphen
    /^(.+?)\s*:\s*(.+)$/,      // colon
    /^(.+?)\s*,\s*(.+)$/,      // comma
    /^(.+?)\s+(.+)$/,          // whitespace
    /^(.+?)\s*-\s*(.+)$/       // bare hyphen (lowest priority)
  ];

  // parseLinks(text) -> { edges: [{from,to}], singles: [name], warnings: [...] }
  // `edges` is the raw parsed list, in order, *before* de-duplication (buildGraph
  // does that). `singles` are lone tokens (isolated node declarations). Comments
  // begin with '#' and run to end of line; a fully-commented or blank line is
  // skipped.
  function parseLinks(text) {
    var edges = [];
    var singles = [];
    var warnings = [];
    var lines = String(text == null ? "" : text).split(/\r\n|\r|\n/);

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var hash = raw.indexOf("#");
      if (hash >= 0) { raw = raw.slice(0, hash); }
      var line = raw.trim();
      if (line === "") { continue; }

      var matched = null;
      for (var s = 0; s < SEPARATORS.length; s++) {
        var m = SEPARATORS[s].exec(line);
        if (m) { matched = m; break; }
      }

      if (!matched) {
        // A single bare token: an isolated node.
        singles.push(line);
        continue;
      }

      var from = matched[1].trim();
      var to = matched[2].trim();
      if (from === "" || to === "") {
        warnings.push("line " + (i + 1) + ": empty node name, skipped (" + JSON.stringify(lines[i]) + ")");
        continue;
      }
      edges.push({ from: from, to: to });
    }
    return { edges: edges, singles: singles, warnings: warnings };
  }

  // ===========================================================================
  // 2. Building the graph
  // ===========================================================================
  // buildGraph(parsed, opts) -> Graph
  //   parsed : either the object from parseLinks, or an array of {from,to} edges.
  //   opts.directed : treat links as directed (default false — undirected).
  //   opts.singles  : extra isolated node names to include.
  //
  // The stored graph is a SIMPLE graph: adjacency is a Set of distinct
  // neighbours. Parallel links collapse to one edge and are counted in
  // `duplicates`; self-loops are kept and counted in `selfLoops`.
  function buildGraph(parsed, opts) {
    opts = opts || {};
    var directed = !!opts.directed;
    var rawEdges = Array.isArray(parsed) ? parsed : (parsed.edges || []);
    var singles = (parsed && parsed.singles) || [];
    if (opts.singles) { singles = singles.concat(opts.singles); }

    var nodeSet = Object.create(null);
    var out = Object.create(null);   // name -> { neighbour: true }  (distinct)
    var inc = Object.create(null);   // name -> { neighbour: true }  (in-edges)

    function ensure(name) {
      if (!(name in nodeSet)) {
        nodeSet[name] = true;
        out[name] = Object.create(null);
        inc[name] = Object.create(null);
      }
    }

    for (var s = 0; s < singles.length; s++) { ensure(singles[s]); }

    var duplicates = 0;
    var selfLoops = 0;
    var seen = Object.create(null);  // canonical edge key -> true, for dup count

    for (var e = 0; e < rawEdges.length; e++) {
      var a = rawEdges[e].from, b = rawEdges[e].to;
      ensure(a); ensure(b);
      if (a === b) { selfLoops++; }

      // Canonical key for de-duplication: ordered for directed, sorted for
      // undirected (so "a--b" and "b--a" are the same edge).
      var key = directed ? (a + "\u0000" + b)
                         : (a < b ? a + "\u0000" + b : b + "\u0000" + a);
      if (seen[key]) { duplicates++; continue; }
      seen[key] = true;

      out[a][b] = true;
      inc[b][a] = true;
      if (!directed) {
        out[b][a] = true;
        inc[a][b] = true;
      }
    }

    var nodes = Object.keys(nodeSet).sort(naturalCompare);

    return {
      directed: directed,
      nodes: nodes,
      _out: out,
      _in: inc,
      duplicates: duplicates,
      selfLoops: selfLoops,
      edgeCount: countEdges(nodes, out, directed)
    };
  }

  // Natural sort so "n2" sorts before "n10" — nicer node ordering in the UI and
  // stable for tests.
  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  // Count distinct edges. Directed: every out-neighbour is one edge. Undirected:
  // each unordered pair once, self-loops once.
  function countEdges(nodes, out, directed) {
    var total = 0;
    if (directed) {
      for (var i = 0; i < nodes.length; i++) { total += Object.keys(out[nodes[i]]).length; }
      return total;
    }
    var counted = Object.create(null);
    for (var n = 0; n < nodes.length; n++) {
      var u = nodes[n];
      var nb = Object.keys(out[u]);
      for (var j = 0; j < nb.length; j++) {
        var v = nb[j];
        if (u === v) { total++; continue; }       // self-loop, once
        var key = u < v ? u + "\u0000" + v : v + "\u0000" + u;
        if (!counted[key]) { counted[key] = true; total++; }
      }
    }
    return total;
  }

  // Convenience: build straight from text.
  function fromText(text, opts) { return buildGraph(parseLinks(text), opts); }

  // ===========================================================================
  // 3. Reading the graph
  // ===========================================================================
  function outNeighbours(g, node) {
    return g._out[node] ? Object.keys(g._out[node]).sort(naturalCompare) : [];
  }
  function inNeighbours(g, node) {
    return g._in[node] ? Object.keys(g._in[node]).sort(naturalCompare) : [];
  }

  // Degrees. Undirected degree obeys the handshake lemma: a self-loop adds 2.
  // Directed splits into in/out; a self-loop adds 1 to each.
  function outDegree(g, node) {
    return g._out[node] ? Object.keys(g._out[node]).length : 0;
  }
  function inDegree(g, node) {
    return g._in[node] ? Object.keys(g._in[node]).length : 0;
  }
  function degree(g, node) {
    if (g.directed) { return outDegree(g, node) + inDegree(g, node); }
    if (!g._out[node]) { return 0; }
    var d = 0;
    var nb = Object.keys(g._out[node]);
    for (var i = 0; i < nb.length; i++) { d += (nb[i] === node) ? 2 : 1; }
    return d;
  }

  // Undirected neighbours (out ∪ in) — used for weak connectivity of a directed
  // graph and for the force layout, where edges pull both ways regardless.
  function bothNeighbours(g, node) {
    var set = Object.create(null);
    if (g._out[node]) { Object.keys(g._out[node]).forEach(function (k) { set[k] = true; }); }
    if (g._in[node]) { Object.keys(g._in[node]).forEach(function (k) { set[k] = true; }); }
    return Object.keys(set);
  }

  // ===========================================================================
  // 4. Connected components (weak, via union–find)
  // ===========================================================================
  // Treats every edge as undirected (weak connectivity). Returns an array of
  // components, each a node list sorted naturally, the whole array sorted by its
  // first member — a canonical form the tests can compare against a flood fill.
  function components(g) {
    var parent = Object.create(null), rank = Object.create(null);
    g.nodes.forEach(function (n) { parent[n] = n; rank[n] = 0; });

    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra === rb) { return; }
      if (rank[ra] < rank[rb]) { var t = ra; ra = rb; rb = t; }
      parent[rb] = ra;
      if (rank[ra] === rank[rb]) { rank[ra]++; }
    }

    g.nodes.forEach(function (u) {
      bothNeighbours(g, u).forEach(function (v) { union(u, v); });
    });

    var groups = Object.create(null);
    g.nodes.forEach(function (n) {
      var r = find(n);
      (groups[r] || (groups[r] = [])).push(n);
    });

    var comps = Object.keys(groups).map(function (r) {
      return groups[r].sort(naturalCompare);
    });
    comps.sort(function (a, b) { return naturalCompare(a[0], b[0]); });
    return comps;
  }

  function isConnected(g) {
    return components(g).length <= 1;
  }

  // ===========================================================================
  // 5. Breadth-first search / reachability
  // ===========================================================================
  // Follows out-neighbours (directed) or all neighbours (undirected). Returns
  // the visit order and a distance map (hops from start). `start` absent from
  // the graph yields an empty walk.
  function bfs(g, start) {
    var order = [], dist = Object.create(null);
    if (!(start in g._out)) { return { order: order, dist: dist }; }
    var queue = [start];
    dist[start] = 0;
    for (var head = 0; head < queue.length; head++) {
      var u = queue[head];
      order.push(u);
      var nb = g.directed ? Object.keys(g._out[u]) : bothNeighbours(g, u);
      nb.sort(naturalCompare);
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i];
        if (!(v in dist)) { dist[v] = dist[u] + 1; queue.push(v); }
      }
    }
    return { order: order, dist: dist };
  }

  function reachable(g, start) { return bfs(g, start).order; }

  // ===========================================================================
  // 6. Cycles and topological order
  // ===========================================================================
  // Directed: DFS three-colouring — a grey (on-stack) node reached again is a
  // back edge, i.e. a cycle; a self-loop is trivially a cycle. Undirected: DFS
  // tracking the parent — any visited non-parent neighbour closes a cycle, and a
  // self-loop is a cycle.
  function hasCycle(g) {
    if (g.selfLoops > 0) { return true; }
    if (g.directed) {
      var color = Object.create(null); // undefined=white, 1=grey, 2=black
      var found = false;
      var nodes = g.nodes;
      function dfs(u) {
        color[u] = 1;
        var nb = Object.keys(g._out[u]);
        for (var i = 0; i < nb.length; i++) {
          var v = nb[i];
          if (color[v] === 1) { found = true; return; }
          if (color[v] === undefined) { dfs(v); if (found) { return; } }
        }
        color[u] = 2;
      }
      for (var i = 0; i < nodes.length && !found; i++) {
        if (color[nodes[i]] === undefined) { dfs(nodes[i]); }
      }
      return found;
    }
    // undirected
    var visited = Object.create(null);
    var cyc = false;
    function udfs(u, parent) {
      visited[u] = true;
      var nb = Object.keys(g._out[u]);
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i];
        if (v === u) { continue; } // self-loops handled by selfLoops guard above
        if (!visited[v]) { udfs(v, u); if (cyc) { return; } }
        else if (v !== parent) { cyc = true; return; }
      }
    }
    for (var k = 0; k < g.nodes.length && !cyc; k++) {
      if (!visited[g.nodes[k]]) { udfs(g.nodes[k], null); }
    }
    return cyc;
  }

  // Kahn's algorithm. Directed only. Returns a valid topological order, or null
  // if the graph has a cycle (so it doubles as a DAG test).
  function topoSort(g) {
    if (!g.directed) { return null; }
    var indeg = Object.create(null);
    g.nodes.forEach(function (n) { indeg[n] = inDegree(g, n); });
    // Ready queue kept sorted for a deterministic order.
    var ready = g.nodes.filter(function (n) { return indeg[n] === 0; }).sort(naturalCompare);
    var order = [];
    while (ready.length) {
      var u = ready.shift();
      order.push(u);
      var nb = Object.keys(g._out[u]).sort(naturalCompare);
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i];
        if (v === u) { continue; }
        indeg[v]--;
        if (indeg[v] === 0) { insertSorted(ready, v); }
      }
    }
    return order.length === g.nodes.length ? order : null;
  }

  function insertSorted(arr, x) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (naturalCompare(arr[mid], x) < 0) { lo = mid + 1; } else { hi = mid; }
    }
    arr.splice(lo, 0, x);
  }

  // ===========================================================================
  // 7. A one-shot summary
  // ===========================================================================
  function stats(g) {
    var n = g.nodes.length;
    var m = g.edgeCount;
    var comps = components(g);
    var isolated = g.nodes.filter(function (nd) { return degree(g, nd) === 0; });

    // Density: fraction of possible edges present. Directed max = n(n−1),
    // undirected max = n(n−1)/2 (self-loops excluded from the "possible" count).
    var maxEdges = g.directed ? n * (n - 1) : (n * (n - 1)) / 2;
    var density = maxEdges > 0 ? Math.min(1, m / maxEdges) : 0;

    // Most-connected node by total degree (ties broken by natural order).
    var top = null, topDeg = -1;
    g.nodes.forEach(function (nd) {
      var d = degree(g, nd);
      if (d > topDeg) { topDeg = d; top = nd; }
    });

    return {
      directed: g.directed,
      nodeCount: n,
      edgeCount: m,
      selfLoops: g.selfLoops,
      duplicates: g.duplicates,
      componentCount: comps.length,
      connected: comps.length <= 1,
      isolatedCount: isolated.length,
      density: density,
      avgDegree: n > 0 ? (g.directed ? m / n : (2 * m) / n) : 0,
      topNode: top,
      topDegree: topDeg < 0 ? 0 : topDeg,
      acyclic: !hasCycle(g)
    };
  }

  // ===========================================================================
  // 8. A deterministic force-directed layout (for the picture)
  // ===========================================================================
  // Fruchterman–Reingold: nodes repel each other, edges pull their endpoints
  // together, and a cooling "temperature" caps each step so the whole thing
  // settles. Initial positions come from a *seeded* PRNG, so identical inputs
  // give identical coordinates — reproducibility the tests check.
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
    var W = opts.width || 800;
    var H = opts.height || 600;
    var iterations = opts.iterations || 300;
    var rnd = mulberry32(opts.seed == null ? 1 : (opts.seed | 0));
    var nodes = g.nodes;
    var n = nodes.length;
    var pos = Object.create(null);

    if (n === 0) { return pos; }
    if (n === 1) { pos[nodes[0]] = { x: W / 2, y: H / 2 }; return pos; }

    // Seeded initial scatter.
    for (var i = 0; i < n; i++) {
      pos[nodes[i]] = { x: rnd() * W, y: rnd() * H };
    }

    var area = W * H;
    var k = Math.sqrt(area / n);          // ideal edge length
    var t = Math.min(W, H) * 0.1;         // starting temperature
    var cool = t / (iterations + 1);

    // Distinct undirected edges, once each (excluding self-loops — they exert no
    // useful attraction).
    var edgeList = [];
    var emitted = Object.create(null);
    for (var a = 0; a < n; a++) {
      var u = nodes[a];
      bothNeighbours(g, u).forEach(function (v) {
        if (v === u) { return; }
        var key = u < v ? u + "\u0000" + v : v + "\u0000" + u;
        if (!emitted[key]) { emitted[key] = true; edgeList.push([u, v]); }
      });
    }

    var disp = Object.create(null);
    for (var it = 0; it < iterations; it++) {
      for (var d0 = 0; d0 < n; d0++) { disp[nodes[d0]] = { x: 0, y: 0 }; }

      // Repulsion between every pair.
      for (var iu = 0; iu < n; iu++) {
        for (var iv = iu + 1; iv < n; iv++) {
          var pu = pos[nodes[iu]], pv = pos[nodes[iv]];
          var dx = pu.x - pv.x, dy = pu.y - pv.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          var rep = (k * k) / dist;
          var ux = (dx / dist) * rep, uy = (dy / dist) * rep;
          disp[nodes[iu]].x += ux; disp[nodes[iu]].y += uy;
          disp[nodes[iv]].x -= ux; disp[nodes[iv]].y -= uy;
        }
      }

      // Attraction along edges.
      for (var ie = 0; ie < edgeList.length; ie++) {
        var pa = pos[edgeList[ie][0]], pb = pos[edgeList[ie][1]];
        var ex = pa.x - pb.x, ey = pa.y - pb.y;
        var elen = Math.sqrt(ex * ex + ey * ey) || 0.01;
        var att = (elen * elen) / k;
        var ax = (ex / elen) * att, ay = (ey / elen) * att;
        disp[edgeList[ie][0]].x -= ax; disp[edgeList[ie][0]].y -= ay;
        disp[edgeList[ie][1]].x += ax; disp[edgeList[ie][1]].y += ay;
      }

      // Move, capped by temperature, clamped to the frame.
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
    outNeighbours: outNeighbours,
    inNeighbours: inNeighbours,
    bothNeighbours: bothNeighbours,
    outDegree: outDegree,
    inDegree: inDegree,
    degree: degree,
    components: components,
    isConnected: isConnected,
    bfs: bfs,
    reachable: reachable,
    hasCycle: hasCycle,
    topoSort: topoSort,
    stats: stats,
    layout: layout,
    naturalCompare: naturalCompare
  };
});
