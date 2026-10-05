/*
 * tests.js — a dependency-free suite for the Reverse a String engine.
 *
 *   node projects/phase2-text/reverse-a-string/tests.js
 *
 * Reversal is tiny, so the suite is about proving the three claims the page
 * makes and holding the engine to them:
 *
 *   1. Every level is an INVOLUTION: reversing twice returns the original.
 *      This is checked on a long randomised fuzz corpus of mixed ASCII, astral
 *      characters, combining marks, ZWJ emoji, flags and skin-tone modifiers.
 *
 *   2. The grapheme segmenter agrees with an INDEPENDENT oracle — the
 *      platform's own Intl.Segmenter, which shares no code with our hand-written
 *      UAX #29 implementation — on a curated corpus AND across the fuzz loop.
 *      (Skipped with a note if Intl.Segmenter is unavailable; the property
 *      tests still run.)
 *
 *   3. The cheaper levels break exactly where we say they do: code-unit
 *      reversal corrupts astral characters (and leaks lone surrogates), and
 *      code-point reversal mangles combining marks and multi-code-point emoji —
 *      while grapheme reversal keeps all of them intact.
 */
"use strict";
var RS = require("./reverse-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function arrEq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function throws(fn, msg) {
  var threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(threw, msg + " (expected a throw)");
}
function section(name) { console.log("\n== " + name + " =="); }

// Named code points used throughout, so the tests read clearly.
var ACCENT = "́";            // ◌́  combining acute accent
var ZWJ = "‍";               //     zero-width joiner
var MATH_B = "\u{1D401}";         // 𝐁  astral (needs a surrogate pair)
var GRIN = "\u{1F600}";           // 😀 astral emoji
var THUMB = "\u{1F44D}";          // 👍
var SKIN = "\u{1F3FD}";           // 🏽 medium skin-tone modifier
var US = "\u{1F1FA}\u{1F1F8}";    // 🇺🇸 flag = two regional indicators
var FAMILY = "\u{1F468}" + ZWJ + "\u{1F469}" + ZWJ + "\u{1F467}"; // 👨‍👩‍👧

// --- the independent oracle: the platform's own Unicode segmenter -----------
var HAS_SEG = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";
var oracleGraphemes = HAS_SEG
  ? (function () {
      var seg = new Intl.Segmenter("en", { granularity: "grapheme" });
      return function (s) {
        var out = [];
        for (var it = seg.segment(s)[Symbol.iterator](), r = it.next(); !r.done; r = it.next()) {
          out.push(r.value.segment);
        }
        return out;
      };
    })()
  : null;
function oracleReverseGraphemes(s) { return oracleGraphemes(s).reverse().join(""); }

// ---------------------------------------------------------------------------
section("the plain ASCII case: all four agree with the one-liner");
(function () {
  var s = "hello, world";
  var naive = s.split("").reverse().join("");
  eq(RS.reverseCodeUnits(s), naive, "code units match the textbook one-liner");
  eq(RS.reverseCodePoints(s), naive, "code points agree for pure ASCII");
  eq(RS.reverseGraphemes(s), naive, "graphemes agree for pure ASCII");
  eq(RS.reverseGraphemes("abc"), "cba", "abc -> cba");
  eq(RS.reverseGraphemes(""), "", "empty string reverses to empty");
  eq(RS.reverseGraphemes("x"), "x", "single char is unchanged");
})();

section("grapheme reversal keeps user-perceived characters intact");
(function () {
  // "café" written with a COMBINING accent (e + ◌́), not precomposed é.
  var cafe = "cafe" + ACCENT;
  eq(RS.reverseGraphemes(cafe), "e" + ACCENT + "fac",
    "combining accent rides with its base letter: café -> éfac");
  // Code-point reversal floats the accent onto the wrong letter.
  ok(RS.reverseCodePoints(cafe) !== RS.reverseGraphemes(cafe),
    "code-point reversal mangles the combining accent");

  // A flag is two regional indicators; it must not flip into a different flag.
  eq(RS.reverseGraphemes("a" + US + "b"), "b" + US + "a",
    "flag stays 🇺🇸, not reversed into 🇸🇺");
  // A ZWJ family emoji is a single grapheme and must survive whole.
  eq(RS.reverseGraphemes("[" + FAMILY + "]"), "]" + FAMILY + "[",
    "ZWJ family emoji reverses as one unit");
  // Skin-tone modifier stays attached to its base emoji.
  eq(RS.reverseGraphemes("A" + THUMB + SKIN + "Z"), "Z" + THUMB + SKIN + "A",
    "skin-tone modifier rides with its emoji");
})();

section("code-unit reversal corrupts astral characters (as advertised)");
(function () {
  var s = "A" + MATH_B + "C";                       // A 𝐁 C
  // The grapheme/code-point reversal is clean...
  eq(RS.reverseGraphemes(s), "C" + MATH_B + "A", "grapheme reversal keeps 𝐁 whole");
  ok(!RS.hasLoneSurrogate(RS.reverseGraphemes(s)), "clean reversal has no lone surrogate");
  // ...but the raw code-unit reversal splits the surrogate pair.
  ok(RS.reverseCodeUnits(s) !== RS.reverseGraphemes(s), "code-unit reversal differs");
  ok(RS.hasLoneSurrogate(RS.reverseCodeUnits(s)),
    "code-unit reversal leaks a lone surrogate from the torn pair");
})();

section("analyze() reports the three counts and the safety flags");
(function () {
  var a = RS.analyze("A" + MATH_B + GRIN);          // 1 + 1 + 1 graphemes
  eq(a.graphemes, 3, "three user-perceived characters");
  eq(a.codePoints, 3, "three code points");
  eq(a.codeUnits, 5, "five UTF-16 code units (two astral chars = 2 units each)");
  eq(a.codeUnitsSafe, false, "naive reversal is NOT safe here");
  eq(a.naiveLeaksSurrogate, true, "and it leaks a surrogate");

  var ascii = RS.analyze("plain");
  eq(ascii.codeUnits, 5, "ascii: 5 units");
  eq(ascii.graphemes, 5, "ascii: 5 graphemes");
  eq(ascii.codeUnitsSafe, true, "ascii: naive reversal is safe");
  eq(ascii.codePointsSafe, true, "ascii: code-point reversal is safe");
})();

section("reverseWords: order of words flips, each word stays forward");
(function () {
  eq(RS.reverseWords("the quick brown fox"), "fox brown quick the", "four words flip");
  eq(RS.reverseWords("hello"), "hello", "a single word is unchanged");
  eq(RS.reverseWords("  padded   out  "), "out padded", "whitespace trimmed and collapsed");
  eq(RS.reverseWords(""), "", "empty string -> empty");
  // Idempotent-squared for single-spaced input.
  var s = "a b c d e";
  eq(RS.reverseWords(RS.reverseWords(s)), s, "reversing words twice is the identity");
})();

section("validation: non-strings are rejected");
(function () {
  throws(function () { RS.reverseGraphemes(42); }, "number rejected");
  throws(function () { RS.reverseCodeUnits(null); }, "null rejected");
  throws(function () { RS.reverseWords({}); }, "object rejected");
  throws(function () { RS.graphemes(undefined); }, "undefined rejected");
})();

// ---------------------------------------------------------------------------
section("PROPERTY: every level is an involution (reverse twice = original)");
(function () {
  var seed = 20260405;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function ri(lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }

  // A palette spanning every grapheme kind the engine claims to handle.
  var PALETTE = [
    "a", "b", "Z", " ", "\t", "7", ".", "\n",
    "é",                       // precomposed é
    "e" + ACCENT,                   // decomposed e + ◌́
    MATH_B, GRIN, THUMB,            // astral
    THUMB + SKIN,                   // emoji + skin tone
    US, FAMILY,                     // flag, ZWJ family
    "中", "ا"              // CJK, Arabic
  ];
  function randStr() {
    var parts = [], k = ri(0, 14);
    for (var i = 0; i < k; i++) parts.push(PALETTE[ri(0, PALETTE.length - 1)]);
    return parts.join("");
  }

  var checked = 0, cuFail = 0, cpFail = 0, gFail = 0;
  for (var t = 0; t < 2000; t++) {
    var s = randStr();
    checked++;
    if (RS.reverseCodeUnits(RS.reverseCodeUnits(s)) !== s) cuFail++;
    if (RS.reverseCodePoints(RS.reverseCodePoints(s)) !== s) cpFail++;
    if (RS.reverseGraphemes(RS.reverseGraphemes(s)) !== s) gFail++;
  }
  eq(cuFail, 0, "code-unit reversal is an involution over " + checked + " strings");
  eq(cpFail, 0, "code-point reversal is an involution");
  eq(gFail, 0, "grapheme reversal is an involution");

  // Grapheme reversal is exactly the segment list, reversed.
  var sample = "x" + US + "y" + FAMILY + "e" + ACCENT;
  arrEq(RS.graphemes(RS.reverseGraphemes(sample)), RS.graphemes(sample).reverse(),
    "graphemes(reverse(s)) === graphemes(s) reversed");
})();

section("ORACLE: our segmenter ↔ Intl.Segmenter (curated cases)");
(function () {
  if (!HAS_SEG) { console.log("  (skipped — Intl.Segmenter not available)"); return; }
  var cases = [
    "hello world",
    "café " + "cafe" + ACCENT,
    "A" + MATH_B + "C",
    "flag " + US + " done",
    "family " + FAMILY + " done",
    "thumb " + THUMB + SKIN + "!",
    US + US + "\u{1F1EB}",          // two flags then a lone regional indicator
    "line1\r\nline2",               // CRLF stays one grapheme
    "中文" + GRIN,
    "mix " + MATH_B + US + ("e" + ACCENT) + FAMILY
  ];
  cases.forEach(function (s, i) {
    arrEq(RS.graphemes(s), oracleGraphemes(s), "segmentation matches Intl on case #" + i);
    eq(RS.reverseGraphemes(s), oracleReverseGraphemes(s), "reversal matches Intl on case #" + i);
  });
})();

section("ORACLE: our segmenter ↔ Intl.Segmenter (randomised fuzz)");
(function () {
  if (!HAS_SEG) { console.log("  (skipped — Intl.Segmenter not available)"); return; }
  var seed = 99991;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function ri(lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }
  var PALETTE = ["a", " ", "Z", MATH_B, GRIN, THUMB, SKIN, "\u{1F1FA}", "\u{1F1F8}",
                 "\u{1F1EB}", ZWJ, "\u{1F468}", "\u{1F469}", "\u{1F467}", ACCENT, "é"];
  var segFail = 0, revFail = 0, checked = 0;
  for (var t = 0; t < 1500; t++) {
    var parts = [], k = ri(0, 12);
    for (var i = 0; i < k; i++) parts.push(PALETTE[ri(0, PALETTE.length - 1)]);
    var s = parts.join("");
    checked++;
    if (JSON.stringify(RS.graphemes(s)) !== JSON.stringify(oracleGraphemes(s))) segFail++;
    if (RS.reverseGraphemes(s) !== oracleReverseGraphemes(s)) revFail++;
  }
  eq(segFail, 0, "segmenter matches Intl across " + checked + " fuzzed strings");
  eq(revFail, 0, "grapheme reversal matches Intl across " + checked + " fuzzed strings");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (fail === 0
  ? "OK: " + pass + " passed, 0 failed"
  : "FAILED: " + fail + " of " + (pass + fail)));
if (fail > 0) process.exit(1);
