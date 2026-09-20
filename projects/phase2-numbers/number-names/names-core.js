/*
 * names-core.js — the DOM-free core of the Number Names project.
 *
 * The brief (karan/Projects → Numbers) is short: "Number Names — given a number,
 * spell it out in words." `1234` becomes *one thousand two hundred thirty-four*.
 * The whole difficulty is hiding in the word "number": how big is it allowed to
 * be, and does it have a sign, a decimal point, or a place in a sentence?
 *
 * This core answers all of those honestly:
 *
 *   1. **Arbitrarily large integers, exactly.** Everything runs on `BigInt`, so a
 *      200-digit integer is named to the last digit — no float, no rounding, no
 *      `Infinity`. The scale words (thousand, million, billion, …) are not a
 *      hard-coded list that runs out at "quintillion": beyond the everyday names
 *      the code *generates* the Latin -illion names by the
 *      **Conway–Wechsler system**, so it can name any group up to a centillion
 *      (10^303) and on to 10^3002 — a genuinely open-ended range rather than a
 *      lookup table with a cliff at the end.
 *
 *   2. **The whole "number", not just the integer.** It reads negatives
 *      ("negative twelve"), a decimal point digit-by-digit the way people say it
 *      ("twelve point zero five"), ordinals ("twenty-third", "one hundredth"),
 *      and money ("one thousand dollars and fifty cents").
 *
 *   3. **Both directions.** Spelling a number out is only half of it — the core
 *      also *parses* an English phrase back to a `BigInt` ("two million three
 *      thousand and one" → 2003001n), which is what lets the test suite prove the
 *      naming is right by round-tripping millions of values through both halves.
 *
 * This file is deliberately DOM-free, I/O-free and console-free: no `document`,
 * no `window` beyond the export, no `fetch`. It runs identically in a browser
 * (via a `<script>` tag, exporting onto `window.NamesCore`) and in Node (via
 * `require`), so the suite in `tests.js` can prove its properties with no browser
 * and no network.
 */

'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NamesCore = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---- the small dictionary ------------------------------------------------
   * Everything below one thousand is built from just these two rows: the words
   * 0..19 (English is irregular up to nineteen), and the tens.
   */
  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
              'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
              'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
              'eighty', 'ninety'];

  // A number 1..99 in words. "twenty-three" is hyphenated, per convention.
  function twoDigit(n) {
    if (n < 20) return ONES[n];
    var t = Math.floor(n / 10), u = n % 10;
    return TENS[t] + (u ? '-' + ONES[u] : '');
  }

  // A number 1..999 in words, no scale word. "one hundred five" (US style, no
  // "and"): the parser below accepts "and", but naming leaves it out.
  function threeDigit(n) {
    var out = [];
    var h = Math.floor(n / 100), r = n % 100;
    if (h) out.push(ONES[h] + ' hundred');
    if (r) out.push(twoDigit(r));
    return out.join(' ');
  }

  /* ---- the -illion scale names (Conway–Wechsler) ---------------------------
   * A "group" is a block of three decimal digits. Group g (0-based from the
   * right) has place value 1000^g. Group 0 has no scale word; group 1 is
   * "thousand"; group g >= 2 uses the (g-1)-th -illion (million = 1st, billion =
   * 2nd, …). We generate that -illion name rather than storing a finite list.
   *
   * The everyday names million..nonillion (illion index 1..9) are irregular and
   * kept as literal roots. From 10 up, the name is assembled from Latin roots for
   * the units, tens and hundreds of the index, with the Conway–Wechsler
   * combining letters, then a trailing vowel is dropped and "illion" added. So
   * index 100 -> "cent" -> "centillion" (10^303), the classic landmark.
   */
  var SMALL_ILLION = { 1: 'mi', 2: 'bi', 3: 'tri', 4: 'quadri', 5: 'quinti',
                       6: 'sexti', 7: 'septi', 8: 'octi', 9: 'noni' };

  var UNIT_ROOTS = ['', 'un', 'duo', 'tre', 'quattuor', 'quin', 'se', 'septe', 'octo', 'nove'];

  // Each tens/hundreds root carries the set of "combining letters" it accepts
  // from a preceding unit (3, 6, 7 or 9). This is the crux of the system.
  var TENS_ROOT = [null,
    { r: 'deci', m: 'n' }, { r: 'viginti', m: 'ms' }, { r: 'triginta', m: 'ns' },
    { r: 'quadraginta', m: 'ns' }, { r: 'quinquaginta', m: 'ns' },
    { r: 'sexaginta', m: 'ns' }, { r: 'septuaginta', m: 'ns' },
    { r: 'octoginta', m: 'mx' }, { r: 'nonaginta', m: 'ns' }];
  var HUND_ROOT = [null,
    { r: 'centi', m: 'nx' }, { r: 'ducenti', m: 'n' }, { r: 'trecenti', m: 'ns' },
    { r: 'quadringenti', m: 'ns' }, { r: 'quingenti', m: 'ns' },
    { r: 'sescenti', m: 'n' }, { r: 'septingenti', m: 'n' },
    { r: 'octingenti', m: 'mx' }, { r: 'nongenti', m: 'n' }];

  // The unit root, grown by a combining letter when the following component
  // (the tens root, or the hundreds root when there are no tens) accepts one:
  //   3 tre  -> tres  before s or x
  //   6 se   -> ses   before s ; sex before x
  //   7 septe-> septem before m ; septen before n
  //   9 nove -> novem  before m ; noven before n
  function unitRoot(u, mark) {
    if (!mark) return UNIT_ROOTS[u];
    if (u === 3) return (mark.indexOf('s') >= 0 || mark.indexOf('x') >= 0) ? 'tres' : 'tre';
    if (u === 6) { if (mark.indexOf('x') >= 0) return 'sex'; if (mark.indexOf('s') >= 0) return 'ses'; return 'se'; }
    if (u === 7) { if (mark.indexOf('m') >= 0) return 'septem'; if (mark.indexOf('n') >= 0) return 'septen'; return 'septe'; }
    if (u === 9) { if (mark.indexOf('m') >= 0) return 'novem'; if (mark.indexOf('n') >= 0) return 'noven'; return 'nove'; }
    return UNIT_ROOTS[u];
  }

  // The Latin root stem for an index 1..999 (units + tens + hundreds), before
  // the trailing-vowel trim and "illion" suffix.
  function illionStem(z) {
    var u = z % 10, t = Math.floor(z / 10) % 10, h = Math.floor(z / 100) % 10;
    var next = t ? TENS_ROOT[t].m : (h ? HUND_ROOT[h].m : '');
    var s = unitRoot(u, next);
    if (t) s += TENS_ROOT[t].r;
    if (h) s += HUND_ROOT[h].r;
    return s;
  }

  var illionCache = Object.create(null);
  // The name of the z-th -illion (z >= 1): million (1), billion (2), …,
  // centillion (100). Beyond index 999 (numbers past ~10^3002) we stop rather
  // than emit a name Conway–Wechsler would spell by chaining, which is out of
  // scope here; the caller turns this into a clear error.
  function illionName(z) {
    if (typeof z !== 'number' || !Number.isInteger(z) || z < 1) {
      throw new RangeError('illion index must be a positive integer');
    }
    if (z > 999) throw new RangeError('number is beyond the named scale (10^3003)');
    if (illionCache[z]) return illionCache[z];
    var name;
    if (z <= 9) name = SMALL_ILLION[z] + 'llion';
    else name = illionStem(z).replace(/[aeiou]$/, '') + 'illion';
    illionCache[z] = name;
    return name;
  }

  // The scale word for group g: '' (units), 'thousand' (g=1) or an -illion.
  function scaleWord(g) {
    if (g === 0) return '';
    if (g === 1) return 'thousand';
    return illionName(g - 1);
  }

  /* ---- input coercion ------------------------------------------------------
   * Accept a Number (must be a safe integer), a BigInt, or a string of digits
   * with an optional sign and grouping separators. Decimals are rejected here —
   * `numberPhrase` handles the fractional part; `cardinal` is integers only.
   */
  function toBigInt(input) {
    if (typeof input === 'bigint') return input;
    if (typeof input === 'number') {
      if (!Number.isInteger(input)) throw new RangeError('not an integer — use numberPhrase for decimals');
      if (!Number.isSafeInteger(input)) throw new RangeError('number too large as a Number — pass a string or BigInt');
      return BigInt(input);
    }
    if (typeof input === 'string') {
      var s = input.trim().replace(/[,_\s]/g, '');
      if (!/^[+-]?\d+$/.test(s)) throw new RangeError('not an integer: "' + input + '"');
      return BigInt(s);
    }
    throw new TypeError('n must be a number, bigint or string');
  }

  /* ---- cardinal: the main event -------------------------------------------
   * Split the integer into 3-digit groups (least significant first), name each
   * non-zero group, and append its scale word. Everything is BigInt, so this is
   * exact for any size the scale can name.
   */
  function cardinal(input) {
    var n = toBigInt(input);
    if (n === 0n) return 'zero';
    var neg = n < 0n;
    if (neg) n = -n;

    var groups = [];
    while (n > 0n) { groups.push(Number(n % 1000n)); n = n / 1000n; }

    var parts = [];
    for (var g = groups.length - 1; g >= 0; g--) {
      var val = groups[g];
      if (val === 0) continue;
      var w = threeDigit(val);
      var sc = scaleWord(g);
      parts.push(sc ? w + ' ' + sc : w);
    }
    return (neg ? 'negative ' : '') + parts.join(' ');
  }

  /* ---- ordinal -------------------------------------------------------------
   * The ordinal only changes the final word: cardinal "twenty-three" ->
   * "twenty-third", "one hundred" -> "one hundredth", "one million" ->
   * "one millionth". A handful of irregulars, then "y"->"ieth", else "+th".
   */
  var ORD_SPECIAL = { one: 'first', two: 'second', three: 'third', five: 'fifth',
                      eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  function ordinalizeWord(w) {
    if (ORD_SPECIAL[w]) return ORD_SPECIAL[w];
    if (/y$/.test(w)) return w.replace(/y$/, 'ieth');
    return w + 'th';
  }
  function ordinal(input) {
    var c = cardinal(input);
    var sp = c.split(' ');
    var last = sp[sp.length - 1];
    if (last.indexOf('-') >= 0) {
      var hp = last.split('-');
      hp[hp.length - 1] = ordinalizeWord(hp[hp.length - 1]);
      sp[sp.length - 1] = hp.join('-');
    } else {
      sp[sp.length - 1] = ordinalizeWord(last);
    }
    return sp.join(' ');
  }

  /* ---- numberPhrase: signs and the decimal point --------------------------
   * The integer part is a cardinal; the fractional part is read digit by digit
   * after the word "point", the way people actually say decimals ("point zero
   * five", not "five hundredths"). A lone leading/trailing dot is tolerated.
   */
  function numberPhrase(input) {
    var s = String(input).trim().replace(/[,_\s]/g, '');
    var neg = false;
    if (s.charAt(0) === '+') s = s.slice(1);
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (s === '' || s === '.' || !/^\d*\.?\d*$/.test(s)) throw new RangeError('not a number: "' + input + '"');

    var dot = s.indexOf('.');
    var intPart = dot < 0 ? s : s.slice(0, dot);
    var frac = dot < 0 ? '' : s.slice(dot + 1);

    intPart = intPart.replace(/^0+(?=\d)/, '');
    if (intPart === '') intPart = '0';

    var words = cardinal(intPart);
    if (frac.length) {
      var digs = frac.split('').map(function (d) { return ONES[+d]; }).join(' ');
      words += ' point ' + digs;
    }

    var nonZero = intPart !== '0' || /[1-9]/.test(frac);
    if (neg && nonZero) words = 'negative ' + words;
    return words;
  }

  /* ---- currency ------------------------------------------------------------
   * Money is a fixed-point quantity, so the cents are computed exactly (the whole
   * part stays BigInt) and rounded half-up from the third decimal, carrying into
   * the dollars when the cents round to 100. Units pluralise on 1.
   */
  function currency(input, opts) {
    opts = opts || {};
    var major = opts.major || 'dollar', minor = opts.minor || 'cent';
    var s = String(input).trim().replace(/[$,_\s]/g, '');
    var neg = false;
    if (s.charAt(0) === '+') s = s.slice(1);
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (s === '' || s === '.' || !/^\d*\.?\d*$/.test(s)) throw new RangeError('not an amount: "' + input + '"');

    var dot = s.indexOf('.');
    var whole = dot < 0 ? s : s.slice(0, dot);
    var frac = dot < 0 ? '' : s.slice(dot + 1);
    whole = whole.replace(/^0+(?=\d)/, '');
    if (whole === '') whole = '0';

    var wholeB = BigInt(whole);
    var c0 = +(frac.charAt(0) || 0), c1 = +(frac.charAt(1) || 0), c2 = +(frac.charAt(2) || 0);
    var cents = c0 * 10 + c1;
    if (c2 >= 5) { cents++; if (cents === 100) { cents = 0; wholeB += 1n; } }

    var majorWord = major + (wholeB === 1n ? '' : 's');
    var minorWord = minor + (cents === 1 ? '' : 's');
    var out = cardinal(wholeB) + ' ' + majorWord + ' and ' + cardinal(cents) + ' ' + minorWord;
    if (neg && (wholeB > 0n || cents > 0)) out = 'negative ' + out;
    return out;
  }

  /* ---- parse: English phrase back to a BigInt ------------------------------
   * The inverse of `cardinal`. Words accumulate into a running "current" group;
   * "hundred" multiplies it by 100; a scale word (thousand/-illion) flushes the
   * current group times that scale into the result. "and" is ignored, hyphens
   * are split. This is what the suite uses to prove naming by round-tripping.
   */
  var SMALL_MAP = null, TENS_MAP = null, SCALE_MAP = null;
  function buildMaps() {
    if (SMALL_MAP) return;
    SMALL_MAP = Object.create(null);
    for (var i = 0; i < ONES.length; i++) SMALL_MAP[ONES[i]] = i;
    TENS_MAP = Object.create(null);
    for (var t = 2; t < TENS.length; t++) TENS_MAP[TENS[t]] = t * 10;
    SCALE_MAP = Object.create(null);
    SCALE_MAP['thousand'] = 1000n;
    var scale = 1000n;
    // -illion index z corresponds to group g = z+1, place value 1000^(z+1).
    for (var z = 1; z <= 999; z++) {
      scale *= 1000n; // now 1000^(z+1)
      SCALE_MAP[illionName(z)] = scale;
    }
  }

  function parse(phrase) {
    buildMaps();
    var s = String(phrase).toLowerCase().trim();
    if (s === '') throw new RangeError('empty phrase');
    s = s.replace(/-/g, ' ').replace(/,/g, ' ');
    var toks = s.split(/\s+/).filter(function (w) { return w && w !== 'and'; });
    if (!toks.length) throw new RangeError('no number words found');

    var neg = false, result = 0n, current = 0n, saw = false;
    for (var i = 0; i < toks.length; i++) {
      var w = toks[i];
      if ((w === 'negative' || w === 'minus') && i === 0) { neg = true; continue; }
      if (SMALL_MAP[w] !== undefined) { current += BigInt(SMALL_MAP[w]); saw = true; }
      else if (TENS_MAP[w] !== undefined) { current += BigInt(TENS_MAP[w]); saw = true; }
      else if (w === 'hundred') { current = (current === 0n ? 1n : current) * 100n; saw = true; }
      else if (SCALE_MAP[w] !== undefined) { result += (current === 0n ? 1n : current) * SCALE_MAP[w]; current = 0n; saw = true; }
      else throw new RangeError('unknown number word: "' + w + '"');
    }
    if (!saw) throw new RangeError('no number words found');
    result += current;
    return neg ? -result : result;
  }

  return {
    // naming
    cardinal: cardinal,
    ordinal: ordinal,
    numberPhrase: numberPhrase,
    currency: currency,
    // the reverse
    parse: parse,
    // building blocks (exposed for the suite)
    twoDigit: twoDigit,
    threeDigit: threeDigit,
    illionName: illionName,
    scaleWord: scaleWord,
    toBigInt: toBigInt
  };
});
