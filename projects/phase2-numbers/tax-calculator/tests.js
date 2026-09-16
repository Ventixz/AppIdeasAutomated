/*
 * tests.js — dependency-free suite for tax-core.js. Run with:
 *   node projects/phase2-numbers/tax-calculator/tests.js
 *
 * The core is exact integer arithmetic over cents and basis points, so the whole
 * suite runs without a browser or a network: parsing money and rates, the
 * half-up rounding rule, forward and reverse sales tax (including the property
 * that base + tax always equals the total, exactly), and the progressive-bracket
 * engine — slices taxed at their own rate, marginal vs effective rate, and a
 * fuzz sweep asserting a progressive schedule never taxes a dollar of income
 * more than its top marginal rate.
 */

'use strict';

var T = require('./tax-core.js');

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

/* ---- parseMoney ---------------------------------------------------------- */
eq('parseMoney whole', T.parseMoney('1234'), 123400n);
eq('parseMoney two decimals', T.parseMoney('19.99'), 1999n);
eq('parseMoney one decimal pads', T.parseMoney('19.9'), 1990n);
eq('parseMoney zero', T.parseMoney('0'), 0n);
eq('parseMoney strips $ and commas', T.parseMoney('$1,234.56'), 123456n);
eq('parseMoney strips spaces', T.parseMoney('  42.50 '), 4250n);
throws('parseMoney rejects 3 decimals', function () { T.parseMoney('1.005'); });
throws('parseMoney rejects letters', function () { T.parseMoney('12a'); });
throws('parseMoney rejects empty', function () { T.parseMoney('   '); });
throws('parseMoney rejects negative', function () { T.parseMoney('-5'); });

/* ---- parseRatePercent ---------------------------------------------------- */
eq('parseRate 8.25% -> 825 bps', T.parseRatePercent('8.25'), 825n);
eq('parseRate 7% -> 700 bps', T.parseRatePercent('7'), 700n);
eq('parseRate 0.5% -> 50 bps', T.parseRatePercent('0.5'), 50n);
eq('parseRate strips %', T.parseRatePercent('20%'), 2000n);
eq('parseRate number input', T.parseRatePercent(7.5), 750n);
throws('parseRate rejects 3 decimals', function () { T.parseRatePercent('8.255'); });
throws('parseRate rejects empty', function () { T.parseRatePercent(''); });

/* ---- roundHalfUp --------------------------------------------------------- */
eq('roundHalfUp exact', T.roundHalfUp(1000n, 10n), 100n);
eq('roundHalfUp .5 up', T.roundHalfUp(5n, 10n), 1n);
eq('roundHalfUp .49 down', T.roundHalfUp(49n, 100n), 0n);
eq('roundHalfUp .50 up', T.roundHalfUp(50n, 100n), 1n);
eq('roundHalfUp negative half away', T.roundHalfUp(-5n, 10n), -1n);
throws('roundHalfUp rejects denom 0', function () { T.roundHalfUp(1n, 0n); });

/* ---- formatting ---------------------------------------------------------- */
eq('formatMoney groups thousands', T.formatMoney(123456789n), '1,234,567.89');
eq('formatMoney pads cents', T.formatMoney(5n), '0.05');
eq('formatMoney zero', T.formatMoney(0n), '0.00');
eq('formatPercent trims trailing zeros', T.formatPercent(825n), '8.25');
eq('formatPercent whole', T.formatPercent(700n), '7');
eq('formatPercent half', T.formatPercent(50n), '0.5');

/* ---- taxOn / addTax ------------------------------------------------------ */
// The classic float trap: 19.99 * 8.25% = 1.649175 -> rounds to 1.65 (165c).
eq('taxOn 19.99 @ 8.25%', T.taxOn(1999n, 825n), 165n);
var a = T.addTax(1999n, 825n);
eq('addTax base', a.base, 1999n);
eq('addTax tax', a.tax, 165n);
eq('addTax total', a.total, 2164n);
eq('taxOn zero amount', T.taxOn(0n, 825n), 0n);
eq('taxOn zero rate', T.taxOn(9999n, 0n), 0n);
// 100.00 @ 7% = exactly 7.00
eq('taxOn round 100 @ 7%', T.taxOn(10000n, 700n), 700n);
// half-up boundary: 10.00 @ 4.5% = 0.45 exactly; 10.01 @ 4.5% = 0.45045 -> 0.45
eq('taxOn boundary exact', T.taxOn(1000n, 450n), 45n);
throws('taxOn rejects negative amount', function () { T.taxOn(-1n, 700n); });
throws('taxOn rejects negative rate', function () { T.taxOn(100n, -1n); });

/* ---- removeTax (reverse) ------------------------------------------------- */
// A $21.64 receipt that already includes 8.25% tax should split back to
// $19.99 + $1.65 (the same numbers addTax produced).
var r = T.removeTax(2164n, 825n);
eq('removeTax base', r.base, 1999n);
eq('removeTax tax', r.tax, 165n);
ok('removeTax base+tax==total', r.base + r.tax === r.total);

// Property: for many amounts and rates, removeTax(addTax(x).total) recovers a
// base within one cent, and base+tax always equals the total exactly.
(function () {
  var rates = [0n, 50n, 700n, 825n, 1000n, 2000n, 2750n];
  var bad = 0, offByMoreThanCent = 0;
  for (var cents = 0n; cents <= 5000n; cents += 7n) {
    for (var k = 0; k < rates.length; k++) {
      var bps = rates[k];
      var fwd = T.addTax(cents, bps);
      var rev = T.removeTax(fwd.total, bps);
      if (rev.base + rev.tax !== rev.total) bad++;
      var diff = rev.base - cents; if (diff < 0n) diff = -diff;
      if (diff > 1n) offByMoreThanCent++;
    }
  }
  ok('removeTax: base+tax==total always', bad === 0);
  ok('removeTax: recovers base within a cent', offByMoreThanCent === 0);
})();

/* ---- progressive brackets ------------------------------------------------ */
// A simple made-up schedule: 0% up to $10,000, 10% to $40,000, 20% above.
var SCHED = [
  { upTo: 1000000n, bps: 0n },
  { upTo: 4000000n, bps: 1000n },
  { upTo: null,     bps: 2000n }
];

// Income of $25,000: first $10k free, next $15k @ 10% = $1,500.
var p1 = T.progressiveTax(2500000n, SCHED);
eq('progressive $25k tax', p1.tax, 150000n);
eq('progressive $25k marginal', p1.marginalBps, 1000n);
// effective = 1500 / 25000 = 6%
eq('progressive $25k effective', p1.effectiveBps, 600n);
eq('progressive $25k net', p1.net, 2350000n);

// Income of $60,000: $0 + (30k @10% = 3,000) + (20k @20% = 4,000) = $7,000.
var p2 = T.progressiveTax(6000000n, SCHED);
eq('progressive $60k tax', p2.tax, 700000n);
eq('progressive $60k marginal', p2.marginalBps, 2000n);

// Income below the first threshold pays nothing and has 0% marginal.
var p0 = T.progressiveTax(500000n, SCHED);
eq('progressive $5k tax', p0.tax, 0n);
eq('progressive $5k marginal', p0.marginalBps, 0n);
eq('progressive $5k effective', p0.effectiveBps, 0n);

// The per-bracket breakdown sums to the reported tax (rounded once).
(function () {
  var sum = 0n;
  for (var i = 0; i < p2.perBracket.length; i++) sum += p2.perBracket[i].taxable * p2.perBracket[i].bps;
  eq('progressive breakdown reconstructs tax', T.roundHalfUp(sum, 10000n), p2.tax);
  var taxable = 0n;
  for (var j = 0; j < p2.perBracket.length; j++) taxable += p2.perBracket[j].taxable;
  eq('progressive taxable slices sum to income', taxable, 6000000n);
})();

// Validation of malformed schedules.
throws('schedule rejects empty', function () { T.progressiveTax(100n, []); });
throws('schedule rejects non-increasing thresholds', function () {
  T.progressiveTax(100n, [{ upTo: 100n, bps: 100n }, { upTo: 100n, bps: 200n }, { upTo: null, bps: 300n }]);
});
throws('schedule rejects open-ended non-top bracket', function () {
  T.progressiveTax(100n, [{ upTo: null, bps: 100n }, { upTo: null, bps: 200n }]);
});
throws('schedule rejects closed top bracket', function () {
  T.progressiveTax(100n, [{ upTo: 100n, bps: 100n }, { upTo: 200n, bps: 200n }]);
});
throws('progressive rejects negative income', function () { T.progressiveTax(-1n, SCHED); });

/* ---- property sweeps ----------------------------------------------------- */
// 1) Progressive tax is monotonic: more income never means less tax.
(function () {
  var prev = -1n, monotonic = true;
  for (var inc = 0n; inc <= 10000000n; inc += 123456n) {
    var t = T.progressiveTax(inc, SCHED).tax;
    if (t < prev) monotonic = false;
    prev = t;
  }
  ok('progressive tax is monotonic in income', monotonic);
})();

// 2) No dollar is ever taxed above the top marginal rate: total tax never
//    exceeds income * topRate, and the effective rate never exceeds the
//    marginal rate.
(function () {
  var topBps = 2000n;
  var withinCap = true, effLeMarginal = true;
  for (var inc = 0n; inc <= 20000000n; inc += 271828n) {
    var res = T.progressiveTax(inc, SCHED);
    if (res.tax > T.roundHalfUp(inc * topBps, 10000n)) withinCap = false;
    if (inc > 0n && res.effectiveBps > res.marginalBps) effLeMarginal = false;
  }
  ok('progressive: tax never exceeds top-rate cap', withinCap);
  ok('progressive: effective rate <= marginal rate', effLeMarginal);
})();

// 3) A single-bracket flat schedule matches taxOn() exactly.
(function () {
  var flat = [{ upTo: null, bps: 825n }];
  var same = true;
  for (var c = 0n; c <= 100000n; c += 137n) {
    if (T.progressiveTax(c, flat).tax !== T.taxOn(c, 825n)) same = false;
  }
  ok('progressive flat schedule == taxOn', same);
})();

/* ---- report -------------------------------------------------------------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed === 0 ? 0 : 1);
