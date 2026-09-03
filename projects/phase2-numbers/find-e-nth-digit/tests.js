/*
 * tests.js — dependency-free test suite for e-core.js.
 * Run with:  node projects/phase2-numbers/find-e-nth-digit/tests.js
 */

'use strict';

const { eSeriesScaled, eScaledInteger, eString, nthDigit } = require('./e-core');

let passed = 0;
let failed = 0;

function eq(actual, expected, label) {
  const a = String(actual);
  const e = String(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function throws(fn, label) {
  try {
    fn();
    failed++;
    console.error(`FAIL: ${label} — expected an error but none was thrown`);
  } catch (_) {
    passed++;
  }
}

// A long, known-correct reference for e (first 100 digits after the point).
// Source: the standard decimal expansion of Euler's number.
const E_100 =
  '2.71828182845904523536028747135266249775724709369995' +
  '95749669676277240766303535475945713821785251664274';

// ---- eString: matches the reference at many lengths ---------------------
for (const d of [0, 1, 2, 5, 10, 15, 20, 30, 50, 75, 100]) {
  const expected = d === 0 ? '2' : E_100.slice(0, d + 2); // "2." + d digits
  eq(eString(d), expected, `eString(${d})`);
}

// ---- Specific well-known values -----------------------------------------
eq(eString(0), '2', 'eString(0) is the bare integer part');
eq(eString(1), '2.7', 'eString(1)');
eq(eString(2), '2.71', 'eString(2)');
eq(eString(5), '2.71828', 'eString(5)');
eq(eString(10), '2.7182818284', 'eString(10)');
// The charming "2.7 1828 1828" — the 1828 block repeats — then 45 90 45...
eq(eString(9), '2.718281828', 'eString(9) shows the repeated 1828 block');

// ---- eScaledInteger: exact integers -------------------------------------
eq(eScaledInteger(0), 2n, 'eScaledInteger(0)');
eq(eScaledInteger(5), 271828n, 'eScaledInteger(5)');
eq(eScaledInteger(10), 27182818284n, 'eScaledInteger(10)');

// The scaled integer must have exactly digits+1 characters (leading '2').
eq(eScaledInteger(50).toString().length, 51, 'eScaledInteger(50) length');
eq(eScaledInteger(200).toString().length, 201, 'eScaledInteger(200) length');

// ---- nthDigit: 1-indexed single digits ----------------------------------
// N=1 is the '2'; N=2 is the first decimal, etc. Cross-check against E_100
// with its decimal point removed: "271828...".
const E_DIGITS = E_100.replace('.', '');
for (const n of [1, 2, 3, 4, 5, 6, 10, 33, 50, 100]) {
  eq(nthDigit(n), E_DIGITS[n - 1], `nthDigit(${n})`);
}
eq(nthDigit(1), '2', 'nthDigit(1) is 2');
eq(nthDigit(2), '7', 'nthDigit(2) is 7');
eq(nthDigit(3), '1', 'nthDigit(3) is 1');
eq(nthDigit(4), '8', 'nthDigit(4) is 8');

// ---- eSeriesScaled sanity -----------------------------------------------
// Σ 1/k! == e, at a fixed scale. Each term is floor-divided, so at a raw
// (unguarded) scale the last place can lag by a handful of units; the first
// ~30 digits must still match exactly.
{
  const scale = 10n ** 40n;
  const e = eSeriesScaled(scale);
  const ref = BigInt(E_100.replace('.', '').slice(0, 41)); // 2 + 40 decimals
  const diff = e > ref ? e - ref : ref - e;
  eq(diff < 10n ** 4n, true, 'Taylor series reproduces e at scale 10^40');
  // The first 30 digits are unaffected by that last-place slack.
  eq(e.toString().slice(0, 31), E_100.replace('.', '').slice(0, 31),
     'Taylor series: first 30 digits exact at scale 10^40');
}

// ---- A larger reference: e to 250 decimals ------------------------------
// Verifying the machinery holds well past the float wall and past the 100-digit
// reference above.
{
  const E_250 =
    '2.71828182845904523536028747135266249775724709369995957496' +
    '696762772407663035354759457138217852516642742746639193200305' +
    '992181741359662904357290033429526059563073813232862794349076' +
    '3233829880753195251019011573834187930702154089149934884167509' +
    '2447614606680';
  eq(eString(250), E_250, 'eString(250) matches a 250-digit reference');
}

// ---- Determinism: same input, same output -------------------------------
eq(eString(120), eString(120), 'eString is deterministic');

// ---- Input validation ---------------------------------------------------
throws(() => eScaledInteger(-1), 'eScaledInteger rejects negative');
throws(() => eScaledInteger(3.5), 'eScaledInteger rejects non-integer');
throws(() => nthDigit(0), 'nthDigit rejects 0 (it is 1-indexed)');
throws(() => nthDigit(-4), 'nthDigit rejects negative');
throws(() => eSeriesScaled(0n), 'eSeriesScaled rejects a non-positive scale');

// ---- Report -------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
