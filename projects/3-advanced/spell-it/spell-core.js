/*
 * spell-core.js — the presentation-free engine for the Spell-It App.
 *
 * The spec (app-ideas Tier 3, "Spell-It") describes a spelling trainer: a word
 * is played as audio, the learner types what they hear, submits with Enter, and
 * gets told whether they were right — while a dashboard tracks correct count,
 * total attempts, and success percentage. Bonuses: confirmation/warning sounds
 * and a hint that highlights the misspelled letters.
 *
 * Everything that isn't sound or the DOM lives here and is fully testable:
 *
 *   • WORD_BANK        — the words to practise, deliberately never rendered by
 *                        the UI (a spelling test you can read isn't a test).
 *   • spellDiff()      — compare a typed attempt to the target letter by letter;
 *                        the single source of truth behind both "is this right?"
 *                        and the hint highlighting.
 *   • createGame()     — the session: a deterministic word order, submit/attempt
 *                        accounting, the statistics dashboard, and next/reset.
 *
 * The browser layer (`script.js`) speaks the target word with the Web Speech
 * API and plays the bonus tones with the Web Audio API; the Node suite
 * (`tests.js`) drives this exact code. Neither the audio nor the DOM ever
 * reaches in here.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api; // Node / tests
  } else {
    root.SpellCore = api; // browser (window.SpellCore)
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------------- *
   *  Seeded PRNG — so the word order and the tests are deterministic.
   * ---------------------------------------------------------------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------------------- *
   *  The word bank. Each entry carries an optional short definition so the
   *  UI can offer a "what does it mean?" nudge without ever revealing the
   *  spelling. Words are common but progressively trickier — the sort of
   *  list a spelling trainer would drill.
   * ---------------------------------------------------------------------- */
  const WORD_BANK = [
    { word: "apple", hint: "a common orchard fruit" },
    { word: "banana", hint: "a long yellow fruit" },
    { word: "orange", hint: "a citrus fruit and a colour" },
    { word: "purple", hint: "a colour between red and blue" },
    { word: "friend", hint: "someone you like and trust" },
    { word: "school", hint: "where children go to learn" },
    { word: "island", hint: "land surrounded by water" },
    { word: "rhythm", hint: "a repeated pattern of sound" },
    { word: "biscuit", hint: "a small baked treat" },
    { word: "chocolate", hint: "a sweet made from cocoa" },
    { word: "necessary", hint: "needed; required" },
    { word: "separate", hint: "to set apart" },
    { word: "definitely", hint: "without any doubt" },
    { word: "beautiful", hint: "very pleasing to look at" },
    { word: "government", hint: "the group that runs a country" },
    { word: "restaurant", hint: "a place you go to eat out" },
    { word: "calendar", hint: "shows the days of the year" },
    { word: "February", hint: "the second month" },
    { word: "Wednesday", hint: "the day after Tuesday" },
    { word: "vegetable", hint: "a plant grown to be eaten" },
    { word: "environment", hint: "the natural world around us" },
    { word: "knowledge", hint: "what you know and understand" },
    { word: "language", hint: "how people communicate in words" },
    { word: "science", hint: "the study of the natural world" },
    { word: "machine", hint: "a device that does work" },
    { word: "measure", hint: "to find a size or amount" },
    { word: "receive", hint: "to be given something" },
    { word: "believe", hint: "to accept as true" },
    { word: "weird", hint: "strange or unusual" },
    { word: "height", hint: "how tall something is" },
    { word: "weather", hint: "rain, sun, wind and so on" },
    { word: "through", hint: "in one side and out the other" },
    { word: "thought", hint: "an idea in your mind" },
    { word: "beginning", hint: "the start of something" },
    { word: "occasion", hint: "a particular event or time" },
    { word: "embarrass", hint: "to make someone feel awkward" },
    { word: "millennium", hint: "a period of a thousand years" },
    { word: "conscience", hint: "your sense of right and wrong" },
    { word: "mischievous", hint: "playfully causing trouble" },
    { word: "pronunciation", hint: "the way a word is said aloud" },
  ];

  /* ---------------------------------------------------------------------- *
   *  Normalisation. Spelling is judged case-insensitively and ignores the
   *  whitespace a learner might accidentally type around the word, but the
   *  letters themselves must match exactly.
   * ---------------------------------------------------------------------- */
  function normalize(text) {
    return String(text == null ? "" : text).trim().toLowerCase();
  }

  /* ---------------------------------------------------------------------- *
   *  spellDiff — the heart of the engine. Line the attempt up against the
   *  target letter by letter and report, for every position in the target,
   *  whether it was typed correctly, typed wrong, or left missing; plus any
   *  extra letters typed past the end of the word.
   *
   *  Both correctness ("all letters correct and nothing extra") and the hint
   *  highlighting read straight off this one result, so they can never
   *  disagree.
   * ---------------------------------------------------------------------- */
  function spellDiff(attempt, target) {
    const a = normalize(attempt);
    const t = normalize(target);
    const letters = [];
    for (let i = 0; i < t.length; i++) {
      const expected = t[i];
      if (i >= a.length) {
        letters.push({ expected: expected, typed: null, status: "missing" });
      } else if (a[i] === expected) {
        letters.push({ expected: expected, typed: a[i], status: "correct" });
      } else {
        letters.push({ expected: expected, typed: a[i], status: "wrong" });
      }
    }
    const extra = a.length > t.length ? a.slice(t.length).split("") : [];
    const correct = a === t;
    return {
      target: t,
      attempt: a,
      letters: letters,
      extra: extra,
      correct: correct,
    };
  }

  // Convenience predicate used all over the place.
  function isCorrect(attempt, target) {
    return normalize(attempt) === normalize(target);
  }

  /* ---------------------------------------------------------------------- *
   *  createGame — a spelling session.
   *
   *  Options:
   *    words  — array of { word, hint } (defaults to WORD_BANK)
   *    seed   — integer seed for the deterministic shuffle (default 1)
   *    random — inject a custom RNG (overrides seed); used by tests
   *
   *  The word order is a seeded Fisher–Yates shuffle so a run is reproducible
   *  but not alphabetical. When the list is exhausted it reshuffles and keeps
   *  going, so practice never runs out.
   * ---------------------------------------------------------------------- */
  function createGame(options) {
    const opts = options || {};
    const source = (opts.words || WORD_BANK).slice();
    if (source.length === 0) {
      throw new Error("createGame: need at least one word");
    }
    const rng = opts.random || mulberry32(opts.seed == null ? 1 : opts.seed);

    let order = [];
    let pos = 0;
    let correctCount = 0;
    let attemptCount = 0;
    let solved = false; // has the current word been spelled correctly yet?
    const history = []; // one record per submitted attempt

    function shuffle() {
      order = source.map(function (_, i) {
        return i;
      });
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }
      pos = 0;
    }

    function currentEntry() {
      return source[order[pos]];
    }

    shuffle();

    return {
      /* The current word to spell. The UI must SPEAK this, never show it. */
      current: function () {
        return currentEntry().word;
      },

      /* The meaning of the current word — safe to display; it isn't the
         spelling. Backs a "give me a clue about the word" affordance. */
      currentHint: function () {
        return currentEntry().hint || "";
      },

      /* How far through the current shuffle we are (1-based), and the size of
         the round — handy for a "word 3 of 40" indicator. */
      position: function () {
        return { index: pos + 1, total: order.length };
      },

      /*
       * Submit a spelling attempt. Counts as one attempt in the statistics,
       * appends to the history, and returns the full spellDiff plus a `target`
       * the UI can now reveal. A word only ever contributes ONE point to the
       * correct count (the first time it's spelled right), so retries after a
       * miss don't inflate the score.
       */
      submit: function (attempt) {
        const target = currentEntry().word;
        const diff = spellDiff(attempt, target);
        attemptCount += 1;
        if (diff.correct && !solved) {
          correctCount += 1;
          solved = true;
        }
        const record = {
          target: diff.target,
          attempt: diff.attempt,
          correct: diff.correct,
        };
        history.push(record);
        return {
          correct: diff.correct,
          target: target,
          attempt: diff.attempt,
          letters: diff.letters,
          extra: diff.extra,
        };
      },

      /*
       * The hint the bonus story asks for: highlight the misspelled letters of
       * a partial or full attempt WITHOUT counting as a submission. Returns the
       * per-letter diff so the UI can colour each position.
       */
      hint: function (attempt) {
        return spellDiff(attempt, currentEntry().word);
      },

      /* Move on to the next word. Reshuffles when the round is exhausted. */
      next: function () {
        pos += 1;
        if (pos >= order.length) {
          shuffle();
        }
        solved = false;
        return currentEntry().word;
      },

      /* Has the current word already been spelled correctly this visit? */
      isSolved: function () {
        return solved;
      },

      /* The statistics dashboard: correct answers, total attempts, and the
         success percentage (0 when nothing's been tried yet). */
      stats: function () {
        return {
          correct: correctCount,
          attempts: attemptCount,
          percent:
            attemptCount === 0
              ? 0
              : Math.round((correctCount / attemptCount) * 100),
        };
      },

      /* A read-only copy of every attempt made this session. */
      history: function () {
        return history.slice();
      },

      /* Wipe the score and reshuffle from the top — a fresh session. */
      reset: function () {
        correctCount = 0;
        attemptCount = 0;
        solved = false;
        history.length = 0;
        shuffle();
        return currentEntry().word;
      },
    };
  }

  return {
    WORD_BANK: WORD_BANK,
    mulberry32: mulberry32,
    normalize: normalize,
    spellDiff: spellDiff,
    isCorrect: isCorrect,
    createGame: createGame,
  };
});
