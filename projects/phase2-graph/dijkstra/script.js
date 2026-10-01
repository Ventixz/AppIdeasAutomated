/*
 * script.js — the DOM controller for the Dijkstra workbench.
 *
 * It owns no algorithm: parsing, the shortest-path search, path reconstruction
 * and every verifier live in dijkstra-core.js (DijkstraCore). This file reads
 * the textarea, lays the graph out, draws the weighted network, paints the
 * shortest-path tree and the chosen source→target path, fills the distance
 * table, and animates Dijkstra settling nodes one at a time.
 */
(function () {
  "use strict";
  var D = window.DijkstraCore;

  var $ = function (id) { return document.getElementById(id); };
  var svg = $("canvas"), SVGNS = "http://www.w3.org/2000/svg";
  var VB_W = 800, VB_H = 560, PAD = 34;

  var els = {
    links: $("links"), directed: $("directed"), build: $("build"),
    warnings: $("warnings"), source: $("source"), target: $("target"),
    examples: $("examples"), verdict: $("verdict"), stats: $("stats"),
    distTable: $("distTable"), findings: $("findings"), verify: $("verify"),
    run: $("run"), relayout: $("relayout"), iters: $("iters")
  };

  // ---- state -------------------------------------------------------------
  var state = {
    graph: null, result: null, pos: null, seed: 1,
    source: null, target: null, animTimer: null, settledUpTo: Infinity
  };

  // ---- examples ----------------------------------------------------------
  var EXAMPLES = [
    {
      name: "CLRS classic", directed: true, source: "s", target: "x",
      text: [
        "# The textbook single-source example (Cormen et al.).",
        "s -> t : 10", "s -> y : 5",
        "t -> y : 2", "t -> x : 1",
        "y -> t : 3", "y -> x : 9", "y -> z : 2",
        "x -> z : 4",
        "z -> x : 6", "z -> s : 7"
      ].join("\n")
    },
    {
      name: "Long way is cheaper", directed: true, source: "a", target: "c",
      text: [
        "# The direct road a->c costs 10, but a->b->c costs only 3.",
        "a -> b : 1", "b -> c : 2", "a -> c : 10"
      ].join("\n")
    },
    {
      name: "Road map (undirected)", directed: false, source: "home", target: "work",
      text: [
        "home -- park : 4", "home -- shop : 2",
        "shop -- park : 1", "shop -- gym : 5",
        "park -- work : 3", "gym -- work : 2"
      ].join("\n")
    },
    {
      name: "Unreachable island", directed: true, source: "a", target: "z",
      text: [
        "a -> b : 3", "b -> c : 1", "a -> c : 7",
        "# y and z are their own island — no road leads in.",
        "y -> z : 2"
      ].join("\n")
    },
    {
      name: "Parallel roads", directed: true, source: "a", target: "c",
      text: [
        "# Two roads a->b; the cheaper (3) is the one taken.",
        "a -> b : 9", "a -> b : 3", "b -> c : 4"
      ].join("\n")
    },
    {
      name: "Grid", directed: false, source: "n0", target: "n8",
      text: gridExample()
    }
  ];

  function gridExample() {
    // a 3x3 lattice with varied weights
    var lines = ["# A 3x3 grid — many routes, one cheapest."];
    var w = [[2, 5, 1, 3, 2, 4, 1, 2, 3, 2, 1, 4]];
    var idx = 0, ws = [2, 5, 1, 3, 2, 4, 1, 2, 3, 2, 1, 4];
    function name(r, c) { return "n" + (r * 3 + c); }
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        if (c < 2) { lines.push(name(r, c) + " -- " + name(r, c + 1) + " : " + ws[idx++ % ws.length]); }
        if (r < 2) { lines.push(name(r, c) + " -- " + name(r + 1, c) + " : " + ws[idx++ % ws.length]); }
      }
    }
    void w;
    return lines.join("\n");
  }

  function buildExampleButtons() {
    EXAMPLES.forEach(function (ex) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = ex.name;
      b.addEventListener("click", function () {
        els.links.value = ex.text;
        els.directed.checked = ex.directed;
        state.seed = (state.seed % 9999) + 7;
        rebuild({ preferSource: ex.source, preferTarget: ex.target });
      });
      els.examples.appendChild(b);
    });
  }

  // ---- number formatting -------------------------------------------------
  function fmt(n) {
    if (n === Infinity) { return "∞"; }
    if (Math.abs(n - Math.round(n)) < 1e-9) { return String(Math.round(n)); }
    return String(Math.round(n * 1000) / 1000);
  }

  // ---- rebuild everything from the textarea ------------------------------
  function rebuild(opts) {
    opts = opts || {};
    stopAnim();
    var parsed = D.parseLinks(els.links.value);
    var g = D.buildGraph(parsed, { directed: els.directed.checked });
    state.graph = g;

    // warnings
    var warn = g.warnings.slice();
    if (g.anyNegative) {
      warn.push("negative weight present — Dijkstra's guarantee needs weights ≥ 0 (distances shown are still checked against Bellman–Ford).");
    }
    els.warnings.textContent = warn.join("  •  ");

    // populate source/target selects
    fillNodeSelect(els.source, g.nodes, opts.preferSource != null ? opts.preferSource : state.source);
    state.source = els.source.value || (g.nodes.length ? g.nodes[0] : null);

    fillNodeSelect(els.target, g.nodes, opts.preferTarget != null ? opts.preferTarget : state.target, true);
    state.target = els.target.value || "";

    state.pos = D.layout(g, { seed: state.seed, iterations: +els.iters.value, width: VB_W, height: VB_H });
    recompute();
  }

  function fillNodeSelect(sel, nodes, prefer, allowNone) {
    var prev = prefer;
    sel.innerHTML = "";
    if (allowNone) {
      var o0 = document.createElement("option");
      o0.value = ""; o0.textContent = "— none —";
      sel.appendChild(o0);
    }
    nodes.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
    if (prev != null && nodes.indexOf(prev) >= 0) { sel.value = prev; }
    else if (!allowNone && nodes.length) { sel.value = nodes[0]; }
    else { sel.value = ""; }
  }

  // ---- recompute shortest paths (source/target changed, graph same) ------
  function recompute() {
    var g = state.graph;
    if (!g || g.nodes.length === 0) {
      state.result = null;
      draw(); renderVerdict(); renderStats(); renderTable(); renderVerify();
      return;
    }
    state.source = els.source.value || g.nodes[0];
    state.target = els.target.value || "";
    state.result = D.dijkstra(g, state.source);
    state.settledUpTo = Infinity; // show the finished result
    draw(); renderVerdict(); renderStats(); renderTable(); renderVerify();
  }

  // ---- geometry helpers --------------------------------------------------
  function scaled() {
    // map layout coords (0..VB) into a padded box
    var g = state.graph, pos = state.pos, out = Object.create(null);
    if (!g) { return out; }
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    g.nodes.forEach(function (n) {
      var p = pos[n]; if (!p) { return; }
      if (p.x < minx) { minx = p.x; } if (p.x > maxx) { maxx = p.x; }
      if (p.y < miny) { miny = p.y; } if (p.y > maxy) { maxy = p.y; }
    });
    var w = Math.max(1, maxx - minx), h = Math.max(1, maxy - miny);
    g.nodes.forEach(function (n) {
      var p = pos[n]; if (!p) { out[n] = { x: VB_W / 2, y: VB_H / 2 }; return; }
      out[n] = {
        x: PAD + (p.x - minx) / w * (VB_W - 2 * PAD),
        y: PAD + (p.y - miny) / h * (VB_H - 2 * PAD)
      };
    });
    return out;
  }

  function el(name, attrs, cls) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) { for (var k in attrs) { e.setAttribute(k, attrs[k]); } }
    if (cls) { e.setAttribute("class", cls); }
    return e;
  }

  // ---- draw the network --------------------------------------------------
  function draw() {
    while (svg.firstChild) { svg.removeChild(svg.firstChild); }
    var g = state.graph;
    if (!g || g.nodes.length === 0) {
      var t = el("text", { x: VB_W / 2, y: VB_H / 2, "text-anchor": "middle", fill: "#97a2ba" });
      t.textContent = "Add some weighted links to begin.";
      svg.appendChild(t); return;
    }
    var P = scaled();
    var directed = g.directed;
    var result = state.result;

    // which nodes are settled at the current animation frame
    var settledSet = Object.create(null), frontierSet = Object.create(null), distNow = Object.create(null);
    if (result) {
      for (var i = 0; i < result.order.length; i++) {
        var o = result.order[i];
        if (o.dist <= state.settledUpTo + 1e-9) { settledSet[o.node] = true; }
      }
      // frontier = neighbours of settled, not yet settled, with finite tentative dist
      // (for the live animation we recompute tentative distances up to the frontier)
      distNow = tentativeAt(state.settledUpTo);
      g.nodes.forEach(function (n) {
        if (!settledSet[n] && distNow[n] !== Infinity && distNow[n] != null) { frontierSet[n] = true; }
      });
    }

    // the tree edges & the chosen path edges
    var treeSet = Object.create(null), pathSet = Object.create(null), pathNodes = Object.create(null);
    if (result) {
      D.treeEdges(result).forEach(function (pair) { treeSet[pair[0] + "\u0000" + pair[1]] = true; });
      if (state.target) {
        var pc = D.pathTo(result, state.target);
        for (var k = 0; k + 1 < pc.path.length; k++) {
          pathSet[pc.path[k] + "\u0000" + pc.path[k + 1]] = true;
          pathNodes[pc.path[k]] = true;
        }
        pc.path.forEach(function (n) { pathNodes[n] = true; });
      }
    }

    // arrow marker defs
    var defs = el("defs");
    [["arrow", "var(--edge-col)"], ["arrow-tree", "var(--tree)"], ["arrow-path", "var(--path)"]].forEach(function (a) {
      var m = el("marker", { id: a[0], viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
      var path = el("path", { d: "M0,0 L10,5 L0,10 z", fill: a[1] });
      m.appendChild(path); defs.appendChild(m);
    });
    svg.appendChild(defs);

    // edges (draw once per directed edge; undirected pairs drawn once)
    var drawnUndirected = Object.create(null);
    var edgeLayer = el("g"), labelLayer = el("g");
    g.nodes.forEach(function (u) {
      (g.adj[u] || []).forEach(function (e) {
        var v = e.to;
        if (!directed) {
          var key = u < v ? u + "\u0000" + v : v + "\u0000" + u;
          if (drawnUndirected[key]) { return; }
          drawnUndirected[key] = true;
        }
        var a = P[u], b = P[v];
        if (!a || !b) { return; }
        var fwd = u + "\u0000" + v, rev = v + "\u0000" + u;
        var onPath = pathSet[fwd] || (!directed && pathSet[rev]);
        var onTree = treeSet[fwd] || (!directed && treeSet[rev]);

        // shorten the segment so the arrowhead sits off the node
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / len, uy = dy / len, R = 15;
        var x1 = a.x + ux * R, y1 = a.y + uy * R, x2 = b.x - ux * R, y2 = b.y - uy * R;

        var cls = "edge";
        if (onPath) { cls += " path"; }
        else if (onTree) { cls += " tree"; }
        else if (state.target || result) { cls += " dim"; }
        var line = el("line", { x1: x1, y1: y1, x2: x2, y2: y2 }, cls);
        if (directed) { line.setAttribute("marker-end", "url(#" + (onPath ? "arrow-path" : onTree ? "arrow-tree" : "arrow") + ")"); }
        edgeLayer.appendChild(line);

        // weight label at the midpoint
        var lbl = el("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 3 }, "wlabel" + (onPath ? " on-path" : ""));
        lbl.textContent = fmt(e.w);
        labelLayer.appendChild(lbl);
      });
    });
    svg.appendChild(edgeLayer);
    svg.appendChild(labelLayer);

    // nodes
    var nodeLayer = el("g");
    g.nodes.forEach(function (n) {
      var p = P[n];
      var cls = "node";
      if (n === state.source) { cls += " source"; }
      else if (pathNodes[n]) { cls += " onpath"; }
      else if (settledSet[n]) { cls += " settled"; }
      else if (frontierSet[n]) { cls += " frontier"; }
      else { cls += " dim"; }
      if (n === state.target) { cls += " target"; }

      var gNode = el("g", null, cls);
      var c = el("circle", { cx: p.x, cy: p.y, r: 13 });
      gNode.appendChild(c);

      // distance label inside the node (if known at this frame)
      var dv = result ? (state.settledUpTo === Infinity ? result.dist[n] : distNow[n]) : undefined;
      if (dv != null && dv !== Infinity) {
        var dlabel = el("text", { x: p.x, y: p.y + 3 }, "dlabel");
        dlabel.textContent = fmt(dv);
        gNode.appendChild(dlabel);
      }
      // name above
      var nm = el("text", { x: p.x, y: p.y - 18 }, "name");
      nm.textContent = n;
      gNode.appendChild(nm);

      gNode.addEventListener("click", function () {
        els.target.value = (state.target === n) ? "" : n;
        recompute();
      });
      nodeLayer.appendChild(gNode);
    });
    svg.appendChild(nodeLayer);
  }

  // Recompute tentative distances as Dijkstra would have them when every node
  // with final distance ≤ `upTo` has been settled. Used by the animation to
  // show the frontier lighting up ahead of the settled region.
  function tentativeAt(upTo) {
    var g = state.graph, result = state.result, dist = Object.create(null);
    g.nodes.forEach(function (n) { dist[n] = Infinity; });
    if (!result) { return dist; }
    if (upTo === Infinity) { return result.dist; }
    dist[result.source] = 0;
    for (var i = 0; i < result.order.length; i++) {
      var u = result.order[i].node, du = result.order[i].dist;
      if (du > upTo + 1e-9) { break; }
      dist[u] = du;
      (g.adj[u] || []).forEach(function (e) {
        var nd = du + e.w;
        if (nd < dist[e.to]) { dist[e.to] = nd; }
      });
    }
    return dist;
  }

  // ---- verdict banner ----------------------------------------------------
  function renderVerdict() {
    var v = els.verdict; v.innerHTML = "";
    var g = state.graph, result = state.result;
    if (!g || g.nodes.length === 0 || !result) { return; }

    function span(cls, txt) { var s = document.createElement("span"); s.className = cls; s.innerHTML = txt; return s; }

    if (!state.target) {
      v.appendChild(span("sub", "Shortest paths from <strong>" + esc(state.source) + "</strong> to all " + g.nodes.length + " node" + (g.nodes.length === 1 ? "" : "s") + ". Pick a <strong>To</strong> node (or click one) for a single route."));
      return;
    }
    var pc = D.pathTo(result, state.target);
    if (pc.cost === Infinity) {
      v.appendChild(span("big bad", "Unreachable"));
      v.appendChild(span("sub", "No path leads from <strong>" + esc(state.source) + "</strong> to <strong>" + esc(state.target) + "</strong>" + (g.directed ? " following the arrows" : "") + "."));
      return;
    }
    v.appendChild(span("big good", fmt(pc.cost)));
    v.appendChild(span("sub", "is the cheapest cost from <strong>" + esc(state.source) + "</strong> to <strong>" + esc(state.target) + "</strong>, via"));
    v.appendChild(span("route", pc.path.join(" → ")));
  }

  // ---- stats -------------------------------------------------------------
  function renderStats() {
    var s = els.stats; s.innerHTML = "";
    var g = state.graph, result = state.result;
    if (!g) { return; }
    function stat(k, val, cls) {
      var d = document.createElement("div"); d.className = "stat";
      var kk = document.createElement("div"); kk.className = "k"; kk.textContent = k;
      var vv = document.createElement("div"); vv.className = "v" + (cls ? " " + cls : ""); vv.textContent = val;
      d.appendChild(kk); d.appendChild(vv); return d;
    }
    var reached = 0, far = 0;
    if (result) { g.nodes.forEach(function (n) { var d = result.dist[n]; if (d !== Infinity) { reached++; if (d > far) { far = d; } } }); }
    s.appendChild(stat("Nodes", String(g.nodes.length)));
    s.appendChild(stat("Edges", String(g.edgeCount)));
    s.appendChild(stat("Reachable", reached + " / " + g.nodes.length, reached === g.nodes.length ? "good" : "warn"));
    s.appendChild(stat("Farthest cost", fmt(far)));
  }

  // ---- distance table ----------------------------------------------------
  function renderTable() {
    var t = els.distTable; t.innerHTML = "";
    var g = state.graph, result = state.result;
    if (!g || g.nodes.length === 0 || !result) { return; }
    var head = document.createElement("tr");
    ["Node", "Distance", "Shortest path"].forEach(function (h, i) {
      var th = document.createElement("th"); th.textContent = h;
      if (i === 1) { th.style.textAlign = "right"; }
      head.appendChild(th);
    });
    t.appendChild(head);
    g.nodes.forEach(function (n) {
      var pc = D.pathTo(result, n);
      var tr = document.createElement("tr");
      if (n === state.source) { tr.className = "is-source"; }
      else if (n === state.target) { tr.className = "is-target"; }
      else if (pc.cost === Infinity) { tr.className = "unreached"; }
      var td0 = document.createElement("td"); td0.textContent = n;
      var td1 = document.createElement("td"); td1.className = "num"; td1.textContent = fmt(pc.cost);
      var td2 = document.createElement("td"); td2.className = "route"; td2.textContent = pc.path.length ? pc.path.join(" → ") : (n === state.source ? n : "—");
      tr.appendChild(td0); tr.appendChild(td1); tr.appendChild(td2);
      tr.addEventListener("click", function () { els.target.value = (state.target === n ? "" : n); recompute(); });
      t.appendChild(tr);
    });
  }

  // ---- the "✓ Verified" line --------------------------------------------
  function renderVerify() {
    var vEl = els.verify; vEl.className = "verify"; vEl.textContent = "";
    var g = state.graph, result = state.result;
    if (!g || g.nodes.length === 0 || !result) { return; }

    // 1. Dijkstra distances vs Bellman–Ford
    var bf = D.bellmanFord(g, state.source), bad = [];
    g.nodes.forEach(function (n) {
      var a = result.dist[n], b = bf[n];
      if (a === Infinity || b === Infinity) { if (a !== b) { bad.push(n); } }
      else if (Math.abs(a - b) > 1e-9) { bad.push(n); }
    });
    // 2. no edge is relaxable (optimality proof)
    var relax = D.firstRelaxableEdge(g, result.dist);
    // 3. every reconstructed path re-walks to its cost
    var pathBad = null;
    for (var i = 0; i < g.nodes.length; i++) {
      var vp = D.verifyPath(g, result, g.nodes[i]);
      if (!vp.ok) { pathBad = g.nodes[i]; break; }
    }

    if (bad.length === 0 && !relax && !pathBad) {
      vEl.textContent = "✓ Verified — distances match Bellman–Ford, no edge can be relaxed (so the labelling is provably optimal), and every path re-walks to its stated cost.";
    } else {
      vEl.className = "verify bad";
      var msg = "⚠ Verification mismatch:";
      if (bad.length) { msg += " distances differ from Bellman–Ford at " + bad.join(", ") + ";"; }
      if (relax) { msg += " edge " + relax.from + "→" + relax.to + " is still relaxable;"; }
      if (pathBad) { msg += " path to " + pathBad + " did not re-walk;"; }
      vEl.textContent = msg;
    }
  }

  // ---- animation: watch Dijkstra settle ---------------------------------
  function stopAnim() {
    if (state.animTimer) { clearInterval(state.animTimer); state.animTimer = null; }
    els.run.textContent = "Watch it settle ▸";
    els.run.disabled = false;
  }

  function runAnimation() {
    var result = state.result;
    if (!result || result.order.length === 0) { return; }
    stopAnim();
    // step through the settle order; between steps show the frontier
    var steps = result.order.map(function (o) { return o.dist; });
    var idx = -1;
    els.run.textContent = "Settling…"; els.run.disabled = true;
    state.animTimer = setInterval(function () {
      idx++;
      if (idx >= steps.length) {
        state.settledUpTo = Infinity;
        draw();
        stopAnim();
        return;
      }
      state.settledUpTo = steps[idx];
      draw();
    }, 650);
    // kick off immediately with the source settled
    state.settledUpTo = -1; draw();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  // ---- wiring ------------------------------------------------------------
  els.build.addEventListener("click", function () { state.seed = (state.seed % 9999) + 1; rebuild({}); });
  els.links.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); rebuild({}); }
  });
  els.directed.addEventListener("change", function () { rebuild({}); });
  els.source.addEventListener("change", function () { stopAnim(); recompute(); });
  els.target.addEventListener("change", function () { stopAnim(); recompute(); });
  els.relayout.addEventListener("click", function () {
    stopAnim();
    state.seed = (state.seed % 9999) + 17;
    state.pos = D.layout(state.graph, { seed: state.seed, iterations: +els.iters.value, width: VB_W, height: VB_H });
    draw();
  });
  els.iters.addEventListener("change", function () {
    stopAnim();
    state.pos = D.layout(state.graph, { seed: state.seed, iterations: +els.iters.value, width: VB_W, height: VB_H });
    draw();
  });
  els.run.addEventListener("click", function () {
    if (state.animTimer) { stopAnim(); state.settledUpTo = Infinity; draw(); }
    else { runAnimation(); }
  });

  // ---- boot --------------------------------------------------------------
  buildExampleButtons();
  els.links.value = EXAMPLES[0].text;
  els.directed.checked = EXAMPLES[0].directed;
  rebuild({ preferSource: EXAMPLES[0].source, preferTarget: EXAMPLES[0].target });
})();
