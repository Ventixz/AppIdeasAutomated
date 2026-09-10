/*
 * tests.js — dependency-free suite for converter-core.js.
 * Run with:  node projects/phase2-numbers/binary-decimal-converter/tests.js
 */

'use strict';

var core = require('./converter-core.js');

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + name); }
}
function eq(name, got, want) {
  ok(name + ' (got ' + got + ', want ' + want + ')', String(got) === String(want));
}

/* --- Binary -> decimal, integers ----------------------------------------- */

eq('binToDec 0', core.binToDec('0'), '0');
eq('binToDec 1', core.binToDec('1'), '1');
eq('binToDec 1101', core.binToDec('1101'), '13');
eq('binToDec 11111111', core.binToDec('11111111'), '255');
eq('binToDec leading zeros', core.binToDec('0001101'), '13');
eq('binToDec +1010', core.binToDec('+1010'), '10');
eq('binToDec -1010', core.binToDec('-1010'), '-10');
eq('binToDec -0 is 0', core.binToDec('-0'), '0');

/* --- Binary -> decimal, fractions (always exact) ------------------------- */

eq('binToDec 0.1 = 0.5', core.binToDec('0.1'), '0.5');
eq('binToDec 0.01 = 0.25', core.binToDec('0.01'), '0.25');
eq('binToDec 0.11 = 0.75', core.binToDec('0.11'), '0.75');
eq('binToDec 1101.01 = 13.25', core.binToDec('1101.01'), '13.25');
eq('binToDec .101 = 0.625', core.binToDec('.101'), '0.625');
eq('binToDec 0.001 = 0.125', core.binToDec('0.001'), '0.125');
// A long fraction: 1/2^10 = 0.0009765625, exact to the last digit.
eq('binToDec 0.0000000001', core.binToDec('0.0000000001'), '0.0009765625');

/* --- The precision trap: past 2^53, parseInt is wrong, BigInt is not ----- */

// 2^60 exactly. parseInt('1'+'0'*60, 2) returns 1152921504606847000 (wrong).
eq('binToDec 2^60 exact', core.binToDec('1' + '0'.repeat(60)),
   (2n ** 60n).toString());
// A 128-bit all-ones number = 2^128 - 1.
eq('binToDec 128 ones', core.binToDec('1'.repeat(128)),
   (2n ** 128n - 1n).toString());

/* --- Decimal -> binary, integers ----------------------------------------- */

eq('decToBin 0', core.decToBin('0').binary, '0');
eq('decToBin 13', core.decToBin('13').binary, '1101');
eq('decToBin 255', core.decToBin('255').binary, '11111111');
eq('decToBin -10', core.decToBin('-10').binary, '-1010');
ok('decToBin 13 is exact', core.decToBin('13').exact === true);
// Big integer, well past a float's reach.
eq('decToBin 2^100', core.decToBin((2n ** 100n).toString()).binary,
   '1' + '0'.repeat(100));

/* --- Decimal -> binary, terminating fractions ---------------------------- */

eq('decToBin 0.5', core.decToBin('0.5').binary, '0.1');
eq('decToBin 0.25', core.decToBin('0.25').binary, '0.01');
eq('decToBin 0.75', core.decToBin('0.75').binary, '0.11');
eq('decToBin 13.25', core.decToBin('13.25').binary, '1101.01');
eq('decToBin 0.625', core.decToBin('0.625').binary, '0.101');
ok('decToBin 0.25 is exact', core.decToBin('0.25').exact === true);

/* --- Decimal -> binary, NON-terminating fraction: rounds and says so ----- */

var tenth = core.decToBin('0.1', 8);
ok('decToBin 0.1 is not exact', tenth.exact === false);
// 0.1 -> 0.00011001100... ; to 8 bits, rounded to nearest -> 0.00011010.
eq('decToBin 0.1 to 8 bits (rounded)', tenth.binary, '0.0001101');

// A case where rounding carries all the way out of the fraction into the
// integer: 0.99999 to 1 bit should round up to 1.0 -> "1".
var carry = core.decToBin('0.9', 1);
ok('decToBin 0.9 to 1 bit not exact', carry.exact === false);
eq('decToBin 0.9 to 1 bit rounds to 1', carry.binary, '1');

// Zero fraction bits requested: pure truncation of any fraction, flagged.
var zero = core.decToBin('0.6', 0);
ok('decToBin 0.6 to 0 bits not exact', zero.exact === false);

/* --- incBinary helper ---------------------------------------------------- */

eq('incBinary 0', core.incBinary('0'), '1');
eq('incBinary 1', core.incBinary('1'), '10');
eq('incBinary 111', core.incBinary('111'), '1000');
eq('incBinary 1010', core.incBinary('1010'), '1011');

/* --- Validation: bad input is rejected, not silently mangled ------------- */

['', '.', '2', '12', 'abc', '1..0', '1.0.1', '0x10', '1 0'].forEach(function (bad) {
  var threw = false;
  try { core.binToDec(bad); } catch (e) { threw = true; }
  ok('binToDec rejects "' + bad + '"', threw);
});
['', '.', 'ff', '1.2.3', '1e3', '0b1', '-'].forEach(function (bad) {
  var threw = false;
  try { core.decToBin(bad); } catch (e) { threw = true; }
  ok('decToBin rejects "' + bad + '"', threw);
});

/* --- Property sweep: integers round-trip both ways ----------------------- */

var allInts = true;
for (var n = 0; n <= 2000; n++) {
  var bin = core.decToBin(String(n)).binary;
  if (core.binToDec(bin) !== String(n)) { allInts = false; break; }
}
ok('every integer 0..2000 round-trips dec->bin->dec', allInts);

// Randomised big integers (up to ~2^160), exact both directions.
var allBig = true;
for (var t = 0; t < 500; t++) {
  var v = 0n;
  var bitLen = 1 + Math.floor(Math.random() * 160);
  for (var b = 0; b < bitLen; b++) v = v * 2n + BigInt(Math.random() < 0.5 ? 0 : 1);
  var s = v.toString();
  var roundBin = core.decToBin(s).binary;
  if (core.binToDec(roundBin) !== s) { allBig = false; break; }
}
ok('500 random big integers round-trip exactly', allBig);

/* --- Property sweep: terminating binary fractions round-trip exactly ----- */

// Any k-bit binary fraction has a finite decimal form, which converts back to
// the same k-bit binary fraction. Check every 6-bit fraction.
var allFrac = true;
for (var f = 0; f < 64; f++) {
  var frbits = f.toString(2).padStart(6, '0');
  var binF = '0.' + frbits;
  var dec = core.binToDec(binF);
  var back = core.decToBin(dec, 64);
  if (!back.exact) { allFrac = false; break; }
  // Compare on value by converting back to decimal again.
  if (core.binToDec(back.binary) !== dec) { allFrac = false; break; }
}
ok('every 6-bit binary fraction round-trips exactly', allFrac);

/* ------------------------------------------------------------------------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed === 0 ? 0 : 1);
