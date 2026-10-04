/*
 * fizzbuzz-core.js — the engine behind the Fizz Buzz playground.
 *
 * Classic Fizz Buzz is three lines of code. The interesting part — and what
 * this file is about — is the *generalisation* every programmer eventually
 * reaches for: instead of hard-coding "3 → Fizz" and "5 → Buzz", let the
 * rules be data. A rule is a { divisor, word } pair; a number is replaced by
 * the concatenation of every rule's word whose divisor divides it, and by the
 * number itself when no rule matches. Classic Fizz Buzz is then just the two
 * rules [3→Fizz, 5→Buzz].
 *
 * The module is written in old-school, dependency-free JavaScript so the exact
 * same file runs in the browser (loaded with a <script> tag, exported on
 * window.FB) and under Node for the test suite (module.exports). It never
 * touches the DOM.
 */
"use strict";

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;          // Node / the test runner
  } else {
    root.FB = api;                 // the browser
  }
})(typeof self !== "undefined" ? self : this, function () {

  // --- the canonical game -------------------------------------------------
  // The two rules that make Fizz Buzz itself. Returned fresh each call so a
  // caller can safely mutate the array it gets back.
  function classicRules() {
    return [
      { divisor: 3, word: "Fizz" },
      { divisor: 5, word: "Buzz" }
    ];
  }

  // --- rule validation ----------------------------------------------------
  // Rules come from a UI where anyone can type anything, so every public
  // function funnels its rules through here first. We reject what can't make a
  // well-defined game — a non-integer divisor, a divisor of zero (everything
  // is "divisible" by zero only under a convention we don't want to guess), a
  // negative divisor (|d| would do the same job, so it's almost certainly a
  // mistake), or a blank word. The result is a clean, order-preserving copy.
  function normaliseRules(rules) {
    if (!Array.isArray(rules)) {
      throw new TypeError("rules must be an array of { divisor, word }");
    }
    var out = [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r || typeof r !== "object") {
        throw new TypeError("rule " + i + " is not an object");
      }
      var d = r.divisor;
      if (typeof d !== "number" || !isFinite(d) || Math.floor(d) !== d) {
        throw new RangeError("rule " + i + ": divisor must be an integer");
      }
      if (d <= 0) {
        throw new RangeError("rule " + i + ": divisor must be a positive integer");
      }
      var w = r.word;
      if (typeof w !== "string" || w.length === 0) {
        throw new RangeError("rule " + i + ": word must be a non-empty string");
      }
      out.push({ divisor: d, word: w });
    }
    return out;
  }

  // Does `d` divide `n`? Defined so that 0 is a multiple of every divisor
  // (0 % d === 0), which is the mathematically honest answer and keeps ranges
  // that include zero behaving predictably.
  function divides(d, n) {
    return n % d === 0;
  }

  // --- the heart of it ----------------------------------------------------
  // The label for a single number under a set of rules: the words of every
  // matching rule joined in rule order, or the number as a string when none
  // match. `rules` is assumed already normalised (the public wrappers do it).
  function labelWith(n, rules) {
    var word = "";
    for (var i = 0; i < rules.length; i++) {
      if (divides(rules[i].divisor, n)) {
        word += rules[i].word;
      }
    }
    return word === "" ? String(n) : word;
  }

  // Public single-value entry point: validates the rules, then labels `n`.
  function label(n, rules) {
    if (typeof n !== "number" || !isFinite(n) || Math.floor(n) !== n) {
      throw new RangeError("n must be an integer");
    }
    return labelWith(n, normaliseRules(rules || classicRules()));
  }

  // --- a whole range ------------------------------------------------------
  // Produce the labels for start..end inclusive. `start` may be greater than
  // `end`, in which case the sequence counts down. To keep a fat-fingered
  // "1 to 1000000000" from hanging the page, the span is capped; the cap is
  // generous (100k) and lives here, not in the UI, so the engine protects
  // itself.
  var MAX_SPAN = 100000;

  function range(start, end, rules) {
    if (!isInt(start) || !isInt(end)) {
      throw new RangeError("start and end must be integers");
    }
    var span = Math.abs(end - start) + 1;
    if (span > MAX_SPAN) {
      throw new RangeError("range of " + span + " exceeds the cap of " + MAX_SPAN);
    }
    var R = normaliseRules(rules || classicRules());
    var out = [];
    var step = end >= start ? 1 : -1;
    for (var n = start; ; n += step) {
      out.push({ n: n, text: labelWith(n, R) });
      if (n === end) break;
    }
    return out;
  }

  // --- a little analysis ---------------------------------------------------
  // Tally the labelled range: how many numbers fell through unmatched, and how
  // often each individual rule-word fired (counting one hit per matching
  // number, so in classic Fizz Buzz 15 counts for both Fizz and Buzz). Handy
  // for the "what did that range actually do" panel and, in tests, as a second
  // independent description of the same run.
  function stats(start, end, rules) {
    var R = normaliseRules(rules || classicRules());
    var rows = range(start, end, R);
    var perWord = {};
    for (var i = 0; i < R.length; i++) perWord[R[i].word] = 0;
    var plain = 0, labelled = 0;
    for (var k = 0; k < rows.length; k++) {
      var n = rows[k].n;
      var anyMatch = false;
      for (var j = 0; j < R.length; j++) {
        if (divides(R[j].divisor, n)) { perWord[R[j].word]++; anyMatch = true; }
      }
      if (anyMatch) labelled++; else plain++;
    }
    return { total: rows.length, labelled: labelled, plain: plain, perWord: perWord };
  }

  function isInt(x) {
    return typeof x === "number" && isFinite(x) && Math.floor(x) === x;
  }

  return {
    classicRules: classicRules,
    normaliseRules: normaliseRules,
    divides: divides,
    label: label,
    range: range,
    stats: stats,
    MAX_SPAN: MAX_SPAN
  };
});
