/*
 * script.js — the browser glue for the Fizz Buzz playground.
 *
 * All the real logic lives in fizzbuzz-core.js (window.FB); this file only
 * reads the controls, asks the engine for a labelled range + stats, paints the
 * grid, and runs a live in-browser verification against an independent
 * re-statement of the rules (the same idea the test suite's oracle uses).
 */
"use strict";
(function () {
  var FB = window.FB;

  // ---- state: the editable rules --------------------------------------------
  var rules = FB.classicRules();

  // ---- element handles ------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var rulesBox = $("rules"), ruleCount = $("ruleCount");
  var startIn = $("start"), endIn = $("end");
  var gridBox = $("grid"), outMeta = $("outMeta"), statsBox = $("stats");
  var verify = $("verify");

  // A fixed palette, cycled if there are more rules than colours.
  var WORD_VARS = ["--w0", "--w1", "--w2", "--w3"];
  function wordColor(i) { return "var(" + WORD_VARS[i % WORD_VARS.length] + ")"; }

  // ---- rule editors ---------------------------------------------------------
  function renderRules() {
    rulesBox.innerHTML = "";
    rules.forEach(function (rule, i) {
      var row = document.createElement("div");
      row.className = "rule";
      row.style.borderLeftColor = wordColor(i);

      var divWrap = document.createElement("div");
      divWrap.className = "div-wrap";
      var div = document.createElement("input");
      div.type = "number"; div.className = "divisor"; div.value = rule.divisor;
      div.min = "1"; div.setAttribute("aria-label", "divisor for rule " + (i + 1));
      var x = document.createElement("span"); x.className = "x"; x.textContent = "→";
      divWrap.appendChild(div); divWrap.appendChild(x);

      var word = document.createElement("input");
      word.type = "text"; word.className = "word"; word.value = rule.word;
      word.style.color = wordColor(i);
      word.setAttribute("aria-label", "word for rule " + (i + 1));

      var del = document.createElement("button");
      del.type = "button"; del.className = "danger-x"; del.textContent = "×";
      del.title = "Remove this rule";

      div.addEventListener("input", function () {
        rule.divisor = parseInt(div.value, 10);
        div.classList.toggle("invalid", !(rule.divisor >= 1));
        rebuild();
      });
      word.addEventListener("input", function () {
        rule.word = word.value;
        word.classList.toggle("invalid", word.value.length === 0);
        rebuild();
      });
      del.addEventListener("click", function () {
        rules.splice(i, 1); renderRules(); rebuild();
      });

      row.appendChild(divWrap); row.appendChild(word); row.appendChild(del);
      rulesBox.appendChild(row);
    });
    ruleCount.textContent = rules.length + (rules.length === 1 ? " rule" : " rules");
  }

  // Keep only the rules that are currently well-formed, so a half-typed word
  // doesn't blow up the whole render. Returns a normalised copy for the engine.
  function validRules() {
    var good = rules.filter(function (r) {
      return typeof r.divisor === "number" && isFinite(r.divisor) &&
             Math.floor(r.divisor) === r.divisor && r.divisor >= 1 &&
             typeof r.word === "string" && r.word.length > 0;
    });
    return good.map(function (r) { return { divisor: r.divisor, word: r.word }; });
  }

  // ---- the independent in-browser oracle ------------------------------------
  // Shares no code with FB.range; if the two ever disagree, the ✓ line turns
  // into a loud ✗ so a bug can never hide behind a pretty grid.
  function oracleText(n, rs) {
    var s = "";
    for (var i = 0; i < rs.length; i++) if (n % rs[i].divisor === 0) s += rs[i].word;
    return s === "" ? String(n) : s;
  }

  // ---- render the output ----------------------------------------------------
  function rebuild() {
    var rs = validRules();
    var start = parseInt(startIn.value, 10);
    var end = parseInt(endIn.value, 10);

    var badStart = !(startIn.value !== "" && isFinite(start));
    var badEnd = !(endIn.value !== "" && isFinite(end));
    startIn.classList.toggle("invalid", badStart);
    endIn.classList.toggle("invalid", badEnd);
    if (badStart || badEnd) {
      gridBox.innerHTML = '<p class="out-note">Enter a numeric range.</p>';
      statsBox.innerHTML = ""; outMeta.textContent = ""; setVerify(null); return;
    }

    var rows;
    try {
      rows = FB.range(start, end, rs);
    } catch (e) {
      gridBox.innerHTML = '<p class="out-note">' + escapeHtml(e.message) + '</p>';
      statsBox.innerHTML = ""; outMeta.textContent = ""; setVerify(null); return;
    }

    // Map each rule word to its colour index for tinting cells.
    var colorOfWord = {};
    rs.forEach(function (r, i) { if (!(r.word in colorOfWord)) colorOfWord[r.word] = i; });
    // First matching rule of a number decides the cell's accent colour.
    function firstHitColorIndex(n) {
      for (var i = 0; i < rs.length; i++) if (n % rs[i].divisor === 0) return i;
      return -1;
    }

    var frag = document.createDocumentFragment();
    var mismatch = -1;
    for (var k = 0; k < rows.length; k++) {
      var row = rows[k];
      // verify this line against the oracle
      if (mismatch < 0 && row.text !== oracleText(row.n, rs)) mismatch = row.n;

      var ci = firstHitColorIndex(row.n);
      var cell = document.createElement("div");
      cell.className = "cell " + (ci < 0 ? "plain" : "hit");
      if (ci >= 0) cell.style.setProperty("--c", wordColor(ci));
      var nEl = document.createElement("span"); nEl.className = "n"; nEl.textContent = row.n;
      var tEl = document.createElement("span"); tEl.className = "t"; tEl.textContent = row.text;
      cell.appendChild(nEl); cell.appendChild(tEl);
      frag.appendChild(cell);
    }
    gridBox.innerHTML = "";
    gridBox.appendChild(frag);
    outMeta.textContent = rows.length + " numbers";

    renderStats(start, end, rs);

    if (rs.length === 0) {
      setVerify(null, "No rules — every number prints as itself.");
    } else if (mismatch >= 0) {
      setVerify(false, "Mismatch at " + mismatch + " — engine and check disagree!");
    } else {
      setVerify(true, "Verified — all " + rows.length +
        " lines match an independent re-check of the rules.");
    }
  }

  function renderStats(start, end, rs) {
    var s = FB.stats(start, end, rs);
    statsBox.innerHTML = "";
    function line(label, count, color, isWord) {
      var el = document.createElement("div");
      el.className = "stat-line";
      var pct = s.total ? Math.round(count / s.total * 100) : 0;
      var lab = document.createElement("span");
      lab.className = "label" + (isWord ? " word-label" : "");
      if (color) lab.style.setProperty("--c", color);
      lab.textContent = label;
      var bar = document.createElement("div"); bar.className = "bar";
      var fill = document.createElement("i");
      fill.style.width = pct + "%";
      if (color) fill.style.setProperty("--c", color);
      bar.appendChild(fill);
      var num = document.createElement("span");
      num.className = "num";
      num.innerHTML = count + ' <span class="pct">(' + pct + '%)</span>';
      el.appendChild(lab); el.appendChild(bar); el.appendChild(num);
      statsBox.appendChild(el);
    }
    rs.forEach(function (r, i) {
      // Only show the first occurrence of a repeated word.
      if (rs.findIndex(function (x) { return x.word === r.word; }) === i) {
        line(r.word, s.perWord[r.word], wordColor(i), true);
      }
    });
    line("unmatched", s.plain, "var(--muted)", false);
  }

  function setVerify(state, msg) {
    verify.className = "verify" + (state === true ? " ok" : state === false ? " bad" : "");
    verify.textContent = msg || "";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---- presets & buttons ----------------------------------------------------
  var PRESETS = [
    { label: "1 – 100", start: 1, end: 100 },
    { label: "1 – 15", start: 1, end: 15 },
    { label: "1 – 30", start: 1, end: 30 },
    { label: "-15 – 15", start: -15, end: 15 },
    { label: "100 – 1 (down)", start: 100, end: 1 }
  ];
  (function buildPresets() {
    var box = $("presets");
    PRESETS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "preset"; b.textContent = p.label;
      b.addEventListener("click", function () {
        startIn.value = p.start; endIn.value = p.end; rebuild();
      });
      box.appendChild(b);
    });
  })();

  $("addRule").addEventListener("click", function () {
    rules.push({ divisor: 7, word: "Bazz" });
    renderRules(); rebuild();
  });
  $("reset").addEventListener("click", function () {
    rules = FB.classicRules();
    startIn.value = 1; endIn.value = 100;
    renderRules(); rebuild();
  });
  startIn.addEventListener("input", rebuild);
  endIn.addEventListener("input", rebuild);

  $("copyOut").addEventListener("click", function () {
    var rs = validRules();
    var start = parseInt(startIn.value, 10), end = parseInt(endIn.value, 10);
    if (!isFinite(start) || !isFinite(end)) return;
    var text;
    try {
      text = FB.range(start, end, rs).map(function (r) { return r.text; }).join("\n");
    } catch (e) { return; }
    var btn = $("copyOut");
    function done() { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Copy"; }, 1200); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  });

  // ---- go -------------------------------------------------------------------
  renderRules();
  rebuild();
})();
