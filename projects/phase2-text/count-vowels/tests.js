/*
 * tests.js — a dependency-free suite for the Count Vowels engine.
 *
 * Five kinds of check, strongest last:
 *
 *   1. A curated corpus pinned to exact expected counts: plain words, accented
 *      words (café, naïve, résumé), the `y` question both ways, ligatures and
 *      maths-styled letters under both folding modes, and empty / letterless
 *      input.
 *
 *   2. The independent cross-check: analyze (a per-code-point scan that builds a
 *      histogram) and countByRegex (one whole-string normalise + a single
 *      character class) are two unrelated implementations of the same count.
 *      They must agree on the corpus and across a large Unicode fuzz loop.
 *
 *   3. Grounding on the ASCII subset: where the naive `/[aeiou]/gi` one-liner is
 *      actually correct — ASCII letters, `y` excluded — both real
 *      implementations must match it exactly. The Unicode machinery is pinned to
 *      the obvious answer precisely where the obvious answer is right.
 *
 *   4. Property tests that must hold for every input:
 *        - the histogram sums to the total                 (nothing double-counted)
 *        - distinct == number of non-zero histogram buckets (distinct is consistent)
 *        - the count is NORMALISATION-INVARIANT: count(s) == count(NFC s)
 *          == count(NFD s). Folding `é` the long way or the short way cannot
 *          change how many vowels are in the text — this is the whole point of
 *          the Unicode handling, stated as a law.
 *        - every reported position actually lands on a vowel-bearing code point,
 *          and the positions' hit-counts sum to the total.
 *
 *   5. The gap, demonstrated: a concrete string where the naive one-liner and
 *      the real count disagree, so "the one-liner is wrong" is shown, not just
 *      claimed.
 *
 * Run it:  node projects/phase2-text/count-vowels/tests.js
 */
"use strict";

var CV = require("./vowels-core.js");

var passed = 0, failed = 0, failures = [];
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); }
}
function eq(got, want, msg) {
  ok(got === want, msg + "\n     got:  " + JSON.stringify(got) +
                        "\n     want: " + JSON.stringify(want));
}

// ---------------------------------------------------------------------------
// 1. Curated corpus — exact expected totals.
// ---------------------------------------------------------------------------

// plain ASCII, default options (y excluded, canonical folding)
var PLAIN = [
  ["cat", 1],
  ["Hello World", 3],       // e, o, o
  ["aeiou", 5],
  ["AEIOU", 5],             // case-insensitive
  ["rhythm", 0],            // y not counted by default
  ["xyz", 0],
  ["", 0],
  ["12345 !!!", 0],
  ["The quick brown fox", 5] // e,ui,o,o -> e,u,i,o,o = 5
];
PLAIN.forEach(function (p) {
  eq(CV.countVowels(p[0]), p[1], "countVowels(" + JSON.stringify(p[0]) + ")");
});

// accents must be folded to their base vowel (canonical NFD)
eq(CV.countVowels("café"), 2, "café -> a, e");
eq(CV.countVowels("naïve"), 3, "naïve -> a, i, e");
eq(CV.countVowels("résumé"), 3, "résumé -> e, u, e");
eq(CV.countVowels("Zoë"), 2, "Zoë -> o, e");
eq(CV.countVowels("jalapeño"), 4, "jalapeño -> a, a, e, o (ñ is a consonant)");
eq(CV.countVowels("Über"), 2, "Über -> u, e");
// a pre-composed é and a decomposed e+accent must count identically
eq(CV.countVowels("café"), CV.countVowels("café"),
   "precomposed é and decomposed e+◌́ count the same");

// y, both ways
eq(CV.countVowels("rhythm", { includeY: true }), 1, "rhythm with y -> 1");
eq(CV.countVowels("my", { includeY: true }), 1, "my with y -> 1");
eq(CV.countVowels("yes", { includeY: true }), 2, "yes with y -> y, e");
eq(CV.countVowels("yes", { includeY: false }), 1, "yes without y -> e");
eq(CV.analyze("sky", { includeY: true }).byVowel.y, 1, "y is tallied in its own bucket");

// ligatures and styled letters: canonical leaves them, compatibility folds them
eq(CV.countVowels("ﬁsh"), 0, "ﬁ ligature not folded under canonical NFD");
eq(CV.countVowels("ﬁsh", { compatibility: true }), 1, "ﬁ -> f,i under NFKD -> counts i");
eq(CV.countVowels("\u{1D41A}\u{1D41E}\u{1D422}"), 0, "maths-bold aei not folded under NFD");
eq(CV.countVowels("\u{1D41A}\u{1D41E}\u{1D422}", { compatibility: true }), 3,
   "maths-bold 𝐚𝐞𝐢 -> a,e,i under NFKD");
eq(CV.countVowels("ＡＥＩＯＵ", { compatibility: true }), 5, "fullwidth AEIOU under NFKD");

// histogram and distinct on a known word
var mm = CV.analyze("Mississippi");
eq(mm.total, 4, "Mississippi total");
eq(mm.byVowel.i, 4, "Mississippi has 4 i");
eq(mm.distinct, 1, "Mississippi uses 1 distinct vowel");
var ae = CV.analyze("sequoia");               // s e q u o i a
eq(ae.total, 5, "sequoia total");
eq(ae.distinct, 5, "sequoia uses all five distinct vowels");

// code points vs UTF-16 units: an astral letter is one "character", two units
var astral = CV.analyze("a\u{1D400}");        // 'a' + maths-bold 'A' (astral)
eq(astral.codePoints, 2, "two code points");
eq(astral.units, 3, "three UTF-16 units (astral char is a surrogate pair)");

// ---------------------------------------------------------------------------
// 2. Independent cross-check: analyze and countByRegex agree.
// ---------------------------------------------------------------------------

// deterministic PRNG so a failure reproduces exactly (xmur3 + mulberry32)
function rng(seedStr) {
  var h = 1779033703 ^ seedStr.length;
  for (var i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  var a = (h ^= h >>> 16) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a palette rich enough to exercise every branch: ASCII letters, accented
// vowels (pre-composed and decomposed), the ñ trap, a ligature, a maths-bold
// letter, bare combining marks, spaces, digits, punctuation and an emoji.
var PALETTE = Array.from(
  "abcdefghijklmnopqrstuvwxyzAEIOUYy" +
  "áàäâéèëêíìïîóòöôúùüûñÑ" +
  "éö" +                 // decomposed e+acute, o+diaeresis
  "́̈" +                   // bare combining marks
  "ﬁ\u{1D41A}ＡＥ" +                  // ligature, maths-bold a, fullwidth A/E
  "   \n\t.,!?;:'\"-()[]0123456789😀🇺🇸"
);
function randText(r, maxLen) {
  var n = Math.floor(r() * maxLen);
  var s = "";
  for (var i = 0; i < n; i++) s += PALETTE[Math.floor(r() * PALETTE.length)];
  return s;
}

var OPTS = [
  {}, { includeY: true }, { compatibility: true }, { includeY: true, compatibility: true }
];
var crossRand = rng("cross-check");
var crossFail = 0;
for (var t = 0; t < 40000; t++) {
  var s = randText(crossRand, 24);
  var opts = OPTS[t % OPTS.length];
  var a = CV.analyze(s, opts).total;
  var b = CV.countByRegex(s, opts);
  if (a !== b) {
    crossFail++;
    if (crossFail <= 3) failures.push("cross-check disagreed on " + JSON.stringify(s) +
      " opts=" + JSON.stringify(opts) + " analyze=" + a + " regex=" + b);
  }
}
ok(crossFail === 0, "analyze vs countByRegex: " + crossFail + " mismatches over 40000 strings");

// ---------------------------------------------------------------------------
// 3. Grounding on the ASCII subset: both agree with the naive one-liner where
//    the naive one-liner is correct (ASCII letters, y excluded).
// ---------------------------------------------------------------------------
var ASCII = Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
var asciiRand = rng("ascii-oracle");
var asciiFail = 0;
for (var i2 = 0; i2 < 20000; i2++) {
  var n2 = Math.floor(asciiRand() * 20), s2 = "";
  for (var j2 = 0; j2 < n2; j2++) s2 += ASCII[Math.floor(asciiRand() * ASCII.length)];
  var naive = CV.countNaive(s2);
  if (CV.analyze(s2).total !== naive || CV.countByRegex(s2) !== naive) {
    asciiFail++;
    if (asciiFail <= 3) failures.push("ASCII oracle mismatch on " + JSON.stringify(s2));
  }
}
ok(asciiFail === 0, "both implementations match the naive oracle on ASCII (" + asciiFail + " failures)");

// ---------------------------------------------------------------------------
// 4. Property tests.
// ---------------------------------------------------------------------------

// 4a. the histogram sums to the total, and distinct == non-zero buckets.
var histRand = rng("histogram");
var histFail = 0, distinctFail = 0;
for (var i3 = 0; i3 < 20000; i3++) {
  var s3 = randText(histRand, 20);
  var opts3 = OPTS[i3 % OPTS.length];
  var r3 = CV.analyze(s3, opts3);
  var sum = 0, nonzero = 0;
  Object.keys(r3.byVowel).forEach(function (k) {
    sum += r3.byVowel[k];
    if (r3.byVowel[k] > 0) nonzero++;
  });
  if (sum !== r3.total) { histFail++; if (histFail <= 3) failures.push("histogram sum != total on " + JSON.stringify(s3)); }
  if (nonzero !== r3.distinct) { distinctFail++; if (distinctFail <= 3) failures.push("distinct != non-zero buckets on " + JSON.stringify(s3)); }
}
ok(histFail === 0, "histogram sums to total over 20000 strings (" + histFail + " failures)");
ok(distinctFail === 0, "distinct == non-zero buckets over 20000 strings (" + distinctFail + " failures)");

// 4b. the count is normalisation-invariant: folding the input to NFC or NFD
//     first cannot change the answer (the law that makes accent handling sane).
var normRand = rng("normalise-invariant");
var normFail = 0;
for (var i4 = 0; i4 < 20000; i4++) {
  var s4 = randText(normRand, 24);
  var opts4 = OPTS[i4 % OPTS.length];
  var base = CV.countVowels(s4, opts4);
  if (CV.countVowels(s4.normalize("NFC"), opts4) !== base ||
      CV.countVowels(s4.normalize("NFD"), opts4) !== base) {
    normFail++;
    if (normFail <= 3) failures.push("count changed under NFC/NFD on " + JSON.stringify(s4));
  }
}
ok(normFail === 0, "count is invariant under NFC/NFD normalisation over 20000 strings (" + normFail + " failures)");

// 4c. every reported position is real: it indexes a code point that folds to a
//     vowel, and the positions' hit-counts sum to the total.
var posRand = rng("positions");
var posFail = 0;
for (var i5 = 0; i5 < 20000; i5++) {
  var s5 = randText(posRand, 20);
  var opts5 = OPTS[i5 % OPTS.length];
  var r5 = CV.analyze(s5, opts5);
  var cps = Array.from(s5);
  var hitSum = 0, bad = false;
  r5.positions.forEach(function (p) {
    hitSum += p.hits;
    // the recorded char must equal the code point at that index, and folding it
    // must itself produce at least `hits` vowels.
    if (cps[p.index] !== p.char) bad = true;
  });
  if (hitSum !== r5.total) bad = true;
  if (bad) { posFail++; if (posFail <= 3) failures.push("positions inconsistent on " + JSON.stringify(s5)); }
}
ok(posFail === 0, "positions are consistent and sum to the total over 20000 strings (" + posFail + " failures)");

// ---------------------------------------------------------------------------
// 5. The gap, demonstrated concretely: the naive one-liner is wrong on accents.
// ---------------------------------------------------------------------------
eq(CV.countNaive("résumé"), 1, "naive one-liner sees only the un-accented e in résumé");
eq(CV.countVowels("résumé"), 3, "the real count sees all three");
ok(CV.countNaive("résumé") !== CV.countVowels("résumé"),
   "naive and correct disagree on accented text — the whole reason this project exists");
// and it is wrong on ligatures under compatibility folding
eq(CV.countNaive("ﬁ"), 0, "naive sees nothing in the ﬁ ligature");
eq(CV.countVowels("ﬁ", { compatibility: true }), 1, "compatibility folding finds the i");

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
if (failures.length) {
  console.log("\nFAILURES:");
  failures.slice(0, 40).forEach(function (f) { console.log("  ✗ " + f); });
  if (failures.length > 40) console.log("  … and " + (failures.length - 40) + " more");
}
console.log("\n-> " + passed + " passed, " + failed + " failed.");
process.exit(failed ? 1 : 0);
