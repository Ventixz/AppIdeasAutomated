/*
 * tests.js — a dependency-free suite for the Pig Latin engine.
 *
 * Four kinds of check, strongest last:
 *
 *   1. A curated corpus of textbook words and sentences, so the famous edge
 *      cases (onset clusters, word-initial y, the qu digraph, vowel words,
 *      capitalisation, punctuation) are pinned to exact expected output.
 *
 *   2. The independent-oracle cross-check: onsetLength (a forward scan) and
 *      onsetLengthOracle (first-vowel search + qu fix-up) are two separate
 *      implementations of the same rule. They must agree on the curated words
 *      and across a large fuzz loop of random letter-strings. This is the same
 *      "two independent implementations must agree" trick Reverse a String got
 *      from Intl.Segmenter — but Pig Latin has no platform oracle, so we grow
 *      our own second implementation.
 *
 *   3. Property tests that must hold for every input:
 *        - detokenize(tokenize(s)) === s             (text is preserved exactly)
 *        - encode preserves every non-letter in place (gaps are inviolate)
 *        - encodeWord permutes the letters + a suffix (anagram invariant)
 *        - the true word is always among decodeCandidates(encode(word)) (the
 *          decoder is sound — it never loses the real pre-image)
 *
 *   4. A demonstration that the transform is NOT injective: a concrete Pig
 *      Latin word with more than one valid pre-image, and a pair of distinct
 *      words that encode to the same string.
 *
 * Run it:  node projects/phase2-text/pig-latin/tests.js
 */
"use strict";

var PL = require("./piglatin-core.js");

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
// 1. Curated corpus — exact expected output (default "way" style).
// ---------------------------------------------------------------------------
var WORDS = [
  // classic consonant onsets
  ["pig", "igpay"],
  ["latin", "atinlay"],
  ["banana", "ananabay"],
  ["smile", "ilesmay"],         // onset "sm"
  ["glove", "oveglay"],         // onset "gl"
  ["string", "ingstray"],       // onset "str"
  ["trash", "ashtray"],         // onset "tr"
  ["duck", "uckday"],
  // vowel-initial → "way"
  ["apple", "appleway"],
  ["eat", "eatway"],
  ["out", "outway"],
  ["igloo", "iglooway"],
  // y: consonant at the front, vowel elsewhere
  ["yellow", "ellowyay"],       // leading y is a consonant
  ["my", "ymay"],               // y is the only vowel
  ["rhythm", "ythmrhay"],       // onset "rh", y acts as the vowel
  ["sky", "yskay"],
  // the qu digraph travels as a unit
  ["quiet", "ietquay"],
  ["quick", "ickquay"],
  ["square", "aresquay"],       // onset "squ"
  ["squid", "idsquay"],
  // consonant-only words: onset is the whole word, rest empty → word + "ay"
  ["nth", "nthay"],
  ["brr", "brray"],
  ["tsk", "tskay"],
  // single letters
  ["a", "away"],
  ["b", "bay"]
];
WORDS.forEach(function (p) {
  eq(PL.encodeWordStr(p[0]), p[1], "encodeWord(" + JSON.stringify(p[0]) + ")");
});

// vowel-suffix styles
eq(PL.encodeWordStr("apple", { style: "yay" }), "appleyay", "style yay (apple)");
eq(PL.encodeWordStr("apple", { style: "ay" }), "appleay", "style ay (apple)");
eq(PL.encodeWordStr("pig", { style: "yay" }), "igpay", "style yay leaves consonant words alone");

// capitalisation shapes are carried onto the result
eq(PL.encodeWordStr("Pig"), "Igpay", "Titlecase → Titlecase");
eq(PL.encodeWordStr("HELLO"), "ELLOHAY", "ALLCAPS → ALLCAPS");
eq(PL.encodeWordStr("Apple"), "Appleway", "Titlecase vowel word");
eq(PL.encodeWordStr("McFly"), "ymcflay", "mixed case → transform runs in lowercase");
eq(PL.encodeWordStr("I"), "Iway", "lone capital I reads as Titlecase, not a shout");

// whole sentences: punctuation, spacing and digits preserved, only letters move
eq(PL.encode("Hello, world!"), "Ellohay, orldway!", "sentence with comma + bang");
eq(PL.encode("The quick brown fox"), "Ethay ickquay ownbray oxfay", "four-word sentence");
eq(PL.encode("I have 3 cats."), "Iway avehay 3 atscay.", "digits are left untouched");
eq(PL.encode("don't"), "onday'tay", "apostrophe is a gap: contraction done in parts");
eq(PL.encode("   spaced   out   "), "   acedspay   outway   ", "runs of spaces preserved exactly");
eq(PL.encode(""), "", "empty text");
eq(PL.encode("12345 !!!"), "12345 !!!", "no letters → unchanged");

// ---------------------------------------------------------------------------
// 2. Independent-oracle cross-check: the two onset implementations agree.
// ---------------------------------------------------------------------------
WORDS.forEach(function (p) {
  eq(PL.onsetLengthOracle(p[0]), PL.onsetLength(p[0]),
     "oracle agrees on onset of " + JSON.stringify(p[0]));
});

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
var rand = rng("pig-latin-oracle");
var ALPHA = "abcdefghijklmnopqrstuvwxyz";
function randWord(r, maxLen) {
  var n = 1 + Math.floor(r() * (maxLen - 1));
  var s = "";
  for (var i = 0; i < n; i++) s += ALPHA[Math.floor(r() * 26)];
  return s;
}

var oracleMismatch = 0;
for (var t = 0; t < 20000; t++) {
  var w = randWord(rand, 10);
  if (PL.onsetLength(w) !== PL.onsetLengthOracle(w)) {
    oracleMismatch++;
    if (oracleMismatch <= 3) failures.push("oracle disagreed on " + JSON.stringify(w));
  }
}
ok(oracleMismatch === 0, "onset oracle vs scan: " + oracleMismatch + " mismatches over 20000 words");
passed += (oracleMismatch === 0 ? 1 : 0); // count the fuzz block as one assertion either way
if (oracleMismatch !== 0) failed++;

// ---------------------------------------------------------------------------
// 3. Property tests.
// ---------------------------------------------------------------------------

// 3a. text round-trips through tokenize/detokenize exactly.
var textRand = rng("tokenize-fuzz");
var TEXT_PALETTE = ALPHA + ALPHA.toUpperCase() + "   \n\t.,!?;:'\"-()[]0123456789😀🇺🇸é";
var tokFail = 0;
for (var i2 = 0; i2 < 5000; i2++) {
  var len = Math.floor(textRand() * 40);
  var s = "";
  for (var j = 0; j < len; j++) {
    // pull a code point (so astral palette members stay whole)
    var cps = Array.from(TEXT_PALETTE);
    s += cps[Math.floor(textRand() * cps.length)];
  }
  if (PL.detokenize(PL.tokenize(s)) !== s) { tokFail++; if (tokFail <= 3) failures.push("tokenize round-trip failed on " + JSON.stringify(s)); }
}
ok(tokFail === 0, "detokenize(tokenize(s)) === s over 5000 strings (" + tokFail + " failures)");

// 3b. encode preserves every non-letter character, in order and in place.
var gapRand = rng("gap-fuzz");
var gapFail = 0;
for (var i3 = 0; i3 < 5000; i3++) {
  var len2 = Math.floor(gapRand() * 40);
  var cps2 = Array.from(TEXT_PALETTE), s2 = "";
  for (var j2 = 0; j2 < len2; j2++) s2 += cps2[Math.floor(gapRand() * cps2.length)];
  var enc = PL.encode(s2);
  // the subsequence of non-letters must be identical before and after
  var before = s2.replace(/[A-Za-z]/g, "");
  var after = enc.replace(/[A-Za-z]/g, "");
  if (before !== after) { gapFail++; if (gapFail <= 3) failures.push("gaps changed: " + JSON.stringify(s2) + " -> " + JSON.stringify(enc)); }
}
ok(gapFail === 0, "encode preserves all non-letters over 5000 strings (" + gapFail + " failures)");

// 3c. encodeWord permutes the letters and appends a suffix (anagram invariant).
function sortedLetters(s) { return s.toLowerCase().split("").sort().join(""); }
var anagramRand = rng("anagram-fuzz");
var anaFail = 0;
for (var i4 = 0; i4 < 20000; i4++) {
  var w2 = randWord(anagramRand, 12);
  var e = PL.encodeWord(w2);
  var core = e.result.toLowerCase();
  // strip the known suffix
  core = core.slice(0, core.length - e.suffix.length);
  if (sortedLetters(core) !== sortedLetters(w2)) {
    anaFail++; if (anaFail <= 3) failures.push("not an anagram: " + JSON.stringify(w2) + " -> " + JSON.stringify(e.result));
  }
}
ok(anaFail === 0, "encodeWord is an anagram + suffix over 20000 words (" + anaFail + " failures)");

// 3d. the decoder is sound: the real word is always a valid pre-image.
["way", "yay", "ay"].forEach(function (style) {
  var decRand = rng("decode-" + style);
  var decFail = 0;
  for (var i5 = 0; i5 < 8000; i5++) {
    var w3 = randWord(decRand, 10);
    var pig = PL.encodeWordStr(w3, { style: style });
    var cands = PL.decodeCandidates(pig, { style: style });
    if (cands.indexOf(w3) === -1) {
      decFail++; if (decFail <= 3) failures.push("decode(" + style + ") lost original " + JSON.stringify(w3) + " from " + JSON.stringify(pig) + " -> " + JSON.stringify(cands));
    }
  }
  ok(decFail === 0, "decodeCandidates contains the original (" + style + ") over 8000 words (" + decFail + " failures)");
});

// every candidate the decoder returns must itself re-encode to the input.
var soundRand = rng("decode-sound");
var unsound = 0;
for (var i6 = 0; i6 < 8000; i6++) {
  var w4 = randWord(soundRand, 9);
  var pig2 = PL.encodeWordStr(w4);
  PL.decodeCandidates(pig2).forEach(function (c) {
    if (PL.encodeWordStr(c).toLowerCase() !== pig2.toLowerCase()) {
      unsound++; if (unsound <= 3) failures.push("decode produced a non-preimage " + JSON.stringify(c) + " for " + JSON.stringify(pig2));
    }
  });
}
ok(unsound === 0, "every decode candidate re-encodes to the input over 8000 words (" + unsound + " failures)");

// ---------------------------------------------------------------------------
// 4. Non-injectivity, demonstrated concretely.
// ---------------------------------------------------------------------------
// "antpay" rotates back to several valid pre-images (pant, tpan, ntpa, ...).
var ambiguous = PL.decodeCandidates("antpay");
ok(ambiguous.length >= 2, "antpay has multiple pre-images: " + JSON.stringify(ambiguous));
ok(ambiguous.indexOf("pant") !== -1, "pant is one pre-image of antpay");

// A collision: two different words that encode to the same Pig Latin string.
// pant → ant+p+ay = antpay ; tpan → an+tp+ay = antpay.
eq(PL.encodeWordStr("pant"), "antpay", "pant encodes to antpay");
eq(PL.encodeWordStr("tpan"), "antpay", "tpan encodes to antpay (collision)");
ok(PL.encodeWordStr("pant") === PL.encodeWordStr("tpan"),
   "distinct words collide under encoding");

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
