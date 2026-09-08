/*
 * mortgage-core.js — the whole calculation for "Mortgage Calculator", from
 * karan/Projects (Numbers). DOM-free, console-free, I/O-free, so the identical
 * file runs in the browser and under Node for the tests.
 *
 * The textbook monthly payment is a one-line formula:
 *
 *     M = P · i · (1+i)^n / ((1+i)^n − 1)
 *
 * but a mortgage is not that number. A lender bills you a WHOLE number of cents
 * every month, and charges interest on the WHOLE-cent balance that is actually
 * outstanding. Round the payment to the cent and those cents no longer amortize
 * the loan exactly: after 359 identical payments the 360th is a few cents
 * different, and the "total interest" printed on the disclosure is the sum of
 * 360 individually-rounded interest charges — not P·n·something.
 *
 * So this core does two separate things. It computes the exact scheduled
 * payment as a rational (a BigInt numerator over a BigInt denominator — no
 * 0.1 + 0.2 = 0.30000000000000004 error), rounds it to the cent the way a
 * lender would, and then RUNS the amortization month by month: interest on the
 * current balance rounded to the cent, principal = payment − interest, repeat,
 * with the final payment trimmed so the balance lands on exactly $0.00.
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Fraction: an exact rational n/d over BigInt, always reduced, d > 0.
 * Money and rates are decimals; in IEEE-754 doubles they are not exact,
 * and the error compounds over hundreds of months. None of it is a float.
 * ------------------------------------------------------------------ */

function gcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { var t = a % b; a = b; b = t; }
  return a;
}

function Fraction(n, d) {
  if (d === undefined) d = 1n;
  n = BigInt(n); d = BigInt(d);
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) { n = -n; d = -d; }         // keep the sign on the numerator
  var g = gcd(n, d) || 1n;
  this.n = n / g;
  this.d = d / g;
}

Fraction.prototype.add = function (o) { return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); };
Fraction.prototype.sub = function (o) { return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); };
Fraction.prototype.mul = function (o) { return new Fraction(this.n * o.n, this.d * o.d); };
Fraction.prototype.div = function (o) { return new Fraction(this.n * o.d, this.d * o.n); };
Fraction.prototype.cmp = function (o) {                       // -1 / 0 / +1
  var a = this.n * o.d, b = o.n * this.d;
  return a < b ? -1 : a > b ? 1 : 0;
};
Fraction.prototype.lte = function (o) { return this.cmp(o) <= 0; };
Fraction.prototype.lt  = function (o) { return this.cmp(o) <  0; };
Fraction.prototype.isZero = function () { return this.n === 0n; };
Fraction.prototype.isPos = function () { return this.n > 0n; };

/* this raised to a non-negative integer power, by exponentiation-by-squaring on
 * the numerator and denominator separately (both exact). */
Fraction.prototype.pow = function (k) {
  k = BigInt(k);
  if (k < 0n) throw new Error('negative exponent');
  var rn = 1n, rd = 1n, bn = this.n, bd = this.d;
  while (k > 0n) {
    if (k & 1n) { rn *= bn; rd *= bd; }
    bn *= bn; bd *= bd;
    k >>= 1n;
  }
  return new Fraction(rn, rd);
};

/* Number, for display only — never fed back into a calculation. */
Fraction.prototype.toNumber = function () { return Number(this.n) / Number(this.d); };

/* Round to `places` decimals, half-up, formatted with a fixed width. Used only
 * to render figures; the value rounded is already exact. */
Fraction.prototype.toFixed = function (places) {
  var neg = this.n < 0n;
  var n = neg ? -this.n : this.n;
  var scale = 10n ** BigInt(places);
  var scaled = (n * scale * 2n + this.d) / (this.d * 2n);      // half-up
  var s = scaled.toString().padStart(places + 1, '0');
  var whole = s.slice(0, s.length - places) || '0';
  var frac = places ? '.' + s.slice(s.length - places) : '';
  return (neg && scaled !== 0n ? '-' : '') + whole + frac;
};

/* The one money primitive: round an exact Fraction of dollars to the nearest
 * cent, half-up, and return it as an EXACT Fraction (cents/100) so it keeps
 * flowing through exact arithmetic. This is what a lender does every month. */
function roundCents(f) {
  var neg = f.n < 0n;
  var n = neg ? -f.n : f.n;
  var cents = (n * 200n + f.d) / (f.d * 2n);                   // half-up to cents
  return new Fraction(neg ? -cents : cents, 100n);
}

/* Parse a decimal string ("100000", "3.875", ".5", "1,000.50") into an exact
 * Fraction. Rejects anything that isn't a clean non-negative decimal. */
function parseDecimal(str) {
  var s = String(str).trim().replace(/[,_$\s]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.?\d*$/.test(s) || s === '.') {
    throw new Error('not a number: "' + str + '"');
  }
  var dot = s.indexOf('.');
  if (dot === -1) return new Fraction(BigInt(s), 1n);
  var digits = s.slice(0, dot) + s.slice(dot + 1);
  var scale = 10n ** BigInt(s.length - dot - 1);
  return new Fraction(BigInt(digits || '0'), scale);
}

var HUNDRED = new Fraction(100n, 1n);

/* ------------------------------------------------------------------ *
 * The scheduled (level) payment, as an EXACT rational.
 *
 *   i = periodic rate = annualRate% / 100 / paymentsPerYear
 *   n = total number of payments = years · paymentsPerYear
 *
 *   i = 0  →  M = P / n            (a 0% loan is just the principal split up)
 *   i > 0  →  M = P·i·(1+i)^n / ((1+i)^n − 1)
 *
 * Returned unrounded; the caller rounds to the cent for the actual schedule.
 * ------------------------------------------------------------------ */

function scheduledPayment(principal, periodicRate, nPayments) {
  if (nPayments <= 0n) throw new Error('number of payments must be positive');
  if (periodicRate.isZero()) {
    return principal.div(new Fraction(nPayments, 1n));
  }
  var growth = new Fraction(1n, 1n).add(periodicRate).pow(nPayments);   // (1+i)^n
  return principal.mul(periodicRate).mul(growth).div(growth.sub(new Fraction(1n, 1n)));
}

/* ------------------------------------------------------------------ *
 * amortize(input) — the one entry point the UI and tests call.
 *
 * input = {
 *   principal,          // decimal string, dollars borrowed
 *   annualRate,         // decimal string, annual interest %, e.g. '6.5' (0 ok)
 *   years,              // loan term in years (integer-valued decimal ok, e.g. '30')
 *   paymentsPerYear,    // optional int >= 1, default 12 (monthly)
 *   extraPayment        // optional decimal string, extra principal each period
 * }
 *
 * Runs the real month-by-month schedule with cent-rounded interest and a
 * trimmed final payment, so the balance ends at exactly $0.00. Returns exact
 * Fractions/BigInts plus a full schedule and pre-formatted strings.
 * ------------------------------------------------------------------ */

function amortize(input) {
  var principal = parseDecimal(input.principal);
  if (!principal.isPos()) throw new Error('principal must be positive');

  var annualRate = parseDecimal(input.annualRate == null ? '0' : input.annualRate);
  if (annualRate.n < 0n) throw new Error('interest rate cannot be negative');

  var years = parseDecimal(input.years);
  if (!years.isPos()) throw new Error('term must be positive');

  var ppy = input.paymentsPerYear ? BigInt(input.paymentsPerYear) : 12n;
  if (ppy < 1n) throw new Error('payments per year must be >= 1');

  // n = years · paymentsPerYear must be a whole number of payments.
  var nFrac = years.mul(new Fraction(ppy, 1n));
  if (nFrac.d !== 1n) throw new Error('term × payments/year must be a whole number of payments');
  var nPayments = nFrac.n;

  // Periodic rate i = (annualRate/100) / paymentsPerYear, exact.
  var periodicRate = annualRate.div(HUNDRED).div(new Fraction(ppy, 1n));

  var scheduled = roundCents(scheduledPayment(principal, periodicRate, nPayments));

  var extra = parseDecimal(input.extraPayment || '0');
  if (extra.n < 0n) throw new Error('extra payment cannot be negative');
  extra = roundCents(extra);

  // Guard against a payment that can never clear the loan (only possible with a
  // pathological hand-supplied payment; the scheduled one always amortizes).
  var firstInterest = roundCents(principal.mul(periodicRate));
  if (scheduled.add(extra).lte(firstInterest) && !periodicRate.isZero()) {
    throw new Error('payment does not cover interest — loan would never be repaid');
  }

  var balance = principal;
  var totalInterest = new Fraction(0n, 1n);
  var totalPaid = new Fraction(0n, 1n);
  var schedule = [];
  var period = 0;
  // Safety bound: cannot exceed the scheduled count, and extra only shortens it.
  var maxPeriods = Number(nPayments) + 1;

  while (balance.isPos() && period < maxPeriods) {
    period++;
    var interest = roundCents(balance.mul(periodicRate));
    var pay = scheduled.add(extra);
    var principalPaid;

    // Final payment: either the loan reaches its last scheduled period (no
    // extra payments), or what's owed (balance + this month's interest) is at
    // or below the level payment. The last payment absorbs the cent-rounding
    // drift so the balance lands on exactly $0.00 — a real lender's last
    // payment is "the remaining balance plus its interest", not $599.55 again.
    var lastScheduled = extra.isZero() && BigInt(period) === nPayments;
    if (lastScheduled || balance.add(interest).lte(pay)) {
      principalPaid = balance;
      pay = balance.add(interest);
      balance = new Fraction(0n, 1n);
    } else {
      principalPaid = pay.sub(interest);
      balance = balance.sub(principalPaid);
    }

    totalInterest = totalInterest.add(interest);
    totalPaid = totalPaid.add(pay);
    schedule.push({
      period: period,
      payment: pay,
      interest: interest,
      principal: principalPaid,
      balance: balance
    });
  }

  return {
    // inputs echoed as exact values
    principal: principal,
    periodicRate: periodicRate,
    nScheduled: nPayments,
    paymentsPerYear: ppy,
    // headline figures
    scheduledPayment: scheduled,       // the level monthly payment (cent-rounded)
    extraPayment: extra,
    nActual: BigInt(schedule.length),  // real number of payments (< scheduled with extra)
    totalInterest: totalInterest,
    totalPaid: totalPaid,
    schedule: schedule,
    // formatted for display
    text: {
      payment: scheduled.toFixed(2),
      totalInterest: totalInterest.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      lastPayment: schedule.length ? schedule[schedule.length - 1].payment.toFixed(2) : '0.00'
    }
  };
}

/* ------------------------------------------------------------------ */

var api = {
  Fraction: Fraction,
  parseDecimal: parseDecimal,
  roundCents: roundCents,
  scheduledPayment: scheduledPayment,
  amortize: amortize
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.MortgageCore = api;
