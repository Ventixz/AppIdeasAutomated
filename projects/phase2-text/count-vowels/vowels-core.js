/*
 * vowels-core.js — the engine behind the Count Vowels playground.
 *
 * "Count the vowels" sounds like one regex: `str.match(/[aeiou]/gi).length`.
 * Type that and `cat` returns 1 and you feel finished. You are not, and every
 * place the one-liner is quietly wrong is where this file lives:
 *
 *   1. REAL TEXT HAS ACCENTS. `café` has two vowels (a, e), but `/[aeiou]/i`
 *      scores it 1 — the `é` is a different code point and never matches. The
 *      fix is to normalise each character to its base letter + a combining mark
 *      (Unicode NFD), drop the mark, and judge the base. Then `café → a, e`,
 *      `naïve → a, i, e`, `résumé → e, u, e`. `ñ` decomposes to `n` + a tilde,
 *      so it is correctly NOT counted; `ü → u` is.
 *
 *   2. `y` IS A VOWEL SOMETIMES. The same slipperiness Pig Latin has: `y` is a
 *      vowel in `rhythm` and `my` and a consonant in `yes`. There is no single
 *      right answer, so it is the one thing the caller gets to choose
 *      (`includeY`), and it is reported in its own column either way.
 *
 *   3. WHAT IS "ONE CHARACTER" IS A CHOICE. A UTF-16 `.length` counts `é`
 *      (NFC) as 1 but its decomposed twin as 2, and an astral letter like the
 *      maths-bold `𝐚` as 2. This engine counts by Unicode CODE POINT
 *      (Array.from), so every count is about letters, not storage.
 *
 *   4. LIGATURES AND LOOK-ALIKES HIDE VOWELS. The single character `ﬁ` *is* an
 *      `f` and an `i`; the maths-bold `𝐚` *is* an `a`. Canonical NFD leaves
 *      them alone (an honest "I don't count fancy look-alikes"); COMPATIBILITY
 *      decomposition (NFKD) folds them to `fi` and `a` and then the `i` and the
 *      `a` count. Which behaviour you want is a real decision, so it is the
 *      second option (`compatibility`).
 *
 * The rule is implemented TWICE, two structurally different ways, so the test
 * suite and the live page can cross-check one against the other — the same
 * "two independent implementations must agree" discipline the Pig Latin and
 * Reverse a String projects used:
 *
 *   - `analyze`      walks the string one code point at a time, normalising and
 *                    judging each in isolation, and accumulates the histogram,
 *                    the distinct set and the per-position contributions.
 *   - `countByRegex` normalises the WHOLE string at once, strips every combining
 *                    mark with `\p{M}`, and counts matches of a single character
 *                    class in one pass.
 *
 * They share no code path and must return the same total on every input. On the
 * ASCII subset — where the naive `/[aeiou]/gi` one-liner is actually correct —
 * both are also checked against that trivial oracle, so the Unicode machinery is
 * pinned to the obvious answer exactly where the obvious answer is right.
 *
 * The module is dependency-free and never touches the DOM. Loaded with a
 * <script> tag it attaches to window.CV; under Node it is module.exports.
 */
"use strict";

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;          // Node / the test runner
  } else {
    root.CV = api;                 // the browser
  }
})(typeof self !== "undefined" ? self : this, function () {

  var BASE_VOWELS = "aeiou";       // the five Latin vowel letters
  var MARKS = /\p{M}/gu;           // any combining mark (Mn, Mc, Me)

  // Which base letters count, given the options. `y` is the only negotiable
  // one; everything else about "vowelness" is fixed.
  function vowelSet(opts) {
    var set = { a: true, e: true, i: true, o: true, u: true };
    if (opts && opts.includeY) set.y = true;
    return set;
  }

  // The normalisation form to fold a character to its base letter(s).
  //   canonical (NFD)      — accents come off, look-alikes stay as they are
  //   compatibility (NFKD) — also folds ligatures, maths/fullwidth styles, …
  function form(opts) {
    return (opts && opts.compatibility) ? "NFKD" : "NFD";
  }

  // Reduce ONE input code point to the base letters it contributes: normalise
  // it, strip combining marks, lowercase. The result can be:
  //   ""     a bare combining mark, a digit, a space, punctuation, emoji …
  //   "e"    an ordinary letter or an accented one (é, ü, å → e, u, a)
  //   "fi"   a ligature under compatibility folding — note: MORE than one letter
  // Returning a string (not a single char) is what lets one source character
  // legitimately contribute several vowels, and keeps the two implementations
  // in agreement on ligatures.
  function baseLetters(cp, opts) {
    return cp.normalize(form(opts)).replace(MARKS, "").toLowerCase();
  }

  // --- implementation #1: a per-code-point scan ------------------------------
  // The rich pass. Walks code points, folds each to its base letters, and tallies
  // a full report: the total, a per-vowel histogram, the distinct letters seen,
  // running counts of all characters/code points/letters, and — for the UI's
  // highlighter — how many vowels each ORIGINAL code point contributed.
  function analyze(text, opts) {
    requireString(text);
    var set = vowelSet(opts);
    var cps = Array.from(text);

    var byVowel = { a: 0, e: 0, i: 0, o: 0, u: 0, y: 0 };
    var total = 0, letters = 0;
    var positions = [];            // one entry per original code point that is a vowel

    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i];
      var base = baseLetters(cp, opts);
      // is this code point a "letter" at all? (for the stats line)
      if (base && /\p{L}/u.test(base)) letters++;

      var hits = 0, firstBase = null;
      for (var j = 0; j < base.length; j++) {
        var c = base[j];
        if (set[c]) {
          byVowel[c]++; total++; hits++;
          if (firstBase === null) firstBase = c;
        }
      }
      if (hits > 0) {
        positions.push({ index: i, char: cp, base: firstBase, hits: hits });
      }
    }

    var distinct = 0;
    Object.keys(byVowel).forEach(function (k) { if (byVowel[k] > 0) distinct++; });

    return {
      total: total,
      byVowel: byVowel,
      distinct: distinct,
      positions: positions,
      codePoints: cps.length,       // "characters" the honest way
      units: text.length,           // UTF-16 code units — the misleading way
      letters: letters,
      includeY: !!(opts && opts.includeY),
      compatibility: !!(opts && opts.compatibility)
    };
  }

  // Convenience: just the number.
  function countVowels(text, opts) { return analyze(text, opts).total; }

  // --- implementation #2: a whole-string regex pass --------------------------
  // Deliberately structured differently from analyze: normalise the ENTIRE
  // string once, strip ALL combining marks in one shot, then count matches of a
  // single character class. No per-code-point loop, no histogram — just the
  // total. Must equal analyze(text).total on every input; that agreement is
  // what the tests and the live page assert.
  function countByRegex(text, opts) {
    requireString(text);
    var folded = text.normalize(form(opts)).replace(MARKS, "").toLowerCase();
    var cls = (opts && opts.includeY) ? "aeiouy" : "aeiou";
    var re = new RegExp("[" + cls + "]", "gu");
    var m = folded.match(re);
    return m ? m.length : 0;
  }

  // --- the naive one-liner, kept honest --------------------------------------
  // The thing everyone writes first. It is correct ONLY on ASCII letters with
  // `y` excluded; the suite uses it as an oracle on exactly that subset, and the
  // page shows it side by side so the gap on real text is visible, not asserted.
  function countNaive(text) {
    requireString(text);
    var m = text.match(/[aeiou]/gi);
    return m ? m.length : 0;
  }

  // --- helpers ---------------------------------------------------------------
  function requireString(s) {
    if (typeof s !== "string") throw new TypeError("expected a string");
  }

  return {
    analyze: analyze,
    countVowels: countVowels,
    countByRegex: countByRegex,
    countNaive: countNaive,
    baseLetters: baseLetters
  };
});
