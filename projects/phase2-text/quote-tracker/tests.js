/*
 * tests.js — dependency-free test suite for the Quote Tracker engine.
 *
 * Run it:  node projects/phase2-text/quote-tracker/tests.js
 *
 * The engine is checked the house way — curated cases that pin exact answers,
 * then the hard guarantees as PROPERTIES over a large random fuzz:
 *
 *   1. attribution — curated pastes across the straight/curly quotes and the
 *      five dash conventions, then the round-trip law parse(format(q)) === q
 *      over a fuzz whose palette mixes ASCII, an astral emoji and a combining
 *      mark, so "unwrap the quote glyph, split on the right dash" is tested;
 *   2. identity — quoteKey folds whitespace/case/wrapping-glyph variants of the
 *      same saying together but keeps genuinely different sayings (and the same
 *      words by different authors) apart;
 *   3. the Store — dedup on add, insertion order, edit/remove, the tag index,
 *      and tokenised AND search with a tag filter;
 *   4. the rotation — pickForDay over `count` consecutive days is a PERMUTATION
 *      (every quote exactly once before any repeat), proved over many cycles and
 *      many store sizes, and the order differs cycle to cycle;
 *   5. serialisation — fromObject(store.toObject()) reproduces the store
 *      field-for-field over a fuzz, and re-importing is an idempotent no-op.
 */
"use strict";
var C = require("./tracker-core.js");

var passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name + (extra ? "  — " + extra : "")); }
}
function eq(name, got, want) {
  ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}
function deepEq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

/* ------------------------------------------------------------------ *
 * 1. Attribution parsing — curated
 * ------------------------------------------------------------------ */

deepEq("parse/em dash + curly quotes",
  C.parseAttribution("“Be yourself; everyone else is already taken.” — Oscar Wilde"),
  { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" });

deepEq("parse/straight quotes + hyphen",
  C.parseAttribution('"Stay hungry, stay foolish." - Steve Jobs'),
  { text: "Stay hungry, stay foolish.", author: "Steve Jobs" });

deepEq("parse/en dash",
  C.parseAttribution("The unexamined life is not worth living. – Socrates"),
  { text: "The unexamined life is not worth living.", author: "Socrates" });

deepEq("parse/double hyphen",
  C.parseAttribution("I think, therefore I am. -- Descartes"),
  { text: "I think, therefore I am.", author: "Descartes" });

deepEq("parse/no author",
  C.parseAttribution("A quote with nobody attached"),
  { text: "A quote with nobody attached", author: "" });

// A hyphen INSIDE a word is not a separator (no surrounding spaces).
deepEq("parse/internal hyphen is not a separator",
  C.parseAttribution("well-being is self-made — Anon"),
  { text: "well-being is self-made", author: "Anon" });

// A quote that itself contains a dashed clause: only the LAST separator splits.
deepEq("parse/splits on the last separator",
  C.parseAttribution("Knowledge — real knowledge — is power — Bacon"),
  { text: "Knowledge — real knowledge — is power", author: "Bacon" });

deepEq("parse/leading dash means no text",
  C.parseAttribution("— attributed to nobody in particular"),
  { text: "", author: "attributed to nobody in particular" });

eq("format/with author",
  C.formatAttribution({ text: "Less is more", author: "Mies" }),
  "“Less is more” — Mies");
eq("format/without author",
  C.formatAttribution({ text: "Anonymous wisdom", author: "" }),
  "“Anonymous wisdom”");

/* ------------------------------------------------------------------ *
 * 2. Attribution round-trip — property over a fuzz
 *
 * For any {text, author} drawn from a palette that excludes the canonical
 * separator " — ", formatting then parsing returns the same pair. The palette
 * deliberately includes an astral emoji and a combining mark so "don't slice a
 * code point / handle Unicode" is exercised, not assumed.
 * ------------------------------------------------------------------ */

(function () {
  var rnd = C.mulberry32(12345);
  // No em dash, no wrapping-quote glyphs at the ends (format adds its own).
  var words = ["alpha", "beta", "hello", "world", "code", "test",
               "café", "naïve", "é", "😀", "x", "42",
               "well-being", "self-made", "a,b", "quote!", "(paren)"];
  function phrase(maxWords) {
    var n = 1 + Math.floor(rnd() * maxWords);
    var parts = [];
    for (var i = 0; i < n; i++) parts.push(words[Math.floor(rnd() * words.length)]);
    // Avoid an accidental wrapping pair at the very ends by padding with a letter.
    return ("w " + parts.join(" ") + " w").trim();
  }
  var bad = 0, N = 20000;
  for (var i = 0; i < N; i++) {
    var q = { text: phrase(6), author: phrase(3) };
    var round = C.parseAttribution(C.formatAttribution(q));
    if (round.text !== q.text || round.author !== q.author) {
      if (bad < 3) console.error("  roundtrip miss:", JSON.stringify(q), "->", JSON.stringify(round));
      bad++;
    }
  }
  ok("attribution round-trip over " + N + " fuzz pairs", bad === 0, bad + " mismatches");
})();

/* ------------------------------------------------------------------ *
 * 3. Identity / quoteKey
 * ------------------------------------------------------------------ */

eq("key/whitespace + case fold together",
  C.quoteKey("  The   Only   Way  ", "Steve"),
  C.quoteKey("the only way", "steve"));
eq("key/wrapping glyph folded",
  C.quoteKey("“Do or do not”", "Yoda"),
  C.quoteKey("Do or do not", "yoda"));
eq("key/NFC: combining vs precomposed agree",
  C.quoteKey("café", "x"), C.quoteKey("café", "x"));
ok("key/different authors are different quotes",
  C.quoteKey("same words", "Alice") !== C.quoteKey("same words", "Bob"));
ok("key/different words are different quotes",
  C.quoteKey("a", "x") !== C.quoteKey("b", "x"));

/* ------------------------------------------------------------------ *
 * 4. The Store — dedup, order, edit, remove, tags, search
 * ------------------------------------------------------------------ */

(function () {
  var s = new C.Store();
  var r1 = s.add({ text: "First", author: "A", tags: ["life", "Life", " motivation "] });
  eq("store/add returns added", r1.added, true);
  eq("store/tags normalised + de-duped", JSON.stringify(r1.item.tags),
    JSON.stringify(["life", "motivation"]));

  // Same saying, different whitespace/case/quotes/author-case -> NOT added.
  var r2 = s.add({ text: "  first ", author: "a" });
  eq("store/duplicate not added", r2.added, false);
  eq("store/duplicate returns existing", r2.item.id, r1.item.id);
  eq("store/count still 1", s.count(), 1);

  // Empty quote refused.
  eq("store/empty refused", s.add({ text: "   ", author: "x" }).added, false);

  s.add({ text: "Second", author: "B", tags: ["work"] });
  s.add({ text: "Third", author: "A", tags: ["life"] });
  deepEq("store/insertion order preserved",
    s.list().map(function (q) { return q.text; }), ["First", "Second", "Third"]);

  deepEq("store/tag index with counts", s.tagCounts(),
    [{ tag: "life", count: 2 }, { tag: "motivation", count: 1 }, { tag: "work", count: 1 }]);

  // Edit colliding with a different quote is refused; a clean edit works.
  eq("store/edit to duplicate refused",
    s.edit(s.list()[1].id, { text: "First", author: "A" }).reason, "duplicate");
  eq("store/clean edit ok",
    s.edit(s.list()[1].id, { text: "Second!", author: "B" }).ok, true);

  // remove
  var mid = s.list()[1].id;
  eq("store/remove ok", s.remove(mid), true);
  eq("store/count after remove", s.count(), 2);
  // After removal the key is free again.
  eq("store/re-add after removal", s.add({ text: "Second!", author: "B" }).added, true);
})();

(function () {
  var s = new C.Store([
    { text: "The journey of a thousand miles begins", author: "Laozi", tags: ["wisdom"] },
    { text: "Simplicity is the soul of efficiency", author: "Austin Freeman", tags: ["code", "wisdom"] },
    { text: "Talk is cheap. Show me the code.", author: "Linus Torvalds", tags: ["code"] }
  ]);

  // Token AND.
  deepEq("search/single token",
    s.search("code").map(function (q) { return q.author; }),
    ["Austin Freeman", "Linus Torvalds"]);
  deepEq("search/two tokens AND",
    s.search("show code").map(function (q) { return q.author; }),
    ["Linus Torvalds"]);
  // Author is searched too, diacritic/case folded.
  deepEq("search/matches author", s.search("laozi").length ? ["ok"] : [], ["ok"]);
  // Tag filter.
  deepEq("search/tag filter",
    s.search("", ["wisdom"]).map(function (q) { return q.author; }),
    ["Laozi", "Austin Freeman"]);
  deepEq("search/tag filter + token",
    s.search("efficiency", ["wisdom"]).map(function (q) { return q.author; }),
    ["Austin Freeman"]);
  eq("search/empty query returns all", s.search("").length, 3);
  eq("search/no match", s.search("zzz").length, 0);

  // Search property: a token matches iff it is a folded substring of the record.
  var rnd = C.mulberry32(99);
  var all = s.list();
  var bad = 0;
  for (var i = 0; i < 2000; i++) {
    var item = all[Math.floor(rnd() * all.length)];
    var hay = C.fold(item.text + " " + item.author + " " + item.tags.join(" "));
    // pick a random substring of the haystack as the query token
    var a = Math.floor(rnd() * hay.length), b = a + 1 + Math.floor(rnd() * 5);
    var tok = hay.slice(a, b).trim();
    if (!tok) continue;
    var hits = s.search(tok);
    var shouldHit = hits.indexOf(item) !== -1;
    if (!shouldHit) { bad++; }
  }
  ok("search/substring token always finds its source (2000 fuzz)", bad === 0, bad + " misses");
})();

/* ------------------------------------------------------------------ *
 * 5. The fair rotation — pickForDay is a permutation per cycle
 * ------------------------------------------------------------------ */

(function () {
  // orderForDay over n consecutive days, within one cycle, is a permutation.
  var sizes = [1, 2, 3, 5, 7, 12, 31, 100];
  var bad = 0, sameOrderCycles = 0;
  for (var si = 0; si < sizes.length; si++) {
    var n = sizes[si];
    for (var cycle = 0; cycle < 5; cycle++) {
      var seen = {}, order = [];
      for (var pos = 0; pos < n; pos++) {
        var day = cycle * n + pos;
        var idx = C.orderForDay(n, day);
        if (idx < 0 || idx >= n) bad++;
        if (seen[idx]) bad++;           // repeat within the cycle -> fail
        seen[idx] = 1;
        order.push(idx);
      }
      if (Object.keys(seen).length !== n) bad++; // must cover all
      // Compare cycle 0 order to cycle 1 order for n>2: they should differ.
      if (n > 2 && cycle === 1) {
        var zero = [];
        for (var p = 0; p < n; p++) zero.push(C.orderForDay(n, p));
        if (JSON.stringify(zero) === JSON.stringify(order)) sameOrderCycles++;
      }
    }
  }
  ok("rotation/every cycle is a permutation (all sizes)", bad === 0, bad + " violations");
  ok("rotation/order varies cycle to cycle", sameOrderCycles === 0,
    sameOrderCycles + " cycles repeated the exact order");

  // Over k*n days the pick histogram is flat: each quote exactly k times.
  var s = new C.Store();
  for (var q = 0; q < 10; q++) s.add({ text: "q" + q, author: "a" });
  var hist = {}, k = 7;
  for (var d = 0; d < k * 10; d++) {
    var picked = s.quoteOfDay(d).text;
    hist[picked] = (hist[picked] || 0) + 1;
  }
  var flat = Object.keys(hist).every(function (key) { return hist[key] === k; });
  ok("rotation/histogram flat over k full cycles", flat && Object.keys(hist).length === 10,
    JSON.stringify(hist));

  // Determinism and the empty store.
  eq("rotation/deterministic", s.quoteOfDay(42).text, s.quoteOfDay(42).text);
  eq("rotation/empty store -> null", new C.Store().quoteOfDay(0), null);
  // Negative day index is handled (modulo wraps correctly).
  ok("rotation/negative day index valid", s.quoteOfDay(-1) !== null);
})();

/* ------------------------------------------------------------------ *
 * 6. Serialisation round-trip over a fuzz
 * ------------------------------------------------------------------ */

(function () {
  var rnd = C.mulberry32(2024);
  var words = ["alpha", "beta", "café", "😀", "code", "zen", "x", "well-being"];
  var tagpool = ["life", "code", "work", "wisdom", "funny", "zen"];
  function phrase(mx) {
    var n = 1 + Math.floor(rnd() * mx), p = [];
    for (var i = 0; i < n; i++) p.push(words[Math.floor(rnd() * words.length)]);
    return p.join(" ");
  }
  function tags() {
    var n = Math.floor(rnd() * 3), t = [];
    for (var i = 0; i < n; i++) t.push(tagpool[Math.floor(rnd() * tagpool.length)]);
    return t;
  }

  var bad = 0, trials = 400;
  for (var t = 0; t < trials; t++) {
    var s = new C.Store();
    var m = 1 + Math.floor(rnd() * 20);
    for (var i = 0; i < m; i++)
      s.add({ text: "q" + i + " " + phrase(4), author: phrase(2), tags: tags() });
    var round = C.fromObject(s.toObject());
    if (JSON.stringify(round.toObject()) !== JSON.stringify(s.toObject())) bad++;
    // JSON string path too.
    var round2 = C.fromObject(s.toJSON());
    if (JSON.stringify(round2.toObject()) !== JSON.stringify(s.toObject())) bad++;
    // Re-import is idempotent (dedup): importing the exported quotes again adds nothing.
    var before = round.count();
    round.toObject().quotes.forEach(function (q) { round.add(q); });
    if (round.count() !== before) bad++;
  }
  ok("serialise/round-trip + idempotent re-import over " + trials + " stores", bad === 0,
    bad + " failures");

  // Accepts a bare array, and version/shape is stable.
  var s2 = C.fromObject([{ text: "Hi", author: "Me", tags: ["x"] }]);
  eq("serialise/accepts bare array", s2.count(), 1);
  deepEq("serialise/export shape",
    JSON.parse(s2.toJSON()),
    { version: 1, quotes: [{ text: "Hi", author: "Me", tags: ["x"] }] });
})();

/* ------------------------------------------------------------------ */
console.log("\n" + passed + " passed, " + failed + " failed.");
process.exit(failed === 0 ? 0 : 1);
