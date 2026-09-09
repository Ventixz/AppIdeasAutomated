/*
 * tests.js — dependency-free suite for change-core.js.
 * Run with:  node projects/phase2-numbers/change-return/tests.js
 */

'use strict';

var core = require('./change-core.js');

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + name); }
}
function eq(name, got, want) {
  ok(name + ' (got ' + got + ', want ' + want + ')', String(got) === String(want));
}

/* --- Money parsing: exact cents, never a float ---------------------------- */

// The canonical float trap: 0.10 + 0.20 !== 0.30 in IEEE-754, so we never let a
// float near the money. Parsed as integer cents, the sum is exactly 30.
eq('parseMoney 0.10 + 0.20 = 30c', core.parseMoney('0.10') + core.parseMoney('0.20'), 30);
eq('parseMoney "$1,234.56"', core.parseMoney('$1,234.56'), 123456);
eq('parseMoney "5" (whole dollars)', core.parseMoney('5'), 500);
eq('parseMoney ".5" (half a dollar)', core.parseMoney('.5'), 50);
eq('parseMoney "0.05"', core.parseMoney('0.05'), 5);
eq('parseMoney "10." ', core.parseMoney('10.'), 1000);
['', '.', 'abc', '1.234', '1.2.3', '-5', '1e3', '$'].forEach(function (bad) {
  var threw = false;
  try { core.parseMoney(bad); } catch (e) { threw = true; }
  ok('parseMoney rejects "' + bad + '"', threw);
});

// formatCents round-trips
eq('formatCents(123456)', core.formatCents(123456), '$1,234.56');
eq('formatCents(5)', core.formatCents(5), '$0.05');
eq('formatCents(0)', core.formatCents(0), '$0.00');

/* --- The exercise, worked ------------------------------------------------- */

// Cost $7.03, paid with a $20 -> $12.97 change.
var r = core.makeChange('7.03', '20');
eq('change for $7.03 from $20', r.changeStr, '$12.97');
// $12.97 = $10 + $2 (two ones) + 3 quarters + 2 dimes + 2 pennies
var g = r.greedy.rows.map(function (x) { return x.count + '×' + x.denom.cents; }).join(' ');
eq('greedy breakdown of $12.97', g, '1×1000 2×100 3×25 2×10 2×1');
eq('$12.97 total coins/bills', r.greedy.count, 10);
ok('$12.97 breakdown is exact', r.greedy.exact);
ok('greedy is optimal for US set', r.greedyIsOptimal);

// The breakdown actually sums back to the change (invariant, not a re-derivation).
function sumRows(rows) { return rows.reduce(function (s, x) { return s + x.count * x.denom.cents; }, 0); }
eq('rows sum to change', sumRows(r.greedy.rows), r.changeCents);

// Exact change -> nothing handed back.
var z = core.makeChange('4.99', '4.99');
eq('exact payment: change is $0.00', z.changeStr, '$0.00');
eq('exact payment: no coins', z.greedy.count, 0);

// Overpay guard.
var threw = false;
try { core.makeChange('10.00', '5.00'); } catch (e) { threw = true; }
ok('rejects tendered < cost', threw);

/* --- Coins-only mode (the four coins the exercise names) ------------------- */

var c = core.makeChange('0.01', '1.00', core.US_COINS);   // 99c in coins
eq('99c in coins: 3 quarters', c.greedy.rows[0].count + '×' + c.greedy.rows[0].denom.cents, '3×25');
eq('99c coin count', c.greedy.count, 9);   // 3q + 2d + 4p
ok('99c coins sum correct', sumRows(c.greedy.rows) === 99);

/* --- Greedy is optimal ONLY because US coins are canonical ---------------- */

ok('US full set is canonical', core.isCanonical(core.US_FULL));
ok('US coins are canonical', core.isCanonical(core.US_COINS));

// The classic counterexample: {1,3,4}. Greedy botches 6 (4+1+1); optimum 3+3.
ok('{1,3,4} is NOT canonical', core.isCanonical([1, 3, 4]) === false);
var badGreedy = core.greedyChange(6, [1, 3, 4]);
var badOpt = core.optimalChange(6, [1, 3, 4]);
eq('greedy(6, {1,3,4}) uses 3 coins', badGreedy.count, 3);
eq('optimal(6, {1,3,4}) uses 2 coins', badOpt.count, 2);
ok('optimal beats greedy on {1,3,4}', badOpt.count < badGreedy.count);

// A set with no unit coin cannot be canonical (can't make 1c).
ok('{5,10,25} is not canonical (no penny)', core.isCanonical([5, 10, 25]) === false);
// ...and greedy leaves a remainder on an unmakeable amount.
var stuck = core.greedyChange(7, [5, 10, 25]);
ok('7c is unmakeable from {5,10,25}', stuck.exact === false && stuck.remainder === 2);

/* --- Invariant sweep: greedy == optimal for every amount, over US coins --- */
/* For a canonical system the two algorithms MUST agree at every amount. This
 * checks the property directly, independent of any single worked example. */
var mismatch = -1;
for (var a = 0; a <= 500; a++) {
  var gg = core.greedyChange(a, core.US_FULL);
  var oo = core.optimalChange(a, core.US_FULL);
  if (!(gg.exact && oo.exact && gg.count === oo.count && sumRows(gg.rows) === a && sumRows(oo.rows) === a)) {
    mismatch = a; break;
  }
}
ok('greedy == optimal for every amount 0..$5.00 (US)', mismatch === -1);

/* --- Randomised end-to-end: change always reconstructs the amount --------- */
var rng = 123456789;
function rand(n) { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; }
var allGood = true;
for (var t = 0; t < 500; t++) {
  var cost = rand(50000);            // up to $500.00
  var extra = rand(50000);
  var costS = core.formatCents(cost).replace(/[$,]/g, '');
  var tendS = core.formatCents(cost + extra).replace(/[$,]/g, '');
  var res = core.makeChange(costS, tendS);
  if (res.changeCents !== extra) { allGood = false; break; }
  if (sumRows(res.greedy.rows) !== extra) { allGood = false; break; }
  if (!res.greedyIsOptimal) { allGood = false; break; }
}
ok('500 random transactions reconstruct exactly and stay optimal', allGood);

/* --- Report -------------------------------------------------------------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
