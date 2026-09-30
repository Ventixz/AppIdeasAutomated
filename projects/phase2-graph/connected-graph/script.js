/*
 * script.js — the browser controller.
 *
 * It owns no graph logic: connectivity-core.js parses the links, builds the
 * graph, decides connectivity, finds cut vertices / bridges / SCCs, verifies the
 * answer, and computes the force-directed positions. This file is all DOM — it
 * draws the SVG, paints the verdict, and animates the flood fill. Keeping the
 * core DOM-free is what makes it Node-testable.
 */
(function () {
  "use strict";
  var C = window.ConnectivityCore;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = "http://www.w3.org/2000/svg";

  var VW = 800, VH = 560, PAD = 34;

  var linksEl = $("links"), directedEl = $("directed");
  var canvas = $("canvas"), statsEl = $("stats"), findingsEl = $("findings");
  var warnEl = $("warnings"), verdictEl = $("verdict"), verifyEl = $("verify");
  var focusEl = $("focus"), itersEl = $("iters");

  // A palette for tinting the component / SCC rings (colour-blind-friendly-ish).
  var GROUP_COLORS = [
    "#6ea8fe", "#46d17f", "#f5b942", "#b58cff", "#ff8a5b",
    "#4dd0e1", "#e57fb0", "#9ccc65", "#c7a1ff", "#ffd166"
  ];

  // --- worked examples ----------------------------------------------------
  var EXAMPLES = {
    "Connected": {
      directed: false,
      text:
        "# One solid piece, and resilient: a ring plus a chord.\n" +
        "# No cut vertex, no bridge — 2-connected.\n" +
        "a -- b\nb -- c\nc -- d\nd -- a\na -- c"
    },
    "One bridge": {
      directed: false,
      text:
        "# Two triangles joined by a single link (a barbell).\n" +
        "# Connected, but c and d are cut vertices and c--d is the bridge.\n" +
        "a -- b\nb -- c\nc -- a\n" +
        "c -- d\n" +
        "d -- e\ne -- f\nf -- d"
    },
    "Fragile path": {
      directed: false,
      text:
        "# A chain: connected, but every interior node is a single point of\n" +
        "# failure and every edge is a bridge.\n" +
        "a -- b\nb -- c\nc -- d\nd -- e"
    },
    "Islands": {
      directed: false,
      text:
        "# NOT connected: three separate pieces.\n" +
        "a -- b\nb -- c\nc -- a\n" +
        "x -- y\n" +
        "lonely"
    },
    "Parallel saves it": {
      directed: false,
      text:
        "# Two links between a and b means a--b is NOT a bridge;\n" +
        "# only b--c is. (A simple-graph view would wrongly flag a--b.)\n" +
        "a -- b\na -- b\nb -- c"
    },
    "Weak, not strong": {
      directed: true,
      text:
        "# Weakly connected (one piece) but NOT strongly connected:\n" +
        "# you cannot get back from c to a. Three singleton SCCs.\n" +
        "a -> b\nb -> c"
    },
    "Strongly connected": {
      directed: true,
      text:
        "# Every node can reach every other following the arrows.\n" +
        "a -> b\nb -> c\nc -> a\nc -> d\nd -> a"
    },
    "Two SCCs": {
      directed: true,
      text:
        "# A one-way link between two cycles: two strongly-connected clusters.\n" +
        "a -> b\nb -> c\nc -> a\n" +
        "c -> d\n" +
        "d -> e\ne -> f\nf -> d"
    }
  };

  // --- current state ------------------------------------------------------
  var g = null, pos = null, info = null, seed = 1;
  var groupOf = Object.create(null);  // node -> group index (component or SCC)
  var floodTimer = null;

  // ------------------------------------------------------------------------
  function build() {
    stopFlood();
    var parsed = C.parseLinks(linksEl.value);
    g = C.buildGraph(parsed, { directed: directedEl.checked });
    info = C.analyze(g);
    warnEl.textContent = parsed.warnings.length ? "⚠ " + parsed.warnings.join("  ·  ") : "";
    assignGroups();
    layoutAndDraw(true);
    fillFocus();
    paintVerdict();
    paintStats();
    paintFindings();
    paintVerify();
  }

  // Which cluster does each node belong to, for ring tinting? Directed ⇒ SCC;
  // undirected ⇒ weak component.
  function assignGroups() {
    groupOf = Object.create(null);
    var groups = g.directed ? info.sccs : info.components;
    groups.forEach(function (grp, i) {
      grp.forEach(function (n) { groupOf[n] = i; });
    });
  }

  // --- layout + draw ------------------------------------------------------
  function layoutAndDraw(reseed) {
    if (reseed) { /* keep current seed */ }
    var iters = parseInt(itersEl.value, 10) || 300;
    var raw = C.layout(g, { seed: seed, width: VW - 2 * PAD, height: VH - 2 * PAD, iterations: iters });
    pos = Object.create(null);
    g.nodes.forEach(function (n) {
      var p = raw[n] || { x: (VW - 2 * PAD) / 2, y: (VH - 2 * PAD) / 2 };
      pos[n] = { x: p.x + PAD, y: p.y + PAD };
    });
    draw();
  }

  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  function draw(opts) {
    opts = opts || {};
    clear(canvas);
    ensureArrowMarker();

    var apSet = Object.create(null);
    (info.articulationPoints || []).forEach(function (n) { apSet[n] = true; });
    var bridgeSet = Object.create(null);
    (info.bridges || []).forEach(function (e) { bridgeSet[e[0] + "\u0000" + e[1]] = true; });

    var floodNodes = opts.floodNodes || null;      // Set (object) of reached names
    var floodEdges = opts.floodEdges || null;      // Set of "a\0b" reached tree edges
    var rootName = opts.root || null;

    // --- edges ---
    var drawn = Object.create(null);
    g.nodes.forEach(function (u) {
      C.bothNeighbours(g, u).forEach(function (v) {
        if (u === v) { drawSelfLoop(u); return; }
        var key = u < v ? u + "\u0000" + v : v + "\u0000" + u;
        if (drawn[key]) { return; }
        drawn[key] = true;
        var a = pos[u], b = pos[v];
        var line = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "edge" });

        if (bridgeSet[key]) { line.classList.add("bridge"); }
        if (floodNodes) {
          var lit = floodEdges && floodEdges[key];
          if (lit) { line.classList.add("flood"); }
          else { line.classList.add("dim"); }
        }
        if (g.directed) { orientArrow(line, u, v, a, b); }
        canvas.appendChild(line);
      });
    });

    // --- nodes ---
    g.nodes.forEach(function (n) {
      var p = pos[n];
      var grp = el("g", { class: "node", transform: "translate(" + p.x + "," + p.y + ")" });

      // faint coloured ring showing the component / SCC membership
      var gi = groupOf[n];
      if (gi != null) {
        var ring = el("circle", { r: 15, class: "ring", stroke: GROUP_COLORS[gi % GROUP_COLORS.length], "stroke-opacity": 0.55 });
        grp.appendChild(ring);
      }

      var c = el("circle", { r: 11 });
      grp.appendChild(c);

      if (floodNodes) {
        if (rootName === n) { grp.classList.add("root"); }
        else if (floodNodes[n]) { grp.classList.add("flood"); }
        else { grp.classList.add("dim"); }
      } else if (apSet[n]) {
        grp.classList.add("ap");
      }

      var label = n.length > 8 ? n.slice(0, 7) + "…" : n;
      var txt = el("text", { y: 4 });
      txt.textContent = label;
      grp.appendChild(txt);

      var title = el("title"); title.textContent = n; grp.appendChild(title);
      grp.addEventListener("click", function () { runFloodFrom(n); });
      canvas.appendChild(grp);
    });
  }

  function drawSelfLoop(u) {
    var p = pos[u];
    var path = el("path", {
      d: "M " + (p.x - 6) + " " + (p.y - 9) +
         " C " + (p.x - 26) + " " + (p.y - 34) + ", " +
         (p.x + 26) + " " + (p.y - 34) + ", " +
         (p.x + 6) + " " + (p.y - 9),
      class: "edge", fill: "none"
    });
    canvas.appendChild(path);
  }

  // Pull the arrow tip back to the node rim so the marker sits nicely.
  function orientArrow(line, u, v, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var r = 13;
    line.setAttribute("x2", b.x - (dx / len) * r);
    line.setAttribute("y2", b.y - (dy / len) * r);
    line.setAttribute("marker-end", "url(#arrow)");
  }

  function ensureArrowMarker() {
    if (!g.directed) { return; }
    var defs = el("defs", {});
    var marker = el("marker", {
      id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse"
    });
    var pth = el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#5b678f" });
    marker.appendChild(pth); defs.appendChild(marker); canvas.appendChild(defs);
  }

  // --- verdict banner -----------------------------------------------------
  function paintVerdict() {
    clear(verdictEl);
    if (g.nodes.length === 0) {
      verdictEl.appendChild(span("big", "Empty graph"));
      verdictEl.appendChild(span("sub", "Nothing to connect — vacuously connected."));
      return;
    }
    if (g.directed) {
      var weak = info.weaklyConnected, strong = info.stronglyConnected;
      verdictEl.appendChild(span("big " + (strong ? "good" : (weak ? "warn" : "bad")),
        strong ? "Strongly connected ✓" : (weak ? "Weakly connected" : "Not connected")));
      var sub = document.createElement("span");
      sub.className = "sub";
      if (strong) {
        sub.innerHTML = "Every node reaches every other <strong>following the arrows</strong>.";
      } else if (weak) {
        sub.innerHTML = "One piece if arrows are ignored, but <strong>" + info.sccCount +
          " strongly-connected components</strong> following them.";
      } else {
        sub.innerHTML = "<strong>" + info.componentCount + " separate pieces</strong> even ignoring direction.";
      }
      verdictEl.appendChild(sub);
      verdictEl.appendChild(tag("weak", weak));
      verdictEl.appendChild(tag("strong", strong));
    } else {
      var conn = info.connected;
      verdictEl.appendChild(span("big " + (conn ? "good" : "bad"),
        conn ? "Connected ✓" : "Not connected"));
      var sub2 = document.createElement("span");
      sub2.className = "sub";
      if (conn) {
        if (info.biconnected) {
          sub2.innerHTML = "One piece, and <strong>2-connected</strong> — no single node or edge can break it.";
        } else if (info.articulationPoints.length) {
          sub2.innerHTML = "One piece, but <strong>" + info.articulationPoints.length +
            " cut vertex(es)</strong> would break it if removed.";
        } else {
          sub2.innerHTML = "One piece.";
        }
      } else {
        sub2.innerHTML = "<strong>" + info.componentCount + " separate pieces</strong> — some nodes cannot reach others.";
      }
      verdictEl.appendChild(sub2);
      verdictEl.appendChild(tag("2-edge-connected", info.twoEdgeConnected));
      verdictEl.appendChild(tag("biconnected", info.biconnected));
    }
  }

  function tag(label, on) {
    var t = document.createElement("span");
    t.className = "tag " + (on ? "on" : "off");
    t.textContent = (on ? "✓ " : "✗ ") + label;
    return t;
  }
  function span(cls, text) { var s = document.createElement("span"); s.className = cls; s.textContent = text; return s; }

  // --- stats grid ---------------------------------------------------------
  function paintStats() {
    clear(statsEl);
    stat("Nodes", g.nodes.length);
    stat("Edges", info.edgeCount);
    if (g.directed) {
      stat("Weak pieces", info.componentCount, info.componentCount === 1 ? "good" : "warn");
      stat("SCCs", info.sccCount, info.sccCount === 1 ? "good" : "warn");
    } else {
      stat("Pieces", info.componentCount, info.componentCount === 1 ? "good" : "bad");
      stat("Cut vertices", info.articulationPoints.length, info.articulationPoints.length ? "warn" : "good");
      stat("Bridges", info.bridges.length, info.bridges.length ? "warn" : "good");
    }
    stat("Isolated", info.isolatedCount, info.isolatedCount ? "warn" : "good");
  }
  function stat(k, v, cls) {
    var box = document.createElement("div"); box.className = "stat";
    var kk = document.createElement("div"); kk.className = "k"; kk.textContent = k;
    var vv = document.createElement("div"); vv.className = "v" + (cls ? " " + cls : ""); vv.textContent = v;
    box.appendChild(kk); box.appendChild(vv); statsEl.appendChild(box);
  }

  // --- findings prose -----------------------------------------------------
  function paintFindings() {
    var parts = [];
    if (g.nodes.length === 0) { findingsEl.innerHTML = "Type some links to begin."; return; }

    if (g.directed) {
      if (info.stronglyConnected) {
        parts.push("The whole graph is <span class='good'>one strongly-connected component</span>.");
      } else {
        var big = info.sccs.slice().sort(function (a, b) { return b.length - a.length; })[0];
        parts.push("Strongly-connected clusters (mutually reachable): " +
          info.sccs.map(function (s) { return "<code>{" + s.join(", ") + "}</code>"; }).join(" "));
        if (big && big.length > 1) {
          parts.push("The largest cluster has <strong>" + big.length + "</strong> nodes.");
        }
      }
    } else {
      if (info.articulationPoints.length) {
        parts.push("Cut vertices (remove one and the graph splits): " +
          info.articulationPoints.map(function (n) { return "<code>" + n + "</code>"; }).join(" ") + ".");
      } else if (info.connected && g.nodes.length >= 3) {
        parts.push("<span class='good'>No cut vertex</span> — every node has an alternate route around it.");
      }
      if (info.bridges.length) {
        parts.push("Bridges (remove one and the graph splits): " +
          info.bridges.map(function (e) { return "<code>" + e[0] + "–" + e[1] + "</code>"; }).join(" ") + ".");
      } else if (info.connected) {
        parts.push("<span class='good'>No bridge</span> — every edge lies on a cycle.");
      }
      if (!info.connected) {
        parts.push("Pieces: " + info.components.map(function (c) {
          return "<code>{" + c.join(", ") + "}</code>";
        }).join(" ") + ".");
      }
    }
    if (info.selfLoops) { parts.push(info.selfLoops + " self-loop(s) present (they don't affect connectivity)."); }
    if (info.duplicates) { parts.push(info.duplicates + " parallel link(s) collapsed (counted for bridges)."); }
    parts.push("<em>Tip: click any node, or use the control below, to flood-fill and watch what it can reach.</em>");
    findingsEl.innerHTML = parts.join(" ");
  }

  // --- the independent verification line ----------------------------------
  function paintVerify() {
    verifyEl.classList.remove("bad");
    if (g.nodes.length === 0) { verifyEl.textContent = ""; return; }
    var okAll = true, notes = [];

    // 1. connectivity confirmed by a second, independent flood fill
    var floodSaysConnected = C.verifyConnectedByFlood(g);
    if (floodSaysConnected !== info.connected) { okAll = false; }
    notes.push("connectivity re-checked by an independent flood fill");

    if (g.directed) {
      // 2. SCCs confirmed by all-pairs mutual reachability
      var brute = C.bruteSCCs(g);
      if (!sameGroups(brute, info.sccs)) { okAll = false; }
      notes.push("SCCs re-derived by all-pairs reachability");
    } else {
      // 2. cut vertices / bridges confirmed by removal
      var bAP = C.bruteArticulationPoints(g), bBR = C.bruteBridges(g);
      if (!sameArr(bAP, info.articulationPoints)) { okAll = false; }
      if (!samePairs(bBR, info.bridges)) { okAll = false; }
      notes.push("cut vertices &amp; bridges re-checked by removing each one");
    }

    if (okAll) {
      verifyEl.innerHTML = "✓ Verified — " + notes.join("; ") + ", and both agree.";
    } else {
      verifyEl.classList.add("bad");
      verifyEl.textContent = "✗ Verification mismatch (this should never happen — please report).";
    }
  }

  // --- flood-fill animation ----------------------------------------------
  function runFloodFrom(startNode) {
    stopFlood();
    if (!startNode || !(startNode in g._out)) { return; }
    focusEl.value = startNode;
    var walk = C.bfs(g, startNode);
    var order = walk.order;
    var reached = Object.create(null);
    var edgesLit = Object.create(null);
    var i = 0;

    function step() {
      if (i >= order.length) {
        // final frame, then report
        reportFlood(startNode, order.length);
        floodTimer = null;
        return;
      }
      var n = order[i++];
      reached[n] = true;
      // light the tree edge from whichever earlier-reached neighbour discovered n
      if (n !== startNode) {
        var nb = C.bothNeighbours(g, n);
        for (var k = 0; k < nb.length; k++) {
          if (reached[nb[k]]) {
            var key = n < nb[k] ? n + "\u0000" + nb[k] : nb[k] + "\u0000" + n;
            edgesLit[key] = true;
            break;
          }
        }
      }
      draw({ floodNodes: reached, floodEdges: edgesLit, root: startNode });
      floodTimer = setTimeout(step, 320);
    }
    step();
  }

  function reportFlood(startNode, count) {
    var total = g.nodes.length;
    var msg;
    if (count === total) {
      msg = "<span class='good'>Reached all " + total + " nodes</span> from <code>" + startNode + "</code>";
      msg += g.directed
        ? " — following the arrows." + (info.stronglyConnected ? " (Every start does; the graph is strongly connected.)" : "")
        : " — so the graph is connected.";
    } else {
      msg = "<span class='warn'>Reached " + count + " of " + total + " nodes</span> from <code>" + startNode + "</code>";
      msg += g.directed
        ? " — the rest are unreachable following the arrows."
        : " — the rest are in other pieces.";
    }
    findingsEl.innerHTML = msg + " <em>(Rebuild or pick another node to reset.)</em>";
  }

  function stopFlood() { if (floodTimer) { clearTimeout(floodTimer); floodTimer = null; } }

  // --- focus dropdown -----------------------------------------------------
  function fillFocus() {
    clear(focusEl);
    var opt0 = document.createElement("option");
    opt0.value = ""; opt0.textContent = "— pick a node —";
    focusEl.appendChild(opt0);
    g.nodes.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n; focusEl.appendChild(o);
    });
  }

  // --- small helpers ------------------------------------------------------
  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) { Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); }
    return e;
  }
  function sameArr(a, b) {
    if (a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }
  function samePairs(a, b) {
    if (a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) { return false; } }
    return true;
  }
  function sameGroups(a, b) {
    if (a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (!sameArr(a[i], b[i])) { return false; } }
    return true;
  }

  // --- wire up examples + controls ---------------------------------------
  (function initExamples() {
    var box = $("examples");
    Object.keys(EXAMPLES).forEach(function (name) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = name;
      b.addEventListener("click", function () {
        linksEl.value = EXAMPLES[name].text;
        directedEl.checked = EXAMPLES[name].directed;
        seed = 1;
        build();
      });
      box.appendChild(b);
    });
  })();

  $("build").addEventListener("click", build);
  directedEl.addEventListener("change", build);
  $("relayout").addEventListener("click", function () { stopFlood(); seed = (seed * 1664525 + 1013904223) >>> 0; layoutAndDraw(true); });
  itersEl.addEventListener("change", function () { stopFlood(); layoutAndDraw(true); });
  $("flood").addEventListener("click", function () { if (focusEl.value) { runFloodFrom(focusEl.value); } });
  focusEl.addEventListener("change", function () { if (focusEl.value) { runFloodFrom(focusEl.value); } });
  linksEl.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); build(); }
  });

  // --- first paint --------------------------------------------------------
  linksEl.value = EXAMPLES["One bridge"].text;
  directedEl.checked = EXAMPLES["One bridge"].directed;
  build();
})();
