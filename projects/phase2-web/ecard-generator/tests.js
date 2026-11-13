'use strict';
/*
 * tests.js — dependency-free checks for ecard-core.js.
 *
 * The emphasis is the serialisation round-trip (the thing an e-card lives or
 * dies by): emoji and accents survive, bad tokens are rejected rather than
 * silently mangled, and share URLs parse back to the same card. Plus word
 * wrapping (packing, hard-break, ellipsis truncation), HTML escaping, and card
 * normalisation. Run: `node tests.js`.
 */
const C = require('./ecard-core.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function eq(name, got, want) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (!good) console.log(`      got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  ok(name, good);
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(name, threw);
}

console.log('\nHTML escaping (Trap 3)');
eq('escapes the five dangerous characters',
   C.escapeHtml(`<img src=x onerror="alert('&')">`),
   '&lt;img src=x onerror=&quot;alert(&#39;&amp;&#39;)&quot;&gt;');
eq('leaves plain text untouched', C.escapeHtml('Happy Birthday!'), 'Happy Birthday!');
eq('null/undefined become empty string', C.escapeHtml(null), '');

console.log('\nUTF-8 codec (Trap 1)');
eq('ASCII round-trips', C.utf8Decode(C.utf8Encode('Hello')), 'Hello');
eq('accented Latin round-trips', C.utf8Decode(C.utf8Encode('café résumé')), 'café résumé');
eq('"é" encodes to two bytes', C.utf8Encode('é'), [0xc3, 0xa9]);
eq('emoji (astral) round-trips', C.utf8Decode(C.utf8Encode('🎂')), '🎂');
eq('"🎂" encodes to four bytes', C.utf8Encode('🎂').length, 4);
eq('CJK round-trips', C.utf8Decode(C.utf8Encode('你好、世界')), '你好、世界');
eq('mixed string round-trips',
   C.utf8Decode(C.utf8Encode('Feliz cumpleaños 🎉🥳 恭喜')), 'Feliz cumpleaños 🎉🥳 恭喜');

console.log('\nbase64url codec (Trap 1)');
eq('empty string', C.encodeB64url(''), '');
eq('"M" -> "TQ" (no padding)', C.encodeB64url('M'), 'TQ');
eq('"Ma" -> "TWE"', C.encodeB64url('Ma'), 'TWE');
eq('"Man" -> "TWFu"', C.encodeB64url('Man'), 'TWFu');
eq('token is URL-safe (no +, /, =)',
   /^[A-Za-z0-9_-]*$/.test(C.encodeB64url('any sub-string?? >>> ???')), true);
eq('base64url round-trips an emoji message',
   C.decodeB64url(C.encodeB64url('🎂 to you! — from 🐝')), '🎂 to you! — from 🐝');
throws('rejects an invalid character', () => C.base64urlToBytes('abc$'));
throws('rejects a truncated single-char group', () => C.base64urlToBytes('A'));

console.log('\nColour validation');
eq('#fff is valid', C.isHexColor('#fff'), true);
eq('#ffaa00 is valid', C.isHexColor('#ffaa00'), true);
eq('"red" is not valid hex', C.isHexColor('red'), false);
eq('#12 is not valid hex', C.isHexColor('#12'), false);
eq('missing # is not valid', C.isHexColor('ffaa00'), false);

console.log('\nclampCard — defaults, bounds, safety');
const c1 = C.clampCard({ occasion: 'birthday', message: 'Hi' });
eq('fills heading from occasion', c1.heading, 'Happy Birthday!');
eq('fills emoji from occasion', c1.emoji, '🎂');
eq('fills gradient from occasion', [c1.bg1, c1.bg2], ['#ff9a9e', '#fecfef']);
eq('unknown occasion falls back to default', C.clampCard({ occasion: 'zzz' }).occasion, 'birthday');
eq('invalid colour is replaced with occasion default',
   C.clampCard({ occasion: 'thankyou', bg1: 'not-a-color' }).bg1, '#a8edea');
eq('unknown font falls back to sans', C.clampCard({ font: 'comic' }).font, 'sans');
const longMsg = 'x'.repeat(400);
eq('message is capped at the limit',
   Array.from(C.clampCard({ message: longMsg }).message).length, C.LIMITS.message);
eq('capping counts emoji as one char (no split surrogate)',
   Array.from(C.cap('🎂'.repeat(10), 3)).join(''), '🎂🎂🎂');

console.log('\nvalidateCard — gentle warnings');
eq('empty message is flagged', C.validateCard({ message: '   ' }).valid, false);
eq('a good card validates', C.validateCard({ message: 'Hello!' }).valid, true);
eq('bad colour is flagged', C.validateCard({ message: 'hi', bg1: 'blue' }).valid, false);

console.log('\nencodeCard / decodeCard round-trip');
const card = {
  occasion: 'congrats',
  heading: 'Congratulations! 🎉',
  message: 'You did it!\nWe are so proud of you 🥳\n— everybody',
  signature: 'From the team',
  emoji: '🎉',
  font: 'script',
  bg1: '#f6d365', bg2: '#fda085', text: '#4a2e14',
};
const token = C.encodeCard(card);
eq('token begins with the version byte', token[0], C.TOKEN_VERSION);
eq('token body is URL-safe', /^[A-Za-z0-9_-]+$/.test(token.slice(1)), true);
const back = C.decodeCard(token);
eq('occasion survives', back.occasion, card.occasion);
eq('heading with emoji survives', back.heading, card.heading);
eq('multi-line message with emoji survives', back.message, card.message);
eq('signature survives', back.signature, card.signature);
eq('font survives', back.font, card.font);
eq('colours survive', [back.bg1, back.bg2, back.text], [card.bg1, card.bg2, card.text]);

console.log('\ndecodeCard — rejects junk');
throws('empty token throws', () => C.decodeCard(''));
throws('wrong version throws', () => C.decodeCard('9abc'));
throws('garbage payload throws', () => C.decodeCard('1$$$'));
ok('non-string returns via throw', (() => { try { C.decodeCard(42); return false; } catch (e) { return true; } })());

console.log('\nShare URL build/parse');
const url = C.buildShareUrl('https://example.com/ecard/', card);
ok('url contains the fragment', url.includes('#card='));
ok('fragment carries the token, not the server path', url.split('#')[0] === 'https://example.com/ecard/');
const parsed = C.parseShareUrl(url);
eq('parsed card matches original message', parsed.message, card.message);
eq('existing fragment is replaced, not appended',
   C.buildShareUrl('https://example.com/ecard/#card=old', card).split('#card=').length, 2);
eq('a URL with no card fragment parses to null', C.parseShareUrl('https://example.com/ecard/'), null);
eq('a URL with a corrupt token parses to null', C.parseShareUrl('https://x/#card=1$$$'), null);

console.log('\nwrapText — packing');
eq('packs words up to the width',
   C.wrapText('the quick brown fox', 9).lines, ['the quick', 'brown fox']);
eq('a short message is a single line',
   C.wrapText('Happy Birthday', 20).lines, ['Happy Birthday']);
eq('preserves explicit line breaks',
   C.wrapText('line one\nline two', 20).lines, ['line one', 'line two']);
eq('collapses runs of spaces',
   C.wrapText('a    b', 20).lines, ['a b']);

console.log('\nwrapText — hard break of an over-long word');
eq('breaks a word longer than the line',
   C.wrapText('supercalifragilistic', 5).lines,
   ['super', 'calif', 'ragil', 'istic']);
eq('breaks the long word but keeps the rest flowing',
   C.wrapText('hi supercalifragilistic bye', 5).lines,
   ['hi', 'super', 'calif', 'ragil', 'istic', 'bye']);

console.log('\nwrapText — truncation with ellipsis');
const tr = C.wrapText('one two three four five six seven', 8, 2);
eq('respects maxLines', tr.lines.length, 2);
eq('flags truncation', tr.truncated, true);
ok('last kept line ends with an ellipsis', tr.lines[1].endsWith('…'));
eq('not truncated when it fits', C.wrapText('a b c', 20, 3).truncated, false);

console.log('\n' + (fail === 0
  ? `✓ all ${pass} checks passing`
  : `✗ ${fail} failed, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
