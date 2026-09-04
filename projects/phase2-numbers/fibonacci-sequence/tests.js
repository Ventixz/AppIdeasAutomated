/*
 * tests.js — dependency-free test suite for fib-core.js.
 * Run with:  node projects/phase2-numbers/fibonacci-sequence/tests.js
 */

'use strict';

const { fibSequence, fibUpTo, fibAt, fibPair } = require('./fib-core');

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

// The opening Fibonacci numbers, 0-indexed: F(0)..F(20).
const FIRST_21 = [
  0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n, 21n, 34n, 55n,
  89n, 144n, 233n, 377n, 610n, 987n, 1597n, 2584n, 4181n, 6765n,
];

// ---- fibSequence: first N terms -----------------------------------------
eq(fibSequence(0).length, 0, 'fibSequence(0) is empty');
eq(fibSequence(1).join(','), '0', 'fibSequence(1)');
eq(fibSequence(2).join(','), '0,1', 'fibSequence(2)');
eq(fibSequence(7).join(','), '0,1,1,2,3,5,8', 'fibSequence(7)');
eq(fibSequence(21).join(','), FIRST_21.join(','), 'fibSequence(21) matches reference');

// Each interior term is the sum of the two before it.
{
  const seq = fibSequence(60);
  let ok = true;
  for (let i = 2; i < seq.length; i++) {
    if (seq[i] !== seq[i - 1] + seq[i - 2]) ok = false;
  }
  eq(ok, true, 'fibSequence(60): every term is the sum of the previous two');
}

// ---- fibUpTo: all terms <= max ------------------------------------------
eq(fibUpTo(0n).join(','), '0', 'fibUpTo(0) -> [0]');
eq(fibUpTo(1n).join(','), '0,1,1', 'fibUpTo(1) includes both 1s');
eq(fibUpTo(10n).join(','), '0,1,1,2,3,5,8', 'fibUpTo(10)');
eq(fibUpTo(8n).join(','), '0,1,1,2,3,5,8', 'fibUpTo(8) includes the boundary value');
eq(fibUpTo(9n).join(','), '0,1,1,2,3,5,8', 'fibUpTo(9) excludes 13');
eq(fibUpTo(6765n)[fibUpTo(6765n).length - 1], 6765n, 'fibUpTo(6765) ends exactly at 6765');

// No element of fibUpTo(max) may exceed max.
{
  const list = fibUpTo(1000000n);
  eq(list.every((x) => x <= 1000000n), true, 'fibUpTo(1e6): no term exceeds max');
}

// ---- fibAt: single term via fast doubling -------------------------------
for (let i = 0; i < FIRST_21.length; i++) {
  eq(fibAt(i), FIRST_21[i], `fibAt(${i})`);
}
eq(fibAt(50), 12586269025n, 'fibAt(50)');
// A classic large reference: F(100) has 21 digits and is well past the float wall.
eq(fibAt(100), 354224848179261915075n, 'fibAt(100)');
eq(fibAt(200),
   280571172992510140037611932413038677189525n,
   'fibAt(200) matches a known reference');

// fibAt must agree with fibSequence at every index (two independent methods).
{
  const seq = fibSequence(500);
  let ok = true;
  for (let i = 0; i < seq.length; i++) {
    if (fibAt(i) !== seq[i]) ok = false;
  }
  eq(ok, true, 'fibAt agrees with fibSequence for the first 500 terms');
}

// Fast doubling stays exact very far out where naive floats are hopeless.
eq(fibAt(1000).toString().length, 209, 'F(1000) has 209 digits');
eq(fibPair(300)[1], fibAt(301), 'fibPair(n)[1] equals fibAt(n+1)');

// ---- Input validation ---------------------------------------------------
throws(() => fibSequence(-1), 'fibSequence rejects negative');
throws(() => fibSequence(2.5), 'fibSequence rejects non-integer');
throws(() => fibUpTo(-1n), 'fibUpTo rejects negative');
throws(() => fibUpTo(10), 'fibUpTo rejects a plain Number (needs BigInt)');
throws(() => fibAt(-3), 'fibAt rejects negative');
throws(() => fibAt(1.5), 'fibAt rejects non-integer');

// ---- Report -------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
