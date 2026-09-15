/*
 * tests.js — dependency-free suite for card-core.js. Run with:
 *   node projects/phase2-numbers/credit-card-validator/tests.js
 *
 * The core is pure arithmetic and pattern-matching over digit strings, so the
 * suite runs without a browser or a network: the Luhn checksum on known good and
 * bad numbers, the check-digit inverse, network detection across every network's
 * published IIN ranges, length rules, formatting and masking, and a batch of
 * property sweeps — generate()d numbers always validate, a single-digit typo
 * always breaks Luhn, and any adjacent transposition of unequal digits is caught.
 *
 * Every card number below is a standard published *test* number or one produced
 * by generate(); none is a real, issued card.
 */

'use strict';

var C = require('./card-core.js');

var passed = 0, failed = 0;

function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}
function eq(name, got, want) {
  if (got === want) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }
}
function throws(name, fn) {
  try { fn(); failed++; console.error('  FAIL: ' + name + ' (expected throw)'); }
  catch (e) { passed++; }
}

/* Standard published test numbers (all fake, all Luhn-valid). */
var TEST = {
  visa16:      '4111111111111111',
  visa16b:     '4012888888881881',
  visa13:      '4222222222222',
  mastercard:  '5555555555554444',
  mastercard2: '2223003122003222',   // new 2-series range
  amex:        '378282246310005',
  amex2:       '371449635398431',
  discover:    '6011111111111117',
  discover2:   '6011000990139424',
  diners:      '30569309025904',
  diners2:     '38520000023237',
  jcb:         '3530111333300000',
  unionpay:    '6200000000000005'
};

/* ---------- Luhn checksum --------------------------------------------- */

ok('valid Visa passes Luhn', C.isValidLuhn(TEST.visa16));
ok('valid Mastercard passes Luhn', C.isValidLuhn(TEST.mastercard));
ok('valid Amex passes Luhn', C.isValidLuhn(TEST.amex));
ok('valid Discover passes Luhn', C.isValidLuhn(TEST.discover));
ok('Luhn tolerates spaces', C.isValidLuhn('4111 1111 1111 1111'));
ok('Luhn tolerates dashes', C.isValidLuhn('4111-1111-1111-1111'));
ok('one-off number fails Luhn', !C.isValidLuhn('4111111111111112'));
ok('all-zeros passes Luhn (checksum 0)', C.isValidLuhn('00000000'));
eq('checksum of a valid number is 0', C.luhnChecksum(TEST.mastercard), 0);
eq('classic Wikipedia example 79927398713 checksum 0', C.luhnChecksum('79927398713'), 0);
ok('79927398714 is invalid', !C.isValidLuhn('79927398714'));
eq('empty input is not valid', C.isValidLuhn(''), false);
throws('luhnChecksum rejects empty', function () { C.luhnChecksum(''); });
throws('luhnChecksum rejects non-digits', function () { C.luhnChecksum('12a4'); });

/* ---------- check digit is the true inverse of the checksum ----------- */

(function () {
  var allGood = true;
  for (var i = 0; i < 2000; i++) {
    var len = 5 + Math.floor(Math.random() * 14);
    var body = '';
    for (var j = 0; j < len; j++) body += String(Math.floor(Math.random() * 10));
    var cd = C.luhnCheckDigit(body);
    if (cd < 0 || cd > 9) { allGood = false; break; }
    if (!C.isValidLuhn(body + String(cd))) { allGood = false; break; }
  }
  ok('luhnCheckDigit completes any body into a valid number (2000 cases)', allGood);
})();
eq('check digit for 411111111111111 is 1', C.luhnCheckDigit('411111111111111'), 1);

/* ---------- network detection ----------------------------------------- */

eq('Visa detected', C.detectNetwork(TEST.visa16).id, 'visa');
eq('13-digit Visa detected', C.detectNetwork(TEST.visa13).id, 'visa');
eq('Mastercard 5x detected', C.detectNetwork(TEST.mastercard).id, 'mastercard');
eq('Mastercard 2-series detected', C.detectNetwork(TEST.mastercard2).id, 'mastercard');
eq('Amex 34 detected', C.detectNetwork('340000000000009').id, 'amex');
eq('Amex 37 detected', C.detectNetwork(TEST.amex).id, 'amex');
eq('Discover 6011 detected', C.detectNetwork(TEST.discover).id, 'discover');
eq('Discover 65 detected', C.detectNetwork('6500000000000002').id, 'discover');
eq('Diners 30 detected', C.detectNetwork(TEST.diners).id, 'diners');
eq('Diners 36 detected', C.detectNetwork(TEST.diners2).id, 'diners');
eq('JCB 3530 detected', C.detectNetwork(TEST.jcb).id, 'jcb');
eq('UnionPay 62 detected', C.detectNetwork(TEST.unionpay).id, 'unionpay');
eq('unknown prefix -> null', C.detectNetwork('9999999999999999'), null);
eq('empty -> null network', C.detectNetwork(''), null);

/* Mastercard 2-series boundaries: 222100..272099 in, 221099 & 272100 out. */
eq('222100 is Mastercard', C.detectNetwork('2221001234567890').id, 'mastercard');
eq('272099 is Mastercard', C.detectNetwork('2720991234567890').id, 'mastercard');
ok('222099 is NOT Mastercard', (C.detectNetwork('2220991234567890') || {}).id !== 'mastercard');
ok('272100 is NOT Mastercard', (C.detectNetwork('2721001234567890') || {}).id !== 'mastercard');

/* Detection must not require a correct length or a passing Luhn. */
eq('detects network on a too-short partial', C.detectNetwork('4111').id, 'visa');
eq('detects network even when Luhn fails', C.detectNetwork('4111111111111112').id, 'visa');

/* ---------- length rules & validate() --------------------------------- */

Object.keys(TEST).forEach(function (k) {
  var r = C.validate(TEST[k]);
  ok('validate(' + k + ') is valid', r.valid);
  ok('validate(' + k + ') has no errors', r.errors.length === 0);
  ok('validate(' + k + ') names a network', r.network && r.network.id);
});

(function () {
  // A 15-digit Visa: right prefix, wrong length, and here also Luhn-broken.
  var r = C.validate('411111111111111');
  eq('short Visa network still visa', r.network.id, 'visa');
  ok('short Visa flagged length-invalid', r.lengthValid === false);
  ok('short Visa not valid overall', !r.valid);
})();

(function () {
  // Visa prefix, valid Luhn, but 14 digits (a length Visa never issues).
  var body = '4111111111111'; // 13 digits, add a 14th check digit -> 14 total
  var num = body + String(C.luhnCheckDigit(body));
  var r = C.validate(num);
  ok('14-digit Visa passes Luhn', r.luhnValid);
  ok('14-digit Visa fails length', r.lengthValid === false);
  ok('14-digit Visa invalid overall', !r.valid);
  ok('14-digit Visa error mentions length', r.errors.join(' ').indexOf('digits long') !== -1);
})();

(function () {
  var r = C.validate('');
  ok('empty validate not valid', !r.valid);
  eq('empty validate length 0', r.length, 0);
  ok('empty validate has an error', r.errors.length > 0);
})();

(function () {
  var r = C.validate('9999999999999999'); // unknown network, and fails Luhn too
  ok('unknown-network number invalid', !r.valid);
  ok('unknown-network error mentions network', r.errors.join(' ').toLowerCase().indexOf('network') !== -1);
})();

/* validate should accept a number passed as a Number, not only a string. */
ok('validate accepts a numeric argument', C.validate(4111111111111111).luhnValid === false ||
   C.validate(4111111111111111).digits.length > 0); // (float precision aside, it must not throw)

/* ---------- formatting & masking -------------------------------------- */

eq('Visa formats in groups of four', C.format(TEST.visa16), '4111 1111 1111 1111');
eq('Amex formats 4-6-5', C.format(TEST.amex), '3782 822463 10005');
eq('Diners formats 4-6-4', C.format(TEST.diners), '3056 930902 5904');
eq('format with dash separator', C.format(TEST.visa16, { separator: '-' }), '4111-1111-1111-1111');
eq('format of empty is empty', C.format(''), '');
eq('unknown network falls back to fours', C.format('9999999999999999'), '9999 9999 9999 9999');

eq('mask shows last four of Visa', C.mask(TEST.visa16), '•••• •••• •••• 1111');
eq('Amex mask keeps 4-6-5 grouping', C.mask(TEST.amex), '•••• •••••• •0005');
ok('mask hides everything but the tail', C.mask(TEST.visa16).indexOf('4111') === -1);
eq('mask visibleLast=0 hides all', C.mask('4111111111111111', { visibleLast: 0 }).replace(/[ ]/g, ''),
   '••••••••••••••••');

/* ---------- generate() ------------------------------------------------ */

C.networkIds().forEach(function (id) {
  var num = C.generate(id, { rand: mulberry32(42 + id.length) });
  var r = C.validate(num);
  ok('generate(' + id + ') passes Luhn', r.luhnValid);
  ok('generate(' + id + ') is valid overall', r.valid);
  eq('generate(' + id + ') detected as ' + id, r.network.id, id);
});
throws('generate rejects unknown network', function () { C.generate('nope'); });
throws('generate rejects a bad explicit length', function () { C.generate('amex', { length: 16 }); });

(function () {
  // 1000 random generated Visas must all validate.
  var rand = mulberry32(1);
  var allValid = true;
  for (var i = 0; i < 1000; i++) {
    if (!C.validate(C.generate('visa', { rand: rand })).valid) { allValid = false; break; }
  }
  ok('1000 generated Visas all validate', allValid);
})();

/* ---------- property: a single-digit typo breaks Luhn ----------------- */

(function () {
  var rand = mulberry32(7);
  var broke = 0, tried = 0;
  for (var i = 0; i < 500; i++) {
    var num = C.generate('mastercard', { rand: rand }); // 16 valid digits
    var pos = Math.floor(rand() * num.length);
    var orig = num.charAt(pos);
    var repl = String((Number(orig) + 1 + Math.floor(rand() * 9)) % 10); // a *different* digit
    if (repl === orig) continue;
    tried++;
    var typo = num.slice(0, pos) + repl + num.slice(pos + 1);
    if (!C.isValidLuhn(typo)) broke++;
  }
  // Luhn catches 100% of single-digit substitution errors.
  eq('every single-digit typo breaks Luhn', broke, tried);
})();

/* ---------- property: adjacent transpositions of unequal digits ------- */

(function () {
  // Luhn catches all adjacent transpositions except the pair 0<->9 (a known,
  // documented blind spot). Verify: it catches every other unequal-adjacent swap.
  var rand = mulberry32(99);
  var missedNon09 = 0, checked = 0;
  for (var i = 0; i < 400; i++) {
    var num = C.generate('visa', { rand: rand });
    var pos = Math.floor(rand() * (num.length - 1));
    var a = num.charAt(pos), b = num.charAt(pos + 1);
    if (a === b) continue;
    var swapped = num.slice(0, pos) + b + a + num.slice(pos + 2);
    if (swapped === num) continue;
    var isPair09 = (a === '0' && b === '9') || (a === '9' && b === '0');
    checked++;
    if (C.isValidLuhn(swapped) && !isPair09) missedNon09++;
  }
  ok('checked a batch of transpositions', checked > 100);
  eq('Luhn catches every non-(0,9) adjacent transposition', missedNon09, 0);
})();

/* A tiny seeded PRNG so generation/property tests are deterministic. */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- summary --------------------------------------------------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
