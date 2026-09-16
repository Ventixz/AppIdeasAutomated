/*
 * tax-core.js — the exact-arithmetic core of the Tax Calculator.
 *
 * The whole point of a tax calculator is that the numbers have to be *right to
 * the cent*, and that is exactly where a naive version made with JavaScript
 * floats goes wrong: `19.99 * 0.0825` is not what you think, and rounding it
 * afterwards only hides the error. So this core never touches a float. Money is
 * carried as an integer number of **cents** (a `BigInt`), and every tax rate is
 * carried as an integer number of **basis points** — hundredths of a percent,
 * so `8.25%` is the integer `825`. Every amount of tax is then an exact rational
 * `cents * bps / 10000`, rounded to a whole cent in one clearly-defined place.
 *
 * This file is deliberately DOM-free, I/O-free and console-free: no `window`, no
 * `fetch`, no `document`. It runs identically in a browser (via a `<script>`
 * tag, exporting onto `window.TaxCore`) and in Node (via `require`), so the test
 * suite in `tests.js` can prove its properties without a browser or a network.
 *
 * NOTE ON REALISM. The arithmetic here is exact; the *rates* are not advice.
 * Real tax is full of deductions, credits, filing status, thresholds that phase
 * in and out, and local surtaxes this core does not model. Treat every built-in
 * rate and schedule as an illustrative example, not a filing.
 */

'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TaxCore = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---- rounding ------------------------------------------------------------
   * The single place a whole-cent value is produced from a rational. We round
   * half away from zero ("round half up" for positive money), which is the
   * convention people expect on a receipt: a tax of 4.5 cents becomes 5. Both
   * arguments are BigInt; only the non-negative case matters for tax, but the
   * function is written to be correct for negatives too (a refund line).
   */
  function roundHalfUp(numer, denom) {
    if (denom <= 0n) throw new RangeError('denom must be positive');
    var neg = numer < 0n;
    var n = neg ? -numer : numer;
    var q = n / denom;
    var r = n % denom;
    // round half away from zero: bump when twice the remainder reaches denom.
    if (r * 2n >= denom) q += 1n;
    return neg ? -q : q;
  }

  /* ---- parsing money -------------------------------------------------------
   * "1,234.5" / "$1234.50" / "1234" -> 123450n cents. Rejects anything that is
   * not a plain non-negative amount with at most two decimal places, rather
   * than silently truncating a third decimal the way parseFloat would.
   */
  function parseMoney(str) {
    if (typeof str !== 'string') throw new TypeError('money must be a string');
    var s = str.trim().replace(/[$\s,]/g, '');
    if (s === '') throw new SyntaxError('empty amount');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      throw new SyntaxError('not a valid amount (max two decimals): ' + JSON.stringify(str));
    }
    var parts = s.split('.');
    var whole = BigInt(parts[0]);
    var frac = parts[1] || '';
    frac = (frac + '00').slice(0, 2); // pad "5" -> "50"
    return whole * 100n + BigInt(frac);
  }

  /* ---- parsing a rate ------------------------------------------------------
   * A percent, as a string, to integer basis points. "8.25" -> 825n,
   * "7" -> 700n, "0.5" -> 50n. At most two decimal places, because one basis
   * point (0.01%) is the resolution we keep. Rejects a third decimal rather
   * than rounding it away.
   */
  function parseRatePercent(str) {
    if (typeof str === 'number') str = String(str);
    if (typeof str !== 'string') throw new TypeError('rate must be a string or number');
    var s = str.trim().replace(/[%\s]/g, '');
    if (s === '') throw new SyntaxError('empty rate');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      throw new SyntaxError('not a valid percent (max two decimals): ' + JSON.stringify(str));
    }
    var parts = s.split('.');
    var whole = BigInt(parts[0]);
    var frac = ((parts[1] || '') + '00').slice(0, 2);
    return whole * 100n + BigInt(frac); // percent*100 == basis points
  }

  /* ---- formatting ----------------------------------------------------------- */
  function formatMoney(cents) {
    cents = BigInt(cents);
    var neg = cents < 0n;
    var n = neg ? -cents : cents;
    var whole = (n / 100n).toString();
    var frac = (n % 100n).toString().padStart(2, '0');
    // group the integer part with thousands separators
    var grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + grouped + '.' + frac;
  }

  function formatPercent(bps) {
    bps = BigInt(bps);
    var neg = bps < 0n;
    var n = neg ? -bps : bps;
    var whole = (n / 100n).toString();
    var frac = (n % 100n).toString().padStart(2, '0').replace(/0+$/, '');
    return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
  }

  /* ---- the actual tax ------------------------------------------------------
   * tax on `cents` at `bps` basis points, rounded to a whole cent. Exact:
   * cents*bps is an integer, and we round the division by 10000 once.
   */
  function taxOn(cents, bps) {
    cents = BigInt(cents); bps = BigInt(bps);
    if (cents < 0n) throw new RangeError('amount must be non-negative');
    if (bps < 0n) throw new RangeError('rate must be non-negative');
    return roundHalfUp(cents * bps, 10000n);
  }

  /* Forward: a pre-tax amount plus tax gives the total the customer pays. */
  function addTax(cents, bps) {
    var tax = taxOn(cents, bps);
    return { base: BigInt(cents), tax: tax, total: BigInt(cents) + tax };
  }

  /* Reverse: a *tax-inclusive* total, split back into base and tax. This is the
   * error-prone one — you cannot just multiply the total by the rate. If the
   * total already includes tax at `bps`, then total = base * (10000+bps)/10000,
   * so base = round(total*10000 / (10000+bps)) and the tax is whatever is left.
   * Taking the tax as the remainder guarantees base + tax == total exactly, with
   * no lost or invented cent.
   */
  function removeTax(totalCents, bps) {
    totalCents = BigInt(totalCents); bps = BigInt(bps);
    if (totalCents < 0n) throw new RangeError('total must be non-negative');
    if (bps < 0n) throw new RangeError('rate must be non-negative');
    var base = roundHalfUp(totalCents * 10000n, 10000n + bps);
    return { base: base, tax: totalCents - base, total: totalCents };
  }

  /* ---- progressive (marginal) brackets -------------------------------------
   * The interesting arithmetic. A schedule is a list of brackets:
   *   [{ upTo: <cents|null>, bps: <basis points> }, ...]
   * ordered by threshold, the last one open-ended (`upTo: null`). Income is
   * taxed *in slices*: the part that falls in each bracket is taxed at that
   * bracket's rate, NOT the whole income at the top rate — the single most
   * common misunderstanding of how income tax works.
   *
   * We sum the exact rational contributions (slice*bps) and round the total to a
   * cent once, rather than rounding each bracket, so the answer never drifts by
   * a rounding step per bracket. It reports the per-bracket breakdown, the
   * marginal rate (the rate of the top bracket the income reaches) and the
   * effective rate (tax / income), which are different numbers people routinely
   * confuse.
   */
  function validateSchedule(brackets) {
    if (!Array.isArray(brackets) || brackets.length === 0) {
      throw new SyntaxError('schedule must be a non-empty array of brackets');
    }
    var prev = 0n;
    for (var i = 0; i < brackets.length; i++) {
      var b = brackets[i];
      if (BigInt(b.bps) < 0n) throw new RangeError('bracket rate must be non-negative');
      var last = i === brackets.length - 1;
      if (last) {
        if (b.upTo !== null && b.upTo !== undefined) {
          throw new SyntaxError('the top bracket must be open-ended (upTo: null)');
        }
      } else {
        if (b.upTo === null || b.upTo === undefined) {
          throw new SyntaxError('only the top bracket may be open-ended');
        }
        if (BigInt(b.upTo) <= prev) {
          throw new RangeError('bracket thresholds must strictly increase');
        }
        prev = BigInt(b.upTo);
      }
    }
    return true;
  }

  function progressiveTax(incomeCents, brackets) {
    incomeCents = BigInt(incomeCents);
    if (incomeCents < 0n) throw new RangeError('income must be non-negative');
    validateSchedule(brackets);

    var lower = 0n;
    var taxNumer = 0n;          // exact sum of slice*bps, divided by 10000 at the end
    var perBracket = [];
    var marginalBps = 0n;

    for (var i = 0; i < brackets.length; i++) {
      var b = brackets[i];
      var upper = (b.upTo === null || b.upTo === undefined) ? incomeCents : BigInt(b.upTo);
      if (upper > incomeCents) upper = incomeCents;
      var slice = upper - lower;
      if (slice < 0n) slice = 0n;
      var bps = BigInt(b.bps);
      var portionTax = roundHalfUp(slice * bps, 10000n); // per-bracket, for display
      if (slice > 0n) {
        taxNumer += slice * bps;
        marginalBps = bps; // the highest bracket actually reached
      }
      perBracket.push({
        from: lower,
        to: (b.upTo === null || b.upTo === undefined) ? null : BigInt(b.upTo),
        bps: bps,
        taxable: slice,
        tax: portionTax
      });
      lower = upper;
      if (upper >= incomeCents) {
        // fill remaining brackets with zero-taxable rows for a complete table
        for (var j = i + 1; j < brackets.length; j++) {
          var bj = brackets[j];
          perBracket.push({
            from: (bj.upTo === null || bj.upTo === undefined) ? incomeCents : null,
            to: (bj.upTo === null || bj.upTo === undefined) ? null : BigInt(bj.upTo),
            bps: BigInt(bj.bps),
            taxable: 0n,
            tax: 0n
          });
        }
        break;
      }
    }

    var tax = roundHalfUp(taxNumer, 10000n);
    var effectiveBps = incomeCents > 0n ? roundHalfUp(tax * 10000n, incomeCents) : 0n;
    return {
      income: incomeCents,
      tax: tax,
      net: incomeCents - tax,
      marginalBps: marginalBps,
      effectiveBps: effectiveBps,
      perBracket: perBracket
    };
  }

  return {
    roundHalfUp: roundHalfUp,
    parseMoney: parseMoney,
    parseRatePercent: parseRatePercent,
    formatMoney: formatMoney,
    formatPercent: formatPercent,
    taxOn: taxOn,
    addTax: addTax,
    removeTax: removeTax,
    validateSchedule: validateSchedule,
    progressiveTax: progressiveTax
  };
});
