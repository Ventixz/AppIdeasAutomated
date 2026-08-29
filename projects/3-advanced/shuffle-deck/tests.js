/*
 * tests.js — a dependency-free test suite for the Shuffle Deck engine.
 *
 *   node tests.js
 *
 * Drives the same shuffle-core.js the browser uses. A fake clock and seeded
 * generators make every assertion exact — no wall-clock flakiness, no
 * unseeded randomness.
 */

const C = require("./shuffle-core.js");

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

function eq(a, b, msg) {
  ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

function throws(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  ok(threw, msg);
}

/* --- RNG output range ---------------------------------------------------- */

function drawsInRange(rngFactory, name) {
  const rng = rngFactory(12345);
  let good = true;
  for (let i = 0; i < 5000; i++) {
    const v = rng();
    if (!(v >= 0 && v < 1)) {
      good = false;
      break;
    }
  }
  ok(good, name + " always returns a float in [0, 1)");
}

drawsInRange(C.jsRandom, "jsRandom");
drawsInRange(C.xorshift, "xorshift");
drawsInRange(C.well512a, "well512a");

/* --- Seedable generators are deterministic ------------------------------- */

function deterministic(rngFactory, name) {
  const a = rngFactory(999);
  const b = rngFactory(999);
  let same = true;
  for (let i = 0; i < 100; i++) {
    if (a() !== b()) {
      same = false;
      break;
    }
  }
  ok(same, name + " with the same seed produces the same stream");
}

deterministic(C.xorshift, "xorshift");
deterministic(C.well512a, "well512a");

// Different seeds should (overwhelmingly) diverge.
(function differentSeedsDiverge() {
  const a = C.xorshift(1);
  const b = C.xorshift(2);
  let diverged = false;
  for (let i = 0; i < 10; i++) {
    if (a() !== b()) {
      diverged = true;
      break;
    }
  }
  ok(diverged, "xorshift diverges for different seeds");
})();

// A zero seed must not collapse the generator to a constant stream.
(function zeroSeedIsSafe() {
  const rng = C.xorshift(0);
  const first = rng();
  let varied = false;
  for (let i = 0; i < 10; i++) {
    if (rng() !== first) {
      varied = true;
      break;
    }
  }
  ok(varied, "xorshift with a zero seed still varies");
})();

/* --- Deck construction --------------------------------------------------- */

(function deckIsComplete() {
  const deck = C.makeDeck();
  eq(deck.length, 52, "a fresh deck has 52 cards");
  const set = new Set(deck);
  eq(set.size, 52, "a fresh deck has 52 distinct cards");
  eq(Math.min.apply(null, deck), 0, "deck's lowest card is 0");
  eq(Math.max.apply(null, deck), 51, "deck's highest card is 51");
})();

/* --- Shuffle is a permutation (never loses/duplicates cards) -------------- */

(function shufflePreservesCards() {
  const rng = C.xorshift(42);
  const deck = C.makeDeck();
  C.shuffle(deck, rng);
  eq(deck.length, 52, "shuffled deck still has 52 cards");
  const set = new Set(deck);
  eq(set.size, 52, "shuffled deck still has 52 distinct cards");
  let complete = true;
  for (let i = 0; i < 52; i++) if (!set.has(i)) complete = false;
  ok(complete, "shuffled deck still contains every card 0..51");
})();

(function shuffleActuallyReorders() {
  const rng = C.xorshift(7);
  const deck = C.makeDeck();
  const before = deck.join(",");
  C.shuffle(deck, rng);
  ok(deck.join(",") !== before, "shuffling changes the order");
})();

/* --- Rounds validation --------------------------------------------------- */

eq(C.validateRounds("").ok, false, "empty rounds is rejected");
eq(C.validateRounds(null).ok, false, "null rounds is rejected");
eq(C.validateRounds("abc").ok, false, "non-numeric rounds is rejected");
eq(C.validateRounds("3.5").ok, false, "fractional rounds is rejected");
eq(C.validateRounds("0").ok, false, "0 rounds is out of range");
eq(C.validateRounds("10001").ok, false, "10001 rounds is out of range");
eq(C.validateRounds("1").ok, true, "1 round is accepted");
eq(C.validateRounds("10000").ok, true, "10000 rounds is accepted");
eq(C.validateRounds("500").rounds, 500, "valid rounds parses to the number");

/* --- Benchmark with a fake clock ----------------------------------------- */

(function benchmarkUsesTheClock() {
  // Fake clock: advances 2ms on each read. First read = start, second = end,
  // so elapsed is deterministic regardless of real speed.
  let t = 100;
  const now = function () {
    const v = t;
    t += 2;
    return v;
  };
  const res = C.runBenchmark("xorshift", 50, { now: now, seed: 1 });
  eq(res.id, "xorshift", "benchmark reports the algorithm id");
  eq(res.label, "Xorshift", "benchmark reports the algorithm label");
  eq(res.start, 100, "benchmark records the start time");
  eq(res.end, 102, "benchmark records the end time");
  eq(res.elapsed, 2, "elapsed = end - start");
  eq(res.rounds, 50, "benchmark echoes the round count");
})();

(function benchmarkValidatesAndGuards() {
  throws(function () {
    C.runBenchmark("xorshift", 0);
  }, "benchmark rejects out-of-range rounds");
  throws(function () {
    C.runBenchmark("nope", 10);
  }, "benchmark rejects an unknown algorithm");
})();

/* --- Completion gate ----------------------------------------------------- */

(function coreCompletion() {
  ok(!C.allCoreComplete({}), "no results → not complete");
  ok(
    !C.allCoreComplete({ js: { elapsed: 1 } }),
    "only JS Random run → not complete"
  );
  ok(
    C.allCoreComplete({ js: { elapsed: 1 }, xorshift: { elapsed: 2 } }),
    "both core algorithms run → complete"
  );
  ok(
    C.allCoreComplete({
      js: { elapsed: 1 },
      xorshift: { elapsed: 2 },
      well512a: { elapsed: 3 },
    }),
    "core complete even with the bonus present"
  );
})();

/* --- Analysis (bonus: fastest vs slowest) -------------------------------- */

(function analysisRanks() {
  const r = C.analyze({
    js: { id: "js", label: "JS Random", elapsed: 30 },
    xorshift: { id: "xorshift", label: "Xorshift", elapsed: 10 },
    well512a: { id: "well512a", label: "WELL512a", elapsed: 20 },
  });
  eq(r.fastest.id, "xorshift", "fastest is the smallest elapsed");
  eq(r.slowest.id, "js", "slowest is the largest elapsed");
  eq(r.rows[0].id, "xorshift", "rows are sorted fastest-first");
  eq(r.rows[0].relative, 1, "fastest is 1x itself");
  eq(r.rows[2].relative, 3, "slowest is 3x the fastest");
})();

/* --- Report -------------------------------------------------------------- */

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
