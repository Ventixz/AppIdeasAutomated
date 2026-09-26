/*
 * script.js — the browser controller.
 *
 * It owns no algorithm logic: it asks closest-pair-core.js to run both
 * algorithms (filling the race table) and, for the chosen one, to run again
 * with { record: true } so it can replay the recorded frames as an animation.
 * The core stays DOM-free and Node-testable; this file is all canvas and DOM.
 */
(function () {
  "use strict";
  var C = window.ClosestPairCore;

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("canvas"), ctx = canvas.getContext("2d");

  // --- palette pulled from the stylesheet so the two stay in sync ---------
  var css = getComputedStyle(document.documentElement);
  var COL = {
    pt: css.getPropertyValue("--pt").trim() || "#6b7a99",
    cmp: css.getPropertyValue("--cmp").trim() || "#f5b942",
    best: css.getPropertyValue("--best").trim() || "#46d17f",
    divide: css.getPropertyValue("--divide").trim() || "#b58cff",
    strip: css.getPropertyValue("--strip").trim() || "rgba(110,168,254,0.14)",
    stripLine: css.getPropertyValue("--strip-line").trim() || "#6ea8fe"
  };

  // --- state --------------------------------------------------------------
  var points = [];      // [{x, y}] in data space
  var frames = [];      // recorded frames for the chosen algorithm
  var frameIdx = 0;
  var playing = false;
  var timer = null;
  var view = { scale: 1, ox: 0, oy: 0 }; // data → canvas transform

  // Incrementally-maintained animation state.
  var cur = { divide: null, strip: null, compare: null, best: null };

  // --- coordinate transform (uniform scale, centred, honest geometry) -----
  function computeView() {
    var pad = 26;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(function (p) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    if (!isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    var spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
    var sx = (canvas.width - 2 * pad) / spanX;
    var sy = (canvas.height - 2 * pad) / spanY;
    var s = Math.min(sx, sy);
    view.scale = s;
    // Centre the scaled cloud in the canvas.
    view.ox = pad + (canvas.width - 2 * pad - spanX * s) / 2 - minX * s;
    view.oy = pad + (canvas.height - 2 * pad - spanY * s) / 2 - minY * s;
  }
  function tx(x) { return view.ox + x * view.scale; }
  function ty(y) { return view.oy + y * view.scale; }

  // --- drawing ------------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // The strip rectangle (drawn first, behind everything).
    if (cur.strip) {
      var d = cur.strip.halfWidth;
      var left = tx(cur.strip.midX - d), right = tx(cur.strip.midX + d);
      ctx.fillStyle = COL.strip;
      ctx.fillRect(left, 0, right - left, canvas.height);
      ctx.strokeStyle = COL.stripLine;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 4]);
      line(left, 0, left, canvas.height); line(right, 0, right, canvas.height);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // The current split line.
    if (cur.divide) {
      ctx.strokeStyle = COL.divide;
      ctx.lineWidth = 1.5;
      line(tx(cur.divide.midX), 0, tx(cur.divide.midX), canvas.height);
    }

    // All points as small grey dots.
    ctx.fillStyle = COL.pt;
    points.forEach(function (p) { dot(tx(p.x), ty(p.y), 3); });

    // The best pair so far: a green chord + emphasised endpoints.
    if (cur.best && cur.best.i >= 0) {
      var a = points[cur.best.i], b = points[cur.best.j];
      ctx.strokeStyle = COL.best; ctx.lineWidth = 2.5;
      line(tx(a.x), ty(a.y), tx(b.x), ty(b.y));
      ctx.fillStyle = COL.best;
      dot(tx(a.x), ty(a.y), 5); dot(tx(b.x), ty(b.y), 5);
    }

    // The pair being compared right now: an amber chord + endpoints.
    if (cur.compare) {
      var c = points[cur.compare.i], e = points[cur.compare.j];
      ctx.strokeStyle = COL.cmp; ctx.lineWidth = 1.5;
      line(tx(c.x), ty(c.y), tx(e.x), ty(e.y));
      ctx.fillStyle = COL.cmp;
      dot(tx(c.x), ty(c.y), 4); dot(tx(e.x), ty(e.y), 4);
    }
  }

  function dot(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  // --- frame stepping -----------------------------------------------------
  function applyFrame(f) {
    switch (f.type) {
      case "divide": cur.divide = { midX: f.midX }; cur.strip = null; break;
      case "base":   cur.strip = null; break;
      case "strip":  cur.strip = { midX: f.midX, halfWidth: f.halfWidth }; break;
      case "compare": cur.compare = { i: f.i, j: f.j }; break;
      case "best":   cur.best = { i: f.i, j: f.j, dist: f.dist }; break;
    }
  }

  function stepOnce() {
    if (frameIdx >= frames.length) { stop(); return false; }
    applyFrame(frames[frameIdx++]);
    return true;
  }

  function tick() {
    // Advance a batch of frames per animation tick; the batch size scales with
    // the speed slider so large inputs don't take forever.
    var speed = +$("speed").value;
    var batch = Math.max(1, Math.round(frames.length * (speed / 100) / 60));
    var alive = true;
    for (var i = 0; i < batch && alive; i++) { alive = stepOnce(); }
    // The compare highlight is momentary — clear it once we finish a batch,
    // unless we're at the very end.
    if (frameIdx >= frames.length) { cur.compare = null; }
    draw();
    if (!alive) { stop(); }
  }

  function play() {
    if (playing) return;
    if (frameIdx >= frames.length) { restartAnimation(); }
    playing = true;
    $("play").textContent = "⏸ Pause";
    var speed = +$("speed").value;
    var interval = Math.max(16, 120 - speed); // ms between ticks
    timer = setInterval(tick, interval);
  }
  function stop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    $("play").textContent = "▶ Play";
  }
  function restartAnimation() {
    frameIdx = 0;
    cur = { divide: null, strip: null, compare: null, best: null };
  }

  // --- wiring -------------------------------------------------------------
  function regenerate() {
    stop();
    var n = +$("count").value;
    points = C.makePoints($("shape").value, n, { w: 1000, h: 620 });
    computeView();
    runRace();
    prepareAnimation();
    draw();
  }

  function prepareAnimation() {
    restartAnimation();
    var res = C.run($("algo").value, points, { record: true });
    frames = res.frames || [];
  }

  function runRace() {
    var out = C.race(points);
    fillRow("brute", out.brute);
    fillRow("divide", out.divide);
    var sp = $("speedup");
    if (isFinite(out.speedup) && out.brute.evals > 0) {
      sp.innerHTML = "On these " + points.length + " points, divide-and-conquer used <strong>" +
        fmt(out.divide.evals) + "</strong> distance evaluations versus brute force's <strong>" +
        fmt(out.brute.evals) + "</strong> — about <strong>" + out.speedup.toFixed(1) +
        "×</strong> fewer" + (out.equalDist ? ", and both found the same closest distance." : ".");
    } else {
      sp.textContent = "";
    }
  }

  function fillRow(key, r) {
    var row = document.querySelector('tr[data-row="' + key + '"]');
    row.querySelector('[data-cell="evals"]').textContent = fmt(r.evals);
    row.querySelector('[data-cell="dist"]').textContent = isFinite(r.dist) ? r.dist.toFixed(2) : "—";
    row.querySelector('[data-cell="ms"]').textContent = r.ms.toFixed(2) + " ms";
  }

  function fmt(n) { return n.toLocaleString("en-US"); }

  // --- events -------------------------------------------------------------
  $("count").addEventListener("input", function () { $("count-out").textContent = this.value; });
  $("count").addEventListener("change", regenerate);
  $("shape").addEventListener("change", regenerate);
  $("algo").addEventListener("change", function () { stop(); prepareAnimation(); draw(); });
  $("regen").addEventListener("click", regenerate);
  $("reset").addEventListener("click", function () { stop(); prepareAnimation(); draw(); });
  $("play").addEventListener("click", function () { if (playing) { stop(); } else { play(); } });
  $("step").addEventListener("click", function () {
    stop();
    if (frameIdx >= frames.length) { restartAnimation(); }
    // Step to the next *meaningful* frame (skip past pure compares in a burst
    // so a single click visibly advances the state).
    stepOnce();
    cur.compare = frames[frameIdx - 1] && frames[frameIdx - 1].type === "compare"
      ? { i: frames[frameIdx - 1].i, j: frames[frameIdx - 1].j } : cur.compare;
    draw();
  });

  // Kick things off.
  regenerate();
})();
