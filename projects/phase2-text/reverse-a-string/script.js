/*
 * script.js — the browser glue for the Reverse a String playground.
 *
 * All the real logic lives in reverse-core.js (window.RS); this file reads the
 * textarea, renders the three reversal levels plus the word-order variant,
 * shows the code-unit / code-point / grapheme counts and the grapheme
 * breakdown, and runs a live verification. The verification uses the same
 * trick as the test suite's oracle: when the browser provides Intl.Segmenter,
 * the engine's grapheme reversal is re-checked against it on every keystroke,
 * so a regression would show up on the page, not just in CI. It also confirms
 * that reversing the grapheme reversal returns the original (an involution).
 */
"use strict";
(function () {
  var RS = window.RS;
  var $ = function (id) { return document.getElementById(id); };
  var input = $("input"), lenPill = $("lenPill"), counts = $("counts");
  var chips = $("chips"), levelsBox = $("levels"), verify = $("verify");
  var presetsBox = $("presets");

  // An independent oracle, if the platform has one.
  var seg = (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function")
    ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
  function oracleGraphemes(s) {
    var out = [], it = seg.segment(s)[Symbol.iterator]();
    for (var r = it.next(); !r.done; r = it.next()) out.push(r.value.segment);
    return out;
  }

  // The four reversals, described for the cards. `safe` is computed per-input.
  var LEVELS = [
    {
      name: 'Code units — <code>split("").reverse()</code>',
      desc: "The literal one-liner. Reverses raw UTF-16 code units.",
      fn: function (s) { return RS.reverseCodeUnits(s); },
      note: "An astral character (emoji, 𝐁old math letters) is two code units; " +
            "reversed separately they form a broken pair — shown as �."
    },
    {
      name: "Code points — <code>[...s].reverse()</code>",
      desc: "Reverses Unicode code points. Astral characters survive whole.",
      fn: function (s) { return RS.reverseCodePoints(s); },
      note: "A combining accent or a multi-code-point emoji (a 🇺🇸 flag, a " +
            "👨‍👩‍👧 family) still comes apart — its pieces reverse independently."
    },
    {
      name: "Grapheme clusters — the characters you see",
      desc: "Reverses user-perceived characters (UAX #29). This is what you mean.",
      fn: function (s) { return RS.reverseGraphemes(s); },
      note: ""
    },
    {
      name: "Word order",
      desc: "Flips the order of words; each word stays forward.",
      fn: function (s) { return RS.reverseWords(s); },
      note: "",
      alwaysSafe: true
    }
  ];

  var PRESETS = [
    { label: "plain text", value: "Hello, world!" },
    { label: "café (combining)", value: "café au lait" },      // e + ◌́
    { label: "emoji 😀👍", value: "I ❤️ code \u{1F600}\u{1F44D}" },
    { label: "flags 🇺🇸🇯🇵", value: "\u{1F1FA}\u{1F1F8} \u{1F1EF}\u{1F1F5} go" },
    { label: "family 👨‍👩‍👧", value: "a \u{1F468}‍\u{1F469}‍\u{1F467} z" },
    { label: "skin tone 👍🏽", value: "nice \u{1F44D}\u{1F3FD}" },
    { label: "math 𝐁old", value: "\u{1D400}\u{1D401}\u{1D402}" }
  ];

  // ---- build the static level cards once ------------------------------------
  LEVELS.forEach(function (lv, i) {
    var card = document.createElement("div");
    card.className = "level";
    card.id = "lv" + i;
    card.innerHTML =
      '<div class="head"><span class="name">' + lv.name + '</span>' +
      '<span class="badge" id="badge' + i + '"></span></div>' +
      '<p class="desc">' + lv.desc + '</p>' +
      '<div class="out" id="out' + i + '"></div>' +
      (lv.note ? '<p class="note" id="note' + i + '">' + lv.note + '</p>' : '');
    levelsBox.appendChild(card);
  });

  // ---- presets --------------------------------------------------------------
  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "preset"; b.textContent = p.label;
    b.addEventListener("click", function () { input.value = p.value; render(); });
    presetsBox.appendChild(b);
  });

  // ---- render everything ----------------------------------------------------
  function render() {
    var s = input.value;
    var a = RS.analyze(s);
    var correct = RS.reverseGraphemes(s);

    lenPill.textContent = a.codeUnits + (a.codeUnits === 1 ? " char" : " chars");

    // the three counts
    counts.innerHTML = "";
    addCount("Code units", a.codeUnits, "<code>s.length</code> — UTF-16 units");
    addCount("Code points", a.codePoints, "<code>[...s].length</code>");
    addCount("Graphemes", a.graphemes, "what a reader counts");

    // grapheme chips
    renderChips(s);

    // the reversal cards
    LEVELS.forEach(function (lv, i) {
      var outEl = $("out" + i), badge = $("badge" + i), card = $("lv" + i);
      var result = lv.fn(s);
      outEl.textContent = result;
      var safe = lv.alwaysSafe ? true : (result === correct);
      card.classList.toggle("safe", safe);
      card.classList.toggle("unsafe", !safe);
      outEl.classList.toggle("bad-out", !safe);
      badge.textContent = lv.alwaysSafe ? "variant"
        : (safe ? "✓ matches the characters" : "✗ corrupts this text");
      badge.className = "badge " + (safe ? "safe" : "unsafe");
      var note = $("note" + i);
      if (note) note.style.display = safe ? "none" : "block";
    });

    // live verification against the independent oracle
    runVerify(s, correct);
  }

  function addCount(k, v, extra) {
    var row = document.createElement("div");
    row.className = "count-row";
    row.innerHTML = '<span class="k">' + k + '</span>' +
      '<span class="small">' + extra + '</span>' +
      '<span class="v">' + v + '</span>';
    counts.appendChild(row);
  }

  function renderChips(s) {
    chips.innerHTML = "";
    var gs = RS.graphemes(s);
    if (gs.length === 0) {
      var e = document.createElement("span");
      e.className = "chips-empty"; e.textContent = "— nothing yet —";
      chips.appendChild(e);
      return;
    }
    gs.forEach(function (g) {
      var c = document.createElement("span");
      c.className = "chip";
      // a grapheme built from more than one code point is the interesting kind
      if (Array.from(g).length > 1) c.className += " multi";
      c.textContent = g === " " ? "␣" : (g === "\n" ? "↵" : g); // visible space/newline
      c.title = Array.from(g).map(function (cp) {
        return "U+" + cp.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      }).join(" ");
      chips.appendChild(c);
    });
  }

  function runVerify(s, correct) {
    // Property 1: grapheme reversal is an involution.
    var involution = RS.reverseGraphemes(correct) === s;
    // Property 2 (if available): matches the platform's own segmenter.
    var matchesOracle = true, oracleMsg = "";
    if (seg) {
      matchesOracle = oracleGraphemes(s).reverse().join("") === correct;
      oracleMsg = " and matches the platform's Intl.Segmenter";
    } else {
      oracleMsg = " (Intl.Segmenter not available to cross-check)";
    }
    var okAll = involution && matchesOracle;
    verify.className = "verify " + (okAll ? "ok" : "bad");
    verify.textContent = okAll
      ? "Verified: reversing the grapheme reversal returns the original" + oracleMsg + "."
      : "Verification FAILED — the reversal is not self-consistent.";
  }

  input.addEventListener("input", render);
  input.value = PRESETS[2].value;   // open on the emoji example
  render();
})();
