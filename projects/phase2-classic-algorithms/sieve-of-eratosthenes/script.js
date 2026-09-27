/*
 * script.js — the browser controller.
 *
 * It owns no algorithm logic: it asks sieve-core.js to run every algorithm
 * (filling the race table) and, for the classic sieve, to run again with
 * { record: true } so it can replay the recorded frames as a step-by-step
 * animation over a grid of numbers. The core stays DOM-free and Node-testable;
 * this file is all DOM.
 */
(function () {
  "use strict";
  var S = window.SieveCore;
  var $ = function (id) { return document.getElementById(id); };

  var gridEl = $("grid"), statusEl = $("status");
  var limitEl = $("limit"), limitOut = $("limit-out"), speedEl = $("speed");

  // --- state --------------------------------------------------------------
  var n = +limitEl.value;
  var cells = [];        // cells[k] = the DOM node for number k (index 0,1 unused-ish)
  var frames = [];       // recorded frames for the classic sieve
  var frameIdx = 0;
  var playing = false;
  var timer = null;
  var lastCross = [];    // cells amber from the previous step, to settle to composite
  var crossedOnce = {};  // k -> true once crossed (so re-crossings still settle right)

  // --- build the grid -----------------------------------------------------
  function cols(n) {
    // Aim for a roughly square grid, capped so cells stay legible.
    if (n <= 30) { return 10; }
    if (n <= 120) { return 12; }
    if (n <= 260) { return 16; }
    return 20;
  }

  function buildGrid() {
    n = +limitEl.value;
    gridEl.style.setProperty("--cols", cols(n));
    gridEl.innerHTML = "";
    cells = new Array(n + 1);
    for (var k = 1; k <= n; k++) {
      var c = document.createElement("div");
      c.className = "cell" + (k === 1 ? " one" : "");
      c.textContent = k;
      c.dataset.k = k;
      gridEl.appendChild(c);
      cells[k] = c;
    }
    resetVisual();
  }

  function resetVisual() {
    for (var k = 2; k <= n; k++) {
      cells[k].className = "cell";
    }
    lastCross = [];
    crossedOnce = {};
  }

  // --- prepare a fresh run ------------------------------------------------
  function prepare() {
    buildGrid();
    var rec = S.sieve(n, { record: true });
    frames = rec.frames;
    frameIdx = 0;
    runRace();
    setStatus("Ready — <strong>" + rec.count + "</strong> primes ≤ " + n +
              ". Press Play or Step.");
  }

  // --- apply one frame ----------------------------------------------------
  // Frames are: {type:"prime", p} and {type:"cross", k, by}. We settle any
  // cells left amber from the previous step into their final composite colour,
  // then apply the new frame.
  function settleAmber() {
    lastCross.forEach(function (k) {
      // Only settle to composite if it isn't (somehow) a prime cell.
      if (!cells[k].classList.contains("prime")) {
        cells[k].className = "cell composite";
      }
    });
    lastCross = [];
    // Un-highlight any striking prime from last step (keep it green).
    for (var k = 2; k <= n; k++) {
      if (cells[k].classList.contains("striking")) { cells[k].className = "cell prime"; }
    }
  }

  function applyFrame(f) {
    settleAmber();
    if (f.type === "prime") {
      cells[f.p].className = "cell prime";
      setStatus("<span class='p'>" + f.p + "</span> is prime — striking out its " +
                "multiples from <span class='p'>" + f.p + "²&nbsp;=&nbsp;" + (f.p * f.p) + "</span>.");
    } else if (f.type === "cross") {
      if (cells[f.by]) { cells[f.by].className = "cell striking"; }
      cells[f.k].className = "cell cross";
      lastCross.push(f.k);
      crossedOnce[f.k] = true;
    }
  }

  // Replay the whole tail instantly (used by Finish and when scrubbing to end).
  function finishAll() {
    stop();
    while (frameIdx < frames.length) { applyFrame(frames[frameIdx++]); }
    settleAmber();
    setStatus("Done — every composite crossed out. The green cells are the primes.");
  }

  function stepOnce() {
    if (frameIdx >= frames.length) { finishAll(); return false; }
    applyFrame(frames[frameIdx++]);
    if (frameIdx >= frames.length) {
      settleAmber();
      setStatus("Done — every composite crossed out. The green cells are the primes.");
      return false;
    }
    return true;
  }

  // --- playback -----------------------------------------------------------
  function delay() {
    // speed 1..100 -> ~220ms..8ms per frame
    var s = +speedEl.value;
    return Math.max(6, 230 - s * 2.2);
  }
  function play() {
    if (playing) { return; }
    if (frameIdx >= frames.length) { prepare(); }
    playing = true;
    $("play").textContent = "⏸ Pause";
    tick();
  }
  function tick() {
    if (!playing) { return; }
    var more = stepOnce();
    if (!more) { stop(); return; }
    timer = setTimeout(tick, delay());
  }
  function stop() {
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    $("play").textContent = "▶ Play";
  }

  function setStatus(html) { statusEl.innerHTML = html; }

  // --- the race table -----------------------------------------------------
  function runRace() {
    var r = S.race(n);
    var keys = ["trial", "sieve", "linear", "segmented"];
    keys.forEach(function (key) {
      var res = r.results[key];
      var row = document.querySelector('tr[data-row="' + key + '"]');
      row.querySelector('[data-cell="ops"]').textContent = res.ops.toLocaleString();
      row.querySelector('[data-cell="ms"]').textContent = res.ms.toFixed(2) + " ms";
    });
    var trial = r.results.trial.ops, sieve = r.results.sieve.ops;
    var factor = sieve > 0 ? (trial / sieve) : 0;
    var msg = "All four agree on the same <strong>" + r.results.sieve.count +
      "</strong> primes ≤ " + n + ". ";
    if (r.agree) {
      msg += "The sieve does <strong>" + factor.toFixed(1) + "×</strong> less work " +
        "than trial division, and the linear sieve crosses each composite " +
        "<strong>exactly once</strong> (" + r.results.linear.ops.toLocaleString() +
        " cross-outs = the composite count).";
    } else {
      msg = "⚠ The algorithms disagree — that would be a bug.";
    }
    $("summary").innerHTML = msg;
  }

  // --- prime tools --------------------------------------------------------
  var SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  function sup(num) { return String(num).split("").map(function (d) { return SUP[d]; }).join(""); }

  function doFactor() {
    var k = Math.floor(+$("factor-in").value);
    var out = $("factor-out");
    if (!(k >= 2) || !isFinite(k)) { out.textContent = "Enter an integer ≥ 2."; return; }
    if (k > 5e7) { out.textContent = "Keep it under 50,000,000 for a snappy answer."; return; }
    var lin = S.linear(k);
    var f = S.factorize(k, lin.spf);
    var str = f.map(function (e) {
      return e.power === 1 ? e.prime : e.prime + sup(e.power);
    }).join(" · ");
    out.textContent = k + " = " + str + (f.length === 1 && f[0].power === 1 ? "  (prime)" : "");
  }

  function doCount() {
    var k = Math.floor(+$("count-in").value);
    var out = $("count-out2");
    if (!(k >= 1) || !isFinite(k)) { out.textContent = "Enter an integer ≥ 1."; return; }
    if (k > 5e7) { out.textContent = "Keep it under 50,000,000 for a snappy answer."; return; }
    out.textContent = "π(" + k.toLocaleString() + ") = " + S.primeCount(k).toLocaleString();
  }

  // --- wiring -------------------------------------------------------------
  limitEl.addEventListener("input", function () {
    limitOut.textContent = limitEl.value;
    stop();
    prepare();
  });
  $("play").addEventListener("click", function () { playing ? stop() : play(); });
  $("step").addEventListener("click", function () { stop(); if (frameIdx >= frames.length) { prepare(); } stepOnce(); });
  $("finish").addEventListener("click", finishAll);
  $("reset").addEventListener("click", function () { stop(); prepare(); });

  $("factor-btn").addEventListener("click", doFactor);
  $("count-btn").addEventListener("click", doCount);
  $("factor-in").addEventListener("keydown", function (e) { if (e.key === "Enter") { doFactor(); } });
  $("count-in").addEventListener("keydown", function (e) { if (e.key === "Enter") { doCount(); } });

  // --- boot ---------------------------------------------------------------
  limitOut.textContent = limitEl.value;
  prepare();
})();
