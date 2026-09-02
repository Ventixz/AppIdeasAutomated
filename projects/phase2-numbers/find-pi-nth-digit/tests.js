/*
 * tests.js — dependency-free test suite for pi-core.js.
 * Run with:  node projects/phase2-numbers/find-pi-nth-digit/tests.js
 */

'use strict';

const { arctanReciprocal, piScaledInteger, piString, nthDigit } = require('./pi-core');

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

// A long, known-correct reference for π (first 100 digits after the point).
// Source: the standard decimal expansion of π.
const PI_100 =
  '3.14159265358979323846264338327950288419716939937510' +
  '58209749445923078164062862089986280348253421170679';

// ---- piString: matches the reference at many lengths --------------------
for (const d of [0, 1, 2, 5, 10, 15, 20, 30, 50, 75, 100]) {
  const expected = d === 0 ? '3' : PI_100.slice(0, d + 2); // "3." + d digits
  eq(piString(d), expected, `piString(${d})`);
}

// ---- Specific well-known values -----------------------------------------
eq(piString(0), '3', 'piString(0) is the bare integer part');
eq(piString(1), '3.1', 'piString(1)');
eq(piString(2), '3.14', 'piString(2)');
eq(piString(5), '3.14159', 'piString(5)');
eq(piString(10), '3.1415926535', 'piString(10)');

// ---- piScaledInteger: exact integers ------------------------------------
eq(piScaledInteger(0), 3n, 'piScaledInteger(0)');
eq(piScaledInteger(5), 314159n, 'piScaledInteger(5)');
eq(piScaledInteger(10), 31415926535n, 'piScaledInteger(10)');

// The scaled integer must have exactly digits+1 characters (leading '3').
eq(piScaledInteger(50).toString().length, 51, 'piScaledInteger(50) length');
eq(piScaledInteger(200).toString().length, 201, 'piScaledInteger(200) length');

// ---- nthDigit: 1-indexed single digits ----------------------------------
// N=1 is the '3'; N=2 is the first decimal, etc. Cross-check against PI_100
// with its decimal point removed: "314159...".
const PI_DIGITS = PI_100.replace('.', '');
for (const n of [1, 2, 3, 4, 5, 6, 10, 33, 50, 100]) {
  eq(nthDigit(n), PI_DIGITS[n - 1], `nthDigit(${n})`);
}
eq(nthDigit(1), '3', 'nthDigit(1) is 3');
eq(nthDigit(2), '1', 'nthDigit(2) is 1');
eq(nthDigit(3), '4', 'nthDigit(3) is 4');
// The famous "Feynman point": six 9s in a row starting at decimal 762,
// i.e. 1-indexed digits 763..768 of the whole string.
eq(nthDigit(763) + nthDigit(764) + nthDigit(765) + nthDigit(766) +
   nthDigit(767) + nthDigit(768), '999999', 'nthDigit hits the Feynman point');

// ---- arctanReciprocal sanity --------------------------------------------
// 16*arctan(1/5) - 4*arctan(1/239) == pi, at a fixed scale. Each series term
// is floor-divided, so at a raw (unguarded) scale the last few places can lag
// by a handful of units; the first ~30 digits must still match exactly.
{
  const scale = 10n ** 40n;
  const pi = 16n * arctanReciprocal(5n, scale) - 4n * arctanReciprocal(239n, scale);
  const ref = BigInt(PI_100.replace('.', '').slice(0, 41)); // 3 + 40 decimals
  const diff = pi > ref ? pi - ref : ref - pi;
  eq(diff < 10n ** 8n, true, 'Machin formula reproduces pi at scale 10^40');
  // The first 30 digits are unaffected by that last-place slack.
  eq(pi.toString().slice(0, 31), PI_100.replace('.', '').slice(0, 31),
     'Machin formula: first 30 digits exact at scale 10^40');
}

// ---- Determinism: same input, same output -------------------------------
eq(piString(120), piString(120), 'piString is deterministic');

// ---- Input validation ---------------------------------------------------
throws(() => piScaledInteger(-1), 'piScaledInteger rejects negative');
throws(() => piScaledInteger(3.5), 'piScaledInteger rejects non-integer');
throws(() => nthDigit(0), 'nthDigit rejects 0 (it is 1-indexed)');
throws(() => nthDigit(-4), 'nthDigit rejects negative');
throws(() => arctanReciprocal(1n, 10n ** 10n), 'arctanReciprocal rejects x <= 1');

// ---- Report -------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
