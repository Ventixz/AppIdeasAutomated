/*
 * script.js — the browser glue for the Check if Palindrome playground.
 *
 * All the real logic is in palindrome-core.js (window.PAL); this file reads the
 * textarea and the four option checkboxes, then renders the big YES/NO verdict,
 * the folded comparison form, the mirror pairing, the stats, and the naive-vs-
 * correct comparison.
 *
 * The ✓ Verified line runs the same cross-check the test suite does, live on
 * every keystroke: the two-pointer scan and the reverse-and-compare pass must
 * return the same verdict and the same first-mismatch index, and the verdict
 * must be unchanged when the input is pre-normalised to NFC and NFD (with
 * folding on). A regression would light up here, not just in CI.
 */
"use strict";
(function () {
  var PAL = window.PAL;
  var $ = function (id) { return document.getElementById(id); };
  var input = $("input"), cpPill = $("cpPill"), stats = $("stats");
  var verdict = $("verdict"), verdictDesc = $("verdictDesc");
  var folded = $("folded"), mirror = $("mirror"), compare = $("compare");
  var verify = $("verify"), presetsBox = $("presets");
  var optCase = $("optCase"), optAlnum = $("optAlnum"), optDia = $("optDia"), optCP = $("optCP");

  var PRESETS = [
    { label: "racecar", value: "racecar" },
    { label: "phrase", value: "A man, a plan, a canal: Panama" },
    { label: "RaceCar (case)", value: "RaceCar" },
    { label: "accents", value: "Éé vs eÉ" },
    { label: "emoji", value: "😀" },
    { label: "combining", value: "éé" },
    { label: "not one", value: "almost a palindrome" }
  ];

  // ---- presets --------------------------------------------------------------
  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "preset"; b.textContent = p.label;
    b.addEventListener("click", function () { input.value = p.value; render(); input.focus(); });
    presetsBox.appendChild(b);
  });

  function opts() {
    return {
      ignoreCase: optCase.checked,
      alnumOnly: optAlnum.checked,
      ignoreDiacritics: optDia.checked,
      granularity: optCP.checked ? "codepoint" : "grapheme"
    };
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // Show spaces and other invisibles as a visible placeholder glyph.
  function show(text) {
    if (text === " ") { return "␣"; }
    if (text === "\n") { return "⏎"; }
    if (text === "\t") { return "⇥"; }
    return esc(text);
  }

  function render() {
    var s = input.value;
    var o = opts();

    // char pill — report real characters (code points), not UTF-16 length
    var cpCount = Array.from(s).length;
    cpPill.textContent = cpCount + (cpCount === 1 ? " char" : " chars");

    if (s.length === 0) {
      verdict.textContent = "—"; verdict.className = "big";
      verdictDesc.innerHTML = "Type something above.";
      folded.innerHTML = '<span class="ph">(empty)</span>';
      mirror.innerHTML = '<span class="ph">Nothing to mirror yet.</span>';
      stats.innerHTML = "";
      compare.innerHTML = "";
      verify.textContent = ""; verify.className = "verify";
      return;
    }

    var a = PAL.analyze(s, o);

    // ---- big verdict --------------------------------------------------------
    verdict.textContent = a.isPalindrome ? "YES" : "NO";
    verdict.className = "big " + (a.isPalindrome ? "yes" : "no");
    if (a.comparedCount === 0) {
      verdictDesc.innerHTML = "Nothing left to compare after your filters — an " +
        "empty sequence counts as a palindrome.";
    } else if (a.isPalindrome) {
      verdictDesc.innerHTML = "The <b>" + a.comparedCount + "</b> compared " +
        (a.comparedCount === 1 ? "character reads" : "characters read") +
        " the same both ways.";
    } else {
      verdictDesc.innerHTML = "The mirror breaks at position <b>" +
        (a.mismatch + 1) + "</b> of " + a.comparedCount + ".";
    }

    // ---- folded comparison form --------------------------------------------
    var keptSet = {};
    a.kept.forEach(function (i) { keptSet[i] = true; });
    var fhtml = a.units.map(function (u, i) {
      var cls = keptSet[i] ? "u keep" : "u drop";
      return '<span class="' + cls + '">' + show(u.text) + "</span>";
    }).join("");
    folded.innerHTML = fhtml || '<span class="ph">(nothing)</span>';

    // ---- mirror pairing -----------------------------------------------------
    if (a.pairs.length === 0) {
      mirror.innerHTML = '<span class="ph">No letters or digits to compare.</span>';
    } else {
      mirror.innerHTML = a.pairs.map(function (p, idx) {
        var leftText = a.units[p.left].text;
        var rightText = a.units[p.right].text;
        var cls = "pair ";
        if (p.center) { cls += "center"; }
        else if (p.ok) { cls += "ok"; }
        else { cls += "bad"; }
        // dim everything after the first break — it never gets examined
        if (!a.isPalindrome && idx > a.mismatch) { cls += " after"; }
        var mark = p.center ? "•" : (p.ok ? "=" : "≠");
        // render as: top glyph (left char), middle mark, bottom glyph (mirror char)
        return '<span class="' + cls + '" title="position ' + (idx + 1) + '">' +
          '<span class="g">' + show(leftText) + "</span>" +
          '<span class="mk">' + mark + "</span>" +
          '<span class="lr">' + (p.center ? "mid" : show(rightText)) + "</span>" +
          "</span>";
      }).join("");
    }

    // ---- stats --------------------------------------------------------------
    var rows = [
      ["Comparison unit", o.granularity === "codepoint" ? "code point" : "grapheme"],
      ["Characters (code points)", String(a.codePointCount)],
      ["Compared", String(a.comparedCount)],
      ["Dropped (spaces, punctuation)", String(a.droppedCount)],
      ["UTF-16 length", String(a.utf16Length)]
    ];
    stats.innerHTML = rows.map(function (r, i) {
      var dim = (i === 3 && a.droppedCount === 0) ? " dim" : "";
      return '<div class="count-row' + dim + '"><span class="k">' + r[0] +
        '</span><span></span><span class="v">' + r[1] + "</span></div>";
    }).join("");

    // ---- naive comparison ---------------------------------------------------
    var engineYes = a.isPalindrome;
    var naiveYes = a.naive;
    var agree = engineYes === naiveYes;
    compare.className = "compare " + (agree ? "same" : "diff");
    var note;
    if (agree) {
      note = "Both say the same here. The one-liner is right on plain ASCII " +
        "with no filtering — which is exactly where people test it.";
    } else {
      note = "They <b>disagree</b>. The one-liner compares raw text exactly and " +
        "splits by UTF-16 unit; with your filters (or an emoji/accent in play) " +
        "that's a different question than the one you asked.";
    }
    compare.innerHTML =
      '<div class="cmp-col"><span class="cmp-n ' + (engineYes ? "yes" : "no") + '">' +
        (engineYes ? "YES" : "NO") + '</span><span class="cmp-l">this engine</span></div>' +
      '<div class="cmp-sep">' + (agree ? "=" : "≠") + "</div>" +
      '<div class="cmp-col"><span class="cmp-n ' + (naiveYes ? "yes" : "no") + '">' +
        (naiveYes ? "YES" : "NO") + '</span><span class="cmp-l">naive one-liner</span></div>' +
      '<div class="cmp-note ' + (agree ? "agree" : "disagree") + '">' + note + "</div>";

    // ---- live cross-check (same discipline as tests.js) ---------------------
    runVerify(s, o);
  }

  function runVerify(s, o) {
    try {
      var c = PAL.cleaned(s, o);
      var tp = PAL.twoPointer(c.keys);
      var rc = PAL.reverseCompare(c.keys);
      var implAgree = tp.isPalindrome === rc.isPalindrome && tp.mismatch === rc.mismatch;

      // normalisation invariance only holds when folding is on; otherwise NFC vs
      // NFD is a legitimately different string, so only assert it under folding.
      var normOk = true;
      if (o.ignoreDiacritics) {
        var v1 = PAL.isPalindrome(s.normalize("NFC"), o);
        var v2 = PAL.isPalindrome(s.normalize("NFD"), o);
        normOk = v1 === v2;
      }

      if (implAgree && normOk) {
        verify.className = "verify ok";
        verify.textContent = "Verified: two-pointer and reverse-compare agree" +
          (o.ignoreDiacritics ? ", and NFC/NFD give the same verdict." : ".");
      } else {
        verify.className = "verify bad";
        verify.textContent = "Cross-check FAILED — the two implementations disagree.";
      }
    } catch (e) {
      verify.className = "verify bad";
      verify.textContent = "Cross-check threw: " + e.message;
    }
  }

  input.addEventListener("input", render);
  [optCase, optAlnum, optDia, optCP].forEach(function (el) {
    el.addEventListener("change", render);
  });

  // seed with the textbook example
  input.value = "A man, a plan, a canal: Panama";
  render();
})();
