/*
 * tests.js — Node test suite for the Spell-It engine (spell-core.js).
 *
 * Run with:  node tests.js
 *
 * The engine is presentation-free, so every user story that isn't literally a
 * sound or a pixel is pinned down here: letter-by-letter diffing, the
 * case/whitespace-insensitive correctness rule, the statistics dashboard
 * (correct / attempts / percentage), the once-per-word scoring, the hint that
 * never counts as a submission, and the deterministic word order.
 */

"use strict";

const Core = require("./spell-core.js");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error("  ✗ " + msg);
  }
}

function eq(a, b, msg) {
  assert(a === b, msg + "  (got " + JSON.stringify(a) + ")");
}

function section(name) {
  console.log("\n" + name);
}

/* ---------------------------------------------------------------------- *
 *  normalize / isCorrect — the correctness rule
 * ---------------------------------------------------------------------- */
section("normalize + isCorrect");
eq(Core.normalize("  Apple "), "apple", "trims and lowercases");
eq(Core.normalize(null), "", "null normalises to empty string");
eq(Core.normalize(123), "123", "coerces non-strings");
assert(Core.isCorrect("Apple", "apple"), "correctness is case-insensitive");
assert(Core.isCorrect("  rhythm  ", "rhythm"), "surrounding whitespace ignored");
assert(!Core.isCorrect("aple", "apple"), "a real misspelling is wrong");
assert(!Core.isCorrect("apples", "apple"), "an extra trailing letter is wrong");

/* ---------------------------------------------------------------------- *
 *  spellDiff — letter-by-letter, the source of truth for hints
 * ---------------------------------------------------------------------- */
section("spellDiff");
(function () {
  const d = Core.spellDiff("apple", "apple");
  assert(d.correct, "identical strings are correct");
  eq(d.letters.length, 5, "one entry per target letter");
  assert(
    d.letters.every(function (l) {
      return l.status === "correct";
    }),
    "every letter marked correct on an exact match"
  );
  eq(d.extra.length, 0, "no extra letters on an exact match");
})();

(function () {
  // "aple" vs "apple": position 2 typed 'l' where 'p' expected (wrong),
  // position 3 typed 'e' where 'p'... actually shorter, so tail is missing.
  const d = Core.spellDiff("aple", "apple");
  assert(!d.correct, "misspelling is not correct");
  eq(d.letters[0].status, "correct", "a matches");
  eq(d.letters[1].status, "correct", "p matches");
  eq(d.letters[2].status, "wrong", "third letter wrong (l for p)");
  eq(d.letters[3].status, "wrong", "fourth letter wrong (e for l)");
  eq(d.letters[4].status, "missing", "fifth letter missing (nothing typed)");
})();

(function () {
  const d = Core.spellDiff("appleee", "apple");
  assert(!d.correct, "extra letters make it wrong");
  eq(d.extra.length, 2, "two extra letters captured");
  eq(d.extra.join(""), "ee", "the extra letters are reported");
})();

(function () {
  const d = Core.spellDiff("", "apple");
  eq(d.letters.length, 5, "empty attempt still yields target-length diff");
  assert(
    d.letters.every(function (l) {
      return l.status === "missing";
    }),
    "every letter missing for an empty attempt"
  );
})();

(function () {
  const d = Core.spellDiff("APPLE", "apple");
  assert(d.correct, "case difference still counts as correct in the diff");
})();

/* ---------------------------------------------------------------------- *
 *  createGame — session, scoring, statistics
 * ---------------------------------------------------------------------- */
section("createGame — statistics dashboard");
(function () {
  const words = [
    { word: "cat", hint: "" },
    { word: "dog", hint: "" },
    { word: "fish", hint: "" },
  ];
  const game = createFixed(words);

  let s = game.stats();
  eq(s.correct, 0, "starts with 0 correct");
  eq(s.attempts, 0, "starts with 0 attempts");
  eq(s.percent, 0, "percentage is 0 before any attempt");

  const first = game.current();
  const wrong = game.submit(mangle(first));
  assert(!wrong.correct, "a mangled attempt is reported incorrect");
  s = game.stats();
  eq(s.attempts, 1, "a wrong submission counts as an attempt");
  eq(s.correct, 0, "a wrong submission does not score");
  eq(s.percent, 0, "0% after one wrong attempt");

  const right = game.submit(first);
  assert(right.correct, "typing the word correctly is accepted");
  eq(right.target, first, "the target is revealed on submit");
  s = game.stats();
  eq(s.attempts, 2, "attempts now 2");
  eq(s.correct, 1, "correct now 1");
  eq(s.percent, 50, "1/2 -> 50%");
})();

section("createGame — a word scores at most once");
(function () {
  const game = createFixed([{ word: "sun", hint: "" }]);
  const w = game.current();
  game.submit(w); // correct
  assert(game.isSolved(), "word marked solved after a correct submit");
  game.submit(w); // correct again, same word
  const s = game.stats();
  eq(s.correct, 1, "re-spelling the same word does not add a second point");
  eq(s.attempts, 2, "but it still counts as an attempt");
})();

section("createGame — re-entry stays on the same word until you move on");
(function () {
  const game = createFixed([
    { word: "one", hint: "" },
    { word: "two", hint: "" },
  ]);
  const first = game.current();
  game.submit(mangle(first));
  eq(game.current(), first, "a wrong answer keeps the same word for re-entry");
  game.next();
  assert(game.current() !== first, "next() advances to a different word");
})();

section("createGame — hint does not consume an attempt");
(function () {
  const game = createFixed([{ word: "橙" /* placeholder */, hint: "" }]);
  // Use a normal ASCII word to keep things simple.
  const g2 = createFixed([{ word: "table", hint: "you eat at it" }]);
  const before = g2.stats().attempts;
  const h = g2.hint("tabel");
  eq(before, 0, "no attempts before hinting");
  eq(g2.stats().attempts, 0, "hint() did not add an attempt");
  eq(h.letters[3].status, "wrong", "hint flags the transposed letter");
  eq(g2.currentHint(), "you eat at it", "currentHint exposes the definition");
})();

section("createGame — deterministic, reshuffling word order");
(function () {
  const a = Core.createGame({ seed: 42 });
  const b = Core.createGame({ seed: 42 });
  const c = Core.createGame({ seed: 7 });
  eq(a.current(), b.current(), "same seed -> same first word");
  // Walk a full round and confirm we see every word exactly once before repeat.
  const total = a.position().total;
  const seen = {};
  for (let i = 0; i < total; i++) {
    seen[a.current()] = (seen[a.current()] || 0) + 1;
    a.next();
  }
  eq(Object.keys(seen).length, total, "a full round visits every word once");
  assert(
    a.current() != null && a.current().length > 0,
    "the round reshuffles rather than running out"
  );
  // Different seed should (very probably) start somewhere else.
  assert(
    c.current() !== a.current() || total === 1,
    "a different seed generally yields a different order"
  );
})();

section("createGame — reset wipes the score");
(function () {
  const game = createFixed([{ word: "reset", hint: "" }]);
  game.submit("reset");
  game.submit("nope");
  assert(game.stats().attempts > 0, "attempts recorded before reset");
  game.reset();
  const s = game.stats();
  eq(s.correct, 0, "reset clears correct");
  eq(s.attempts, 0, "reset clears attempts");
  eq(game.history().length, 0, "reset clears history");
})();

section("createGame — history records each submission");
(function () {
  const game = createFixed([
    { word: "log", hint: "" },
    { word: "it", hint: "" },
  ]);
  game.submit("log");
  game.next();
  game.submit("xx");
  const h = game.history();
  eq(h.length, 2, "two submissions recorded");
  assert(h[0].correct, "first record correct");
  assert(!h[1].correct, "second record incorrect");
})();

section("createGame — guards");
(function () {
  let threw = false;
  try {
    Core.createGame({ words: [] });
  } catch (e) {
    threw = true;
  }
  assert(threw, "an empty word list is rejected");
})();

/* ---------------------------------------------------------------------- *
 *  helpers
 * ---------------------------------------------------------------------- */

// A game over a fixed, ordered word list: inject an RNG that never shuffles
// (identity order) so tests can predict the current word.
function createFixed(words) {
  // Fisher–Yates picks j = floor(rng * (i+1)); a value just under 1 makes
  // j === i at every step, so the array is left in its original order and the
  // tests can predict the current word.
  const rng = function () {
    return 0.9999999;
  };
  return Core.createGame({ words: words, random: rng });
}

// Turn a word into a guaranteed-wrong-but-plausible misspelling.
function mangle(word) {
  if (word.length < 2) return word + "x";
  return word.slice(0, -1) + (word[word.length - 1] === "z" ? "y" : "z");
}

/* ---------------------------------------------------------------------- */
console.log("\n" + (failed === 0 ? "✓ all" : "✗") + " tests: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
