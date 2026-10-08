/*
 * tests.js — a dependency-free suite for the Check if Palindrome engine.
 *
 * Six kinds of check, strongest last:
 *
 *   1. A curated corpus pinned to exact verdicts: single letters and the empty
 *      string (trivially palindromes), classic words (racecar, level, noon),
 *      near-misses (hello), mixed case (RaceCar), the textbook phrase palindrome
 *      ("A man, a plan, a canal: Panama"), and accented pairs under each folding
 *      choice.
 *
 *   2. The independent cross-check: twoPointer (walk in from both ends) and
 *      reverseCompare (reverse the array, compare element-by-element) are two
 *      unrelated implementations of the same question. They must agree on the
 *      verdict AND the first-mismatch index — on the corpus and across a large
 *      Unicode fuzz loop. (check() enforces this at runtime; the fuzz proves it
 *      holds for thousands of random strings, including astral characters and
 *      combining marks.)
 *
 *   3. The surrogate-pair trap, demonstrated: a single astral character is one
 *      character and so is trivially a palindrome, but the naive
 *      `split("").reverse().join("")` one-liner mangles its surrogate pair and
 *      can report false. We show the engine says true where the one-liner is
 *      wrong — the whole reason toUnits splits by code point / grapheme.
 *
 *   4. The combining-mark trap: "e" + combining acute reversed by code point
 *      moves the accent; by grapheme it stays put. We pin both behaviours.
 *
 *   5. Property tests that must hold for EVERY input:
 *        - reversing a palindrome's cleaned keys yields the same array
 *        - a string is a palindrome iff its cleaned key array equals its reverse
 *        - appending a string to its own grapheme-reverse is always a palindrome
 *          under strict grapheme comparison (a palindrome generator as an oracle)
 *        - the verdict is stable across NFC/NFD input when folding is on
 *          (normalisation invariance)
 *        - comparedCount + droppedCount === codePointCount is impossible to state
 *          directly (drop counts source units, not code points), so we instead
 *          assert kept + dropped === total source units.
 *
 *   6. Option behaviour: each toggle changes the verdict exactly where it should
 *      and nowhere else (case, diacritics, alnum-only, granularity).
 *
 * Run it:  node projects/phase2-text/check-if-palindrome/tests.js
 */
"use strict";

var PAL = require("./palindrome-core.js");

var passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}
function eq(actual, expected, msg) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(a === e, msg + "  (got " + a + ", expected " + e + ")");
}

// Option presets used throughout.
var STRICT = { ignoreCase: false, ignoreDiacritics: false, alnumOnly: false, granularity: "grapheme" };
var SMART = { ignoreCase: true, ignoreDiacritics: false, alnumOnly: true, granularity: "grapheme" };
var SMART_FOLD = { ignoreCase: true, ignoreDiacritics: true, alnumOnly: true, granularity: "grapheme" };

console.log("Intl.Segmenter grapheme support: " + PAL.hasGraphemeSupport);

// ---------------------------------------------------------------------------
// 1. Curated corpus, pinned verdicts
// ---------------------------------------------------------------------------
console.log("\n# 1. curated corpus");
(function () {
  // [input, options, expected isPalindrome]
  var CASES = [
    ["", STRICT, true],                 // empty string
    ["a", STRICT, true],                // one char
    ["aa", STRICT, true],
    ["ab", STRICT, false],
    ["racecar", STRICT, true],
    ["level", STRICT, true],
    ["noon", STRICT, true],
    ["hello", STRICT, false],
    ["RaceCar", STRICT, false],         // strict: case matters
    ["RaceCar", SMART, true],           // smart: case folded
    ["Noon", SMART, true],
    ["Was it a car or a cat I saw?", SMART, true],   // phrase palindrome
    ["A man, a plan, a canal: Panama", SMART, true], // the textbook one
    ["No lemon, no melon", SMART, true],
    ["Not a palindrome at all", SMART, false],
    ["12321", STRICT, true],
    ["12345", STRICT, false],
    ["Madam, I'm Adam", SMART, true],
    ["step on no pets", SMART, true],
    ["café vs éfac", SMART, false],     // é is a different letter than e here...
    ["éé", SMART, true],                // ...but mirrored é's are a palindrome
  ];
  CASES.forEach(function (c) {
    eq(PAL.isPalindrome(c[0], c[1]), c[2],
      "isPalindrome(" + JSON.stringify(c[0]) + ")");
  });
})();

// ---------------------------------------------------------------------------
// 2. Cross-check twoPointer vs reverseCompare + big Unicode fuzz
// ---------------------------------------------------------------------------
console.log("\n# 2. cross-check + fuzz");
(function () {
  // A deterministic RNG so failures reproduce.
  var seed = 0x9e3779b9 >>> 0;
  function rnd() {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  }
  // A code-point pool that mixes ASCII, Latin-1 accents, combining marks,
  // punctuation, and astral characters (surrogate pairs).
  var POOL = [];
  for (var c = 0x61; c <= 0x7a; c++) { POOL.push(c); }          // a-z
  for (var d = 0x41; d <= 0x5a; d++) { POOL.push(d); }          // A-Z
  POOL.push(0x20, 0x2c, 0x2e, 0x21, 0x3f, 0x3a, 0x27);           // space , . ! ? : '
  POOL.push(0xe9, 0xe8, 0xf1, 0xfc, 0xe7, 0xc9);                 // é è ñ ü ç É
  POOL.push(0x0301, 0x0300, 0x0308);                            // combining accents
  POOL.push(0x1f600, 0x1d41a, 0x1d41e, 0x1f4a9);                // 😀 𝐚 𝐞 💩 (astral)

  var OPTSET = [STRICT, SMART, SMART_FOLD,
    { ignoreCase: true, ignoreDiacritics: false, alnumOnly: false, granularity: "codepoint" }];

  var N = 40000;
  var astralCases = 0;
  for (var t = 0; t < N; t++) {
    var len = Math.floor(rnd() * 12);
    var s = "";
    for (var k = 0; k < len; k++) {
      var cp = POOL[Math.floor(rnd() * POOL.length)];
      s += String.fromCodePoint(cp);
      if (cp > 0xffff) { astralCases++; }
    }
    var opts = OPTSET[Math.floor(rnd() * OPTSET.length)];
    // check() throws if twoPointer and reverseCompare disagree; also assert the
    // two directly here so a mismatch names the string.
    var c1 = PAL.cleaned(s, opts);
    var a = PAL.twoPointer(c1.keys);
    var b = PAL.reverseCompare(c1.keys);
    ok(a.isPalindrome === b.isPalindrome && a.mismatch === b.mismatch,
      "fuzz agree on " + JSON.stringify(s));
    PAL.check(s, opts); // must not throw
  }
  console.log("  fuzzed " + N + " strings (" + astralCases + " astral code points drawn), both impls agreed");
})();

// ---------------------------------------------------------------------------
// 3. The surrogate-pair trap: engine right where the naive one-liner is wrong
// ---------------------------------------------------------------------------
console.log("\n# 3. surrogate-pair trap");
(function () {
  var astral = "😀"; // one character, U+1F600, stored as a surrogate pair
  eq(Array.from(astral).length, 1, "astral char is one code point");
  ok(astral.length === 2, "astral char is two UTF-16 units (" + astral.length + ")");

  // The engine: one character is a palindrome.
  eq(PAL.isPalindrome(astral, STRICT), true, "engine: single astral char is a palindrome");

  // The naive one-liner mangles the surrogate pair and reports false.
  ok(PAL.naive(astral) === false,
    "naive one-liner WRONGLY reports a single astral char as non-palindrome");

  // A genuine astral palindrome the engine gets right and the one-liner breaks.
  var pair = "😀😀";
  eq(PAL.isPalindrome(pair, STRICT), true, "engine: 😀😀 is a palindrome");
  ok(PAL.naive(pair) === false, "naive one-liner breaks 😀😀 too");
})();

// ---------------------------------------------------------------------------
// 4. The combining-mark trap: grapheme vs code point
// ---------------------------------------------------------------------------
console.log("\n# 4. combining-mark trap");
(function () {
  var decomposed = "éé"; // "é é" as e + accent, twice, no space
  // As graphemes: [é][é] — a two-unit palindrome.
  eq(PAL.isPalindrome(decomposed, STRICT), true,
    "grapheme mode: decomposed é é is a palindrome");

  // As code points: [e][´][e][´] reversed is [´][e][´][e] — NOT equal.
  eq(PAL.isPalindrome(decomposed, { ignoreCase: false, ignoreDiacritics: false, alnumOnly: false, granularity: "codepoint" }),
    false, "codepoint mode: the accent floats off, so it's not a palindrome");

  // Folding diacritics erases the accent entirely -> "ee", a palindrome either way.
  eq(PAL.isPalindrome(decomposed, SMART_FOLD), true,
    "fold diacritics: decomposed é é becomes ee, a palindrome");
})();

// ---------------------------------------------------------------------------
// 5. Property tests over random input
// ---------------------------------------------------------------------------
console.log("\n# 5. properties");
(function () {
  var seed = 12345 >>> 0;
  function rnd() {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  }
  function randStr(maxLen) {
    var len = Math.floor(rnd() * maxLen);
    var s = "";
    for (var i = 0; i < len; i++) {
      // mostly letters, some accents and astral chars
      var r = rnd();
      if (r < 0.75) { s += String.fromCharCode(0x61 + Math.floor(rnd() * 26)); }
      else if (r < 0.9) { s += String.fromCodePoint([0xe9, 0xf1, 0xfc][Math.floor(rnd() * 3)]); }
      else { s += String.fromCodePoint([0x1f600, 0x1d41a][Math.floor(rnd() * 2)]); }
    }
    return s;
  }

  var N = 5000;
  for (var t = 0; t < N; t++) {
    var s = randStr(10);

    // (a) verdict == (cleaned keys equal their own reverse)
    var c = PAL.cleaned(s, SMART);
    var isByDef = JSON.stringify(c.keys) === JSON.stringify(c.keys.slice().reverse());
    ok(PAL.isPalindrome(s, SMART) === isByDef, "verdict matches key==reverse(key) for " + JSON.stringify(s));

    // (b) palindrome GENERATOR as oracle: s + graphemeReverse(s) is always a
    //     palindrome under strict grapheme comparison.
    var units = PAL.toUnits(s, "grapheme");
    var rev = units.map(function (u) { return u.text; }).reverse().join("");
    var made = s + rev;
    ok(PAL.isPalindrome(made, STRICT) === true, "s + reverse(s) is a palindrome for " + JSON.stringify(s));

    // (c) odd-length palindrome: s + mid + reverse(s)
    var made2 = s + "X" + rev;
    ok(PAL.isPalindrome(made2, STRICT) === true, "s + X + reverse(s) is a palindrome for " + JSON.stringify(s));

    // (d) normalisation invariance with folding on
    var nfc = s.normalize("NFC"), nfd = s.normalize("NFD");
    ok(PAL.isPalindrome(nfc, SMART_FOLD) === PAL.isPalindrome(nfd, SMART_FOLD),
      "NFC/NFD give same verdict for " + JSON.stringify(s));

    // (e) kept + dropped accounting
    var a = PAL.analyze(s, SMART);
    ok(a.kept.length + a.droppedCount === a.units.length, "kept + dropped == units for " + JSON.stringify(s));
    ok(a.comparedCount === a.kept.length, "comparedCount == kept.length for " + JSON.stringify(s));
  }
  console.log("  checked " + N + " random strings against 6 invariants each");
})();

// ---------------------------------------------------------------------------
// 6. Option behaviour — each toggle flips the verdict exactly where expected
// ---------------------------------------------------------------------------
console.log("\n# 6. options");
(function () {
  // ignoreCase
  eq(PAL.isPalindrome("Aa", { ignoreCase: false, ignoreDiacritics: false, alnumOnly: false, granularity: "grapheme" }), false, "Aa strict-case: not a palindrome");
  eq(PAL.isPalindrome("Aa", { ignoreCase: true, ignoreDiacritics: false, alnumOnly: false, granularity: "grapheme" }), true, "Aa case-folded: palindrome");

  // alnumOnly: the famous "A man a plan..." trick in miniature. "ab!a" reads
  // [a,b,!,a]. Keeping punctuation it is NOT a palindrome (a,b,!,a); dropping
  // non-alphanumerics it becomes [a,b,a], which IS a palindrome.
  eq(PAL.isPalindrome("a!a", { ignoreCase: true, ignoreDiacritics: false, alnumOnly: false, granularity: "grapheme" }), true, "a!a keeping punctuation: palindrome (a ! a)");
  eq(PAL.isPalindrome("ab!a", { ignoreCase: true, ignoreDiacritics: false, alnumOnly: false, granularity: "grapheme" }), false, "ab!a keeping punctuation: not a palindrome");
  eq(PAL.isPalindrome("ab!a", { ignoreCase: true, ignoreDiacritics: false, alnumOnly: true, granularity: "grapheme" }), true, "ab!a alnum-only keeps a,b,a -> palindrome");

  // diacritics
  eq(PAL.isPalindrome("eé", { ignoreCase: true, ignoreDiacritics: false, alnumOnly: true, granularity: "grapheme" }), false, "e vs é differ without folding");
  eq(PAL.isPalindrome("eé", { ignoreCase: true, ignoreDiacritics: true, alnumOnly: true, granularity: "grapheme" }), true, "e vs é equal once accents folded");

  // analyze reports the drop count
  var a = PAL.analyze("A man, a plan, a canal: Panama", SMART);
  ok(a.isPalindrome === true, "famous phrase is a palindrome");
  ok(a.droppedCount > 0, "famous phrase dropped spaces/punctuation (" + a.droppedCount + ")");
  ok(a.naive === false, "famous phrase fails the naive exact check");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (failed === 0
  ? "✅ " + passed + " passed, 0 failed."
  : "❌ " + passed + " passed, " + failed + " failed."));
process.exit(failed === 0 ? 0 : 1);
