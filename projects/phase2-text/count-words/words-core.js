/*
 * words-core.js — the engine behind the Count Words in a String playground.
 *
 * "How many words are in this string?" sounds like one line:
 *
 *     str.trim().split(/\s+/).length
 *
 * Type that, feed it "the quick brown fox", get 4, and you feel finished. You
 * are not, and every place that one-liner is quietly wrong is where this file
 * lives:
 *
 *   1. THE EMPTY STRING COUNTS AS ONE WORD. `"".split(/\s+/)` is `[""]`, whose
 *      length is 1. So does `"   "` after it's trimmed to `""`. A string with
 *      no words in it should count 0, not 1 — the single most common word-count
 *      bug there is, and the one every naive tutorial ships.
 *
 *   2. PUNCTUATION ISN'T A WORD. Split "hi -- there :) !!!" on whitespace and
 *      you get five tokens; three of them (`--`, `:)`, `!!!`) are pure
 *      punctuation and emoticons, not words. A token is only a word if it
 *      carries at least one letter or digit.
 *
 *   3. "WHITESPACE" IS A UNICODE SET, NOT `[ \t\n]`. Real text separates words
 *      with no-break spaces (U+00A0), the narrow no-break space inside French
 *      numbers (U+202F), ideographic spaces (U+3000), line/paragraph separators
 *      (U+2028/U+2029) and more. We split on `\p{White_Space}`, the whole
 *      Unicode property, so every real separator ends a word.
 *
 * That is the project's DEFINITION of a word, and it is implemented TWICE, two
 * structurally different ways, so the test suite and the live page can
 * cross-check one against the other — the same "two independent implementations
 * must agree on every input" discipline the Count Vowels, Pig Latin, Reverse a
 * String and Check if Palindrome projects used:
 *
 *   - `scanWords`  walks the string one code point at a time, tracking whether
 *                  it is inside a non-whitespace run and whether that run has
 *                  yet seen a letter or digit; at each whitespace boundary it
 *                  banks a word if the run earned one. It never builds an array
 *                  of tokens.
 *   - `regexWords` splits the whole string on `/\p{White_Space}+/u` in one shot,
 *                  then keeps the tokens that match `/[\p{L}\p{N}]/u`.
 *
 * They must return the same count — and the same list of word tokens — on every
 * input. `count()` runs the scan and is what callers use; `analyze` wraps it
 * with everything the page draws (the kept words, the dropped non-word tokens,
 * the whitespace runs, the three rival counts).
 *
 *   4. ...AND WHITESPACE CAN'T SEE EVERY WORD BOUNDARY. This is the honest
 *      ceiling on the whole approach. Chinese, Japanese and Thai are written
 *      WITHOUT spaces — "你好世界" is four words with no separator anywhere — so
 *      NO whitespace rule, however careful, can count them. The only thing that
 *      can is Unicode text segmentation (UAX #29), which the platform ships as
 *      `Intl.Segmenter`. `segmentWords` uses it and counts the "word-like"
 *      segments. For spaced Latin text it tracks our whitespace count closely;
 *      for scriptio continua it reveals the gap the other two literally cannot.
 *      It is the exhibit, not the oracle — shown beside the count, the way the
 *      naive one-liner is, so the ceiling is visible, not asserted.
 *
 * Pure logic, no DOM. Runs in the browser (as `window.WORDS`) and in Node (as
 * `module.exports`) off the same source.
 */
"use strict";
(function (root) {

  // A word-granularity segmenter if the runtime has one (Node 16+, modern
  // browsers); otherwise null, and `segmentWords` reports unavailable. Built
  // once — constructing an Intl.Segmenter is not free.
  var WORD_SEG = null;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      WORD_SEG = new Intl.Segmenter(undefined, { granularity: "word" });
    }
  } catch (_e) {
    WORD_SEG = null;
  }

  // Does a single code point count as a "word character" — i.e. does its
  // presence in a token make that token a word? Letters (\p{L}) and numbers
  // (\p{N}). Marks, punctuation, symbols and whitespace do not.
  var WORD_CHAR = /[\p{L}\p{N}]/u;
  // Unicode whitespace, one code point.
  var WS = /\p{White_Space}/u;
  // Does a whole token contain at least one word character?
  var TOKEN_IS_WORD = /[\p{L}\p{N}]/u;

  function isWordChar(cp) { return WORD_CHAR.test(cp); }
  function isSpace(cp) { return WS.test(cp); }

  /* -------------------------------------------------------------------------
   * Implementation #1 — a single left-to-right scan by code point.
   *
   * Returns { count, words } where `words` is the list of word tokens in order.
   * Iterating the string with `for..of` yields whole code points (astral
   * characters included), so a surrogate pair is never torn mid-scan.
   * ---------------------------------------------------------------------- */
  function scanWords(str) {
    str = String(str);
    var words = [];
    var cur = "";        // the non-whitespace run we're building
    var curHasWord = false;

    function bank() {
      if (cur !== "" && curHasWord) words.push(cur);
      cur = "";
      curHasWord = false;
    }

    for (var ch of str) {
      if (isSpace(ch)) {
        bank();
      } else {
        cur += ch;
        if (!curHasWord && isWordChar(ch)) curHasWord = true;
      }
    }
    bank(); // flush the final run

    return { count: words.length, words: words };
  }

  /* -------------------------------------------------------------------------
   * Implementation #2 — split the whole string on whitespace, filter.
   *
   * Structurally independent of the scan: it builds every whitespace-delimited
   * token up front (`split`), then discards the ones with no letter or digit.
   * Must agree with `scanWords` on both the count and the kept-token list.
   * ---------------------------------------------------------------------- */
  function regexWords(str) {
    str = String(str);
    var tokens = str.split(/\p{White_Space}+/u);
    var words = [];
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] !== "" && TOKEN_IS_WORD.test(tokens[i])) words.push(tokens[i]);
    }
    return { count: words.length, words: words };
  }

  /* -------------------------------------------------------------------------
   * The exhibit — Unicode word segmentation (UAX #29) via Intl.Segmenter.
   *
   * Counts segments flagged `isWordLike`. This is the only method here that can
   * find word boundaries in scriptio continua (CJK, Thai). Returns
   * { available, count, words } so callers can show "unavailable" gracefully if
   * the runtime has no Segmenter.
   * ---------------------------------------------------------------------- */
  function segmentWords(str) {
    str = String(str);
    if (!WORD_SEG) return { available: false, count: null, words: [] };
    var words = [];
    for (var seg of WORD_SEG.segment(str)) {
      if (seg.isWordLike) words.push(seg.segment);
    }
    return { available: true, count: words.length, words: words };
  }

  /* -------------------------------------------------------------------------
   * The deliberately-naive one-liner, exactly as it's usually written — kept
   * honest, bug and all, so the page can show it falling over.
   *
   *   "".trim().split(/\s+/)      -> [""]        -> 1   (should be 0)
   *   "  ".trim().split(/\s+/)    -> [""]        -> 1   (should be 0)
   *   "hi :) !!!".split(/\s+/)    -> 3 tokens    -> 3   (one real word)
   * ---------------------------------------------------------------------- */
  function countNaive(str) {
    return String(str).trim().split(/\s+/).length;
  }

  /* -------------------------------------------------------------------------
   * count() — the number callers want, from the scan.
   * ---------------------------------------------------------------------- */
  function count(str) {
    return scanWords(str).count;
  }

  /* -------------------------------------------------------------------------
   * analyze() — everything the page draws, in one pass-friendly bundle.
   *
   * Returns:
   *   count          the authoritative word count (scan)
   *   words          the word tokens, in order
   *   codePoints     number of Unicode code points in the input
   *   segments       the input broken into { text, kind } pieces for rendering,
   *                  where kind is "word" | "nonword" | "space" — so the page
   *                  can highlight exactly what was counted and what was dropped
   *   dropped        the non-word tokens that were skipped (punctuation/emoji)
   *   naive          countNaive(str)
   *   segmenter      segmentWords(str) — { available, count, words }
   *   agree          scan and regex returned identical counts AND token lists
   * ---------------------------------------------------------------------- */
  function analyze(str) {
    str = String(str);
    var scan = scanWords(str);
    var rex = regexWords(str);
    var seg = segmentWords(str);

    // Build renderable segments: contiguous runs of space, of word-tokens, and
    // of non-word tokens. We re-walk so the page markup matches the scan rule
    // exactly (same code-point iteration, same word-char test).
    var segments = [];
    var cur = "";
    var curKind = null; // "space" | "run"
    function flushRun() {
      if (cur === "") return;
      // A finished non-whitespace run: word if it has a word char, else nonword.
      segments.push({ text: cur, kind: TOKEN_IS_WORD.test(cur) ? "word" : "nonword" });
      cur = "";
    }
    function flushSpace() {
      if (cur === "") return;
      segments.push({ text: cur, kind: "space" });
      cur = "";
    }
    for (var ch of str) {
      var sp = isSpace(ch);
      if (sp) {
        if (curKind === "run") flushRun();
        curKind = "space";
        cur += ch;
      } else {
        if (curKind === "space") flushSpace();
        curKind = "run";
        cur += ch;
      }
    }
    if (curKind === "space") flushSpace(); else flushRun();

    var dropped = [];
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].kind === "nonword") dropped.push(segments[i].text);
    }

    // Count code points without allocating a big array for huge inputs.
    var cps = 0;
    for (var _c of str) cps++; // eslint-disable-line no-unused-vars

    var agree = scan.count === rex.count && sameList(scan.words, rex.words);

    return {
      count: scan.count,
      words: scan.words,
      codePoints: cps,
      segments: segments,
      dropped: dropped,
      naive: countNaive(str),
      segmenter: seg,
      agree: agree
    };
  }

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  var API = {
    count: count,
    analyze: analyze,
    scanWords: scanWords,
    regexWords: regexWords,
    segmentWords: segmentWords,
    countNaive: countNaive,
    isWordChar: isWordChar,
    isSpace: isSpace,
    hasSegmenter: function () { return !!WORD_SEG; }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  } else {
    root.WORDS = API;
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
