/*
 * tests.js — dependency-free test suite for the Guestbook / Journal engine.
 *
 * Run it:  node projects/phase2-text/guestbook-journal/tests.js
 *
 * The engine is checked the house way — curated cases that pin exact answers,
 * then the hard guarantees as PROPERTIES over a large random fuzz:
 *
 *   1. safe rendering — escapeHtml never leaves a live metacharacter; linkify
 *      is lossless (strip the <a> wrappers, decode the entities, and you get
 *      the original text back) and injection-proof (the only "<" it ever emits
 *      opens an <a> tag it wrote itself), over a fuzz whose palette is full of
 *      <, >, &, quotes and URLs;
 *   2. relativeTime — curated boundary strings, future clamps to "just now",
 *      and the monotonicity law: for a fixed now, a more recent entry never
 *      reads as older than a less recent one, over a fuzz of 20,000 pairs;
 *   3. the store — mode gating (open/moderated/closed), the duplicate flood
 *      guard, stable (time, id) ordering for same-millisecond posts,
 *      approve/remove/edit, and tokenised AND search;
 *   4. groupByDay — a PARTITION law: every entry lands in exactly one group,
 *      the groups are newest-first, and concatenating them reproduces the input
 *      order, over a fuzz of random day-spreads;
 *   5. serialisation — fromObject(gb.toObject()) reproduces the store
 *      field-for-field over a fuzz, and the JSON-string path agrees.
 */
"use strict";
var C = require("./guestbook-core.js");

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

/* A tiny seeded RNG so the fuzz is deterministic run to run. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * 1. Safe rendering
 * ------------------------------------------------------------------ */

eq("escape/angle brackets", C.escapeHtml("<script>alert(1)</script>"),
  "&lt;script&gt;alert(1)&lt;/script&gt;");
eq("escape/ampersand + quotes", C.escapeHtml(`a & "b" 'c'`),
  "a &amp; &quot;b&quot; &#39;c&#39;");
eq("escape/nullish", C.escapeHtml(null) + C.escapeHtml(undefined), "");

eq("linkify/plain text is just escaped", C.linkify("hi <there> & you"),
  "hi &lt;there&gt; &amp; you");
eq("linkify/bare url becomes a link",
  C.linkify("see https://example.com/x?a=1&b=2 now"),
  'see <a href="https://example.com/x?a=1&amp;b=2" rel="nofollow noopener noreferrer" target="_blank">https://example.com/x?a=1&amp;b=2</a> now');
eq("linkify/trailing punctuation stays out of the link",
  C.linkify("(see https://example.com)."),
  '(see <a href="https://example.com" rel="nofollow noopener noreferrer" target="_blank">https://example.com</a>).');
eq("linkify/non-http scheme is NOT linked",
  C.linkify("javascript:alert(1) and data:text/html,x"),
  "javascript:alert(1) and data:text/html,x");
eq("linkify/url cannot break out with a tag",
  C.linkify('http://x.com/"><script>'),
  '<a href="http://x.com/" rel="nofollow noopener noreferrer" target="_blank">http://x.com/</a>&quot;&gt;&lt;script&gt;');

// Property fuzz: linkify is lossless and injection-proof.
// "Lossless": removing the <a …> and </a> wrappers and decoding the five
// entities must return the original text exactly. "Injection-proof": every "<"
// in the output opens either "<a " or "</a>".
function stripAnchors(html) {
  return html.replace(/<a href="[^"]*" rel="nofollow noopener noreferrer" target="_blank">/g, "")
             .replace(/<\/a>/g, "");
}
function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&amp;/g, "&"); // &amp; last, so &amp;lt; decodes to &lt; not <
}
function injectionSafe(html) {
  // Every "<" must be the start of "<a " or "</a>".
  for (var i = 0; i < html.length; i++) {
    if (html.charAt(i) === "<") {
      var rest = html.slice(i);
      if (rest.indexOf("<a ") !== 0 && rest.indexOf("</a>") !== 0) return false;
    }
  }
  return true;
}
(function () {
  var rnd = mulberry32(1);
  var palette = ["<", ">", "&", '"', "'", " ", "a", "b", "\n", "/",
                 "http://x.io/p", "https://y.co/q?z=1&w=2", ".", ")", "script", "=", "日"];
  var lossless = 0, safe = 0, trials = 20000;
  for (var t = 0; t < trials; t++) {
    var len = Math.floor(rnd() * 14);
    var raw = "";
    for (var i = 0; i < len; i++) raw += palette[Math.floor(rnd() * palette.length)];
    var html = C.linkify(raw);
    if (decodeEntities(stripAnchors(html)) === raw) lossless++;
    if (injectionSafe(html)) safe++;
  }
  eq("linkify/lossless over " + trials + " random strings", lossless, trials);
  eq("linkify/injection-proof over " + trials + " random strings", safe, trials);
})();

/* ------------------------------------------------------------------ *
 * 2. relativeTime
 * ------------------------------------------------------------------ */

// Build times from LOCAL calendar components so the curated cases are
// timezone-independent (startOfLocalDay uses local components too).
function at(y, mo, d, h, mi) { return new Date(y, mo, d, h || 0, mi || 0, 0, 0).getTime(); }

(function () {
  var now = at(2024, 0, 15, 12, 0); // Jan 15 2024, 12:00 local
  eq("rel/just now", C.relativeTime(now - 10 * 1000, now), "just now");
  eq("rel/under a minute", C.relativeTime(now - 44 * 1000, now), "just now");
  eq("rel/one minute", C.relativeTime(now - 60 * 1000, now), "1 minute ago");
  eq("rel/minutes", C.relativeTime(now - 5 * 60 * 1000, now), "5 minutes ago");
  eq("rel/one hour", C.relativeTime(now - 60 * 60 * 1000, now), "1 hour ago");
  eq("rel/hours", C.relativeTime(now - 3 * 60 * 60 * 1000, now), "3 hours ago");
  eq("rel/yesterday", C.relativeTime(at(2024, 0, 14, 12, 0), now), "yesterday");
  // Crossing midnight counts as yesterday even if only a few hours elapsed.
  eq("rel/yesterday across midnight",
    C.relativeTime(at(2024, 0, 14, 23, 0), at(2024, 0, 15, 1, 0)), "yesterday");
  eq("rel/days", C.relativeTime(at(2024, 0, 12, 12, 0), now), "3 days ago");
  eq("rel/last week", C.relativeTime(at(2024, 0, 6, 12, 0), now), "last week");
  eq("rel/weeks", C.relativeTime(at(2024, 0, 1, 12, 0), now), "2 weeks ago");
  eq("rel/future clamps to just now", C.relativeTime(now + 10 * 60 * 1000, now), "just now");

  // Date fallback needs a `now` late enough in the year that a same-year date
  // can still be more than four weeks in the past.
  var mid = at(2024, 5, 15, 12, 0); // Jun 15 2024
  eq("rel/date same year", C.relativeTime(at(2024, 0, 20, 12, 0), mid), "on Jan 20");
  eq("rel/date other year", C.relativeTime(at(2022, 5, 3, 12, 0), mid), "on Jun 3, 2022");
})();

// Monotonicity law. Rank each label on a single increasing scale derived from
// the SAME boundaries the engine uses; for the absolute-date bucket, rank by the
// actual timestamp (older -> larger). Then for a fixed `now`, a more recent
// `then` must never rank as older.
function labelRank(label, then, now) {
  if (label === "just now") return 0;
  var m;
  if (label === "1 minute ago") return 100 + 1;
  if ((m = /^(\d+) minutes ago$/.exec(label))) return 100 + (+m[1]);     // 101..159
  if (label === "1 hour ago") return 200 + 1;
  if ((m = /^(\d+) hours ago$/.exec(label))) return 200 + (+m[1]);       // 201..223
  if (label === "yesterday") return 300 + 1;                            // 301
  if ((m = /^(\d+) days ago$/.exec(label))) return 300 + (+m[1]);       // 302..306
  if (label === "last week") return 400;                                // days 7..13
  if ((m = /^(\d+) weeks ago$/.exec(label))) return 400 + (+m[1]);       // 402..403
  // Absolute date: rank strictly by elapsed time so it stays monotonic and
  // always sits above the relative buckets.
  return 100000 + Math.floor((now - then) / 1000);
}
(function () {
  var rnd = mulberry32(7);
  var now = at(2024, 5, 15, 9, 30);
  var span = 1000 * 60 * 60 * 24 * 800; // up to ~2.2 years back
  var bad = 0, trials = 20000;
  for (var t = 0; t < trials; t++) {
    var a = now - Math.floor(rnd() * span);
    var b = now - Math.floor(rnd() * span);
    if (a < b) { var tmp = a; a = b; b = tmp; } // a is the more recent (larger) ts
    var ra = labelRank(C.relativeTime(a, now), a, now);
    var rb = labelRank(C.relativeTime(b, now), b, now);
    if (ra > rb) bad++; // more-recent read as older -> violation
  }
  eq("rel/monotonic over " + trials + " pairs", bad, 0);
})();

/* ------------------------------------------------------------------ *
 * 3. The store — moderation, ordering, flood guard, search
 * ------------------------------------------------------------------ */

(function () {
  var gb = new C.Guestbook();
  eq("store/default mode is open", gb.mode, "open");

  var r1 = gb.post({ name: "Ada", body: "First!", at: 1000 });
  ok("store/open post is accepted + visible", r1.ok && r1.entry.status === "visible");
  eq("store/empty body refused", gb.post({ body: "   \n  " }).reason, "empty");
  eq("store/consecutive duplicate refused",
    gb.post({ name: "Ada", body: "First!", at: 1001 }).reason, "duplicate");
  // A different author saying the same thing is NOT a duplicate.
  ok("store/same words different author allowed",
    gb.post({ name: "Bo", body: "First!", at: 1002 }).ok);
  // The same author again after someone else is fine (not consecutive).
  ok("store/same author non-consecutive allowed",
    gb.post({ name: "Ada", body: "First!", at: 1003 }).ok);

  // Name defaults to "" (the UI renders that as Anonymous); long name clipped.
  var rA = gb.post({ body: "anon post", at: 1004 });
  eq("store/anon name is empty string", rA.entry.name, "");

  gb.setMode("moderated");
  var rp = gb.post({ name: "Cy", body: "awaiting review", at: 2000 });
  eq("store/moderated post is pending", rp.entry.status, "pending");
  eq("store/pending not in visible", gb.visible().filter(function (e) { return e.id === rp.entry.id; }).length, 0);
  eq("store/pending listed in pending", gb.pending().filter(function (e) { return e.id === rp.entry.id; }).length, 1);
  ok("store/approve makes it visible", gb.approve(rp.entry.id) && gb.visible().filter(function (e) { return e.id === rp.entry.id; }).length === 1);

  gb.setMode("closed");
  eq("store/closed refuses posts", gb.post({ name: "Dot", body: "hello?" }).reason, "closed");

  // Stable ordering: three posts in the SAME millisecond keep insertion order,
  // newest (highest id) first.
  var gb2 = new C.Guestbook();
  var e1 = gb2.post({ body: "one", at: 5000 }).entry;
  var e2 = gb2.post({ body: "two", at: 5000 }).entry;
  var e3 = gb2.post({ body: "three", at: 5000 }).entry;
  deepEq("store/same-ms order is stable (newest id first)",
    gb2.all().map(function (e) { return e.body; }), ["three", "two", "one"]);
  ok("store/ids strictly increase", e1.id < e2.id && e2.id < e3.id);

  // Mixed timestamps sort by time, then id.
  var gb3 = new C.Guestbook();
  gb3.post({ body: "older", at: 100 });
  gb3.post({ body: "newer", at: 900 });
  gb3.post({ body: "middle", at: 500 });
  deepEq("store/sorts by time newest-first",
    gb3.all().map(function (e) { return e.body; }), ["newer", "middle", "older"]);

  // Edit / remove.
  ok("store/edit body", gb3.edit(gb3.all()[0].id, { body: "newest!" }) &&
    gb3.all()[0].body === "newest!");
  ok("store/edit to empty refused", !gb3.edit(gb3.all()[0].id, { body: "  " }));
  var before = gb3.count();
  ok("store/remove", gb3.remove(gb3.all()[2].id) && gb3.count() === before - 1);
  ok("store/remove unknown id is false", !gb3.remove(999999));

  // Search: tokenised AND over name + body, visible only, case-insensitive.
  var gs = new C.Guestbook();
  gs.post({ name: "Grace Hopper", body: "found a real bug", at: 1 });
  gs.post({ name: "Alan", body: "the bug is elsewhere", at: 2 });
  gs.post({ name: "Grace Hopper", body: "nanoseconds matter", at: 3 });
  eq("search/single token", gs.search("bug").length, 2);
  eq("search/AND tokens", gs.search("grace bug").length, 1);
  eq("search/case-insensitive", gs.search("GRACE").length, 2);
  eq("search/empty query = all visible", gs.search("").length, 3);
  gs.setMode("moderated");
  gs.post({ name: "Spam", body: "bug bug bug", at: 4 });
  eq("search/pending excluded from search", gs.search("spam").length, 0);
})();

/* ------------------------------------------------------------------ *
 * 4. groupByDay — partition law
 * ------------------------------------------------------------------ */

(function () {
  var now = at(2024, 2, 20, 15, 0);
  var entries = [
    { id: 5, at: at(2024, 2, 20, 14, 0), body: "a" }, // today
    { id: 4, at: at(2024, 2, 20, 9, 0), body: "b" },  // today
    { id: 3, at: at(2024, 2, 19, 22, 0), body: "c" }, // yesterday
    { id: 2, at: at(2024, 2, 10, 8, 0), body: "d" },  // Mar 10
    { id: 1, at: at(2024, 2, 10, 7, 0), body: "e" }   // Mar 10
  ];
  var groups = C.groupByDay(entries, now);
  deepEq("group/labels", groups.map(function (g) { return g.label; }),
    ["Today", "Yesterday", "Mar 10"]);
  deepEq("group/sizes", groups.map(function (g) { return g.items.length; }), [2, 1, 2]);

  // Partition law over a fuzz: every entry appears once, order is preserved by
  // concatenation, and every item in a group shares that group's local day.
  var rnd = mulberry32(3);
  var bad = 0, trials = 2000;
  for (var t = 0; t < trials; t++) {
    var n = Math.floor(rnd() * 25);
    var list = [];
    for (var i = 0; i < n; i++) {
      var daysBack = Math.floor(rnd() * 40);
      var ms = now - daysBack * 86400000 - Math.floor(rnd() * 86400000);
      list.push({ id: i, at: ms, body: "x" + i });
    }
    list.sort(function (a, b) { return b.at - a.at || b.id - a.id; }); // newest-first input
    var gr = C.groupByDay(list, now);
    var flat = [];
    gr.forEach(function (g) {
      g.items.forEach(function (e) {
        flat.push(e);
        if (C.startOfLocalDay(e.at) !== g.key) bad++; // item in wrong day group
      });
    });
    if (flat.length !== list.length) bad++;
    for (var j = 0; j < list.length; j++) if (flat[j] !== list[j]) bad++; // order preserved
    // Group keys strictly decreasing (newest day first).
    for (var k = 1; k < gr.length; k++) if (gr[k].key >= gr[k - 1].key) bad++;
  }
  eq("group/partition law over " + trials + " random spreads", bad, 0);
})();

/* ------------------------------------------------------------------ *
 * 5. Serialisation round-trip
 * ------------------------------------------------------------------ */

(function () {
  var rnd = mulberry32(99);
  function word() {
    var w = "", len = 1 + Math.floor(rnd() * 6);
    for (var i = 0; i < len; i++) w += "abcde <>&\"'日"[Math.floor(rnd() * 11)];
    return w;
  }
  function phrase(n) { var a = []; for (var i = 0; i < n; i++) a.push(word()); return a.join(" "); }

  var bad = 0, trials = 400;
  for (var t = 0; t < trials; t++) {
    var gb = new C.Guestbook({ mode: C.MODES[Math.floor(rnd() * 3)] });
    var open = gb.mode !== "closed";
    var m = 1 + Math.floor(rnd() * 15);
    for (var i = 0; i < m; i++) {
      if (gb.mode === "closed") gb.setMode("open");
      gb.post({ name: phrase(1 + Math.floor(rnd() * 2)), body: phrase(2 + Math.floor(rnd() * 4)),
                at: 1000 + Math.floor(rnd() * 1e9) });
    }
    // Flip some to pending via moderation on later posts already done; also set a final mode.
    gb.setMode(C.MODES[Math.floor(rnd() * 3)]);

    var round = C.fromObject(gb.toObject());
    if (JSON.stringify(round.toObject()) !== JSON.stringify(gb.toObject())) bad++;
    var round2 = C.fromObject(gb.toJSON());
    if (JSON.stringify(round2.toObject()) !== JSON.stringify(gb.toObject())) bad++;
    void open;
  }
  eq("serialise/round-trip over " + trials + " stores (object + JSON paths)", bad, 0);

  // Bare-array shape is accepted; export shape is stable.
  var s2 = C.fromObject([{ id: 1, name: "Me", body: "Hi", at: 42, status: "visible" }]);
  eq("serialise/accepts bare array", s2.count(), 1);
  deepEq("serialise/export shape",
    s2.toObject(),
    { version: 1, mode: "open", seq: 1, entries: [{ id: 1, name: "Me", body: "Hi", at: 42, status: "visible" }] });
  // seq is kept ahead of the highest id so new posts never collide.
  var s3 = C.fromObject({ entries: [{ id: 50, body: "x", at: 1 }] });
  ok("serialise/seq advances past imported ids", s3.post({ body: "y", at: 2 }).entry.id === 51);
})();

/* ------------------------------------------------------------------ */
console.log("\n" + passed + " passed, " + failed + " failed.");
process.exit(failed === 0 ? 0 : 1);
