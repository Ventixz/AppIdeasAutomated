/*
 * tests.js — a dependency-free suite for the Limit Calculator core.
 *
 *   node projects/phase2-numbers/limit-calculator/tests.js
 *
 * It checks three layers: the expression parser/evaluator, the numerical
 * limit estimator against dozens of classic limits (including the tricky
 * DNE / one-sided / infinite cases), and the closed-form recogniser.
 */
"use strict";
var C = require("./limit-core.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL: " + msg); }
}
function near(a, b, tol, msg) {
  tol = tol == null ? 1e-6 : tol;
  var good = isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  ok(good, msg + " (got " + a + ", want " + b + ")");
}
function section(name) { console.log("\n== " + name + " =="); }

// ---------------------------------------------------------------------------
section("parser + evaluator");
// ---------------------------------------------------------------------------
(function () {
  var f;
  f = C.compile("2*x + 1"); near(f(3), 7, 1e-12, "2x+1 at 3");
  f = C.compile("x^2");     near(f(5), 25, 1e-12, "x^2 at 5");
  f = C.compile("2^-1");    near(f(0), 0.5, 1e-12, "2^-1 (right-assoc unary exp)");
  f = C.compile("2^3^2");   near(f(0), 512, 1e-12, "2^3^2 right associative");
  f = C.compile("-x^2");    near(f(3), -9, 1e-12, "-x^2 = -(x^2)");
  f = C.compile("2x");      near(f(4), 8, 1e-12, "implicit mult 2x");
  f = C.compile("3(x+1)");  near(f(2), 9, 1e-12, "implicit mult 3(x+1)");
  f = C.compile("x sin(0)+1"); near(f(9), 1, 1e-12, "implicit mult with func");
  f = C.compile("sin(x)/x"); near(f(Math.PI / 2), 1 / (Math.PI / 2), 1e-9, "sin(x)/x eval");
  f = C.compile("pi");      near(f(0), Math.PI, 1e-12, "constant pi");
  f = C.compile("e^x");     near(f(1), Math.E, 1e-12, "e^x at 1");
  f = C.compile("ln(e)");   near(f(0), 1, 1e-12, "ln(e)=1 (natural log)");
  f = C.compile("log(e)");  near(f(0), 1, 1e-12, "log == natural log");
  f = C.compile("log10(1000)"); near(f(0), 3, 1e-12, "log10(1000)=3");
  f = C.compile("log2(8)"); near(f(0), 3, 1e-12, "log2(8)=3");
  f = C.compile("sqrt(2)"); near(f(0), Math.SQRT2, 1e-12, "sqrt(2)");
  f = C.compile("abs(-3)"); near(f(0), 3, 1e-12, "abs(-3)");
  f = C.compile("1e3 + 1"); near(f(0), 1001, 1e-12, "scientific literal 1e3");
  f = C.compile(" ( x + 2 ) * 3 "); near(f(1), 9, 1e-12, "whitespace tolerated");

  // syntax errors throw
  var threw = false;
  try { C.compile("2 +"); } catch (e) { threw = true; }
  ok(threw, "trailing operator throws");
  threw = false; try { C.compile("bogus(x)"); } catch (e) { threw = true; }
  ok(threw, "unknown function throws");
  threw = false; try { C.compile("(x + 1"); } catch (e) { threw = true; }
  ok(threw, "unbalanced paren throws");
  threw = false; try { C.compile("   "); } catch (e) { threw = true; }
  ok(threw, "empty expression throws");
})();

// ---------------------------------------------------------------------------
section("Neville extrapolation (unit)");
// ---------------------------------------------------------------------------
(function () {
  // Sample a smooth function g(h) = 3 + 2h + 5h^2 and extrapolate to h=0.
  var hs = [], ys = [];
  var h = 0.1;
  for (var k = 0; k < 6; k++) { hs.push(h); ys.push(3 + 2 * h + 5 * h * h); h *= 0.5; }
  var ex = C.extrapolateToZero(hs, ys);
  near(ex.value, 3, 1e-9, "extrapolate polynomial to h=0");
  ok(ex.err < 1e-9, "extrapolation error tiny for polynomial");
})();

// ---------------------------------------------------------------------------
section("classic finite limits");
// ---------------------------------------------------------------------------
function lim(expr, target) { return C.limit(expr, target); }
(function () {
  var r;
  r = lim("sin(x)/x", 0);        ok(r.status === "finite", "sin(x)/x -> 0 is finite"); near(r.value, 1, 1e-6, "sin(x)/x -> 1");
  r = lim("(1-cos(x))/x^2", 0);  ok(r.status === "finite", "(1-cos)/x^2 finite"); near(r.value, 0.5, 1e-6, "(1-cos x)/x^2 -> 1/2");
  r = lim("(e^x - 1)/x", 0);     near(r.value, 1, 1e-6, "(e^x-1)/x -> 1");
  r = lim("tan(x)/x", 0);        near(r.value, 1, 1e-6, "tan(x)/x -> 1");
  r = lim("ln(1+x)/x", 0);       near(r.value, 1, 1e-6, "ln(1+x)/x -> 1");
  r = lim("(sqrt(1+x)-1)/x", 0); near(r.value, 0.5, 1e-6, "(sqrt(1+x)-1)/x -> 1/2");
  r = lim("(x^2-4)/(x-2)", 2);   near(r.value, 4, 1e-6, "(x^2-4)/(x-2) -> 4");
  r = lim("(x^3-1)/(x-1)", 1);   near(r.value, 3, 1e-6, "(x^3-1)/(x-1) -> 3");
  r = lim("x^2 + 1", 3);         near(r.value, 10, 1e-9, "continuous poly -> 10");
  ok(r.continuous === true, "continuous poly flagged continuous");
  r = lim("(sin(3x))/(sin(5x))", 0); near(r.value, 3 / 5, 1e-6, "sin(3x)/sin(5x) -> 3/5");
  r = lim("(cos(x)-1)/x", 0);    near(r.value, 0, 1e-6, "(cos x - 1)/x -> 0");
  r = lim("x/tan(x)", 0);        near(r.value, 1, 1e-6, "x/tan(x) -> 1");
  r = lim("(2^x - 1)/x", 0);     near(r.value, Math.LN2, 1e-6, "(2^x-1)/x -> ln 2");
  r = lim("sin(x)/x", 3);        near(r.value, Math.sin(3) / 3, 1e-6, "sin(x)/x at 3 = value");
})();

// ---------------------------------------------------------------------------
section("limits at infinity");
// ---------------------------------------------------------------------------
(function () {
  var r;
  r = lim("(3x^2 + 2)/(x^2 - 1)", "inf"); near(r.value, 3, 1e-5, "rational -> 3 at +inf");
  r = lim("(1 + 1/x)^x", "inf");          near(r.value, Math.E, 1e-4, "(1+1/x)^x -> e");
  r = lim("1/x", "inf");                  near(r.value, 0, 1e-6, "1/x -> 0 at +inf");
  r = lim("(2x+1)/(x+3)", "inf");         near(r.value, 2, 1e-5, "(2x+1)/(x+3) -> 2");
  r = lim("x - sqrt(x^2 + x)", "inf");    near(r.value, -0.5, 1e-4, "x - sqrt(x^2+x) -> -1/2");
  r = lim("(3x^2+2)/(x^2-1)", "-inf");    near(r.value, 3, 1e-5, "rational -> 3 at -inf");
  r = lim("ln(x)/x", "inf");              ok(r.status === "finite" && Math.abs(r.value) < 5e-3, "ln(x)/x -> 0 (slow log convergence, got " + r.value + ")");
})();

// ---------------------------------------------------------------------------
section("one-sided limits and infinities");
// ---------------------------------------------------------------------------
(function () {
  var r;
  r = lim("1/x", 0);
  ok(r.status === "dne", "1/x -> 0 does not exist (two-sided)");
  ok(r.left.status === "infinite" && r.left.sign === -1, "1/x left is -inf");
  ok(r.right.status === "infinite" && r.right.sign === +1, "1/x right is +inf");

  r = lim("1/x^2", 0);
  ok(r.status === "infinite" && r.sign === +1, "1/x^2 -> +inf");

  r = lim("abs(x)/x", 0);
  ok(r.status === "dne", "|x|/x -> 0 DNE");
  near(r.left.value, -1, 1e-6, "|x|/x left = -1");
  near(r.right.value, 1, 1e-6, "|x|/x right = +1");

  r = lim("sin(1/x)", 0);
  ok(r.status === "dne", "sin(1/x) -> 0 DNE (oscillation)");
})();

// ---------------------------------------------------------------------------
section("closed-form recogniser");
// ---------------------------------------------------------------------------
(function () {
  ok(C.recognize(0) === "0", "recognise 0");
  ok(C.recognize(4) === "4", "recognise integer 4");
  ok(C.recognize(0.5) === "1/2", "recognise 1/2");
  ok(C.recognize(0.6) === "3/5", "recognise 3/5");
  ok(C.recognize(-0.25) === "-1/4", "recognise -1/4");
  ok(C.recognize(Math.PI) === "pi", "recognise pi");
  ok(C.recognize(Math.PI / 2) === "pi/2", "recognise pi/2");
  ok(C.recognize(2 * Math.PI) === "2pi", "recognise 2pi");
  ok(C.recognize(Math.E) === "e", "recognise e");
  ok(C.recognize(Math.LN2) === "ln(2)", "recognise ln(2)");
  var r = C.rationalApprox(0.3333333333333, 100);
  ok(r && r.p === 1 && r.q === 3, "rationalApprox 1/3");
})();

// ---------------------------------------------------------------------------
console.log("\n" + (fail === 0 ? "ALL PASS" : "SOME FAILED") +
  " — " + pass + " passed, " + fail + " failed (" + (pass + fail) + " checks)");
process.exit(fail === 0 ? 0 : 1);
