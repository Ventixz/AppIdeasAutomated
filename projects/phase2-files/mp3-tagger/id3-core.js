/*
 * id3-core.js — an MP3 ID3-tag reader and writer built from the bytes up.
 * No tagging library.
 *
 * The task (karan/Projects, "Files"): "Analyze a group of MP3 files and tag them
 * if they are missing the Title, Artist, Album, Year or other ID3 fields."
 *
 * So this engine does two things, both at the byte level:
 *   1. READ the tags already on a file — the 128-byte ID3v1 footer at the very
 *      end, and the ID3v2 header-and-frames block at the very front (v2.2, v2.3
 *      and v2.4, each of which lays its sizes out differently) — merge them into
 *      one view, and report exactly which standard fields are MISSING.
 *   2. WRITE tags back — rebuild a clean ID3v2.3 block and a fresh ID3v1.1
 *      footer around the untouched audio, so a previously-untagged file comes
 *      back fully tagged.
 *
 * It uses no DOM and no dependencies, so it runs unchanged in Node
 * (module.exports) and the browser (window.ID3Core). tests.js exercises every
 * trap below with no browser.
 *
 * The three things that make this format unforgiving, and where they live:
 *   - Synchsafe integers (encodeSynchsafe / decodeSynchsafe): the ID3v2 tag size
 *     is stored 7 bits per byte so it can never contain the MP3 frame-sync bytes.
 *     Read it as a normal 32-bit int and you land ~11% short and parse garbage.
 *   - Per-version frame layout (parseV2): v2.2 has 3-char IDs and 3-byte sizes;
 *     v2.3 has 4-char IDs and plain 32-bit sizes; v2.4 has 4-char IDs but
 *     SYNCHSAFE frame sizes. The same TIT2 frame is read three different ways.
 *   - Text encodings (decodeText / encodeText): a text frame's first byte picks
 *     ISO-8859-1, UTF-16+BOM, UTF-16BE, or UTF-8. Guess wrong and every title
 *     turns to mojibake.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Byte helpers — everything works on Uint8Array so Node and the
   * browser behave identically.
   * ------------------------------------------------------------------ */
  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return new Uint8Array(input);
    if (Array.isArray(input)) return new Uint8Array(input);
    throw new Error('id3: expected bytes (Uint8Array/ArrayBuffer/Buffer/Array)');
  }

  function ascii(bytes, start, len) {
    var s = '';
    for (var i = 0; i < len; i++) s += String.fromCharCode(bytes[start + i]);
    return s;
  }

  // Plain big-endian 32-bit integer (ID3v2.3 frame sizes, and nothing else).
  function readU32BE(b, o) {
    return (b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  }
  function readU24BE(b, o) {
    return (b[o] << 16) + (b[o + 1] << 8) + b[o + 2];
  }

  /* ------------------------------------------------------------------ *
   * TRAP 1 — synchsafe integers.
   * Only the low 7 bits of each byte carry data; the top bit is always 0.
   * A 4-byte synchsafe value therefore holds 28 bits, max 268435455.
   * Used for: the ID3v2 tag size (all versions) and v2.4 frame sizes.
   * ------------------------------------------------------------------ */
  function decodeSynchsafe(b, o) {
    return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) |
           ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  }
  function encodeSynchsafe(n) {
    if (n < 0 || n > 0x0fffffff) throw new Error('id3: synchsafe value out of range');
    return [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
  }

  /* ------------------------------------------------------------------ *
   * TRAP 3 — text encodings.
   * ------------------------------------------------------------------ */
  // ISO-8859-1 (Latin-1): one byte per code point, 0..255.
  function decodeLatin1(b, start, end) {
    var s = '';
    for (var i = start; i < end; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  // UTF-16: honour a leading BOM; default to big-endian when told to (v2.4 enc 2).
  function decodeUtf16(b, start, end, defaultBE) {
    var be = !!defaultBE, i = start;
    if (end - start >= 2) {
      if (b[i] === 0xfe && b[i + 1] === 0xff) { be = true; i += 2; }
      else if (b[i] === 0xff && b[i + 1] === 0xfe) { be = false; i += 2; }
    }
    var s = '';
    for (; i + 1 < end; i += 2) {
      var u = be ? ((b[i] << 8) | b[i + 1]) : ((b[i + 1] << 8) | b[i]);
      s += String.fromCharCode(u);
    }
    return s;
  }
  // Minimal UTF-8 decoder (ID3v2.4 encoding 3).
  function decodeUtf8(b, start, end) {
    var s = '', i = start;
    while (i < end) {
      var c = b[i++];
      if (c < 0x80) { s += String.fromCharCode(c); }
      else if (c < 0xe0) { s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f)); }
      else if (c < 0xf0) {
        s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
      } else {
        var cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
        cp -= 0x10000;
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return s;
  }

  // Decode a text-frame body (encoding byte already consumed by caller offset).
  function decodeText(enc, b, start, end) {
    var s;
    if (enc === 1) s = decodeUtf16(b, start, end, false);      // UTF-16 + BOM
    else if (enc === 2) s = decodeUtf16(b, start, end, true);  // UTF-16BE, no BOM
    else if (enc === 3) s = decodeUtf8(b, start, end);         // UTF-8
    else s = decodeLatin1(b, start, end);                       // 0 = ISO-8859-1
    // Strip trailing NULs used as string terminators / padding.
    return s.replace(/\u0000+$/, '');
  }

  // Encode a string for writing. We pick the smallest faithful encoding:
  // ISO-8859-1 (enc 0) when every code point fits in a byte, else UTF-16+BOM
  // (enc 1), which every v2.3 reader understands.
  function encodeText(str) {
    str = str == null ? '' : String(str);
    var latin = true;
    for (var i = 0; i < str.length; i++) { if (str.charCodeAt(i) > 0xff) { latin = false; break; } }
    var out = [];
    if (latin) {
      out.push(0x00); // encoding byte
      for (var j = 0; j < str.length; j++) out.push(str.charCodeAt(j) & 0xff);
      out.push(0x00); // terminator
    } else {
      out.push(0x01);            // encoding byte: UTF-16 with BOM
      out.push(0xff, 0xfe);      // little-endian BOM
      for (var k = 0; k < str.length; k++) {
        var c = str.charCodeAt(k);
        out.push(c & 0xff, (c >> 8) & 0xff);
      }
      out.push(0x00, 0x00);      // terminator
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * ID3v1 genre table — the original Winamp list (0..79) plus the de-facto
   * extensions (80..191). ID3v1 stores a genre as a single index into this.
   * ------------------------------------------------------------------ */
  var GENRES = [
    'Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop',
    'Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock',
    'Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack',
    'Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance',
    'Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise',
    'AlternRock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop',
    'Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic',
    'Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta',
    'Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret',
    'New Wave','Psychadelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal',
    'Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock & Roll','Hard Rock',
    'Folk','Folk-Rock','National Folk','Swing','Fast Fusion','Bebob','Latin',
    'Revival','Celtic','Bluegrass','Avantgarde','Gothic Rock','Progressive Rock',
    'Psychedelic Rock','Symphonic Rock','Slow Rock','Big Band','Chorus',
    'Easy Listening','Acoustic','Humour','Speech','Chanson','Opera','Chamber Music',
    'Sonata','Symphony','Booty Bass','Primus','Porn Groove','Satire','Slow Jam',
    'Club','Tango','Samba','Folklore','Ballad','Power Ballad','Rhythmic Soul',
    'Freestyle','Duet','Punk Rock','Drum Solo','A capella','Euro-House','Dance Hall',
    'Goa','Drum & Bass','Club-House','Hardcore','Terror','Indie','BritPop',
    'Negerpunk','Polsk Punk','Beat','Christian Gangsta','Heavy Metal','Black Metal',
    'Crossover','Contemporary Christian','Christian Rock','Merengue','Salsa',
    'Thrash Metal','Anime','Jpop','Synthpop'
  ];
  function genreName(idx) {
    return (idx != null && idx >= 0 && idx < GENRES.length) ? GENRES[idx] : '';
  }
  function genreIndex(name) {
    if (name == null) return 255;
    var n = String(name).trim().toLowerCase();
    if (n === '') return 255;
    for (var i = 0; i < GENRES.length; i++) if (GENRES[i].toLowerCase() === n) return i;
    return 255; // 255 = "no genre" in ID3v1
  }

  /* ------------------------------------------------------------------ *
   * Reading ID3v1 — the last 128 bytes, if they start with "TAG".
   * ------------------------------------------------------------------ */
  function readV1(b) {
    if (b.length < 128) return null;
    var o = b.length - 128;
    if (ascii(b, o, 3) !== 'TAG') return null;

    function field(start, len) {
      // ID3v1 fields are NUL- or space-padded; trim both from the right.
      return decodeLatin1(b, start, start + len).replace(/[\u0000 ]+$/, '');
    }
    var title = field(o + 3, 30);
    var artist = field(o + 33, 30);
    var album = field(o + 63, 30);
    var year = field(o + 93, 4);
    var genreByte = b[o + 127];

    // ID3v1.1: if comment[28]==0 and comment[29]!=0, the last byte is a track no.
    var track = '';
    var comment;
    if (b[o + 125] === 0 && b[o + 126] !== 0) {
      track = String(b[o + 126]);
      comment = decodeLatin1(b, o + 97, o + 125).replace(/[\u0000 ]+$/, '');
    } else {
      comment = decodeLatin1(b, o + 97, o + 127).replace(/[\u0000 ]+$/, '');
    }

    return {
      version: '1.1',
      title: title, artist: artist, album: album, year: year,
      comment: comment, track: track,
      genre: genreName(genreByte), genreByte: genreByte
    };
  }

  /* ------------------------------------------------------------------ *
   * Reading ID3v2 — "ID3" header at offset 0, then frames.
   * Handles v2.2 (3-char IDs / 3-byte sizes), v2.3 (4-char / plain 32-bit),
   * and v2.4 (4-char / synchsafe). Returns the parsed frames plus the total
   * byte length of the tag (so the caller knows where the audio starts).
   * ------------------------------------------------------------------ */
  // Frame IDs differ between v2.2 and v2.3/2.4; normalise to the v2.3 names.
  var FRAME_ALIAS = {
    TT2: 'TIT2', TP1: 'TPE1', TAL: 'TALB', TYE: 'TYER', TRK: 'TRCK',
    TCO: 'TCON', COM: 'COMM', TRC: 'TRCK'
  };
  var FIELD_OF_FRAME = {
    TIT2: 'title', TPE1: 'artist', TALB: 'album',
    TYER: 'year', TDRC: 'year', TRCK: 'track', TCON: 'genre', COMM: 'comment'
  };

  function readV2(b) {
    if (b.length < 10 || ascii(b, 0, 3) !== 'ID3') return null;
    var major = b[3];
    var flags = b[5];
    var size = decodeSynchsafe(b, 6);          // tag size, excludes the 10-byte header
    var tagEnd = 10 + size;
    var hasFooter = (major === 4) && (flags & 0x10);
    var totalLen = tagEnd + (hasFooter ? 10 : 0);

    var frames = {};
    var p = 10;

    // Skip a v2.3/v2.4 extended header if one is present (flag 0x40).
    if ((major === 3 || major === 4) && (flags & 0x40)) {
      var extSize = (major === 4) ? decodeSynchsafe(b, p) : readU32BE(b, p);
      // v2.3 extSize excludes its own 4 size bytes; v2.4 includes them.
      p += (major === 4) ? extSize : (extSize + 4);
    }

    var idLen = (major === 2) ? 3 : 4;
    var szLen = (major === 2) ? 3 : 4;
    var flagLen = (major === 2) ? 0 : 2;

    while (p + idLen + szLen + flagLen <= tagEnd) {
      var id = ascii(b, p, idLen);
      if (id.charCodeAt(0) === 0) break; // hit padding
      if (!/^[A-Z0-9]+$/.test(id)) break; // not a valid frame id -> padding/garbage

      var frSize;
      if (major === 2) frSize = readU24BE(b, p + 3);
      else if (major === 4) frSize = decodeSynchsafe(b, p + 4);
      else frSize = readU32BE(b, p + 4);

      var bodyStart = p + idLen + szLen + flagLen;
      var bodyEnd = bodyStart + frSize;
      if (frSize < 0 || bodyEnd > tagEnd) break;

      var canonical = FRAME_ALIAS[id] || id;
      var value = readFrameBody(canonical, b, bodyStart, bodyEnd);
      if (value != null && frames[canonical] === undefined) frames[canonical] = value;

      p = bodyEnd;
    }

    // Build a flat field view from the frames we understand.
    var fields = {};
    for (var fid in FIELD_OF_FRAME) {
      if (frames[fid] !== undefined && fields[FIELD_OF_FRAME[fid]] === undefined) {
        fields[FIELD_OF_FRAME[fid]] = frames[fid];
      }
    }

    return {
      version: '2.' + major,
      title: fields.title || '', artist: fields.artist || '',
      album: fields.album || '', year: fields.year || '',
      track: fields.track || '', genre: fields.genre || '', comment: fields.comment || '',
      frames: frames, byteLength: totalLen
    };
  }

  function readFrameBody(id, b, start, end) {
    if (id === 'COMM') {
      // COMM: enc(1) + lang(3) + short-desc (NUL-terminated) + text
      if (end - start < 4) return '';
      var enc = b[start];
      var q = start + 4; // skip encoding + 3-byte language
      // Skip the short-description string up to its terminator.
      if (enc === 1 || enc === 2) {
        while (q + 1 < end && !(b[q] === 0 && b[q + 1] === 0)) q += 2;
        q += 2;
      } else {
        while (q < end && b[q] !== 0) q++;
        q += 1;
      }
      return decodeText(enc, b, q, end);
    }
    if (id.charAt(0) === 'T') { // any text frame
      if (end - start < 1) return '';
      var e = b[start];
      var raw = decodeText(e, b, start + 1, end);
      return cleanTextValue(id, raw);
    }
    return null; // frame we don't surface
  }

  // Normalise a couple of fields: "3/12" track -> "3"; "(17)"/"17" genre -> name.
  function cleanTextValue(id, raw) {
    if (id === 'TRCK') return raw.split('/')[0].trim();
    if (id === 'TDRC') return raw.slice(0, 4); // v2.4 timestamp -> year
    if (id === 'TCON') {
      var m = /^\(?(\d+)\)?$/.exec(raw.trim());
      if (m) { var nm = genreName(parseInt(m[1], 10)); return nm || raw; }
      return raw;
    }
    return raw;
  }

  /* ------------------------------------------------------------------ *
   * Merge + the headline feature: which standard fields are MISSING.
   * ------------------------------------------------------------------ */
  var CORE_FIELDS = ['title', 'artist', 'album', 'year', 'track', 'genre', 'comment'];

  function readTags(input) {
    var b = toBytes(input);
    var v1 = readV1(b);
    var v2 = readV2(b);

    // v2 wins over v1 field-by-field (it's richer and unbounded).
    var merged = {};
    CORE_FIELDS.forEach(function (f) {
      var a = v2 && v2[f] ? v2[f] : '';
      var c = v1 && v1[f] ? v1[f] : '';
      merged[f] = a || c;
    });

    var missing = missingFields(merged);
    return {
      v1: v1, v2: v2, merged: merged, missing: missing,
      hasV1: !!v1, hasV2: !!v2,
      complete: missing.length === 0,
      audioStart: v2 ? v2.byteLength : 0,
      audioEnd: v1 ? b.length - 128 : b.length,
      fileSize: b.length
    };
  }

  function missingFields(merged) {
    return CORE_FIELDS.filter(function (f) {
      return !merged[f] || String(merged[f]).trim() === '';
    });
  }

  /* ------------------------------------------------------------------ *
   * Writing ID3v1.1 — a fixed 128-byte footer.
   * ------------------------------------------------------------------ */
  function padField(out, str, len) {
    str = str == null ? '' : String(str);
    for (var i = 0; i < len; i++) {
      var c = i < str.length ? (str.charCodeAt(i) & 0xff) : 0;
      // ID3v1 is Latin-1 only; drop anything that won't fit a byte.
      if (i < str.length && str.charCodeAt(i) > 0xff) c = 0x3f; // '?'
      out.push(c);
    }
  }

  function writeV1(tag) {
    var out = [];
    out.push(0x54, 0x41, 0x47); // "TAG"
    padField(out, tag.title, 30);
    padField(out, tag.artist, 30);
    padField(out, tag.album, 30);
    padField(out, tag.year, 4);
    // ID3v1.1 comment is 28 bytes + a 0 + a track byte.
    var trackNum = parseInt(tag.track, 10);
    if (!isNaN(trackNum) && trackNum > 0 && trackNum < 256) {
      padField(out, tag.comment, 28);
      out.push(0x00, trackNum & 0xff);
    } else {
      padField(out, tag.comment, 30);
    }
    out.push(genreIndex(tag.genre) & 0xff);
    return new Uint8Array(out); // always exactly 128 bytes
  }

  /* ------------------------------------------------------------------ *
   * Writing ID3v2.3 — the compatible middle version: 4-char frame IDs,
   * plain 32-bit frame sizes, synchsafe tag size in the header.
   * ------------------------------------------------------------------ */
  function textFrame(id, value) {
    var body = encodeText(value);
    var out = [];
    for (var i = 0; i < 4; i++) out.push(id.charCodeAt(i));
    // v2.3 frame size: plain big-endian, NOT synchsafe.
    var n = body.length;
    out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
    out.push(0x00, 0x00); // frame flags
    for (var j = 0; j < body.length; j++) out.push(body[j]);
    return out;
  }

  function commFrame(value) {
    // COMM = enc + lang("eng") + empty short-desc + text
    var txt = encodeText(value);           // includes encoding byte + terminator
    var enc = txt[0];
    var body = [enc, 0x65, 0x6e, 0x67];    // enc, 'e','n','g'
    // empty short description terminator, matching the encoding width
    if (enc === 1) body.push(0x00, 0x00); else body.push(0x00);
    for (var i = 1; i < txt.length; i++) body.push(txt[i]); // skip the dup enc byte
    var out = [];
    'COMM'.split('').forEach(function (ch) { out.push(ch.charCodeAt(0)); });
    var n = body.length;
    out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
    out.push(0x00, 0x00);
    for (var k = 0; k < body.length; k++) out.push(body[k]);
    return out;
  }

  function writeV2(tag) {
    var frames = [];
    function add(id, val) { if (val != null && String(val).trim() !== '') frames = frames.concat(textFrame(id, val)); }
    add('TIT2', tag.title);
    add('TPE1', tag.artist);
    add('TALB', tag.album);
    add('TYER', tag.year);
    if (tag.track != null && String(tag.track).trim() !== '') add('TRCK', String(tag.track).trim());
    if (tag.genre != null && String(tag.genre).trim() !== '') add('TCON', tag.genre);
    if (tag.comment != null && String(tag.comment).trim() !== '') frames = frames.concat(commFrame(tag.comment));

    var out = [];
    out.push(0x49, 0x44, 0x33); // "ID3"
    out.push(0x03, 0x00);       // version 2.3.0
    out.push(0x00);             // flags
    // tag size (synchsafe) = size of all frames (no padding added here)
    encodeSynchsafe(frames.length).forEach(function (byte) { out.push(byte); });
    for (var i = 0; i < frames.length; i++) out.push(frames[i]);
    return new Uint8Array(out);
  }

  /* ------------------------------------------------------------------ *
   * applyTags — the whole point: strip any existing ID3v2 (front) and ID3v1
   * (back), leave the audio frames untouched in the middle, and wrap fresh
   * tags around them. Returns a brand-new Uint8Array.
   * ------------------------------------------------------------------ */
  function applyTags(input, tag, opts) {
    opts = opts || {};
    var b = toBytes(input);
    var info = readTags(b);

    var audio = b.subarray(info.audioStart, info.audioEnd);

    var head = (opts.writeV2 === false) ? new Uint8Array(0) : writeV2(tag);
    var foot = (opts.writeV1 === false) ? new Uint8Array(0) : writeV1(tag);

    var result = new Uint8Array(head.length + audio.length + foot.length);
    result.set(head, 0);
    result.set(audio, head.length);
    result.set(foot, head.length + audio.length);
    return result;
  }

  /* ------------------------------------------------------------------ *
   * A tiny valid-ish MP3 maker, so the UI (and tests) have something real to
   * read and write without shipping a binary. It emits a handful of genuine
   * MPEG-1 Layer III frame headers (sync 0xFFFB...) followed by zeroed audio
   * data — enough that the bytes between the tags are real frame sync words.
   * ------------------------------------------------------------------ */
  function makeSilentMp3(frameCount) {
    frameCount = frameCount || 8;
    // MPEG-1 Layer III, 128 kbps, 44100 Hz, no padding -> 417-byte frames.
    var frameLen = 417;
    var out = new Uint8Array(frameCount * frameLen);
    for (var f = 0; f < frameCount; f++) {
      var o = f * frameLen;
      out[o] = 0xff; out[o + 1] = 0xfb; out[o + 2] = 0x90; out[o + 3] = 0x00;
      // rest already zero
    }
    return out;
  }

  var API = {
    readTags: readTags,
    missingFields: missingFields,
    applyTags: applyTags,
    writeV1: writeV1,
    writeV2: writeV2,
    readV1: readV1,
    readV2: readV2,
    encodeSynchsafe: encodeSynchsafe,
    decodeSynchsafe: decodeSynchsafe,
    encodeText: encodeText,
    decodeText: decodeText,
    genreName: genreName,
    genreIndex: genreIndex,
    makeSilentMp3: makeSilentMp3,
    GENRES: GENRES,
    CORE_FIELDS: CORE_FIELDS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ID3Core = API;
})(typeof window !== 'undefined' ? window : this);
