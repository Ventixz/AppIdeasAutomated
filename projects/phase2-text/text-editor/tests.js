/*
 * tests.js — dependency-free test suite for the Text Editor engine.
 *
 * Run it:  node projects/phase2-text/text-editor/tests.js
 *
 * The suite checks the two things that actually make an editor an editor — the
 * minimal-edit diff and the coalescing undo/redo — the house way:
 *
 *   1. a curated corpus of diffs pinned to exact {from,to,insert,removed};
 *   2. the round-trip laws, as PROPERTIES over a large random fuzz:
 *        - applyEdit(old, diffEdit(old,new)).doc === new                (diff is faithful)
 *        - applyEdit(new, inverse).doc === old                          (inverse inverts)
 *        - undo-all returns to the initial document, redo-all to final  (history is exact)
 *        - any interleaving of undo/redo leaves `current` consistent    (no drift)
 *      run over code-point fuzz that includes emoji and combining marks, so the
 *      "never split an astral character" claim is tested, not asserted;
 *   3. the coalescing rules, each isolated: a typed run is one step, a newline
 *      breaks it, a time gap breaks it, switching type<->delete breaks it, a
 *      caret jump breaks it, and undo clears the redo tail;
 *   4. the gap, demonstrated — typing "hello" is 1 coalesced undo step but 5
 *      naive ones, the exact complaint the coalescing is there to fix;
 *   5. the statistics, pinned on text where the right answer is countable by eye.
 */
"use strict";
var E = require("./editor-core.js");

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
 * 1. Curated diffs — exact minimal edits.
 * ------------------------------------------------------------------ */
var diffCases = [
  // [old, new, {from,to,insert,removed}, note]
  ["", "", { from: 0, to: 0, insert: "", removed: "" }, "empty to empty is a no-op"],
  ["", "hi", { from: 0, to: 0, insert: "hi", removed: "" }, "insert into empty"],
  ["hi", "", { from: 0, to: 2, insert: "", removed: "hi" }, "delete everything"],
  ["abc", "abXc", { from: 2, to: 2, insert: "X", removed: "" }, "single insert in the middle"],
  ["abXc", "abc", { from: 2, to: 3, insert: "", removed: "X" }, "single delete in the middle"],
  ["the cat", "the dog", { from: 4, to: 7, insert: "dog", removed: "cat" }, "replace a word"],
  ["aaa", "aaaa", { from: 3, to: 3, insert: "a", removed: "" }, "append to a repeated run (suffix-safe)"],
  ["aaaa", "aaa", { from: 3, to: 4, insert: "", removed: "a" }, "remove from a repeated run"],
  ["hello", "hello", { from: 5, to: 5, insert: "", removed: "" }, "no change"],
];
diffCases.forEach(function (c) {
  deepEq("diff: " + JSON.stringify(c[0]) + " -> " + JSON.stringify(c[1]) + " (" + c[3] + ")",
    E.diffEdit(c[0], c[1]), c[2]);
});

// diff is code-point minimal: replacing one emoji with another touches exactly
// one code point, never a surrogate half.
(function () {
  var d = E.diffEdit("a😀b", "a😁b");
  deepEq("diff: emoji swap is one code point", d, { from: 1, to: 2, insert: "😁", removed: "😀" });
  eq("diff: emoji swap applies cleanly", E.applyEdit("a😀b", d).doc, "a😁b");
})();

/* ------------------------------------------------------------------ *
 * 2. Round-trip laws over a code-point fuzz (emoji + combining marks).
 * ------------------------------------------------------------------ */
// A tiny seeded PRNG so a failure reproduces exactly.
function rng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// Palette mixes ASCII, an astral emoji, and a combining mark (e + U+0301), the
// three things a naive UTF-16 editor splits and corrupts.
var PALETTE = ["a", "b", "c", " ", "\n", "😀", "😁", "é", "€", "你"];
function randString(rnd, maxLen) {
  var n = Math.floor(rnd() * (maxLen + 1));
  var out = "";
  for (var i = 0; i < n; i++) out += PALETTE[Math.floor(rnd() * PALETTE.length)];
  return out;
}
// Mutate a string by a single plausible edit (insert / delete / replace a
// contiguous code-point range) — the shape a real keystroke or paste makes.
function mutate(rnd, str) {
  var arr = E.cp(str);
  var len = arr.length;
  var from = Math.floor(rnd() * (len + 1));
  var to = from + Math.floor(rnd() * (len - from + 1));
  var insert = randString(rnd, 4);
  return arr.slice(0, from).join("") + insert + arr.slice(to).join("");
}

var rnd = rng(0x5eed);
var FUZZ = 20000;
var lawFails = { faithful: 0, inverse: 0 };
for (var k = 0; k < FUZZ; k++) {
  var oldStr = randString(rnd, 12);
  var newStr = mutate(rnd, oldStr);
  var d = E.diffEdit(oldStr, newStr);
  var ap = E.applyEdit(oldStr, d);
  if (ap.doc !== newStr) lawFails.faithful++;
  var back = E.applyEdit(ap.doc, ap.inverse);
  if (back.doc !== oldStr) lawFails.inverse++;
}
eq("law/diff is faithful over " + FUZZ + " fuzz: applyEdit(old, diff)===new", lawFails.faithful, 0);
eq("law/inverse inverts over " + FUZZ + " fuzz: applyEdit(new, inverse)===old", lawFails.inverse, 0);

// History exactness: replay a random session, then undo everything and redo
// everything, and walk a random interleaving — `current` must always equal the
// document reached by applying the first `index` steps from the initial state.
var histFails = { undoAll: 0, redoAll: 0, interleave: 0 };
for (var s = 0; s < 1200; s++) {
  // Build a sequence of document states (a "session").
  var seq = [randString(rnd, 8)];
  var changes = 1 + Math.floor(rnd() * 10);
  for (var c = 0; c < changes; c++) {
    var nx = mutate(rnd, seq[seq.length - 1]);
    if (nx !== seq[seq.length - 1]) seq.push(nx);
  }
  var h = E.replay(seq);
  var initial = seq[0], finalDoc = seq[seq.length - 1];
  eqSilent(h.current, finalDoc) || histFails.redoAll++; // tip is the final state
  // Undo all the way down.
  while (h.canUndo()) h.undo();
  if (h.current !== initial) histFails.undoAll++;
  // Redo all the way back up.
  while (h.canRedo()) h.redo();
  if (h.current !== finalDoc) histFails.redoAll++;
  // Random interleaving, checked against an independent reconstruction.
  var steps = 2 + Math.floor(rnd() * 12);
  for (var w = 0; w < steps; w++) {
    if (rnd() < 0.5) h.undo(); else h.redo();
    if (h.current !== reconstruct(h, initial)) { histFails.interleave++; break; }
  }
}
function eqSilent(a, b) { return a === b; }
// Independent oracle: apply steps[0..index) forward from the initial document,
// using applyEdit only — no shared code with History's own current tracking.
function reconstruct(h, initial) {
  var doc = initial;
  for (var i = 0; i < h.index; i++) {
    var st = h.steps[i];
    doc = E.applyEdit(doc, {
      from: st.from, to: st.from + E.cpLen(st.oldText), insert: st.newText
    }).doc;
  }
  return doc;
}
eq("law/undo-all returns to the initial document", histFails.undoAll, 0);
eq("law/redo-all returns to the final document", histFails.redoAll, 0);
eq("law/any undo-redo interleaving stays consistent", histFails.interleave, 0);

/* ------------------------------------------------------------------ *
 * 3. Coalescing rules, isolated.
 * ------------------------------------------------------------------ */
// Typing a contiguous run within the time window is ONE undo step.
(function () {
  var h = new E.History("");
  var doc = "";
  "hello".split("").forEach(function (ch, i) {
    doc += ch;
    h.commit(doc, i + 1, { kind: "insert", time: i * 50, caretBefore: i });
  });
  eq("coalesce/typed run 'hello' is one step", h.size(), 1);
  h.undo();
  eq("coalesce/one Ctrl+Z clears the whole word", h.current, "");
})();

// A newline seals the group: two lines are at least two steps.
(function () {
  var h = new E.History("");
  var doc = "", t = 0, i = 0;
  "ab\ncd".split("").forEach(function (ch) {
    doc += ch;
    h.commit(doc, ++i, { kind: "insert", time: (t += 10), caretBefore: i - 1 });
  });
  eq("coalesce/newline breaks the group into two steps", h.size(), 2);
  h.undo();
  eq("coalesce/undo removes only the second line's text", h.current, "ab\n");
})();

// A pause longer than coalesceMs breaks the run.
(function () {
  var h = new E.History(""); h.coalesceMs = 700;
  h.commit("a", 1, { kind: "insert", time: 0, caretBefore: 0 });
  h.commit("ab", 2, { kind: "insert", time: 100, caretBefore: 1 });   // within window
  h.commit("abc", 3, { kind: "insert", time: 2000, caretBefore: 2 }); // long pause -> new step
  eq("coalesce/a long pause starts a new step", h.size(), 2);
})();

// Switching from typing to deleting breaks the run.
(function () {
  var h = new E.History("");
  h.commit("ab", 2, { kind: "insert", time: 0, caretBefore: 0 });
  h.commit("abc", 3, { kind: "insert", time: 10, caretBefore: 2 });
  h.commit("ab", 2, { kind: "delete", time: 20, caretBefore: 3 });  // kind flip
  eq("coalesce/type-then-delete is two steps", h.size(), 2);
})();

// A run of backspacing coalesces into one delete step.
(function () {
  var h = new E.History("hello");
  h.commit("hell", 4, { kind: "delete", time: 0, caretBefore: 5 });
  h.commit("hel", 3, { kind: "delete", time: 20, caretBefore: 4 });
  h.commit("he", 2, { kind: "delete", time: 40, caretBefore: 3 });
  eq("coalesce/backspace run is one step", h.size(), 1);
  h.undo();
  eq("coalesce/undo restores the whole deleted run", h.current, "hello");
})();

// Undo then a fresh edit discards the redo tail.
(function () {
  var h = new E.History("");
  h.commit("a", 1, { kind: "insert", time: 0, caretBefore: 0 });
  h.commit("a\nb", 3, { kind: "insert", time: 1000, caretBefore: 1 }); // sealed, new step
  eq("coalesce/two separated steps", h.size(), 2);
  h.undo();
  ok("coalesce/can redo after undo", h.canRedo());
  h.commit("aZ", 2, { kind: "insert", time: 2000, caretBefore: 1 });   // fresh edit
  ok("coalesce/fresh edit drops the redo tail", !h.canRedo());
  eq("coalesce/redo tail truncated to current tip", h.size(), 2);
})();

/* ------------------------------------------------------------------ *
 * 4. The gap, demonstrated — coalesced vs naive step counts.
 * ------------------------------------------------------------------ */
(function () {
  var seq = ["", "h", "he", "hel", "hell", "hello"];
  var h = E.replay(seq, { step: 50 }); // 50 ms between keystrokes, inside the window
  eq("gap/coalesced: typing 'hello' is one undo step", h.size(), 1);
  eq("gap/naive: one undo step per keystroke", E.naiveUndoSteps(seq), 5);
  ok("gap/coalesced beats naive", h.size() < E.naiveUndoSteps(seq));
})();

/* ------------------------------------------------------------------ *
 * 5. Statistics — pinned where the answer is countable by eye.
 * ------------------------------------------------------------------ */
deepEq("stats/empty", E.stats(""), { chars: 0, bytes: 0, words: 0, lines: 0 });
deepEq("stats/'hello'", E.stats("hello"), { chars: 5, bytes: 5, words: 1, lines: 1 });
deepEq("stats/'the quick brown fox'",
  E.stats("the quick brown fox"), { chars: 19, bytes: 19, words: 4, lines: 1 });
deepEq("stats/two lines", E.stats("a\nb"), { chars: 3, bytes: 3, words: 2, lines: 2 });
// One emoji: one character, four UTF-8 bytes — not JavaScript's .length of 2.
deepEq("stats/single emoji", E.stats("😀"), { chars: 1, bytes: 4, words: 0, lines: 1 });
// Punctuation is not a word; "" words is 0, matching the Count Words rule.
eq("stats/punctuation is not a word", E.stats("hi :) !!!").words, 1);
eq("stats/euro sign is bytes-honest (3 UTF-8 bytes)", E.stats("€").bytes, 3);

// utf16<->cp conversion round-trips across an astral boundary.
(function () {
  var s = "a😀b"; // UTF-16 length 4, 3 code points
  eq("conv/utf16ToCp past the emoji", E.utf16ToCp(s, 3), 2); // after 'a' + surrogate pair
  eq("conv/cpToUtf16 back", E.cpToUtf16(s, 2), 3);
  eq("conv/cpLen counts code points", E.cpLen(s), 3);
})();

/* ------------------------------------------------------------------ */
console.log("\n" + passed + " passed, " + failed + " failed.");
process.exit(failed === 0 ? 0 : 1);
