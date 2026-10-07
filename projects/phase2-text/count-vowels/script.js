/*
 * script.js — the browser glue for the Count Vowels playground.
 *
 * All the real logic is in vowels-core.js (window.CV); this file reads the
 * textarea and the two option checkboxes, then renders the big total, the
 * per-vowel histogram, the highlighted text, the stats line, and the naive-vs-
 * correct comparison.
 *
 * The ✓ Verified line runs the same cross-check the test suite does, live on
 * every keystroke: the per-code-point scan (analyze) and the whole-string regex
 * pass (countByRegex) must return the same total, and the count must be
 * unchanged when the input is pre-normalised to NFC and NFD. A regression would
 * light up here, not just in CI.
 */
"use strict";
(function () {
  var CV = window.CV;
  var $ = function (id) { return document.getElementById(id); };
  var input = $("input"), cpPill = $("cpPill"), stats = $("stats");
  var total = $("total"), totalDesc = $("totalDesc"), descCount = $("descCount");
  var histo = $("histo"), highlight = $("highlight"), compare = $("compare");
  var verify = $("verify"), presetsBox = $("presets");
  var optY = $("optY"), optK = $("optK");

  var PRESETS = [
    { label: "plain", value: "The quick brown fox jumps over the lazy dog." },
    { label: "accents", value: "café, naïve, résumé, jalapeño, Zoë, Über" },
    { label: "tricky y", value: "rhythm my sky gym happy yellow" },
    { label: "e, two ways", value: "café vs café — same word, counted the same" },
    { label: "ligature & maths", value: "ﬁsh \u{1D41A}\u{1D41E}\u{1D422}\u{1D428}\u{1D42E}" },
    { label: "all five", value: "sequoia facetious" },
    { label: "no vowels", value: "rhythm nth brr tsk xyz" }
  ];

  var VOWEL_ORDER = ["a", "e", "i", "o", "u", "y"];

  // ---- presets --------------------------------------------------------------
  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "preset"; b.textContent = p.label;
    b.addEventListener("click", function () { input.value = p.value; render(); });
    presetsBox.appendChild(b);
  });

  function opts() { return { includeY: optY.checked, compatibility: optK.checked }; }

  function esc(s) {
    return s.replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  // ---- render everything ----------------------------------------------------
  function render() {
    var s = input.value;
    var o = opts();
    var a = CV.analyze(s, o);

    cpPill.textContent = a.codePoints + (a.codePoints === 1 ? " char" : " chars");

    // big total
    total.textContent = a.total;
    descCount.textContent = a.codePoints;
    totalDesc.innerHTML = "in <span>" + a.codePoints + "</span> code point" +
      (a.codePoints === 1 ? "" : "s") +
      (a.distinct ? " · <span>" + a.distinct + "</span> distinct" : "");

    renderHisto(a, o);
    renderHighlight(s, a, o);
    renderStats(a);
    renderCompare(s, a);
    runVerify(s, a, o);
  }

  // ---- histogram ------------------------------------------------------------
  function renderHisto(a, o) {
    var order = VOWEL_ORDER.filter(function (v) { return v !== "y" || o.includeY; });
    var max = 1;
    order.forEach(function (v) { max = Math.max(max, a.byVowel[v]); });
    histo.innerHTML = "";
    order.forEach(function (v) {
      var n = a.byVowel[v];
      var row = document.createElement("div");
      row.className = "histo-row row-" + v + (n === 0 ? " zero" : "");
      row.innerHTML =
        '<span class="hv">' + v + '</span>' +
        '<span class="bar-track"><span class="bar" style="width:' +
          (n / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="hn">' + n + '</span>';
      histo.appendChild(row);
    });
  }

  // ---- highlighted text -----------------------------------------------------
  function renderHighlight(s, a, o) {
    if (s.length === 0) {
      highlight.innerHTML = '<span class="ph">— type some text —</span>';
      return;
    }
    // build a set of vowel code-point indices -> base letter
    var mark = {};
    a.positions.forEach(function (p) { mark[p.index] = p.base; });
    var cps = Array.from(s);
    var html = "";
    for (var i = 0; i < cps.length; i++) {
      var ch = cps[i];
      if (mark.hasOwnProperty(i)) {
        var base = mark[i];
        var shown = esc(ch).replace(/\n/g, "⏎").replace(/\t/g, "⇥");
        html += '<mark class="v-' + base + '" title="counts as ' + base + '">' +
          shown + '</mark>';
      } else {
        html += esc(ch).replace(/\n/g, "<br>").replace(/\t/g, "&nbsp;&nbsp;");
      }
    }
    highlight.innerHTML = html;
  }

  // ---- stats line -----------------------------------------------------------
  function renderStats(a) {
    stats.innerHTML = "";
    addStat("Vowels", a.total, false);
    addStat("Distinct vowels", a.distinct, a.distinct === 0);
    addStat("Letters", a.letters, a.letters === 0);
    addStat("Code points (characters)", a.codePoints, false);
    addStat("UTF-16 units (the misleading count)", a.units, a.units === a.codePoints);
  }
  function addStat(k, v, dim) {
    var row = document.createElement("div");
    row.className = "count-row" + (dim ? " dim" : "");
    row.innerHTML = '<span class="k">' + k + '</span><span></span>' +
      '<span class="v">' + v + '</span>';
    stats.appendChild(row);
  }

  // ---- naive vs correct -----------------------------------------------------
  function renderCompare(s, a) {
    var naive = CV.countNaive(s);
    var real = a.total;
    var diff = real - naive;
    var cls = diff === 0 ? "same" : "diff";
    compare.className = "compare " + cls;
    compare.innerHTML =
      '<div class="cmp-col"><span class="cmp-n">' + naive + '</span>' +
        '<span class="cmp-l">naive <code>/[aeiou]/gi</code></span></div>' +
      '<div class="cmp-sep">' + (diff === 0 ? "=" : "≠") + '</div>' +
      '<div class="cmp-col"><span class="cmp-n">' + real + '</span>' +
        '<span class="cmp-l">this page</span></div>' +
      '<div class="cmp-note">' +
        (diff === 0
          ? "Agreement — this text is in the naive one-liner's comfort zone."
          : "<b>" + diff + " vowel" + (Math.abs(diff) === 1 ? "" : "s") +
            "</b> the one-liner misses — accents, " +
            "styled letters" + (a.includeY ? ", or the y you asked for" : "") + ".") +
      '</div>';
  }

  // ---- live verification ----------------------------------------------------
  function runVerify(s, a, o) {
    // Property 1: the two implementations agree on the total.
    var regexTotal = CV.countByRegex(s, o);
    var agree = regexTotal === a.total;
    // Property 2: the count is invariant under canonical normalisation.
    var invariant =
      CV.countVowels(s.normalize("NFC"), o) === a.total &&
      CV.countVowels(s.normalize("NFD"), o) === a.total;

    var okAll = agree && invariant;
    verify.className = "verify " + (okAll ? "ok" : "bad");
    if (okAll) {
      verify.textContent = "Verified: the scan and the regex pass both count " +
        a.total + ", and the total is unchanged under NFC/NFD normalisation.";
    } else {
      verify.textContent = !agree
        ? "Verification FAILED — scan says " + a.total + ", regex says " + regexTotal + "."
        : "Verification FAILED — count changed under normalisation.";
    }
  }

  optY.addEventListener("change", render);
  optK.addEventListener("change", render);
  input.addEventListener("input", render);

  // open on something that shows the accent gap at once
  input.value = "café, naïve, résumé — not everyone counts the same.";
  render();
})();
