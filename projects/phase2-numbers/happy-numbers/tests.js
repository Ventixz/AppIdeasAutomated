/*
 * tests.js — dependency-free suite for happy-core.js. Run with:
 *   node projects/phase2-numbers/happy-numbers/tests.js
 *
 * Happy numbers are an *exact* combinatorial problem, so this suite checks
 * concrete truths rather than tolerances: the canonical happy list, the two
 * textbook trajectories (7 up to 1, 4 into its cycle), the guarantee that the
 * base-10/power-2 process has exactly one unhappy cycle, that huge string inputs
 * are handled by the digit-string first step, that the memoised range/index
 * helpers agree with the plain classifier, and the generalisations to other
 * bases and powers.
 */

'use strict';

var H = require('./happy-core.js');

var passed = 0, failed = 0;

function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + ' (got ' + g + ', want ' + w + ')'); }
}
function throws(name, fn) {
  try { fn(); failed++; console.error('  FAIL: ' + name + ' (expected throw)'); }
  catch (e) { passed++; }
}

/* ---- the single step ----------------------------------------------------- */
eq('step(7) = 49', H.stepNumber(7, 10, 2), 49);
eq('step(49) = 97', H.stepNumber(49, 10, 2), 97);
eq('step(97) = 130', H.stepNumber(97, 10, 2), 130);
eq('step(130) = 10', H.stepNumber(130, 10, 2), 10);
eq('step(10) = 1', H.stepNumber(10, 10, 2), 1);
eq('step(1) = 1 (fixed point)', H.stepNumber(1, 10, 2), 1);
eq('step(0) = 0', H.stepNumber(0, 10, 2), 0);

/* ---- the canonical happy numbers below 100 ------------------------------- */
// The known sequence (OEIS A007770): 1, 7, 10, 13, 19, 23, 28, 31, 32, 44, 49,
// 68, 70, 79, 82, 86, 91, 94, 97, 100, ...
var KNOWN = [1, 7, 10, 13, 19, 23, 28, 31, 32, 44, 49, 68, 70, 79, 82, 86, 91, 94, 97, 100];
eq('happy numbers 1..100 match OEIS A007770', H.happyInRange(1, 100), KNOWN);

/* ---- classification of individual numbers -------------------------------- */
ok('7 is happy', H.isHappy(7));
ok('1 is happy', H.isHappy(1));
ok('10 is happy', H.isHappy(10));
ok('4 is unhappy', !H.isHappy(4));
ok('2 is unhappy', !H.isHappy(2));
ok('100 is happy', H.isHappy(100));
ok('99 is unhappy', !H.isHappy(99));

/* ---- trajectories -------------------------------------------------------- */
eq('trajectory of 7 to 1', H.classify(7).trajectory, [7, 49, 97, 130, 10, 1]);
eq('height of 7 is 5', H.classify(7).height, 5);
eq('trajectory of 1 is [1]', H.classify(1).trajectory, [1]);
eq('height of 1 is 0', H.classify(1).height, 0);

var c4 = H.classify(4);
ok('4 classified unhappy', c4.happy === false);
eq('the cycle 4 falls into (canonical order from 4)',
   c4.cycle, [4, 16, 37, 58, 89, 145, 42, 20]);
ok('height of an unhappy number is null', c4.height === null);

/* ---- the deep fact: base 10, power 2 has exactly ONE unhappy cycle --------
 * Check every start 1..2000 and collect the distinct cycles the unhappy ones
 * fall into (as a sorted-set signature). There must be exactly one, and it must
 * be {4,16,20,37,42,58,89,145}.
 */
(function () {
  var sigs = Object.create(null);
  for (var n = 1; n <= 2000; n++) {
    var c = H.classify(n);
    if (!c.happy) {
      var sig = c.cycle.slice().sort(function (a, b) { return a - b; }).join(',');
      sigs[sig] = true;
    }
  }
  var keys = Object.keys(sigs);
  eq('exactly one unhappy cycle for base 10 power 2', keys.length, 1);
  eq('and it is the 8-cycle {4,16,20,37,42,58,89,145}',
     keys[0], '4,16,20,37,42,58,89,145'); // numeric-sorted signature
})();

/* ---- big inputs via the digit-string first step -------------------------- */
// 2^1000 is 302 digits; too big for a Number, must go through firstStepFromDigits.
var big = (2n ** 1000n).toString();
ok('2^1000 (as string) classifies without throwing', typeof H.isHappy(big) === 'boolean');
// A string of ten thousand 1s: first step sums to 10000 -> then 1 -> happy.
var tenK1s = new Array(10001).join('1');
ok('a 10000-digit number of all 1s: first step = 10000', H.firstStepFromDigits(tenK1s, 10, 2) === 10000);
ok('...and it is happy (10000 -> 1)', H.isHappy(tenK1s) === true);
// BigInt input path agrees with the equivalent Number.
eq('BigInt 7n matches Number 7', H.isHappy(7n), H.isHappy(7));
// giant input appears first in its own trajectory (prestepped)
var cb = H.classify(tenK1s);
eq('prestepped trajectory starts with the giant input string', cb.trajectory[0], tenK1s);

/* ---- string parsing, separators and validation --------------------------- */
ok('underscores/commas/spaces tolerated', H.isHappy('1_000_0') === H.isHappy(10000));
eq('leading zeros stripped for display', H.classify('007').input, '7');
throws('empty string throws', function () { H.classify(''); });
throws('non-digit throws', function () { H.classify('12x'); });
throws('digit out of base throws', function () { H.classify('9', { base: 8 }); });
throws('zero is not positive', function () { H.classify(0); });
throws('negative throws', function () { H.classify(-5); });
throws('non-integer throws', function () { H.classify(3.5); });
throws('unsafe Number rejected (use string)', function () { H.classify(Number.MAX_SAFE_INTEGER + 2); });

/* ---- bulk helpers agree with the plain classifier ------------------------ */
(function () {
  var brute = [];
  for (var n = 1; n <= 500; n++) if (H.isHappy(n)) brute.push(n);
  eq('happyInRange(1,500) == brute force', H.happyInRange(1, 500), brute);
  eq('countHappyInRange(1,500) == brute length', H.countHappyInRange(1, 500), brute.length);
  // nthHappy walks the same sequence
  eq('1st happy is 1', H.nthHappy(1), 1);
  eq('2nd happy is 7', H.nthHappy(2), 7);
  eq('19th happy is 97', H.nthHappy(19), 97);
  eq('nthHappy matches the range list', H.nthHappy(brute.length), brute[brute.length - 1]);
})();

/* ---- happy primes -------------------------------------------------------- */
// 7, 13, 19, 23, 31, 79, 97, 103, 109, 139 ... (OEIS A035497)
eq('happy primes below 110',
   H.happyInRange(1, 110).filter(H.isPrime),
   [7, 13, 19, 23, 31, 79, 97, 103, 109]);
ok('7 is a happy prime', H.isHappyPrime(7));
ok('10 is happy but not prime', !H.isHappyPrime(10));
ok('2 is prime but not happy', !H.isHappyPrime(2));

/* ---- generalisations: other bases and powers ----------------------------
 * In base 4, EVERY number is happy (a well-known result). Check a stretch.
 */
(function () {
  var allHappy = true;
  for (var n = 1; n <= 300; n++) if (!H.isHappy(n, { base: 4 })) { allHappy = false; break; }
  ok('every number 1..300 is happy in base 4', allHappy);
})();

// Power 3: "cubic happy" numbers. 1 is happy; the process still terminates.
ok('base 10 power 3 classification is boolean', typeof H.isHappy(5, { power: 3 }) === 'boolean');
// 153 is the famous Armstrong/narcissistic fixed point for power 3
eq('153 is a fixed point under power 3', H.stepNumber(153, 10, 3), 153);
ok('153 is therefore "unhappy" under power 3 (loops at 153, not 1)',
   H.isHappy(153, { power: 3 }) === false);
eq('the cycle for 153 under power 3 is just [153]',
   H.classify(153, { power: 3 }).cycle, [153]);

// base validation
throws('base < 2 throws', function () { H.classify(5, { base: 1 }); });
throws('base > 36 throws', function () { H.classify(5, { base: 37 }); });
throws('power < 1 throws', function () { H.classify(5, { power: 0 }); });

/* ---- summary ------------------------------------------------------------- */
console.log('\n' + (failed === 0 ? 'ALL PASSED' : 'FAILURES') +
            ': ' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
