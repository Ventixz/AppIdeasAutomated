/*
 * connectivity-core.js — take a graph as input and answer, exactly, the one
 * question this project is about: *is every node connected?*
 *
 * A Source 2 (karan/Projects) "Graph" project. The karan spec reads:
 *
 *   "Connected Graph — Create a program which takes a graph as an input and
 *    outputs whether every node is connected or not."
 *
 * "Connected" is a single word that hides two different questions, and this
 * module answers both, with the tell-tale structure that *explains* the answer:
 *
 *   UNDIRECTED
 *     - Is it connected? (one piece, every node reachable from every other.)
 *     - If it is, *how robustly*? A path is connected but fragile — snip one
 *       node in the middle and it falls apart. So we find the **articulation
 *       points** (cut vertices) and **bridges** (cut edges): the single points
 *       of failure whose removal would disconnect the graph. No articulation
 *       point ⇒ the graph is **2-connected** (biconnected); no bridge ⇒
 *       **2-edge-connected**. That is the difference between "connected" and
 *       "connected *and* resilient".
 *
 *   DIRECTED
 *     - **Weakly** connected? (one piece if you ignore the arrow directions.)
 *     - **Strongly** connected? (every node can reach every other *following*
 *       the arrows.) These come apart: a -> b -> c is weakly connected but not
 *       strongly. We compute the **strongly connected components** (SCCs) with
 *       Tarjan's linear-time algorithm, so "not strongly connected" comes with
 *       the actual mutually-reachable clusters.
 *
 * Every non-trivial answer is backed by an **independent check** the tests lean
 * on: connectivity is confirmed by a flood fill, articulation points and bridges
 * by literally removing each vertex/edge and recounting pieces, and the SCCs by
 * an all-pairs reachability oracle. If the clever linear-time algorithm and the
 * brute-force oracle ever disagree, the tests fail.
 *
 * Design choices, stated up front:
 *   - The stored graph is a **simple** graph: parallel links collapse to one and
 *     are counted; self-loops are kept and counted. (Neither parallel edges nor
 *     self-loops change whether a graph is connected, so a simple graph is the
 *     honest model for *this* question — but note a bridge finder that treated
 *     parallels as one edge would lie, so `bridges()` is told the true
 *     multiplicity and never calls a doubled edge a bridge. See there.)
 *   - Layout is deterministic (seeded PRNG), so the picture is reproducible and
 *     the tests can assert on coordinates.
 *
 * UMD-ish: works under Node's require() and as a browser global
 * (window.ConnectivityCore). No dependencies, no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.ConnectivityCore = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ===========================================================================
  // 1. Parsing links into edges (same link grammar as the sibling Graph projects)
  // ===========================================================================
  // Each non-blank, non-comment line is either one node (isolated) or two nodes
  // joined by a separator. Separators are tried in PRIORITY order; the first
  // match splits the line once, at the earliest separator (the left group is
  // non-greedy). Because a line is split only once, an explicit separator keeps
  // hyphens inside the names: "node-1 -> node-2" ⇒ node-1, node-2. The bare
  // hyphen is lowest priority so "a-b" reads as the edge a–b.
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

  // parseLinks(text) -> { edges:[{from,to}], singles:[name], warnings:[...] }
  function parseLinks(text) {
    var edges = [], singles = [], warnings = [];
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

      var from = matched[1].trim(), to = matched[2].trim();
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
  // Stored graph is SIMPLE: adjacency is a set of distinct neighbours. Parallel
  // links collapse (counted in `duplicates`); self-loops are kept (counted in
  // `selfLoops`). We ALSO record, per undirected pair, how many parsed links ran
  // between them (`multiplicity`) — the bridge finder needs the true count,
  // because two roads between the same pair of towns means neither is a bridge.
  function buildGraph(parsed, opts) {
    opts = opts || {};
    var directed = !!opts.directed;
    var rawEdges = Array.isArray(parsed) ? parsed : (parsed.edges || []);
    var singles = (parsed && parsed.singles) || [];
    if (opts.singles) { singles = singles.concat(opts.singles); }

    var nodeSet = Object.create(null);
    var out = Object.create(null);   // name -> { neighbour: true }
    var inc = Object.create(null);   // name -> { neighbour: true }
    var mult = Object.create(null);  // undirected pair key -> parsed-link count

    function ensure(name) {
      if (!(name in nodeSet)) {
        nodeSet[name] = true;
        out[name] = Object.create(null);
        inc[name] = Object.create(null);
      }
    }
    for (var s = 0; s < singles.length; s++) { ensure(singles[s]); }

    var duplicates = 0, selfLoops = 0;
    var seen = Object.create(null);

    for (var e = 0; e < rawEdges.length; e++) {
      var a = rawEdges[e].from, b = rawEdges[e].to;
      ensure(a); ensure(b);
      if (a === b) { selfLoops++; }

      // Undirected multiplicity: count every parsed link between the pair,
      // including repeats, so bridges() can see a doubled connection.
      var pairKey = a < b ? a + "\u0000" + b : b + "\u0000" + a;
      mult[pairKey] = (mult[pairKey] || 0) + 1;

      var key = directed ? (a + "\u0000" + b) : pairKey;
      if (seen[key]) { duplicates++; continue; }
      seen[key] = true;

      out[a][b] = true;
      inc[b][a] = true;
      if (!directed) { out[b][a] = true; inc[a][b] = true; }
    }

    var nodes = Object.keys(nodeSet).sort(naturalCompare);
    return {
      directed: directed,
      nodes: nodes,
      _out: out,
      _in: inc,
      _mult: mult,
      duplicates: duplicates,
      selfLoops: selfLoops,
      edgeCount: countEdges(nodes, out, directed)
    };
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  function countEdges(nodes, out, directed) {
    var total = 0;
    if (directed) {
      for (var i = 0; i < nodes.length; i++) { total += Object.keys(out[nodes[i]]).length; }
      return total;
    }
    var counted = Object.create(null);
    for (var n = 0; n < nodes.length; n++) {
      var u = nodes[n], nb = Object.keys(out[u]);
      for (var j = 0; j < nb.length; j++) {
        var v = nb[j];
        if (u === v) { total++; continue; }
        var key = u < v ? u + "\u0000" + v : v + "\u0000" + u;
        if (!counted[key]) { counted[key] = true; total++; }
      }
    }
    return total;
  }

  function fromText(text, opts) { return buildGraph(parseLinks(text), opts); }

  // ===========================================================================
  // 3. Neighbour helpers
  // ===========================================================================
  function outNeighbours(g, node) {
    return g._out[node] ? Object.keys(g._out[node]).sort(naturalCompare) : [];
  }
  function bothNeighbours(g, node) {
    var set = Object.create(null);
    if (g._out[node]) { Object.keys(g._out[node]).forEach(function (k) { set[k] = true; }); }
    if (g._in[node]) { Object.keys(g._in[node]).forEach(function (k) { set[k] = true; }); }
    return Object.keys(set);
  }
  function degree(g, node) {
    if (g.directed) {
      var o = g._out[node] ? Object.keys(g._out[node]).length : 0;
      var i = g._in[node] ? Object.keys(g._in[node]).length : 0;
      return o + i;
    }
    if (!g._out[node]) { return 0; }
    var d = 0, nb = Object.keys(g._out[node]);
    for (var k = 0; k < nb.length; k++) { d += (nb[k] === node) ? 2 : 1; }
    return d;
  }

  // ===========================================================================
  // 4. Connected components (weak — arrows ignored), via a flood fill
  // ===========================================================================
  // Returns an array of components, each a naturally-sorted node list, the array
  // sorted by first member — a canonical form. For a directed graph these are
  // the *weakly* connected components.
  function components(g) {
    var seen = Object.create(null), comps = [];
    for (var i = 0; i < g.nodes.length; i++) {
      var start = g.nodes[i];
      if (seen[start]) { continue; }
      var stack = [start], group = [];
      seen[start] = true;
      while (stack.length) {
        var u = stack.pop();
        group.push(u);
        var nb = bothNeighbours(g, u);
        for (var j = 0; j < nb.length; j++) {
          if (!seen[nb[j]]) { seen[nb[j]] = true; stack.push(nb[j]); }
        }
      }
      comps.push(group.sort(naturalCompare));
    }
    comps.sort(function (a, b) { return naturalCompare(a[0], b[0]); });
    return comps;
  }

  // The headline predicate. An empty graph (no nodes) is vacuously connected;
  // this matches the flood-fill (zero components ⇒ connected). For a directed
  // graph this is WEAK connectivity — see isStronglyConnected for the stricter
  // sense.
  function isConnected(g) { return components(g).length <= 1; }

  // ===========================================================================
  // 5. Reachability (a BFS the UI animates)
  // ===========================================================================
  // Directed follows out-edges; undirected follows all neighbours. Returns the
  // visit order and hop distances from `start`.
  function bfs(g, start) {
    var order = [], dist = Object.create(null);
    if (!(start in g._out)) { return { order: order, dist: dist }; }
    var queue = [start]; dist[start] = 0;
    for (var head = 0; head < queue.length; head++) {
      var u = queue[head];
      order.push(u);
      var nb = (g.directed ? Object.keys(g._out[u]) : bothNeighbours(g, u)).sort(naturalCompare);
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i];
        if (!(v in dist)) { dist[v] = dist[u] + 1; queue.push(v); }
      }
    }
    return { order: order, dist: dist };
  }
  function reachable(g, start) { return bfs(g, start).order; }

  // ===========================================================================
  // 6. Articulation points & bridges (undirected) — Tarjan's low-link DFS
  // ===========================================================================
  // One DFS computes, for each node, its discovery time `disc` and `low` — the
  // earliest discovery time reachable from its DFS subtree using at most one
  // back edge. A NON-root node u is an articulation point if it has a DFS child
  // v with low[v] >= disc[u] (v's subtree can't escape above u without passing
  // through u). The DFS ROOT is an articulation point iff it has two or more DFS
  // children. An edge (u,v) is a bridge if low[v] > disc[u] — but only when there
  // is a SINGLE link between them; a parallel link gives an alternate route, so a
  // doubled edge is never a bridge. We honour real multiplicity via g._mult.
  //
  // Written recursively — the clean, textbook form. The graphs here are typed by
  // hand, so recursion depth is a non-issue, and clarity buys correctness that
  // the brute-force oracle in the tests independently confirms.
  function articulationAndBridges(g) {
    if (g.directed) { return { articulationPoints: [], bridges: [] }; }
    var disc = Object.create(null), low = Object.create(null);
    var timer = { t: 0 };
    var apSet = Object.create(null);
    var bridges = [];

    // Simple adjacency (self-loops dropped — they change neither answer).
    var adj = Object.create(null);
    g.nodes.forEach(function (u) {
      adj[u] = bothNeighbours(g, u).filter(function (v) { return v !== u; }).sort(naturalCompare);
    });

    function dfs(u, parent) {
      disc[u] = low[u] = timer.t++;
      var children = 0;
      var skippedParent = false;      // ignore the tree edge back to parent — once
      var nb = adj[u];
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i];
        if (!(v in disc)) {
          children++;
          dfs(v, u);
          if (low[v] < low[u]) { low[u] = low[v]; }
          // non-root articulation rule
          if (parent !== null && low[v] >= disc[u]) { apSet[u] = true; }
          // bridge: v's subtree cannot reach u or anything above it, and there
          // is only one link across (a parallel link would be an escape route).
          var pk = u < v ? u + "\u0000" + v : v + "\u0000" + u;
          if (low[v] > disc[u] && (g._mult[pk] || 1) === 1) {
            bridges.push(u < v ? [u, v] : [v, u]);
          }
        } else if (v === parent && !skippedParent) {
          skippedParent = true;       // first sight of parent is the tree edge; skip it
        } else {
          // a back edge (or the parent seen a *second* time, i.e. a real parallel
          // route, which correctly lowers low[u])
          if (disc[v] < low[u]) { low[u] = disc[v]; }
        }
      }
      // root articulation rule
      if (parent === null && children >= 2) { apSet[u] = true; }
    }

    g.nodes.forEach(function (root) {
      if (!(root in disc)) { dfs(root, null); }
    });

    var aps = Object.keys(apSet).sort(naturalCompare);
    bridges.sort(function (a, b) {
      return naturalCompare(a[0], b[0]) || naturalCompare(a[1], b[1]);
    });
    return { articulationPoints: aps, bridges: bridges };
  }

  // ===========================================================================
  // 7. Strongly connected components (directed) — Tarjan's SCC, iterative
  // ===========================================================================
  // Classic Tarjan: one DFS, index/low-link per node, a stack of the current
  // path; when a node's low-link equals its own index it is the root of an SCC
  // and we pop the stack down to it. Linear time, O(V + E).
  function stronglyConnectedComponents(g) {
    if (!g.directed) {
      // For an undirected graph, SCC == weak components.
      return components(g).map(function (c) { return c.slice(); });
    }
    var index = Object.create(null), low = Object.create(null);
    var onStack = Object.create(null), idx = 0;
    var S = [], sccs = [];

    var adj = Object.create(null);
    g.nodes.forEach(function (u) { adj[u] = Object.keys(g._out[u]).sort(naturalCompare); });

    g.nodes.forEach(function (root) {
      if (root in index) { return; }
      var work = [{ u: root, i: 0 }];
      index[root] = low[root] = idx++; S.push(root); onStack[root] = true;
      while (work.length) {
        var fr = work[work.length - 1];
        var u = fr.u, nb = adj[u];
        if (fr.i < nb.length) {
          var v = nb[fr.i++];
          if (v === u) { continue; }           // self-loop irrelevant to SCC grouping
          if (!(v in index)) {
            index[v] = low[v] = idx++; S.push(v); onStack[v] = true;
            work.push({ u: v, i: 0 });
          } else if (onStack[v]) {
            if (index[v] < low[u]) { low[u] = index[v]; }
          }
        } else {
          work.pop();
          if (work.length) {
            var p = work[work.length - 1].u;
            if (low[u] < low[p]) { low[p] = low[u]; }
          }
          if (low[u] === index[u]) {
            var comp = [], w;
            do { w = S.pop(); onStack[w] = false; comp.push(w); } while (w !== u);
            sccs.push(comp.sort(naturalCompare));
          }
        }
      }
    });
    sccs.sort(function (a, b) { return naturalCompare(a[0], b[0]); });
    return sccs;
  }

  function isStronglyConnected(g) {
    if (g.nodes.length <= 1) { return true; }       // 0 or 1 node: vacuously strong
    if (!g.directed) { return isConnected(g); }
    return stronglyConnectedComponents(g).length === 1;
  }

  // ===========================================================================
  // 8. One-shot connectivity verdict
  // ===========================================================================
  function analyze(g) {
    var comps = components(g);
    var n = g.nodes.length;
    var isolated = g.nodes.filter(function (nd) { return degree(g, nd) === 0; });
    var out = {
      directed: g.directed,
      nodeCount: n,
      edgeCount: g.edgeCount,
      selfLoops: g.selfLoops,
      duplicates: g.duplicates,
      componentCount: comps.length,
      components: comps,
      connected: comps.length <= 1,           // weak for directed
      isolated: isolated,
      isolatedCount: isolated.length
    };
    if (g.directed) {
      var sccs = stronglyConnectedComponents(g);
      out.sccs = sccs;
      out.sccCount = sccs.length;
      out.weaklyConnected = out.connected;
      out.stronglyConnected = isStronglyConnected(g);
    } else {
      var ab = articulationAndBridges(g);
      out.articulationPoints = ab.articulationPoints;
      out.bridges = ab.bridges;
      out.biconnected = out.connected && n >= 3 && ab.articulationPoints.length === 0;
      out.twoEdgeConnected = out.connected && ab.bridges.length === 0;
    }
    return out;
  }

  // ===========================================================================
  // 9. Independent verifiers (also the tests' oracles)
  // ===========================================================================
  // Connectivity by flood fill from the first node — a second, simpler route to
  // the same yes/no that components() gives.
  function verifyConnectedByFlood(g) {
    if (g.nodes.length === 0) { return true; }
    var start = g.nodes[0], seen = Object.create(null), stack = [start], count = 0;
    seen[start] = true;
    while (stack.length) {
      var u = stack.pop(); count++;
      bothNeighbours(g, u).forEach(function (v) {
        if (!seen[v]) { seen[v] = true; stack.push(v); }
      });
    }
    return count === g.nodes.length;
  }

  // Brute-force articulation points: v is a cut vertex iff deleting it (and its
  // incident edges) leaves MORE connected pieces than the whole graph had. So we
  // compare the component count among the remaining nodes to the component count
  // of the full graph. Deleting an isolated node lowers the count (never an AP);
  // deleting a leaf leaves the count unchanged (never an AP); deleting a genuine
  // cut vertex raises it. O(V·(V+E)); the oracle, not the shipped path.
  function bruteArticulationPoints(g) {
    var base = componentsAmong(g, g.nodes);
    var aps = [];
    for (var i = 0; i < g.nodes.length; i++) {
      var removed = g.nodes[i];
      var rest = g.nodes.filter(function (x) { return x !== removed; });
      if (rest.length === 0) { continue; }
      if (componentsAmong(g, rest) > base) { aps.push(removed); }
    }
    return aps.sort(naturalCompare);
  }

  // Count components among a given node subset (undirected, arrows ignored).
  function componentsAmong(g, subset) {
    var inSet = Object.create(null);
    subset.forEach(function (n) { inSet[n] = true; });
    var seen = Object.create(null), count = 0;
    for (var i = 0; i < subset.length; i++) {
      var s = subset[i];
      if (seen[s]) { continue; }
      count++;
      var stack = [s]; seen[s] = true;
      while (stack.length) {
        var u = stack.pop();
        bothNeighbours(g, u).forEach(function (v) {
          if (inSet[v] && !seen[v]) { seen[v] = true; stack.push(v); }
        });
      }
    }
    return count;
  }

  // Brute-force bridges: for each undirected edge present once, remove it and see
  // whether its endpoints fall into different components. Honours multiplicity
  // (a doubled edge is never a bridge).
  function bruteBridges(g) {
    var edges = distinctUndirectedEdges(g);
    var bridges = [];
    for (var i = 0; i < edges.length; i++) {
      var a = edges[i][0], b = edges[i][1];
      if (a === b) { continue; }                      // self-loop is never a bridge
      var pk = a < b ? a + "\u0000" + b : b + "\u0000" + a;
      if ((g._mult[pk] || 1) > 1) { continue; }       // parallel edge — alternate route exists
      if (!connectedWithoutEdge(g, a, b)) { bridges.push(a < b ? [a, b] : [b, a]); }
    }
    bridges.sort(function (x, y) { return naturalCompare(x[0], y[0]) || naturalCompare(x[1], y[1]); });
    return bridges;
  }

  function distinctUndirectedEdges(g) {
    var seen = Object.create(null), out = [];
    g.nodes.forEach(function (u) {
      bothNeighbours(g, u).forEach(function (v) {
        var key = u < v ? u + "\u0000" + v : v + "\u0000" + u;
        if (u === v) { key = u + "\u0000" + u; }
        if (!seen[key]) { seen[key] = true; out.push(u < v ? [u, v] : [v, u]); }
      });
    });
    return out;
  }

  // Are a and b still in the same component if we ignore the direct edge between
  // them? (Used only by the bridge oracle.)
  function connectedWithoutEdge(g, a, b) {
    var seen = Object.create(null), stack = [a]; seen[a] = true;
    while (stack.length) {
      var u = stack.pop();
      var nb = bothNeighbours(g, u);
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i];
        if ((u === a && v === b) || (u === b && v === a)) { continue; } // skip the one edge
        if (!seen[v]) { seen[v] = true; stack.push(v); }
      }
    }
    return !!seen[b];
  }

  // Brute-force SCCs: group nodes by mutual reachability (u~v iff u can reach v
  // AND v can reach u), each direction by its own BFS. O(V·(V+E)). The oracle.
  function bruteSCCs(g) {
    function reaches(src) {
      var seen = Object.create(null), stack = [src]; seen[src] = true;
      while (stack.length) {
        var u = stack.pop();
        Object.keys(g._out[u]).forEach(function (v) { if (!seen[v]) { seen[v] = true; stack.push(v); } });
      }
      return seen;
    }
    var reach = Object.create(null);
    g.nodes.forEach(function (n) { reach[n] = reaches(n); });

    var placed = Object.create(null), comps = [];
    g.nodes.forEach(function (u) {
      if (placed[u]) { return; }
      var comp = [u]; placed[u] = true;
      g.nodes.forEach(function (v) {
        if (v === u || placed[v]) { return; }
        if (reach[u][v] && reach[v][u]) { comp.push(v); placed[v] = true; }
      });
      comps.push(comp.sort(naturalCompare));
    });
    comps.sort(function (a, b) { return naturalCompare(a[0], b[0]); });
    return comps;
  }

  // ===========================================================================
  // 10. Deterministic force-directed layout (Fruchterman–Reingold, seeded)
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
    var W = opts.width || 800, H = opts.height || 600;
    var iterations = opts.iterations || 300;
    var rnd = mulberry32(opts.seed == null ? 1 : (opts.seed | 0));
    var nodes = g.nodes, n = nodes.length, pos = Object.create(null);
    if (n === 0) { return pos; }
    if (n === 1) { pos[nodes[0]] = { x: W / 2, y: H / 2 }; return pos; }

    for (var i = 0; i < n; i++) { pos[nodes[i]] = { x: rnd() * W, y: rnd() * H }; }

    var k = Math.sqrt((W * H) / n);
    var t = Math.min(W, H) * 0.1, cool = t / (iterations + 1);

    var edgeList = [], emitted = Object.create(null);
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
    outNeighbours: outNeighbours,
    bothNeighbours: bothNeighbours,
    degree: degree,
    components: components,
    isConnected: isConnected,
    bfs: bfs,
    reachable: reachable,
    articulationAndBridges: articulationAndBridges,
    stronglyConnectedComponents: stronglyConnectedComponents,
    isStronglyConnected: isStronglyConnected,
    analyze: analyze,
    // verifiers / oracles
    verifyConnectedByFlood: verifyConnectedByFlood,
    bruteArticulationPoints: bruteArticulationPoints,
    bruteBridges: bruteBridges,
    bruteSCCs: bruteSCCs,
    componentsAmong: componentsAmong,
    // layout + util
    layout: layout,
    naturalCompare: naturalCompare
  };
});
