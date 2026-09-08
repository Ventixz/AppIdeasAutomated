/*
 * tests.js — dependency-free suite for mortgage-core.js.
 * Run with:  node projects/phase2-numbers/mortgage-calculator/tests.js
 */

'use strict';

var core = require('./mortgage-core.js');
var F = core.Fraction;

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + name); }
}
function eq(name, got, want) {
  ok(name + ' (got ' + got + ', want ' + want + ')', String(got) === String(want));
}

/* --- Fraction: exactness where floats are wrong --------------------------- */

// The canonical float trap: 0.1 + 0.2 !== 0.3 in IEEE-754, but must be exact here.
ok('0.1 + 0.2 === 0.3 exactly',
   core.parseDecimal('0.1').add(core.parseDecimal('0.2')).cmp(core.parseDecimal('0.3')) === 0);

eq('parseDecimal(3.875) = 31/8', core.parseDecimal('3.875').n + '/' + core.parseDecimal('3.875').d, '31/8');
eq('parseDecimal("$100,000")', core.parseDecimal('$100,000').toFixed(2), '100000.00');
['', '.', 'abc', '1.2.3', '-5', '1e3'].forEach(function (bad) {
  var threw = false;
  try { core.parseDecimal(bad); } catch (e) { threw = true; }
  ok('parseDecimal rejects "' + bad + '"', threw);
});

// pow: exact rational exponentiation
eq('(1.005)^2 = 40401/40000', new F(1005n, 1000n).pow(2n).n + '/' + new F(1005n, 1000n).pow(2n).d, '40401/40000');
eq('(3/2)^0 = 1', new F(3n, 2n).pow(0n).toFixed(0), '1');

// roundCents: half-up to the nearest cent, returned as an exact cents/100 rational
eq('roundCents 2.005 -> 2.01', core.roundCents(core.parseDecimal('2.005')).toFixed(2), '2.01');
eq('roundCents 2.004 -> 2.00', core.roundCents(core.parseDecimal('2.004')).toFixed(2), '2.00');
ok('roundCents result is exact cents', core.roundCents(core.parseDecimal('2.005')).d === 100n
   || core.roundCents(core.parseDecimal('2.005')).d === 20n || core.roundCents(core.parseDecimal('2.005')).d === 4n);

/* --- the classic worked example ------------------------------------------- */

// $100,000 at 6% annual for 30 years, monthly. The well-known answer is $599.55.
var m = core.amortize({ principal: '100000', annualRate: '6', years: '30' });
eq('$100k / 6% / 30yr monthly payment', m.text.payment, '599.55');
eq('...has 360 payments', m.nActual, 360n);
// Total interest on this loan is about $115,838 (the exact cents depend on the
// per-month rounding convention; we round each month's interest half-up, which
// is what a lender bills). Assert the dollar figure, which is convention-robust.
eq('...total interest ≈ $115,838', m.totalInterest.toFixed(0), '115838');
eq('...total paid = principal + interest',
   m.totalPaid.sub(m.principal).toFixed(2), m.text.totalInterest);

/* --- a mortgage is NOT the textbook formula ------------------------------- */

// The schedule must land on exactly $0.00 — the whole reason we iterate.
ok('final balance is exactly zero', m.schedule[m.schedule.length - 1].balance.isZero());

// The last payment differs from the level payment by the rounding drift.
ok('last payment differs from the level payment',
   m.text.lastPayment !== m.text.payment);

// Sum of the principal portions equals the amount borrowed, to the cent.
var principalSum = m.schedule.reduce(function (a, r) { return a.add(r.principal); }, new F(0n, 1n));
eq('principal portions sum to the loan', principalSum.toFixed(2), '100000.00');

// Sum of the interest portions equals the reported total interest.
var interestSum = m.schedule.reduce(function (a, r) { return a.add(r.interest); }, new F(0n, 1n));
eq('interest portions sum to total interest', interestSum.toFixed(2), m.text.totalInterest);

/* --- 0% loan is just the principal split up ------------------------------- */

var z = core.amortize({ principal: '12000', annualRate: '0', years: '1' });
eq('0% $12k/1yr payment', z.text.payment, '1000.00');
eq('0% total interest', z.text.totalInterest, '0.00');
eq('0% has 12 payments', z.nActual, 12n);
ok('0% ends at zero', z.schedule[11].balance.isZero());

/* --- extra payments accelerate payoff and cut interest -------------------- */

var base = core.amortize({ principal: '200000', annualRate: '5', years: '30' });
var extra = core.amortize({ principal: '200000', annualRate: '5', years: '30', extraPayment: '200' });
ok('extra payment shortens the loan', extra.nActual < base.nActual);
ok('extra payment cuts total interest', extra.totalInterest.lt(base.totalInterest));
ok('extra schedule still ends at zero', extra.schedule[extra.schedule.length - 1].balance.isZero());
// Even with extra principal, every dollar of principal is still accounted for.
var exPrincipal = extra.schedule.reduce(function (a, r) { return a.add(r.principal); }, new F(0n, 1n));
eq('extra: principal portions sum to the loan', exPrincipal.toFixed(2), '200000.00');

/* --- validation ----------------------------------------------------------- */

[['0 principal', { principal: '0', annualRate: '5', years: '30' }],
 ['negative rate', { principal: '1000', annualRate: '-1', years: '30' }],
 ['0 term', { principal: '1000', annualRate: '5', years: '0' }],
 ['fractional payment count', { principal: '1000', annualRate: '5', years: '0.001' }]
].forEach(function (c) {
  var threw = false;
  try { core.amortize(c[1]); } catch (e) { threw = true; }
  ok('rejects ' + c[0], threw);
});

/* --- invariant sweep: check the schedule against its DEFINITION ------------ *
 * For many random loans, independently of the arithmetic that produced the
 * schedule, verify the three things that make it a valid amortization:
 *   1. every interest charge = roundCents(previous balance × periodic rate)
 *   2. every row: payment = interest + principal (exactly, in cents)
 *   3. the balance decreases to exactly $0.00 and never goes negative early.
 * -------------------------------------------------------------------------- */

var seed = 123456789;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

var sweep = 0;
for (var t = 0; t < 300; t++) {
  var P = String(10000 + Math.floor(rnd() * 990000));
  var rate = (rnd() * 12).toFixed(3);            // 0.000%..12.000%
  var yrs = String(5 + Math.floor(rnd() * 30));
  var res = core.amortize({ principal: P, annualRate: rate, years: yrs });

  var prev = res.principal;
  var good = true;
  for (var k = 0; k < res.schedule.length; k++) {
    var row = res.schedule[k];
    var wantInterest = core.roundCents(prev.mul(res.periodicRate));
    if (row.interest.cmp(wantInterest) !== 0) { good = false; break; }
    if (row.payment.sub(row.interest.add(row.principal)).n !== 0n) { good = false; break; }
    if (row.balance.n < 0n) { good = false; break; }        // never overshoot
    prev = row.balance;
  }
  if (good && res.schedule[res.schedule.length - 1].balance.isZero()) sweep++;
}
ok('invariant sweep: 300/300 schedules valid (got ' + sweep + ')', sweep === 300);

/* -------------------------------------------------------------------------- */

console.log((failed === 0 ? '✓ ' : '✗ ') + passed + ' passed, ' + failed + ' failed.');
if (failed) process.exit(1);
