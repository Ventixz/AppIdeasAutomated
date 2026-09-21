/*
 * coin-core.js — the DOM-free core of the Coin Flip Simulation project.
 *
 * The brief (karan/Projects → Numbers) is short: "Coin Flip Simulation — write a
 * program that simulates flipping a coin. It should print how many heads and
 * tails came up." Counting two piles is trivial; the honest difficulty is that a
 * simulation is only worth anything if it is (a) *reproducible*, so you can check
 * it and reason about it, and (b) *revealing*, so it shows the things a real run
 * of flips actually does — the counts drifting toward 50/50, the surprisingly
 * long streaks, how far this particular run sits from what theory predicts.
 *
 * This core answers both honestly:
 *
 *   1. **Reproducible.** Randomness comes from a *seeded* generator (mulberry32,
 *      with strings hashed by xmur3), never `Math.random()`. The same seed and
 *      count always produce the identical run, so `tests.js` can assert exact
 *      head/tail counts and exact streak lengths — the "round-trip" equivalent
 *      for a random process: pin the seed, and the output is a fact, not a hope.
 *
 *   2. **Revealing.** One pass over the flips collects far more than two totals:
 *      the longest run of heads and of tails, the number of runs (alternations),
 *      and the running proportion of heads captured at 1, 10, 100, … flips so you
 *      can *watch* the Law of Large Numbers pull it toward the coin's true bias.
 *      Alongside the run it reports the theory it should match — expected heads
 *      `n·p`, the standard deviation `√(n·p·(1−p))`, this run's z-score, and the
 *      expected longest run `log_{1/p}(n)` — so the simulation can be judged, not
 *      just watched.
 *
 * Biased coins are first-class: `pHeads` defaults to a fair 0.5 but accepts any
 * probability in (0, 1), and every statistic uses it. Counting is done with a
 * single loop and O(1) memory regardless of `n` — nothing stores the full
 * sequence — so a ten-million-flip run costs no more memory than a ten-flip one.
 *
 * This file is deliberately DOM-free, I/O-free and console-free: no `document`,
 * no `window` beyond the export, no `fetch`. It runs identically in a browser
 * (via a `<script>` tag, exporting onto `window.CoinCore`) and in Node (via
 * `require`), so the suite in `tests.js` can prove its properties with no browser
 * and no network.
 */

'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CoinCore = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---- the seeded generator ------------------------------------------------
   * mulberry32 is a small, well-distributed 32-bit PRNG: given a 32-bit state it
   * returns a float in [0, 1) and advances the state. It is deterministic, which
   * is the whole point — the same seed replays the same stream of flips.
   */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* xmur3: hash an arbitrary string to a 32-bit integer, so a seed can be a word
   * ("hello") and not just a number. */
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // Turn any seed (number, numeric string, or word) into a 32-bit state, then a
  // mulberry32 stream. Exposed so the suite can drive flips directly.
  function makeRng(seed) {
    var state;
    if (typeof seed === 'number' && isFinite(seed)) {
      state = seed >>> 0;
    } else {
      var s = String(seed == null ? '' : seed);
      // A bare integer string seeds by value; anything else is hashed.
      if (/^-?\d+$/.test(s)) state = (parseInt(s, 10) >>> 0);
      else state = xmur3(s);
    }
    return mulberry32(state);
  }

  /* ---- input checking ------------------------------------------------------ */
  function validateCount(n) {
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n) {
      throw new Error('The number of flips must be a whole number.');
    }
    if (n < 1) throw new Error('Flip at least once.');
    if (n > 50000000) throw new Error('That is a lot of flips — keep it at or below 50,000,000.');
    return n;
  }

  function validateP(p) {
    if (typeof p !== 'number' || !isFinite(p)) throw new Error('The heads probability must be a number.');
    if (p <= 0 || p >= 1) throw new Error('The heads probability must be strictly between 0 and 1.');
    return p;
  }

  /* ---- the simulation ------------------------------------------------------
   * One pass. It never stores the sequence, only running tallies, so memory is
   * O(1) in the number of flips. What it collects:
   *   heads, tails                     — the two piles the brief asks for
   *   longestHeadRun, longestTailRun   — the longest unbroken streak of each
   *   runs                             — how many maximal same-face streaks
   *   proportion[]                     — heads/flips sampled at 1, 10, 100, …, n
   * The proportion checkpoints are what make the Law of Large Numbers visible.
   */
  function simulate(opts) {
    opts = opts || {};
    var n = validateCount(opts.n);
    var pHeads = opts.pHeads == null ? 0.5 : validateP(opts.pHeads);
    var rng = makeRng(opts.seed == null ? 0 : opts.seed);

    var heads = 0, tails = 0;
    var curFace = -1, curRun = 0;          // -1 = none yet, 1 = heads, 0 = tails
    var longestHead = 0, longestTail = 0;
    var runs = 0;

    // Checkpoints at 1, 10, 100, … up to n, plus n itself, in order.
    var marks = [];
    for (var m = 1; m < n; m *= 10) marks.push(m);
    marks.push(n);
    var samples = [];
    var markIdx = 0;

    for (var i = 1; i <= n; i++) {
      var isHead = rng() < pHeads;
      if (isHead) heads++; else tails++;

      var face = isHead ? 1 : 0;
      if (face === curFace) {
        curRun++;
      } else {
        curFace = face; curRun = 1; runs++;
      }
      if (isHead) { if (curRun > longestHead) longestHead = curRun; }
      else { if (curRun > longestTail) longestTail = curRun; }

      if (markIdx < marks.length && i === marks[markIdx]) {
        samples.push({ flips: i, proportion: heads / i });
        markIdx++;
      }
    }

    return {
      flips: n,
      pHeads: pHeads,
      seed: opts.seed == null ? 0 : opts.seed,
      heads: heads,
      tails: tails,
      headsProportion: heads / n,
      longestHeadRun: longestHead,
      longestTailRun: longestTail,
      runs: runs,
      samples: samples,
      stats: theory(n, heads, pHeads)
    };
  }

  /* ---- the theory the run should match ------------------------------------
   * For n independent flips with head-probability p, the head count is
   * Binomial(n, p): mean = n·p, variance = n·p·(1−p). The z-score says how many
   * standard deviations this run's head count sits from the mean — |z| under ~2
   * is unremarkable. The expected longest run of heads is about log_{1/p}(n),
   * which is why even a fair thousand-flip run routinely shows a streak of ~10.
   */
  function theory(n, heads, p) {
    var expected = n * p;
    var variance = n * p * (1 - p);
    var sd = Math.sqrt(variance);
    var z = sd === 0 ? 0 : (heads - expected) / sd;
    // log base 1/p of n:  ln(n) / ln(1/p)
    var expectedLongestHead = n < 1 ? 0 : Math.log(n * (1 - p)) / Math.log(1 / p);
    var q = 1 - p;
    var expectedLongestTail = n < 1 ? 0 : Math.log(n * p) / Math.log(1 / q);
    return {
      expectedHeads: expected,
      standardDeviation: sd,
      z: z,
      expectedLongestHeadRun: expectedLongestHead > 0 ? expectedLongestHead : 0,
      expectedLongestTailRun: expectedLongestTail > 0 ? expectedLongestTail : 0
    };
  }

  /* A single flip from a supplied rng — exposed so the suite can check the
   * generator's own bias directly, independent of the tally logic. */
  function flip(rng, pHeads) {
    var p = pHeads == null ? 0.5 : pHeads;
    return rng() < p ? 'H' : 'T';
  }

  return {
    simulate: simulate,
    makeRng: makeRng,
    flip: flip,
    theory: theory,
    // building blocks (exposed for the suite)
    mulberry32: mulberry32,
    xmur3: xmur3,
    validateCount: validateCount,
    validateP: validateP
  };
});
