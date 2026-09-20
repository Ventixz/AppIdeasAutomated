/*
 * tests.js — dependency-free suite for names-core.js. Run with:
 *   node projects/phase2-numbers/number-names/tests.js
 *
 * Naming a number is an *exact* problem, so this suite checks concrete strings,
 * not tolerances: the small irregulars, the group boundaries where scale words
 * appear, the Conway–Wechsler -illion names (up to centillion), negatives,
 * decimals, ordinals and money. The strongest check is the round-trip — spell a
 * value out with `cardinal`, read it back with `parse`, and require the original
 * integer — run across every value in a range and a spread of huge BigInts.
 */

'use strict';

var N = require('./names-core.js');

var passed = 0, failed = 0;
function show(v) { return typeof v === 'bigint' ? v.toString() + 'n' : JSON.stringify(v); }
function eq(name, got, want) {
  var g = show(got), w = show(want);
  if (g === w) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + '\n        got  ' + g + '\n        want ' + w); }
}
function ok(name, cond) {
  if (cond) { passed++; } else { failed++; console.error('  FAIL: ' + name); }
}
function throws(name, fn) {
  try { fn(); failed++; console.error('  FAIL: ' + name + ' (expected throw)'); }
  catch (e) { passed++; }
}

/* ---- the small irregulars ------------------------------------------------ */
eq('0', N.cardinal(0), 'zero');
eq('7', N.cardinal(7), 'seven');
eq('13', N.cardinal(13), 'thirteen');
eq('19', N.cardinal(19), 'nineteen');
eq('20', N.cardinal(20), 'twenty');
eq('21', N.cardinal(21), 'twenty-one');
eq('42', N.cardinal(42), 'forty-two');
eq('70', N.cardinal(70), 'seventy');
eq('99', N.cardinal(99), 'ninety-nine');
eq('100', N.cardinal(100), 'one hundred');
eq('101', N.cardinal(101), 'one hundred one');
eq('115', N.cardinal(115), 'one hundred fifteen');
eq('999', N.cardinal(999), 'nine hundred ninety-nine');

/* ---- group boundaries (where scale words appear) ------------------------- */
eq('1000', N.cardinal(1000), 'one thousand');
eq('1234', N.cardinal(1234), 'one thousand two hundred thirty-four');
eq('12345', N.cardinal(12345), 'twelve thousand three hundred forty-five');
eq('100000', N.cardinal(100000), 'one hundred thousand');
eq('1000000', N.cardinal(1000000), 'one million');
eq('1000001', N.cardinal(1000001), 'one million one');
eq('2000003', N.cardinal(2000003), 'two million three');
eq('1000000000', N.cardinal(1000000000), 'one billion');
// the classic mouthful
eq('1234567890',
   N.cardinal(1234567890),
   'one billion two hundred thirty-four million five hundred sixty-seven thousand eight hundred ninety');
// a zero middle group must not emit an empty "thousand"
eq('1000123', N.cardinal(1000123), 'one million one hundred twenty-three');
eq('1002003', N.cardinal(1002003), 'one million two thousand three');

/* ---- big integers, exact (BigInt + string inputs) ------------------------ */
eq('1e15 as string', N.cardinal('1000000000000000'), 'one quadrillion');
eq('BigInt 10^18', N.cardinal(10n ** 18n), 'one quintillion');
eq('10^21', N.cardinal(10n ** 21n), 'one sextillion');
eq('10^24', N.cardinal(10n ** 24n), 'one septillion');
eq('10^27', N.cardinal(10n ** 27n), 'one octillion');
eq('10^30', N.cardinal(10n ** 30n), 'one nonillion');
eq('10^33', N.cardinal(10n ** 33n), 'one decillion');
// separators tolerated on string input
eq('grouped string 12,345,678', N.cardinal('12,345,678'),
   'twelve million three hundred forty-five thousand six hundred seventy-eight');
// a googol = 10^100 -> group 33 (index 32) -> "ten duotrigintillion"
eq('googol (10^100)', N.cardinal(10n ** 100n), 'ten duotrigintillion');

/* ---- Conway–Wechsler -illion names -------------------------------------- */
// index -> name (index z lives at 10^(3z+3))
eq('illion 1 = million', N.illionName(1), 'million');
eq('illion 2 = billion', N.illionName(2), 'billion');
eq('illion 5 = quintillion', N.illionName(5), 'quintillion');
eq('illion 10 = decillion', N.illionName(10), 'decillion');
eq('illion 11 = undecillion', N.illionName(11), 'undecillion');
eq('illion 13 = tredecillion', N.illionName(13), 'tredecillion');
eq('illion 20 = vigintillion', N.illionName(20), 'vigintillion');
eq('illion 21 = unvigintillion', N.illionName(21), 'unvigintillion');
eq('illion 23 = tresvigintillion', N.illionName(23), 'tresvigintillion');
eq('illion 26 = sesvigintillion', N.illionName(26), 'sesvigintillion');
eq('illion 27 = septemvigintillion', N.illionName(27), 'septemvigintillion');
eq('illion 30 = trigintillion', N.illionName(30), 'trigintillion');
eq('illion 100 = centillion', N.illionName(100), 'centillion');
eq('illion 101 = uncentillion', N.illionName(101), 'uncentillion');
eq('illion 103 = trescentillion', N.illionName(103), 'trescentillion');
eq('illion 106 = sexcentillion', N.illionName(106), 'sexcentillion');
// centillion is 10^303 -> group 101 -> illion index 100
eq('centillion is 10^303', N.cardinal(10n ** 303n), 'one centillion');
throws('beyond the named scale throws', function () { N.illionName(1000); });
throws('a 3010-digit number throws (out of named scale)', function () { N.cardinal(10n ** 3009n); });

/* ---- negatives and the decimal point (numberPhrase) ---------------------- */
eq('-5', N.numberPhrase(-5), 'negative five');
eq('-0 is just zero', N.numberPhrase('-0'), 'zero');
eq('3.14', N.numberPhrase('3.14'), 'three point one four');
eq('0.5', N.numberPhrase('0.5'), 'zero point five');
eq('leading-dot .5', N.numberPhrase('.5'), 'zero point five');
eq('-12.05', N.numberPhrase('-12.05'), 'negative twelve point zero five');
eq('trailing dot 42.', N.numberPhrase('42.'), 'forty-two');
eq('1000.001', N.numberPhrase('1000.001'), 'one thousand point zero zero one');
throws('numberPhrase rejects letters', function () { N.numberPhrase('12x'); });
throws('numberPhrase rejects a lone dot', function () { N.numberPhrase('.'); });

/* ---- ordinals ------------------------------------------------------------ */
eq('1st', N.ordinal(1), 'first');
eq('2nd', N.ordinal(2), 'second');
eq('3rd', N.ordinal(3), 'third');
eq('4th', N.ordinal(4), 'fourth');
eq('5th', N.ordinal(5), 'fifth');
eq('8th', N.ordinal(8), 'eighth');
eq('9th', N.ordinal(9), 'ninth');
eq('12th', N.ordinal(12), 'twelfth');
eq('20th', N.ordinal(20), 'twentieth');
eq('21st', N.ordinal(21), 'twenty-first');
eq('40th', N.ordinal(40), 'fortieth');
eq('100th', N.ordinal(100), 'one hundredth');
eq('101st', N.ordinal(101), 'one hundred first');
eq('1000th', N.ordinal(1000), 'one thousandth');
eq('1000000th', N.ordinal(1000000), 'one millionth');
eq('0th', N.ordinal(0), 'zeroth');

/* ---- currency ------------------------------------------------------------ */
eq('$1.00', N.currency('1.00'), 'one dollar and zero cents');
eq('$1.01', N.currency('1.01'), 'one dollar and one cent');
eq('$0.50', N.currency('0.50'), 'zero dollars and fifty cents');
eq('$2', N.currency('2'), 'two dollars and zero cents');
eq('$1234.5', N.currency('1234.5'),
   'one thousand two hundred thirty-four dollars and fifty cents');
eq('$ with symbol and commas', N.currency('$1,000.99'),
   'one thousand dollars and ninety-nine cents');
// rounding half-up from the third decimal, carrying into dollars
eq('rounds 0.005 -> 1 cent', N.currency('0.005'), 'zero dollars and one cent');
eq('rounds 0.999 -> $1.00', N.currency('0.999'), 'one dollar and zero cents');
eq('euros via opts', N.currency('5.20', { major: 'euro', minor: 'cent' }),
   'five euros and twenty cents');

/* ---- parse: English -> BigInt ------------------------------------------- */
eq('parse "zero"', N.parse('zero'), 0n);
eq('parse "seven"', N.parse('seven'), 7n);
eq('parse "twenty-three"', N.parse('twenty-three'), 23n);
eq('parse with "and"', N.parse('one hundred and five'), 105n);
eq('parse a mouthful',
   N.parse('one billion two hundred thirty-four million five hundred sixty-seven thousand eight hundred ninety'),
   1234567890n);
eq('parse "two million three thousand and one"',
   N.parse('two million three thousand and one'), 2003001n);
eq('parse negative', N.parse('negative forty-two'), -42n);
eq('parse "one centillion"', N.parse('one centillion'), 10n ** 303n);
throws('parse rejects gibberish', function () { N.parse('one flurb'); });

/* ---- the big one: round-trip cardinal <-> parse -------------------------- */
(function () {
  var bad = null;
  for (var n = 0; n <= 5000 && bad === null; n++) {
    if (N.parse(N.cardinal(n)) !== BigInt(n)) bad = n;
  }
  ok('round-trip cardinal/parse for every n in 0..5000', bad === null);
  if (bad !== null) console.error('        first failure at n = ' + bad);
})();

(function () {
  // a spread across every group boundary and some awkward interior zeros
  var samples = [
    999n, 1000n, 1001n, 1000000n, 999999999n, 1000000001n,
    123456789012345678901234567890n,
    10n ** 50n, (10n ** 50n) + 7n,
    10n ** 100n, 10n ** 303n, (10n ** 303n) + 123n,
    -98765432109876543210n
  ];
  var bad = null;
  for (var i = 0; i < samples.length && bad === null; i++) {
    if (N.parse(N.cardinal(samples[i])) !== samples[i]) bad = samples[i];
  }
  ok('round-trip for a spread of huge BigInts', bad === null);
  if (bad !== null) console.error('        failed at ' + bad);
})();

/* ---- input validation ---------------------------------------------------- */
throws('cardinal rejects a decimal Number', function () { N.cardinal(3.5); });
throws('cardinal rejects an unsafe Number', function () { N.cardinal(Number.MAX_SAFE_INTEGER + 2); });
throws('cardinal rejects letters in a string', function () { N.cardinal('12x'); });
ok('cardinal accepts BigInt, Number and string alike',
   N.cardinal(12345n) === N.cardinal(12345) && N.cardinal(12345) === N.cardinal('12345'));

/* ---- summary ------------------------------------------------------------- */
console.log('\n' + (failed === 0 ? 'ALL PASSED' : 'FAILURES') +
            ': ' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
