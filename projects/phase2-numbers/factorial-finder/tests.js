/*
 * tests.js — dependency-free suite for factorial-core.js. Run with:
 *   node projects/phase2-numbers/factorial-finder/tests.js
 *
 * The core is exact BigInt arithmetic, so the whole suite runs without a browser
 * or a network: input parsing and validation, the loop and the recursion agreeing
 * with the fast product-tree method over a sweep, the defining recurrence
 * (n+1)! = (n+1)·n!, Legendre's trailing-zero count checked against the real
 * trailing zeros of the computed number, the log-sum digit count checked against
 * the real digit length, and the inverse recognising exactly the factorials.
 */

'use strict';

var F = require('./factorial-core.js');

var passed = 0, failed = 0;

function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}
function eq(name, got, want) {
  if (got === want) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + ' (got ' + JSON.stringify(String(got)) + ', want ' + JSON.stringify(String(want)) + ')'); }
}
function throws(name, fn) {
  try { fn(); failed++; console.error('  FAIL: ' + name + ' (expected throw)'); }
  catch (e) { passed++; }
}

/* ---- parseCount ---------------------------------------------------------- */
eq('parseCount plain', F.parseCount('20'), 20);
eq('parseCount strips commas', F.parseCount('1,000'), 1000);
eq('parseCount strips spaces/underscores', F.parseCount('  1_000 '), 1000);
eq('parseCount zero', F.parseCount('0'), 0);
eq('parseCount leading zeros', F.parseCount('007'), 7);
throws('parseCount rejects decimal', function () { F.parseCount('3.5'); });
throws('parseCount rejects negative', function () { F.parseCount('-4'); });
throws('parseCount rejects junk', function () { F.parseCount('12x'); });
throws('parseCount rejects empty', function () { F.parseCount(''); });
throws('parseCount rejects non-string', function () { F.parseCount(20); });
throws('parseCount rejects unsafe magnitude', function () { F.parseCount('9007199254740993'); });

/* ---- checkCount ---------------------------------------------------------- */
throws('checkCount rejects negative', function () { F.factorialLoop(-1); });
throws('checkCount rejects non-integer', function () { F.factorialLoop(3.5); });
throws('checkCount rejects non-number', function () { F.factorialLoop('5'); });

/* ---- known values -------------------------------------------------------- */
eq('0! = 1', F.factorialLoop(0), 1n);
eq('1! = 1', F.factorialLoop(1), 1n);
eq('2! = 2', F.factorialLoop(2), 2n);
eq('5! = 120', F.factorialLoop(5), 120n);
eq('10! = 3628800', F.factorialLoop(10), 3628800n);
eq('13! past 32-bit', F.factorialLoop(13), 6227020800n);
// 20! is the largest factorial below 2^64; 21! overflows it. Exactness matters:
eq('20! exact', F.factorialLoop(20), 2432902008176640000n);
eq('21! exact (past 2^64)', F.factorialLoop(21), 51090942171709440000n);
// 100! — 158 digits a float renders only as 9.33e157.
eq('100! digit length', String(F.factorialLoop(100)).length, 158);
ok('100! ends in known 24 zeros',
   /000000000000000000000000$/.test(String(F.factorialLoop(100))));

/* ---- loop == recursion == fast, over a sweep ----------------------------- */
(function () {
  var allAgree = true;
  for (var n = 0; n <= 300; n++) {
    var a = F.factorialLoop(n);
    var b = F.factorialRecursive(n);
    var c = F.factorialFast(n);
    if (a !== b || a !== c) { allAgree = false; break; }
  }
  ok('loop, recursion and fast agree for 0..300', allAgree);
})();

/* ---- the fast method still agrees at larger n where it matters ------------ */
(function () {
  var bigN = 5000;
  ok('fast == loop at n=5000', F.factorialFast(bigN) === F.factorialLoop(bigN));
})();

/* ---- the defining recurrence (n+1)! = (n+1) * n! ------------------------- */
(function () {
  var holds = true;
  var f = 1n;
  for (var n = 0; n <= 500; n++) {
    if (F.factorialLoop(n) !== f) { holds = false; break; }
    f = f * BigInt(n + 1); // becomes (n+1)!
  }
  ok('recurrence (n+1)! = (n+1)*n! holds 0..500', holds);
})();

/* ---- factorial is strictly increasing from n=2 up ------------------------ */
(function () {
  var mono = true, prev = F.factorialLoop(2);
  for (var n = 3; n <= 400; n++) {
    var cur = F.factorialLoop(n);
    if (!(cur > prev)) { mono = false; break; }
    prev = cur;
  }
  ok('n! strictly increasing for n>=2', mono);
})();

/* ---- recursion guard ----------------------------------------------------- */
ok('recursion allowed at the limit',
   F.factorialRecursive(F.RECURSION_LIMIT) === F.factorialLoop(F.RECURSION_LIMIT));
throws('recursion refuses past the limit',
   function () { F.factorialRecursive(F.RECURSION_LIMIT + 1); });

/* ---- trailing zeros: Legendre vs the real number ------------------------- */
eq('tz(4) = 0', F.trailingZeros(4), 0);
eq('tz(5) = 1', F.trailingZeros(5), 1);
eq('tz(25) = 6', F.trailingZeros(25), 6);   // 5,10,15,20,25 give six 5s (25 twice)
eq('tz(100) = 24', F.trailingZeros(100), 24);
eq('tz(1000) = 249', F.trailingZeros(1000), 249);
(function () {
  // The whole point: Legendre must equal the real count of trailing '0's.
  var match = true;
  for (var n = 0; n <= 400; n++) {
    var s = String(F.factorialLoop(n));
    var real = 0;
    for (var i = s.length - 1; i >= 0 && s.charAt(i) === '0'; i--) real++;
    if (real !== F.trailingZeros(n)) { match = false; break; }
  }
  ok('Legendre trailing zeros match the real number, 0..400', match);
})();

/* ---- digit count: log sum vs the real length ----------------------------- */
(function () {
  var match = true, offBy = 0;
  for (var n = 0; n <= 600; n++) {
    var real = String(F.factorialLoop(n)).length;
    if (F.digitCount(n) !== real) { match = false; offBy = n; break; }
  }
  ok('log-sum digit count matches real length, 0..600', match);
  if (!match) console.error('    first mismatch at n=' + offBy);
})();
eq('digitCount(0) = 1', F.digitCount(0), 1);
eq('digitCount(1) = 1', F.digitCount(1), 1);

/* ---- inverse factorial --------------------------------------------------- */
eq('inverse of 1 is 1', F.inverseFactorial(1n), 1);
eq('inverse of 2 is 2', F.inverseFactorial(2n), 2);
eq('inverse of 120 is 5', F.inverseFactorial(120n), 5);
eq('inverse of 3628800 is 10', F.inverseFactorial(3628800n), 10);
eq('inverse accepts a string', F.inverseFactorial('720'), 6);
eq('inverse accepts commas', F.inverseFactorial('3,628,800'), 10);
ok('inverse of a non-factorial is null', F.inverseFactorial(121n) === null);
ok('inverse of 100 (between 4! and 5!) is null', F.inverseFactorial(100n) === null);
ok('inverse of 0 is null', F.inverseFactorial(0n) === null);
ok('inverse of junk is null', F.inverseFactorial('12x') === null);
(function () {
  // Round trip: inverseFactorial(n!) === n for every n (n=0 maps to canonical 1).
  var round = true;
  for (var n = 1; n <= 200; n++) {
    if (F.inverseFactorial(F.factorialLoop(n)) !== n) { round = false; break; }
  }
  ok('inverseFactorial(n!) === n for 1..200', round);
})();

/* ---- describe() ---------------------------------------------------------- */
(function () {
  var d = F.describe(10);
  eq('describe valueStr', d.valueStr, '3628800');
  eq('describe exactDigits', d.exactDigits, 7);
  eq('describe estimatedDigits matches', d.estimatedDigits, 7);
  eq('describe trailingZeros', d.trailingZeros, 2);
})();

/* ---- report -------------------------------------------------------------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed === 0 ? 0 : 1);
