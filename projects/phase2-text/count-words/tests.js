/*
 * tests.js — dependency-free test suite for the Count Words engine.
 *
 * Run it:  node projects/phase2-text/count-words/tests.js
 *
 * Five kinds of check, matching the house pattern:
 *   1. a curated corpus pinned to exact expected counts;
 *   2. the independent cross-check (scan vs regex) over a large fuzz;
 *   3. grounding — on plain space-separated ASCII, both real implementations
 *      match the obvious naive answer (where the naive answer is right);
 *   4. property laws (non-negativity, dropped+words tiling, idempotence...);
 *   5. the gap, demonstrated — concrete strings where the naive one-liner and
 *      the Unicode segmenter each disagree with the honest count, on purpose.
 */
"use strict";
var W = require("./words-core.js");

var passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name + (extra ? "  — " + extra : "")); }
}
function eq(name, got, want) {
  ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

/* ------------------------------------------------------------------ *
 * 1. Curated corpus — exact expected word counts.
 * ------------------------------------------------------------------ */
var corpus = [
  // [input, expected count, note]
  ["", 0, "empty string is zero words (the naive bug)"],
  ["   ", 0, "whitespace only is zero"],
  ["\t\n\r  \f", 0, "assorted ASCII whitespace only is zero"],
  ["hello", 1, "one bare word"],
  ["the quick brown fox", 4, "textbook four"],
  ["  leading and trailing   ", 3, "surrounding whitespace ignored"],
  ["multiple     spaces   between", 3, "runs of spaces collapse"],
  ["line\nbreaks\tand\ttabs", 4, "newlines and tabs separate"],
  ["don't can't won't", 3, "apostrophes stay inside the word"],
  ["well-being is hyphenated", 3, "a hyphen does not split a whitespace token"],
  ["hi -- there", 2, "a lone -- token is punctuation, not a word"],
  ["smile :) then !!! stop", 3, "emoticon and bang-run are dropped"],
  ["...", 0, "pure punctuation is zero words"],
  ["3.14 and 42 are numbers", 5, "digit tokens count; 3.14 is one token"],
  ["café résumé naïve", 3, "accented words count once each"],
  ["é is e-plus-accent", 3, "a decomposed accent does not add a word"],
  ["a b", 2, "no-break space (U+00A0) separates"],
  ["x y z", 3, "line and paragraph separators separate"],
  ["one　two", 2, "ideographic space (U+3000) separates"],
  ["12 000 francs", 3, "narrow no-break space splits 12 from 000"],
  ["😀 🚀 words", 1, "lone emoji are not words; only 'words' counts"],
  ["a👍b", 1, "emoji inside a run doesn't split it; the run has letters"],
  ["Héllo", 1, "precomposed accent, one word"],
];
corpus.forEach(function (c) {
  eq("corpus: " + JSON.stringify(c[0]) + " (" + c[2] + ")", W.count(c[0]), c[1]);
});

/* ------------------------------------------------------------------ *
 * 2. Independent cross-check: scan vs regex must agree on count AND the
 *    ordered word list, across a large pseudo-random Unicode fuzz.
 * ------------------------------------------------------------------ */
// A deterministic LCG so the run is reproducible.
var seed = 0x1234abcd;
function rnd() {
  seed = (1103515245 * seed + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
var palette = [
  "a", "b", "z", "Q", "0", "7", "é", "é", "ñ", "ü", "ø", "ß",
  " ", "  ", "\t", "\n", "\r", "\f", " ", " ", " ",
  " ", "　", " ", " ", "﻿",
  ".", ",", "-", "--", "'", "’", ":)", "!!!", "…", "(", ")",
  "你", "好", "世", "界", "日", "本", "ก", "😀", "🚀", "👍", "𝐚", "Á"
];
function randStr() {
  var n = Math.floor(rnd() * 14); // 0..13 pieces
  var s = "";
  for (var i = 0; i < n; i++) s += palette[Math.floor(rnd() * palette.length)];
  return s;
}
var FUZZ = 40000;
var mismatch = 0, firstBad = null;
for (var i = 0; i < FUZZ; i++) {
  var s = randStr();
  var a = W.scanWords(s);
  var b = W.regexWords(s);
  var same = a.count === b.count && a.words.length === b.words.length &&
    a.words.every(function (w, k) { return w === b.words[k]; });
  if (!same) { mismatch++; if (!firstBad) firstBad = s; }
}
ok("fuzz: scanWords === regexWords across " + FUZZ + " strings", mismatch === 0,
  mismatch + " mismatches, first on " + JSON.stringify(firstBad));

/* ------------------------------------------------------------------ *
 * 3. Grounding — on plain space-separated ASCII words (no punctuation,
 *    single spaces, non-empty), the honest count equals the naive one-liner.
 *    This pins the Unicode machinery to the obvious answer exactly where the
 *    obvious answer is correct.
 * ------------------------------------------------------------------ */
var asciiWords = ["the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
  "a", "b", "code", "test42", "x1y2"];
var groundMismatch = 0;
for (var g = 0; g < 5000; g++) {
  var m = 1 + Math.floor(rnd() * 8);
  var parts = [];
  for (var j = 0; j < m; j++) parts.push(asciiWords[Math.floor(rnd() * asciiWords.length)]);
  var str = parts.join(" ");
  if (!(W.count(str) === m && W.regexWords(str).count === m && W.countNaive(str) === m)) {
    groundMismatch++;
  }
}
ok("grounding: honest count == naive on clean ASCII (5000 strings)", groundMismatch === 0,
  groundMismatch + " mismatches");

/* ------------------------------------------------------------------ *
 * 4. Property laws.
 * ------------------------------------------------------------------ */
var lawInputs = corpus.map(function (c) { return c[0]; })
  .concat(["a b c", "   x   ", "你好世界", "mix 你 and words", "  ", "'", "—"]);

// (a) count is never negative and equals words.length.
lawInputs.forEach(function (s) {
  var r = W.analyze(s);
  ok("law/count==words.length: " + JSON.stringify(s), r.count === r.words.length);
  ok("law/count>=0: " + JSON.stringify(s), r.count >= 0);
});

// (b) the render segments tile the input exactly — concatenating them in order
//     reproduces the original string with nothing added or lost.
lawInputs.forEach(function (s) {
  var r = W.analyze(s);
  var rebuilt = r.segments.map(function (x) { return x.text; }).join("");
  eq("law/segments tile input: " + JSON.stringify(s), rebuilt, s);
});

// (c) the number of "word" segments equals the count, and "nonword" segments
//     equal the dropped list length.
lawInputs.forEach(function (s) {
  var r = W.analyze(s);
  var wordSegs = r.segments.filter(function (x) { return x.kind === "word"; }).length;
  var nonwordSegs = r.segments.filter(function (x) { return x.kind === "nonword"; }).length;
  eq("law/word segs == count: " + JSON.stringify(s), wordSegs, r.count);
  eq("law/nonword segs == dropped: " + JSON.stringify(s), nonwordSegs, r.dropped.length);
});

// (d) idempotence through a round of whitespace normalisation: joining the
//     detected words with single spaces and recounting returns the same count.
lawInputs.forEach(function (s) {
  var r = W.analyze(s);
  var joined = r.words.join(" ");
  eq("law/normalise-stable: " + JSON.stringify(s), W.count(joined), r.count);
});

// (e) scan and regex agree flag is true on every law input.
lawInputs.forEach(function (s) {
  ok("law/agree flag true: " + JSON.stringify(s), W.analyze(s).agree === true);
});

/* ------------------------------------------------------------------ *
 * 5. The gap, demonstrated — where the rivals disagree, on purpose.
 * ------------------------------------------------------------------ */
// (a) the naive one-liner's empty-string bug: honest 0, naive 1.
eq("gap/naive empty: honest", W.count(""), 0);
eq("gap/naive empty: naive", W.countNaive(""), 1);
eq("gap/naive spaces: honest", W.count("   "), 0);
eq("gap/naive spaces: naive", W.countNaive("   "), 1);
ok("gap/naive overcounts punctuation", W.countNaive("hi :) !!!") > W.count("hi :) !!!"),
  "naive " + W.countNaive("hi :) !!!") + " vs honest " + W.count("hi :) !!!"));

// (b) the segmenter ceiling: scriptio continua. Whitespace sees one token,
//     Unicode segmentation sees the real words — IF the runtime has Segmenter.
if (W.hasSegmenter()) {
  eq("gap/CJK whitespace count", W.count("你好世界"), 1);
  var seg = W.segmentWords("你好世界");
  ok("gap/CJK segmenter sees more", seg.count > 1,
    "segmenter counted " + seg.count);
  // On clean spaced ASCII the two broadly track (segmenter may split or keep
  // some tokens, but it must be positive and find every obvious word).
  ok("gap/segmenter finds spaced words", W.segmentWords("the quick brown fox").count >= 4);
} else {
  console.log("  (Intl.Segmenter unavailable in this runtime — segmenter-gap checks skipped)");
}

/* ------------------------------------------------------------------ */
console.log("\n" + passed + " passed, " + failed + " failed.");
process.exit(failed === 0 ? 0 : 1);
