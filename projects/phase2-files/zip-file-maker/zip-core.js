/*
 * zip-core.js — the engine behind the Create Zip File Maker.
 *
 * Source 2 (karan/Projects) · Files category.
 * Task: "Create a zip file maker. Give the user the option to put the files
 *        ... then zip up everything into a zip file."
 *
 * No dependencies. Runs in Node (require) and the browser (window.ZipCore).
 * The three hard jobs live here so they can be tested without a browser:
 *   1. crc32       — the checksum every ZIP entry is validated against
 *   2. deflateRaw  — a real DEFLATE compressor (LZ77 + fixed Huffman), so the
 *                    archive is actually smaller, not just repackaged
 *   3. buildZip    — the ZIP container itself: local headers, the central
 *                    directory, and the end-of-central-directory record, with
 *                    every little-endian offset correct, round-trippable by
 *                    any real unzip tool (and by readZip, below)
 */
(function (root) {
  'use strict';

  /* ======================================================================
   * 0. Byte helpers — a tiny growable little-endian buffer
   * ==================================================================== */
  function ByteSink() {
    this.chunks = [];
    this.length = 0;
  }
  ByteSink.prototype.u8 = function (v) {
    this.chunks.push(v & 0xff);
    this.length += 1;
  };
  ByteSink.prototype.u16 = function (v) {
    this.chunks.push(v & 0xff, (v >>> 8) & 0xff);
    this.length += 2;
  };
  ByteSink.prototype.u32 = function (v) {
    this.chunks.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    this.length += 4;
  };
  ByteSink.prototype.bytes = function (arr) {
    for (var i = 0; i < arr.length; i++) this.chunks.push(arr[i] & 0xff);
    this.length += arr.length;
  };
  ByteSink.prototype.toUint8Array = function () {
    return new Uint8Array(this.chunks);
  };

  /* Turn a string into UTF-8 bytes without depending on TextEncoder. */
  function toBytes(input) {
    if (input == null) return new Uint8Array(0);
    if (input instanceof Uint8Array) return input;
    if (Array.isArray(input)) return new Uint8Array(input);
    if (typeof input === 'string') {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(input);
      // Manual UTF-8 encoder (Node fallback keeps the engine dependency-free).
      var out = [];
      for (var i = 0; i < input.length; i++) {
        var c = input.charCodeAt(i);
        if (c < 0x80) {
          out.push(c);
        } else if (c < 0x800) {
          out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < input.length) {
          var c2 = input.charCodeAt(i + 1);
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                   0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          i++;
        } else {
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
      }
      return new Uint8Array(out);
    }
    throw new TypeError('toBytes: unsupported input');
  }

  /* ======================================================================
   * 1. CRC-32  (IEEE 802.3, the polynomial ZIP uses)
   *
   * Every entry in a ZIP stores a CRC-32 of its *uncompressed* bytes, in two
   * places (local header + central directory). Get it wrong and every unzip
   * tool refuses the file. Table-based, standard reflected algorithm.
   * ==================================================================== */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(input) {
    var bytes = toBytes(input);
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* ======================================================================
   * 2. DEFLATE  (RFC 1951) — LZ77 matching + fixed Huffman codes
   *
   * This is the part that makes a zip a zip and not a tarball: the bytes come
   * out smaller. We do real LZ77 back-reference matching over a 32 KiB window
   * and encode the literals/matches with DEFLATE's fixed Huffman code set
   * (BTYPE=01), which needs no code table in the output. The result is a valid
   * raw-deflate stream — the tests inflate it back with Node's zlib to prove
   * it, with no shared code between the two sides.
   * ==================================================================== */

  // Bit writer: DEFLATE packs bits into bytes LSB-first; Huffman codes are
  // defined MSB-first, so those get bit-reversed before they are written.
  function BitWriter() {
    this.bytes = [];
    this.bitBuf = 0;
    this.bitCnt = 0;
  }
  BitWriter.prototype.writeBits = function (value, count) {
    this.bitBuf |= (value << this.bitCnt);
    this.bitCnt += count;
    while (this.bitCnt >= 8) {
      this.bytes.push(this.bitBuf & 0xff);
      this.bitBuf >>>= 8;
      this.bitCnt -= 8;
    }
  };
  BitWriter.prototype.writeHuff = function (code, count) {
    // Reverse the low `count` bits of `code`, then emit LSB-first.
    var rev = 0;
    for (var i = 0; i < count; i++) {
      rev = (rev << 1) | ((code >> i) & 1);
    }
    this.writeBits(rev, count);
  };
  BitWriter.prototype.finish = function () {
    if (this.bitCnt > 0) {
      this.bytes.push(this.bitBuf & 0xff);
      this.bitBuf = 0;
      this.bitCnt = 0;
    }
    return new Uint8Array(this.bytes);
  };

  // Fixed Huffman literal/length code (symbols 0..287).
  function litLenCode(sym) {
    if (sym <= 143) return { code: 0x30 + sym, bits: 8 };
    if (sym <= 255) return { code: 0x190 + (sym - 144), bits: 9 };
    if (sym <= 279) return { code: 0x00 + (sym - 256), bits: 7 };
    return { code: 0xc0 + (sym - 280), bits: 8 };
  }

  // Length -> (symbol, extra bits, extra value). Covers lengths 3..258.
  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35,
                  43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
                   4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
                   257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
                   8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
                    9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  function lengthToSymbol(len) {
    // Largest base <= len.
    for (var i = LEN_BASE.length - 1; i >= 0; i--) {
      if (len >= LEN_BASE[i]) {
        return { sym: 257 + i, extra: LEN_EXTRA[i], extraVal: len - LEN_BASE[i] };
      }
    }
    return { sym: 257, extra: 0, extraVal: 0 };
  }
  function distanceToSymbol(dist) {
    for (var i = DIST_BASE.length - 1; i >= 0; i--) {
      if (dist >= DIST_BASE[i]) {
        return { sym: i, extra: DIST_EXTRA[i], extraVal: dist - DIST_BASE[i] };
      }
    }
    return { sym: 0, extra: 0, extraVal: 0 };
  }

  var MIN_MATCH = 3;
  var MAX_MATCH = 258;
  var WINDOW = 32768;
  var MAX_CHAIN = 128; // cap match-search effort; a speed/ratio trade

  function deflateRaw(input) {
    var data = toBytes(input);
    var n = data.length;
    var bw = new BitWriter();
    // Single final block, fixed Huffman: BFINAL=1, BTYPE=01.
    bw.writeBits(1, 1);
    bw.writeBits(1, 2);

    function emitLiteral(byte) {
      var c = litLenCode(byte);
      bw.writeHuff(c.code, c.bits);
    }
    function emitMatch(len, dist) {
      var L = lengthToSymbol(len);
      var lc = litLenCode(L.sym);
      bw.writeHuff(lc.code, lc.bits);
      if (L.extra) bw.writeBits(L.extraVal, L.extra);
      var D = distanceToSymbol(dist);
      bw.writeHuff(D.sym, 5);           // distance codes are a flat 5 bits
      if (D.extra) bw.writeBits(D.extraVal, D.extra);
    }

    // Hash-chain match finder. head[h] = most recent position with hash h;
    // prev[pos & mask] = the position before that. Classic zlib structure.
    var HASH_BITS = 15, HASH_SIZE = 1 << HASH_BITS;
    var head = new Int32Array(HASH_SIZE).fill(-1);
    var prev = new Int32Array(WINDOW).fill(-1);
    function hash3(i) {
      return ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HASH_SIZE - 1);
    }

    var pos = 0;
    while (pos < n) {
      var bestLen = 0, bestDist = 0;
      if (pos + MIN_MATCH <= n) {
        var h = hash3(pos);
        var cand = head[h];
        var chain = 0;
        var limit = Math.max(0, pos - WINDOW);
        while (cand >= limit && chain < MAX_CHAIN) {
          // Compare how far the match runs.
          var len = 0;
          var maxLen = Math.min(MAX_MATCH, n - pos);
          while (len < maxLen && data[cand + len] === data[pos + len]) len++;
          if (len > bestLen) {
            bestLen = len;
            bestDist = pos - cand;
            if (len >= maxLen) break; // can't do better
          }
          cand = prev[cand & (WINDOW - 1)];
          chain++;
        }
      }

      if (bestLen >= MIN_MATCH) {
        emitMatch(bestLen, bestDist);
        // Insert hashes for every position we consume, so future matches see them.
        var end = pos + bestLen;
        while (pos < end) {
          if (pos + MIN_MATCH <= n) {
            var hh = hash3(pos);
            prev[pos & (WINDOW - 1)] = head[hh];
            head[hh] = pos;
          }
          pos++;
        }
      } else {
        emitLiteral(data[pos]);
        if (pos + MIN_MATCH <= n) {
          var h2 = hash3(pos);
          prev[pos & (WINDOW - 1)] = head[h2];
          head[h2] = pos;
        }
        pos++;
      }
    }

    // End-of-block symbol (256).
    var eob = litLenCode(256);
    bw.writeHuff(eob.code, eob.bits);
    return bw.finish();
  }

  /* ======================================================================
   * 3. DOS date/time — ZIP stores timestamps in the ancient FAT format
   * ==================================================================== */
  function dosDateTime(date) {
    date = date || new Date();
    var year = date.getFullYear();
    if (year < 1980) year = 1980;
    if (year > 2107) year = 2107;
    var time = (date.getHours() << 11) | (date.getMinutes() << 5) |
               (Math.floor(date.getSeconds() / 2));
    var datev = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) |
                date.getDate();
    return { time: time & 0xffff, date: datev & 0xffff };
  }

  /* ======================================================================
   * 4. buildZip — assemble the container
   *
   * Layout:  [ local header + data ] × N   then   [ central dir record ] × N
   *          then   [ end-of-central-directory ]
   * Each central record points back at its local header by byte offset, and
   * the EOCD points at the start and size of the central directory. One wrong
   * offset and the whole archive is unreadable, so this is where the care goes.
   * ==================================================================== */
  var SIG_LOCAL = 0x04034b50;
  var SIG_CENTRAL = 0x02014b50;
  var SIG_EOCD = 0x06054b50;

  // entries: [{ name, data, date?, store? }]  — store:true forces no compression
  function buildZip(entries, options) {
    options = options || {};
    var forceStore = !!options.store;
    var sink = new ByteSink();
    var central = [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var name = String(e.name).replace(/\\/g, '/');
      var isDir = /\/$/.test(name);
      var nameBytes = toBytes(name);
      var raw = isDir ? new Uint8Array(0) : toBytes(e.data);
      var crc = crc32(raw);
      var dt = dosDateTime(e.date);

      var method = 0, stored = raw;
      if (!isDir && raw.length > 0 && !forceStore && !e.store) {
        var deflated = deflateRaw(raw);
        // Only keep compression if it actually helped (ZIP's own rule of thumb).
        if (deflated.length < raw.length) {
          method = 8;
          stored = deflated;
        }
      }

      var offset = sink.length;
      // ---- Local file header ----
      sink.u32(SIG_LOCAL);
      sink.u16(20);                 // version needed
      sink.u16(0x0800);             // flag: UTF-8 names
      sink.u16(method);
      sink.u16(dt.time);
      sink.u16(dt.date);
      sink.u32(crc);
      sink.u32(stored.length);      // compressed size
      sink.u32(raw.length);         // uncompressed size
      sink.u16(nameBytes.length);
      sink.u16(0);                  // extra length
      sink.bytes(nameBytes);
      sink.bytes(stored);

      central.push({
        name: nameBytes, method: method, time: dt.time, date: dt.date,
        crc: crc, compSize: stored.length, rawSize: raw.length,
        offset: offset, isDir: isDir
      });
    }

    // ---- Central directory ----
    var cdStart = sink.length;
    for (var j = 0; j < central.length; j++) {
      var c = central[j];
      sink.u32(SIG_CENTRAL);
      sink.u16(20);                 // version made by
      sink.u16(20);                 // version needed
      sink.u16(0x0800);             // flags
      sink.u16(c.method);
      sink.u16(c.time);
      sink.u16(c.date);
      sink.u32(c.crc);
      sink.u32(c.compSize);
      sink.u32(c.rawSize);
      sink.u16(c.name.length);
      sink.u16(0);                  // extra length
      sink.u16(0);                  // comment length
      sink.u16(0);                  // disk number start
      sink.u16(0);                  // internal attrs
      sink.u32(c.isDir ? 0x10 : 0); // external attrs: dir bit
      sink.u32(c.offset);
      sink.bytes(c.name);
    }
    var cdSize = sink.length - cdStart;

    // ---- End of central directory ----
    sink.u32(SIG_EOCD);
    sink.u16(0);                    // this disk
    sink.u16(0);                    // disk with central dir
    sink.u16(central.length);       // entries on this disk
    sink.u16(central.length);       // total entries
    sink.u32(cdSize);
    sink.u32(cdStart);
    sink.u16(0);                    // comment length

    return sink.toUint8Array();
  }

  /* ======================================================================
   * 5. readZip — parse an archive back out (used by the tests to prove the
   *    container is well-formed). Deflated entries need an inflate function;
   *    the tests pass Node's zlib.inflateRawSync, keeping the two sides apart.
   * ==================================================================== */
  function rdU16(b, o) { return b[o] | (b[o + 1] << 8); }
  function rdU32(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  function readZip(bytes, inflateRaw) {
    bytes = toBytes(bytes);
    // Find the EOCD by scanning backwards for its signature.
    var eocd = -1;
    for (var p = bytes.length - 22; p >= 0; p--) {
      if (rdU32(bytes, p) === SIG_EOCD) { eocd = p; break; }
    }
    if (eocd < 0) throw new Error('readZip: no end-of-central-directory found');

    var total = rdU16(bytes, eocd + 10);
    var cdOffset = rdU32(bytes, eocd + 16);

    var out = [];
    var o = cdOffset;
    for (var i = 0; i < total; i++) {
      if (rdU32(bytes, o) !== SIG_CENTRAL) throw new Error('readZip: bad central record');
      var method = rdU16(bytes, o + 10);
      var crc = rdU32(bytes, o + 16);
      var compSize = rdU32(bytes, o + 20);
      var rawSize = rdU32(bytes, o + 24);
      var nameLen = rdU16(bytes, o + 28);
      var extraLen = rdU16(bytes, o + 30);
      var commentLen = rdU16(bytes, o + 32);
      var localOff = rdU32(bytes, o + 42);
      var name = utf8Decode(bytes.subarray(o + 46, o + 46 + nameLen));

      // Jump to the local header to find the data.
      if (rdU32(bytes, localOff) !== SIG_LOCAL) throw new Error('readZip: bad local header');
      var lNameLen = rdU16(bytes, localOff + 26);
      var lExtraLen = rdU16(bytes, localOff + 28);
      var dataStart = localOff + 30 + lNameLen + lExtraLen;
      var comp = bytes.subarray(dataStart, dataStart + compSize);

      var data;
      if (method === 0) {
        data = comp.slice();
      } else if (method === 8) {
        if (!inflateRaw) throw new Error('readZip: entry is deflated but no inflate fn given');
        data = toBytes(inflateRaw(comp));
      } else {
        throw new Error('readZip: unsupported method ' + method);
      }

      out.push({
        name: name, method: method, crc: crc, compSize: compSize,
        size: rawSize, data: data, isDir: /\/$/.test(name)
      });

      o += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    // Minimal UTF-8 decoder fallback.
    var s = '', i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c < 0x80) { s += String.fromCharCode(c); }
      else if (c < 0xe0) { s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f)); }
      else if (c < 0xf0) {
        s += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      } else {
        var cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) |
                 ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        cp -= 0x10000;
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return s;
  }

  /* ======================================================================
   * Public API
   * ==================================================================== */
  var api = {
    toBytes: toBytes,
    crc32: crc32,
    deflateRaw: deflateRaw,
    dosDateTime: dosDateTime,
    buildZip: buildZip,
    readZip: readZip,
    utf8Decode: utf8Decode
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ZipCore = api;
  }
})(typeof window !== 'undefined' ? window : this);
