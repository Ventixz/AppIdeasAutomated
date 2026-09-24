/*
 * script.js — the thin UI layer for the Collatz demo.
 *
 * It reads the inputs, calls CollatzCore for every number, and paints the
 * result: the step count, the stats, a log-scaled trajectory chart, the raw
 * sequence, and the record hunt. No Collatz math of its own lives here.
 */
(function () {
  "use strict";
  var C = window.CollatzCore;

  var $ = function (id) { return document.getElementById(id); };
  var nInput = $("n"), mapSel = $("map"), errEl = $("err");
  var resultCard = $("resultCard"), stepsVal = $("stepsVal"), statement = $("statement");
  var statList = $("statList"), chart = $("chart"), chartCap = $("chartCap"), seqEl = $("seq");

  function commas(x) { return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // Ln of a BigInt, good enough for scaling bar heights across huge ranges.
  function lnBig(n) {
    if (n <= BigInt(0)) return 0;
    var s = n.toString();
    // ln(d.ddd... * 10^(len-1)) = ln(mantissa) + (len-1)*ln(10)
    var head = s.slice(0, 15);
    var mant = Number(head) / Math.pow(10, head.length - 1);
    return Math.log(mant) + (s.length - 1) * Math.LN10;
  }

  function statRow(tag, val) {
    var li = document.createElement("li");
    var a = document.createElement("span"); a.className = "mode-tag"; a.textContent = tag;
    var b = document.createElement("span"); b.className = "mode-val"; b.innerHTML = val;
    li.appendChild(a); li.appendChild(b);
    return li;
  }

  function drawChart(seq, peakIndex) {
    chart.innerHTML = "";
    var maxLn = 0;
    for (var i = 0; i < seq.length; i++) { var l = lnBig(seq[i]); if (l > maxLn) maxLn = l; }
    if (maxLn === 0) maxLn = 1;
    // Cap the number of bars drawn so a 900-step orbit stays legible.
    var CAP = 600;
    var stride = Math.ceil(seq.length / CAP);
    for (var j = 0; j < seq.length; j += stride) {
      var v = seq[j];
      var bar = document.createElement("div");
      bar.className = "bar";
      // colour by the step that PRODUCED this value (climb vs fall)
      if (j === 0) bar.classList.add("down");
      else bar.classList.add(v > seq[j - 1] ? "up" : "down");
      if (j === peakIndex || (stride > 1 && j <= peakIndex && peakIndex < j + stride)) {
        bar.classList.add("peak");
      }
      var h = Math.max(2, Math.round((lnBig(v) / maxLn) * 100));
      bar.style.height = h + "%";
      bar.title = commas(v.toString());
      chart.appendChild(bar);
    }
  }

  function renderSequence(seq, peakIndex) {
    // Show every value for short orbits; for long ones show head + tail.
    var parts = [];
    function tok(i) {
      var v = seq[i];
      var cls = [];
      if (i === peakIndex) cls.push("peakn");
      else if (i > 0 && v > seq[i - 1]) cls.push("odd");
      var s = commas(v.toString());
      return cls.length ? '<span class="' + cls.join(" ") + '">' + s + "</span>" : s;
    }
    var arrow = '<span class="arr">→</span>';
    if (seq.length <= 120) {
      for (var i = 0; i < seq.length; i++) parts.push(tok(i));
      seqEl.innerHTML = parts.join(arrow);
    } else {
      var head = [], tail = [];
      for (var a = 0; a < 60; a++) head.push(tok(a));
      for (var b = seq.length - 30; b < seq.length; b++) tail.push(tok(b));
      seqEl.innerHTML = head.join(arrow) + arrow +
        '<span class="arr">… ' + (seq.length - 90) + " more …</span>" +
        tail.join(arrow);
    }
  }

  function run() {
    errEl.textContent = "";
    try {
      var mode = mapSel.value;
      var r = mode === "shortcut" ? C.shortcut(nInput.value) : C.analyze(nInput.value);
      var mapName = mode === "shortcut" ? "shortcut map (3n+1)/2" : "standard map 3n+1";

      stepsVal.textContent = commas(r.steps);
      statement.innerHTML =
        "Starting from <b>" + commas(r.start.toString()) + "</b> under the " +
        mapName + ", the orbit reaches <b>1</b> after <b>" + commas(r.steps) +
        "</b> steps, peaking at <b>" + commas(r.peak.toString()) + "</b>.";

      statList.innerHTML = "";
      statList.appendChild(statRow("Total stopping time", "<span class='good'>" + commas(r.steps) + "</span> steps"));
      statList.appendChild(statRow("Highest value (altitude)", commas(r.peak.toString())));
      statList.appendChild(statRow("Peak reached at step", commas(r.peakIndex)));
      if (mode === "shortcut") {
        statList.appendChild(statRow("Up steps · down steps", commas(r.ups) + " · " + commas(r.downs)));
      } else {
        statList.appendChild(statRow("Even steps (halve) · odd steps (3n+1)", commas(r.evens) + " · " + commas(r.odds)));
      }
      statList.appendChild(statRow("Peak has this many digits", commas(r.peak.toString().length)));

      drawChart(r.sequence, r.peakIndex);
      chartCap.innerHTML = "Height is <b>log-scaled</b> (orbits span many orders of magnitude). " +
        "Amber bars are <b>climbs</b> (odd → 3n+1), blue bars are <b>falls</b> (even → n/2), " +
        "the green bar is the <b>peak</b>." +
        (r.sequence.length > 600 ? " Showing " + Math.min(600, r.sequence.length) + " of " + commas(r.sequence.length) + " values." : "");

      renderSequence(r.sequence, r.peakIndex);
      resultCard.hidden = false;
    } catch (e) {
      errEl.textContent = e.message;
      resultCard.hidden = true;
    }
  }

  // ---- record hunt --------------------------------------------------------
  var limitInput = $("limit"), recordsOut = $("recordsOut");
  var recordsList = $("recordsList"), recordsTiming = $("recordsTiming");

  function hunt() {
    errEl.textContent = "";
    try {
      var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
      var r = C.records(limitInput.value);
      var t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());

      recordsList.innerHTML = "";
      recordsList.appendChild(statRow(
        "Longest orbit in 1…" + commas(r.limit),
        "<span class='good'>" + commas(r.longest.n) + "</span> — " + commas(r.longest.steps) + " steps"
      ));
      recordsList.appendChild(statRow(
        "Highest altitude in 1…" + commas(r.limit),
        "<span class='good'>" + commas(r.highest.n) + "</span> — peaks at " + commas(r.highest.peak.toString())
      ));
      recordsList.appendChild(statRow(
        "Step records set along the way",
        r.recordSteps.length + " numbers (" +
          r.recordSteps.slice(-6).map(function (x) { return commas(x.n); }).join(", ") + " …)"
      ));
      recordsTiming.textContent = "Swept " + commas(r.limit) + " starting numbers in " +
        Math.round(t1 - t0) + " ms with memoisation.";
      recordsOut.hidden = false;
    } catch (e) {
      errEl.textContent = e.message;
      recordsOut.hidden = true;
    }
  }

  // ---- wiring -------------------------------------------------------------
  $("run").addEventListener("click", run);
  $("rand").addEventListener("click", function () {
    nInput.value = Math.floor(Math.random() * 1000000) + 1;
    run();
  });
  $("hunt").addEventListener("click", hunt);
  nInput.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
  mapSel.addEventListener("change", run);
  limitInput.addEventListener("keydown", function (e) { if (e.key === "Enter") hunt(); });
  Array.prototype.forEach.call(document.querySelectorAll(".preset"), function (btn) {
    btn.addEventListener("click", function () { nInput.value = btn.getAttribute("data-n"); run(); });
  });

  run(); // first paint
})();
