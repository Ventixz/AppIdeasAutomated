/*
 * tests.js — dependency-free suite for complex-core.js. Run with:
 *   node projects/phase2-numbers/complex-number-algebra/tests.js
 *
 * Complex algebra is a floating-point problem (moduli, arguments and roots are
 * irrational in general), so the suite checks *identities* rather than bit-exact
 * values: parsing round-trips, the field axioms (commutativity, associativity,
 * distributivity), div being the true inverse of mul, the numerically hard cases
 * where the schoolbook division formula overflows but Smith's does not, sqrt and
 * nth roots actually raising back to their argument, and De Moivre / Euler
 * identities landing where they should.
 */

'use strict';

var K = require('./complex-core.js');
var C = K.C;

var passed = 0, failed = 0;

function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}
function eq(name, got, want) {
  if (got === want) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + ' (got ' + JSON.stringify(String(got)) + ', want ' + JSON.stringify(String(want)) + ')'); }
}
function near(name, a, b, tol) {
  ok(name, K.equals(a, b, tol === undefined ? 1e-9 : tol));
}
function throws(name, fn) {
  try { fn(); failed++; console.error('  FAIL: ' + name + ' (expected throw)'); }
  catch (e) { passed++; }
}

/* ---- parse --------------------------------------------------------------- */
near('parse "3+4i"', K.parse('3+4i'), C(3, 4));
near('parse "3 - 4i" (spaces)', K.parse('3 - 4i'), C(3, -4));
near('parse "-2-3i"', K.parse('-2-3i'), C(-2, -3));
near('parse bare real "5"', K.parse('5'), C(5, 0));
near('parse bare imag "4i"', K.parse('4i'), C(0, 4));
near('parse "i" is 1i', K.parse('i'), C(0, 1));
near('parse "-i" is -1i', K.parse('-i'), C(0, -1));
near('parse "+i" is 1i', K.parse('+i'), C(0, 1));
near('parse imag-first "4i+3"', K.parse('4i+3'), C(3, 4));
near('parse engineer j', K.parse('2-3j'), C(2, -3));
near('parse decimals', K.parse('2.5-1.5i'), C(2.5, -1.5));
near('parse exponent', K.parse('2.5e-3 + 1.5e2i'), C(0.0025, 150));
near('parse underscores/spaces stripped', K.parse(' 1_000 + 2i '), C(1000, 2));
near('parse unicode minus', K.parse('3−4i'), C(3, -4));
near('parse zero', K.parse('0'), C(0, 0));
throws('parse rejects empty', function () { K.parse(''); });
throws('parse rejects whitespace only', function () { K.parse('   '); });
throws('parse rejects junk', function () { K.parse('12x'); });
throws('parse rejects bad unit', function () { K.parse('3+4k'); });
throws('parse rejects trailing sign', function () { K.parse('3+'); });
throws('parse rejects non-string', function () { K.parse(3); });

/* ---- format -------------------------------------------------------------- */
eq('format real', K.format(C(3, 0)), '3');
eq('format pure imag', K.format(C(0, 4)), '4i');
eq('format i coefficient 1 dropped', K.format(C(0, 1)), 'i');
eq('format -i', K.format(C(0, -1)), '-i');
eq('format a+bi', K.format(C(3, 4)), '3 + 4i');
eq('format a-bi', K.format(C(3, -4)), '3 - 4i');
eq('format zero', K.format(C(0, 0)), '0');
eq('format -0 shows 0', K.format(C(-0, -0)), '0');
eq('format rounds for display', K.format(C(3.14159265, 0), 4), '3.142');
eq('format drops tiny noise', K.format(C(2, 1e-15)), '2');
// Parse ∘ format round trip on a handful of values.
(function () {
  var vals = [C(3, 4), C(-2, -3), C(5, 0), C(0, -7), C(1.5, -0.25)];
  var round = vals.every(function (z) { return K.equals(K.parse(K.format(z)), z, 1e-6); });
  ok('parse(format(z)) == z', round);
})();

/* ---- basic algebra ------------------------------------------------------- */
near('add', K.add(C(3, 4), C(1, -2)), C(4, 2));
near('sub', K.sub(C(3, 4), C(1, -2)), C(2, 6));
near('mul (3+4i)(1-2i)', K.mul(C(3, 4), C(1, -2)), C(11, -2));
near('mul i*i = -1', K.mul(C(0, 1), C(0, 1)), C(-1, 0));
near('div (11-2i)/(1-2i) = 3+4i', K.div(C(11, -2), C(1, -2)), C(3, 4));
near('conj', K.conj(C(3, 4)), C(3, -4));
near('neg', K.neg(C(3, -4)), C(-3, 4));
ok('abs 3+4i = 5', Math.abs(K.abs(C(3, 4)) - 5) < 1e-12);
ok('abs2 3+4i = 25', Math.abs(K.abs2(C(3, 4)) - 25) < 1e-12);
ok('arg of i = π/2', Math.abs(K.arg(C(0, 1)) - Math.PI / 2) < 1e-12);
ok('arg of -1 = π', Math.abs(K.arg(C(-1, 0)) - Math.PI) < 1e-12);
throws('div by zero throws', function () { K.div(C(1, 1), C(0, 0)); });
throws('add rejects non-finite', function () { K.add(C(Infinity, 0), C(1, 1)); });

/* ---- field axioms over a random sweep ------------------------------------ */
(function () {
  // Deterministic pseudo-random so the run is reproducible.
  var seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 20 - 10; }
  var comm = true, assoc = true, dist = true, divInv = true, conjMul = true;
  for (var i = 0; i < 500; i++) {
    var a = C(rnd(), rnd()), b = C(rnd(), rnd()), c = C(rnd(), rnd());
    if (!K.equals(K.add(a, b), K.add(b, a), 1e-9)) comm = false;
    if (!K.equals(K.mul(a, b), K.mul(b, a), 1e-7)) comm = false;
    if (!K.equals(K.mul(K.mul(a, b), c), K.mul(a, K.mul(b, c)), 1e-6)) assoc = false;
    if (!K.equals(K.mul(a, K.add(b, c)), K.add(K.mul(a, b), K.mul(a, c)), 1e-6)) dist = false;
    // (a*b)/b == a  when b != 0
    if (K.abs(b) > 1e-6 && !K.equals(K.div(K.mul(a, b), b), a, 1e-6)) divInv = false;
    // conj(a*b) == conj(a)*conj(b)
    if (!K.equals(K.conj(K.mul(a, b)), K.mul(K.conj(a), K.conj(b)), 1e-7)) conjMul = false;
  }
  ok('addition & multiplication commute', comm);
  ok('multiplication is associative', assoc);
  ok('multiplication distributes over addition', dist);
  ok('(a·b)/b = a (div inverts mul)', divInv);
  ok('conj(a·b) = conj(a)·conj(b)', conjMul);
})();

/* ---- z · conj(z) = |z|² (real) ------------------------------------------- */
(function () {
  var z = C(3, -4);
  var p = K.mul(z, K.conj(z));
  ok('z·conj(z) is real', Math.abs(p.im) < 1e-12);
  ok('z·conj(z) = |z|²', Math.abs(p.re - K.abs2(z)) < 1e-9);
})();

/* ---- Smith division survives extreme scale ------------------------------- */
(function () {
  // Schoolbook (ac+bd)/(c²+d²) overflows: (1e200)² = Infinity. Smith's does not.
  var big = K.div(C(1e200, 1e200), C(1e200, 1e200)); // == 1
  near('div of huge / huge = 1 (no overflow)', big, C(1, 0), 1e-9);
  var small = K.div(C(1e-200, 1e-200), C(1e-200, 1e-200)); // == 1
  near('div of tiny / tiny = 1 (no underflow)', small, C(1, 0), 1e-9);
  // A concrete correct quotient at extreme scale.
  near('div (2e200+0i)/(1e200+0i) = 2', K.div(C(2e200, 0), C(1e200, 0)), C(2, 0), 1e-9);
})();
// modulus does not overflow either
ok('abs(1e200+1e200i) is finite and ~1.414e200',
   Math.abs(K.abs(C(1e200, 1e200)) - Math.SQRT2 * 1e200) < 1e191);

/* ---- powers -------------------------------------------------------------- */
near('powInt (1+i)^2 = 2i', K.powInt(C(1, 1), 2), C(0, 2));
near('powInt i^4 = 1', K.powInt(C(0, 1), 4), C(1, 0));
near('powInt z^0 = 1', K.powInt(C(3, -4), 0), C(1, 0));
near('powInt negative: z^-1 = 1/z', K.powInt(C(3, 4), -1), K.div(C(1, 0), C(3, 4)));
near('powInt z^-2 = 1/z²', K.powInt(C(1, 2), -2), K.div(C(1, 0), K.powInt(C(1, 2), 2)));
throws('powInt rejects non-integer', function () { K.powInt(C(1, 1), 2.5); });
// De Moivre: (cosθ + i sinθ)^n = cos(nθ) + i sin(nθ)
(function () {
  var th = 0.7, n = 5;
  near('De Moivre', K.powInt(K.fromPolar(1, th), n), K.fromPolar(1, n * th), 1e-9);
})();
near('powReal (matches powInt on integers)', K.powReal(C(1, 1), 3), K.powInt(C(1, 1), 3), 1e-9);

/* ---- sqrt & nth roots (the "points on a plane" payoff) ------------------- */
near('sqrt(-1) = i', K.sqrt(C(-1, 0)), C(0, 1));
near('sqrt(2i) = 1+i', K.sqrt(C(0, 2)), C(1, 1));
(function () {
  // sqrt(z)² == z for a sweep, including the numerically hard negative-real axis.
  var vals = [C(3, 4), C(-5, 0), C(-5, 1e-8), C(0, 0), C(1e-6, -2e-6), C(1e100, -1e100)];
  var good = vals.every(function (z) { return K.equals(K.powInt(K.sqrt(z), 2), z, 1e-6 * (1 + K.abs(z))); });
  ok('sqrt(z)² = z over a sweep (incl. near −ℝ axis)', good);
})();
(function () {
  // Every one of the n nth-roots, raised to the n, returns the original.
  var z = C(3, -4), n = 5;
  var roots = K.nthRoots(z, n);
  ok('nthRoots returns n roots', roots.length === n);
  var allBack = roots.every(function (w) { return K.equals(K.powInt(w, n), z, 1e-8); });
  ok('each nth root^n = z', allBack);
  // The n roots are distinct and share one modulus.
  var r0 = K.abs(roots[0]);
  ok('all roots share |·| = |z|^{1/n}', roots.every(function (w) { return Math.abs(K.abs(w) - r0) < 1e-9; }));
  // Their sum is ~0 for n >= 2 (roots of z^n - z are symmetric about origin).
  var s = roots.reduce(function (acc, w) { return K.add(acc, w); }, C(0, 0));
  ok('sum of the n roots ≈ 0', K.equals(s, C(0, 0), 1e-8));
})();
near('cube roots of 1 include 1', K.nthRoots(C(1, 0), 3)[0], C(1, 0), 1e-12);
throws('nthRoots rejects n<1', function () { K.nthRoots(C(1, 0), 0); });

/* ---- exp / log ----------------------------------------------------------- */
near('exp(0) = 1', K.exp(C(0, 0)), C(1, 0));
near('Euler: exp(iπ) = -1', K.exp(C(0, Math.PI)), C(-1, 0), 1e-12);
near('exp(iπ/2) = i', K.exp(C(0, Math.PI / 2)), C(0, 1), 1e-12);
(function () {
  var vals = [C(1, 1), C(-2, 0.5), C(0, 3), C(2, -1)];
  var good = vals.every(function (z) { return K.equals(K.log(K.exp(z)), z, 1e-9); });
  ok('log(exp(z)) = z (principal strip)', good);
})();
near('exp(log(z)) = z', K.exp(K.log(C(3, -4))), C(3, -4), 1e-9);

/* ---- compute() (what the UI calls) --------------------------------------- */
(function () {
  var r = K.compute('multiply', C(3, 4), C(1, -2));
  near('compute multiply result', r.result, C(11, -2));
  eq('compute resultStr', r.resultStr, '11 - 2i');
  ok('compute exposes 1 point for binary op', r.points.length === 1);
  ok('compute polar modulus', Math.abs(r.polar.r - K.abs(C(11, -2))) < 1e-9);

  var rr = K.compute('roots', C(1, 0), 4);
  ok('compute roots returns n points', rr.points.length === 4);

  var rc = K.compute('conjugate', C(3, 4));
  near('compute conjugate', rc.result, C(3, -4));
  var rrec = K.compute('reciprocal', C(0, 2));
  near('compute reciprocal 1/(2i) = -0.5i', rrec.result, C(0, -0.5));
  throws('compute rejects unknown op', function () { K.compute('nope', C(1, 1)); });
})();

/* ---- report -------------------------------------------------------------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed === 0 ? 0 : 1);
