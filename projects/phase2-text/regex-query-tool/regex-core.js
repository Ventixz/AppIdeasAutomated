/*
 * regex-core.js — the DOM-free engine behind the Regex Query Tool.
 *
 * The brief (karan/Projects, Text): "A regular expression query tool that
 * extracts regexp syntax (i.e. [A-Z]) from the user and a search string from
 * the user and displays the results of matching the string with the regexp."
 *
 * That is three lines of code — `new RegExp(p, f)` and `str.matchAll(re)` —
 * and if that were all, this file would not exist. The honest version of this
 * tool has to answer three questions that the naive version gets wrong, and
 * each one is a function below:
 *
 *   1. WHERE exactly did each group match?  `matchAll` gives you the matched
 *      text and the match's start index, but *not* where each capture group
 *      landed — so a tool that highlights "group 2" has nothing to highlight
 *      with. The fix is the `d` flag (hasIndices): we add it ourselves, read
 *      `match.indices`, and report a precise [start, end) for every group,
 *      named or numbered. See `findMatches`.
 *
 *   2. HOW do you highlight a zero-width match?  `/^/gm`, `/\b/g`, `/(?=x)/g`
 *      all match *between* characters. A loop that advances by match length
 *      loops forever on them; a highlighter that draws "from start to end"
 *      draws nothing. Both bugs are real and both are handled — the scan
 *      bumps `lastIndex` past an empty match, and the segmenter emits a
 *      zero-width caret instead of an empty span. See `findMatches` and
 *      `segment`.
 *
 *   3. Is this pattern SAFE to run on user input?  `(a+)+$` against
 *      "aaaaaaaaaaaaaaaaaaaaX" takes longer than the age of the universe —
 *      catastrophic backtracking, the engine behind the 2016 Cloudflare and
 *      2019 Stack Overflow outages. JS has no regex timeout, so the only
 *      defense is to *not run the pattern* — to recognise the shape before
 *      you hand it attacker-controlled text. `analyze` does that statically.
 *
 * On top of those, `explain` walks the pattern token by token and says what
 * each piece does in English, because a query tool you can't read is a query
 * tool you can't trust.
 *
 * No DOM, no dependencies. Runs in a browser and under Node (CommonJS).
 */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 0. Flags.
   * ------------------------------------------------------------------ */

  // The flags JS RegExp understands. We validate against this set so the UI
  // can give a precise error instead of the opaque native SyntaxError.
  var FLAG_INFO = {
    g: "global — find every match, not just the first",
    i: "ignore case",
    m: "multiline — ^ and $ match at line breaks",
    s: "dotAll — . also matches newlines",
    u: "unicode — treat the pattern as Unicode code points",
    y: "sticky — match only at lastIndex",
    d: "indices — record the position of every capture group",
    v: "unicodeSets — extended Unicode class syntax"
  };

  function validateFlags(flags) {
    flags = flags || "";
    var seen = {};
    for (var i = 0; i < flags.length; i++) {
      var f = flags[i];
      if (!FLAG_INFO.hasOwnProperty(f)) {
        return { ok: false, error: "Unknown flag '" + f + "'. Valid flags: " + Object.keys(FLAG_INFO).join(", ") + "." };
      }
      if (seen[f]) return { ok: false, error: "Duplicate flag '" + f + "'." };
      seen[f] = true;
    }
    return { ok: true };
  }

  /* ------------------------------------------------------------------ *
   * 1. Compile — turn pattern + flags into a RegExp, safely.
   * ------------------------------------------------------------------ */

  // Returns { ok, regex, source, flags } or { ok:false, error }. We never let
  // the native SyntaxError escape: the UI wants a string it can print.
  function compile(pattern, flags) {
    if (typeof pattern !== "string") return { ok: false, error: "Pattern must be a string." };
    var fv = validateFlags(flags);
    if (!fv.ok) return fv;
    try {
      var re = new RegExp(pattern, flags || "");
      return { ok: true, regex: re, source: re.source, flags: re.flags };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Add the given flag if absent; returns a new flag string. Used to force
  // `d` (for group positions) and `g` (for a full scan) without disturbing
  // the user's own flags.
  function withFlag(flags, f) {
    flags = flags || "";
    return flags.indexOf(f) === -1 ? flags + f : flags;
  }

  /* ------------------------------------------------------------------ *
   * 2. findMatches — the core query. Every match, every group, every index.
   * ------------------------------------------------------------------ */

  // Run `pattern`/`flags` over `input` and return a structured result:
  //
  //   { ok, global, matches: [ {
  //         match, index, end,
  //         groups:      [ { n, name, value, start, end } ... ],
  //         namedGroups: { name: value, ... }
  //       } ... ] }
  //
  // or { ok:false, error }. Notes:
  //   - We force the `d` flag so `match.indices` is populated, giving a real
  //     [start, end) for every capture group — the thing matchAll omits.
  //   - Without `g` we report at most one match (native semantics). With `g`
  //     we scan the whole string, bumping lastIndex past zero-width matches so
  //     the loop terminates.
  function findMatches(pattern, flags, input) {
    if (typeof input !== "string") input = "";
    var fv = validateFlags(flags);
    if (!fv.ok) return fv;

    var global = (flags || "").indexOf("g") !== -1;
    // Force `d` for indices; `d` is harmless to matching. If the runtime is
    // too old to support it, fall back to a flagless compile and synthesise
    // group starts as best we can (value present, positions null).
    var effFlags = withFlag(flags, "d");
    var re;
    try {
      re = new RegExp(pattern, effFlags);
    } catch (e) {
      // Older runtime without `d`? Retry without it.
      var c = compile(pattern, flags);
      if (!c.ok) return c;
      re = c.regex;
    }
    var hasIndices = re.hasIndices;

    var out = [];
    if (!global) {
      var m = re.exec(input);
      if (m) out.push(describeMatch(m, hasIndices));
    } else {
      re.lastIndex = 0;
      var mm;
      var guard = 0;
      while ((mm = re.exec(input)) !== null) {
        out.push(describeMatch(mm, hasIndices));
        // Zero-width match: advance by hand or exec() never moves and we spin.
        if (mm.index === re.lastIndex) re.lastIndex++;
        if (++guard > input.length + 2) break; // belt and braces
      }
    }
    return { ok: true, global: global, matches: out };
  }

  // Turn a native exec() result into our flat record. `m.indices` (from the
  // `d` flag) is an array parallel to the capture array: element 0 is the
  // whole match, 1..n the groups, each a [start, end] pair or undefined for a
  // group that didn't participate.
  function describeMatch(m, hasIndices) {
    var idx = hasIndices ? m.indices : null;
    var whole = idx && idx[0] ? idx[0] : [m.index, m.index + m[0].length];
    var groups = [];
    for (var i = 1; i < m.length; i++) {
      var span = idx && idx[i] ? idx[i] : null;
      groups.push({
        n: i,
        name: null, // filled in below from the named-group map
        value: m[i] === undefined ? null : m[i],
        start: span ? span[0] : null,
        end: span ? span[1] : null
      });
    }
    // Attach names. m.groups is {name: value}; m.indices.groups is
    // {name: [start,end]}. Map each name back onto its numbered slot by value
    // AND position when we can, so same-valued groups don't collide.
    var named = {};
    if (m.groups) {
      var nidx = idx && idx.groups ? idx.groups : null;
      Object.keys(m.groups).forEach(function (name) {
        named[name] = m.groups[name] === undefined ? null : m.groups[name];
        if (nidx && nidx[name]) {
          for (var g = 0; g < groups.length; g++) {
            if (groups[g].name === null &&
                groups[g].start === nidx[name][0] &&
                groups[g].end === nidx[name][1]) {
              groups[g].name = name;
              break;
            }
          }
        }
      });
    }
    return {
      match: m[0],
      index: whole[0],
      end: whole[1],
      groups: groups,
      namedGroups: named
    };
  }

  /* ------------------------------------------------------------------ *
   * 3. segment — cut the input into match / non-match pieces for rendering.
   * ------------------------------------------------------------------ */

  // Given the input and the matches from findMatches, return an ordered list
  // of segments covering the whole string exactly once:
  //
  //   { text, isMatch, zeroWidth, matchIndex }
  //
  // A UI renders plain segments as-is and match segments highlighted.
  // Zero-width matches become { zeroWidth:true, text:"" } markers so the
  // caller can draw a caret between characters instead of losing them.
  function segment(input, matches) {
    var segs = [];
    var pos = 0;
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (m.index > pos) {
        segs.push({ text: input.slice(pos, m.index), isMatch: false, zeroWidth: false, matchIndex: -1 });
      }
      if (m.end === m.index) {
        segs.push({ text: "", isMatch: true, zeroWidth: true, matchIndex: i });
      } else {
        segs.push({ text: input.slice(m.index, m.end), isMatch: true, zeroWidth: false, matchIndex: i });
      }
      pos = Math.max(pos, m.end);
    }
    if (pos < input.length) {
      segs.push({ text: input.slice(pos), isMatch: false, zeroWidth: false, matchIndex: -1 });
    }
    return segs;
  }

  /* ------------------------------------------------------------------ *
   * 4. analyze — static ReDoS (catastrophic backtracking) detection.
   * ------------------------------------------------------------------ */

  // JS has no way to time-limit a regex, and a pattern like (a+)+$ turns a
  // 25-character string into billions of backtracking steps. The only safe
  // move is to recognise the dangerous *shape* before running the pattern on
  // untrusted input. The classic shapes, all of which share "a repeatable
  // thing, repeated again, over an overlapping alphabet":
  //
  //   - nested quantifiers:            (a+)+   (a*)*   (\d+)*
  //   - a quantified group whose body ends in an unbounded quantifier, then
  //     the group is itself quantified
  //   - quantified alternation with overlap:  (a|a)*   (a|ab)*
  //
  // This is a heuristic — a linear scan over the pattern, not a full NFA
  // ambiguity analysis — so it is tuned to flag the textbook killers with
  // very few false positives, and it says *why* for each hit. A clean result
  // is "no obvious catastrophic backtracking found", never a guarantee.
  function analyze(pattern) {
    if (typeof pattern !== "string") pattern = String(pattern);
    var warnings = [];

    // Walk the pattern tracking group spans and whether each group body
    // contains an unbounded quantifier (+, *, or {n,}).
    var stack = [];               // open-group records
    var i = 0, n = pattern.length;
    function isQuantAt(k) {
      var c = pattern[k];
      if (c === "+" || c === "*") return true;
      if (c === "?") return false; // ? is bounded, not a backtracking risk
      if (c === "{") {
        // {n} / {n,} / {n,m}
        var close = pattern.indexOf("}", k);
        if (close === -1) return false;
        var body = pattern.slice(k + 1, close);
        // unbounded iff "{n,}" (comma, nothing after) — {n} and {n,m} are bounded
        return /^\d+,\s*$/.test(body);
      }
      return false;
    }
    while (i < n) {
      var ch = pattern[i];
      if (ch === "\\") { i += 2; continue; }             // escape: skip pair
      if (ch === "[") {                                   // char class: skip to ]
        i++;
        while (i < n && pattern[i] !== "]") {
          if (pattern[i] === "\\") i++;
          i++;
        }
        i++;
        continue;
      }
      if (ch === "(") {
        stack.push({ start: i, hasInnerUnbounded: false, hasAlternation: false });
        i++;
        continue;
      }
      if (ch === ")") {
        var g = stack.pop();
        // What (if anything) quantifies this whole group?
        var after = pattern[i + 1];
        var groupQuantified = after === "+" || after === "*" ||
          (after === "{" && /^\{\d+,\s*\}/.test(pattern.slice(i + 1)));
        if (g) {
          if (groupQuantified && g.hasInnerUnbounded) {
            warnings.push({
              kind: "nested-quantifier",
              at: g.start,
              detail: "A group that already repeats an unbounded amount (" +
                snippet(pattern, g.start, i + 2) + ") is itself repeated. " +
                "This is the (a+)+ shape — the classic catastrophic-backtracking killer."
            });
          }
          if (groupQuantified && g.hasAlternation) {
            warnings.push({
              kind: "quantified-alternation",
              at: g.start,
              detail: "A quantified group with alternation (" +
                snippet(pattern, g.start, i + 2) + "). If the branches can match " +
                "the same text (e.g. (a|a)* or (a|ab)*), this backtracks catastrophically."
            });
          }
          // Propagate: a repeated subgroup makes the enclosing group unbounded too.
          if (stack.length && (g.hasInnerUnbounded || groupQuantified)) {
            stack[stack.length - 1].hasInnerUnbounded = true;
          }
        }
        i += groupQuantified ? 2 : 1;
        continue;
      }
      if (ch === "|" && stack.length) {
        stack[stack.length - 1].hasAlternation = true;
      }
      // An unbounded quantifier sitting directly inside the current group.
      if (stack.length && isQuantAt(i)) {
        stack[stack.length - 1].hasInnerUnbounded = true;
      }
      i++;
    }
    return { safe: warnings.length === 0, warnings: warnings };
  }

  function snippet(s, a, b) {
    var t = s.slice(a, b);
    return t.length > 24 ? t.slice(0, 24) + "…" : t;
  }

  /* ------------------------------------------------------------------ *
   * 5. explain — walk the pattern and describe each token in English.
   * ------------------------------------------------------------------ */

  // Token-level, not a full parser: enough to read a pattern back to a human.
  // Returns [ { text, desc } ... ] in source order.
  var CLASS_DESC = {
    "\\d": "any digit (0–9)", "\\D": "any non-digit",
    "\\w": "any word character (letter, digit, or _)", "\\W": "any non-word character",
    "\\s": "any whitespace", "\\S": "any non-whitespace",
    "\\b": "a word boundary", "\\B": "a non-word boundary",
    "\\n": "a newline", "\\r": "a carriage return", "\\t": "a tab", "\\f": "a form feed", "\\v": "a vertical tab", "\\0": "a NUL character"
  };
  function explain(pattern) {
    if (typeof pattern !== "string") pattern = String(pattern);
    var tokens = [];
    var i = 0, n = pattern.length;
    function push(text, desc) { tokens.push({ text: text, desc: desc }); }
    while (i < n) {
      var ch = pattern[i];
      if (ch === "\\") {
        var two = pattern.slice(i, i + 2);
        if (CLASS_DESC[two]) { push(two, CLASS_DESC[two]); i += 2; continue; }
        if (/\d/.test(pattern[i + 1])) { push(two, "a back-reference to group " + pattern[i + 1]); i += 2; continue; }
        if (pattern[i + 1] === "k" && pattern[i + 2] === "<") {
          var ke = pattern.indexOf(">", i);
          if (ke !== -1) { push(pattern.slice(i, ke + 1), "a back-reference to the named group"); i = ke + 1; continue; }
        }
        push(two, "a literal '" + (pattern[i + 1] || "") + "'"); i += 2; continue;
      }
      if (ch === "[") {
        var neg = pattern[i + 1] === "^";
        var j = i + 1; if (neg) j++;
        var cls = "";
        while (j < n && pattern[j] !== "]") { if (pattern[j] === "\\") { cls += pattern[j]; j++; } cls += pattern[j]; j++; }
        var full = pattern.slice(i, j + 1);
        push(full, (neg ? "any character NOT in the set " : "any one character in the set ") + pattern.slice(i, j + 1));
        i = j + 1; continue;
      }
      if (ch === "(") {
        if (pattern.slice(i, i + 3) === "(?:") { push("(?:", "start of a non-capturing group"); i += 3; continue; }
        if (pattern.slice(i, i + 3) === "(?=") { push("(?=", "start of a lookahead (followed by…)"); i += 3; continue; }
        if (pattern.slice(i, i + 3) === "(?!") { push("(?!", "start of a negative lookahead (NOT followed by…)"); i += 3; continue; }
        if (pattern.slice(i, i + 4) === "(?<=") { push("(?<=", "start of a lookbehind (preceded by…)"); i += 4; continue; }
        if (pattern.slice(i, i + 4) === "(?<!") { push("(?<!", "start of a negative lookbehind (NOT preceded by…)"); i += 4; continue; }
        if (pattern.slice(i, i + 3) === "(?<") {
          var ne = pattern.indexOf(">", i);
          if (ne !== -1) { push(pattern.slice(i, ne + 1), "start of a named capture group '" + pattern.slice(i + 3, ne) + "'"); i = ne + 1; continue; }
        }
        push("(", "start of a capture group"); i++; continue;
      }
      if (ch === ")") {
        // group close, possibly with a quantifier right after
        push(")", "end of the group"); i++; continue;
      }
      if (ch === "^") { push("^", "start of the string (or line, with m)"); i++; continue; }
      if (ch === "$") { push("$", "end of the string (or line, with m)"); i++; continue; }
      if (ch === ".") { push(".", "any character (except newline, unless s)"); i++; continue; }
      if (ch === "|") { push("|", "OR — either the left side or the right"); i++; continue; }
      if (ch === "*" || ch === "+" || ch === "?") {
        var lazy = pattern[i + 1] === "?";
        var base = ch === "*" ? "zero or more" : ch === "+" ? "one or more" : "optional (zero or one)";
        push(pattern.slice(i, lazy ? i + 2 : i + 1), base + (lazy ? ", lazily (as few as possible)" : ""));
        i += lazy ? 2 : 1; continue;
      }
      if (ch === "{") {
        var close = pattern.indexOf("}", i);
        if (close !== -1 && /^\{\d+(,\d*)?\}$/.test(pattern.slice(i, close + 1))) {
          var lazy2 = pattern[close + 1] === "?";
          push(pattern.slice(i, (lazy2 ? close + 2 : close + 1)), "repeated " + quantText(pattern.slice(i + 1, close)) + (lazy2 ? ", lazily" : ""));
          i = (lazy2 ? close + 2 : close + 1); continue;
        }
        push("{", "a literal '{'"); i++; continue;
      }
      // a run of ordinary literal characters
      var lit = "";
      while (i < n && "\\[](){}^$.|*+?".indexOf(pattern[i]) === -1) { lit += pattern[i]; i++; }
      if (lit) push(lit, lit.length === 1 ? "the literal character '" + lit + "'" : "the literal text \"" + lit + "\"");
      else { push(pattern[i], "a literal '" + pattern[i] + "'"); i++; }
    }
    return tokens;
  }
  function quantText(body) {
    var parts = body.split(",");
    if (parts.length === 1) return "exactly " + parts[0] + " time" + (parts[0] === "1" ? "" : "s");
    if (parts[1] === "") return "at least " + parts[0] + " time" + (parts[0] === "1" ? "" : "s");
    return "between " + parts[0] + " and " + parts[1] + " times";
  }

  /* ------------------------------------------------------------------ *
   * 6. A small library of ready-made patterns, for the UI's dropdown.
   * ------------------------------------------------------------------ */
  var LIBRARY = [
    { name: "Email (simple)", pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.-]+", flags: "g",
      sample: "Reach me at ada@example.com or ada.lovelace+news@mail.co.uk." },
    { name: "URL (http/https)", pattern: "https?:\\/\\/[^\\s]+", flags: "g",
      sample: "Docs at https://example.com/path?q=1 and http://a.b." },
    { name: "IPv4 address", pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b", flags: "g",
      sample: "Gateway 192.168.0.1, DNS 8.8.8.8, bogus 999.1.1.1." },
    { name: "Hex colour", pattern: "#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b", flags: "g",
      sample: "Palette: #fff, #1a2b3c, #ABC, and the non-colour #12 34." },
    { name: "Date (YYYY-MM-DD)", pattern: "(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})", flags: "g",
      sample: "Shipped 2026-10-16, due 2026-12-01." },
    { name: "Word boundaries", pattern: "\\bcat\\b", flags: "gi",
      sample: "A cat, a category, and the Cat sat. Catalog? No. cat!" },
    { name: "Capture groups", pattern: "(\\w+)\\s+(\\w+)", flags: "g",
      sample: "John Smith, Ada Lovelace, Alan Turing" },
    { name: "⚠ ReDoS trap: (a+)+$", pattern: "(a+)+$", flags: "",
      sample: "aaaaaaaaaaaaaaaaaaaaaaaa!" }
  ];

  /* ------------------------------------------------------------------ *
   * Export.
   * ------------------------------------------------------------------ */
  var API = {
    FLAG_INFO: FLAG_INFO,
    validateFlags: validateFlags,
    compile: compile,
    findMatches: findMatches,
    segment: segment,
    analyze: analyze,
    explain: explain,
    LIBRARY: LIBRARY
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.REGEX_TOOL = API;
})(typeof self !== "undefined" ? self : this);
