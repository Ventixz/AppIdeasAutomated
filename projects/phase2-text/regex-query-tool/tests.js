/*
 * tests.js — dependency-free test suite for the Regex Query Tool engine.
 *
 * Run it:  node projects/phase2-text/regex-query-tool/tests.js
 *
 * Six kinds of check, matching the house pattern:
 *   1. a curated corpus — known patterns against known strings, exact matches;
 *   2. group positions — the [start,end) of every capture group is correct,
 *      including named groups and groups that didn't participate;
 *   3. the zero-width cases — ^/gm, \b, lookahead: the scan terminates and the
 *      segmenter keeps every character;
 *   4. the ReDoS analyzer — it flags (a+)+ and friends and clears safe ones;
 *   5. the explainer — it names the pieces of a pattern;
 *   6. the guardrails — bad flags and bad patterns return errors, not throws.
 */
"use strict";
var R = require("./regex-core.js");

var passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name + (extra ? "  — " + extra : "")); }
}
function eq(name, got, want) {
  ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}
function deq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

/* ------------------------------------------------------------------ *
 * 1. Curated corpus — patterns against strings, the matched text.
 * ------------------------------------------------------------------ */
function matchedTexts(pattern, flags, input) {
  var r = R.findMatches(pattern, flags, input);
  if (!r.ok) throw new Error(r.error);
  return r.matches.map(function (m) { return m.match; });
}

deq("digits, global", matchedTexts("\\d+", "g", "a12 b3 c456"), ["12", "3", "456"]);
deq("first match only, no g", matchedTexts("\\d+", "", "a12 b3"), ["12"]);
deq("case-insensitive", matchedTexts("cat", "gi", "Cat cat CAT dog"), ["Cat", "cat", "CAT"]);
deq("word boundary", matchedTexts("\\bcat\\b", "gi", "cat category cat"), ["cat", "cat"]);
deq("alternation", matchedTexts("cat|dog", "g", "cat dog bird cat"), ["cat", "dog", "cat"]);
deq("anchored no match", matchedTexts("^\\d+$", "", "12a"), []);
deq("email-ish", matchedTexts("[\\w.+-]+@[\\w-]+\\.[\\w.-]+", "g", "a@b.com x y@z.io"),
    ["a@b.com", "y@z.io"]);
deq("dot matches all with s", matchedTexts("a.b", "s", "a\nb"), ["a\nb"]);
eq("no match returns empty, ok:true", R.findMatches("z", "g", "abc").matches.length, 0);

/* ------------------------------------------------------------------ *
 * 2. Group positions — the [start,end) of every group, named & unnamed.
 * ------------------------------------------------------------------ */
(function () {
  var r = R.findMatches("(\\w+)\\s+(\\w+)", "g", "John Smith");
  var m = r.matches[0];
  eq("match whole", m.match, "John Smith");
  eq("match start", m.index, 0);
  eq("match end", m.end, 10);
  eq("group count", m.groups.length, 2);
  eq("group1 value", m.groups[0].value, "John");
  eq("group1 start", m.groups[0].start, 0);
  eq("group1 end", m.groups[0].end, 4);
  eq("group2 value", m.groups[1].value, "Smith");
  eq("group2 start", m.groups[1].start, 5);
  eq("group2 end", m.groups[1].end, 10);
})();

(function () {
  var r = R.findMatches("(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})", "", "2026-10-16");
  var m = r.matches[0];
  eq("named y value", m.namedGroups.y, "2026");
  eq("named m value", m.namedGroups.m, "10");
  eq("named d value", m.namedGroups.d, "16");
  // The named map should also be reflected onto the numbered group's name.
  var names = m.groups.map(function (g) { return g.name; });
  deq("names attached to numbered groups", names, ["y", "m", "d"]);
  eq("named d start", m.groups[2].start, 8);
  eq("named d end", m.groups[2].end, 10);
})();

(function () {
  // A group that does not participate reports value:null, start:null.
  var r = R.findMatches("(a)|(b)", "", "b");
  var m = r.matches[0];
  eq("participating group value", m.groups[1].value, "b");
  eq("non-participating group value is null", m.groups[0].value, null);
  eq("non-participating group start is null", m.groups[0].start, null);
})();

/* ------------------------------------------------------------------ *
 * 3. Zero-width matches — the loop terminates, the segmenter is lossless.
 * ------------------------------------------------------------------ */
(function () {
  // /^/gm matches at the start of every line: zero-width, one per line.
  var input = "a\nb\nc";
  var r = R.findMatches("^", "gm", input);
  eq("three line-starts", r.matches.length, 3);
  eq("all zero-width", r.matches.every(function (m) { return m.end === m.index; }), true);

  // The segmenter must cover the whole string with no characters lost.
  var segs = R.segment(input, r.matches);
  var rebuilt = segs.map(function (s) { return s.text; }).join("");
  eq("segments rebuild the input exactly", rebuilt, input);
  ok("zero-width markers present", segs.some(function (s) { return s.zeroWidth; }));
})();

(function () {
  // \b alone: a stream of zero-width boundaries; must not loop forever.
  var r = R.findMatches("\\b", "g", "hi there");
  ok("word boundaries found and loop terminated", r.matches.length >= 2);
  ok("all boundaries zero-width", r.matches.every(function (m) { return m.end === m.index; }));
})();

(function () {
  // A normal (non-zero-width) global match segments correctly, matches
  // highlighted and gaps preserved.
  var input = "a12 b3";
  var r = R.findMatches("\\d+", "g", input);
  var segs = R.segment(input, r.matches);
  eq("rebuild non-zero-width", segs.map(function (s) { return s.text; }).join(""), input);
  deq("match flags in order",
      segs.map(function (s) { return s.isMatch; }),
      [false, true, false, true]);
  deq("matched segment texts", segs.filter(function (s) { return s.isMatch; }).map(function (s) { return s.text; }), ["12", "3"]);
})();

/* ------------------------------------------------------------------ *
 * 4. ReDoS analyzer — flag the killers, clear the safe ones.
 * ------------------------------------------------------------------ */
ok("(a+)+$ is flagged", !R.analyze("(a+)+$").safe);
ok("(a*)* is flagged", !R.analyze("(a*)*").safe);
ok("(\\d+)* is flagged", !R.analyze("(\\d+)*").safe);
ok("(a+){2,} is flagged (unbounded brace)", !R.analyze("(a+){2,}").safe);
ok("quantified alternation (a|a)* is flagged", !R.analyze("(a|a)*").safe);
ok("nested deeper ((a+)+)+ is flagged", !R.analyze("((a+)+)+").safe);

ok("plain \\d+ is clean", R.analyze("\\d+").safe);
ok("email pattern is clean", R.analyze("[\\w.+-]+@[\\w-]+\\.[\\w.-]+").safe);
ok("(a+) without outer quantifier is clean", R.analyze("(a+)").safe);
ok("bounded (a+){2,5} is clean", R.analyze("(a+){2,5}").safe);
ok("(a+)? is clean — ? is bounded", R.analyze("(a+)?").safe);
ok("char class [+*] does not trip the scanner", R.analyze("[+*]+").safe);
ok("escaped \\( \\) do not open a group", R.analyze("\\(a+\\)+").safe);
(function () {
  var a = R.analyze("(a+)+$");
  eq("warning kind", a.warnings[0].kind, "nested-quantifier");
  ok("warning explains itself", /catastrophic/i.test(a.warnings[0].detail));
})();

/* ------------------------------------------------------------------ *
 * 5. explain — the pattern reads back in English.
 * ------------------------------------------------------------------ */
(function () {
  var t = R.explain("^\\d{2,4}-[a-z]+$");
  var texts = t.map(function (x) { return x.text; });
  ok("explain keeps ^ ", texts.indexOf("^") !== -1);
  ok("explain keeps $ ", texts.indexOf("$") !== -1);
  ok("explain recognises \\d", t.some(function (x) { return x.text === "\\d" && /digit/.test(x.desc); }));
  ok("explain describes {2,4} as a range", t.some(function (x) { return /between 2 and 4/.test(x.desc); }));
  ok("explain describes a char class", t.some(function (x) { return x.text === "[a-z]" && /set/.test(x.desc); }));
  // The token texts, concatenated, reconstruct the original pattern.
  eq("explain tokens rebuild the pattern", texts.join(""), "^\\d{2,4}-[a-z]+$");
})();
(function () {
  var t = R.explain("(?<year>\\d+)");
  ok("explain names a named group", t.some(function (x) { return /named capture group 'year'/.test(x.desc); }));
})();
(function () {
  var t = R.explain("a+?");
  ok("explain spots lazy quantifier", t.some(function (x) { return /lazily/.test(x.desc); }));
})();

/* ------------------------------------------------------------------ *
 * 6. Guardrails — bad input returns errors, never throws.
 * ------------------------------------------------------------------ */
(function () {
  var r = R.compile("(unclosed", "");
  ok("unclosed group → ok:false", r.ok === false);
  ok("unclosed group → has error string", typeof r.error === "string" && r.error.length > 0);
})();
(function () {
  var r = R.compile("abc", "gq");
  ok("bad flag → ok:false", r.ok === false);
  ok("bad flag names the offender", /q/.test(r.error));
})();
(function () {
  var r = R.compile("abc", "gg");
  ok("duplicate flag → ok:false", r.ok === false);
})();
(function () {
  var r = R.findMatches("(unclosed", "g", "x");
  ok("findMatches surfaces compile error", r.ok === false);
})();
(function () {
  var r = R.compile("\\d+", "gimsuy");
  ok("all valid flags accepted", r.ok === true);
})();
eq("library has entries", R.LIBRARY.length > 0, true);
ok("every library entry compiles", R.LIBRARY.every(function (e) { return R.compile(e.pattern, e.flags).ok; }));

/* ------------------------------------------------------------------ *
 * Tally.
 * ------------------------------------------------------------------ */
console.log("\n" + passed + " passed, " + failed + " failed.");
if (failed) process.exit(1);
