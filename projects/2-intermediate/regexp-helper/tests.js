/*
 * tests.js — a tiny dependency-free test runner for regex-core.js.
 *
 * The spec's bonus feature asks for automated testing "using frameworks like
 * Jest". To keep this project build-step- and dependency-free like the rest of
 * the repo, these tests are written so they ALSO run under Jest untouched:
 * `test(name, fn)` and a minimal `expect(...).toEqual/.toBe` are provided only
 * when Jest's globals are absent.
 *
 *   Run standalone:  node tests.js
 *   Run under Jest:  jest tests.js
 */
"use strict";

var RegexCore = require("./regex-core.js");

// --- Minimal Jest-compatible shims (skipped if real Jest is present) ---------
var usingJest = typeof global.test === "function";
var failures = 0;
var count = 0;

if (!usingJest) {
  global.test = function (name, fn) {
    count++;
    try {
      fn();
      console.log("  ok   " + name);
    } catch (e) {
      failures++;
      console.log("  FAIL " + name + "\n       " + e.message);
    }
  };
  global.expect = function (actual) {
    return {
      toBe: function (exp) {
        if (actual !== exp) {
          throw new Error("expected " + JSON.stringify(exp) + " but got " + JSON.stringify(actual));
        }
      },
      toEqual: function (exp) {
        if (JSON.stringify(actual) !== JSON.stringify(exp)) {
          throw new Error("expected " + JSON.stringify(exp) + " but got " + JSON.stringify(actual));
        }
      },
    };
  };
}

// --- validate() --------------------------------------------------------------
test("validate flags a missing pattern", function () {
  expect(RegexCore.validate("", "some text").length).toBe(1);
});

test("validate flags a missing test string", function () {
  expect(RegexCore.validate("abc", "").length).toBe(1);
});

test("validate flags both when both are missing", function () {
  expect(RegexCore.validate("", "").length).toBe(2);
});

test("validate rejects a malformed pattern", function () {
  expect(RegexCore.validate("(", "text").length).toBe(1);
});

test("validate passes a good pattern + string", function () {
  expect(RegexCore.validate("\\d+", "a1b2").length).toBe(0);
});

// --- run(): test() -----------------------------------------------------------
test("test() returns true when the pattern matches", function () {
  var r = RegexCore.run("cat", "", "the cat sat", "test");
  expect(r.value).toBe(true);
  expect(r.matched).toBe(true);
});

test("test() returns false when it does not match", function () {
  var r = RegexCore.run("dog", "", "the cat sat", "test");
  expect(r.value).toBe(false);
  expect(r.matched).toBe(false);
});

// --- run(): search() ---------------------------------------------------------
test("search() returns the index of the first match", function () {
  var r = RegexCore.run("sat", "", "the cat sat", "search");
  expect(r.value).toBe(8);
});

test("search() returns -1 when not found", function () {
  var r = RegexCore.run("zzz", "", "the cat sat", "search");
  expect(r.value).toBe(-1);
  expect(r.matched).toBe(false);
});

// --- run(): match() ----------------------------------------------------------
test("match() without g returns the first match array", function () {
  var r = RegexCore.run("\\d+", "", "a12b34", "match");
  expect(r.value[0]).toBe("12");
});

test("match() with g returns every match", function () {
  var r = RegexCore.run("\\d+", "g", "a12b34", "match");
  expect(r.value).toEqual(["12", "34"]);
});

test("match() returns null when nothing matches", function () {
  var r = RegexCore.run("z", "", "abc", "match");
  expect(r.value).toBe(null);
  expect(r.matched).toBe(false);
});

// --- flags -------------------------------------------------------------------
test("the i flag makes matching case-insensitive", function () {
  var r = RegexCore.run("CAT", "i", "the cat sat", "test");
  expect(r.value).toBe(true);
});

// --- collectMatches() (drives the highlighter) -------------------------------
test("collectMatches finds every occurrence with indexes", function () {
  var m = RegexCore.collectMatches("a", "", "banana");
  expect(m).toEqual([
    { text: "a", index: 1 },
    { text: "a", index: 3 },
    { text: "a", index: 5 },
  ]);
});

test("collectMatches does not loop forever on a zero-width pattern", function () {
  var m = RegexCore.collectMatches("", "", "ab");
  // one empty match at each position (0, 1, 2)
  expect(m.length).toBe(3);
});

// --- standalone summary ------------------------------------------------------
if (!usingJest) {
  if (failures) {
    console.log("\n" + failures + " of " + count + " tests FAILED");
    process.exit(1);
  } else {
    console.log("\nAll " + count + " tests passed.");
  }
}
