/*
 * tests.js — a dependency-free suite for the Inverted Index core.
 *
 *   node projects/phase2-data-structures/inverted-index/tests.js
 *
 * The headline claim of this project — *searching the inverted index returns
 * exactly the documents that contain the query* — is pinned against an
 * INDEPENDENT oracle that shares no code with the index merges:
 *
 *   - index set-algebra  ↔  per-document brute-force scan. `evaluate` answers a
 *     query by merging sorted postings lists; `scanMatch` answers the SAME
 *     parsed query by testing each document on its own. They must return the
 *     identical set of ids — on hand-built cases AND on a long randomised fuzz
 *     loop over random documents and random boolean/phrase queries.
 *   - postings invariants: ids strictly ascending, tf = #positions, positions
 *     ascending.
 *   - TF-IDF scores ↔ recomputed by hand from the raw term counts.
 *
 * Hand-worked cases nail down tokenisation, stop words, the stemmer, phrase
 * adjacency, boolean precedence (OR below AND, NOT binding tight) and ranking;
 * the fuzz loop then tries to break the index-vs-scan equivalence thousands of
 * times.
 */
"use strict";
var II = require("./inverted-index-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("  FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function arrEq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function approx(a, b, msg) { ok(Math.abs(a - b) < 1e-9, msg + " (got " + a + ", want " + b + ")"); }
function section(name) { console.log("\n== " + name + " =="); }

// ---------------------------------------------------------------------------
section("analysis: tokenise, lower-case, punctuation, numbers");
(function () {
  var A = II.makeAnalyzer({ stem: false, stopwords: false });
  arrEq(A.terms("Hello, WORLD!"), ["hello", "world"], "case fold + punctuation split");
  arrEq(A.terms("don't  stop--now"), ["dont", "stop", "now"], "apostrophe dropped, dash splits");
  arrEq(A.terms("Room 101 has 2 cats"), ["room", "101", "has", "2", "cats"], "digits are terms");
  arrEq(A.terms("   "), [], "all whitespace → no terms");
  arrEq(A.terms(""), [], "empty string → no terms");
  // positions are the running index of KEPT terms
  var stream = A.analyze("a b c");
  arrEq(stream.map(function (x) { return x.pos; }), [0, 1, 2], "positions are 0,1,2");
})();

// ---------------------------------------------------------------------------
section("analysis: stop words removed and renumbered");
(function () {
  var A = II.makeAnalyzer({ stem: false });   // default stopwords ON
  // "the" and "on" are stop words; surviving terms get consecutive positions
  var stream = A.analyze("the cat sat on the mat");
  arrEq(stream.map(function (x) { return x.term; }), ["cat", "sat", "mat"], "stop words dropped");
  arrEq(stream.map(function (x) { return x.pos; }), [0, 1, 2], "positions renumbered over survivors");
  ok(A.isStop("the"), "'the' is a stop word");
  ok(!A.isStop("cat"), "'cat' is not a stop word");
})();

// ---------------------------------------------------------------------------
section("analysis: the conservative stemmer");
(function () {
  eq(II.stem("cats"), "cat", "plural -s");
  eq(II.stem("boxes"), "box", "-es after x");
  eq(II.stem("cities"), "citi", "-ies → -i");
  eq(II.stem("running"), "run", "doubled consonant -ing");
  eq(II.stem("jumping"), "jump", "-ing");
  eq(II.stem("hopped"), "hop", "doubled consonant -ed");
  eq(II.stem("jumped"), "jump", "-ed");
  eq(II.stem("class"), "class", "-ss kept (not stripped to clas)");
  eq(II.stem("bus"), "bus", "short word untouched");
  eq(II.stem("us"), "us", "-us not treated as plural");
  // stemming makes singular/plural collide in the index
  var A = II.makeAnalyzer({ stopwords: false });
  eq(A.terms("Cats")[0], A.terms("cat")[0], "cat and cats share a term");
})();

// ---------------------------------------------------------------------------
section("index build: postings, df, term frequency, positions");
(function () {
  var idx = II.buildIndex([
    { name: "d0", text: "the cat sat on the mat" },      // cat sat mat
    { name: "d1", text: "a dog and a cat" },             // dog cat
    { name: "d2", text: "dogs dogs dogs" }               // dog dog dog (stemmed)
  ]);
  eq(idx.N, 3, "three documents");
  arrEq(II.termDocIds(idx, "cat"), [0, 1], "cat in d0,d1");
  arrEq(II.termDocIds(idx, "dog"), [1, 2], "dog in d1,d2 (dogs→dog)");
  eq(II.docFrequency(idx, "cat"), 2, "df(cat)=2");
  eq(II.docFrequency(idx, "dog"), 2, "df(dog)=2");
  eq(II.docFrequency(idx, "mat"), 1, "df(mat)=1");
  // term frequency: dog appears 3x in d2
  var p = II.postingsFor(idx, "dog");
  var inD2 = p.filter(function (x) { return x.id === 2; })[0];
  eq(inD2.tf, 3, "tf(dog,d2)=3");
  arrEq(inD2.positions, [0, 1, 2], "positions of dog in d2");
  // a term not present
  arrEq(II.termDocIds(idx, "fish"), [], "absent term → empty postings");
  // invariants
  ok(II.checkInvariants(idx).ok, "index invariants hold");
})();

// ---------------------------------------------------------------------------
section("query parser: structure and precedence");
(function () {
  var A = II.makeAnalyzer({ stem: false, stopwords: false });
  eq(II.describe(II.parseQuery("cat", A)), "cat", "single term");
  eq(II.describe(II.parseQuery("cat dog", A)), "(cat AND dog)", "implicit AND");
  eq(II.describe(II.parseQuery("cat OR dog", A)), "(cat OR dog)", "explicit OR");
  eq(II.describe(II.parseQuery("cat -dog", A)), "(cat AND NOT dog)", "'-' is NOT");
  eq(II.describe(II.parseQuery("cat NOT dog", A)), "(cat AND NOT dog)", "'NOT' keyword");
  // OR is lower precedence than the implicit AND
  eq(II.describe(II.parseQuery("a b OR c d", A)), "((a AND b) OR (c AND d))", "OR below AND");
  eq(II.describe(II.parseQuery("a (b OR c)", A)), "(a AND (b OR c))", "parentheses group OR");
  eq(II.describe(II.parseQuery('"new york"', A)), '"new york"', "quoted phrase");
  eq(II.describe(II.parseQuery("", A)), "∅", "empty query");
})();

// ---------------------------------------------------------------------------
section("search: boolean AND / OR / NOT against the index");
(function () {
  var idx = II.buildIndex([
    { name: "d0", text: "cat and dog" },
    { name: "d1", text: "cat only" },
    { name: "d2", text: "dog only" },
    { name: "d3", text: "fish tank" }
  ], { stopwords: false, stem: false });

  arrEq(II.evaluate(idx, II.parseQuery("cat", idx.analyzer)), [0, 1], "cat → d0,d1");
  arrEq(II.evaluate(idx, II.parseQuery("cat dog", idx.analyzer)), [0], "cat AND dog → d0");
  arrEq(II.evaluate(idx, II.parseQuery("cat OR dog", idx.analyzer)), [0, 1, 2], "cat OR dog → d0,d1,d2");
  arrEq(II.evaluate(idx, II.parseQuery("cat -dog", idx.analyzer)), [1], "cat AND NOT dog → d1");
  arrEq(II.evaluate(idx, II.parseQuery("-cat", idx.analyzer)), [2, 3], "NOT cat → d2,d3");
  arrEq(II.evaluate(idx, II.parseQuery("whale", idx.analyzer)), [], "absent term → nothing");
})();

// ---------------------------------------------------------------------------
section("search: phrase (positional) match");
(function () {
  var idx = II.buildIndex([
    { name: "d0", text: "i love new york city" },   // ... new york ...
    { name: "d1", text: "york new is backwards" },   // york new (wrong order)
    { name: "d2", text: "new big york" }             // new _ york (not adjacent)
  ], { stopwords: false, stem: false });
  arrEq(II.evaluate(idx, II.parseQuery('"new york"', idx.analyzer)), [0], "phrase matches only adjacent, in order");
  arrEq(II.evaluate(idx, II.parseQuery('"york new"', idx.analyzer)), [1], "reversed phrase matches d1");
  arrEq(II.evaluate(idx, II.parseQuery("new york", idx.analyzer)), [0, 1, 2], "bag-of-words AND matches all three");
  // phrase respects stop-word renumbering: with stopwords ON, "cat ... mat"
  var idx2 = II.buildIndex([{ name: "x", text: "the cat on the mat" }]);  // → cat mat adjacent
  arrEq(II.evaluate(idx2, II.parseQuery('"cat mat"', idx2.analyzer)), [0], "phrase over surviving (stop-word-stripped) stream");
})();

// ---------------------------------------------------------------------------
section("ranking: TF-IDF order and recomputed values");
(function () {
  var idx = II.buildIndex([
    { name: "d0", text: "apple apple apple banana" },   // apple x3
    { name: "d1", text: "apple banana banana" },        // apple x1
    { name: "d2", text: "cherry" }
  ], { stopwords: false, stem: false });
  var r = II.search(idx, "apple");
  arrEq(r.results.map(function (x) { return x.id; }), [0, 1], "apple ranks d0 (3×) above d1 (1×)");
  // recompute score of d0 for 'apple' by hand
  var N = 3, df = 2;
  var idf = Math.log(N / df) / Math.LN10;
  var expect0 = (1 + Math.log(3) / Math.LN10) * idf;
  approx(r.results[0].score, expect0, "d0 apple score matches hand TF-IDF");
  // a term in every doc (idf 0) contributes nothing
  var idxAll = II.buildIndex(["x y", "x z", "x w"], { stopwords: false, stem: false });
  approx(II.idf(idxAll, "x"), 0, "idf of a term in every doc is 0");
})();

// ---------------------------------------------------------------------------
section("edge cases");
(function () {
  var empty = II.buildIndex([], { stopwords: false, stem: false });
  eq(empty.N, 0, "empty corpus");
  arrEq(II.evaluate(empty, II.parseQuery("anything", empty.analyzer)), [], "query on empty corpus");

  var idx = II.buildIndex([{ name: "d0", text: "only one doc here" }], { stopwords: false, stem: false });
  arrEq(II.evaluate(idx, II.parseQuery("the", idx.analyzer)), [], "stop-less analyzer: 'the' absent → nothing");
  arrEq(II.evaluate(idx, II.parseQuery("   ", idx.analyzer)), [], "whitespace query → nothing");
  // object input form {name: text}
  var idxObj = II.buildIndex({ alpha: "red green", beta: "green blue" }, { stopwords: false, stem: false });
  arrEq(II.termDocIds(idxObj, "green"), [0, 1], "object input: green in both");
  eq(idxObj.docs[0].name, "alpha", "object input keeps names");
})();

// ---------------------------------------------------------------------------
section("set merges: direct unit checks");
(function () {
  arrEq(II.intersect([1, 2, 3, 5], [2, 3, 4, 5]), [2, 3, 5], "intersect");
  arrEq(II.union([1, 3, 5], [2, 3, 4]), [1, 2, 3, 4, 5], "union dedupes");
  arrEq(II.difference([1, 2, 3, 4], [2, 4]), [1, 3], "difference");
  arrEq(II.intersect([], [1, 2]), [], "intersect with empty");
  arrEq(II.union([], []), [], "union of empties");
})();

// ===========================================================================
section("ORACLE: index set-algebra ↔ per-document scan (hand cases)");
(function () {
  var idx = II.buildIndex([
    { name: "d0", text: "the quick brown fox jumps over the lazy dog" },
    { name: "d1", text: "a quick brown dog outpaces a quick fox" },
    { name: "d2", text: "lazy cats and lazy dogs sleep all day" },
    { name: "d3", text: "the fox and the hound" }
  ]);
  var queries = [
    "quick", "fox", "lazy dog", "quick OR lazy", "fox -dog",
    "quick brown", "(fox OR cat) -dog", '"quick brown"', '"brown fox"',
    "NOT quick", "dog AND NOT lazy", "cat OR hound OR fox"
  ];
  queries.forEach(function (q) {
    var ast = II.parseQuery(q, idx.analyzer);
    arrEq(II.evaluate(idx, ast), II.scanMatch(idx, ast), "index==scan for: " + q);
  });
})();

// ===========================================================================
section("ORACLE: randomised fuzz — index ↔ scan on thousands of queries");
(function () {
  // deterministic PRNG so a failure is reproducible
  var seed = 0x51ed;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }

  var VOCAB = ["cat", "cats", "dog", "dogs", "fox", "quick", "brown", "lazy",
               "the", "red", "run", "running", "box", "boxes", "york", "new"];

  function randomDoc() {
    var n = 2 + Math.floor(rnd() * 10), words = [];
    for (var i = 0; i < n; i++) words.push(pick(VOCAB));
    return words.join(" ");
  }
  function randomQuery(depth) {
    var roll = rnd();
    if (depth <= 0 || roll < 0.45) return pick(VOCAB);
    if (roll < 0.58) return '"' + pick(VOCAB) + " " + pick(VOCAB) + '"';   // phrase
    if (roll < 0.70) return "-" + randomQuery(depth - 1);                  // NOT
    if (roll < 0.85) return "(" + randomQuery(depth - 1) + " OR " + randomQuery(depth - 1) + ")";
    return randomQuery(depth - 1) + " " + randomQuery(depth - 1);          // implicit AND
  }

  var trials = 4000, mismatches = 0, invariantFails = 0, checkedNonEmpty = 0;
  for (var t = 0; t < trials; t++) {
    var ndocs = 1 + Math.floor(rnd() * 6), docs = [];
    for (var d = 0; d < ndocs; d++) docs.push({ name: "d" + d, text: randomDoc() });
    // vary analyzer options too, so phrase/stop/stem interplay is exercised
    var opts = { stopwords: rnd() < 0.5, stem: rnd() < 0.5 };
    var idx = II.buildIndex(docs, opts);
    if (!II.checkInvariants(idx).ok) invariantFails++;
    var q = randomQuery(3);
    var ast = II.parseQuery(q, idx.analyzer);
    var viaIndex = II.evaluate(idx, ast);
    var viaScan = II.scanMatch(idx, ast);
    if (JSON.stringify(viaIndex) !== JSON.stringify(viaScan)) {
      mismatches++;
      if (mismatches <= 3) console.error("    mismatch q=" + JSON.stringify(q) +
        " idx=" + JSON.stringify(viaIndex) + " scan=" + JSON.stringify(viaScan) +
        " docs=" + JSON.stringify(docs.map(function (x) { return x.text; })));
    }
    if (viaScan.length > 0) checkedNonEmpty++;
  }
  eq(mismatches, 0, "no index/scan mismatches across " + trials + " fuzz trials");
  eq(invariantFails, 0, "invariants held on every fuzz index");
  ok(checkedNonEmpty > trials / 10, "fuzz exercised a healthy share of non-empty results (" + checkedNonEmpty + ")");
})();

// ===========================================================================
section("ORACLE: TF-IDF monotonicity — more of a rare term ranks higher");
(function () {
  var idx = II.buildIndex([
    { name: "few",   text: "zebra lion lion" },
    { name: "many",  text: "zebra zebra zebra lion" },
    { name: "other", text: "lion lion lion" }        // no zebra → idf(zebra) > 0
  ], { stopwords: false, stem: false });
  ok(II.idf(idx, "zebra") > 0, "idf(zebra) > 0 (not in every doc)");
  var r = II.search(idx, "zebra");
  eq(r.results[0].name, "many", "doc with more 'zebra' ranks first");
  // and a two-term query sums contributions
  var r2 = II.search(idx, "zebra lion");
  eq(r2.results.length, 2, "both docs match zebra AND lion");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (fail === 0 ? "OK" : "FAILED") + ": " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
