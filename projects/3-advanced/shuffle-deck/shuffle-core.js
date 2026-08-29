/*
 * shuffle-core.js — the presentation-free engine for the Shuffle Deck
 * benchmark.
 *
 * Nothing in here touches the DOM, a timer widget, or a button. It exposes
 * three pseudorandom number generators, a Fisher–Yates shuffle that runs on any
 * of them, and a benchmark runner that shuffles a 52-card deck `rounds` times
 * and reports how long it took. The browser (`script.js`) and the Node test
 * suite (`tests.js`) both drive this exact same code, so the numbers you see on
 * screen come from the logic the tests pin down.
 *
 * The spec asks us to "measure app performance" by benchmarking different
 * random number generators. That is precisely what a card shuffle stresses: a
 * shuffle is nothing but a tight loop of RNG calls, so timing a shuffle is a
 * faithful, real-world way to compare generators.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api; // Node / tests
  } else {
    root.ShuffleCore = api; // browser (window.ShuffleCore)
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN_ROUNDS = 1;
  const MAX_ROUNDS = 10000;
  const DECK_SIZE = 52;

  /* ---------------------------------------------------------------------- *
   *  Random number generators.
   *
   *  Every generator is a factory: call it (optionally with a seed) and you
   *  get back a function that returns a float in [0, 1) on each call, exactly
   *  like Math.random. Seeding is what lets the tests be deterministic.
   * ---------------------------------------------------------------------- */

  // Plain built-in generator. Ignores the seed — Math.random can't be seeded —
  // which is the honest baseline every other algorithm is measured against.
  function jsRandom() {
    return function () {
      return Math.random();
    };
  }

  // Force a seed into a non-zero 32-bit unsigned integer. A zero state makes
  // xorshift collapse to all-zeros forever, so we steer away from it.
  function normalizeSeed(seed) {
    let s = (seed >>> 0) || 0x9e3779b9; // golden-ratio default when 0/undefined
    return s === 0 ? 0x9e3779b9 : s;
  }

  // Marsaglia's xorshift32. A single 32-bit word of state shuffled with three
  // shifts. Tiny, fast, and famously used as a "how little can we get away
  // with" generator — the perfect foil for the heavier WELL512a below.
  function xorshift(seed) {
    let x = normalizeSeed(seed);
    return function () {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      // Divide by 2^32 to land in [0, 1).
      return x / 4294967296;
    };
  }

  // WELL512a — Panneton, L'Ecuyer & Matsumoto's "Well Equidistributed Long-
  // period Linear" generator, the 512-bit variant. It carries sixteen 32-bit
  // words of state, giving a period of 2^512 − 1 and far better equidistribution
  // than xorshift, at the cost of more work per draw. Ported from the reference
  // WELL512a.c. This is the spec's bonus algorithm.
  function well512a(seed) {
    const state = new Uint32Array(16);
    let index = 0;

    // Seed all sixteen words from the single seed using a splitmix-style
    // scrambler so we never start from an all-zero (degenerate) state.
    let s = normalizeSeed(seed);
    for (let i = 0; i < 16; i++) {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = (Math.imul(t ^ (t >>> 15), t | 1)) >>> 0;
      t ^= t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0);
      state[i] = (t ^ (t >>> 14)) >>> 0;
    }

    return function () {
      const a = state[index];
      const c = state[(index + 13) & 15];
      const b = a ^ c ^ (a << 16) ^ (c << 15);
      const dWord = state[(index + 9) & 15];
      const d = dWord ^ (dWord >>> 11);
      state[index] = (b ^ d) >>> 0;
      const e = state[index];
      const f =
        (a ^ (a << 5) & 0xda442d24) >>> 0;
      index = (index + 15) & 15;
      state[index] =
        (c ^ (c >>> 2) ^ (b >>> 9) ^ (b << 27) ^ e ^ (f << 0)) >>> 0;
      // Guard against any residual all-zero word producing a 0-heavy stream.
      return state[index] / 4294967296;
    };
  }

  // Registry keyed by the id the UI hands back. Order here is the order the
  // benchmark table reports "have all algorithms run yet?".
  const ALGORITHMS = [
    { id: "js", label: "JS Random", make: jsRandom },
    { id: "xorshift", label: "Xorshift", make: xorshift },
    { id: "well512a", label: "WELL512a", make: well512a },
  ];

  function getAlgorithm(id) {
    return ALGORITHMS.find(function (a) {
      return a.id === id;
    });
  }

  /* ---------------------------------------------------------------------- *
   *  Shuffle.
   * ---------------------------------------------------------------------- */

  // A fresh, ordered 52-card deck as integers 0..51.
  function makeDeck() {
    const deck = new Array(DECK_SIZE);
    for (let i = 0; i < DECK_SIZE; i++) deck[i] = i;
    return deck;
  }

  // Unbiased Fisher–Yates shuffle, in place, driven by the supplied rng().
  // This is the hot loop the benchmark is actually timing.
  function shuffle(deck, rng) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  /* ---------------------------------------------------------------------- *
   *  Validation.
   * ---------------------------------------------------------------------- */

  // Turns raw user input into either { ok:true, rounds } or
  // { ok:false, reason }. The UI shows `reason` verbatim.
  function validateRounds(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      return { ok: false, reason: "Enter a number of rounds to run." };
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, reason: "Rounds must be a whole number." };
    }
    if (n < MIN_ROUNDS || n > MAX_ROUNDS) {
      return {
        ok: false,
        reason:
          "Rounds must be between " +
          MIN_ROUNDS +
          " and " +
          MAX_ROUNDS.toLocaleString() +
          ".",
      };
    }
    return { ok: true, rounds: n };
  }

  /* ---------------------------------------------------------------------- *
   *  Benchmark.
   * ---------------------------------------------------------------------- */

  // Run one algorithm for `rounds` shuffles of a 52-card deck.
  //
  //   opts.now   — a clock returning milliseconds (defaults to Date.now, but
  //                the browser passes performance.now and the tests pass a
  //                fake clock so timings are exact).
  //   opts.seed  — seed for the seedable generators (tests rely on this).
  //
  // Returns { id, label, start, end, elapsed, rounds } where start/end are
  // absolute clock readings and elapsed = end - start (milliseconds).
  function runBenchmark(id, rounds, opts) {
    opts = opts || {};
    const algo = getAlgorithm(id);
    if (!algo) throw new Error("Unknown algorithm: " + id);

    const v = validateRounds(rounds);
    if (!v.ok) throw new Error(v.reason);
    rounds = v.rounds;

    const now = opts.now || Date.now;
    const rng = algo.make(opts.seed);
    const deck = makeDeck();

    const start = now();
    for (let r = 0; r < rounds; r++) {
      shuffle(deck, rng);
    }
    const end = now();

    return {
      id: algo.id,
      label: algo.label,
      start: start,
      end: end,
      elapsed: end - start,
      rounds: rounds,
    };
  }

  /* ---------------------------------------------------------------------- *
   *  Results bookkeeping — the "have all three run?" and comparison logic
   *  the UI leans on, kept here so it is testable.
   * ---------------------------------------------------------------------- */

  // Given a map of id -> result, has every core algorithm been benchmarked?
  // (Core = the two the spec mandates; WELL512a is a bonus and does not gate.)
  function allCoreComplete(resultsById) {
    return ALGORITHMS.filter(function (a) {
      return a.id === "js" || a.id === "xorshift";
    }).every(function (a) {
      return Boolean(resultsById[a.id]);
    });
  }

  // Rank completed results fastest-first and annotate each with how many times
  // slower it is than the fastest. Used for the bonus "analyze the difference"
  // feature.
  function analyze(resultsById) {
    const rows = Object.keys(resultsById).map(function (k) {
      return resultsById[k];
    });
    if (rows.length === 0) return { rows: [], fastest: null, slowest: null };

    rows.sort(function (a, b) {
      return a.elapsed - b.elapsed;
    });
    const fastest = rows[0];
    const slowest = rows[rows.length - 1];
    rows.forEach(function (row) {
      row.relative = fastest.elapsed > 0 ? row.elapsed / fastest.elapsed : 1;
    });
    return { rows: rows, fastest: fastest, slowest: slowest };
  }

  return {
    MIN_ROUNDS: MIN_ROUNDS,
    MAX_ROUNDS: MAX_ROUNDS,
    DECK_SIZE: DECK_SIZE,
    ALGORITHMS: ALGORITHMS,
    getAlgorithm: getAlgorithm,
    jsRandom: jsRandom,
    xorshift: xorshift,
    well512a: well512a,
    makeDeck: makeDeck,
    shuffle: shuffle,
    validateRounds: validateRounds,
    runBenchmark: runBenchmark,
    allCoreComplete: allCoreComplete,
    analyze: analyze,
  };
});
