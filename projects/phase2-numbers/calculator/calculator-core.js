/*
 * calculator-core.js — the whole calculation for "Calculator", from
 * karan/Projects (Numbers):
 *
 *   "A simple calculator to do basic operators. Make it a scientific
 *    calculator for added complexity."
 *
 * DOM-free, console-free, I/O-free, so the identical file runs in the browser
 * and under Node for the tests.
 *
 * WHY THIS ISN'T `eval(expr)`. The two-character answer for "evaluate a maths
 * string" is wrong in two different ways, and both are fixed here:
 *
 * 1. eval RUNS ARBITRARY CODE. `eval` hands the user's string to the JavaScript
 *    engine, so `2+2` and `fetch('/steal')` are treated alike. A calculator has
 *    no business doing that. This one tokenises and parses the expression
 *    itself; nothing but numbers, operators and a fixed set of functions is
 *    ever interpreted.
 *
 * 2. eval DOES FLOAT ARITHMETIC, AND FLOAT ARITHMETIC LIES. `eval('0.1 + 0.2')`
 *    is 0.30000000000000004, `eval('1/3*3')` is 1 only by luck and
 *    `eval('0.3 - 0.2')` is 0.09999999999999998. So the four basic operators
 *    (plus %, and integer powers) run here on EXACT rationals — a pair of
 *    BigInts kept reduced — and `0.1 + 0.2` is exactly `0.3`, `1/3` is exactly
 *    one third, and `2^100` is exact. Only the scientific functions (sqrt, sin,
 *    ln, …) and irrational constants (pi, e) fall back to floating point, and
 *    when they do the result is explicitly flagged as an approximation.
 */

'use strict';

/* ------------------------------------------------------------------ *
 *  Exact rational arithmetic over BigInt.
 *
 *  A value is one of:
 *    { exact: true,  n: BigInt, d: BigInt }   // n/d, d > 0, gcd(|n|,d) = 1
 *    { exact: false, x: Number }              // an approximation
 *
 *  Every exact result is kept reduced with a positive denominator, so equal
 *  numbers have one representation and 2/4 is stored as 1/2.
 * ------------------------------------------------------------------ */

function bigAbs(a) { return a < 0n ? -a : a; }

function gcd(a, b) {
  a = bigAbs(a); b = bigAbs(b);
  while (b) { var t = a % b; a = b; b = t; }
  return a;
}

function rat(n, d) {
  if (d === 0n) throw new Error('Division by zero.');
  if (d < 0n) { n = -n; d = -d; }
  var g = gcd(n, d) || 1n;
  return { exact: true, n: n / g, d: d / g };
}

function approx(x) { return { exact: false, x: x }; }

function toFloat(v) {
  if (!v.exact) return v.x;
  // Divide as BigInts for the integer part, then add the fractional remainder,
  // so huge exact values (2^100) don't overflow Number on the way through.
  var neg = v.n < 0n;
  var n = bigAbs(v.n), d = v.d;
  var whole = n / d;
  var rem = n % d;
  var f = Number(whole) + Number(rem) / Number(d);
  return neg ? -f : f;
}

/* Promote either operand to float when the other already is one. */
function combine(a, b, exactOp, floatOp) {
  if (a.exact && b.exact) return exactOp(a, b);
  return approx(floatOp(toFloat(a), toFloat(b)));
}

var Ops = {
  add: function (a, b) {
    return combine(a, b,
      function (x, y) { return rat(x.n * y.d + y.n * x.d, x.d * y.d); },
      function (x, y) { return x + y; });
  },
  sub: function (a, b) {
    return combine(a, b,
      function (x, y) { return rat(x.n * y.d - y.n * x.d, x.d * y.d); },
      function (x, y) { return x - y; });
  },
  mul: function (a, b) {
    return combine(a, b,
      function (x, y) { return rat(x.n * y.n, x.d * y.d); },
      function (x, y) { return x * y; });
  },
  div: function (a, b) {
    return combine(a, b,
      function (x, y) {
        if (y.n === 0n) throw new Error('Division by zero.');
        return rat(x.n * y.d, x.d * y.n);
      },
      function (x, y) {
        if (y === 0) throw new Error('Division by zero.');
        return x / y;
      });
  },
  // Remainder defined by flooring the exact quotient, so it stays exact and
  // agrees with the usual integer meaning: 7 % 3 = 1, and 5.5 % 2 = 1.5.
  mod: function (a, b) {
    return combine(a, b,
      function (x, y) {
        if (y.n === 0n) throw new Error('Modulo by zero.');
        var qn = x.n * y.d, qd = x.d * y.n;
        if (qd < 0n) { qn = -qn; qd = -qd; }
        var floorq = qn >= 0n ? qn / qd : -((-qn + qd - 1n) / qd);
        // a - floor(a/b) * b
        return Ops.sub(x, Ops.mul(y, { exact: true, n: floorq, d: 1n }));
      },
      function (x, y) {
        if (y === 0) throw new Error('Modulo by zero.');
        return x - Math.floor(x / y) * y;
      });
  },
  pow: function (a, b) {
    // Exact only when the exponent is an exact integer; otherwise float.
    if (a.exact && b.exact && b.d === 1n) {
      var k = b.n;
      if (k >= 0n) return rat(a.n ** k, a.d ** k);
      if (a.n === 0n) throw new Error('Division by zero.');       // 0 ^ -k
      var p = -k;
      return rat(a.d ** p, a.n ** p);                              // (n/d)^-k
    }
    var base = toFloat(a), exp = toFloat(b);
    var r = Math.pow(base, exp);
    if (!isFinite(r) || isNaN(r)) throw new Error('Result is not a real number.');
    return approx(r);
  },
  neg: function (a) {
    return a.exact ? { exact: true, n: -a.n, d: a.d } : approx(-a.x);
  },
};

/* ------------------------------------------------------------------ *
 *  Scientific functions and constants — always approximate.
 * ------------------------------------------------------------------ */

function guardReal(x) {
  if (isNaN(x) || !isFinite(x)) throw new Error('Result is not a real number.');
  return approx(x);
}

var FUNCTIONS = {
  sqrt:  function (x) { if (x < 0) throw new Error('sqrt of a negative number.'); return guardReal(Math.sqrt(x)); },
  cbrt:  function (x) { return guardReal(Math.cbrt(x)); },
  abs:   null, // handled specially below so it can stay exact
  ln:    function (x) { if (x <= 0) throw new Error('ln needs a positive number.'); return guardReal(Math.log(x)); },
  log:   function (x) { if (x <= 0) throw new Error('log needs a positive number.'); return guardReal(Math.log10(x)); },
  exp:   function (x) { return guardReal(Math.exp(x)); },
  sin:   function (x) { return guardReal(Math.sin(x)); },
  cos:   function (x) { return guardReal(Math.cos(x)); },
  tan:   function (x) { return guardReal(Math.tan(x)); },
  asin:  function (x) { if (x < -1 || x > 1) throw new Error('asin needs -1..1.'); return guardReal(Math.asin(x)); },
  acos:  function (x) { if (x < -1 || x > 1) throw new Error('acos needs -1..1.'); return guardReal(Math.acos(x)); },
  atan:  function (x) { return guardReal(Math.atan(x)); },
};

function applyFunc(name, arg) {
  if (name === 'abs') {
    if (arg.exact) return { exact: true, n: bigAbs(arg.n), d: arg.d };
    return approx(Math.abs(arg.x));
  }
  var fn = FUNCTIONS[name];
  if (!fn) throw new Error('Unknown function "' + name + '".');
  return fn(toFloat(arg));
}

var CONSTANTS = {
  pi: function () { return approx(Math.PI); },
  e:  function () { return approx(Math.E); },
};

/* ------------------------------------------------------------------ *
 *  Tokeniser.
 * ------------------------------------------------------------------ */

function tokenize(src) {
  var tokens = [];
  var i = 0, n = src.length;
  while (i < n) {
    var c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c >= '0' && c <= '9' || c === '.') {
      var j = i, seenDot = false;
      while (j < n && (src[j] >= '0' && src[j] <= '9' || src[j] === '.')) {
        if (src[j] === '.') {
          if (seenDot) throw new Error('A number has more than one decimal point.');
          seenDot = true;
        }
        j++;
      }
      var text = src.slice(i, j);
      if (text === '.') throw new Error('A lone "." is not a number.');
      tokens.push({ type: 'num', text: text });
      i = j;
      continue;
    }
    if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z') {
      var k = i;
      while (k < n && (src[k] >= 'a' && src[k] <= 'z' || src[k] >= 'A' && src[k] <= 'Z')) k++;
      tokens.push({ type: 'name', text: src.slice(i, k).toLowerCase() });
      i = k;
      continue;
    }
    if ('+-*/%^(),'.indexOf(c) !== -1) {
      tokens.push({ type: 'op', text: c });
      i++;
      continue;
    }
    throw new Error('Unexpected character "' + c + '".');
  }
  return tokens;
}

/* A decimal literal → an exact rational. "12.34" → 1234/100 → 617/50. */
function numberToRat(text) {
  var dot = text.indexOf('.');
  if (dot === -1) return rat(BigInt(text), 1n);
  var digits = text.replace('.', '');
  var scale = text.length - dot - 1;
  if (digits === '') throw new Error('A lone "." is not a number.');
  return rat(BigInt(digits), 10n ** BigInt(scale));
}

/* ------------------------------------------------------------------ *
 *  Recursive-descent parser + evaluator.
 *
 *    expr    := term (('+'|'-') term)*
 *    term    := unary (('*'|'/'|'%') unary)*
 *    unary   := ('+'|'-') unary | power
 *    power   := primary ('^' unary)?         // right assoc; '^' binds tighter
 *                                            // than unary '-', so -2^2 = -(2^2)
 *    primary := number | constant
 *             | name '(' expr ')'            // function call
 *             | '(' expr ')'
 * ------------------------------------------------------------------ */

function parse(tokens) {
  var pos = 0;

  function peek() { return tokens[pos]; }
  function next() { return tokens[pos++]; }
  function isOp(t, ch) { return t && t.type === 'op' && t.text === ch; }

  function expr() {
    var v = term();
    for (var t = peek(); isOp(t, '+') || isOp(t, '-'); t = peek()) {
      next();
      v = t.text === '+' ? Ops.add(v, term()) : Ops.sub(v, term());
    }
    return v;
  }

  function term() {
    var v = unary();
    for (var t = peek(); isOp(t, '*') || isOp(t, '/') || isOp(t, '%'); t = peek()) {
      next();
      var rhs = unary();
      v = t.text === '*' ? Ops.mul(v, rhs)
        : t.text === '/' ? Ops.div(v, rhs)
        :                  Ops.mod(v, rhs);
    }
    return v;
  }

  function unary() {
    var t = peek();
    if (isOp(t, '+')) { next(); return unary(); }
    if (isOp(t, '-')) { next(); return Ops.neg(unary()); }
    return power();
  }

  function power() {
    var base = primary();
    if (isOp(peek(), '^')) {
      next();
      // exponent parsed as unary, so 2^-3 works and 2^3^2 = 2^(3^2)
      return Ops.pow(base, unary());
    }
    return base;
  }

  function primary() {
    var t = next();
    if (!t) throw new Error('Unexpected end of expression.');
    if (t.type === 'num') return numberToRat(t.text);
    if (isOp(t, '(')) {
      var inner = expr();
      if (!isOp(next(), ')')) throw new Error('Missing closing ")".');
      return inner;
    }
    if (t.type === 'name') {
      if (isOp(peek(), '(')) {
        next();
        var arg = expr();
        if (!isOp(next(), ')')) throw new Error('Missing closing ")".');
        return applyFunc(t.text, arg);
      }
      if (CONSTANTS[t.text]) return CONSTANTS[t.text]();
      throw new Error('Unknown name "' + t.text + '".');
    }
    throw new Error('Unexpected "' + t.text + '".');
  }

  var result = expr();
  if (pos !== tokens.length) {
    throw new Error('Unexpected "' + tokens[pos].text + '".');
  }
  return result;
}

/* ------------------------------------------------------------------ *
 *  Formatting an exact rational for display.
 * ------------------------------------------------------------------ */

/* A reduced fraction terminates in decimal iff its denominator, after all
 * factors of 2 and 5 are removed, is 1. */
function terminates(d) {
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
}

/* Exact finite decimal for a terminating rational. */
function exactDecimal(v) {
  if (v.d === 1n) return v.n.toString();
  var a = 0, b = 0, d = v.d;
  while (d % 2n === 0n) { d /= 2n; a++; }
  while (d % 5n === 0n) { d /= 5n; b++; }
  var m = Math.max(a, b);
  var mul = 2n ** BigInt(m - a) * 5n ** BigInt(m - b);   // scales denom to 10^m
  var scaled = v.n * mul;                                 // over 10^m
  var neg = scaled < 0n;
  var digits = bigAbs(scaled).toString().padStart(m + 1, '0');
  var whole = digits.slice(0, digits.length - m);
  var frac = digits.slice(digits.length - m).replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

/* Round a rational to `places` decimals (round half away from zero), trimmed. */
function roundedDecimal(v, places) {
  var scale = 10n ** BigInt(places);
  var neg = v.n < 0n;
  var num = bigAbs(v.n) * scale;
  var q = num / v.d, r = num % v.d;
  if (r * 2n >= v.d) q += 1n;                             // round half up
  var digits = q.toString().padStart(places + 1, '0');
  var whole = digits.slice(0, digits.length - places);
  var frac = digits.slice(digits.length - places).replace(/0+$/, '');
  return (neg && q !== 0n ? '-' : '') + whole + (frac ? '.' + frac : '');
}

function formatApprox(x, places) {
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return x.toString();
  var s = x.toPrecision(places);
  // toPrecision may use exponential form for large/small; leave it if so.
  if (s.indexOf('e') === -1 && s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/* ------------------------------------------------------------------ *
 *  Public entry point.
 * ------------------------------------------------------------------ */

function evaluate(src, opts) {
  opts = opts || {};
  var places = opts.places == null ? 12 : opts.places;
  if (typeof src !== 'string' || src.trim() === '') {
    throw new Error('Enter an expression.');
  }
  var value = parse(tokenize(src));

  if (!value.exact) {
    return {
      exact: false,
      display: formatApprox(value.x, opts.approxDigits || 12),
      float: value.x,
    };
  }

  var out = {
    exact: true,
    float: toFloat(value),
    numerator: value.n.toString(),
    denominator: value.d.toString(),
    fraction: value.d === 1n ? value.n.toString() : value.n.toString() + '/' + value.d.toString(),
  };

  if (value.d === 1n || terminates(value.d)) {
    out.terminates = true;
    out.display = exactDecimal(value);
  } else {
    out.terminates = false;
    out.display = out.fraction;                    // exact answer is the fraction
    out.rounded = roundedDecimal(value, places);   // a decimal approximation of it
  }
  return out;
}

/* ------------------------------------------------------------------ */

var api = {
  evaluate: evaluate,
  tokenize: tokenize,
  // exposed for testing
  _Ops: Ops,
  _rat: rat,
  _exactDecimal: exactDecimal,
  _numberToRat: numberToRat,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.CalculatorCore = api;
