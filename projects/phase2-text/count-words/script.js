/*
 * script.js — the browser glue for the Count Words in a String playground.
 *
 * All the real logic is in words-core.js (window.WORDS); this file reads the
 * textarea and renders the big total, the three rival counts, the highlighted
 * breakdown of what was counted and dropped, the dropped-token chips, and the
 * stats line.
 *
 * The ✓ Verified line runs the same cross-check the test suite does, live on
 * every keystroke: the per-code-point scan (scanWords) and the whole-string
 * whitespace split (regexWords) must return the same count AND the same ordered
 * word list. A regression would light up here, not just in CI.
 */
"use strict";
(function () {
  var W = window.WORDS;
  var $ = function (id) { return document.getElementById(id); };
  var input = $("input"), cpPill = $("cpPill"), stats = $("stats");
  var total = $("total"), descCount = $("descCount");
  var highlight = $("highlight"), compare = $("compare"), dropped = $("dropped");
  var verify = $("verify"), presetsBox = $("presets");

  var PRESETS = [
    { label: "plain", value: "The quick brown fox jumps over the lazy dog." },
    { label: "empty", value: "   " },
    { label: "punctuation", value: "hi -- there :) !!! ... — ok" },
    { label: "accents", value: "café, naïve, résumé — still three words" },
    { label: "odd spaces", value: "a b c　d e" },
    { label: "numbers", value: "Pay $3.14 for 42 apples by 2026" },
    { label: "emoji", value: "ship it 🚀 👍 done" },
    { label: "中文 (no spaces)", value: "你好世界这是一个句子" }
  ];

  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "preset"; b.textContent = p.label;
    b.addEventListener("click", function () { input.value = p.value; render(); });
    presetsBox.appendChild(b);
  });

  function esc(s) {
    return s.replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  // Render whitespace visibly: a middle dot for a space, ⏎ for a newline, →
  // for a tab, and a ␣-style marker for exotic spaces, all dimmed.
  function renderSpace(text) {
    var out = "";
    for (var ch of text) {
      if (ch === "\n") out += '<span class="wsdot">⏎\n</span>';
      else if (ch === "\t") out += '<span class="wsdot">→\t</span>';
      else if (ch === " ") out += '<span class="wsdot">·</span>';
      else out += '<span class="wsdot" title="U+' +
        ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0") +
        '">·</span>';
    }
    return out;
  }

  function render() {
    var s = input.value;
    var a = W.analyze(s);

    cpPill.textContent = a.codePoints + (a.codePoints === 1 ? " char" : " chars");
    total.textContent = a.count;
    descCount.textContent = a.codePoints;

    // ---- stats line ----
    var segTxt = a.segmenter.available ? String(a.segmenter.count) : "n/a";
    stats.innerHTML =
      statRow("Words (honest)", a.count) +
      statRow("Code points", a.codePoints) +
      statRow("Dropped non-word tokens", a.dropped.length) +
      statRow("Naive split(/\\s+/)", a.naive, a.naive !== a.count) +
      statRow("Segmenter word-like", segTxt, a.segmenter.available && a.segmenter.count !== a.count);

    // ---- three-way comparison ----
    var naiveOff = a.naive !== a.count;
    var segOff = a.segmenter.available && a.segmenter.count !== a.count;
    var html = "";
    html += '<div class="cmp honest"><span class="cmp-n">' + a.count +
      '</span><span class="cmp-l">honest<br>(letter/digit token)</span></div>';
    html += '<div class="cmp naive' + (naiveOff ? " off" : "") + '"><span class="cmp-n">' +
      a.naive + '</span><span class="cmp-l">naive<br>split(/\\s+/)</span></div>';
    html += '<div class="cmp seg' + (segOff ? " off" : "") + '"><span class="cmp-n">' +
      segTxt + '</span><span class="cmp-l">Unicode<br>Segmenter</span></div>';
    html += '<div class="cmp-note">' + compareNote(a, naiveOff, segOff) + '</div>';
    compare.innerHTML = html;

    // ---- highlighted breakdown ----
    if (s === "") {
      highlight.innerHTML = '<span class="ph">(type something above)</span>';
    } else {
      var hi = "";
      a.segments.forEach(function (seg) {
        if (seg.kind === "space") hi += renderSpace(seg.text);
        else if (seg.kind === "word") hi += '<mark class="w">' + esc(seg.text) + "</mark>";
        else hi += '<span class="nonword">' + esc(seg.text) + "</span>";
      });
      highlight.innerHTML = hi;
    }

    // ---- dropped chips ----
    if (a.dropped.length === 0) {
      dropped.innerHTML = '<span class="empty">nothing dropped — every token was a word.</span>';
    } else {
      dropped.innerHTML = a.dropped.map(function (t) {
        return '<span class="chip-tok">' + esc(t) + "</span>";
      }).join("");
    }

    // ---- live cross-check ----
    var scan = W.scanWords(s), rex = W.regexWords(s);
    var same = scan.count === rex.count &&
      scan.words.length === rex.words.length &&
      scan.words.every(function (w, i) { return w === rex.words[i]; });
    if (same) {
      verify.className = "verify ok";
      verify.textContent = "Verified live: the code-point scan and the whitespace " +
        "split agree — " + scan.count + " word" + (scan.count === 1 ? "" : "s") +
        ", same tokens, two independent code paths.";
    } else {
      verify.className = "verify bad";
      verify.textContent = "Mismatch: scan says " + scan.count + ", regex says " +
        rex.count + ". This should never happen.";
    }
  }

  function statRow(k, v, dim) {
    return '<div class="count-row' + (dim ? " dim" : "") + '">' +
      '<span class="k">' + k + '</span><span></span>' +
      '<span class="v">' + v + "</span></div>";
  }

  function compareNote(a, naiveOff, segOff) {
    var parts = [];
    if (naiveOff) {
      if (a.count === 0 && a.naive === 1) {
        parts.push('The naive one-liner counts the <span class="bad">empty / ' +
          'whitespace-only</span> string as <b>1</b> — its signature bug.');
      } else if (a.naive > a.count) {
        parts.push('The naive one-liner is <span class="bad">over</span> by <b>' +
          (a.naive - a.count) + '</b>: it counts pure-punctuation tokens as words.');
      } else {
        parts.push('The naive one-liner disagrees (<b>' + a.naive + '</b> vs <b>' +
          a.count + '</b>).');
      }
    }
    if (!a.segmenter.available) {
      parts.push('This runtime has no <code>Intl.Segmenter</code>, so the Unicode ' +
        'column is unavailable.');
    } else if (segOff) {
      parts.push('The <span class="warn">segmenter</span> sees <b>' + a.segmenter.count +
        '</b>: it finds word boundaries whitespace can’t — inside ' +
        'scriptio continua (Chinese, Japanese, Thai), and across hyphens. ' +
        'That gap is the ceiling on any whitespace rule.');
    }
    if (parts.length === 0) {
      parts.push('All three agree here. On plain spaced text with real words and ' +
        'no scriptio continua, they usually do — the gaps only open on the ' +
        'edge cases.');
    }
    return parts.join(" ");
  }

  input.addEventListener("input", render);
  input.value = PRESETS[0].value;
  render();
})();
