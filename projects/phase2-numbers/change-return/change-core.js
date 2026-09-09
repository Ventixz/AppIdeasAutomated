/*
 * change-core.js — the whole calculation for "Change Return Program", from
 * karan/Projects (Numbers):
 *
 *   "The user enters a cost and then the amount of money given. The program
 *    will figure out the change and the number of quarters, dimes, nickels,
 *    pennies needed for the change."
 *
 * DOM-free, console-free, I/O-free, so the identical file runs in the browser
 * and under Node for the tests.
 *
 * Two things make this more than a one-liner, and both live here:
 *
 * 1. MONEY IS NOT A FLOAT. A cost of "$0.10" plus "$0.20" is not 0.30 in
 *    IEEE-754 — it is 0.30000000000000004 — and `Math.round(diff * 100)` on
 *    such a value is a coin-flip at the half-cent. So nothing here ever becomes
 *    a float: every amount is parsed straight from its decimal string into an
 *    exact integer number of cents, and all arithmetic is integer arithmetic.
 *
 * 2. GREEDY CHANGE IS ONLY CORRECT BY LUCK. "Hand back the biggest coin that
 *    fits, repeat" is the textbook answer, and it gives the fewest coins — but
 *    ONLY because U.S. denominations form a *canonical* system. Change the set
 *    to {1, 3, 4} and greedy botches 6 cents (4+1+1 = three coins) where the
 *    optimum is 3+3 (two coins). So this core computes the greedy breakdown AND
 *    the provably minimum-coin breakdown (dynamic programming), and reports
 *    whether they agree — turning a lurking bug into a stated fact.
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Money parsing: a decimal string -> an exact integer number of cents.
 * No parseFloat, no `* 100`, no rounding of a float. We read the digits.
 * ------------------------------------------------------------------ */

function parseMoney(str) {
  if (typeof str !== 'string') str = String(str);
  var s = str.trim().replace(/^\$/, '').replace(/,/g, '');
  if (s === '') throw new Error('empty amount');
  // Optional whole part, optional fractional part, at most two fraction digits.
  var m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) throw new Error('not a valid money amount: "' + str + '"');
  var whole = m[1] || '';
  var frac = m[2] === undefined ? '' : m[2];
  if (whole === '' && frac === '') throw new Error('not a valid money amount: "' + str + '"');
  frac = (frac + '00').slice(0, 2);          // pad "5" -> "50", "" -> "00"
  var cents = Number(whole || '0') * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) throw new Error('amount too large');
  return cents;                               // an exact, non-negative integer
}

/* Format an integer number of cents back to a "$1,234.56" string. */
function formatCents(cents) {
  var neg = cents < 0;
  cents = Math.abs(cents);
  var dollars = Math.floor(cents / 100);
  var rem = cents % 100;
  var withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + withCommas + '.' + (rem < 10 ? '0' + rem : rem);
}

/* ------------------------------------------------------------------ *
 * Denomination sets. Each entry is value-in-cents plus its names.
 * ------------------------------------------------------------------ */

// Full U.S. set: bills through the penny (a canonical system).
var US_FULL = [
  { cents: 10000, singular: 'hundred-dollar bill', plural: 'hundred-dollar bills' },
  { cents: 5000,  singular: 'fifty-dollar bill',   plural: 'fifty-dollar bills' },
  { cents: 2000,  singular: 'twenty-dollar bill',  plural: 'twenty-dollar bills' },
  { cents: 1000,  singular: 'ten-dollar bill',     plural: 'ten-dollar bills' },
  { cents: 500,   singular: 'five-dollar bill',    plural: 'five-dollar bills' },
  { cents: 100,   singular: 'dollar',              plural: 'dollars' },
  { cents: 25,    singular: 'quarter',             plural: 'quarters' },
  { cents: 10,    singular: 'dime',                plural: 'dimes' },
  { cents: 5,     singular: 'nickel',              plural: 'nickels' },
  { cents: 1,     singular: 'penny',               plural: 'pennies' }
];

// The classic four coins the exercise names — nothing bigger than a quarter.
var US_COINS = US_FULL.slice(US_FULL.findIndex(function (d) { return d.cents === 25; }));

/* Normalise a raw denomination spec into a sorted, de-duped list of coin
 * objects (largest first), for greedy and DP alike. Accepts either the
 * pre-built objects above or a bare array of cent values (used by tests to
 * exercise weird systems like [1, 3, 4]). */
function normalizeDenoms(denoms) {
  var list = denoms.map(function (d) {
    if (typeof d === 'number') return { cents: d, singular: d + '¢', plural: d + '¢' };
    return d;
  });
  list.forEach(function (d) {
    if (!Number.isInteger(d.cents) || d.cents <= 0) throw new Error('denomination must be a positive integer number of cents');
  });
  list = list.slice().sort(function (a, b) { return b.cents - a.cents; });
  for (var i = 1; i < list.length; i++) {
    if (list[i].cents === list[i - 1].cents) throw new Error('duplicate denomination');
  }
  if (list.length === 0) throw new Error('no denominations');
  return list;
}

/* ------------------------------------------------------------------ *
 * Greedy: biggest-first. Fast, and optimal on canonical systems only.
 * Returns { rows:[{denom,count}], total, count, exact } where `exact`
 * is false if a leftover remained (i.e. no penny/unit coin available).
 * ------------------------------------------------------------------ */
function greedyChange(amountCents, denoms) {
  var list = normalizeDenoms(denoms);
  var remaining = amountCents;
  var rows = [];
  var count = 0;
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    var k = Math.floor(remaining / d.cents);
    if (k > 0) { rows.push({ denom: d, count: k }); count += k; remaining -= k * d.cents; }
  }
  return { rows: rows, total: amountCents - remaining, count: count, exact: remaining === 0, remainder: remaining };
}

/* ------------------------------------------------------------------ *
 * Optimal: the provably fewest coins, by dynamic programming. This is the
 * honest answer for ANY denomination set. O(amount * #denoms).
 * Returns the same shape as greedyChange; `exact` false if unmakeable.
 * ------------------------------------------------------------------ */
function optimalChange(amountCents, denoms) {
  var list = normalizeDenoms(denoms);
  var INF = Infinity;
  var best = new Array(amountCents + 1).fill(INF);
  var pick = new Array(amountCents + 1).fill(-1);   // which denom index closed this amount
  best[0] = 0;
  for (var a = 1; a <= amountCents; a++) {
    for (var i = 0; i < list.length; i++) {
      var v = list[i].cents;
      if (v <= a && best[a - v] + 1 < best[a]) { best[a] = best[a - v] + 1; pick[a] = i; }
    }
  }
  if (best[amountCents] === INF) {
    return { rows: [], total: 0, count: 0, exact: false, remainder: amountCents };
  }
  // Reconstruct, then group by denomination (largest first).
  var counts = new Array(list.length).fill(0);
  for (var x = amountCents; x > 0; x -= list[pick[x]].cents) counts[pick[x]]++;
  var rows = [];
  for (var j = 0; j < list.length; j++) {
    if (counts[j] > 0) rows.push({ denom: list[j], count: counts[j] });
  }
  return { rows: rows, total: amountCents, count: best[amountCents], exact: true, remainder: 0 };
}

/* Is a denomination system canonical (greedy == optimal) over 1..bound cents?
 * The known theory says a counterexample, if any, occurs below the sum of the
 * two largest coins, so a modest bound is a genuine proof for real coin sets. */
function isCanonical(denoms, bound) {
  var list = normalizeDenoms(denoms);
  if (list[list.length - 1].cents !== 1) return false;   // can't make every amount without a unit coin
  if (bound === undefined) bound = list.length >= 2 ? list[0].cents + list[1].cents + 1 : list[0].cents + 1;
  // Reuse one DP array while sweeping, comparing greedy count to optimal.
  var best = [0];
  for (var a = 1; a <= bound; a++) {
    var bo = Infinity;
    for (var i = 0; i < list.length; i++) {
      var v = list[i].cents;
      if (v <= a && best[a - v] + 1 < bo) bo = best[a - v] + 1;
    }
    best[a] = bo;
    // greedy count for a
    var rem = a, g = 0;
    for (var j = 0; j < list.length; j++) { var kk = Math.floor(rem / list[j].cents); g += kk; rem -= kk * list[j].cents; }
    if (rem === 0 && g !== bo) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * The single entry point the UI and tests call. Takes the raw strings,
 * validates, and returns everything needed to render an answer.
 * ------------------------------------------------------------------ */
function makeChange(costStr, tenderedStr, denoms) {
  if (denoms === undefined) denoms = US_FULL;
  var cost = parseMoney(costStr);
  var tendered = parseMoney(tenderedStr);
  if (tendered < cost) {
    throw new Error('Amount given (' + formatCents(tendered) + ') is less than the cost (' + formatCents(cost) + ').');
  }
  var change = tendered - cost;                 // exact integer cents
  var greedy = greedyChange(change, denoms);
  var optimal = optimalChange(change, denoms);
  var greedyIsOptimal = greedy.exact && optimal.exact && greedy.count === optimal.count;
  return {
    costCents: cost,
    tenderedCents: tendered,
    changeCents: change,
    costStr: formatCents(cost),
    tenderedStr: formatCents(tendered),
    changeStr: formatCents(change),
    greedy: greedy,
    optimal: optimal,
    greedyIsOptimal: greedyIsOptimal,
    canonical: isCanonical(denoms)
  };
}

/* Node exports (ignored in the browser). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseMoney: parseMoney,
    formatCents: formatCents,
    normalizeDenoms: normalizeDenoms,
    greedyChange: greedyChange,
    optimalChange: optimalChange,
    isCanonical: isCanonical,
    makeChange: makeChange,
    US_FULL: US_FULL,
    US_COINS: US_COINS
  };
}
