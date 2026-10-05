/*
 * reverse-core.js — the engine behind the Reverse a String playground.
 *
 * "Reverse a string" is the archetypal one-liner:
 *
 *     s.split("").reverse().join("")
 *
 * and for plain ASCII it is completely correct. The reason it's worth more
 * than one line — and the thing this file is about — is that a JavaScript
 * string is a sequence of UTF-16 *code units*, not of the characters a reader
 * sees. Reverse the code units and you tear emoji in half and float accents
 * onto the wrong letters. So this engine reverses at three honestly-labelled
 * granularities, from the naive-and-broken one up to the one that matches what
 * a human would call "the characters, backwards":
 *
 *   1. code units     — split("").reverse(): fast, and wrong for anything
 *                        outside the Basic Multilingual Plane (it splits
 *                        surrogate pairs, producing lone surrogates / U+FFFD).
 *   2. code points     — [...s].reverse(): keeps astral characters (most emoji,
 *                        𝐁old math letters) whole, but still reverses the
 *                        *inside* of a grapheme — "é" written as e + ◌́ becomes
 *                        ◌́ + e, and a 👨‍👩‍👧 family or a 🇺🇸 flag comes apart.
 *   3. grapheme clusters — the user-perceived characters. This is the reversal
 *                        a person means. It needs real Unicode text
 *                        segmentation, implemented here from the UAX #29
 *                        extended-grapheme-cluster rules (combining marks, ZWJ
 *                        emoji sequences, regional-indicator flag pairs, skin
 *                        tone modifiers, CRLF), with NO dependency on
 *                        Intl.Segmenter — so the exact same file runs in the
 *                        browser and under Node, and the test suite can use
 *                        Intl.Segmenter as a fully independent oracle.
 *
 * A fourth mode reverses the *order of words* while leaving each word forward,
 * the other thing people mean by "reverse this".
 *
 * The module is dependency-free and never touches the DOM. Loaded with a
 * <script> tag it attaches to window.RS; under Node it is module.exports.
 */
"use strict";

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;          // Node / the test runner
  } else {
    root.RS = api;                 // the browser
  }
})(typeof self !== "undefined" ? self : this, function () {

  var ZWJ = "‍";

  // --- level 1: code units (the naive one-liner) --------------------------
  // Reverses the raw UTF-16 code units. This is exactly what
  // `s.split("").reverse().join("")` does, spelled out, and it is included
  // precisely so the page can SHOW it misbehaving on astral characters rather
  // than pretend the simple version is fine.
  function reverseCodeUnits(s) {
    requireString(s);
    var out = "";
    for (var i = s.length - 1; i >= 0; i--) out += s.charAt(i);
    return out;
  }

  // --- level 2: code points -----------------------------------------------
  // Reverses Unicode code points (what `[...s]` / Array.from iterate). A
  // surrogate pair counts as one code point, so astral characters survive;
  // combining marks and multi-code-point emoji do not.
  function reverseCodePoints(s) {
    requireString(s);
    return Array.from(s).reverse().join("");
  }

  // --- level 3: grapheme clusters (the right one) -------------------------
  // Segment into extended grapheme clusters, then reverse the clusters. This
  // is the reversal that keeps "é", 🇺🇸, 👨‍👩‍👧 and 👍🏽 intact.
  function reverseGraphemes(s) {
    return graphemes(s).reverse().join("");
  }

  // --- bonus: word order --------------------------------------------------
  // Reverse the order of whitespace-separated words, each word left forward.
  // Runs of whitespace collapse to a single space and the ends are trimmed, so
  // for already single-spaced input, reversing twice returns the original.
  function reverseWords(s) {
    requireString(s);
    var words = s.split(/\s+/).filter(function (w) { return w.length > 0; });
    return words.reverse().join(" ");
  }

  // ---------------------------------------------------------------------------
  // Extended grapheme cluster segmentation (a practical UAX #29).
  //
  // We iterate code points and decide, before each one, whether it begins a new
  // cluster. The default is "break" (GB999); the no-break exceptions below are
  // the rules that keep combining marks, emoji sequences and flags together.
  // Classification uses Unicode property escapes (\p{...}) rather than
  // hard-coded ranges, so the tables stay current with the engine's Unicode
  // version and we don't ship a copy of the database.
  // ---------------------------------------------------------------------------
  function graphemes(str) {
    requireString(str);
    var cps = Array.from(str);
    var n = cps.length;
    if (n === 0) return [];
    var out = [];
    var cur = cps[0];
    // riRun = count of regional-indicator code points at the tail of the
    // cluster currently being built; flags pair up two at a time (GB12/GB13).
    var riRun = isRI(cps[0]) ? 1 : 0;
    // GB11 only joins a ZWJ-then-emoji when the ZWJ itself followed an emoji
    // (\p{Extended_Pictographic} Extend*), so we track two bits of state:
    //   emojiCore   — the cluster's tail is currently `ExtPict Extend*`.
    //   zwjEligible — the ZWJ just appended was preceded by such a core, so a
    //                 following emoji continues the sequence.
    var emojiCore = isExtPict(cps[0]);
    var zwjEligible = false;

    for (var i = 1; i < n; i++) {
      var p = cps[i - 1], c = cps[i];
      var brk;

      if (p === "\r" && c === "\n") {
        brk = false;                                  // GB3: keep CRLF together
      } else if (isControl(p) || isControl(c)) {
        brk = true;                                   // GB4/GB5: around controls
      } else if (isExtendOrZWJ(c) || isSpacingMark(c)) {
        brk = false;                                  // GB9/GB9a: marks attach
      } else if (p === ZWJ && zwjEligible && isExtPict(c)) {
        brk = false;                                  // GB11: emoji ZWJ sequence
      } else if (isRI(p) && isRI(c)) {
        brk = (riRun % 2 === 0);                      // GB12/13: pair the flags
      } else {
        brk = true;                                   // GB999: default break
      }

      if (brk) {
        out.push(cur);
        cur = c;
        riRun = isRI(c) ? 1 : 0;
        emojiCore = isExtPict(c);
        zwjEligible = false;
      } else {
        cur += c;
        riRun = isRI(c) ? riRun + 1 : 0;
        if (c === ZWJ) {
          zwjEligible = emojiCore;                     // remember GB11 eligibility
          emojiCore = false;                           // the ZWJ ends the core
        } else if (isExtPict(c)) {
          emojiCore = true; zwjEligible = false;       // (re)start an emoji core
        } else if (!isExtendOrZWJ(c)) {
          emojiCore = false; zwjEligible = false;      // RI / spacing mark: not emoji
        }
        // a bare Extend/Emoji_Modifier leaves emojiCore unchanged
      }
    }
    out.push(cur);
    return out;
  }

  // --- a little analysis --------------------------------------------------
  // Describe a string the way the page's "what's actually in here" panel does:
  // the three counts (which diverge exactly when the naive reversals would go
  // wrong), whether reversing at the cheaper levels still matches the correct
  // grapheme reversal, and whether the raw reversal leaked a lone surrogate.
  function analyze(s) {
    requireString(s);
    var g = reverseGraphemes(s);
    return {
      codeUnits: s.length,
      codePoints: Array.from(s).length,
      graphemes: graphemes(s).length,
      codeUnitsSafe: reverseCodeUnits(s) === g,
      codePointsSafe: reverseCodePoints(s) === g,
      naiveLeaksSurrogate: hasLoneSurrogate(reverseCodeUnits(s))
    };
  }

  // True if the string contains an unpaired UTF-16 surrogate code unit — the
  // telltale wreckage of reversing an astral character by code unit.
  function hasLoneSurrogate(s) {
    for (var i = 0; i < s.length; i++) {
      var u = s.charCodeAt(i);
      if (u >= 0xD800 && u <= 0xDBFF) {               // high surrogate
        var next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (next >= 0xDC00 && next <= 0xDFFF) { i++; continue; } // valid pair
        return true;                                  // high with no low after
      }
      if (u >= 0xDC00 && u <= 0xDFFF) return true;     // low with no high before
    }
    return false;
  }

  // --- classification helpers ---------------------------------------------
  var RE_EXTEND = /\p{Grapheme_Extend}/u;
  var RE_SPACING = /\p{Mc}/u;
  var RE_EMOJI_MOD = /\p{Emoji_Modifier}/u;
  var RE_EXTPICT = /\p{Extended_Pictographic}/u;
  var RE_RI = /\p{Regional_Indicator}/u;
  var RE_CONTROL = /\p{Cc}/u;

  function isExtendOrZWJ(cp) {
    return cp === ZWJ || RE_EXTEND.test(cp) || RE_EMOJI_MOD.test(cp);
  }
  function isSpacingMark(cp) { return RE_SPACING.test(cp); }
  function isExtPict(cp) { return RE_EXTPICT.test(cp); }
  function isRI(cp) { return RE_RI.test(cp); }
  function isControl(cp) {
    // CR and LF are handled by the CRLF rule / fall under Cc, and ZWJ is Cf
    // (not Cc) so it is never treated as a control here.
    return RE_CONTROL.test(cp);
  }

  function requireString(s) {
    if (typeof s !== "string") throw new TypeError("expected a string");
  }

  return {
    reverseCodeUnits: reverseCodeUnits,
    reverseCodePoints: reverseCodePoints,
    reverseGraphemes: reverseGraphemes,
    reverseWords: reverseWords,
    graphemes: graphemes,
    analyze: analyze,
    hasLoneSurrogate: hasLoneSurrogate
  };
});
