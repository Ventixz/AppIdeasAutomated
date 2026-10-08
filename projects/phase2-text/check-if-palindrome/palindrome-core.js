/*
 * palindrome-core.js — the engine behind the Check if Palindrome playground.
 *
 * "Is this string a palindrome?" sounds like one line:
 *
 *     s === s.split("").reverse().join("")
 *
 * Type that and `racecar` says true and you feel finished. You are not, and
 * every place that one-liner is quietly wrong is where this file lives:
 *
 *   1. `split("")` CUTS BETWEEN UTF-16 UNITS, NOT CHARACTERS. An astral
 *      character — an emoji, the maths-bold `𝐚` (U+1D41A) — is stored as a
 *      *surrogate pair* of two 16-bit units. `split("")` tears the pair in half
 *      and `reverse()` swaps the halves, producing a different (often broken)
 *      string. So `"😀"` compared to its own reverse can come back *false* — a
 *      one-character string that isn't equal to itself reversed. The fix is to
 *      split by Unicode CODE POINT (`Array.from`), which keeps each astral
 *      character whole.
 *
 *   2. ACCENTS LIVE ON THEIR OWN. `"é"` can arrive as one code point (NFC,
 *      U+00E9) or as `e` + a combining acute accent (NFD, two code points).
 *      Reverse the NFD form by code point and the accent floats off onto the
 *      wrong letter. The honest unit of text here is the GRAPHEME CLUSTER — what
 *      a reader calls "one character" — which `Intl.Segmenter` gives us, so
 *      `"é"` reverses as a single unit and the accent stays put.
 *
 *   3. A PALINDROME OF *WHAT*? `"RaceCar"` is a palindrome to a person and not
 *      to `===` (`R` ≠ `r`). `"A man, a plan, a canal: Panama"` is the textbook
 *      palindrome and matches nothing character-for-character. These are
 *      *choices*, so the caller makes them: fold case, fold accents to the base
 *      letter, and/or keep only letters and digits (dropping spaces and
 *      punctuation). Strict mode makes none of them — exact text, reversed.
 *
 * The check is implemented TWICE, two structurally different ways, so the test
 * suite and the live page can cross-check one against the other — the same "two
 * independent implementations must agree" discipline the Count Vowels, Pig
 * Latin and Reverse a String projects used:
 *
 *   - `twoPointer`     walks one index in from each end of the cleaned unit
 *                      array, comparing the pair and stopping at the first
 *                      mismatch. It never builds the reversed string.
 *   - `reverseCompare` reverses the whole cleaned unit array and compares it to
 *                      the forward array element by element.
 *
 * They must return the same verdict and the same first-mismatch index on every
 * input. `check()` runs the two-pointer scan and is what callers use; `analyze`
 * wraps it with everything the page draws (the kept units, the dropped ones,
 * the mirror pairing, the naive one-liner's answer for comparison).
 *
 * Pure logic, no DOM. Runs in the browser (as `window.PAL`) and in Node (as
 * `module.exports`) off the same source.
 */
"use strict";
(function (root) {

  // A grapheme segmenter if the runtime has one (Node 16+, modern browsers);
  // otherwise null, and we fall back to code points. Built once.
  var GRAPHEME_SEG = null;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      GRAPHEME_SEG = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    }
  } catch (_e) { GRAPHEME_SEG = null; }

  var DEFAULTS = {
    granularity: "grapheme", // "grapheme" | "codepoint" — what counts as one unit
    ignoreCase: true,        // RaceCar === racecar
    ignoreDiacritics: false, // fold "é" to "e" before comparing
    alnumOnly: true          // keep only letters/digits (drop spaces & punctuation)
  };

  function withDefaults(opts) {
    var o = {};
    for (var k in DEFAULTS) { o[k] = DEFAULTS[k]; }
    if (opts) { for (var j in opts) { if (j in o) { o[j] = opts[j]; } } }
    return o;
  }

  // ---- step 1: break the string into user-perceived units -------------------
  // Each unit records the grapheme/code-point and its position *in the original
  // string* (as a code-point index), so the page can point back at the source.
  function toUnits(str, granularity) {
    var out = [];
    if (str == null) { return out; }
    str = String(str);
    if (granularity !== "codepoint" && GRAPHEME_SEG) {
      var i = 0;
      var segs = GRAPHEME_SEG.segment(str);
      var it = segs[Symbol.iterator]();
      var step = it.next();
      while (!step.done) {
        var seg = step.value.segment;
        out.push({ text: seg, cp: i });
        i += Array.from(seg).length; // advance by code points, not UTF-16 units
        step = it.next();
      }
      return out;
    }
    // code-point fallback (and the explicit "codepoint" mode)
    var idx = 0;
    var arr = Array.from(str); // Array.from iterates by code point, keeping pairs whole
    for (var n = 0; n < arr.length; n++) {
      out.push({ text: arr[n], cp: idx });
      idx += 1;
    }
    return out;
  }

  // ---- step 2: normalise one unit into a comparison key ----------------------
  // Returns a string key, or null when the unit should be dropped entirely
  // (alnumOnly is on and the unit carries no letter or digit).
  var COMBINING = /\p{M}/gu;
  var ALNUM = /[\p{L}\p{N}]/u;

  function keyOf(text, o) {
    var base = text;
    if (o.ignoreDiacritics) {
      // decompose, drop combining marks, recompose — "é" -> "e", "ñ" -> "n"
      base = base.normalize("NFD").replace(COMBINING, "").normalize("NFC");
    }
    if (o.alnumOnly) {
      // keep the unit only if, once accents are set aside, it is a letter/digit
      var probe = base.normalize("NFD").replace(COMBINING, "");
      if (!ALNUM.test(probe)) { return null; }
    }
    if (o.ignoreCase) {
      base = base.toLowerCase();
    }
    // Canonicalise so "é" (NFC) and "e´" (NFD) that survived folding compare equal.
    return base.normalize("NFC");
  }

  // ---- step 3a: the kept keys plus a back-map to source units ----------------
  function cleaned(str, opts) {
    var o = withDefaults(opts);
    var units = toUnits(str, o.granularity);
    var keys = [];
    var kept = [];   // indices into `units` that survived
    for (var i = 0; i < units.length; i++) {
      var k = keyOf(units[i].text, o);
      if (k === null) { continue; }
      keys.push(k);
      kept.push(i);
    }
    return { o: o, units: units, keys: keys, kept: kept };
  }

  // ---- implementation #1: two-pointer scan -----------------------------------
  // Walk in from both ends. Returns the verdict and, on failure, the index (into
  // the cleaned `keys` array) of the first pair that disagreed.
  function twoPointer(keys) {
    var i = 0, j = keys.length - 1;
    while (i < j) {
      if (keys[i] !== keys[j]) {
        return { isPalindrome: false, mismatch: i };
      }
      i++; j--;
    }
    return { isPalindrome: true, mismatch: -1 };
  }

  // ---- implementation #2: reverse the array and compare ----------------------
  // Structurally different: it materialises the reversed array and compares
  // element by element, scanning left to right.
  function reverseCompare(keys) {
    var rev = keys.slice().reverse();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] !== rev[i]) {
        return { isPalindrome: false, mismatch: i };
      }
    }
    return { isPalindrome: true, mismatch: -1 };
  }

  // ---- the naive one-liner, kept honest for side-by-side comparison ----------
  // This is what everyone writes first. It splits by UTF-16 unit (so it can
  // mangle astral characters) and compares exactly (case- and accent-sensitive,
  // punctuation included).
  function naive(str) {
    str = String(str == null ? "" : str);
    return str === str.split("").reverse().join("");
  }

  // ---- the public check: run the two implementations and insist they agree ---
  function check(str, opts) {
    var c = cleaned(str, opts);
    var a = twoPointer(c.keys);
    var b = reverseCompare(c.keys);
    if (a.isPalindrome !== b.isPalindrome || a.mismatch !== b.mismatch) {
      throw new Error(
        "palindrome cross-check failed for " + JSON.stringify(str) +
        ": twoPointer=" + JSON.stringify(a) + " reverseCompare=" + JSON.stringify(b)
      );
    }
    return a;
  }

  // ---- everything the page needs to draw -------------------------------------
  // Returns the verdict, the comparison unit (what one "character" means here),
  // the kept units and the dropped ones, and the mirror pairing so the UI can
  // line the string up against itself and point at the first break.
  function analyze(str, opts) {
    var c = cleaned(str, opts);
    var verdict = check(str, opts);

    // Pair up kept units with their mirror partner; flag which pairs matched.
    var pairs = [];
    var n = c.keys.length;
    for (var i = 0; i < Math.ceil(n / 2); i++) {
      var j = n - 1 - i;
      pairs.push({
        left: c.kept[i],
        right: c.kept[j],
        center: i === j,
        ok: c.keys[i] === c.keys[j]
      });
    }

    // Which source units were dropped (only meaningful when alnumOnly is on).
    var droppedCount = c.units.length - c.kept.length;

    return {
      options: c.o,
      input: String(str == null ? "" : str),
      units: c.units,            // every source unit, in order, with .text/.cp
      kept: c.kept,              // indices into units that were compared
      keys: c.keys,              // the folded comparison keys
      pairs: pairs,              // mirror pairing, for the visual
      isPalindrome: verdict.isPalindrome,
      mismatch: verdict.mismatch, // index into keys, or -1
      comparedCount: c.keys.length,
      droppedCount: droppedCount,
      codePointCount: c.units.length,
      naive: naive(str),         // the one-liner's verdict on the raw string
      utf16Length: String(str == null ? "" : str).length
    };
  }

  var API = {
    DEFAULTS: DEFAULTS,
    hasGraphemeSupport: !!GRAPHEME_SEG,
    toUnits: toUnits,
    keyOf: keyOf,
    cleaned: cleaned,
    twoPointer: twoPointer,
    reverseCompare: reverseCompare,
    naive: naive,
    check: check,
    isPalindrome: function (str, opts) { return check(str, opts).isPalindrome; },
    analyze: analyze
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  } else {
    root.PAL = API;
  }
})(typeof window !== "undefined" ? window : this);
