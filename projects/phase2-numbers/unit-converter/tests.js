/*
 * tests.js — dependency-free suite for converter-core.js. Run with:
 *   node projects/phase2-numbers/unit-converter/tests.js
 *
 * Covers the exact-ratio promise (defined conversions and their reversibility),
 * the affine temperature model (scale + offset, and the absolute-zero guard),
 * the number parser, the terminating-vs-rounded display decision, currency
 * flagging, the error surface, and a batch of property sweeps that check
 * behaviour rather than single points.
 */
'use strict';

var core = require('./converter-core.js');

var passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}
function throws(name, fn) {
  try { fn(); check(name + ' (throws)', false); }
  catch (e) { check(name + ' (throws)', true); }
}

var conv = core.convert;

// display of a conversion
function disp(cat, from, to, v) { return conv(cat, from, to, v).display; }
function eqDisp(cat, from, to, v, expected) {
  var d = disp(cat, from, to, v);
  check(cat + ' ' + v + ' ' + from + '->' + to + ' = ' + expected + ' (got ' + d + ')', d === expected);
}

/* ---------------- number parsing ---------------- */
(function () {
  var p = core.parseNumber;
  check('parse int', core.rEq(p('42'), core.R(42)));
  check('parse decimal', core.rEq(p('0.25'), core.R(1, 4)));
  check('parse .5', core.rEq(p('.5'), core.R(1, 2)));
  check('parse negative', core.rEq(p('-3.5'), core.R(-7, 2)));
  check('parse fraction', core.rEq(p('1/3'), core.R(1, 3)));
  check('parse decimal fraction', core.rEq(p('2.5/0.5'), core.R(5)));
  check('parse exponent', core.rEq(p('1e3'), core.R(1000)));
  check('parse neg exponent', core.rEq(p('2.5e-1'), core.R(1, 4)));
  check('parse underscores', core.rEq(p('1_000'), core.R(1000)));
  throws('parse empty', function () { p('   '); });
  throws('parse junk', function () { p('12.3.4'); });
  throws('parse letters', function () { p('abc'); });
  throws('parse fraction /0', function () { p('1/0'); });
})();

/* ---------------- length: the 2.54 exactness story ---------------- */
eqDisp('length', 'in', 'cm', '1', '2.54');           // exact by definition
eqDisp('length', 'mi', 'km', '1', '1.609344');       // exact
eqDisp('length', 'km', 'mi', '1.609344', '1');       // reverse exact
eqDisp('length', 'ft', 'in', '1', '12');             // 0.3048 / 0.0254 = 12 exactly
eqDisp('length', 'yd', 'ft', '1', '3');
eqDisp('length', 'm', 'cm', '1', '100');
eqDisp('length', 'nmi', 'm', '1', '1852');

/* A float engine would fail this round-trip; the rational one nails it. */
(function () {
  var r = core.convertRational('length', 'mi', 'km', core.R(100));
  var back = core.convertRational('length', 'km', 'mi', r);
  check('100 mi -> km -> mi is exactly 100', core.rEq(back, core.R(100)));
})();

/* ---------------- mass ---------------- */
eqDisp('mass', 'kg', 'g', '1', '1000');
eqDisp('mass', 'lb', 'kg', '1', '0.45359237');       // exact
eqDisp('mass', 'lb', 'oz', '1', '16');               // exact
eqDisp('mass', 'st', 'lb', '1', '14');
eqDisp('mass', 'g', 'mg', '2.5', '2500');

/* ---------------- volume: US gallon is exactly 3.785411784 L ------ */
eqDisp('volume', 'gal', 'L', '1', '3.785411784');
eqDisp('volume', 'gal', 'qt', '1', '4');
eqDisp('volume', 'gal', 'floz', '1', '128');
eqDisp('volume', 'cup', 'floz', '1', '8');
eqDisp('volume', 'L', 'mL', '1', '1000');
eqDisp('volume', 'm3', 'L', '1', '1000');

/* ---------------- area: squares of exact lengths stay exact ------- */
eqDisp('area', 'ha', 'm2', '1', '10000');
eqDisp('area', 'km2', 'ha', '1', '100');
eqDisp('area', 'ft2', 'in2', '1', '144');            // (12 in)^2
eqDisp('area', 'acre', 'yd2', '1', '4840');          // exact by definition

/* ---------------- speed ---------------- */
eqDisp('speed', 'km/h', 'm/s', '3.6', '1');          // 3.6 km/h = 1 m/s exactly
eqDisp('speed', 'm/s', 'km/h', '1', '3.6');
eqDisp('speed', 'knot', 'm/s', '1', '0.514444444444'); // 463/900 -> rounded (repeats)
check('knot->m/s is flagged rounded',
  conv('speed', 'knot', 'm/s', '1').exactDisplay === false);

/* ---------------- time ---------------- */
eqDisp('time', 'h', 's', '1', '3600');
eqDisp('time', 'day', 'h', '1', '24');
eqDisp('time', 'week', 'day', '1', '7');
eqDisp('time', 'min', 'ms', '1', '60000');

/* ---------------- digital storage: decimal vs binary prefixes ----- */
eqDisp('digital', 'B', 'bit', '1', '8');
eqDisp('digital', 'KiB', 'B', '1', '1024');
eqDisp('digital', 'MiB', 'KiB', '1', '1024');
eqDisp('digital', 'GB', 'MB', '1', '1000');
eqDisp('digital', 'GiB', 'B', '1', '1073741824');
eqDisp('digital', 'TB', 'GB', '1', '1000');

/* ---------------- temperature: the affine model ------------------- */
eqDisp('temperature', 'C', 'F', '100', '212');
eqDisp('temperature', 'C', 'F', '0', '32');
eqDisp('temperature', 'C', 'F', '-40', '-40');       // the famous fixed point
eqDisp('temperature', 'F', 'C', '32', '0');
eqDisp('temperature', 'C', 'K', '0', '273.15');
eqDisp('temperature', 'K', 'C', '0', '-273.15');
eqDisp('temperature', 'C', 'R', '0', '491.67');
eqDisp('temperature', 'F', 'K', '32', '273.15');
/* round-trip exactness */
(function () {
  var r = core.convertRational('temperature', 'C', 'F', core.R(37));
  var back = core.convertRational('temperature', 'F', 'C', r);
  check('37C -> F -> C is exactly 37', core.rEq(back, core.R(37)));
})();
/* absolute-zero guard */
throws('below absolute zero (C)', function () { conv('temperature', 'C', 'K', '-300'); });
throws('below absolute zero (F)', function () { conv('temperature', 'F', 'C', '-500'); });
check('0 K is allowed', conv('temperature', 'K', 'C', '0').display === '-273.15');

/* ---------------- currency: flagged approximate ------------------- */
(function () {
  var r = conv('currency', 'USD', 'USD', '10');
  check('USD->USD value is 10', r.display === '10');
  check('currency is flagged not-exact', r.exactValue === false && r.exactDisplay === false);
  check('currency carries a note', typeof r.note === 'string' && r.note.indexOf('offline') !== -1);
})();
(function () {
  // Editable rates: set EUR to exactly 1.10 and check EUR->USD and back.
  core.setRate('EUR', '1.10');
  var toUsd = core.convertRational('currency', 'EUR', 'USD', core.R(100));
  check('100 EUR @1.10 = 110 USD', core.rEq(toUsd, core.R(110)));
  var back = core.convertRational('currency', 'USD', 'EUR', toUsd);
  check('110 USD -> EUR is exactly 100', core.rEq(back, core.R(100)));
})();

/* ---------------- display: terminating vs rounded ---------------- */
(function () {
  // 1/3 m in... use a factor that repeats: 10 m -> (via speed) already covered.
  // Directly exercise formatRational.
  var f1 = core.formatRational(core.R(1, 4));
  check('1/4 shows 0.25 exact', f1.display === '0.25' && f1.exactDisplay);
  var f2 = core.formatRational(core.R(1, 3));
  check('1/3 is rounded', f2.exactDisplay === false && f2.display.indexOf('0.333') === 0);
  var f3 = core.formatRational(core.R(0));
  check('0 formats as 0', f3.display === '0' && f3.exactDisplay);
  var f4 = core.formatRational(core.R(-5, 2));
  check('-5/2 shows -2.5', f4.display === '-2.5' && f4.exactDisplay);
  check('roundSig 2/3 @3 = 0.667', core.roundSig(2n, 3n, 3) === '0.667');
  check('roundSig 1234 @2 = 1200', core.roundSig(1234n, 1n, 2) === '1200');
  check('roundSig small 1/3000 @2', core.roundSig(1n, 3000n, 2) === '0.00033');
})();

/* ---------------- error surface ---------------- */
throws('unknown category', function () { conv('nope', 'a', 'b', '1'); });
throws('unknown from unit', function () { conv('length', 'zzz', 'm', '1'); });
throws('unknown to unit', function () { conv('length', 'm', 'zzz', '1'); });
throws('bad value', function () { conv('length', 'm', 'cm', 'xyz'); });

/* ================================================================== *
 * Property sweeps                                                     *
 * ================================================================== */

/* 1. Reversibility: for every multiplicative category, x -> y -> x is exact. */
(function () {
  var tested = 0;
  Object.keys(core.CATEGORIES).forEach(function (catKey) {
    var cat = core.CATEGORIES[catKey];
    if (cat.kind === 'currency') return; // rates are edited above; skip
    var keys = Object.keys(cat.units);
    for (var a = 0; a < keys.length; a++) {
      for (var b = 0; b < keys.length; b++) {
        var v = core.R((a * 7 + b * 13 + 3), (b + 1)); // some varied rational
        var fwd = core.convertRational(catKey, keys[a], keys[b], v);
        var back = core.convertRational(catKey, keys[b], keys[a], fwd);
        if (!core.rEq(back, v)) {
          check('reversible ' + catKey + ' ' + keys[a] + '<->' + keys[b], false);
        }
        tested++;
      }
    }
  });
  check('reversibility sweep ran (' + tested + ' pairs, all exact)', tested > 100);
})();

/* 2. Transitivity/composition: A->B->C equals A->C directly (multiplicative). */
(function () {
  var cat = 'length';
  var keys = Object.keys(core.CATEGORIES[cat].units);
  var ok = true, n = 0;
  for (var i = 0; i < keys.length; i++) {
    for (var j = 0; j < keys.length; j++) {
      for (var k = 0; k < keys.length; k += 3) {
        var v = core.R(i + j + k + 1, 2);
        var direct = core.convertRational(cat, keys[i], keys[k], v);
        var viaJ = core.convertRational(cat, keys[j], keys[k],
                     core.convertRational(cat, keys[i], keys[j], v));
        if (!core.rEq(direct, viaJ)) ok = false;
        n++;
      }
    }
  }
  check('composition A->B->C == A->C (' + n + ' triples)', ok);
})();

/* 3. Identity: converting a unit to itself returns the input unchanged. */
(function () {
  var ok = true, n = 0;
  Object.keys(core.CATEGORIES).forEach(function (catKey) {
    var cat = core.CATEGORIES[catKey];
    Object.keys(cat.units).forEach(function (u) {
      var v = core.R(n * 3 + 1, 4);
      var r = core.convertRational(catKey, u, u, v);
      if (!core.rEq(r, v)) ok = false;
      n++;
    });
  });
  check('identity conversion is the input (' + n + ' units)', ok);
})();

/* 4. Temperature is affine & monotonic: converting a +1 step in C to F always
 *    adds exactly 9/5, regardless of the starting point. */
(function () {
  var ok = true;
  for (var c = -50; c <= 200; c += 7) {
    var a = core.convertRational('temperature', 'C', 'F', core.R(c));
    var b = core.convertRational('temperature', 'C', 'F', core.R(c + 1));
    if (!core.rEq(core.rSub(b, a), core.R(9, 5))) ok = false;
  }
  check('+1°C is always +9/5 °F (affine slope)', ok);
})();

/* 5. Linearity: converting k*v equals k*(convert v) for multiplicative cats. */
(function () {
  var ok = true, n = 0;
  ['length', 'mass', 'volume', 'digital'].forEach(function (catKey) {
    var keys = Object.keys(core.CATEGORIES[catKey].units);
    for (var i = 0; i < keys.length; i++) {
      var v = core.R(i + 1, 3);
      var k = core.R(5);
      var lhs = core.convertRational(catKey, keys[i], keys[(i + 1) % keys.length], core.rMul(k, v));
      var rhs = core.rMul(k, core.convertRational(catKey, keys[i], keys[(i + 1) % keys.length], v));
      if (!core.rEq(lhs, rhs)) ok = false;
      n++;
    }
  });
  check('convert is linear: f(k·v) = k·f(v) (' + n + ' cases)', ok);
})();

/* ================================================================== */
console.log(passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
