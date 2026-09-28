/*
 * script.js — the browser controller.
 *
 * It owns no graph logic: graph-core.js parses the links, builds the graph,
 * runs every measurement, and computes the force-directed node positions. This
 * file is all DOM — it draws the SVG network from those positions and paints the
 * stats read-out. Keeping the core DOM-free is what makes it Node-testable.
 */
(function () {
  "use strict";
  var G = window.GraphCore;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = "http://www.w3.org/2000/svg";

  var VW = 800, VH = 560, PAD = 34;   // viewBox and node padding

  var linksEl = $("links"), directedEl = $("directed");
  var canvas = $("canvas"), statsEl = $("stats"), findingsEl = $("findings");
  var warnEl = $("warnings"), focusEl = $("focus"), itersEl = $("iters");

  // --- worked examples ----------------------------------------------------
  var EXAMPLES = {
    "Website": {
      directed: true,
      text:
        "# A little hyperlink graph: pages that link to pages.\n" +
        "home -> about\n" +
        "home -> blog\n" +
        "home -> shop\n" +
        "blog -> post-a\n" +
        "blog -> post-b\n" +
        "post-a -> home\n" +
        "about -> home\n" +
        "shop -> cart\n" +
        "cart -> checkout\n" +
        "orphan   # a page nobody links to"
    },
    "Friends": {
      directed: false,
      text:
        "# An undirected social network — friendship goes both ways.\n" +
        "ana -- ben\n" +
        "ana -- cara\n" +
        "ben -- cara\n" +
        "cara -- dan\n" +
        "dan -- eve\n" +
        "eve -- ana\n" +
        "finn -- gwen   # a separate little pair"
    },
    "Tasks (DAG)": {
      directed: true,
      text:
        "# A dependency graph: an arrow means 'must come first'.\n" +
        "design -> build\n" +
        "build -> test\n" +
        "test -> ship\n" +
        "design -> docs\n" +
        "docs -> ship\n" +
        "build -> review\n" +
        "review -> ship"
    },
    "Islands": {
      directed: false,
      text:
        "# Three disconnected components.\n" +
        "a - b\nb - c\nc - a\n" +
        "x - y\ny - z\n" +
        "lonely"
    },
    "Cycle": {
      directed: true,
      text:
        "# A pure directed cycle — no topological order exists.\n" +
        "1 -> 2\n2 -> 3\n3 -> 4\n4 -> 5\n5 -> 1"
    }
  };

  // --- current state ------------------------------------------------------
  var g = null;       // the built graph
  var pos = null;     // node -> {x,y}
  var seed = 1;
  var focusSet = null; // Set of reachable node names, or null

  // --- build & draw -------------------------------------------------------
  function build() {
    var parsed = G.parseLinks(linksEl.value);
    g = G.buildGraph(parsed, { directed: directedEl.checked });
    warnEl.textContent = parsed.warnings.length ? "⚠ " + parsed.warnings.join("  ·  ") : "";
    layoutAndDraw(true);
    fillFocus();
    paintStats();
  }

  function layoutAndDraw(reseed) {
    if (reseed) { /* keep current seed */ }
    pos = G.layout(g, {
      width: VW - 2 * PAD,
      height: VH - 2 * PAD,
      seed: seed,
      iterations: +itersEl.value
    });
    // Shift into the padded frame.
    Object.keys(pos).forEach(function (k) { pos[k].x += PAD; pos[k].y += PAD; });
    draw();
  }

  function draw() {
    canvas.innerHTML = "";
    if (!g || g.nodes.length === 0) {
      addText(VW / 2, VH / 2, "No links yet — type some, or load an example.", "empty");
      return;
    }

    // Arrowhead marker for directed graphs.
    if (g.directed) {
      var defs = el("defs");
      var marker = el("marker", {
        id: "arrow", viewBox: "0 0 10 10", refX: "9", refY: "5",
        markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse"
      });
      marker.appendChild(el("path", { d: "M0,0 L10,5 L0,10 z", fill: "#46527a" }));
      defs.appendChild(marker);
      canvas.appendChild(defs);
    }

    // Edges first (so nodes sit on top). Draw each distinct edge once.
    var drawn = Object.create(null);
    var edgesG = el("g");
    g.nodes.forEach(function (u) {
      G.outNeighbours(g, u).forEach(function (v) {
        var key = g.directed ? (u + "\u0000" + v) : (u < v ? u + "\u0000" + v : v + "\u0000" + u);
        if (drawn[key]) { return; }
        drawn[key] = true;
        edgesG.appendChild(edgeLine(u, v, key));
      });
    });
    canvas.appendChild(edgesG);

    // Nodes.
    var nodesG = el("g");
    g.nodes.forEach(function (n) { nodesG.appendChild(nodeMark(n)); });
    canvas.appendChild(nodesG);
  }

  function edgeLine(u, v, key) {
    var a = pos[u], b = pos[v];
    if (u === v) { return selfLoop(u); }
    var line = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    line.setAttribute("class", edgeClass(u, v));
    if (g.directed) { trimToRadius(line, a, b); line.setAttribute("marker-end", "url(#arrow)"); }
    return line;
  }

  // Pull the arrow's tip back so it lands on the node's rim, not its centre.
  function trimToRadius(line, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var r = 13;
    line.setAttribute("x2", b.x - (dx / d) * r);
    line.setAttribute("y2", b.y - (dy / d) * r);
    line.setAttribute("x1", a.x + (dx / d) * r);
    line.setAttribute("y1", a.y + (dy / d) * r);
  }

  function selfLoop(u) {
    var p = pos[u];
    var loop = el("path", {
      d: "M " + p.x + " " + (p.y - 11) +
         " c 16 -16, 30 4, 0 12"
    });
    loop.setAttribute("class", edgeClass(u, u));
    if (g.directed) { loop.setAttribute("marker-end", "url(#arrow)"); }
    loop.setAttribute("fill", "none");
    return loop;
  }

  function edgeClass(u, v) {
    var c = "edge";
    if (focusSet) {
      // Highlight an edge if both endpoints are in the reachable set (directed:
      // the edge is on a reachable path).
      if (focusSet[u] && focusSet[v]) { c += " hi"; }
      else { c += " dim"; }
    }
    return c;
  }

  function nodeMark(n) {
    var p = pos[n];
    var group = el("g");
    var cls = "node";
    if (focusSet) {
      if (n === focusEl.value) { cls += " root"; }
      else if (focusSet[n]) { cls += " hi"; }
      else { cls += " dim"; }
    }
    group.setAttribute("class", cls);
    var deg = G.degree(g, n);
    var r = 9 + Math.min(9, Math.sqrt(deg) * 2.4);   // bigger = more connected
    var c = el("circle", { cx: p.x, cy: p.y, r: r });
    group.appendChild(c);
    group.appendChild(makeText(p.x, p.y - r - 4, n));
    // Click to focus reachability on this node.
    group.addEventListener("click", function () {
      focusEl.value = n;
      applyFocus();
    });
    // Title for hover.
    var title = el("title");
    title.textContent = n + " — " + degreeLabel(n);
    group.appendChild(title);
    return group;
  }

  function degreeLabel(n) {
    if (g.directed) {
      return "in " + G.inDegree(g, n) + ", out " + G.outDegree(g, n);
    }
    return "degree " + G.degree(g, n);
  }

  // --- reachability focus -------------------------------------------------
  function fillFocus() {
    var cur = focusEl.value;
    focusEl.innerHTML = '<option value="">— none —</option>';
    g.nodes.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n;
      focusEl.appendChild(o);
    });
    if (cur && g.nodes.indexOf(cur) !== -1) { focusEl.value = cur; applyFocus(); }
    else { focusSet = null; }
  }

  function applyFocus() {
    var start = focusEl.value;
    if (!start) { focusSet = null; draw(); return; }
    var reached = G.reachable(g, start);
    focusSet = Object.create(null);
    reached.forEach(function (n) { focusSet[n] = true; });
    draw();
  }

  // --- stats read-out -----------------------------------------------------
  function paintStats() {
    var s = G.stats(g);
    statsEl.innerHTML = "";
    stat("Nodes", s.nodeCount);
    stat("Edges", s.edgeCount);
    stat("Components", s.componentCount, s.connected ? "good" : "warn");
    stat("Density", (s.density * 100).toFixed(1) + "%");
    stat("Avg degree", s.avgDegree.toFixed(2));
    stat("Most linked", s.topNode == null ? "—" : s.topNode + " (" + s.topDegree + ")", "small");
    if (g.directed) {
      stat("Acyclic?", s.acyclic ? "yes — a DAG" : "no — has a cycle", s.acyclic ? "good small" : "warn small");
    } else {
      stat("Has a cycle?", G.hasCycle(g) ? "yes" : "no", G.hasCycle(g) ? "warn small" : "good small");
    }

    // A sentence or two of plain-language findings.
    var parts = [];
    if (s.nodeCount === 0) {
      findingsEl.innerHTML = "Nothing built yet.";
      return;
    }
    parts.push("This " + (g.directed ? "directed" : "undirected") + " graph has <strong>" +
      s.nodeCount + "</strong> node" + plural(s.nodeCount) + " and <strong>" +
      s.edgeCount + "</strong> edge" + plural(s.edgeCount) + ".");

    if (s.connected) {
      parts.push("It is <span class='good'>fully connected</span> — every node reaches every other" +
        (g.directed ? " (ignoring arrow direction)" : "") + ".");
    } else {
      parts.push("It splits into <span class='warn'>" + s.componentCount +
        " separate pieces</span>" + (s.isolatedCount ? ", " + s.isolatedCount + " of them lone node" + plural(s.isolatedCount) : "") + ".");
    }

    if (g.directed) {
      if (s.acyclic) {
        var order = G.topoSort(g);
        parts.push("With no cycles it's a <strong>DAG</strong>; one valid order is " +
          "<strong>" + order.slice(0, 8).join(" → ") + (order.length > 8 ? " → …" : "") + "</strong>.");
      } else {
        parts.push("It contains at least one <span class='warn'>directed cycle</span>, so it has no topological order.");
      }
    }

    if (s.duplicates || s.selfLoops) {
      var extra = [];
      if (s.duplicates) { extra.push(s.duplicates + " duplicate link" + plural(s.duplicates) + " collapsed"); }
      if (s.selfLoops) { extra.push(s.selfLoops + " self-loop" + plural(s.selfLoops)); }
      parts.push("<span class='muted'>(" + extra.join("; ") + ".)</span>");
    }

    parts.push("Pick a node above (or click one) to light up everything reachable from it.");
    findingsEl.innerHTML = parts.join(" ");
  }

  function stat(k, v, cls) {
    var d = document.createElement("div");
    d.className = "stat";
    var vc = "v" + (cls ? " " + cls : "");
    d.innerHTML = '<div class="k">' + k + '</div><div class="' + vc + '">' + v + '</div>';
    statsEl.appendChild(d);
  }
  function plural(n) { return n === 1 ? "" : "s"; }

  // --- tiny SVG helpers ---------------------------------------------------
  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) { Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); }
    return e;
  }
  function makeText(x, y, str) {
    var t = el("text", { x: x, y: y });
    t.textContent = str;
    return t;
  }
  function addText(x, y, str, cls) {
    var t = makeText(x, y, str);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", "#97a2ba");
    canvas.appendChild(t);
  }

  // --- examples & wiring --------------------------------------------------
  function buildExampleButtons() {
    var box = $("examples");
    Object.keys(EXAMPLES).forEach(function (name) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.addEventListener("click", function () {
        linksEl.value = EXAMPLES[name].text;
        directedEl.checked = EXAMPLES[name].directed;
        focusEl.value = "";
        build();
      });
      box.appendChild(b);
    });
  }

  $("build").addEventListener("click", build);
  directedEl.addEventListener("change", build);
  linksEl.addEventListener("keydown", function (e) {
    // Ctrl/Cmd+Enter rebuilds.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); build(); }
  });
  focusEl.addEventListener("change", applyFocus);
  $("relayout").addEventListener("click", function () { seed = (seed * 1664525 + 1013904223) >>> 0; layoutAndDraw(); });
  itersEl.addEventListener("change", function () { if (g) { layoutAndDraw(); } });

  // --- boot ---------------------------------------------------------------
  buildExampleButtons();
  linksEl.value = EXAMPLES["Website"].text;
  directedEl.checked = EXAMPLES["Website"].directed;
  build();
})();
