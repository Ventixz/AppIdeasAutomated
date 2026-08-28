/*
 * tests.js — a dependency-free test suite for the Shell Game engine.
 *
 *   node tests.js
 *
 * Drives the same shell-core.js the browser uses. A tiny seeded RNG makes the
 * "random" shuffle deterministic so every assertion is exact.
 */

const C = require("./shell-core.js");

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

function section(name) {
  console.log("\n" + name);
}

// A deterministic RNG: a small LCG mapped to [0,1). Same seed -> same sequence.
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
section("createGame");
{
  const g = C.createGame();
  eq(g.shellCount, 3, "default is three shells");
  eq(g.peaAt, null, "no pea placed yet");
  eq(g.phase, "placing", "starts in the placing phase");
  eq(g.stats.games, 0, "zero games to start");
  eq(g.stats.wins, 0, "zero wins to start");

  const five = C.createGame(5);
  eq(five.shellCount, 5, "custom shell count is honoured");

  throws(() => C.createGame(1), "rejects fewer than two shells");
  throws(() => C.createGame(2.5), "rejects a non-integer shell count");
}

// ---------------------------------------------------------------------------
section("placePea");
{
  const g = C.createGame();
  const p = C.placePea(g, 1);
  eq(p.peaAt, 1, "pea placed under the chosen shell");
  eq(p.phase, "ready", "moves to ready once placed");
  eq(p.stats.games, 1, "placing the pea counts one game");
  eq(p.stats.wins, 0, "placing does not touch wins");
  eq(g.peaAt, null, "original state is left untouched (immutability)");

  throws(() => C.placePea(g, 9), "rejects an out-of-range shell");
  throws(() => C.placePea(g, -1), "rejects a negative shell");
  throws(() => C.placePea(p, 0), "cannot re-place while a round is live");
}

// ---------------------------------------------------------------------------
section("applySwap (single-swap arithmetic)");
{
  eq(C.applySwap(0, 0, 2), 2, "pea at a follows a->b");
  eq(C.applySwap(2, 0, 2), 0, "pea at b follows b->a");
  eq(C.applySwap(1, 0, 2), 1, "pea untouched when it isn't in the swap");
}

// ---------------------------------------------------------------------------
section("generateSwaps");
{
  const rng = seededRng(42);
  const swaps = C.generateSwaps(3, 20, rng);
  eq(swaps.length, 20, "produces the requested number of swaps");
  let allValid = true;
  let noSelfSwap = true;
  let sorted = true;
  for (const [a, b] of swaps) {
    if (a < 0 || a > 2 || b < 0 || b > 2) allValid = false;
    if (a === b) noSelfSwap = false;
    if (a >= b) sorted = false;
  }
  ok(allValid, "every swap index is in range");
  ok(noSelfSwap, "never emits a no-op self-swap");
  ok(sorted, "each pair is normalised to a < b");

  eq(C.generateSwaps(3, 0, rng).length, 0, "zero swaps is allowed");

  // Determinism: same seed => identical sequence.
  const a = JSON.stringify(C.generateSwaps(4, 10, seededRng(7)));
  const b = JSON.stringify(C.generateSwaps(4, 10, seededRng(7)));
  eq(a, b, "same seed reproduces the same swap list");

  throws(() => C.generateSwaps(1, 5, rng), "rejects too few shells");
  throws(() => C.generateSwaps(3, -1, rng), "rejects a negative count");

  // Every generated swap actually moves a pea sitting at either endpoint.
  const rng2 = seededRng(99);
  const many = C.generateSwaps(3, 200, rng2);
  let movesWork = true;
  for (const [x, y] of many) {
    if (C.applySwap(x, x, y) !== y) movesWork = false;
    if (C.applySwap(y, x, y) !== x) movesWork = false;
  }
  ok(movesWork, "generated swaps move a pea at either endpoint");
}

// ---------------------------------------------------------------------------
section("applySwaps (final pea position)");
{
  const ready = C.placePea(C.createGame(), 0);
  const shuffled = C.applySwaps(ready, [[0, 1], [1, 2], [0, 1]]);
  // 0 ->(0,1)-> 1 ->(1,2)-> 2 ->(0,1)-> 2
  eq(shuffled.peaAt, 2, "pea followed the swap chain to its resting place");
  eq(shuffled.phase, "guessing", "shuffling opens the guessing phase");

  const noop = C.applySwaps(ready, []);
  eq(noop.peaAt, 0, "an empty shuffle leaves the pea put");

  // A full random shuffle keeps the pea on some real shell.
  const r = C.placePea(C.createGame(3), 2);
  const s = C.applySwaps(r, C.generateSwaps(3, 50, seededRng(5)));
  ok(s.peaAt >= 0 && s.peaAt < 3, "pea stays on a valid shell after 50 swaps");

  throws(() => C.applySwaps(ready, [[0, 9]]), "rejects an out-of-range swap");
  throws(() => C.applySwaps(ready, "nope"), "rejects a non-array swap list");
  throws(() => C.applySwaps(C.createGame(), [[0, 1]]), "cannot shuffle before placing");
}

// ---------------------------------------------------------------------------
section("beginShuffle");
{
  const ready = C.placePea(C.createGame(), 0);
  const shuffling = C.beginShuffle(ready);
  eq(shuffling.phase, "shuffling", "flags the shuffling phase");
  // applySwaps still works straight from "shuffling" (the animation window).
  const done = C.applySwaps(shuffling, [[0, 1]]);
  eq(done.peaAt, 1, "shuffle resolves from the shuffling phase");
  throws(() => C.beginShuffle(ready.phase === "won" ? ready : done), "beginShuffle only from ready");
}

// ---------------------------------------------------------------------------
section("guess — first-guess win");
{
  let s = C.placePea(C.createGame(), 0);
  s = C.applySwaps(s, [[0, 2]]); // pea now under shell 2
  eq(s.peaAt, 2, "sanity: pea is under shell 2");

  const res = C.guess(s, 2);
  ok(res.correct, "correct shell reported correct");
  ok(res.firstGuess, "it was the first guess");
  ok(res.win, "a first-guess hit is a win");
  eq(res.state.phase, "won", "round is won");
  eq(res.state.stats.wins, 1, "win tally incremented");
  eq(res.state.stats.games, 1, "games tally unchanged by the guess");
}

// ---------------------------------------------------------------------------
section("guess — wrong then right is no win");
{
  let s = C.placePea(C.createGame(), 0);
  s = C.applySwaps(s, [[0, 2]]); // pea under shell 2

  const miss = C.guess(s, 0);
  ok(!miss.correct, "wrong shell reported wrong");
  ok(miss.firstGuess, "the miss was the first guess");
  ok(!miss.win, "a miss is not a win");
  eq(miss.state.phase, "guessing", "round continues after a miss");
  eq(miss.state.revealed.length, 1, "the empty shell is now revealed");
  eq(miss.state.revealed[0], 0, "the lifted shell is recorded");

  const repeat = C.guess(miss.state, 0);
  ok(repeat.repeat, "lifting the same empty shell is a harmless repeat");
  eq(repeat.state.guesses, miss.state.guesses, "a repeat does not count as a new guess");

  const hit = C.guess(miss.state, 2);
  ok(hit.correct, "second guess finds the pea");
  ok(!hit.firstGuess, "but it was not the first guess");
  ok(!hit.win, "so no win is scored");
  eq(hit.state.stats.wins, 0, "win tally stays at zero");
  eq(hit.state.phase, "won", "round still ends when the pea is found");

  throws(() => C.guess(hit.state, 1), "cannot guess after the round is won");
}

// ---------------------------------------------------------------------------
section("nextRound & winRate over a session");
{
  let s = C.createGame();
  // Round 1: first-guess win.
  s = C.placePea(s, 0);
  s = C.applySwaps(s, []); // pea stays at 0
  s = C.guess(s, 0).state;
  eq(s.stats.wins, 1, "round 1 won on first guess");

  // Round 2: a miss first, then find it — a played game with no win.
  s = C.nextRound(s);
  eq(s.phase, "placing", "nextRound returns to placing");
  eq(s.peaAt, null, "nextRound clears the pea");
  eq(s.stats.games, 1, "nextRound preserves the running stats");
  s = C.placePea(s, 1);
  s = C.applySwaps(s, [[1, 2]]); // pea -> 2
  s = C.guess(s, 0).state; // miss
  s = C.guess(s, 2).state; // find
  eq(s.stats.games, 2, "two games played");
  eq(s.stats.wins, 1, "still one win");
  eq(C.winRate(s), 0.5, "win rate is wins/games");

  eq(C.winRate(C.createGame()), 0, "win rate is 0 with no games played");
}

// ---------------------------------------------------------------------------
section("statistical sanity of the shuffle");
{
  // Over many random shuffles the pea should land on every shell sometimes —
  // a guard against a swap generator that quietly favours one position.
  const rng = seededRng(2024);
  const landing = [0, 0, 0];
  for (let i = 0; i < 3000; i++) {
    let s = C.placePea(C.createGame(3), i % 3);
    s = C.applySwaps(s, C.generateSwaps(3, 15, rng));
    landing[s.peaAt]++;
  }
  ok(landing[0] > 700 && landing[1] > 700 && landing[2] > 700,
    "pea lands on each shell a fair share of the time (" + landing.join("/") + ")");
}

// ---------------------------------------------------------------------------
console.log("\n" + (failed === 0 ? "✓ all " : "✗ ") + (passed + failed) +
  " assertions — " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
