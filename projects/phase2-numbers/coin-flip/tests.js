/*
 * tests.js — dependency-free suite for coin-core.js. Run with:
 *   node projects/phase2-numbers/coin-flip/tests.js
 *
 * A simulation is only trustworthy if it is reproducible, so this suite pins the
 * seed and checks CONCRETE numbers, not tolerances: exact head/tail counts, exact
 * streak lengths, exact run counts. That is the random-process analogue of a
 * round-trip — fix the seed and the output is a fact. It also checks the parts
 * that must hold for ANY seed (heads + tails = n, longest run ≤ n, checkpoints in
 * order) and that the theory and the empirical results agree as n grows large.
 */

'use strict';

var C = require('./coin-core.js');

var passed = 0, failed = 0;
function show(v) { return typeof v === 'bigint' ? v.toString() + 'n' : JSON.stringify(v); }
function eq(name, got, want) {
  var g = show(got), w = show(want);
  if (g === w) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + '\n        got  ' + g + '\n        want ' + w); }
}
function ok(name, cond) {
  if (cond) { passed++; } else { failed++; console.error('  FAIL: ' + name); }
}
function approx(name, got, want, tol) {
  if (Math.abs(got - want) <= tol) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + '\n        got  ' + got + '\n        want ' + want + ' ±' + tol); }
}
function throws(name, fn) {
  try { fn(); failed++; console.error('  FAIL: ' + name + ' (expected throw)'); }
  catch (e) { passed++; }
}

/* ---- determinism: same seed replays identically -------------------------- */
var a = C.simulate({ n: 1000, seed: 42 });
var b = C.simulate({ n: 1000, seed: 42 });
eq('same seed -> same heads', a.heads, b.heads);
eq('same seed -> same tails', a.tails, b.tails);
eq('same seed -> same longest head run', a.longestHeadRun, b.longestHeadRun);
eq('same seed -> same longest tail run', a.longestTailRun, b.longestTailRun);
eq('same seed -> same run count', a.runs, b.runs);

// A different seed should (essentially always) give a different head count.
var c = C.simulate({ n: 1000, seed: 43 });
ok('different seed -> different heads (seed 42 vs 43)', a.heads !== c.heads);

/* ---- exact, locked-in results for a known seed --------------------------- *
 * These are the concrete facts a reproducible simulator owes you: for seed 42,
 * 1000 fair flips ALWAYS come out exactly like this. If the PRNG, the tally, or
 * the streak logic ever drift, these break.
 */
eq('seed 42, n=1000: heads', a.heads, 480);
eq('seed 42, n=1000: tails', a.tails, 520);
eq('seed 42, n=1000: heads + tails = n', a.heads + a.tails, 1000);
eq('seed 42, n=1000: longest head run', a.longestHeadRun, 9);
eq('seed 42, n=1000: longest tail run', a.longestTailRun, 11);
eq('seed 42, n=1000: runs', a.runs, 499);

/* ---- invariants that must hold for ANY seed ------------------------------ */
for (var s = 0; s < 40; s++) {
  var r = C.simulate({ n: 500, seed: s });
  ok('seed ' + s + ': heads + tails = n', r.heads + r.tails === 500);
  ok('seed ' + s + ': heads in [0, n]', r.heads >= 0 && r.heads <= 500);
  ok('seed ' + s + ': longest head run <= heads', r.longestHeadRun <= r.heads);
  ok('seed ' + s + ': longest tail run <= tails', r.longestTailRun <= r.tails);
  // Number of runs is between 1 and n, and at least max(1, count of the rarer face).
  ok('seed ' + s + ': runs in [1, n]', r.runs >= 1 && r.runs <= 500);
  // headsProportion is exactly heads/n.
  ok('seed ' + s + ': proportion = heads/n', r.headsProportion === r.heads / 500);
}

/* ---- the checkpoints (Law of Large Numbers samples) ---------------------- */
var big = C.simulate({ n: 100000, seed: 7 });
eq('checkpoints for n=100000', big.samples.map(function (x) { return x.flips; }),
   [1, 10, 100, 1000, 10000, 100000]);
ok('checkpoints strictly increasing', big.samples.every(function (x, i, arr) {
  return i === 0 || arr[i - 1].flips < x.flips;
}));
// The last checkpoint's proportion is the overall proportion.
eq('last checkpoint == overall proportion',
   big.samples[big.samples.length - 1].proportion, big.headsProportion);
// Law of Large Numbers: at 100k fair flips the proportion is very near 0.5.
approx('100k fair flips land near 0.5', big.headsProportion, 0.5, 0.02);

// A count that is not a power of ten still ends with a checkpoint at exactly n.
var odd = C.simulate({ n: 250, seed: 1 });
eq('checkpoints for n=250 end at n', odd.samples.map(function (x) { return x.flips; }),
   [1, 10, 100, 250]);

/* ---- n = 1 edge --------------------------------------------------------- */
var one = C.simulate({ n: 1, seed: 5 });
eq('n=1: heads + tails', one.heads + one.tails, 1);
eq('n=1: single checkpoint', one.samples.length, 1);
eq('n=1: checkpoint at 1', one.samples[0].flips, 1);
ok('n=1: exactly one run', one.runs === 1);

/* ---- biased coins ------------------------------------------------------- */
var biased = C.simulate({ n: 20000, seed: 3, pHeads: 0.8 });
approx('p=0.8 -> ~80% heads', biased.headsProportion, 0.8, 0.02);
ok('p=0.8 -> more heads than tails', biased.heads > biased.tails);
ok('p=0.8 -> longer head streaks than tail streaks', biased.longestHeadRun > biased.longestTailRun);
eq('pHeads carried through', biased.pHeads, 0.8);

var rare = C.simulate({ n: 20000, seed: 3, pHeads: 0.1 });
approx('p=0.1 -> ~10% heads', rare.headsProportion, 0.1, 0.02);
ok('p=0.1 -> fewer heads than tails', rare.heads < rare.tails);

/* ---- the theory block --------------------------------------------------- */
var t = C.theory(1000, 500, 0.5);
eq('theory: expected heads (n=1000, p=0.5)', t.expectedHeads, 500);
approx('theory: sd = sqrt(250)', t.standardDeviation, Math.sqrt(250), 1e-9);
eq('theory: z at the mean is 0', t.z, 0);
// Expected longest fair run over 1000 flips ~ log2(500) ≈ 8.97.
approx('theory: expected longest head run ~ log2(n)', t.expectedLongestHeadRun, Math.log(500) / Math.log(2), 1e-9);

var tb = C.theory(1000, 800, 0.8);
approx('theory (p=0.8): expected heads', tb.expectedHeads, 800, 1e-9);
approx('theory (p=0.8): sd', tb.standardDeviation, Math.sqrt(1000 * 0.8 * 0.2), 1e-9);

// The z-score of the real seed-42 run should be modest (a plausible run).
approx('seed 42 run is statistically plausible (|z| < 3)', a.stats.z, 0, 3);

/* ---- the generator's own bias ------------------------------------------- *
 * Drive flips directly through makeRng + flip, independent of the tally logic,
 * and confirm a fair generator is close to balanced over many draws. */
var rng = C.makeRng('some-word-seed');
var h = 0, total = 30000;
for (var i = 0; i < total; i++) if (C.flip(rng) === 'H') h++;
approx('raw generator is fair over 30k draws', h / total, 0.5, 0.02);

// String seeds are reproducible too.
var w1 = C.simulate({ n: 2000, seed: 'hello' });
var w2 = C.simulate({ n: 2000, seed: 'hello' });
eq('string seed reproducible', w1.heads, w2.heads);
ok('different words -> different runs', C.simulate({ n: 2000, seed: 'hello' }).heads
   !== C.simulate({ n: 2000, seed: 'world' }).heads);

/* ---- input validation --------------------------------------------------- */
throws('rejects n = 0', function () { C.simulate({ n: 0, seed: 1 }); });
throws('rejects negative n', function () { C.simulate({ n: -5, seed: 1 }); });
throws('rejects fractional n', function () { C.simulate({ n: 3.5, seed: 1 }); });
throws('rejects absurdly large n', function () { C.simulate({ n: 1e9, seed: 1 }); });
throws('rejects p = 0', function () { C.simulate({ n: 10, seed: 1, pHeads: 0 }); });
throws('rejects p = 1', function () { C.simulate({ n: 10, seed: 1, pHeads: 1 }); });
throws('rejects p > 1', function () { C.simulate({ n: 10, seed: 1, pHeads: 1.5 }); });

/* ---- summary ------------------------------------------------------------ */
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
