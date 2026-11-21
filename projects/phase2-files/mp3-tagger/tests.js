/*
 * tests.js — exercises id3-core.js with no browser.
 *
 * The checks are deliberately independent of the writer where it matters:
 *   - Synchsafe integers are verified against hand-computed byte patterns from
 *     the ID3v2 spec, not against a round-trip of our own encoder alone.
 *   - Tags are read back out of fully assembled files (ID3v2 header + real MPEG
 *     frame-sync audio + ID3v1 footer), so the byte offsets have to be right.
 *   - A hand-built ID3v1 footer and a hand-built ID3v2.2 tag (different ID and
 *     size layout from what we write) are parsed, so the reader is tested
 *     against bytes the writer never produced.
 *   - When the `id3v2` / `ffprobe` tools are installed, the generated files are
 *     graded by those completely separate implementations (skipped, not failed,
 *     when absent).
 *
 * Run:  node tests.js
 */
'use strict';
var ID3 = require('./id3-core.js');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var pass = 0, fail = 0, skip = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function section(t) { console.log('\n' + t); }

/* ------------------------------------------------------------------ *
 * 1. Synchsafe integers (TRAP 1) — against known spec values.
 * ------------------------------------------------------------------ */
section('Synchsafe integers');
(function () {
  // 255 spans the 7-bit boundary: 0x000000FF -> [0x00,0x00,0x01,0x7F].
  var e255 = ID3.encodeSynchsafe(255);
  eq(JSON.stringify(e255), JSON.stringify([0, 0, 1, 0x7f]), '255 encodes across the 7-bit boundary');
  eq(ID3.decodeSynchsafe(Uint8Array.from(e255), 0), 255, '255 round-trips');

  // The classic trap: a tag size of 257 bytes.
  var e257 = ID3.encodeSynchsafe(257);
  eq(JSON.stringify(e257), JSON.stringify([0, 0, 2, 1]), '257 -> [0,0,2,1]');

  // No synchsafe byte may have its top bit set.
  var big = ID3.encodeSynchsafe(0x0fffffff);
  ok(big.every(function (x) { return (x & 0x80) === 0; }), 'no synchsafe byte sets bit 7');
  eq(ID3.decodeSynchsafe(Uint8Array.from(big), 0), 0x0fffffff, 'max 28-bit value round-trips');

  // Reading a synchsafe size as a plain int would over-read: prove they differ.
  var b = Uint8Array.from([0, 0, 2, 1]);
  var plain = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]; // = 513, the bug
  ok(plain !== ID3.decodeSynchsafe(b, 0), 'synchsafe (257) differs from a naive 32-bit read (513)');

  var threw = false;
  try { ID3.encodeSynchsafe(0x10000000); } catch (e) { threw = true; }
  ok(threw, 'encodeSynchsafe rejects values over 28 bits');
})();

/* ------------------------------------------------------------------ *
 * 2. Text encodings (TRAP 3).
 * ------------------------------------------------------------------ */
section('Text encodings');
(function () {
  // ASCII -> Latin-1 (enc 0), terminated.
  var a = ID3.encodeText('Hi');
  eq(a[0], 0, 'ASCII uses ISO-8859-1 encoding byte');
  eq(JSON.stringify(a), JSON.stringify([0, 72, 105, 0]), 'ASCII body is 1 byte/char + terminator');

  // Non-Latin (contains U+266B ♫, > one byte) -> UTF-16 with LE BOM (enc 1).
  var u = ID3.encodeText('音 ♫');
  eq(u[0], 1, 'non-Latin uses UTF-16 encoding byte');
  // Decoding the body back (skip the leading enc byte) returns the original.
  eq(ID3.decodeText(1, Uint8Array.from(u.slice(1)), 0, u.length - 1), '音 ♫', 'UTF-16 BOM round-trips non-Latin text');

  // 'é' (U+00E9) fits in a byte, so it must still take the Latin-1 path.
  var e = ID3.encodeText('é');
  eq(e[0], 0, 'U+00E9 stays Latin-1 (fits one byte)');

  // Reader: UTF-16BE without a BOM (v2.4 encoding 2).
  var be = Uint8Array.from([0x00, 0x41, 0x00, 0x42]); // "AB"
  eq(ID3.decodeText(2, be, 0, be.length), 'AB', 'UTF-16BE without BOM decodes');

  // Reader: UTF-8 (v2.4 encoding 3).
  var utf8 = Uint8Array.from([0xc3, 0xa9]); // é
  eq(ID3.decodeText(3, utf8, 0, utf8.length), 'é', 'UTF-8 decodes é');
})();

/* ------------------------------------------------------------------ *
 * 3. ID3v1 — write 128 bytes, read them back, including the v1.1 track byte.
 * ------------------------------------------------------------------ */
section('ID3v1 footer');
(function () {
  var tag = { title: 'Song', artist: 'Band', album: 'Record', year: '1999',
              comment: 'nice', track: '7', genre: 'Rock' };
  var v1 = ID3.writeV1(tag);
  eq(v1.length, 128, 'ID3v1 is exactly 128 bytes');
  eq(String.fromCharCode(v1[0], v1[1], v1[2]), 'TAG', 'starts with TAG');
  eq(v1[125], 0, 'v1.1 comment[28] is the zero marker');
  eq(v1[126], 7, 'v1.1 track byte is set');

  var r = ID3.readV1(v1);
  eq(r.title, 'Song', 'v1 title round-trips');
  eq(r.artist, 'Band', 'v1 artist round-trips');
  eq(r.album, 'Record', 'v1 album round-trips');
  eq(r.year, '1999', 'v1 year round-trips');
  eq(r.comment, 'nice', 'v1 comment round-trips');
  eq(r.track, '7', 'v1.1 track round-trips');
  eq(r.genre, 'Rock', 'genre index maps back to name');

  // A field longer than 30 chars must be truncated, not overflow.
  var longTag = ID3.writeV1({ title: 'x'.repeat(50) });
  eq(longTag.length, 128, 'over-long title still produces exactly 128 bytes');

  // Parse a hand-built footer the writer never produced (no track -> 30-char comment).
  var hand = new Uint8Array(128);
  'TAG'.split('').forEach(function (c, i) { hand[i] = c.charCodeAt(0); });
  'ABBA'.split('').forEach(function (c, i) { hand[33 + i] = c.charCodeAt(0); }); // artist
  hand[127] = 13; // genre 13 = Pop
  var h = ID3.readV1(hand);
  eq(h.artist, 'ABBA', 'hand-built v1 artist parsed');
  eq(h.genre, 'Pop', 'hand-built v1 genre index 13 -> Pop');
  eq(h.track, '', 'no track byte when comment[28] != 0 marker absent');
})();

/* ------------------------------------------------------------------ *
 * 4. ID3v2 — write a tag, assemble a file, read it back.
 * ------------------------------------------------------------------ */
section('ID3v2 header + frames');
(function () {
  var tag = { title: 'Déjà Vu', artist: 'Nobody', album: 'Demos',
              year: '2026', track: '3', genre: 'Trance', comment: 'hello' };
  var v2 = ID3.writeV2(tag);
  eq(String.fromCharCode(v2[0], v2[1], v2[2]), 'ID3', 'ID3v2 starts with ID3');
  eq(v2[3], 3, 'version major is 2.3');
  // The declared tag size (synchsafe) must equal the real frame bytes.
  var declared = ID3.decodeSynchsafe(v2, 6);
  eq(declared, v2.length - 10, 'ID3v2 header size matches frame bytes exactly');

  var r = ID3.readV2(v2);
  eq(r.title, 'Déjà Vu', 'v2 title (UTF-16) round-trips');
  eq(r.artist, 'Nobody', 'v2 artist round-trips');
  eq(r.album, 'Demos', 'v2 album round-trips');
  eq(r.year, '2026', 'v2 year round-trips');
  eq(r.track, '3', 'v2 track round-trips');
  eq(r.genre, 'Trance', 'v2 genre round-trips');
  eq(r.comment, 'hello', 'v2 COMM comment round-trips');
  eq(r.byteLength, v2.length, 'v2 byteLength covers the whole tag');

  // "3/12" style track and "(31)" style genre must normalise on read.
  var t2 = ID3.writeV2({ track: '5/10', genre: 'Trance' });
  var r2 = ID3.readV2(t2);
  // We wrote "5/10" literally into TRCK; the reader strips the "/10".
  eq(r2.track, '5', 'TRCK "5/10" normalises to "5" on read');
})();

/* ------------------------------------------------------------------ *
 * 5. Parse a hand-built ID3v2.2 tag (3-char IDs, 3-byte sizes) — bytes the
 *    writer never emits, so this tests the reader independently.
 * ------------------------------------------------------------------ */
section('ID3v2.2 reader (independent of the writer)');
(function () {
  // Frame TT2 (title) = "Hey", ISO-8859-1.
  var body = [0x00, 0x48, 0x65, 0x79]; // enc 0, "Hey"
  var frame = [0x54, 0x54, 0x32, 0x00, 0x00, body.length].concat(body); // "TT2" + 3-byte size
  var size = frame.length;
  var header = [0x49, 0x44, 0x33, 0x02, 0x00, 0x00].concat(ID3.encodeSynchsafe(size));
  var tag = Uint8Array.from(header.concat(frame));
  var r = ID3.readV2(tag);
  eq(r.version, '2.2', 'detected as ID3v2.2');
  eq(r.title, 'Hey', 'v2.2 TT2 frame read via alias to TIT2');
})();

/* ------------------------------------------------------------------ *
 * 6. Missing-field detection — the headline feature of the task.
 * ------------------------------------------------------------------ */
section('Missing-field analysis');
(function () {
  var audio = ID3.makeSilentMp3(4);

  // A bare, untagged file: every core field is missing.
  var bare = ID3.readTags(audio);
  ok(!bare.hasV1 && !bare.hasV2, 'bare MP3 has no tags');
  eq(JSON.stringify(bare.missing), JSON.stringify(ID3.CORE_FIELDS), 'bare MP3 reports every field missing');
  ok(!bare.complete, 'bare MP3 is not complete');

  // Tag only title + artist; the rest stay missing.
  var partial = ID3.applyTags(audio, { title: 'T', artist: 'A' });
  var pr = ID3.readTags(partial);
  ok(pr.missing.indexOf('title') === -1, 'title no longer missing after partial tag');
  ok(pr.missing.indexOf('artist') === -1, 'artist no longer missing');
  ok(pr.missing.indexOf('album') !== -1, 'album still flagged missing');
  ok(pr.missing.indexOf('year') !== -1, 'year still flagged missing');

  // Fully tag it: nothing missing.
  var full = ID3.applyTags(audio, {
    title: 'T', artist: 'A', album: 'Al', year: '2026',
    track: '1', genre: 'Jazz', comment: 'c'
  });
  var fr = ID3.readTags(full);
  eq(JSON.stringify(fr.missing), '[]', 'fully tagged file reports nothing missing');
  ok(fr.complete, 'fully tagged file is complete');
})();

/* ------------------------------------------------------------------ *
 * 7. applyTags round-trip — audio preserved, offsets honest, retag works.
 * ------------------------------------------------------------------ */
section('applyTags byte integrity');
(function () {
  var audio = ID3.makeSilentMp3(6);
  var tagged = ID3.applyTags(audio, { title: 'Keep Me', artist: 'X', genre: 'Metal' });
  var info = ID3.readTags(tagged);

  // The audio between the tags must be byte-for-byte the original.
  var extracted = tagged.subarray(info.audioStart, info.audioEnd);
  eq(extracted.length, audio.length, 'audio length preserved through tagging');
  var identical = true;
  for (var i = 0; i < audio.length; i++) if (audio[i] !== extracted[i]) { identical = false; break; }
  ok(identical, 'audio bytes are untouched by tagging');

  // The first preserved byte is still a real MPEG frame sync (0xFF 0xFB).
  eq(tagged[info.audioStart], 0xff, 'audio still starts on an MPEG sync byte (0xFF)');
  eq(tagged[info.audioStart + 1], 0xfb, 'second sync byte intact (0xFB)');

  // Re-tagging an already-tagged file must not stack tags — size stays sane.
  var retag = ID3.applyTags(tagged, { title: 'New', artist: 'Y', album: 'Z', year: '2000', track: '2', genre: 'Pop', comment: 'ok' });
  var ri = ID3.readTags(retag);
  eq(ri.merged.title, 'New', 'retag replaces the old title');
  var reExtract = retag.subarray(ri.audioStart, ri.audioEnd);
  eq(reExtract.length, audio.length, 'audio length still preserved after a second tagging (no stacking)');

  // v1 and v2 should agree after a full tag (within v1's 30-char limit).
  ok(ri.hasV1 && ri.hasV2, 'both ID3v1 and ID3v2 written');
  eq(ri.v1.title, 'New', 'ID3v1 footer also carries the new title');
})();

/* ------------------------------------------------------------------ *
 * 8. Real-world grade with external tools, if available.
 * ------------------------------------------------------------------ */
section('External grader (id3v2 / ffprobe)');
(function () {
  function have(cmd) {
    try { cp.execSync(cmd + ' --version', { stdio: 'ignore' }); return true; }
    catch (e) { try { cp.execSync('which ' + cmd, { stdio: 'ignore' }); return true; } catch (e2) { return false; } }
  }
  var tmp = path.join(os.tmpdir(), 'id3-test-' + process.pid + '.mp3');
  var audio = ID3.makeSilentMp3(10);
  var tagged = ID3.applyTags(audio, {
    title: 'Grader Song', artist: 'The Testers', album: 'CI',
    year: '2026', track: '4', genre: 'Jazz', comment: 'graded'
  });
  fs.writeFileSync(tmp, Buffer.from(tagged));

  try {
    if (have('id3v2')) {
      var out = cp.execSync('id3v2 -l ' + JSON.stringify(tmp), { encoding: 'utf8' });
      ok(/Grader Song/.test(out), 'id3v2 reads back the title');
      ok(/The Testers/.test(out), 'id3v2 reads back the artist');
    } else { skip++; console.log('  (skip) id3v2 not installed'); }

    if (have('ffprobe')) {
      var j = cp.execSync('ffprobe -v quiet -print_format json -show_format ' + JSON.stringify(tmp), { encoding: 'utf8' });
      var meta = JSON.parse(j);
      var tags = (meta.format && meta.format.tags) || {};
      var title = tags.title || tags.TITLE || '';
      ok(/Grader Song/.test(title), 'ffprobe reads back the title');
    } else { skip++; console.log('  (skip) ffprobe not installed'); }
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
})();

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
process.exit(fail ? 1 : 0);
