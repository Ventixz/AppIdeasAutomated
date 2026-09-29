/*
 * graph-core.js — decide whether a graph has an Eulerian path or circuit, and,
 * when it does, actually walk one out edge by edge.
 *
 * A Source 2 (karan/Projects) "Graph" project. The karan spec reads:
 *
 *   "Eulerian Path — An Eulerian path is a path in a graph which visits every
 *    edge exactly once. Write a program that finds one."
 *
 * An Eulerian *path* (or *trail*) uses every edge of the graph exactly once. If
 * it also ends where it began it is an Eulerian *circuit*. Leonhard Euler's 1736
 * answer to the Seven Bridges of Königsberg is the first theorem of graph
 * theory, and it is refreshingly crisp — you can tell whether a trail exists
 * without ever searching for one, just by counting degrees:
 *
 *   UNDIRECTED graph (ignoring isolated vertices, and requiring the edges to
 *   form ONE connected piece):
 *     • every vertex has EVEN degree            -> Eulerian circuit
 *     • exactly TWO vertices have ODD degree     -> Eulerian path (it must start
 *                                                   at one odd vertex and end at
 *                                                   the other)
 *     • any other count of odd vertices          -> no Eulerian trail
 *
 *   DIRECTED graph (edges all form one weakly-connected piece):
 *     • every vertex has in-degree == out-degree -> Eulerian circuit
 *     • exactly one vertex has out-in == +1 (the start) and exactly one has
 *       in-out == +1 (the end), all others balanced -> Eulerian path
 *     • anything else                             -> no Eulerian trail
 *
 * THE KEY DESIGN CHOICE — this is a MULTIGRAPH. Königsberg has two bridges
 * between the same pair of banks, and a trail must cross *both*. So, unlike the
 * sibling "Graph from Links" project (which stores a *simple* graph and collapses
 * parallel links), this module keeps every parsed link as a DISTINCT edge with
 * its own id, and self-loops are real edges too (a self-loop adds 2 to an
 * undirected degree and 1 to each of a directed vertex's in/out degrees, and it
 * must be traversed exactly once). Counting degrees only tells you a trail
 * *exists*; to hand one back we run Hierholzer's algorithm, which stitches
 * together cycles in O(V + E), and then we verify the trail it returns really
 * does use every edge exactly once.
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
  // nodes joined by a separator, tried in PRIORITY order — the first that
  // matches splits the line ONCE (the left group is non-greedy, so the split is
  // at the earliest separator). Because a line is only split once, an explicit
  // separator keeps hyphens inside the names it produces: "node-1 -> node-2"
  // splits at "->" into "node-1" and "node-2". The bare hyphen is lowest
  // priority, so "a-b" reads as the edge a–b. Comments run from '#' to line end.
  var SEPARATORS = [
    /^(.+?)\s*->\s*(.+)$/,     // directed arrow
    /^(.+?)\s*→\s*(.+)$/,      // unicode arrow
    /^(.+?)\s*--\s*(.+)$/,     // double dash
    /^(.+?)\s+-\s+(.+)$/,      // spaced single hyphen
    /^(.+?)\s*:\s*(.+)$/,      // colon
    /^(.+?)\s*,\s*(.+)$/,      // comma
    /^(.+?)\s+(.+)$/,          // whitespace
    /^(.+?)\s*-\s*(.+)$/       // bare hyphen (lowest priority)
  ];

  // parseLinks(text) -> { edges: [{from,to}], singles: [name], warnings: [...] }
  // `edges` is the raw list in order; parallel links and self-loops are KEPT
  // (buildMultigraph does not collapse them). `singles` are lone tokens.
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

      if (!matched) { singles.push(line); continue; }

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

  // A "natural" comparison so node2 < node10, and numbers sort ahead of words.
  function naturalCompare(a, b) {
    var re = /(\d+)|(\D+)/g;
    var ax = String(a).match(re) || [];
    var bx = String(b).match(re) || [];
    for (var i = 0; i < Math.min(ax.length, bx.length); i++) {
      var an = /^\d/.test(ax[i]), bn = /^\d/.test(bx[i]);
      if (an && bn) {
        var d = parseInt(ax[i], 10) - parseInt(bx[i], 10);
        if (d !== 0) { return d < 0 ? -1 : 1; }
      } else if (ax[i] !== bx[i]) {
        return ax[i] < bx[i] ? -1 : 1;
      }
    }
    return ax.length - bx.length;
  }

  // ===========================================================================
  // 2. Building the multigraph
  // ===========================================================================
  // buildMultigraph(parsed, opts) -> Graph
  //   parsed : the object from parseLinks, or an array of {from,to} edges.
  //   opts.directed : treat links as directed (default false — undirected).
  //   opts.singles  : extra isolated node names to include.
  //
  // Every edge is kept as a DISTINCT object { id, from, to }; parallel links and
  // self-loops are preserved. We also build, per node, a list of edge "stubs"
  // for Hierholzer's walk: for an undirected edge both endpoints get a stub (a
  // self-loop gives its node TWO stubs, matching its degree of 2); for a
  // directed edge only the tail gets an out-stub.
  function buildMultigraph(parsed, opts) {
    opts = opts || {};
    var directed = !!opts.directed;
    var rawEdges = Array.isArray(parsed) ? parsed : (parsed.edges || []);
    var singles = (parsed && parsed.singles) || [];
    if (opts.singles) { singles = singles.concat(opts.singles); }

    var nodeSet = Object.create(null);
    var stubs = Object.create(null);   // node -> [{ to, id }]   (out-stubs if directed)
    var outdeg = Object.create(null);
    var indeg = Object.create(null);
    var degree = Object.create(null);  // undirected degree (self-loop = +2)

    function ensure(name) {
      if (!(name in nodeSet)) {
        nodeSet[name] = true;
        stubs[name] = [];
        outdeg[name] = 0;
        indeg[name] = 0;
        degree[name] = 0;
      }
    }

    for (var s = 0; s < singles.length; s++) { ensure(singles[s]); }

    var edges = [];
    var selfLoops = 0;
    var parallels = 0;
    var seen = Object.create(null);  // canonical key -> count, for the parallel tally

    for (var e = 0; e < rawEdges.length; e++) {
      var a = rawEdges[e].from, b = rawEdges[e].to;
      ensure(a); ensure(b);
      var id = edges.length;
      edges.push({ id: id, from: a, to: b });

      var key = directed ? (a + "\u0000" + b)
                         : (a < b ? a + "\u0000" + b : b + "\u0000" + a);
      if (seen[key]) { parallels++; } else { seen[key] = true; }

      if (a === b) { selfLoops++; }

      if (directed) {
        stubs[a].push({ to: b, id: id });
        outdeg[a]++; indeg[b]++;
      } else {
        stubs[a].push({ to: b, id: id });
        stubs[b].push({ to: a, id: id });   // self-loop pushes twice -> degree 2
        degree[a]++; degree[b]++;
      }
    }

    var nodes = Object.keys(nodeSet).sort(naturalCompare);

    return {
      directed: directed,
      nodes: nodes,
      edges: edges,
      _stubs: stubs,
      _outdeg: outdeg,
      _indeg: indeg,
      _degree: degree,
      selfLoops: selfLoops,
      parallels: parallels
    };
  }

  // Per-node degree read-outs (for the UI/stats and the classifier).
  function degreeOf(g, node) {
    if (g.directed) {
      return { out: g._outdeg[node] || 0, in: g._indeg[node] || 0 };
    }
    return { degree: g._degree[node] || 0 };
  }

  function totalDegree(g, node) {
    return g.directed ? ((g._outdeg[node] || 0) + (g._indeg[node] || 0))
                      : (g._degree[node] || 0);
  }

  // ===========================================================================
  // 3. Connectivity of the edge-bearing vertices
  // ===========================================================================
  // An Eulerian trail needs every EDGE to sit in one connected piece; isolated
  // vertices (no incident edge) are irrelevant and ignored. For a directed graph
  // we test WEAK connectivity — follow edges in either direction — which, once
  // the degree balance holds, is equivalent to the strong connectivity the trail
  // really needs. Returns { connected, componentsWithEdges }.
  function edgeConnectivity(g) {
    // adjacency ignoring direction, over vertices that touch an edge
    var adj = Object.create(null);
    var touched = Object.create(null);
    for (var i = 0; i < g.edges.length; i++) {
      var a = g.edges[i].from, b = g.edges[i].to;
      touched[a] = true; touched[b] = true;
      if (!adj[a]) { adj[a] = []; }
      if (!adj[b]) { adj[b] = []; }
      adj[a].push(b); adj[b].push(a);
    }
    var touchedNodes = Object.keys(touched);
    if (touchedNodes.length === 0) {
      return { connected: true, componentsWithEdges: 0 };
    }
    var seen = Object.create(null);
    var components = 0;
    for (var t = 0; t < touchedNodes.length; t++) {
      var start = touchedNodes[t];
      if (seen[start]) { continue; }
      components++;
      var stack = [start];
      seen[start] = true;
      while (stack.length) {
        var v = stack.pop();
        var nb = adj[v] || [];
        for (var k = 0; k < nb.length; k++) {
          if (!seen[nb[k]]) { seen[nb[k]] = true; stack.push(nb[k]); }
        }
      }
    }
    return { connected: components <= 1, componentsWithEdges: components };
  }

  // ===========================================================================
  // 4. Classification — does a trail exist, and where must it start/end?
  // ===========================================================================
  // classifyEulerian(g) -> {
  //   kind: "circuit" | "path" | "none",
  //   start, end,        // trail endpoints (start===end for a circuit; null for none)
  //   reason,            // human sentence
  //   connected,         // edges form one piece?
  //   oddVertices,       // undirected: names with odd degree
  //   unbalanced         // directed: [{node, out, in, diff}] for diff !== 0
  // }
  function classifyEulerian(g) {
    var conn = edgeConnectivity(g);
    var res = {
      kind: "none", start: null, end: null, reason: "",
      connected: conn.connected, oddVertices: [], unbalanced: []
    };

    // No edges at all: the empty trail is vacuously an Eulerian circuit.
    if (g.edges.length === 0) {
      res.kind = "circuit";
      res.start = g.nodes.length ? g.nodes[0] : null;
      res.end = res.start;
      res.reason = "The graph has no edges, so the empty trail is trivially Eulerian.";
      return res;
    }

    if (!conn.connected) {
      res.reason = "The edges split into " + conn.componentsWithEdges +
        " disconnected pieces; a single trail can only ever cover one. " +
        "No Eulerian trail exists.";
      return res;
    }

    if (g.directed) {
      var starts = [], ends = [], bad = [];
      for (var i = 0; i < g.nodes.length; i++) {
        var n = g.nodes[i];
        var o = g._outdeg[n] || 0, ind = g._indeg[n] || 0;
        var diff = o - ind;
        if (diff !== 0) { res.unbalanced.push({ node: n, out: o, in: ind, diff: diff }); }
        if (diff === 1) { starts.push(n); }
        else if (diff === -1) { ends.push(n); }
        else if (diff !== 0) { bad.push(n); }
      }
      if (starts.length === 0 && ends.length === 0 && bad.length === 0) {
        res.kind = "circuit";
        res.start = firstWithOut(g);
        res.end = res.start;
        res.reason = "Every vertex has in-degree = out-degree and the edges are " +
          "connected — an Eulerian circuit exists (it returns to its start).";
      } else if (starts.length === 1 && ends.length === 1 && bad.length === 0) {
        res.kind = "path";
        res.start = starts[0];
        res.end = ends[0];
        res.reason = "One vertex has out-degree one more than in-degree (" +
          starts[0] + ", the start) and one the reverse (" + ends[0] +
          ", the end); all others are balanced — an Eulerian path exists.";
      } else {
        res.reason = "The in/out degrees are not balanced enough for a trail: " +
          "a directed Eulerian trail needs every vertex balanced except at most " +
          "one +1 start and one -1 end. No Eulerian trail exists.";
      }
      return res;
    }

    // Undirected
    var odd = [];
    for (var j = 0; j < g.nodes.length; j++) {
      var name = g.nodes[j];
      if (((g._degree[name] || 0) % 2) === 1) { odd.push(name); }
    }
    res.oddVertices = odd;
    if (odd.length === 0) {
      res.kind = "circuit";
      res.start = firstWithDegree(g);
      res.end = res.start;
      res.reason = "Every vertex has even degree and the edges are connected — " +
        "an Eulerian circuit exists (it returns to its start).";
    } else if (odd.length === 2) {
      res.kind = "path";
      res.start = odd[0];
      res.end = odd[1];
      res.reason = "Exactly two vertices have odd degree (" + odd[0] + " and " +
        odd[1] + "); an Eulerian path exists and must run between them.";
    } else {
      res.reason = "There are " + odd.length + " vertices of odd degree (" +
        odd.join(", ") + "). An Eulerian trail allows either 0 (circuit) or 2 " +
        "(path); no trail exists.";
    }
    return res;
  }

  function firstWithDegree(g) {
    for (var i = 0; i < g.nodes.length; i++) {
      if ((g._degree[g.nodes[i]] || 0) > 0) { return g.nodes[i]; }
    }
    return g.nodes.length ? g.nodes[0] : null;
  }
  function firstWithOut(g) {
    for (var i = 0; i < g.nodes.length; i++) {
      if ((g._outdeg[g.nodes[i]] || 0) > 0) { return g.nodes[i]; }
    }
    return g.nodes.length ? g.nodes[0] : null;
  }

  // ===========================================================================
  // 5. Hierholzer's algorithm — construct a trail
  // ===========================================================================
  // findEulerianTrail(g) -> {
  //   trail:     [nodeName, ...]   the vertices in visiting order (length E+1)
  //   edgeOrder: [edgeId, ...]     the edges in the order crossed (length E)
  //   isCircuit: bool              trail ends where it began
  //   start, end
  // }  or null when no Eulerian trail exists.
  //
  // Hierholzer: from the required start vertex, keep walking down unused edges;
  // when you get stuck (a vertex with no unused edge), pop back, splicing in
  // side-cycles as you go. Iterative, O(V + E). A per-node cursor skips edges
  // already used, so each stub is examined once.
  function findEulerianTrail(g) {
    var cls = classifyEulerian(g);
    if (cls.kind === "none") { return null; }

    if (g.edges.length === 0) {
      return {
        trail: cls.start == null ? [] : [cls.start],
        edgeOrder: [], isCircuit: true, start: cls.start, end: cls.start
      };
    }

    var used = new Array(g.edges.length);
    var cursor = Object.create(null);
    for (var i = 0; i < g.nodes.length; i++) { cursor[g.nodes[i]] = 0; }

    var vStack = [cls.start];
    var eStack = [-1];            // edge that led to the vertex above it (-1 for the root)
    var trail = [];
    var edgeOrder = [];

    while (vStack.length) {
      var v = vStack[vStack.length - 1];
      var stubList = g._stubs[v];
      // advance past used edges
      while (cursor[v] < stubList.length && used[stubList[cursor[v]].id]) {
        cursor[v]++;
      }
      if (cursor[v] < stubList.length) {
        var stub = stubList[cursor[v]];
        cursor[v]++;
        used[stub.id] = true;
        vStack.push(stub.to);
        eStack.push(stub.id);
      } else {
        trail.push(vStack.pop());
        var eid = eStack.pop();
        if (eid !== -1) { edgeOrder.push(eid); }
      }
    }

    trail.reverse();
    edgeOrder.reverse();

    // Verify: a genuine Eulerian trail uses every edge exactly once. If the graph
    // was mis-classified as trail-bearing (it never should be), this catches it.
    if (edgeOrder.length !== g.edges.length) { return null; }

    return {
      trail: trail,
      edgeOrder: edgeOrder,
      isCircuit: trail.length > 0 && trail[0] === trail[trail.length - 1] && cls.kind === "circuit",
      start: cls.start,
      end: cls.end
    };
  }

  // ===========================================================================
  // 6. Independent verifier (used by the tests and the UI's "proof" line)
  // ===========================================================================
  // verifyTrail(g, result) -> { ok, reason }. Confirms, WITHOUT trusting the
  // solver, that `result` is a legal Eulerian trail of g: consecutive vertices
  // are joined by the claimed edge, no edge is used twice, and every edge is
  // used. This is the ground truth the solver is checked against.
  function verifyTrail(g, result) {
    if (!result) { return { ok: false, reason: "no trail given" }; }
    var trail = result.trail, order = result.edgeOrder;
    if (g.edges.length === 0) {
      return { ok: order.length === 0, reason: order.length === 0 ? "empty trail ok" : "spurious edges" };
    }
    if (order.length !== g.edges.length) {
      return { ok: false, reason: "trail uses " + order.length + " of " + g.edges.length + " edges" };
    }
    if (trail.length !== order.length + 1) {
      return { ok: false, reason: "trail has " + trail.length + " vertices, expected " + (order.length + 1) };
    }
    var seen = Object.create(null);
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      if (seen[id]) { return { ok: false, reason: "edge " + id + " used twice" }; }
      seen[id] = true;
      var edge = g.edges[id];
      var u = trail[i], w = trail[i + 1];
      var fits = g.directed
        ? (edge.from === u && edge.to === w)
        : ((edge.from === u && edge.to === w) || (edge.from === w && edge.to === u));
      if (!fits) {
        return { ok: false, reason: "step " + i + " (" + u + "->" + w + ") is not edge " +
          edge.from + (g.directed ? "->" : "--") + edge.to };
      }
    }
    return { ok: true, reason: "every edge used exactly once, in order" };
  }

  // ===========================================================================
  // 7. A compact, deterministic force layout for the picture
  // ===========================================================================
  // layout(g, opts) -> { positions: {node:{x,y}}, width, height }
  // Fruchterman–Reingold with a seeded PRNG, so the same graph and seed give the
  // same coordinates (the tests check this). Kept small on purpose.
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  function layout(g, opts) {
    opts = opts || {};
    var W = opts.width || 800, H = opts.height || 560;
    var seed = opts.seed || 1;
    var iters = opts.iterations || 300;
    var nodes = g.nodes;
    var n = nodes.length;
    var pos = Object.create(null);
    var rng = makeRng(seed);

    if (n === 0) { return { positions: pos, width: W, height: H }; }
    if (n === 1) { pos[nodes[0]] = { x: W / 2, y: H / 2 }; return { positions: pos, width: W, height: H }; }

    var idx = Object.create(null);
    for (var i = 0; i < n; i++) {
      idx[nodes[i]] = i;
      pos[nodes[i]] = { x: (0.15 + 0.7 * rng()) * W, y: (0.15 + 0.7 * rng()) * H };
    }
    // one entry per undirected edge for the attractive force (parallels/self-loops
    // do not change the layout meaningfully; we dedupe for stability)
    var seenE = Object.create(null), pairs = [];
    for (var e = 0; e < g.edges.length; e++) {
      var a = g.edges[e].from, b = g.edges[e].to;
      if (a === b) { continue; }
      var key = a < b ? a + "\u0000" + b : b + "\u0000" + a;
      if (seenE[key]) { continue; }
      seenE[key] = true;
      pairs.push([a, b]);
    }

    var area = W * H;
    var k = Math.sqrt(area / n) * 0.8;
    var temp = W * 0.1;
    var cool = temp / (iters + 1);

    for (var it = 0; it < iters; it++) {
      var disp = Object.create(null);
      for (var q = 0; q < n; q++) { disp[nodes[q]] = { x: 0, y: 0 }; }
      // repulsion
      for (var u = 0; u < n; u++) {
        for (var v = u + 1; v < n; v++) {
          var pu = pos[nodes[u]], pv = pos[nodes[v]];
          var dx = pu.x - pv.x, dy = pu.y - pv.y;
          var d2 = dx * dx + dy * dy;
          var d = Math.sqrt(d2) || 0.01;
          var rep = (k * k) / d;
          var ux = dx / d, uy = dy / d;
          disp[nodes[u]].x += ux * rep; disp[nodes[u]].y += uy * rep;
          disp[nodes[v]].x -= ux * rep; disp[nodes[v]].y -= uy * rep;
        }
      }
      // attraction along edges
      for (var p = 0; p < pairs.length; p++) {
        var na = pairs[p][0], nb = pairs[p][1];
        var pa = pos[na], pb = pos[nb];
        var ex = pa.x - pb.x, ey = pa.y - pb.y;
        var ed = Math.sqrt(ex * ex + ey * ey) || 0.01;
        var att = (ed * ed) / k;
        var axu = ex / ed, ayu = ey / ed;
        disp[na].x -= axu * att; disp[na].y -= ayu * att;
        disp[nb].x += axu * att; disp[nb].y += ayu * att;
      }
      // apply, capped by temperature, clamped in-bounds
      for (var w2 = 0; w2 < n; w2++) {
        var nm = nodes[w2];
        var dd = disp[nm];
        var dl = Math.sqrt(dd.x * dd.x + dd.y * dd.y) || 0.01;
        var step = Math.min(dl, temp);
        var np = pos[nm];
        np.x += (dd.x / dl) * step;
        np.y += (dd.y / dl) * step;
        np.x = Math.max(30, Math.min(W - 30, np.x));
        np.y = Math.max(30, Math.min(H - 30, np.y));
      }
      temp -= cool;
    }
    return { positions: pos, width: W, height: H };
  }

  return {
    parseLinks: parseLinks,
    buildMultigraph: buildMultigraph,
    degreeOf: degreeOf,
    totalDegree: totalDegree,
    edgeConnectivity: edgeConnectivity,
    classifyEulerian: classifyEulerian,
    findEulerianTrail: findEulerianTrail,
    verifyTrail: verifyTrail,
    layout: layout,
    naturalCompare: naturalCompare
  };
});
