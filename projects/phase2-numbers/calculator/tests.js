/*
 * tests.js — dependency-free suite for calculator-core.js. Run with:
 *   node projects/phase2-numbers/calculator/tests.js
 *
 * Covers the exact-arithmetic promise (the float traps eval falls into),
 * operator precedence and associativity, parentheses, unary minus, the
 * scientific functions and constants, error handling, and a batch of property
 * sweeps that check behaviour rather than single examples.
 */

'use strict';

var core = require('./calculator-core.js');

var passed = 0, failed = 0;

function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}

function ev(expr, opts) { return core.evaluate(expr, opts); }

/* Exact display equals a string. */
function eq(expr, expected) {
  var r;
  try { r = ev(expr); }
  catch (e) { check(expr + ' == ' + expected, false); console.error('    threw: ' + e.message); return; }
  check(expr + ' -> ' + expected + ' (got ' + r.display + ')', r.display === expected);
}

function isExact(expr, yes) {
  var r = ev(expr);
  check(expr + ' exact=' + yes, r.exact === yes);
}

function approxNear(expr, target, eps) {
  var r = ev(expr);
  check(expr + ' ~ ' + target, Math.abs(r.float - target) < (eps || 1e-9));
}

function throws(expr, fragment) {
  try { ev(expr); check(expr + ' throws', false); }
  catch (e) {
    check(expr + ' throws (' + (fragment || '') + ')',
      fragment ? e.message.indexOf(fragment) !== -1 : true);
  }
}

/* ---- The headline: exact arithmetic where eval / float lie ---- */

eq('0.1 + 0.2', '0.3');                     // eval => 0.30000000000000004
eq('0.3 - 0.2', '0.1');                     // eval => 0.09999999999999998
eq('0.1 + 0.2 - 0.3', '0');
eq('1/3 * 3', '1');                         // exact third times three is one
eq('2 ^ 100', '1267650600228229401496703205376');
eq('10 ^ -3', '0.001');
eq('(1/3 + 1/6) * 2', '1');
isExact('0.1 + 0.2', true);
isExact('2 ^ 64', true);

/* A non-terminating exact value: shown as a fraction, with a rounded decimal. */
(function () {
  var r = ev('1/3');
  check('1/3 exact', r.exact === true);
  check('1/3 display is fraction', r.display === '1/3');
  check('1/3 terminates=false', r.terminates === false);
  check('1/3 rounded', r.rounded === '0.333333333333');
})();
(function () {
  var r = ev('2/7', { places: 6 });
  check('2/7 fraction', r.fraction === '2/7');
  check('2/7 rounded to 6', r.rounded === '0.285714');
})();

/* ---- Precedence, associativity, parentheses, unary ---- */

eq('1 + 2 * 3', '7');
eq('(1 + 2) * 3', '9');
eq('2 ^ 3 ^ 2', '512');                     // right-assoc: 2^(3^2) = 2^9
eq('-2 ^ 2', '-4');                          // unary binds looser than ^: -(2^2)
eq('(-2) ^ 2', '4');
eq('- - 5', '5');
eq('2 - - 3', '5');
eq('10 % 3', '1');
eq('10 / 4', '2.5');
eq('7 % 3 + 1', '2');
eq('100 - 5 * 2 ^ 3', '60');
eq('3 * (4 + 5) / 2', '13.5');

/* ---- Scientific functions & constants (approximate, flagged) ---- */

isExact('sqrt(2)', false);
approxNear('sqrt(2)', Math.SQRT2);
approxNear('sqrt(16)', 4);
approxNear('sin(0)', 0);
approxNear('cos(0)', 1);
approxNear('ln(e)', 1);
approxNear('log(1000)', 3);
approxNear('exp(1)', Math.E);
approxNear('pi', Math.PI);
approxNear('2 * pi', 2 * Math.PI);
approxNear('sqrt(2) ^ 2', 2, 1e-9);
eq('abs(-3/4)', '0.75');                     // abs stays exact
isExact('abs(-5)', true);
approxNear('sqrt(9) + 1', 4);                // float propagates through +

/* ---- Errors ---- */

throws('', 'Enter an expression');
throws('1 /', 'Unexpected end');
throws('1 / 0', 'Division by zero');
throws('(1 + 2', 'Missing closing');
throws('1 + )', 'Unexpected');
throws('2 ** 3', 'Unexpected');
throws('1.2.3', 'decimal point');
throws('sqrt(-1)', 'negative');
throws('ln(0)', 'positive');
throws('nope(2)', 'Unknown function');
throws('x + 1', 'Unknown name');
throws('5 % 0', 'Modulo by zero');
throws('2 @ 3', 'Unexpected character');

/* ---- Property sweeps: behaviour, not single points ---- */

// (a) a/b then *b returns exactly a, for a range of integers.
(function () {
  var ok = true;
  for (var a = -20; a <= 20; a++) {
    for (var b = 1; b <= 12; b++) {
      var r = ev('(' + a + '/' + b + ') * ' + b);
      if (!r.exact || r.display !== String(a)) { ok = false; break; }
    }
    if (!ok) break;
  }
  check('sweep: (a/b)*b === a exactly', ok);
})();

// (b) distributivity: (i+j)*k === i*k + j*k, exactly, over a grid.
(function () {
  var ok = true;
  for (var i = -6; i <= 6 && ok; i++)
    for (var j = -6; j <= 6 && ok; j++)
      for (var k = -6; k <= 6; k++) {
        var lhs = ev('(' + i + '+' + j + ')*' + k).display;
        var rhs = ev(i + '*' + k + '+' + j + '*' + k).display;
        if (lhs !== rhs) { ok = false; break; }
      }
  check('sweep: distributivity holds exactly', ok);
})();

// (c) sum of 1/2^k for k=1..n equals 1 - 1/2^n exactly.
(function () {
  var ok = true;
  for (var n = 1; n <= 30; n++) {
    var terms = [];
    for (var k = 1; k <= n; k++) terms.push('1/2^' + k);
    var r = ev(terms.join(' + '));
    var want = ev('1 - 1/2^' + n);
    if (r.display !== want.display) { ok = false; break; }
  }
  check('sweep: geometric series 1/2^k sums exactly', ok);
})();

// (d) exactDecimal round-trips: a terminating value re-parses to itself.
(function () {
  var ok = true;
  var samples = ['0.5', '0.25', '0.125', '3.14', '2.5', '0.001', '12.34', '-7.75'];
  for (var s = 0; s < samples.length; s++) {
    var r = ev(samples[s]);
    if (!r.exact || r.display !== (samples[s][0] === '-' ? samples[s] : samples[s].replace(/^0+(?=\d)/, ''))) {
      // normalise leading zero comparison
      if (r.display !== Number(samples[s]).toString() && r.display !== samples[s]) { ok = false; break; }
    }
  }
  check('sweep: terminating decimals display cleanly', ok);
})();

/* ---- Report ---- */

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
