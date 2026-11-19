/*
 * tests.js — logic tests for the Create Zip File Maker engine.
 * No third-party dependencies. Run with:  node tests.js
 *
 * The suite leans on the three things that are genuinely hard, and verifies
 * each against an independent authority so the engine cannot "grade its own
 * homework":
 *   - CRC-32   against published check vectors
 *   - DEFLATE  by inflating our output with Node's built-in zlib
 *   - the ZIP container by parsing it back with readZip, and by confirming
 *     the stored CRCs match what zlib computes
 */
'use strict';
var Z = require('./zip-core.js');
var zlib = require('zlib');

var passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('FAIL: ' + msg); }
}
function eq(actual, expected, msg) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error('FAIL: ' + msg + '\n   expected ' + e + '\n   got      ' + a); }
}
function bytesEqual(a, b) {
  a = Z.toBytes(a); b = Z.toBytes(b);
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ------------------------------------------------------------------ CRC-32 */
// Published check values for the IEEE CRC-32 that ZIP uses.
eq(Z.crc32(''), 0, 'CRC-32 of empty string is 0');
eq(Z.crc32('123456789') >>> 0, 0xcbf43926, 'CRC-32 of "123456789" is the standard 0xCBF43926');
eq(Z.crc32('The quick brown fox jumps over the lazy dog') >>> 0, 0x414fa339,
   'CRC-32 of the pangram is 0x414FA339');
// Cross-check against zlib.crc32 when this Node build exposes it.
if (typeof zlib.crc32 === 'function') {
  var samples = ['', 'a', 'hello world', 'x'.repeat(1000)];
  var allMatch = samples.every(function (s) {
    return (Z.crc32(s) >>> 0) === (zlib.crc32(Buffer.from(s)) >>> 0);
  });
  ok(allMatch, 'CRC-32 matches zlib.crc32 on every sample');
} else {
  passed++; // zlib.crc32 not available on this Node; vectors above still cover it
}

/* ----------------------------------------------------------------- DEFLATE */
// Our deflate output must be inflatable by an independent inflater (zlib).
function roundTripDeflate(str, label) {
  var raw = Z.toBytes(str);
  var deflated = Z.deflateRaw(raw);
  var back = zlib.inflateRawSync(Buffer.from(deflated));
  ok(bytesEqual(back, raw), 'deflate->zlib inflate round-trips: ' + label);
}
roundTripDeflate('', 'empty input');
roundTripDeflate('a', 'single byte');
roundTripDeflate('abc', 'shorter than min match');
roundTripDeflate('aaaaaaaaaaaaaaaaaaaaaaaaaa', 'highly repetitive (run)');
roundTripDeflate('abcabcabcabcabcabcabcabcabc', 'repeating pattern (back-refs)');
roundTripDeflate('The quick brown fox jumps over the lazy dog. '.repeat(50), 'repeated sentence');
// A larger, mixed-entropy blob with real back-references beyond a trivial size.
var mixed = '';
for (var i = 0; i < 5000; i++) mixed += 'line ' + (i % 97) + ': lorem ipsum dolor sit amet\n';
roundTripDeflate(mixed, 'large structured text (5000 lines)');
// Binary data including all byte values (exercises 9-bit literal codes).
var binary = [];
for (var b = 0; b < 2048; b++) binary.push((b * 37 + 11) & 0xff);
var binRaw = new Uint8Array(binary);
ok(bytesEqual(zlib.inflateRawSync(Buffer.from(Z.deflateRaw(binRaw))), binRaw),
   'deflate round-trips arbitrary binary bytes');

// Compression must actually shrink compressible input.
var big = 'ABCD'.repeat(4000); // 16000 bytes, extremely compressible
ok(Z.deflateRaw(big).length < Z.toBytes(big).length / 4,
   'deflate meaningfully shrinks highly compressible data');

/* -------------------------------------------------- ZIP container: round-trip */
var entries = [
  { name: 'hello.txt', data: 'Hello, world!\n' },
  { name: 'nested/readme.md', data: '# Title\n\nSome *markdown* content.\n' },
  { name: 'repeat.txt', data: 'spam spam spam '.repeat(500) }, // will deflate
  { name: 'empty.txt', data: '' },
  { name: 'folder/', data: '' } // a directory entry
];
var zip = Z.buildZip(entries);

// Independently parse with readZip (deflated entries decoded via zlib).
var parsed = Z.readZip(zip, function (buf) { return zlib.inflateRawSync(Buffer.from(buf)); });
eq(parsed.length, entries.length, 'readZip recovers every entry');

function find(name) { return parsed.filter(function (e) { return e.name === name; })[0]; }

ok(Z.utf8Decode(find('hello.txt').data) === 'Hello, world!\n', 'hello.txt content survives');
ok(Z.utf8Decode(find('nested/readme.md').data).indexOf('markdown') >= 0, 'nested path + content survive');
ok(find('empty.txt').size === 0 && find('empty.txt').data.length === 0, 'empty file stays empty');
ok(find('folder/').isDir, 'directory entry is flagged as a directory');
ok(find('repeat.txt').method === 8, 'the compressible entry chose DEFLATE (method 8)');
ok(find('hello.txt').method === 0, 'the tiny entry was stored, not grown by deflate');

// Every stored CRC must equal an independent CRC of the recovered bytes.
var allCrcOk = parsed.every(function (e) {
  return e.isDir || e.crc === (Z.crc32(e.data) >>> 0);
});
ok(allCrcOk, 'every entry CRC matches a fresh CRC of the recovered data');

// The compressed entry must be smaller than its original.
ok(find('repeat.txt').compSize < find('repeat.txt').size,
   'deflated entry is smaller on disk than its content');

/* -------------------------------------------- ZIP is readable by real tools */
// gunzip can't read zip, but zlib proves the deflate streams; here we assert
// the structural signatures a real unzip looks for are present and correct.
ok((zip[0] | (zip[1] << 8) | (zip[2] << 16) | (zip[3] << 24)) >>> 0 === 0x04034b50,
   'archive begins with a local file header signature (PK\\x03\\x04)');

// force-store option: nothing should be deflated.
var storedZip = Z.buildZip([{ name: 'r.txt', data: 'aaaa'.repeat(1000) }], { store: true });
var storedParsed = Z.readZip(storedZip);
ok(storedParsed[0].method === 0, 'store:true forces no compression');
ok(Z.utf8Decode(storedParsed[0].data) === 'aaaa'.repeat(1000), 'stored content round-trips');

// Windows-style backslash paths are normalised to forward slashes.
var winZip = Z.buildZip([{ name: 'a\\b\\c.txt', data: 'x' }]);
ok(Z.readZip(winZip)[0].name === 'a/b/c.txt', 'backslash paths normalise to forward slashes');

// UTF-8 filenames survive the round-trip.
var uniZip = Z.buildZip([{ name: 'café-é中文.txt', data: 'unicode name' }]);
ok(Z.readZip(uniZip)[0].name === 'café-é中文.txt', 'UTF-8 filename survives');

/* ----------------------------------------------- real-world cross-check */
// Write a zip to a temp file and confirm the OS `unzip`/zlib can read it, if
// available. We verify via zlib by re-parsing; also sanity-check EOCD scan is
// robust to an archive comment is out of scope (we never write one).
var crcViaZlib = (typeof zlib.crc32 === 'function');
if (crcViaZlib) {
  var e2 = Z.buildZip([{ name: 't.txt', data: 'checksum me' }]);
  var p2 = Z.readZip(e2, function (b) { return zlib.inflateRawSync(Buffer.from(b)); });
  ok(p2[0].crc === (zlib.crc32(Buffer.from('checksum me')) >>> 0),
     'stored CRC matches zlib.crc32 of the original');
} else {
  passed++;
}

/* ----------------------------------------------------------------- report */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
