/*
 * regex-core.js — the pure pattern-matching logic for the Regular Expression
 * Helper, kept free of any DOM so it can run in the browser AND under Node/Jest.
 *
 * In a browser this attaches `RegexCore` to `window`; under Node it is exported
 * with `module.exports` so `tests.js` can require it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api; // Node / Jest
  } else {
    root.RegexCore = api; // browser
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Validate the raw form values and return a list of human-readable problems.
   * An empty array means the input is good to run.
   */
  function validate(pattern, text) {
    var errors = [];
    if (!pattern) errors.push("Enter a regular expression to run.");
    if (!text) errors.push("Enter a string to test the expression against.");
    if (pattern) {
      try {
        // Compile with no flags purely to check the pattern is well-formed.
        new RegExp(pattern);
      } catch (e) {
        errors.push("That isn't a valid regular expression: " + e.message);
      }
    }
    return errors;
  }

  /**
   * Run the chosen RegExp function against the text.
   *
   * @param {string} pattern  the raw expression source (no slashes)
   * @param {string} flags    e.g. "gi"
   * @param {string} text     the string to test
   * @param {string} fn       "test" | "search" | "match"
   * @returns {{
   *   fn: string,
   *   matched: boolean,
   *   value: *,            // the raw return value of the chosen function
   *   summary: string,     // a plain-English description of `value`
   *   matches: Array<{text:string, index:number}>  // every hit, for highlighting
   * }}
   */
  function run(pattern, flags, text, fn) {
    var re = new RegExp(pattern, flags);

    // Independent of the chosen function, gather every match so we can always
    // highlight the string. A global regex is needed to walk all matches, so we
    // build a throwaway one that guarantees the "g" flag.
    var matches = collectMatches(pattern, flags, text);

    var value, summary, matched;

    if (fn === "search") {
      value = text.search(re);
      matched = value !== -1;
      summary = matched
        ? "search() found the pattern starting at index " + value + "."
        : "search() returned -1 — the pattern was not found.";
    } else if (fn === "match") {
      value = text.match(re);
      matched = value !== null;
      if (!matched) {
        summary = "match() returned null — no text matched the pattern.";
      } else if (flags.indexOf("g") !== -1) {
        summary =
          "match() returned " + value.length +
          (value.length === 1 ? " match." : " matches.");
      } else {
        summary =
          'match() returned the first match "' + value[0] + '" at index ' +
          value.index + ".";
      }
    } else {
      // default: test
      value = re.test(text);
      matched = value === true;
      summary = matched
        ? "test() returned true — the pattern matched."
        : "test() returned false — no text matched the pattern.";
    }

    return {
      fn: fn,
      matched: matched,
      value: value,
      summary: summary,
      matches: matches,
    };
  }

  /**
   * Walk the whole string and return every match with its index. Always uses a
   * global regex internally so we can highlight every occurrence regardless of
   * which flags the user picked. A zero-width match advances by one to avoid an
   * infinite loop.
   */
  function collectMatches(pattern, flags, text) {
    var g = flags.replace(/[gy]/g, ""); // drop g/y, we control iteration
    var re = new RegExp(pattern, g + "g");
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      out.push({ text: m[0], index: m.index });
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    }
    return out;
  }

  return { validate: validate, run: run, collectMatches: collectMatches };
});
