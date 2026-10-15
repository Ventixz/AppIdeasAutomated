/*
 * tests.js — dependency-free test suite for the Caesar / Vigenère / Vernam
 * engine.
 *
 * Run it:  node projects/phase2-text/vigenere-vernam-caesar-ciphers/tests.js
 *
 * Six kinds of check, matching the house pattern:
 *   1. a curated corpus pinned to known textbook encryptions;
 *   2. the unification law — Caesar IS Vigenère with a one-letter key;
 *   3. round-trip laws — decrypt(encrypt(x)) === x, over a large fuzz, for all
 *      three ciphers and over full Unicode for Vernam;
 *   4. the attacks actually work — crackVigenere recovers the key with no key
 *      given, and Caesar brute force puts English on top;
 *   5. the two-time pad leak — C1 XOR C2 === P1 XOR P2, the key cancels;
 *   6. the guardrails — a too-short Vernam key is refused, not silently
 *      repeated.
 */
"use strict";
var C = require("./ciphers-core.js");

var passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name + (extra ? "  — " + extra : "")); }
}
function eq(name, got, want) {
  ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

/* ------------------------------------------------------------------ *
 * 1. Curated corpus — the textbook examples everyone checks against.
 * ------------------------------------------------------------------ */

// Caesar: the canonical shift-3 ("ROT" family) and ROT13.
eq("caesar shift 3 HELLO", C.caesar.encrypt("HELLO", 3), "KHOOR");
eq("caesar shift 3 decrypt", C.caesar.decrypt("KHOOR", 3), "HELLO");
eq("caesar ROT13 self-inverse", C.caesar.encrypt(C.caesar.encrypt("Why did the chicken", 13), 13), "Why did the chicken");
eq("caesar keeps case", C.caesar.encrypt("AbcXyz", 1), "BcdYza");
eq("caesar passes punctuation", C.caesar.encrypt("Hi, World!", 5), "Mn, Btwqi!");
eq("caesar negative shift", C.caesar.decrypt("KHOOR", -23), "HELLO"); // -23 ≡ +3 mod 26
eq("caesar shift 0 is identity", C.caesar.encrypt("Nothing moves.", 0), "Nothing moves.");
eq("caesar wraps Z", C.caesar.encrypt("XYZ", 3), "ABC");

// Vigenère: the LEMON/ATTACKATDAWN example straight out of the Wikipedia page.
eq("vigenere LEMON encrypt", C.vigenere.encrypt("ATTACKATDAWN", "LEMON"), "LXFOPVEFRNHR");
eq("vigenere LEMON decrypt", C.vigenere.decrypt("LXFOPVEFRNHR", "LEMON"), "ATTACKATDAWN");
eq("vigenere keeps case + spaces", C.vigenere.encrypt("Attack at dawn", "Lemon"), "Lxfopv ef rnhr");
eq("vigenere key ignores non-letters", C.vigenere.encrypt("ATTACKATDAWN", "L-E-M-O-N"), "LXFOPVEFRNHR");
eq("vigenere punctuation does not burn key", C.vigenere.encrypt("A.T.T", "LEMON"), "L.X.F");

// Vernam: XOR is its own inverse, and a known tiny vector.
(function () {
  // "AB" = [0x41,0x42], key "  " would be [0x20,0x20]; 0x41^0x20=0x61='a'
  var b64 = C.vernam.encrypt("AB", "  ");
  eq("vernam AB xor spaces -> 'ab'", C.vernam.fromBytes(C.vernam.base64ToBytes(b64)), "ab");
})();

/* ------------------------------------------------------------------ *
 * 2. The unification law: Caesar === Vigenère with a one-letter key.
 *    This is the architectural claim the whole core rests on.
 * ------------------------------------------------------------------ */
(function () {
  var sample = "The Quick Brown Fox, Jumps! 123 over THE lazy dog.";
  for (var s = 0; s < 26; s++) {
    var key = C.caesar.keyForShift(s);
    eq("caesar(" + s + ") === vigenere('" + key + "') encrypt",
       C.caesar.encrypt(sample, s), C.vigenere.encrypt(sample, key));
    eq("caesar(" + s + ") === vigenere('" + key + "') decrypt",
       C.caesar.decrypt(sample, s), C.vigenere.decrypt(sample, key));
  }
})();

/* ------------------------------------------------------------------ *
 * 3. Round-trip laws over a large pseudo-random fuzz.
 * ------------------------------------------------------------------ */
(function () {
  // Deterministic PRNG so failures reproduce.
  var seed = 1234567;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function randText(n) {
    var pool = "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ .,!?'-\n0123456789";
    var s = "";
    for (var i = 0; i < n; i++) s += pool[Math.floor(rnd() * pool.length)];
    return s;
  }
  function randKey(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += "abcdefghijklmnopqrstuvwxyz"[Math.floor(rnd() * 26)];
    return s;
  }

  var rtFails = 0, vFails = 0;
  for (var t = 0; t < 400; t++) {
    var text = randText(1 + Math.floor(rnd() * 60));

    // Caesar round trip for a random shift.
    var sh = Math.floor(rnd() * 26);
    if (C.caesar.decrypt(C.caesar.encrypt(text, sh), sh) !== text) rtFails++;

    // Vigenère round trip for a random 1..8 letter key.
    var key = randKey(1 + Math.floor(rnd() * 8));
    if (C.vigenere.decrypt(C.vigenere.encrypt(text, key), key) !== text) vFails++;
  }
  ok("caesar round-trips over 400 random texts", rtFails === 0, rtFails + " failures");
  ok("vigenere round-trips over 400 random texts", vFails === 0, vFails + " failures");

  // Vernam round trip over FULL Unicode (emoji, CJK, combining marks).
  var uFails = 0;
  var unicode = ["Hello, 世界! 🌍", "café — naïve façade", "👩‍👩‍👧‍👦 family", "áè", "ЗдравствуйтеΩ≈ç√∫"];
  for (var u = 0; u < unicode.length; u++) {
    var pad = C.vernam.generatePad(C.vernam.toBytes(unicode[u]).length);
    var ct = C.vernam.encrypt(unicode[u], C.vernam.fromBytes(C.vernam.base64ToBytes(pad)));
    if (C.vernam.decrypt(ct, C.vernam.fromBytes(C.vernam.base64ToBytes(pad))) !== unicode[u]) uFails++;
  }
  ok("vernam round-trips over full Unicode", uFails === 0, uFails + " failures");
})();

/* ------------------------------------------------------------------ *
 * 4. The attacks work — key recovery with NO key supplied.
 * ------------------------------------------------------------------ */
(function () {
  var plain =
    "To be, or not to be, that is the question: Whether tis nobler in the " +
    "mind to suffer the slings and arrows of outrageous fortune, or to take " +
    "arms against a sea of troubles and by opposing end them. To die to " +
    "sleep no more and by a sleep to say we end the heartache and the " +
    "thousand natural shocks that flesh is heir to.";

  // Break Vigenère cold.
  var key = "HAMLET";
  var cipher = C.vigenere.encrypt(plain, key);
  var cracked = C.crackVigenere(cipher);
  ok("crackVigenere finds the key length", cracked.ok && cracked.keyLength === key.length,
     "got length " + (cracked && cracked.keyLength));
  eq("crackVigenere recovers the key", cracked.key, key);
  eq("crackVigenere recovers the plaintext", cracked.plaintext, plain);

  // Caesar brute force must float the English answer to the top.
  var cShift = 7;
  var cCipher = C.caesar.encrypt(plain, cShift);
  var rows = C.caesar.bruteForce(cCipher);
  eq("caesar brute force top shift", rows[0].shift, cShift);
  eq("caesar brute force top plaintext", rows[0].text, plain);

  // Index of coincidence sanity: English prose is far from random.
  var iocEnglish = C.indexOfCoincidence(C.onlyLetters(plain));
  ok("IoC of English prose is near 0.067", iocEnglish > 0.055 && iocEnglish < 0.085,
     "got " + iocEnglish.toFixed(4));
  var iocCipher = C.indexOfCoincidence(C.onlyLetters(cipher));
  ok("IoC of Vigenère ciphertext is flatter than English", iocCipher < iocEnglish,
     "cipher " + iocCipher.toFixed(4) + " vs plain " + iocEnglish.toFixed(4));
})();

/* ------------------------------------------------------------------ *
 * 5. The two-time pad leak — the key cancels, exposing P1 XOR P2.
 * ------------------------------------------------------------------ */
(function () {
  var p1 = "attack at dawn on the north bridge";
  var p2 = "retreat to the hills before sunset";
  var padLen = Math.max(C.vernam.toBytes(p1).length, C.vernam.toBytes(p2).length);
  var key = C.vernam.fromBytes(C.vernam.base64ToBytes(C.vernam.generatePad(padLen)));

  var c1 = C.vernam.encrypt(p1, key);
  var c2 = C.vernam.encrypt(p2, key);

  var leak = C.twoTimePad(c1, c2);

  // Independently compute P1 XOR P2 from the plaintexts and compare.
  var b1 = C.vernam.toBytes(p1), b2 = C.vernam.toBytes(p2);
  var n = Math.min(b1.length, b2.length), expected = [];
  for (var i = 0; i < n; i++) expected.push(b1[i] ^ b2[i]);
  var match = leak.xorBytes.length >= n;
  for (var j = 0; j < n && match; j++) if (leak.xorBytes[j] !== expected[j]) match = false;
  ok("two-time pad recovers P1 XOR P2 without the key", match);

  // And it is NOT just zeros (that would be the trivial same-message case).
  var nonzero = leak.xorBytes.some(function (x) { return x !== 0; });
  ok("the leaked XOR is non-trivial", nonzero);
})();

/* ------------------------------------------------------------------ *
 * 6. Guardrails — the engine refuses to weaken itself.
 * ------------------------------------------------------------------ */
(function () {
  var threw = false;
  try { C.vernam.encrypt("this message is long", "shortkey"); }
  catch (e) { threw = true; }
  ok("vernam refuses a key shorter than the message", threw);

  var threw2 = false;
  try { C.vigenere.encrypt("hello", "12345"); }   // no letters in the key
  catch (e) { threw2 = true; }
  ok("vigenere refuses a key with no letters", threw2);

  // A pad exactly the message length is accepted.
  var exactThrew = false;
  try { C.vernam.encrypt("abc", "xyz"); } catch (e) { exactThrew = true; }
  ok("vernam accepts a key exactly the message length", !exactThrew);
})();

/* ------------------------------------------------------------------ *
 * Tally.
 * ------------------------------------------------------------------ */
console.log("\n" + passed + " passed, " + failed + " failed.");
if (failed) process.exit(1);
