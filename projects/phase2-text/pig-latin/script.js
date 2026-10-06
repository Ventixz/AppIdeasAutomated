/*
 * script.js — the browser glue for the Pig Latin playground.
 *
 * All the real logic is in piglatin-core.js (window.PL); this file reads the
 * textarea, renders the translated text, the per-word onset/rest/suffix
 * breakdown, and the census of cases, and drives the decode-ambiguity box.
 *
 * The ✓ Verified line runs the same cross-check the test suite does, live on
 * every keystroke: the two independent onset implementations (onsetLength, a
 * forward scan, and onsetLengthOracle, a first-vowel search with a qu fix-up)
 * must agree on every word on screen, and the text must round-trip through
 * tokenize/detokenize unchanged. A regression would light up here, not just
 * in CI.
 */
"use strict";
(function () {
  var PL = window.PL;
  var $ = function (id) { return document.getElementById(id); };
  var input = $("input"), wordPill = $("wordPill"), counts = $("counts");
  var output = $("output"), breakdown = $("breakdown"), verify = $("verify");
  var presetsBox = $("presets"), stylesBox = $("styles");
  var decodeIn = $("decodeIn"), cands = $("cands"), candsNote = $("candsNote");
  var copyBtn = $("copyBtn");

  var style = "way";

  var PRESETS = [
    { label: "pangram", value: "The quick brown fox jumps over the lazy dog." },
    { label: "onset clusters", value: "smile glove string scratch" },
    { label: "vowel words", value: "apple eat igloo out" },
    { label: "tricky y", value: "yellow my rhythm sky gym" },
    { label: "qu digraph", value: "quiet quick square squid" },
    { label: "caps & punctuation", value: "Hello, world! I'm here." },
    { label: "no vowels", value: "nth brr tsk" }
  ];

  var STYLES = [
    { id: "way", label: "apple → appleway" },
    { id: "yay", label: "apple → appleyay" },
    { id: "ay", label: "apple → appleay" }
  ];

  // ---- presets --------------------------------------------------------------
  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "preset"; b.textContent = p.label;
    b.addEventListener("click", function () { input.value = p.value; render(); });
    presetsBox.appendChild(b);
  });

  // ---- suffix-style toggle --------------------------------------------------
  STYLES.forEach(function (s) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "style-btn" + (s.id === style ? " on" : "");
    b.dataset.id = s.id; b.textContent = s.label;
    b.addEventListener("click", function () {
      style = s.id;
      Array.prototype.forEach.call(stylesBox.children, function (c) {
        c.classList.toggle("on", c.dataset.id === style);
      });
      render();
    });
    stylesBox.appendChild(b);
  });

  // ---- render everything ----------------------------------------------------
  function render() {
    var s = input.value;
    var opts = { style: style };
    var rows = PL.encodeDetailed(s, opts);
    var a = PL.analyze(s, opts);

    wordPill.textContent = a.words + (a.words === 1 ? " word" : " words");

    // translated text
    output.textContent = PL.encode(s, opts) || "—";

    // census
    counts.innerHTML = "";
    addCount("Words", a.words, false);
    addCount("Vowel-initial (→ " + suffixFor() + ")", a.vowelInitial, a.vowelInitial === 0);
    addCount("Consonant-initial (→ ay)", a.consonantInitial, a.consonantInitial === 0);
    addCount("Used the qu digraph", a.qu, a.qu === 0);
    addCount("Word-initial y (a consonant)", a.initialY, a.initialY === 0);
    addCount("No vowel at all", a.noVowel, a.noVowel === 0);

    // per-word breakdown
    renderBreakdown(rows);

    // verification
    runVerify(s, rows);
  }

  function suffixFor() {
    return style === "way" ? "way" : style === "yay" ? "yay" : "ay";
  }

  function addCount(k, v, dim) {
    var row = document.createElement("div");
    row.className = "count-row" + (dim ? " dim" : "");
    row.innerHTML = '<span class="k">' + k + '</span><span></span>' +
      '<span class="v">' + v + '</span>';
    counts.appendChild(row);
  }

  function esc(s) {
    return s.replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  function renderBreakdown(rows) {
    if (rows.length === 0) {
      breakdown.innerHTML = '<p class="breakdown-empty">— type some words —</p>';
      return;
    }
    var html = '<table class="breakdown"><thead><tr>' +
      '<th>word</th><th>split</th><th>result</th><th>why</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var split = r.vowelInitial
        ? '<span class="rest">' + esc(r.rest || r.original.toLowerCase()) + '</span>'
        : '<span class="rest">' + esc(r.rest) + '</span>·<span class="onset">' + esc(r.onset) + '</span>';
      var resHtml = r.vowelInitial
        ? '<span class="rest">' + esc(r.result.slice(0, r.result.length - r.suffix.length)) +
          '</span><span class="suffix">' + esc(r.result.slice(r.result.length - r.suffix.length)) + '</span>'
        : '<span class="rest">' + esc(r.result.slice(0, r.rest.length)) + '</span>' +
          '<span class="onset">' + esc(r.result.slice(r.rest.length, r.rest.length + r.onset.length)) + '</span>' +
          '<span class="suffix">' + esc(r.result.slice(r.rest.length + r.onset.length)) + '</span>';
      var tags = [];
      if (r.vowelInitial) tags.push('<span class="tag vowel">vowel start</span>');
      if (r.usedQu) tags.push('<span class="tag qu">qu unit</span>');
      if (r.usedInitialY) tags.push('<span class="tag yy">y = consonant</span>');
      if (r.noVowel) tags.push('<span class="tag novowel">no vowel</span>');
      html += '<tr>' +
        '<td class="mono orig">' + esc(r.original) + '</td>' +
        '<td class="mono">' + split + '</td>' +
        '<td class="mono res">' + resHtml + '</td>' +
        '<td><div class="tags">' + tags.join("") + '</div></td>' +
        '</tr>';
    });
    html += "</tbody></table>";
    breakdown.innerHTML = html;
  }

  // ---- live verification ----------------------------------------------------
  function runVerify(s, rows) {
    // Property 1: the two onset implementations agree on every word on screen.
    var oracleOk = true, firstBad = null;
    rows.forEach(function (r) {
      if (PL.onsetLength(r.original) !== PL.onsetLengthOracle(r.original)) {
        oracleOk = false; if (!firstBad) firstBad = r.original;
      }
    });
    // Property 2: the text round-trips exactly through tokenize/detokenize.
    var roundTrip = PL.detokenize(PL.tokenize(s)) === s;

    var okAll = oracleOk && roundTrip;
    verify.className = "verify " + (okAll ? "ok" : "bad");
    if (okAll) {
      verify.textContent = rows.length
        ? "Verified: both onset implementations agree on all " + rows.length +
          " word" + (rows.length === 1 ? "" : "s") + ", and every non-letter is preserved in place."
        : "Verified: ready.";
    } else {
      verify.textContent = !oracleOk
        ? "Verification FAILED — onset implementations disagree on " + JSON.stringify(firstBad) + "."
        : "Verification FAILED — text did not round-trip.";
    }
  }

  // ---- decode box -----------------------------------------------------------
  function renderDecode() {
    var raw = decodeIn.value.trim();
    cands.innerHTML = "";
    if (!raw || !/^[A-Za-z]+$/.test(raw)) {
      candsNote.innerHTML = raw
        ? "Enter a single run of letters (no spaces or punctuation)."
        : "";
      return;
    }
    var list = PL.decodeCandidates(raw, { style: style });
    if (list.length === 0) {
      candsNote.innerHTML = "No valid pre-image under the current suffix style — " +
        "try the <code>" + suffixFor() + "</code> style, or it simply isn't well-formed Pig Latin.";
      return;
    }
    list.forEach(function (w) {
      var c = document.createElement("span");
      c.className = "cand";
      c.textContent = w;
      // mark the candidate that, re-encoded, matches the input via the simplest
      // (shortest-onset) reading — a visual anchor, not a claim it's "the" word.
      cands.appendChild(c);
    });
    if (list.length === 1) {
      candsNote.innerHTML = "Exactly one pre-image here — but that's luck, not a rule.";
    } else {
      candsNote.innerHTML = "<b>" + list.length + " valid originals.</b> The rules " +
        "alone can't tell which you meant — Pig Latin is <b>not invertible</b>. " +
        "(Most pre-images aren't English words, but the transform has no dictionary to know that.)";
    }
  }

  // ---- copy -----------------------------------------------------------------
  copyBtn.addEventListener("click", function () {
    var text = PL.encode(input.value, { style: style });
    var done = function () {
      copyBtn.textContent = "copied"; setTimeout(function () { copyBtn.textContent = "copy"; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else { done(); }
  });

  input.addEventListener("input", render);
  decodeIn.addEventListener("input", renderDecode);

  // open on something that shows the rules at once
  input.value = "Pig Latin is quite fun, yes?";
  decodeIn.value = "appleway";   // decodes to both "apple" and "wapple"
  render();
  renderDecode();
})();
