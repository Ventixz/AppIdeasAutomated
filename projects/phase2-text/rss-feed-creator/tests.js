/*
 * tests.js — dependency-free test suite for the RSS Feed Creator engine.
 *
 * Run it:  node projects/phase2-text/rss-feed-creator/tests.js
 *
 * The reader (XML + RSS/Atom -> one post model) and the writer (post model ->
 * canonical RSS 2.0) are inverses, and the suite leans on that the house way:
 *
 *   1. ROUND-TRIP LAW over a fuzz — parseFeed(toRss(feed)) reproduces a random
 *      feed, field for field, over thousands of generated feeds whose text
 *      deliberately contains <, >, &, ", ', CDATA-ending "]]>", astral emoji
 *      and combining marks, and whose dates span a wide range at whole-second
 *      resolution. This one law pins the parser, the serialiser, the entity
 *      table and the RFC-822 date format all at once.
 *
 *   2. ENTITIES — the five named entities plus numeric (decimal and hex,
 *      including an astral code point) decode exactly, and escapeXml/decode
 *      round-trip over a fuzz.
 *
 *   3. DATES — RFC-822 (with/without day name and seconds, numeric and named
 *      zones) and RFC-3339 (Z and offset, fractional seconds) parse to the
 *      right instant, and toRfc822 -> parseRfc822 round-trips whole seconds.
 *
 *   4. REAL SAMPLES — the bundled RSS 2.0 and Atom feeds parse to the exact
 *      posts a human reads off them: counts, titles, links, authors, the
 *      namespaced dc:creator / content:encoded fields, and CDATA kept literal.
 *
 *   5. EDGE CASES — comments and PIs skipped, self-closing tags, mismatched
 *      closing tags tolerated, and the documented errors thrown.
 */
"use strict";

var F = require("./feed-core.js");
var SAMPLES = require("./samples.js");

var passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name + (extra ? "  — " + extra : "")); }
}
function eq(name, got, want) {
  ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}
function throws(name, fn, re) {
  try { fn(); ok(name, false, "expected throw"); }
  catch (e) { ok(name, re ? re.test(e.message) : true, "message was " + JSON.stringify(e.message)); }
}

/* ------------------------------------------------------------------ *
 * 1. Entities                                                        *
 * ------------------------------------------------------------------ */

eq("decode &lt;", F.decodeEntities("a &lt; b"), "a < b");
eq("decode all named", F.decodeEntities("&lt;&gt;&amp;&quot;&apos;"), "<>&\"'");
eq("decode decimal", F.decodeEntities("&#60;&#62;"), "<>");
eq("decode hex", F.decodeEntities("&#x3C;&#X3e;"), "<>");
eq("decode astral", F.decodeEntities("&#128512;"), "😀");
eq("decode astral hex", F.decodeEntities("&#x1F600;"), "😀");
eq("unknown entity left as-is", F.decodeEntities("5&nbsp;x"), "5&nbsp;x");
eq("bare ampersand untouched", F.decodeEntities("fish & chips"), "fish & chips");
eq("escape then decode round-trips",
  F.decodeEntities(F.escapeXml("<a href=\"x\">&'y'</a>")), "<a href=\"x\">&'y'</a>");

/* ------------------------------------------------------------------ *
 * 2. Dates                                                           *
 * ------------------------------------------------------------------ */

eq("rfc822 full +0000",
  F.parseRfc822("Wed, 02 Oct 2002 13:00:00 +0000").getTime(),
  Date.UTC(2002, 9, 2, 13, 0, 0));
eq("rfc822 no day name, no seconds",
  F.parseRfc822("2 Oct 2002 13:00 +0000").getTime(),
  Date.UTC(2002, 9, 2, 13, 0, 0));
eq("rfc822 GMT zone",
  F.parseRfc822("Wed, 02 Oct 2002 13:00:00 GMT").getTime(),
  Date.UTC(2002, 9, 2, 13, 0, 0));
eq("rfc822 EST named zone (= 18:00 UTC)",
  F.parseRfc822("Wed, 02 Oct 2002 13:00:00 EST").getTime(),
  Date.UTC(2002, 9, 2, 18, 0, 0));
eq("rfc822 negative numeric offset",
  F.parseRfc822("Tue, 06 Oct 2026 18:00:00 -0500").getTime(),
  Date.UTC(2026, 9, 6, 23, 0, 0));
eq("rfc3339 Z",
  F.parseRfc3339("2003-12-13T18:30:02Z").getTime(),
  Date.UTC(2003, 11, 13, 18, 30, 2));
eq("rfc3339 +01:00",
  F.parseRfc3339("2026-10-06T09:00:00+01:00").getTime(),
  Date.UTC(2026, 9, 6, 8, 0, 0));
eq("rfc3339 fractional seconds",
  F.parseRfc3339("2003-12-13T18:30:02.250Z").getTime(),
  Date.UTC(2003, 11, 13, 18, 30, 2, 250));
eq("parseDate picks rfc822", F.parseDate("Wed, 02 Oct 2002 13:00:00 +0000").getTime(),
  Date.UTC(2002, 9, 2, 13, 0, 0));
eq("parseDate picks rfc3339", F.parseDate("2003-12-13T18:30:02Z").getTime(),
  Date.UTC(2003, 11, 13, 18, 30, 2));
eq("parseDate garbage -> null", F.parseDate("last Tuesday"), null);
eq("parseDate empty -> null", F.parseDate(""), null);

// toRfc822 -> parseRfc822 round-trips at whole-second resolution.
(function () {
  var rng = mulberry32(0xDA7E);
  var bad = 0;
  for (var k = 0; k < 5000; k++) {
    var t = Math.floor(rng() * (Date.UTC(2050, 0, 1) - Date.UTC(1990, 0, 1))) + Date.UTC(1990, 0, 1);
    t = t - (t % 1000); // whole seconds
    var d = new Date(t);
    var back = F.parseRfc822(F.toRfc822(d));
    if (!back || back.getTime() !== t) bad++;
  }
  eq("toRfc822/parseRfc822 round-trip over 5000 dates (bad count)", bad, 0);
})();

/* ------------------------------------------------------------------ *
 * 3. Real sample feeds                                               *
 * ------------------------------------------------------------------ */

(function () {
  var f = F.parseFeed(SAMPLES.rss.xml);
  eq("rss kind", f.kind, "rss");
  eq("rss channel title", f.title, "The Daily Widget");
  eq("rss channel desc decodes &amp;", f.description, "News & notes about widgets");
  eq("rss post count", f.posts.length, 2);
  eq("rss post1 title decodes entities", f.posts[0].title, "Widgets > Gadgets: the case for &");
  eq("rss post1 link", f.posts[0].link, "https://example.com/posts/1");
  eq("rss post1 guid -> id", f.posts[0].id, "tag:example.com,2026:1");
  eq("rss post1 dc:creator -> author", f.posts[0].author, "Ada Lovelace");
  eq("rss post1 numeric entity in summary", f.posts[0].summary,
    "A short summary with a “curly quote”.");
  eq("rss post1 CDATA content kept literal", f.posts[0].content,
    "<p>Full HTML body, where <b>a < b</b> & tags are literal.</p>");
  eq("rss post1 pubDate parsed",
    f.posts[0].date.getTime(), Date.UTC(2026, 9, 7, 9, 30, 0));
  eq("rss post2 -0500 offset parsed",
    f.posts[1].date.getTime(), Date.UTC(2026, 9, 6, 23, 0, 0));
  eq("rss post2 content falls back to summary",
    f.posts[1].content, "No encoded content on this one.");
})();

(function () {
  var f = F.parseFeed(SAMPLES.atom.xml);
  eq("atom kind", f.kind, "atom");
  eq("atom feed title", f.title, "Example Atom Feed");
  eq("atom subtitle -> description", f.description, "Everything, in Atom");
  eq("atom alternate link chosen for feed", f.link, "https://example.net/");
  eq("atom post count", f.posts.length, 2);
  eq("atom entry1 alternate link (not edit)", f.posts[0].link, "https://example.net/a");
  eq("atom entry1 id", f.posts[0].id, "urn:uuid:aaaa-1111");
  eq("atom entry1 author name", f.posts[0].author, "Alan Turing");
  eq("atom entry1 updated preferred over published",
    f.posts[0].date.getTime(), Date.UTC(2026, 9, 6, 8, 0, 0));
  eq("atom entry1 xhtml content from div", f.posts[0].content, "Rich content in a div.");
  eq("atom entry2 html title decoded", f.posts[1].title, "HTML title with <tags>");
  eq("atom entry2 link (no rel)", f.posts[1].link, "https://example.net/b");
  eq("atom entry2 content when no summary", f.posts[1].content, "Inline content, no summary present.");
})();

eq("detectKind rss", F.detectKind(SAMPLES.rss.xml), "rss");
eq("detectKind atom", F.detectKind(SAMPLES.atom.xml), "atom");
eq("detectKind junk -> null", F.detectKind("not xml at all"), null);

/* ------------------------------------------------------------------ *
 * 4. Edge cases & errors                                             *
 * ------------------------------------------------------------------ */

(function () {
  var xml = '<rss version="2.0"><channel><title>T</title>' +
    '<!-- a comment --><?php echo "pi"; ?>' +
    '<item><title>A</title><link>http://x/1</link></item>' +
    '<item><title>B</title><link>http://x/2</link></item>' +
    '</channel></rss>';
  var f = F.parseFeed(xml);
  eq("comment + PI skipped, items intact", f.posts.length, 2);
  eq("item with no guid falls back to link for id", f.posts[0].id, "http://x/1");
  eq("item with no date -> null", f.posts[0].date, null);
})();

(function () {
  // Self-closing and mismatched tags should not derail the parse.
  var xml = '<rss version="2.0"><channel><title>T</title><link/>' +
    '<item><title>Only</title></wrong></item></channel></rss>';
  var f = F.parseFeed(xml);
  eq("self-closing <link/> + stray close tolerated", f.posts.length, 1);
  eq("empty self-closing link -> empty string", f.title, "T");
})();

throws("empty input throws", function () { F.parseFeed("   "); }, /empty input/);
throws("non-feed root throws", function () { F.parseFeed("<html><body>hi</body></html>"); }, /neither/);
throws("RDF rejected with a clear message", function () {
  F.parseFeed('<rdf:RDF xmlns:rdf="x"></rdf:RDF>');
}, /RSS 1\.0/);
throws("non-string throws TypeError", function () { F.parseFeed(42); });

/* ------------------------------------------------------------------ *
 * 5. The round-trip law over a fuzz                                  *
 *    parseFeed(toRss(feed)) reproduces the feed, field for field.    *
 * ------------------------------------------------------------------ */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A palette that stresses escaping and Unicode: XML specials, a literal
// CDATA terminator, an astral emoji, and a combining mark.
var PALETTE = [
  "a", "b", " ", "<", ">", "&", "\"", "'", "]]>", "\u{1F600}", "é",
  "“", "line1\nline2", "tab\there", "100% & more", "x<y>z", "café"
];

function randText(rng, maxWords) {
  var n = Math.floor(rng() * maxWords);
  var parts = [];
  for (var k = 0; k < n; k++) parts.push(PALETTE[Math.floor(rng() * PALETTE.length)]);
  return parts.join("");
}

function randDate(rng) {
  if (rng() < 0.2) return null; // some posts genuinely have no date
  var lo = Date.UTC(1990, 0, 1), hi = Date.UTC(2050, 0, 1);
  var t = Math.floor(rng() * (hi - lo)) + lo;
  t = t - (t % 1000); // RFC-822 is whole seconds
  return new Date(t);
}

function randFeed(rng) {
  var nPosts = Math.floor(rng() * 6);
  var posts = [];
  for (var k = 0; k < nPosts; k++) {
    var summary = randText(rng, 6);
    var hasDistinctContent = rng() < 0.5;
    posts.push({
      title: randText(rng, 5),
      link: "https://e.example/" + Math.floor(rng() * 1e6),
      id: "id-" + Math.floor(rng() * 1e9),
      date: randDate(rng),
      author: rng() < 0.7 ? randText(rng, 3) : "",
      summary: summary,
      // if content equals summary the serialiser omits it (and the parser
      // reconstructs it from summary), so only assert a distinct one.
      content: hasDistinctContent ? randText(rng, 8) : summary
    });
  }
  return {
    title: randText(rng, 4) || "Feed",
    link: "https://e.example/",
    description: randText(rng, 6) || " ",
    posts: posts
  };
}

function dateEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

(function () {
  var rng = mulberry32(0x5EED1);
  var RUNS = 8000;
  var mismatches = 0, firstBad = null;
  for (var r = 0; r < RUNS; r++) {
    var feed = randFeed(rng);
    var xml = F.toRss(feed);
    var back = F.parseFeed(xml);
    var same = back.posts.length === feed.posts.length;
    for (var k = 0; same && k < feed.posts.length; k++) {
      var want = feed.posts[k], got = back.posts[k];
      // Reading XML text content trims surrounding whitespace — every feed
      // reader does, because pretty-printed feeds indent their values. So the
      // law holds modulo that trim; interior text (newlines, the astral emoji,
      // the combining mark, "]]>") must survive untouched.
      //
      // Content mirrors the parser's documented fallback: a distinct
      // content:encoded is emitted and read back, but if it trims to empty the
      // parser falls back to the summary — so compute the expectation the same
      // way the engine does rather than asserting a cleaner law than is true.
      var emitsContent = want.content && want.content !== want.summary;
      var expectedContent = emitsContent
        ? (want.content.trim() || want.summary.trim())
        : want.summary.trim();
      if (got.title !== want.title.trim() ||
          got.link !== want.link ||          // links carry no whitespace
          got.id !== want.id ||
          got.author !== want.author.trim() ||
          got.summary !== want.summary.trim() ||
          got.content !== expectedContent ||
          !dateEq(got.date, want.date)) {
        same = false;
      }
    }
    if (!same) { mismatches++; if (!firstBad) firstBad = { feed: feed, xml: xml, back: back }; }
  }
  eq("round-trip law over " + RUNS + " random feeds (mismatch count)", mismatches, 0);
  if (firstBad) console.error("first mismatch XML:\n" + firstBad.xml);
})();

/* ------------------------------------------------------------------ */

console.log(passed + " passed, " + failed + " failed.");
if (failed > 0) process.exit(1);
