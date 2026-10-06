/*
 * piglatin-core.js — the engine behind the Pig Latin playground.
 *
 * Pig Latin reads like a toy: "move the first letter to the end and add 'ay'."
 * Write that literally and you get `pig → igpay`, which looks like the whole
 * job is done. It isn't, and the gap is where this file lives:
 *
 *   1. The thing you move is not "the first letter" — it is the ONSET, the
 *      leading run of consonants before the first vowel: `smile → ilesmay`
 *      (move "sm"), `glove → oveglay` (move "gl"), `string → ingstray`.
 *
 *   2. "Vowel" is not a fixed set of five letters. `y` is a consonant at the
 *      START of a word (`yellow → ellowyay`) but a vowel anywhere else
 *      (`my → ymay`, `rhythm → ythmrhay`), and the `qu` digraph moves as one
 *      unit because the `u` is not acting as a vowel (`quiet → ietquay`,
 *      `square → aresquay`).
 *
 *   3. A word starting with a vowel takes a different suffix entirely
 *      (`apple → appleway`), and real text is not a bare lowercase word: it has
 *      capitalisation to carry (`Pig → Igpay`), punctuation to leave untouched
 *      (`Hello, world! → Ellohay, orldway!`), and digits and symbols that are
 *      not words at all.
 *
 *   4. The transform is NOT invertible. The consonant rule turns a word into a
 *      *rotation* of its letters plus a suffix, and nothing in the output
 *      records how far it rotated — so `igpay` could decode to `pig`, `gpi`-…
 *      Decoding means enumerating every rotation whose onset re-encodes to the
 *      input, and the true word is only one of several valid pre-images. This
 *      file makes that ambiguity concrete with `decodeCandidates`.
 *
 * The onset rule is implemented twice, two structurally different ways — a
 * forward character-by-character scan (`onsetLength`) and a first-vowel search
 * with a qu/​y fix-up (`onsetLengthOracle`) — so the test suite and the live
 * page can cross-check one against the other, the same "two independent
 * implementations must agree" trick the Reverse a String project borrowed from
 * Intl.Segmenter, here with no platform oracle to lean on.
 *
 * The module is dependency-free and never touches the DOM. Loaded with a
 * <script> tag it attaches to window.PL; under Node it is module.exports.
 */
"use strict";

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;          // Node / the test runner
  } else {
    root.PL = api;                 // the browser
  }
})(typeof self !== "undefined" ? self : this, function () {

  var VOWELS = "aeiou";

  // The three suffix conventions for a word that already starts with a vowel.
  // Consonant-initial words always take "ay"; only the vowel case is a matter
  // of taste, so it is the one thing the caller can choose.
  var VOWEL_SUFFIX = { way: "way", yay: "yay", ay: "ay" };
  function vowelSuffix(style) {
    return VOWEL_SUFFIX[style] || VOWEL_SUFFIX.way;
  }

  // --- the onset rule, implementation #1: a forward scan --------------------
  // Walk the (lowercased, letters-only) word left to right and count the
  // leading consonants. The two subtleties live here: `y` counts as a vowel
  // (and so STOPS the onset) everywhere except position 0, and a `q` drags its
  // following `u` into the onset because that `u` is not a syllable nucleus.
  function onsetLength(word) {
    requireString(word);
    var w = word.toLowerCase();
    var i = 0;
    while (i < w.length) {
      var c = w[i];
      if (VOWELS.indexOf(c) !== -1) break;      // a, e, i, o, u end the onset
      if (c === "y" && i > 0) break;            // y is a vowel after position 0
      i++;                                      // c is a consonant: consume it
      if (c === "q" && w[i] === "u") i++;       // qu moves as one unit
    }
    return i;
  }

  // --- the onset rule, implementation #2: an independent oracle -------------
  // Deliberately structured differently: find the first vowel position, then
  // repair for the qu digraph (a `u` sitting right after a `q` is swallowed and
  // the search continues past it). Same answer as onsetLength on every input —
  // that agreement is what the tests and the live page assert.
  function onsetLengthOracle(word) {
    requireString(word);
    var w = word.toLowerCase();
    function firstVowelFrom(start) {
      for (var i = start; i < w.length; i++) {
        var c = w[i];
        if (VOWELS.indexOf(c) !== -1) return i;
        if (c === "y" && i > 0) return i;
      }
      return -1;                                 // no vowel at or after `start`
    }
    var vi = firstVowelFrom(0);
    if (vi === -1) return w.length;              // all consonants → whole word
    if (vi === 0) return 0;                      // starts on a vowel → no onset
    // qu fix-up: while the vowel we stopped on is a `u` glued to a leading `q`,
    // it belongs to the onset; swallow it and look for the real nucleus after.
    while (w[vi] === "u" && w[vi - 1] === "q") {
      var next = firstVowelFrom(vi + 1);
      if (next === -1) return w.length;
      vi = next;
    }
    return vi;
  }

  // --- encode a single all-letters word -------------------------------------
  // Pure Pig Latin for one word of letters. Case is detected, the transform is
  // done in lowercase, then the original case *shape* is re-applied to the
  // result (ALLCAPS → ALLCAPS, Titlecase → Titlecase, anything else → as-is).
  // Returns { result, onset, rest, vowelInitial } so callers can show the work.
  function encodeWord(word, opts) {
    requireString(word);
    if (!/^[A-Za-z]+$/.test(word)) {
      throw new Error("encodeWord expects a run of ASCII letters, got: " + JSON.stringify(word));
    }
    var style = (opts && opts.style) || "way";
    var lower = word.toLowerCase();
    var k = onsetLength(lower);
    var onset = lower.slice(0, k);
    var rest = lower.slice(k);
    var out, vowelInitial = k === 0;
    if (vowelInitial) {
      out = lower + vowelSuffix(style);          // apple → apple + way
    } else {
      out = rest + onset + "ay";                 // smile → ile + sm + ay
    }
    return {
      result: applyCase(word, out),
      onset: onset,
      rest: rest,
      vowelInitial: vowelInitial,
      suffix: vowelInitial ? vowelSuffix(style) : "ay"
    };
  }

  // Convenience: just the string.
  function encodeWordStr(word, opts) { return encodeWord(word, opts).result; }

  // --- tokenising real text --------------------------------------------------
  // A token is either a WORD (a maximal run of ASCII letters) or a GAP
  // (everything else — spaces, punctuation, digits, newlines, emoji). Only
  // words are transformed; gaps are preserved byte-for-byte and in place, which
  // is what makes the text round-trip exactly (see detokenize). Apostrophes are
  // gaps, so a contraction like "don't" is piglatinised in its letter parts —
  // an honest, lossless choice rather than a guess about English morphology.
  function tokenize(text) {
    requireString(text);
    var tokens = [];
    var re = /[A-Za-z]+|[^A-Za-z]+/g, m;
    while ((m = re.exec(text)) !== null) {
      var s = m[0];
      tokens.push({ word: /^[A-Za-z]/.test(s), text: s });
    }
    return tokens;
  }

  // Reassemble tokens into text. detokenize(tokenize(s)) === s, always.
  function detokenize(tokens) {
    var out = "";
    for (var i = 0; i < tokens.length; i++) out += tokens[i].text;
    return out;
  }

  // --- encode a whole passage -------------------------------------------------
  function encode(text, opts) {
    requireString(text);
    return tokenize(text).map(function (t) {
      return t.word ? encodeWordStr(t.text, opts) : t.text;
    }).join("");
  }

  // Like encode, but returns the per-word work for the UI's breakdown table:
  // one entry per WORD token (gaps omitted), in order.
  function encodeDetailed(text, opts) {
    requireString(text);
    var rows = [];
    tokenize(text).forEach(function (t) {
      if (t.word) rows.push(enrich(t.text, encodeWord(t.text, opts)));
    });
    return rows;
  }
  function enrich(original, e) {
    return {
      original: original,
      result: e.result,
      onset: e.onset,
      rest: e.rest,
      vowelInitial: e.vowelInitial,
      suffix: e.suffix,
      usedQu: /qu/.test(e.onset),                       // qu digraph in the onset
      usedInitialY: e.onset.toLowerCase()[0] === "y",   // word-initial y as consonant
      noVowel: !e.vowelInitial && e.rest === ""         // consonant-only word
    };
  }

  // --- decoding: the ambiguity made concrete ---------------------------------
  // Invert the consonant rule for one lowercase Pig Latin word. encode moves an
  // onset of length j to the end, so the core (output minus "ay") is
  //   core = rest + onset = word[j:] + word[0:j]
  // a left-rotation of the original by j. We don't know j, so we try every
  // rotation that puts `onset` back in front and check it re-encodes to the
  // input. Each survivor is a valid pre-image; usually there is more than one,
  // which is the whole point — Pig Latin is not injective.
  function decodeCandidates(pig, opts) {
    requireString(pig);
    var style = (opts && opts.style) || "way";
    var w = pig.toLowerCase();
    var cands = [];
    var seen = {};
    function add(word) {
      if (!seen[word]) { seen[word] = true; cands.push(word); }
    }

    // Case A: it was a vowel-initial word (ends with the vowel suffix, and the
    // body itself starts with a vowel). Strip the suffix.
    var vs = vowelSuffix(style);
    if (endsWith(w, vs)) {
      var body = w.slice(0, w.length - vs.length);
      if (body.length && onsetLength(body) === 0 &&
          encodeWordStr(body, opts).toLowerCase() === w) {
        add(body);
      }
    }

    // Case B: it was a consonant-initial word → ends in "ay"; the core is a
    // rotation. Try moving the last j letters of the core back to the front.
    if (endsWith(w, "ay")) {
      var core = w.slice(0, w.length - 2);
      for (var j = 1; j <= core.length; j++) {
        var cand = core.slice(core.length - j) + core.slice(0, core.length - j);
        // A valid pre-image must round-trip: encoding it reproduces `w`.
        try {
          if (encodeWordStr(cand, opts).toLowerCase() === w) add(cand);
        } catch (e) { /* non-letter candidate — skip */ }
      }
    }
    return cands;
  }

  // --- a little analysis ------------------------------------------------------
  // The "what's actually in here" panel: token/word counts and a census of the
  // cases that make the rule more than one line.
  function analyze(text, opts) {
    requireString(text);
    var rows = encodeDetailed(text, opts);
    var vowelInitial = 0, consonantInitial = 0, qu = 0, initialY = 0, noVowel = 0;
    rows.forEach(function (r) {
      if (r.vowelInitial) vowelInitial++; else consonantInitial++;
      if (r.usedQu) qu++;
      if (r.usedInitialY) initialY++;
      if (r.noVowel) noVowel++;
    });
    return {
      words: rows.length,
      vowelInitial: vowelInitial,
      consonantInitial: consonantInitial,
      qu: qu,
      initialY: initialY,
      noVowel: noVowel
    };
  }

  // --- case handling ----------------------------------------------------------
  // Re-apply the original word's case shape to the (lowercase) result.
  function applyCase(original, lowerResult) {
    // Title is tested before all-caps so a lone capital letter — the pronoun
    // "I", or "A" at the start of a sentence — reads as Titlecase ("Iway"),
    // not as a shout ("IWAY"); a genuine multi-letter shout like "HELLO" is
    // not Titlecase, so it still falls through to the all-caps branch.
    if (isTitle(original)) return capitalize(lowerResult);
    if (isAllUpper(original)) return lowerResult.toUpperCase();
    return lowerResult;                           // all-lower or mixed → as computed
  }
  function isAllUpper(s) { return s === s.toUpperCase() && s !== s.toLowerCase(); }
  function isTitle(s) {
    return s.length > 0 &&
      s[0] === s[0].toUpperCase() && s[0] !== s[0].toLowerCase() &&
      s.slice(1) === s.slice(1).toLowerCase();
  }
  function capitalize(s) {
    return s.length ? s[0].toUpperCase() + s.slice(1) : s;
  }

  // --- helpers ----------------------------------------------------------------
  function endsWith(s, suffix) {
    return s.length >= suffix.length && s.slice(s.length - suffix.length) === suffix;
  }
  function requireString(s) {
    if (typeof s !== "string") throw new TypeError("expected a string");
  }

  return {
    onsetLength: onsetLength,
    onsetLengthOracle: onsetLengthOracle,
    encodeWord: encodeWord,
    encodeWordStr: encodeWordStr,
    tokenize: tokenize,
    detokenize: detokenize,
    encode: encode,
    encodeDetailed: encodeDetailed,
    decodeCandidates: decodeCandidates,
    analyze: analyze,
    applyCase: applyCase
  };
});
