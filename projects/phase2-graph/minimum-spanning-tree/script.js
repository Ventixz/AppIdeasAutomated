/*
 * script.js — the DOM controller for the Minimum Spanning Tree workbench.
 *
 * It owns no algorithm: parsing, Kruskal's, Prim's, the spanning-forest check
 * and the cycle-property oracle all live in mst-core.js (MstCore). This file
 * reads the textarea, lays the graph out, draws the weighted network, highlights
 * the chosen tree (or forest), fills the edge table, and animates the tree being
 * built one edge at a time — Kruskal's lightest-first sweep (with rejections
 * flashing red) or Prim's grow-from-a-seed.
 */
(function () {
  "use strict";
  var M = window.MstCore;

  var $ = function (id) { return document.getElementById(id); };
  var svg = $("canvas"), SVGNS = "http://www.w3.org/2000/svg";
  var VB_W = 800, VB_H = 560, PAD = 34;

  var els = {
    links: $("links"), algo: $("algo"), build: $("build"),
    warnings: $("warnings"), start: $("start"), startRow: $("startRow"),
    examples: $("examples"), verdict: $("verdict"), stats: $("stats"),
    edgeTable: $("edgeTable"), findings: $("findings"), verify: $("verify"),
    run: $("run"), relayout: $("relayout"), iters: $("iters")
  };

  // ---- state -------------------------------------------------------------
  var state = {
    graph: null, result: null, pos: null, seed: 1,
    start: null, animTimer: null, animStep: -1
  };

  // ---- examples ----------------------------------------------------------
  var EXAMPLES = [
    {
      name: "CLRS classic (37)", start: "a",
      text: [
        "# The textbook MST example (Cormen et al.) — minimum total 37.",
        "a -- b : 4", "a -- h : 8",
        "b -- h : 11", "b -- c : 8",
        "c -- d : 7", "c -- f : 4", "c -- i : 2",
        "d -- e : 9", "d -- f : 14",
        "e -- f : 10",
        "f -- g : 2",
        "g -- h : 1", "g -- i : 6",
        "h -- i : 7"
      ].join("\n")
    },
    {
      name: "Triangle shortcut", start: "a",
      text: [
        "# A triangle: keep the two light edges, drop the heavy one.",
        "a -- b : 1", "b -- c : 2", "a -- c : 3"
      ].join("\n")
    },
    {
      name: "Square + diagonal", start: "a",
      text: [
        "# Four unit sides and a long diagonal; the diagonal is never used.",
        "a -- b : 1", "b -- c : 1", "c -- d : 1", "d -- a : 1", "a -- c : 5"
      ].join("\n")
    },
    {
      name: "Road network", start: "home",
      text: [
        "# Lay the cheapest cables that still reach every building.",
        "home -- park : 4", "home -- shop : 2",
        "shop -- park : 1", "shop -- gym : 5",
        "park -- work : 3", "gym -- work : 2",
        "work -- lab : 6", "gym -- lab : 3"
      ].join("\n")
    },
    {
      name: "Two islands (forest)", start: "a",
      text: [
        "# Disconnected: no single tree exists, so it's a minimum FOREST.",
        "a -- b : 1", "b -- c : 2", "a -- c : 5",
        "x -- y : 4", "x -- z : 3", "y -- z : 1"
      ].join("\n")
    },
    {
      name: "Grid", start: "n0",
      text: gridExample()
    }
  ];

  function gridExample() {
    var lines = ["# A 3x3 grid — many routes, one cheapest tree."];
    var ws = [2, 5, 1, 3, 2, 4, 1, 2, 3, 2, 1, 4], idx = 0;
    function name(r, c) { return "n" + (r * 3 + c); }
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        if (c < 2) { lines.push(name(r, c) + " -- " + name(r, c + 1) + " : " + ws[idx++ % ws.length]); }
        if (r < 2) { lines.push(name(r, c) + " -- " + name(r + 1, c) + " : " + ws[idx++ % ws.length]); }
      }
    }
    return lines.join("\n");
  }

  function buildExampleButtons() {
    EXAMPLES.forEach(function (ex) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = ex.name;
      b.addEventListener("click", function () {
        els.links.value = ex.text;
        state.seed = (state.seed % 9999) + 7;
        rebuild({ preferStart: ex.start });
      });
      els.examples.appendChild(b);
    });
  }

  // ---- number formatting -------------------------------------------------
  function fmt(n) {
    if (n === Infinity) { return "∞"; }
    if (n === -Infinity) { return "−∞"; }
    if (Math.abs(n - Math.round(n)) < 1e-9) { return String(Math.round(n)); }
    return String(Math.round(n * 1000) / 1000);
  }
  function canonKey(a, b) { return M.naturalCompare(a, b) > 0 ? b + "\u0000" + a : a + "\u0000" + b; }

  // ---- rebuild everything from the textarea ------------------------------
  function rebuild(opts) {
    opts = opts || {};
    stopAnim();
    var parsed = M.parseLinks(els.links.value);
    var g = M.buildGraph(parsed);
    state.graph = g;

    var warn = g.warnings.slice();
    if (g.duplicates) { warn.push(g.duplicates + " parallel link" + (g.duplicates === 1 ? "" : "s") + " collapsed to the cheaper edge."); }
    if (g.selfLoops) { warn.push(g.selfLoops + " self-loop" + (g.selfLoops === 1 ? "" : "s") + " ignored (a loop can't be in a tree)."); }
    els.warnings.textContent = warn.join("  •  ");

    fillNodeSelect(els.start, g.nodes, opts.preferStart != null ? opts.preferStart : state.start);
    state.start = els.start.value || (g.nodes.length ? g.nodes[0] : null);

    state.pos = M.layout(g, { seed: state.seed, iterations: +els.iters.value, width: VB_W, height: VB_H });
    syncStartRow();
    recompute();
  }

  function syncStartRow() {
    els.startRow.classList.toggle("hidden", els.algo.value !== "prim");
  }

  function fillNodeSelect(sel, nodes, prefer) {
    sel.innerHTML = "";
    nodes.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
    if (prefer != null && nodes.indexOf(prefer) >= 0) { sel.value = prefer; }
    else if (nodes.length) { sel.value = nodes[0]; }
  }

  // ---- recompute the MST (algorithm/start changed, graph same) -----------
  function recompute() {
    var g = state.graph;
    if (!g || g.nodes.length === 0) {
      state.result = null;
      draw(); renderVerdict(); renderStats(); renderTable(); renderVerify();
      return;
    }
    state.start = els.start.value || g.nodes[0];
    state.result = (els.algo.value === "prim") ? M.prim(g, state.start) : M.kruskal(g);
    state.animStep = -1; // show the finished tree
    draw(); renderVerdict(); renderStats(); renderTable(); renderVerify();
  }

  // The animation sequence: Kruskal exposes every considered edge (accepted or
  // rejected); Prim exposes its accepted edges in grow order.
  function animSequence() {
    var r = state.result;
    if (!r) { return []; }
    return (r.algorithm === "prim") ? (r.order || []) : (r.steps || []);
  }

  // ---- geometry helpers --------------------------------------------------
  function scaled() {
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

  // Which edges/nodes are in the tree, and (during animation) the current edge.
  function treePicture() {
    var r = state.result;
    var treeSet = Object.create(null), treeNodes = Object.create(null);
    var considerKey = null, rejectKey = null;
    if (!r) { return { treeSet: treeSet, treeNodes: treeNodes }; }

    if (state.animStep < 0) {
      // finished: all chosen edges are tree edges
      r.edges.forEach(function (e) { treeSet[canonKey(e.u, e.v)] = true; treeNodes[e.u] = true; treeNodes[e.v] = true; });
    } else {
      var seq = animSequence();
      // accepted edges up to and including animStep become tree edges
      for (var i = 0; i <= state.animStep && i < seq.length; i++) {
        var s = seq[i];
        if (s.accepted && i < state.animStep) { treeSet[canonKey(s.u, s.v)] = true; treeNodes[s.u] = true; treeNodes[s.v] = true; }
      }
      // the current step: consider (amber) or reject (red)
      var cur = seq[state.animStep];
      if (cur) {
        if (cur.accepted) { considerKey = canonKey(cur.u, cur.v); treeNodes[cur.u] = true; treeNodes[cur.v] = true; }
        else { rejectKey = canonKey(cur.u, cur.v); }
      }
    }
    return { treeSet: treeSet, treeNodes: treeNodes, considerKey: considerKey, rejectKey: rejectKey };
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
    var pic = treePicture();
    var animating = state.animStep >= 0;

    var edgeLayer = el("g"), labelLayer = el("g");
    g.edges.forEach(function (e) {
      var a = P[e.u], b = P[e.v];
      if (!a || !b) { return; }
      var key = canonKey(e.u, e.v);
      var isTree = pic.treeSet[key];
      var isConsider = pic.considerKey === key;
      var isReject = pic.rejectKey === key;

      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len, R = 15;
      var x1 = a.x + ux * R, y1 = a.y + uy * R, x2 = b.x - ux * R, y2 = b.y - uy * R;

      var cls = "edge";
      if (isConsider) { cls += " consider"; }
      else if (isReject) { cls += " reject"; }
      else if (isTree) { cls += " tree"; }
      else { cls += " drop"; }
      edgeLayer.appendChild(el("line", { x1: x1, y1: y1, x2: x2, y2: y2 }, cls));

      var lblCls = "wlabel" + (isTree || isConsider ? " on-tree" : "") + (isConsider ? " on-consider" : "");
      var lbl = el("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 3 }, lblCls);
      lbl.textContent = fmt(e.w);
      labelLayer.appendChild(lbl);
    });
    svg.appendChild(edgeLayer);
    svg.appendChild(labelLayer);

    var nodeLayer = el("g");
    g.nodes.forEach(function (n) {
      var p = P[n];
      var inTree = pic.treeNodes[n] || (!animating && (state.result && state.result.edges.length === 0));
      var cls = "node" + (inTree ? " tree" : (animating || state.result ? " dim" : ""));
      var gNode = el("g", null, cls);
      gNode.appendChild(el("circle", { cx: p.x, cy: p.y, r: 13 }));
      var nm = el("text", { x: p.x, y: p.y }, "name");
      nm.textContent = n;
      gNode.appendChild(nm);
      nodeLayer.appendChild(gNode);
    });
    svg.appendChild(nodeLayer);
  }

  // ---- verdict banner ----------------------------------------------------
  function renderVerdict() {
    var v = els.verdict; v.innerHTML = "";
    var g = state.graph, r = state.result;
    if (!g || g.nodes.length === 0 || !r) { return; }
    function span(cls, txt) { var s = document.createElement("span"); s.className = cls; s.innerHTML = txt; return s; }

    v.appendChild(span("big good", fmt(r.total)));
    if (r.isForest) {
      v.appendChild(span("sub", "is the lightest total for a minimum spanning <strong>forest</strong> — the graph splits into <strong>" + r.componentCount + "</strong> components, so no single tree can reach everything."));
      v.appendChild(span("tag", r.edges.length + " edges"));
    } else {
      v.appendChild(span("sub", "is the cheapest total weight that keeps all <strong>" + g.nodes.length + "</strong> node" + (g.nodes.length === 1 ? "" : "s") + " connected, using <strong>" + r.edges.length + "</strong> edge" + (r.edges.length === 1 ? "" : "s") + "."));
      v.appendChild(span("tag on", "connected"));
    }
    v.appendChild(span("tag", (r.algorithm === "prim" ? "Prim's" : "Kruskal's") + " algorithm"));
  }

  // ---- stats -------------------------------------------------------------
  function renderStats() {
    var s = els.stats; s.innerHTML = "";
    var g = state.graph, r = state.result;
    if (!g) { return; }
    function stat(k, val, cls) {
      var d = document.createElement("div"); d.className = "stat";
      var kk = document.createElement("div"); kk.className = "k"; kk.textContent = k;
      var vv = document.createElement("div"); vv.className = "v" + (cls ? " " + cls : ""); vv.textContent = val;
      d.appendChild(kk); d.appendChild(vv); return d;
    }
    s.appendChild(stat("Nodes", String(g.nodes.length)));
    s.appendChild(stat("Edges", String(g.edgeCount)));
    if (r) {
      s.appendChild(stat("Tree weight", fmt(r.total), "good"));
      s.appendChild(stat("Components", String(r.componentCount), r.componentCount <= 1 ? "good" : "warn"));
    }
  }

  // ---- edge table --------------------------------------------------------
  function renderTable() {
    var t = els.edgeTable; t.innerHTML = "";
    var g = state.graph, r = state.result;
    if (!g || g.edges.length === 0 || !r) { return; }
    var chosen = Object.create(null);
    r.edges.forEach(function (e) { chosen[canonKey(e.u, e.v)] = true; });

    var head = document.createElement("tr");
    ["Link", "Weight", "In tree?"].forEach(function (h, i) {
      var th = document.createElement("th"); th.textContent = h;
      if (i === 1) { th.style.textAlign = "right"; }
      head.appendChild(th);
    });
    t.appendChild(head);

    // list edges lightest-first (the order Kruskal considers them)
    M.sortedEdges(g).forEach(function (e) {
      var inTree = chosen[canonKey(e.u, e.v)];
      var tr = document.createElement("tr");
      tr.className = inTree ? "chosen" : "dropped";
      var td0 = document.createElement("td"); td0.className = "link"; td0.textContent = e.u + " — " + e.v;
      var td1 = document.createElement("td"); td1.className = "num"; td1.textContent = fmt(e.w);
      var td2 = document.createElement("td");
      var badge = document.createElement("span");
      badge.className = "badge " + (inTree ? "in" : "out");
      badge.textContent = inTree ? "✓ kept" : "dropped";
      td2.appendChild(badge);
      tr.appendChild(td0); tr.appendChild(td1); tr.appendChild(td2);
      t.appendChild(tr);
    });
  }

  // ---- the "✓ Verified" line --------------------------------------------
  function renderVerify() {
    var vEl = els.verify; vEl.className = "verify"; vEl.textContent = "";
    var g = state.graph, r = state.result;
    if (!g || g.nodes.length === 0 || !r) { return; }

    // 1. Kruskal and Prim agree on the total
    var kr = M.kruskal(g), pr = M.prim(g, state.start);
    var totalsAgree = Math.abs(kr.total - pr.total) < 1e-9;
    // 2. the result is a valid spanning forest
    var sf = M.isSpanningForest(g, r.edges);
    // 3. no cycle-property violation ⇒ provably minimal
    var viol = M.firstCyclePropertyViolation(g, r.edges);

    if (totalsAgree && sf.ok && !viol) {
      vEl.textContent = "✓ Verified — Kruskal's and Prim's totals match (" + fmt(r.total) + "), the result is a genuine spanning " +
        (r.isForest ? "forest" : "tree") + ", and no non-tree edge is lighter than the heaviest edge on the path it would close (so the tree is provably minimal).";
    } else {
      vEl.className = "verify bad";
      var msg = "⚠ Verification mismatch:";
      if (!totalsAgree) { msg += " Kruskal (" + fmt(kr.total) + ") and Prim (" + fmt(pr.total) + ") disagree;"; }
      if (!sf.ok) { msg += " not a spanning forest — " + sf.reason + ";"; }
      if (viol) { msg += " cycle property violated by " + viol.u + "–" + viol.v + " (" + viol.reason + ");"; }
      vEl.textContent = msg;
    }
  }

  // ---- animation: watch the tree build ----------------------------------
  function stopAnim() {
    if (state.animTimer) { clearInterval(state.animTimer); state.animTimer = null; }
    els.run.textContent = "Watch it build ▸";
    els.run.disabled = false;
  }

  function runAnimation() {
    var seq = animSequence();
    if (!seq.length) { return; }
    stopAnim();
    els.run.textContent = (state.result.algorithm === "prim" ? "Growing…" : "Building…");
    els.run.disabled = true;
    state.animStep = -1;
    var i = -1;
    state.animTimer = setInterval(function () {
      i++;
      if (i >= seq.length) {
        state.animStep = -1; // settle on the finished tree
        draw();
        stopAnim();
        return;
      }
      state.animStep = i;
      draw();
    }, 600);
    state.animStep = 0; draw();
  }

  // ---- wiring ------------------------------------------------------------
  els.build.addEventListener("click", function () { state.seed = (state.seed % 9999) + 1; rebuild({}); });
  els.links.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); rebuild({}); }
  });
  els.algo.addEventListener("change", function () { stopAnim(); syncStartRow(); recompute(); });
  els.start.addEventListener("change", function () { stopAnim(); recompute(); });
  els.relayout.addEventListener("click", function () {
    stopAnim();
    state.seed = (state.seed % 9999) + 17;
    state.pos = M.layout(state.graph, { seed: state.seed, iterations: +els.iters.value, width: VB_W, height: VB_H });
    draw();
  });
  els.iters.addEventListener("change", function () {
    stopAnim();
    state.pos = M.layout(state.graph, { seed: state.seed, iterations: +els.iters.value, width: VB_W, height: VB_H });
    draw();
  });
  els.run.addEventListener("click", function () {
    if (state.animTimer) { stopAnim(); state.animStep = -1; draw(); }
    else { runAnimation(); }
  });

  // ---- boot --------------------------------------------------------------
  buildExampleButtons();
  els.links.value = EXAMPLES[0].text;
  syncStartRow();
  rebuild({ preferStart: EXAMPLES[0].start });
})();
