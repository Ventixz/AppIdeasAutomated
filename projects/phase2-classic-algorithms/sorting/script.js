/*
 * script.js — the browser front end for Sorting Studio.
 *
 * All the sorting logic lives in sort-core.js; this file only drives the DOM:
 * it builds an array, asks the core to sort it *with frame recording on*, and
 * then replays those frames as an animation — colouring bars as they are
 * compared, written, marked as a pivot, or settled. The "race" panel reuses the
 * same core with recording off to tally comparisons and writes for all six.
 */
"use strict";
(function () {
  var S = window.SortCore;

  var el = {
    algo: document.getElementById("algo"),
    shape: document.getElementById("shape"),
    size: document.getElementById("size"),
    sizeVal: document.getElementById("sizeVal"),
    speed: document.getElementById("speed"),
    speedVal: document.getElementById("speedVal"),
    play: document.getElementById("play"),
    step: document.getElementById("step"),
    shuffle: document.getElementById("shuffle"),
    err: document.getElementById("err"),
    algoName: document.getElementById("algoName"),
    cmpCount: document.getElementById("cmpCount"),
    wrtCount: document.getElementById("wrtCount"),
    progress: document.getElementById("progress"),
    bars: document.getElementById("bars"),
    race: document.getElementById("race"),
    raceBig: document.getElementById("raceBig"),
    raceOut: document.getElementById("raceOut"),
    boardBody: document.getElementById("boardBody"),
    raceCap: document.getElementById("raceCap")
  };

  // Populate the algorithm dropdown from the core's registry.
  Object.keys(S.ALGORITHMS).forEach(function (key) {
    var o = document.createElement("option");
    o.value = key; o.textContent = S.ALGORITHMS[key].name;
    el.algo.appendChild(o);
  });

  // --- animation state ------------------------------------------------------
  var baseArray = [];   // the current (unsorted) input
  var frames = [];      // recorded operations to replay
  var barEls = [];      // one <div class="bar"> per array slot
  var cursor = 0;       // index into frames
  var timer = null;     // setInterval handle when playing
  var maxVal = 1;       // for scaling bar heights
  var comparisons = 0, writes = 0;
  var lastTouched = []; // bar indices to un-highlight next tick
  var settled = {};     // indices marked "done" — stay coloured

  function fmt(n) { return n.toLocaleString("en-US"); }

  function stopPlaying() {
    if (timer) { clearInterval(timer); timer = null; }
    el.play.textContent = "▶ Play";
  }

  // Build a fresh array from the current shape/size and lay out the bars.
  function rebuild() {
    stopPlaying();
    var n = parseInt(el.size.value, 10);
    baseArray = S.makeArray(el.shape.value, n);
    prepareAnimation();
  }

  // Record frames for the chosen algorithm over the current baseArray and
  // render the starting bars.
  function prepareAnimation() {
    stopPlaying();
    var key = el.algo.value;
    var res = S.run(key, baseArray, { record: true });
    frames = res.frames;
    cursor = 0;
    comparisons = 0; writes = 0;
    settled = {};
    lastTouched = [];
    el.algoName.textContent = res.name;
    if (!res.correct) { el.err.textContent = "internal error: sort produced wrong output"; }
    else { el.err.textContent = ""; }

    // working copy the animation mutates as it replays frames
    workView = baseArray.slice();
    maxVal = Math.max.apply(null, workView.concat([1]));
    renderBars(workView);
    updateStats();
  }

  var workView = [];

  function renderBars(arr) {
    el.bars.innerHTML = "";
    barEls = [];
    var n = arr.length;
    for (var i = 0; i < n; i++) {
      var b = document.createElement("div");
      b.className = "bar";
      b.style.height = (6 + (arr[i] / maxVal) * 100) + "%";
      el.bars.appendChild(b);
      barEls.push(b);
    }
  }

  function setHeight(i, v) {
    if (barEls[i]) { barEls[i].style.height = (6 + (v / maxVal) * 100) + "%"; }
  }

  function updateStats() {
    el.cmpCount.textContent = fmt(comparisons);
    el.wrtCount.textContent = fmt(writes);
    var pct = frames.length ? Math.round((cursor / frames.length) * 100) : 100;
    el.progress.textContent = pct + "% replayed";
  }

  // Clear the transient (compare/write/pivot) classes from the last step,
  // preserving any "done" markers.
  function clearTransient() {
    for (var i = 0; i < lastTouched.length; i++) {
      var idx = lastTouched[i];
      if (barEls[idx] && !settled[idx]) { barEls[idx].className = "bar"; }
      else if (barEls[idx]) { barEls[idx].className = "bar done"; }
    }
    lastTouched = [];
  }

  // Apply exactly one frame to the view. Returns false when frames are exhausted.
  function applyFrame() {
    if (cursor >= frames.length) { return false; }
    clearTransient();
    var f = frames[cursor++];
    if (f.type === "compare") {
      comparisons++;
      touch(f.i, "cmp"); touch(f.j, "cmp");
    } else if (f.type === "swap") {
      writes += 2;
      var tmp = workView[f.i]; workView[f.i] = workView[f.j]; workView[f.j] = tmp;
      setHeight(f.i, workView[f.i]); setHeight(f.j, workView[f.j]);
      touch(f.i, "wrt"); touch(f.j, "wrt");
    } else if (f.type === "set") {
      writes++;
      workView[f.index] = f.value;
      setHeight(f.index, f.value);
      touch(f.index, "wrt");
    } else if (f.type === "mark") {
      if (f.kind === "sorted") { settled[f.index] = true; if (barEls[f.index]) { barEls[f.index].className = "bar done"; } }
      else if (f.kind === "pivot") { touch(f.index, "pivot"); }
    }
    updateStats();
    return true;
  }

  function touch(i, cls) {
    if (barEls[i] && !settled[i]) { barEls[i].className = "bar " + cls; }
    lastTouched.push(i);
  }

  // Play: apply several frames per tick (scaled by the speed slider) so large
  // arrays finish in reasonable time without dropping the visual feel.
  function play() {
    if (cursor >= frames.length) { prepareAnimation(); }
    if (timer) { stopPlaying(); return; }
    el.play.textContent = "❚❚ Pause";
    timer = setInterval(function () {
      var perTick = parseInt(el.speed.value, 10); // 1..60 frames per tick
      var alive = true;
      for (var k = 0; k < perTick && alive; k++) { alive = applyFrame(); }
      if (!alive) { stopPlaying(); markAllDone(); }
    }, 16);
  }

  function markAllDone() {
    clearTransient();
    for (var i = 0; i < barEls.length; i++) { barEls[i].className = "bar done"; }
  }

  // --- race panel -----------------------------------------------------------
  function renderRace(input, label) {
    var out = S.race(input); // recording off — fast
    var body = el.boardBody;
    body.innerHTML = "";
    var maxCmp = Math.max.apply(null, out.leaderboard.map(function (k) { return out.results[k].comparisons; }).concat([1]));
    out.leaderboard.forEach(function (key, rank) {
      var r = out.results[key];
      var meta = S.ALGORITHMS[key];
      var tr = document.createElement("tr");
      if (rank === 0) { tr.className = "winner"; }
      var timeStr = r.ms < 1 ? "<1 ms" : r.ms.toFixed(1) + " ms";
      tr.innerHTML =
        '<td class="rank">' + (rank + 1) + "</td>" +
        '<td class="algo">' + meta.name + (meta.stable ? "" : ' <span class="muted-inline">(unstable)</span>') + "</td>" +
        '<td class="num">' + fmt(r.comparisons) + "</td>" +
        '<td class="num">' + fmt(r.writes) + "</td>" +
        '<td class="num">' + timeStr + "</td>" +
        '<td class="bounds">' + meta.best + " · " + meta.avg + " · " + meta.worst + "</td>";
      body.appendChild(tr);
    });
    var best = out.results[out.leaderboard[0]];
    var worst = out.results[out.leaderboard[out.leaderboard.length - 1]];
    var ratio = best.comparisons ? (worst.comparisons / best.comparisons) : 0;
    el.raceCap.innerHTML =
      "On " + label + ", <b>" + S.ALGORITHMS[out.leaderboard[0]].name + "</b> did the fewest comparisons (<b>" +
      fmt(best.comparisons) + "</b>), while <b>" + S.ALGORITHMS[out.leaderboard[out.leaderboard.length - 1]].name +
      "</b> did <b>" + fmt(worst.comparisons) + "</b> — about <b>" + ratio.toFixed(1) + "×</b> more.";
    el.raceOut.hidden = false;
  }

  // --- wire up --------------------------------------------------------------
  el.size.addEventListener("input", function () { el.sizeVal.textContent = el.size.value; });
  el.size.addEventListener("change", rebuild);
  el.speed.addEventListener("input", function () { el.speedVal.textContent = el.speed.value + "×"; });
  el.shape.addEventListener("change", rebuild);
  el.algo.addEventListener("change", prepareAnimation);
  el.play.addEventListener("click", play);
  el.step.addEventListener("click", function () {
    stopPlaying();
    if (cursor >= frames.length) { prepareAnimation(); }
    if (!applyFrame()) { markAllDone(); }
  });
  el.shuffle.addEventListener("click", rebuild);
  el.race.addEventListener("click", function () { renderRace(baseArray, "the current array (" + baseArray.length + " items)"); });
  el.raceBig.addEventListener("click", function () { renderRace(S.makeArray("random", 2000), "2,000 random values"); });

  // initial render
  el.sizeVal.textContent = el.size.value;
  el.speedVal.textContent = el.speed.value + "×";
  rebuild();
})();
