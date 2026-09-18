/*
 * complex-core.js — the DOM-free core of the Complex Number Algebra app.
 *
 * The brief (karan/Projects → Numbers, entry 17): "Complex Number Algebra —
 * show co-ordinates on a coordinate plane based on user input." So the job is
 * two-fold: parse complex numbers the way a person writes them ("3 + 4i", "-i",
 * "2.5e-3 - 1.5i"), do the algebra on them, and hand back plottable co-ordinates
 * for an Argand diagram. This file does everything except touch the DOM: it
 * parses, formats, and computes, so `tests.js` can prove its properties without
 * a browser or a network.
 *
 * Where factorial demanded exact BigInt because the answer is an integer, complex
 * algebra is genuinely a floating-point problem — a modulus, an argument, an nth
 * root are irrational in general, so there is no exact integer to preserve. The
 * care here is therefore *numeric*, not exact:
 *
 *   1. **Division** uses Smith's algorithm (scale by the larger denominator
 *      component) instead of the schoolbook (ac+bd)/(c²+d²). The schoolbook form
 *      squares the components, so it overflows to Infinity for inputs as ordinary
 *      as 1e200 and underflows to 0 for 1e-200 — Smith's form divides those exact
 *      same cases correctly.
 *   2. **Modulus** uses Math.hypot, which likewise avoids the intermediate
 *      overflow of sqrt(re*re + im*im).
 *   3. **Square root** uses the numerically stable branch of the closed form
 *      rather than going through polar, so it stays accurate near the negative
 *      real axis where the angle method loses precision.
 *
 * A complex number is a plain `{ re, im }` of two JS numbers. Every operation
 * returns a fresh object and mutates nothing.
 *
 * The module loads both in the browser (as `window.ComplexCore`) and in Node
 * (via `require`).
 */

'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ComplexCore = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---- construction --------------------------------------------------------- */

  function C(re, im) {
    return { re: +re, im: (im === undefined ? 0 : +im) };
  }

  function isComplex(z) {
    return z != null && typeof z.re === 'number' && typeof z.im === 'number';
  }

  // Reject NaN/Infinity at the door: a "complex number" with a non-finite part is
  // never a valid input, and letting it through would silently poison every later
  // operation.
  function check(z, where) {
    if (!isComplex(z)) throw new TypeError((where || 'value') + ' is not a complex number');
    if (!isFinite(z.re) || !isFinite(z.im)) {
      throw new RangeError((where || 'value') + ' is not finite');
    }
    return z;
  }

  /* ---- parsing -------------------------------------------------------------
   * People write complex numbers many ways: "3+4i", "3 - 4i", "-i", "i", "5",
   * "4i", "2.5e-3 + 1.5i", "-2-3j" (engineers use j). We accept a sum of terms,
   * each of which is an optional sign, an optional magnitude, and an optional
   * imaginary unit (i or j). A bare "i" is 1i and "-i" is -1i. The whole string
   * must be consumed — "12x" or "3 + 4k" is a bad question that gets an error,
   * not a silently truncated parse the way parseFloat would give.
   */

  // One term: sign, magnitude (int/decimal, optional exponent), optional i/j.
  var TERM = /([+-]?)((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?([ij])?/g;

  function parse(str) {
    if (typeof str !== 'string') throw new TypeError('parse expects a string');
    var s = str.trim();
    if (s === '') throw new SyntaxError('empty input');
    // Strip spaces and underscores used as separators; normalise unicode minus.
    s = s.replace(/[\s_]+/g, '').replace(/−/g, '-');
    if (s === '') throw new SyntaxError('empty input');

    var re = 0, im = 0, consumed = 0, sawTerm = false;
    TERM.lastIndex = 0;
    var m;
    while ((m = TERM.exec(s)) !== null) {
      // A zero-length match means the regex could not advance: stop.
      if (m.index !== consumed) break;
      var whole = m[0];
      if (whole === '') { TERM.lastIndex++; break; }

      var sign = m[1] === '-' ? -1 : 1;
      var magStr = m[2];
      var unit = m[3];

      // A term must carry *something* — a bare sign like "3+-i" or a trailing
      // "+" is malformed.
      if (magStr === undefined && unit === undefined) break;

      var mag = magStr === undefined ? 1 : parseFloat(magStr);
      if (unit) im += sign * mag; else re += sign * mag;

      sawTerm = true;
      consumed += whole.length;
      if (consumed >= s.length) break;
    }

    if (!sawTerm || consumed !== s.length) {
      throw new SyntaxError('cannot parse complex number: ' + JSON.stringify(str));
    }
    // Normalise -0 to 0 so formatting never shows "-0".
    return C(re === 0 ? 0 : re, im === 0 ? 0 : im);
  }

  /* ---- formatting ----------------------------------------------------------
   * Turn {re, im} back into the way a person would write it: "0", "3", "-4i",
   * "3 + 4i", "3 - 4i". `digits` (default 6) rounds for display only; the stored
   * value keeps full precision. Tiny components (below the display epsilon) are
   * dropped so 1e-17 noise from a computation doesn't print as "+ 0.0000000i".
   */

  function trim(x, digits) {
    // toPrecision then strip trailing zeros, so 3.140000 -> 3.14 but 3 stays 3.
    var str = x.toPrecision(digits);
    if (str.indexOf('e') === -1 && str.indexOf('.') !== -1) {
      str = str.replace(/0+$/, '').replace(/\.$/, '');
    }
    return str;
  }

  function format(z, digits) {
    check(z, 'format argument');
    if (digits === undefined) digits = 6;
    var eps = Math.pow(10, -digits) / 2;
    var re = Math.abs(z.re) < eps ? 0 : z.re;
    var im = Math.abs(z.im) < eps ? 0 : z.im;

    if (im === 0) return trim(re, digits);
    var imMag = trim(Math.abs(im), digits);
    var imPart = (imMag === '1' ? '' : imMag) + 'i';
    if (re === 0) return (im < 0 ? '-' : '') + imPart;
    return trim(re, digits) + (im < 0 ? ' - ' : ' + ') + imPart;
  }

  /* ---- algebra -------------------------------------------------------------- */

  function add(a, b) { check(a, 'a'); check(b, 'b'); return C(a.re + b.re, a.im + b.im); }
  function sub(a, b) { check(a, 'a'); check(b, 'b'); return C(a.re - b.re, a.im - b.im); }
  function neg(z)    { check(z); return C(-z.re, -z.im); }
  function conj(z)   { check(z); return C(z.re, -z.im); }
  function scale(z, k) { check(z); return C(z.re * k, z.im * k); }

  function mul(a, b) {
    check(a, 'a'); check(b, 'b');
    return C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  }

  // Division by Smith's method: divide through by the larger of |c|, |d| so the
  // intermediate quantities stay near unit scale and never square the operands.
  function div(a, b) {
    check(a, 'a'); check(b, 'b');
    var c = b.re, d = b.im;
    if (c === 0 && d === 0) throw new RangeError('division by zero');
    if (Math.abs(c) >= Math.abs(d)) {
      var r = d / c, den = c + d * r;
      return C((a.re + a.im * r) / den, (a.im - a.re * r) / den);
    } else {
      var r2 = c / d, den2 = c * r2 + d;
      return C((a.re * r2 + a.im) / den2, (a.im * r2 - a.re) / den2);
    }
  }

  function abs(z) { check(z); return Math.hypot(z.re, z.im); }          // modulus
  function abs2(z) { check(z); return z.re * z.re + z.im * z.im; }      // |z|²
  function arg(z) { check(z); return Math.atan2(z.im, z.re); }         // (-π, π]

  function fromPolar(r, theta) { return C(r * Math.cos(theta), r * Math.sin(theta)); }

  // Integer power by exponentiation-by-squaring — exact multiplies (no polar
  // round-trip), and negative powers via a single reciprocal.
  function powInt(z, n) {
    check(z);
    if (!Number.isInteger(n)) throw new RangeError('powInt needs an integer exponent');
    if (n === 0) return C(1, 0);
    var neg = n < 0;
    var e = Math.abs(n);
    var result = C(1, 0), base = C(z.re, z.im);
    while (e > 0) {
      if (e & 1) result = mul(result, base);
      base = mul(base, base);
      e = Math.floor(e / 2);
    }
    return neg ? div(C(1, 0), result) : result;
  }

  // Real power via the principal branch: z^t = r^t · e^{i·t·θ}.
  function powReal(z, t) {
    check(z);
    if (z.re === 0 && z.im === 0) {
      if (t === 0) return C(1, 0);
      if (t > 0) return C(0, 0);
      throw new RangeError('0 raised to a negative power');
    }
    var r = abs(z), th = arg(z);
    return fromPolar(Math.pow(r, t), t * th);
  }

  // Stable principal square root (Numerical Recipes / LAPACK csqrt): avoids the
  // polar route's precision loss near the negative real axis.
  function sqrt(z) {
    check(z);
    if (z.re === 0 && z.im === 0) return C(0, 0);
    var x = Math.abs(z.re), y = Math.abs(z.im), w;
    if (x >= y) {
      var t = y / x;
      w = Math.sqrt(x) * Math.sqrt((1 + Math.sqrt(1 + t * t)) / 2);
    } else {
      var t2 = x / y;
      w = Math.sqrt(y) * Math.sqrt((t2 + Math.sqrt(1 + t2 * t2)) / 2);
    }
    if (z.re >= 0) return C(w, z.im / (2 * w));
    var im = z.im >= 0 ? w : -w;
    return C(z.im / (2 * im), im);
  }

  // The n distinct nth roots, evenly spaced by 2π/n around a circle of radius
  // r^{1/n}. Returned smallest-argument-first. This is the "co-ordinates on a
  // plane" payoff: n points on a circle.
  function nthRoots(z, n) {
    check(z);
    if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
    var r = Math.pow(abs(z), 1 / n);
    var th = arg(z);
    var roots = [];
    for (var k = 0; k < n; k++) {
      roots.push(fromPolar(r, (th + 2 * Math.PI * k) / n));
    }
    return roots;
  }

  function exp(z) { check(z); return fromPolar(Math.exp(z.re), z.im); }
  function log(z) { check(z); return C(Math.log(abs(z)), arg(z)); }     // principal

  function equals(a, b, tol) {
    check(a, 'a'); check(b, 'b');
    if (tol === undefined) tol = 1e-9;
    return Math.abs(a.re - b.re) <= tol && Math.abs(a.im - b.im) <= tol;
  }

  /* ---- one call the UI leans on --------------------------------------------
   * Given two parsed operands and an operation name, compute the result and hand
   * back everything the Argand plane wants to draw: the operands, the result, and
   * (for roots) the full set of points. Polar readouts (modulus/argument) come
   * along so the panel and the plot agree.
   */
  var BINARY = {
    'add': add, 'subtract': sub, 'multiply': mul, 'divide': div
  };

  function polar(z) {
    return { r: abs(z), theta: arg(z), degrees: arg(z) * 180 / Math.PI };
  }

  function compute(op, a, b) {
    check(a, 'a');
    var points, result;
    switch (op) {
      case 'add': case 'subtract': case 'multiply': case 'divide':
        check(b, 'b');
        result = BINARY[op](a, b);
        points = [result];
        break;
      case 'conjugate': result = conj(a); points = [result]; break;
      case 'negate':    result = neg(a);  points = [result]; break;
      case 'reciprocal': result = div(C(1, 0), a); points = [result]; break;
      case 'sqrt':      result = sqrt(a); points = [result]; break;
      case 'square':    result = powInt(a, 2); points = [result]; break;
      case 'roots': {
        var n = b; // for roots, b carries the integer n
        var rs = nthRoots(a, n);
        result = rs[0];
        points = rs;
        break;
      }
      default: throw new RangeError('unknown operation: ' + op);
    }
    return {
      op: op,
      result: result,
      resultStr: format(result),
      points: points,
      polar: polar(result)
    };
  }

  return {
    C: C,
    isComplex: isComplex,
    parse: parse,
    format: format,
    add: add, sub: sub, neg: neg, conj: conj, scale: scale,
    mul: mul, div: div,
    abs: abs, abs2: abs2, arg: arg,
    fromPolar: fromPolar, polar: polar,
    powInt: powInt, powReal: powReal, sqrt: sqrt, nthRoots: nthRoots,
    exp: exp, log: log,
    equals: equals,
    compute: compute
  };
});
