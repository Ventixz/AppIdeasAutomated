/*
 * ciphers-core.js — the engine behind the Caesar / Vigenère / Vernam
 * playground.
 *
 * Three ciphers that look like three different projects are really one idea
 * seen at three scales, and the point of this file is to make that visible —
 * and then to show, in code, exactly where two of the three fall apart.
 *
 *   1. CAESAR is "add a fixed number to every letter." Shift 3 turns A→D,
 *      B→E, … Z→C. There are only 25 useful shifts, so you can break it by
 *      trying all of them — and the engine does, scoring each candidate so the
 *      English one floats to the top on its own.
 *
 *   2. VIGENÈRE is "Caesar, but the shift changes every letter," driven by a
 *      repeating keyword. KEY = "LEMON" means shift by L, then E, then M, O,
 *      N, L, E, M, … So CAESAR IS EXACTLY VIGENÈRE WITH A ONE-LETTER KEY, and
 *      this file implements Caesar by *calling* the Vigenère routine with the
 *      key `String.fromCharCode(65 + shift)`. One engine, not two — and the
 *      test suite pins that identity down.
 *
 *   3. VERNAM is "Vigenère, but the key is as long as the message, perfectly
 *      random, and never reused" — carried out by XOR over raw bytes instead
 *      of addition over 26 letters. That one change, from a short repeating
 *      key to a long one-time key, is the whole difference between a cipher
 *      every schoolchild can break and the *only* cipher with a mathematical
 *      proof of perfect secrecy (Shannon, 1949). The engine refuses to encrypt
 *      when the key is too short, because the moment it repeats it stops being
 *      Vernam and becomes breakable again.
 *
 * The honest part — the reason the file is long — is that it does not stop at
 * "here is how to encrypt." It SHOWS the weakness:
 *
 *   • crackVigenere() recovers the key and plaintext from ciphertext alone,
 *     using the index of coincidence to find the key length and chi-squared
 *     frequency analysis to solve each column. No key required. This is why
 *     Caesar and Vigenère are museum pieces, not security.
 *
 *   • twoTimePad() takes two messages encrypted under the SAME Vernam key and
 *     recovers the XOR of the plaintexts without the key — the famous
 *     "two-time pad" catastrophe that turns a perfect cipher into a broken one
 *     the instant a key is reused.
 *
 * DOM-free on purpose: the same object is loaded by tests.js under Node and by
 * script.js in the browser, so the live page and the test suite exercise
 * identical code.
 */
"use strict";

(function (root) {
  var A = 65;            // 'A'
  var Z = 90;            // 'Z'
  var a = 97;            // 'a'
  var z = 122;           // 'z'

  /* ================================================================== *
   * 0. Small shared helpers over the 26-letter alphabet.
   * ================================================================== */

  // True modulo that never returns a negative (JS `%` keeps the sign of n).
  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  // Letter -> 0..25, or -1 if not an ASCII letter. Case-folded.
  function letterIndex(code) {
    if (code >= A && code <= Z) return code - A;
    if (code >= a && code <= z) return code - a;
    return -1;
  }

  function isUpper(code) { return code >= A && code <= Z; }

  // Keep only letters, uppercased — the normalized form used by every
  // frequency-analysis routine below.
  function onlyLetters(text) {
    var out = "";
    for (var i = 0; i < text.length; i++) {
      var idx = letterIndex(text.charCodeAt(i));
      if (idx >= 0) out += String.fromCharCode(A + idx);
    }
    return out;
  }

  // Turn a key string into the list of shifts it encodes (0..25), ignoring any
  // non-letter. "LEMON" -> [11,4,12,14,13]; "a-b-c" -> [0,1,2].
  function keyToShifts(key) {
    var shifts = [];
    for (var i = 0; i < key.length; i++) {
      var idx = letterIndex(key.charCodeAt(i));
      if (idx >= 0) shifts.push(idx);
    }
    return shifts;
  }

  /* ================================================================== *
   * 1. VIGENÈRE — the one true engine. Caesar is a special case of it.
   *
   * `dir` is +1 to encrypt, -1 to decrypt. The key index advances ONLY on
   * letters, so punctuation and spaces pass through untouched and do not burn
   * a key position — the standard convention, and the one that makes
   * encrypt/decrypt exact inverses on any text.
   * ================================================================== */

  function vigenereShift(text, shifts, dir) {
    if (!shifts.length) {
      throw new Error("Vigenère key has no letters in it.");
    }
    var out = "";
    var k = 0;                       // position within the key, letters only
    var n = shifts.length;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      var idx = letterIndex(code);
      if (idx < 0) {                 // not a letter — copy verbatim
        out += text.charAt(i);
        continue;
      }
      var shifted = mod(idx + dir * shifts[k % n], 26);
      out += String.fromCharCode((isUpper(code) ? A : a) + shifted);
      k++;
    }
    return out;
  }

  var vigenere = {
    encrypt: function (text, key) { return vigenereShift(text, keyToShifts(key), +1); },
    decrypt: function (text, key) { return vigenereShift(text, keyToShifts(key), -1); }
  };

  /* ================================================================== *
   * 2. CAESAR — literally Vigenère with a single-letter key.
   *
   * We do NOT re-derive the letter math here; we build the one-letter key and
   * hand it to the Vigenère engine, so the two can never drift apart. The test
   * suite verifies caesar.encrypt(t, s) === vigenere.encrypt(t, keyFor(s)).
   * ================================================================== */

  function keyForShift(shift) {
    return String.fromCharCode(A + mod(shift, 26));
  }

  var caesar = {
    encrypt: function (text, shift) { return vigenereShift(text, [mod(shift, 26)], +1); },
    decrypt: function (text, shift) { return vigenereShift(text, [mod(shift, 26)], -1); },
    keyForShift: keyForShift,

    // Every one of the 25 non-trivial shifts, each scored for how English it
    // looks (lower chi-squared = more English). This is the whole brute-force
    // break: no key needed, just read the top row.
    bruteForce: function (cipher) {
      var rows = [];
      for (var s = 0; s < 26; s++) {
        var pt = caesar.decrypt(cipher, s);
        rows.push({ shift: s, key: keyForShift(s), text: pt, score: chiSquaredEnglish(pt) });
      }
      rows.sort(function (p, q) { return p.score - q.score; });
      return rows;
    }
  };

  /* ================================================================== *
   * 3. VERNAM / one-time pad — Vigenère taken to its logical extreme.
   *
   * XOR over raw UTF-8 bytes with a key AT LEAST as long as the message. The
   * ciphertext is returned base64-encoded (it is binary, not text). Encryption
   * and decryption are the same operation — XOR is its own inverse.
   *
   * The engine REFUSES a key shorter than the message, on purpose: a repeated
   * key is no longer a one-time pad, it is a running-key Vigenère over bytes,
   * and the perfect-secrecy proof evaporates. Silently repeating the key would
   * be the single most common way people turn Vernam back into something
   * breakable, so this file won't do it.
   * ================================================================== */

  function toBytes(str) {
    // UTF-8 encode without depending on TextEncoder (keeps Node + browser same).
    if (typeof TextEncoder !== "undefined") {
      return Array.prototype.slice.call(new TextEncoder().encode(str));
    }
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) { bytes.push(c); }
      else if (c < 0x800) {
        bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff) {        // surrogate pair
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                   0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return bytes;
  }

  function fromBytes(bytes) {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder().decode(new Uint8Array(bytes));
    }
    // Minimal UTF-8 decode fallback.
    var out = "", i = 0;
    while (i < bytes.length) {
      var b = bytes[i++];
      if (b < 0x80) { out += String.fromCharCode(b); }
      else if (b >= 0xf0) {
        var cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) |
                 ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      } else if (b >= 0xe0) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      } else {
        out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
      }
    }
    return out;
  }

  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function bytesToBase64(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      out += b2 === undefined ? "=" : B64[b2 & 63];
    }
    return out;
  }
  function base64ToBytes(str) {
    var clean = str.replace(/[^A-Za-z0-9+/]/g, "");
    var bytes = [];
    for (var i = 0; i < clean.length; i += 4) {
      var n0 = B64.indexOf(clean[i]), n1 = B64.indexOf(clean[i + 1]);
      var n2 = B64.indexOf(clean[i + 2]), n3 = B64.indexOf(clean[i + 3]);
      bytes.push((n0 << 2) | (n1 >> 4));
      if (n2 >= 0) bytes.push(((n1 & 15) << 4) | (n2 >> 2));
      if (n3 >= 0) bytes.push(((n2 & 3) << 6) | n3);
    }
    return bytes;
  }

  function xorBytes(msgBytes, keyBytes) {
    var out = new Array(msgBytes.length);
    for (var i = 0; i < msgBytes.length; i++) {
      out[i] = msgBytes[i] ^ keyBytes[i];
    }
    return out;
  }

  var vernam = {
    toBytes: toBytes,
    fromBytes: fromBytes,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,

    // Encrypt a plaintext string with a key string. The key must encode at
    // least as many bytes as the message. Returns base64 of the XOR.
    encrypt: function (plaintext, key) {
      var msg = toBytes(plaintext), k = toBytes(key);
      if (k.length < msg.length) {
        throw new Error("Vernam key is shorter than the message (" + k.length +
          " < " + msg.length + " bytes). A one-time pad must be at least as " +
          "long as what it hides — repeating it would break the cipher.");
      }
      return bytesToBase64(xorBytes(msg, k));
    },

    // Decrypt base64 ciphertext with the same key, back to a string.
    decrypt: function (b64, key) {
      var ct = base64ToBytes(b64), k = toBytes(key);
      if (k.length < ct.length) {
        throw new Error("Vernam key is shorter than the ciphertext; cannot decrypt.");
      }
      return fromBytes(xorBytes(ct, k));
    },

    // A fresh, cryptographically-random pad of `nBytes`, returned base64.
    // Uses crypto when present (browser / modern Node); otherwise throws rather
    // than hand back a predictable key that only looks like a one-time pad.
    generatePad: function (nBytes) {
      var buf = new Array(nBytes), i;
      var c = (typeof crypto !== "undefined" && crypto) ||
              (typeof self !== "undefined" && self.crypto);
      if (c && c.getRandomValues) {
        var arr = new Uint8Array(nBytes);
        c.getRandomValues(arr);
        for (i = 0; i < nBytes; i++) buf[i] = arr[i];
      } else {
        try {
          var nodeCrypto = require("crypto");
          var rb = nodeCrypto.randomBytes(nBytes);
          for (i = 0; i < nBytes; i++) buf[i] = rb[i];
        } catch (e) {
          throw new Error("No cryptographic RNG available; refusing to " +
            "generate a predictable pad.");
        }
      }
      return bytesToBase64(buf);
    }
  };

  /* ================================================================== *
   * 4. BREAKING Vigenère (and Caesar) with no key at all.
   *
   * English letters are wildly non-uniform — E alone is ~12.7%. Two routines
   * exploit that:
   *   • the index of coincidence finds the key LENGTH;
   *   • chi-squared frequency analysis solves each column as a Caesar.
   * ================================================================== */

  // Relative frequencies of A..Z in ordinary English text (percent).
  var ENGLISH_FREQ = [
    8.167, 1.492, 2.782, 4.253, 12.702, 2.228, 2.015, 6.094, 6.966, 0.153,
    0.772, 4.025, 2.406, 6.749, 7.507, 1.929, 0.095, 5.987, 6.327, 9.056,
    2.758, 0.978, 2.360, 0.150, 1.974, 0.074
  ];

  // Index of coincidence: the probability that two letters drawn at random
  // from the text are equal. Flat/random text ~0.0385; English prose ~0.0667.
  function indexOfCoincidence(letters) {
    var n = letters.length;
    if (n < 2) return 0;
    var counts = new Array(26);
    for (var i = 0; i < 26; i++) counts[i] = 0;
    for (var j = 0; j < n; j++) counts[letterIndex(letters.charCodeAt(j))]++;
    var sum = 0;
    for (var c = 0; c < 26; c++) sum += counts[c] * (counts[c] - 1);
    return sum / (n * (n - 1));
  }

  // Chi-squared distance between a text's letter distribution and English.
  // Lower is more English-like. Used to score candidate decryptions.
  function chiSquaredEnglish(text) {
    var letters = onlyLetters(text);
    var n = letters.length;
    if (n === 0) return Infinity;
    var counts = new Array(26);
    for (var i = 0; i < 26; i++) counts[i] = 0;
    for (var j = 0; j < n; j++) counts[letterIndex(letters.charCodeAt(j))]++;
    var chi = 0;
    for (var c = 0; c < 26; c++) {
      var expected = n * ENGLISH_FREQ[c] / 100;
      var diff = counts[c] - expected;
      chi += (diff * diff) / (expected || 1e-9);
    }
    return chi;
  }

  // Slice the normalized ciphertext into `g` columns — every g-th letter —
  // each of which was enciphered with a single, constant Caesar shift.
  function columns(letters, g) {
    var cols = [];
    for (var i = 0; i < g; i++) cols.push("");
    for (var j = 0; j < letters.length; j++) cols[j % g] += letters.charAt(j);
    return cols;
  }

  // For a single column, find the Caesar shift whose decryption best matches
  // English letter frequencies. Returns { shift, chi }.
  function bestShiftForColumn(column) {
    var best = { shift: 0, chi: Infinity };
    for (var s = 0; s < 26; s++) {
      var dec = vigenereShift(column, [s], -1);
      var chi = chiSquaredEnglish(dec);
      if (chi < best.chi) best = { shift: s, chi: chi };
    }
    return best;
  }

  // Rank candidate key lengths 1..maxLen by the average index of coincidence
  // of their columns. The right length makes each column look like English
  // (IoC near 0.0667); wrong lengths look random (near 0.0385).
  function guessKeyLengths(cipher, maxLen) {
    var letters = onlyLetters(cipher);
    maxLen = Math.min(maxLen || 16, Math.max(1, Math.floor(letters.length / 2)));
    var scored = [];
    for (var g = 1; g <= maxLen; g++) {
      var cols = columns(letters, g), sum = 0;
      for (var i = 0; i < g; i++) sum += indexOfCoincidence(cols[i]);
      scored.push({ length: g, ioc: sum / g });
    }
    // Closest to English IoC first.
    scored.sort(function (p, q) {
      return Math.abs(q.ioc - 0.0667) < Math.abs(p.ioc - 0.0667) ? 1 : -1;
    });
    return scored;
  }

  // A recovered key of length 12 that is really "HAMLET" twice decrypts the
  // text perfectly, but it isn't the key — any multiple of the true period
  // does. Collapse a key to its smallest repeating unit so we report the real
  // one ("HAMLETHAMLET" -> "HAMLET").
  function minimalPeriod(key) {
    var n = key.length;
    for (var p = 1; p <= n / 2; p++) {
      if (n % p !== 0) continue;
      var repeats = true;
      for (var i = p; i < n && repeats; i++) {
        if (key.charAt(i) !== key.charAt(i % p)) repeats = false;
      }
      if (repeats) return key.slice(0, p);
    }
    return key;
  }

  // Full break: recover key + plaintext from ciphertext alone. Tries the most
  // promising key lengths and keeps whichever recovered plaintext scores most
  // English overall.
  function crackVigenere(cipher, opts) {
    opts = opts || {};
    var letters = onlyLetters(cipher);
    if (letters.length < 4) {
      return { ok: false, reason: "Too little text to analyse." };
    }
    var lengths = guessKeyLengths(cipher, opts.maxKeyLen || 16);
    var tryN = Math.min(opts.tryLengths || 5, lengths.length);
    var best = null;

    for (var t = 0; t < tryN; t++) {
      var g = lengths[t].length;
      var cols = columns(letters, g);
      var key = "";
      for (var i = 0; i < g; i++) {
        key += String.fromCharCode(A + bestShiftForColumn(cols[i]).shift);
      }
      key = minimalPeriod(key);
      var plaintext = vigenere.decrypt(cipher, key);
      var score = chiSquaredEnglish(plaintext);
      if (!best || score < best.score) {
        best = { ok: true, keyLength: key.length, key: key, plaintext: plaintext,
                 score: score, ioc: lengths[t].ioc };
      }
    }
    return best;
  }

  /* ================================================================== *
   * 5. The two-time pad — why a one-time pad must be used ONCE.
   *
   * If two plaintexts P1, P2 are encrypted with the SAME key K, then
   *   C1 XOR C2 = (P1 XOR K) XOR (P2 XOR K) = P1 XOR P2.
   * The key cancels. You now have the XOR of the two messages with no key at
   * all, and English plaintext is redundant enough to peel apart. This routine
   * returns P1 XOR P2 straight from the two ciphertexts — the leak itself.
   * ================================================================== */

  function twoTimePad(b64a, b64b) {
    var A1 = base64ToBytes(b64a), B1 = base64ToBytes(b64b);
    var n = Math.min(A1.length, B1.length);
    var x = new Array(n);
    for (var i = 0; i < n; i++) x[i] = A1[i] ^ B1[i];
    return { xorBytes: x, xorBase64: bytesToBase64(x) };
  }

  /* ================================================================== *
   * Exports.
   * ================================================================== */
  var CIPHERS = {
    caesar: caesar,
    vigenere: vigenere,
    vernam: vernam,
    // analysis / attacks
    indexOfCoincidence: indexOfCoincidence,
    chiSquaredEnglish: chiSquaredEnglish,
    guessKeyLengths: guessKeyLengths,
    crackVigenere: crackVigenere,
    twoTimePad: twoTimePad,
    bestShiftForColumn: bestShiftForColumn,
    // low-level helpers (exposed so the UI and tests can reuse them)
    onlyLetters: onlyLetters,
    keyToShifts: keyToShifts,
    columns: columns,
    ENGLISH_FREQ: ENGLISH_FREQ,
    ENGLISH_IOC: 0.0667,
    RANDOM_IOC: 0.0385
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CIPHERS;
  else root.CIPHERS = CIPHERS;
})(typeof self !== "undefined" ? self : this);
