/*
 * script.js — the browser controller.
 *
 * It owns no graph logic: graph-core.js parses the links, builds the multigraph,
 * classifies it (circuit / path / none), runs Hierholzer's algorithm to produce
 * a trail, and lays the nodes out. This file is all DOM — it draws the SVG
 * network (curving parallel edges apart and looping self-loops), numbers the
 * edges in traversal order, animates the walk, and paints the verdict. Keeping
 * the core DOM-free is what makes it Node-testable.
 */
(function () {
  "use strict";
  var G = window.GraphCore;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = "http://www.w3.org/2000/svg";

  var VW = 800, VH = 560, R = 15;   // viewBox and node radius

  var linksEl = $("links"), directedEl = $("directed");
  var canvas = $("canvas"), statsEl = $("stats"), findingsEl = $("findings");
  var warnEl = $("warnings"), trailEl = $("trail");
  var animateBtn = $("animate"), speedEl = $("speed"), relayoutBtn = $("relayout");

  // --- worked examples ----------------------------------------------------
  var EXAMPLES = {
    "Königsberg": {
      directed: false,
      text:
        "# The Seven Bridges of Königsberg (1736). Four land masses, seven\n" +
        "# bridges. All four have odd degree, so NO single walk crosses every\n" +
        "# bridge exactly once — Euler's original 'no' answer.\n" +
        "North -- Island\nNorth -- Island\n" +
        "South -- Island\nSouth -- Island\n" +
        "East  -- Island\n" +
        "North -- East\nSouth -- East"
    },
    "Königsberg −1 bridge": {
      directed: false,
      text:
        "# Remove one North–Island bridge and exactly two land masses stay odd\n" +
        "# (North, South) — now an Eulerian PATH exists, running between them.\n" +
        "North -- Island\n" +
        "South -- Island\nSouth -- Island\n" +
        "East  -- Island\n" +
        "North -- East\nSouth -- East"
    },
    "Envelope (⋈)": {
      directed: false,
      text:
        "# The 'draw an envelope without lifting your pen' puzzle. Two odd\n" +
        "# corners at the base -> an Eulerian path between them.\n" +
        "bl -- br\nbl -- tl\nbr -- tr\ntl -- tr\n" +
        "bl -- tr\nbr -- tl\ntl -- apex\ntr -- apex"
    },
    "Square (circuit)": {
      directed: false,
      text:
        "# Every corner has even degree -> an Eulerian CIRCUIT that returns\n" +
        "# to where it started.\n" +
        "a -- b\nb -- c\nc -- d\nd -- a"
    },
    "One-way tour": {
      directed: true,
      text:
        "# A directed graph. One vertex has out−in = +1 (the start) and one the\n" +
        "# reverse (the end) -> a directed Eulerian path.\n" +
        "a -> b\nb -> c\nc -> a\na -> d\nd -> c"
    },
    "Figure eight": {
      directed: false,
      text:
        "# Two loops meeting at a shared centre — every vertex even, so a\n" +
        "# circuit threads both loops. A self-loop counts too:\n" +
        "hub -- x\nx -- y\ny -- hub\nhub -- p\np -- q\nq -- hub\nhub -- hub"
    }
  };

  // --- current state ------------------------------------------------------
  var g = null;        // the built multigraph
  var cls = null;      // classification
  var result = null;   // trail result (or null)
  var pos = null;      // node -> {x,y}
  var seed = 1;
  var edgeGeom = [];   // per-edge drawing geometry
  var animTimer = null;

  // ------------------------------------------------------------------------
  // Build everything from the current textarea + directed toggle.
  // ------------------------------------------------------------------------
  function rebuild() {
    stopAnim();
    var parsed = G.parseLinks(linksEl.value);
    g = G.buildMultigraph(parsed, { directed: directedEl.checked });
    cls = G.classifyEulerian(g);
    result = G.findEulerianTrail(g);
    warnEl.textContent = parsed.warnings.length ? parsed.warnings.join(" · ") : "";
    relayout(false);
    paintStats();
    paintTrailLine();
    animateBtn.disabled = !(result && result.edgeOrder.length > 0);
  }

  function relayout(bump) {
    if (bump) { seed = (seed * 1103515245 + 12345) >>> 0; }
    var L = G.layout(g, { width: VW, height: VH, seed: seed || 1, iterations: 320 });
    pos = L.positions;
    computeGeometry();
    draw(-1); // draw with nothing highlighted yet
  }

  // ------------------------------------------------------------------------
  // Geometry: curve parallel edges apart, loop self-loops.
  // ------------------------------------------------------------------------
  function pairKey(a, b) { return a < b ? a + "\u0000" + b : b + "\u0000" + a; }

  function computeGeometry() {
    edgeGeom = [];
    // group edges by unordered endpoint pair to fan parallels out
    var groups = Object.create(null);
    for (var i = 0; i < g.edges.length; i++) {
      var e = g.edges[i];
      var key = pairKey(e.from, e.to);
      if (!groups[key]) { groups[key] = []; }
      groups[key].push(i);
    }
    var seenIndex = Object.create(null);
    for (var j = 0; j < g.edges.length; j++) {
      var edge = g.edges[j];
      var gk = pairKey(edge.from, edge.to);
      var grp = groups[gk];
      var idxInGroup = (seenIndex[gk] = (seenIndex[gk] == null ? 0 : seenIndex[gk] + 1));
      var total = grp.length;
      edgeGeom[j] = geomFor(edge, idxInGroup, total);
    }
  }

  function geomFor(edge, idxInGroup, total) {
    var pa = pos[edge.from], pb = pos[edge.to];
    if (edge.from === edge.to) {
      // self-loop: a little circle sitting above-right of the node, fanned by index
      var ang = -Math.PI / 2 + idxInGroup * 0.7;
      var lx = pa.x + Math.cos(ang) * 34, ly = pa.y + Math.sin(ang) * 34;
      var d = "M " + pa.x + " " + pa.y +
              " C " + (lx - 22) + " " + (ly - 26) + " " + (lx + 22) + " " + (ly - 26) +
              " " + pa.x + " " + pa.y;
      return { self: true, d: d, labelX: lx, labelY: ly - 20, arrowAt: null };
    }
    // curvature: fan parallels symmetrically around the straight line
    var spread = 26;
    var offset = (idxInGroup - (total - 1) / 2) * spread;
    var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    var dx = pb.x - pa.x, dy = pb.y - pa.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;           // unit normal
    var cx = mx + nx * offset * 2, cy = my + ny * offset * 2; // control point
    var d = "M " + pa.x + " " + pa.y + " Q " + cx + " " + cy + " " + pb.x + " " + pb.y;
    // point on the quadratic at t for label (0.5) and arrow (0.72)
    var pt = function (t) {
      var it = 1 - t;
      return {
        x: it * it * pa.x + 2 * it * t * cx + t * t * pb.x,
        y: it * it * pa.y + 2 * it * t * cy + t * t * pb.y
      };
    };
    var lab = pt(0.5);
    var ap = pt(0.74), ap0 = pt(0.66);
    var adx = ap.x - ap0.x, ady = ap.y - ap0.y;
    var alen = Math.sqrt(adx * adx + ady * ady) || 1;
    // pull the arrow back to the node rim
    var arrow = { x: ap.x, y: ap.y, ux: adx / alen, uy: ady / alen };
    return { self: false, d: d, labelX: lab.x, labelY: lab.y - 4, arrowAt: arrow };
  }

  // ------------------------------------------------------------------------
  // Draw the SVG. `upto` = how many trail steps to reveal (-1 = none, all if big).
  // ------------------------------------------------------------------------
  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) { if (attrs[k] != null) { n.setAttribute(k, attrs[k]); } }
    return n;
  }

  function draw(upto) {
    while (canvas.firstChild) { canvas.removeChild(canvas.firstChild); }
    if (!g || g.nodes.length === 0) { return; }

    // step index -> edge id, and edge id -> its 1-based position(s) in the trail
    var order = result ? result.edgeOrder : [];
    var stepOfEdge = Object.create(null);
    for (var s = 0; s < order.length; s++) {
      if (stepOfEdge[order[s]] == null) { stepOfEdge[order[s]] = s; }
    }
    var revealAll = upto < 0 ? false : (upto >= order.length);

    // --- edges ---
    var edgeLayer = el("g", {});
    var labelLayer = el("g", {});
    for (var i = 0; i < g.edges.length; i++) {
      var geo = edgeGeom[i];
      var step = stepOfEdge[i];
      var state = "";
      if (upto >= 0 && step != null) {
        if (step < upto - 1) { state = "done"; }
        else if (step === upto - 1) { state = "current"; }
      }
      var path = el("path", { "class": "edge" + (state ? " " + state : ""), d: geo.d });
      edgeLayer.appendChild(path);

      // arrowhead for directed edges
      if (g.directed && geo.arrowAt) {
        var a = geo.arrowAt;
        var back = R + 3;
        var tipx = pos[g.edges[i].to].x - a.ux * back;
        var tipy = pos[g.edges[i].to].y - a.uy * back;
        var w = 5;
        var p1x = tipx - a.ux * 9 + -a.uy * w, p1y = tipy - a.uy * 9 + a.ux * w;
        var p2x = tipx - a.ux * 9 - -a.uy * w, p2y = tipy - a.uy * 9 - a.ux * w;
        var tri = el("path", {
          "class": "arrowhead" + (state ? " " + state : ""),
          d: "M " + tipx + " " + tipy + " L " + p1x + " " + p1y + " L " + p2x + " " + p2y + " Z"
        });
        edgeLayer.appendChild(tri);
      }

      // step number label (only for edges that are part of the trail and revealed)
      if (step != null && (revealAll || (upto >= 0 && step <= upto - 1))) {
        var lbl = el("text", {
          "class": "edge-label" + (step === upto - 1 ? " current" : ""),
          x: geo.labelX, y: geo.labelY
        });
        lbl.textContent = String(step + 1);
        labelLayer.appendChild(lbl);
      }
    }
    canvas.appendChild(edgeLayer);

    // --- nodes ---
    var oddSet = Object.create(null);
    if (cls) { for (var o = 0; o < cls.oddVertices.length; o++) { oddSet[cls.oddVertices[o]] = true; } }
    var startNode = cls && cls.kind === "path" ? cls.start : null;
    var endNode = cls && cls.kind === "path" ? cls.end : null;

    var nodeLayer = el("g", {});
    for (var n = 0; n < g.nodes.length; n++) {
      var name = g.nodes[n];
      var p = pos[name];
      var klass = "node";
      if (name === startNode) { klass += " start"; }
      else if (name === endNode) { klass += " end"; }
      else if (oddSet[name]) { klass += " odd"; }
      var gnode = el("g", { "class": klass });
      gnode.appendChild(el("circle", { cx: p.x, cy: p.y, r: R }));
      var t = el("text", { x: p.x, y: p.y + 4 });
      t.textContent = name.length > 6 ? name.slice(0, 5) + "…" : name;
      gnode.appendChild(t);
      var title = el("title", {});
      title.textContent = name + " — " + degreeText(name);
      gnode.appendChild(title);
      nodeLayer.appendChild(gnode);
    }
    canvas.appendChild(nodeLayer);
    canvas.appendChild(labelLayer);
  }

  function degreeText(name) {
    var d = G.degreeOf(g, name);
    if (g.directed) { return "out " + d.out + ", in " + d.in; }
    return "degree " + d.degree;
  }

  // ------------------------------------------------------------------------
  // The verdict panel.
  // ------------------------------------------------------------------------
  function statCard(k, v, cls2) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v' +
      (cls2 ? " " + cls2 : "") + '">' + v + "</div></div>";
  }

  function paintStats() {
    var kindLabel = { circuit: "Circuit", path: "Path", none: "None" }[cls.kind];
    var kindCls = cls.kind === "none" ? "bad" : "good";
    var oddCount = g.directed ? cls.unbalanced.length : cls.oddVertices.length;
    var oddKey = g.directed ? "Unbalanced" : "Odd-degree";

    var html = "";
    html += statCard("Nodes", g.nodes.length);
    html += statCard("Edges", g.edges.length);
    html += statCard("Eulerian", kindLabel, kindCls + " small");
    html += statCard("Connected", cls.connected ? "yes" : "no", cls.connected ? "good small" : "bad small");
    html += statCard(oddKey, oddCount, oddCount === 0 ? "good" : (cls.kind === "none" ? "bad" : "warn"));
    if (g.parallels) { html += statCard("Parallel", g.parallels, "warn"); }
    if (g.selfLoops) { html += statCard("Self-loops", g.selfLoops, "warn"); }
    statsEl.innerHTML = html;

    // findings sentence
    var f = "";
    if (cls.kind === "none") {
      f = '<span class="bad">✗ No Eulerian trail.</span> ' + escapeHtml(cls.reason);
    } else if (cls.kind === "circuit") {
      f = '<span class="good">✓ Eulerian circuit.</span> ' + escapeHtml(cls.reason);
    } else {
      f = '<span class="good">✓ Eulerian path.</span> ' + escapeHtml(cls.reason);
    }
    // append the independent verification result when we have a trail
    if (result) {
      var v = G.verifyTrail(g, result);
      if (v.ok && result.edgeOrder.length > 0) {
        f += ' <strong>Verified:</strong> ' + escapeHtml(v.reason) + ".";
      }
    }
    findingsEl.innerHTML = f;
  }

  function paintTrailLine() {
    if (!result || result.edgeOrder.length === 0) { trailEl.innerHTML = ""; return; }
    var sep = g.directed ? " → " : " — ";
    var parts = [];
    for (var i = 0; i < result.trail.length; i++) {
      parts.push(escapeHtml(result.trail[i]));
    }
    trailEl.innerHTML = parts.join('<span class="arr">' + sep + "</span>");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ------------------------------------------------------------------------
  // Animate the walk.
  // ------------------------------------------------------------------------
  function stopAnim() {
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
    animateBtn.textContent = "▶ Trace the trail";
  }

  function toggleAnim() {
    if (animTimer) { stopAnim(); draw(result.edgeOrder.length + 1); return; }
    if (!result || result.edgeOrder.length === 0) { return; }
    var step = 0;
    var total = result.edgeOrder.length;
    animateBtn.textContent = "⏸ Pause";
    draw(0);
    var delay = 1320 - Number(speedEl.value); // slider: bigger = faster
    animTimer = setInterval(function () {
      step++;
      draw(step);
      if (step > total) { stopAnim(); }
    }, Math.max(90, delay));
  }

  // ------------------------------------------------------------------------
  // Examples + wiring.
  // ------------------------------------------------------------------------
  function buildExamples() {
    var host = $("examples");
    Object.keys(EXAMPLES).forEach(function (name) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.addEventListener("click", function () {
        var ex = EXAMPLES[name];
        linksEl.value = ex.text;
        directedEl.checked = !!ex.directed;
        seed = 1;
        rebuild();
      });
      host.appendChild(b);
    });
  }

  $("build").addEventListener("click", rebuild);
  directedEl.addEventListener("change", rebuild);
  linksEl.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { rebuild(); }
  });
  animateBtn.addEventListener("click", toggleAnim);
  relayoutBtn.addEventListener("click", function () { relayout(true); });
  speedEl.addEventListener("input", function () {
    if (animTimer) { toggleAnim(); toggleAnim(); } // restart at new speed
  });

  buildExamples();
  // start on Königsberg −1 so the page opens on a working, animatable path
  linksEl.value = EXAMPLES["Königsberg −1 bridge"].text;
  directedEl.checked = false;
  rebuild();
})();
