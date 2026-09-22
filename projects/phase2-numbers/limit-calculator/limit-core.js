/*
 * limit-core.js — the DOM-free brain of the Limit Calculator.
 *
 * Three independent pieces, none of which touch the DOM:
 *   1. A small math-expression parser + evaluator (recursive descent).
 *   2. A numerical limit estimator that approaches the target from each side
 *      and accelerates convergence with Richardson/Neville extrapolation.
 *   3. A closed-form recogniser that tries to name the numeric answer
 *      (a small fraction, or a rational multiple of pi, e, sqrt(2), ...).
 *
 * Runs in the browser (attaches to window.LimitCore) and in Node
 * (module.exports), so the UI and the test suite share the exact same code.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LimitCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1. Expression parser + evaluator
  // ---------------------------------------------------------------------------

  var CONSTANTS = {
    pi: Math.PI,
    "π": Math.PI, // π
    tau: 2 * Math.PI,
    e: Math.E,
    phi: (1 + Math.sqrt(5)) / 2
  };

  // Single-argument functions. `log` and `ln` are BOTH natural log (math
  // convention for limits); log10/log2 are the based variants.
  var FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    exp: Math.exp,
    ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
    sqrt: Math.sqrt, cbrt: Math.cbrt,
    abs: Math.abs, sign: Math.sign,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    sec: function (x) { return 1 / Math.cos(x); },
    csc: function (x) { return 1 / Math.sin(x); },
    cot: function (x) { return 1 / Math.tan(x); }
  };

  function tokenize(src) {
    var tokens = [];
    var i = 0;
    var s = src;
    while (i < s.length) {
      var c = s[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
      // number (with optional decimal and scientific notation)
      if (c >= "0" && c <= "9" || (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
        var j = i;
        while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
        if (s[j] === "e" || s[j] === "E") {
          var k = j + 1;
          if (s[k] === "+" || s[k] === "-") k++;
          if (s[k] >= "0" && s[k] <= "9") {
            j = k;
            while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
          }
        }
        var numText = s.slice(i, j);
        var num = Number(numText);
        if (!isFinite(num)) throw new SyntaxError("Bad number: " + numText);
        tokens.push({ t: "num", v: num });
        i = j;
        continue;
      }
      // identifier (variable, constant, or function name)
      if (/[a-zA-Zπ]/.test(c)) {
        var m = i;
        while (m < s.length && /[a-zA-Z0-9_π]/.test(s[m])) m++;
        tokens.push({ t: "id", v: s.slice(i, m) });
        i = m;
        continue;
      }
      if ("+-*/%^(),".indexOf(c) !== -1) {
        tokens.push({ t: "op", v: c });
        i++;
        continue;
      }
      throw new SyntaxError("Unexpected character '" + c + "' at position " + i);
    }
    tokens.push({ t: "eof" });
    return tokens;
  }

  // Recursive-descent parser producing an AST. Grammar (loosest to tightest):
  //   add   := mul (('+'|'-') mul)*
  //   mul   := unary ( ('*'|'/'|'%') unary | <implicit-mult> )*
  //   unary := ('+'|'-') unary | pow
  //   pow   := atom ('^' unary)?           (right associative)
  //   atom  := num | const | var | func '(' add ')' | '(' add ')'
  function parse(src) {
    if (typeof src !== "string" || src.trim() === "") {
      throw new SyntaxError("Empty expression");
    }
    var toks = tokenize(src);
    var pos = 0;

    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function expect(v) {
      var tk = next();
      if (tk.t !== "op" || tk.v !== v) throw new SyntaxError("Expected '" + v + "'");
      return tk;
    }

    // Does the current token begin a new factor (for implicit multiplication)?
    function startsFactor(tk) {
      if (tk.t === "num" || tk.t === "id") return true;
      if (tk.t === "op" && tk.v === "(") return true;
      return false;
    }

    function parseAdd() {
      var node = parseMul();
      while (peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
        var op = next().v;
        node = { type: "bin", op: op, a: node, b: parseMul() };
      }
      return node;
    }

    function parseMul() {
      var node = parseUnary();
      for (;;) {
        var tk = peek();
        if (tk.t === "op" && (tk.v === "*" || tk.v === "/" || tk.v === "%")) {
          var op = next().v;
          node = { type: "bin", op: op, a: node, b: parseUnary() };
        } else if (startsFactor(tk)) {
          // implicit multiplication, e.g. 2x, 3(x+1), x sin(x)
          node = { type: "bin", op: "*", a: node, b: parseUnary() };
        } else {
          break;
        }
      }
      return node;
    }

    function parseUnary() {
      var tk = peek();
      if (tk.t === "op" && (tk.v === "+" || tk.v === "-")) {
        next();
        var operand = parseUnary();
        return tk.v === "-" ? { type: "neg", a: operand } : operand;
      }
      return parsePow();
    }

    function parsePow() {
      var base = parseAtom();
      if (peek().t === "op" && peek().v === "^") {
        next();
        var exp = parseUnary(); // right associative, allows 2^-x
        return { type: "bin", op: "^", a: base, b: exp };
      }
      return base;
    }

    function parseAtom() {
      var tk = next();
      if (tk.t === "num") return { type: "num", v: tk.v };
      if (tk.t === "op" && tk.v === "(") {
        var inner = parseAdd();
        expect(")");
        return inner;
      }
      if (tk.t === "id") {
        var name = tk.v;
        // function call?
        if (peek().t === "op" && peek().v === "(") {
          if (!FUNCS.hasOwnProperty(name)) {
            throw new SyntaxError("Unknown function '" + name + "'");
          }
          next(); // (
          var arg = parseAdd();
          expect(")");
          return { type: "call", name: name, arg: arg };
        }
        if (name === "x" || name === "X") return { type: "var" };
        if (CONSTANTS.hasOwnProperty(name)) return { type: "num", v: CONSTANTS[name] };
        throw new SyntaxError("Unknown name '" + name + "'");
      }
      throw new SyntaxError("Unexpected token");
    }

    var ast = parseAdd();
    if (peek().t !== "eof") throw new SyntaxError("Unexpected trailing input");
    return ast;
  }

  function evalNode(node, x) {
    switch (node.type) {
      case "num": return node.v;
      case "var": return x;
      case "neg": return -evalNode(node.a, x);
      case "call": return FUNCS[node.name](evalNode(node.arg, x));
      case "bin": {
        var a = evalNode(node.a, x);
        var b = evalNode(node.b, x);
        switch (node.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return a / b;
          case "%": return a % b;
          case "^": return Math.pow(a, b);
        }
        break;
      }
    }
    throw new Error("Bad AST node");
  }

  // Compile an expression string into a plain function f(x). Throws on a
  // syntax error so callers can show the user a message.
  function compile(src) {
    var ast = parse(src);
    return function (x) { return evalNode(ast, x); };
  }

  // ---------------------------------------------------------------------------
  // 2. Numerical limit estimation
  // ---------------------------------------------------------------------------

  // Neville extrapolation of samples (h_k, y_k) to h = 0. Returns the
  // extrapolated value and an error estimate (the last correction applied).
  function extrapolateToZero(hs, ys) {
    var m = hs.length;
    if (m === 0) return { value: NaN, err: Infinity };
    if (m === 1) return { value: ys[0], err: Infinity };
    var col = ys.slice();
    var corners = [col[0]]; // T[0] using points 0..k, for k = 0,1,2,...
    for (var k = 1; k < m; k++) {
      var next = [];
      for (var i = 0; i < m - k; i++) {
        var hi = hs[i], hik = hs[i + k];
        // value of the interpolating polynomial through the window at x = 0
        var val = ((0 - hik) * col[i] - (0 - hi) * col[i + 1]) / (hi - hik);
        next.push(val);
      }
      col = next;
      corners.push(col[0]);
    }
    var value = corners[corners.length - 1];
    var err = Math.abs(corners[corners.length - 1] - corners[corners.length - 2]);
    return { value: value, err: err };
  }

  function relClose(a, b, tol) {
    var scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= tol * scale;
  }

  // Sample f approaching `a` from one side (dir = -1 left, +1 right) and
  // estimate the one-sided limit. Returns:
  //   { status: 'finite'|'infinite'|'dne', value, sign, samples: [{h,x,y}] }
  function estimateOneSided(f, a, dir, opts) {
    opts = opts || {};
    var startH = opts.startH || 0.125;
    var ratio = opts.ratio || 0.5;
    var count = opts.count || 14;
    var tol = opts.tol || 1e-7;

    var hs = [];
    var ys = [];
    var samples = [];
    var h = startH;
    for (var k = 0; k < count; k++) {
      var scale = Math.max(1, Math.abs(a));
      var x = a + dir * h * scale;
      var y;
      try { y = f(x); } catch (e) { y = NaN; }
      samples.push({ h: h, x: x, y: y });
      if (isFinite(y)) { hs.push(h); ys.push(y); }
      h *= ratio;
    }

    // Not enough finite samples to say anything.
    if (ys.length < 3) {
      return { status: "dne", value: NaN, sign: 0, samples: samples, reason: "undefined" };
    }

    // Blow-up detection: the last few finite samples large and growing in
    // magnitude with a consistent sign as we approach -> the limit is +/-inf.
    var tail = ys.slice(-4);
    var growing = true, sameSign = true;
    for (var t = 1; t < tail.length; t++) {
      if (Math.abs(tail[t]) < Math.abs(tail[t - 1]) * 1.2) growing = false;
      if (Math.sign(tail[t]) !== Math.sign(tail[t - 1])) sameSign = false;
    }
    var last = ys[ys.length - 1];
    if (growing && sameSign && Math.abs(last) > 1e4) {
      return { status: "infinite", value: dir === 0 ? 0 : last, sign: Math.sign(last), samples: samples };
    }

    // Richardson/Neville extrapolation to h = 0.
    var ex = extrapolateToZero(hs, ys);

    // If extrapolation converged, accept it. Also require the raw tail to be
    // near the extrapolated value, to reject oscillation that fools Neville.
    var rawClose = relClose(last, ex.value, 1e-3);
    var errScale = Math.max(1, Math.abs(ex.value));
    if (isFinite(ex.value) && ex.err <= tol * errScale && rawClose) {
      var v = Math.abs(ex.value) < tol ? 0 : ex.value;
      return { status: "finite", value: v, sign: 0, samples: samples, err: ex.err, confident: true };
    }

    // Fallback for slow but genuine convergence (e.g. h*ln(h) -> 0, where the
    // approach is monotone and Cauchy but not a clean power series that Neville
    // can nail to 1e-7). Accept when the tail marches steadily to a value with
    // shrinking, small steps. Oscillation (sin(1/x)) fails this: its steps
    // neither keep one sign nor shrink.
    var ft = ys.slice(-5);
    if (ft.length >= 4) {
      var monotone = true, shrinking = true;
      var diffs = [];
      for (var d = 1; d < ft.length; d++) diffs.push(ft[d] - ft[d - 1]);
      for (var q = 1; q < diffs.length; q++) {
        if (Math.sign(diffs[q]) !== Math.sign(diffs[q - 1]) && diffs[q] !== 0) monotone = false;
        if (Math.abs(diffs[q]) > Math.abs(diffs[q - 1]) * 0.95) shrinking = false;
      }
      var lastDiff = Math.abs(diffs[diffs.length - 1]);
      var small = lastDiff <= 1e-3 * Math.max(1, Math.abs(last));
      if (monotone && shrinking && small) {
        var est = (isFinite(ex.value) && relClose(ex.value, last, 1e-2)) ? ex.value : last;
        if (Math.abs(est) < 1e-4) est = 0;
        return { status: "finite", value: est, sign: 0, samples: samples, err: lastDiff, confident: false };
      }
    }

    // Retry once with a finer starting scale for functions that only enter
    // their asymptotic regime closer to the point.
    if (!opts._retried) {
      var again = estimateOneSided(f, a, dir, {
        startH: startH * ratio * ratio,
        ratio: ratio, count: count, tol: tol, _retried: true
      });
      if (again.status !== "dne") return again;
    }

    return { status: "dne", value: NaN, sign: 0, samples: samples, reason: "no-convergence" };
  }

  // Full limit of f as x -> target. `target` is a finite number, or the
  // strings "inf"/"-inf". Returns a rich result object.
  function limit(fOrSrc, target, opts) {
    var f = typeof fOrSrc === "function" ? fOrSrc : compile(fOrSrc);
    opts = opts || {};
    var tol = opts.tol || 1e-7;

    // Limits at infinity are inherently one-sided; substitute x = ±1/t and
    // take t -> 0+ so we can reuse the finite machinery.
    if (target === "inf" || target === "-inf" || target === Infinity || target === -Infinity) {
      var toPlus = (target === "inf" || target === Infinity);
      var g = function (t) { return f(toPlus ? 1 / t : -1 / t); };
      var oneAtInf = estimateOneSided(g, 0, +1, opts);
      return {
        status: oneAtInf.status,
        value: oneAtInf.value,
        sign: oneAtInf.sign,
        target: toPlus ? "inf" : "-inf",
        oneSided: true,
        right: oneAtInf,
        closedForm: oneAtInf.status === "finite" ? recognize(oneAtInf.value) : null,
        fAt: null
      };
    }

    var a = target;
    var left = estimateOneSided(f, a, -1, opts);
    var right = estimateOneSided(f, a, +1, opts);

    var fAt;
    try { var yv = f(a); fAt = isFinite(yv) ? yv : null; } catch (e) { fAt = null; }

    // Decide the two-sided verdict from the two one-sided results.
    var status, value = NaN, sign = 0, reason = null;

    var lFin = left.status === "finite", rFin = right.status === "finite";
    var lInf = left.status === "infinite", rInf = right.status === "infinite";

    if (lFin && rFin) {
      if (relClose(left.value, right.value, 1e-4)) {
        status = "finite";
        value = (left.value + right.value) / 2;
        if (Math.abs(value) < tol) value = 0;
      } else {
        status = "dne";
        reason = "sides-differ";
      }
    } else if (lInf && rInf) {
      if (left.sign === right.sign) {
        status = "infinite"; sign = left.sign;
      } else {
        status = "dne"; reason = "sides-differ";
      }
    } else if (lFin && right.status === "dne") {
      // one side undefined (domain boundary) -> report the defined side
      if (left.samples.filter(function (s) { return isFinite(s.y); }).length &&
          right.samples.filter(function (s) { return isFinite(s.y); }).length === 0) {
        status = "finite"; value = left.value; reason = "one-sided-domain";
      } else { status = "dne"; reason = "one-side-dne"; }
    } else if (rFin && left.status === "dne") {
      if (right.samples.filter(function (s) { return isFinite(s.y); }).length &&
          left.samples.filter(function (s) { return isFinite(s.y); }).length === 0) {
        status = "finite"; value = right.value; reason = "one-sided-domain";
      } else { status = "dne"; reason = "one-side-dne"; }
    } else if ((lInf && rFin) || (lFin && rInf)) {
      status = "dne"; reason = "sides-differ";
    } else {
      status = "dne"; reason = left.reason || right.reason || "no-convergence";
    }

    return {
      status: status,
      value: value,
      sign: sign,
      reason: reason,
      target: a,
      oneSided: false,
      left: left,
      right: right,
      fAt: fAt,
      continuous: status === "finite" && fAt != null && relClose(fAt, value, 1e-6),
      closedForm: status === "finite" ? recognize(value) : null
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Closed-form recogniser (display sugar; the numeric value is authority)
  // ---------------------------------------------------------------------------

  // Continued-fraction rational approximation of x with denominator <= maxDen.
  function rationalApprox(x, maxDen) {
    if (!isFinite(x)) return null;
    var neg = x < 0;
    x = Math.abs(x);
    var h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = x;
    for (var i = 0; i < 40; i++) {
      var aI = Math.floor(b);
      var h2 = aI * h1 + h0;
      var k2 = aI * k1 + k0;
      if (k2 > maxDen) break;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      var frac = b - aI;
      if (frac < 1e-12) break;
      b = 1 / frac;
    }
    if (k1 === 0) return null;
    var p = h1, q = k1;
    if (Math.abs(p / q - x) > 1e-9 * Math.max(1, x)) return null;
    return { p: neg ? -p : p, q: q };
  }

  var NAMED = [
    { name: "pi", value: Math.PI },
    { name: "e", value: Math.E },
    { name: "sqrt(2)", value: Math.SQRT2 },
    { name: "sqrt(3)", value: Math.sqrt(3) },
    { name: "ln(2)", value: Math.LN2 },
    { name: "pi^2", value: Math.PI * Math.PI }
  ];

  function fmtRatMultiple(r, unit) {
    var p = r.p, q = r.q;
    var body;
    if (q === 1) body = (p === 1 ? "" : p === -1 ? "-" : String(p)) + unit;
    else body = (p === 1 ? "" : p === -1 ? "-" : p) + unit + "/" + q;
    return body === "" ? "1" : body;
  }

  // Try to name `value`: a small fraction, or a small rational multiple of a
  // known constant. Returns a display string or null.
  function recognize(value) {
    if (!isFinite(value)) return null;
    if (value === 0) return "0";
    // plain integer
    if (Math.abs(value - Math.round(value)) < 1e-9 && Math.abs(value) < 1e6) {
      return String(Math.round(value));
    }
    // small fraction
    var r = rationalApprox(value, 1000);
    if (r && r.q > 1 && r.q <= 1000) {
      // prefer this only when denominator is genuinely small/clean
      if (r.q <= 12 || Math.abs(r.p / r.q - value) < 1e-11) {
        return r.p + "/" + r.q;
      }
    }
    // rational multiple of a named constant
    for (var i = 0; i < NAMED.length; i++) {
      var ratio = value / NAMED[i].value;
      var rr = rationalApprox(ratio, 24);
      if (rr && Math.abs(rr.p / rr.q - ratio) < 1e-9 && Math.abs(rr.p) <= 24) {
        return fmtRatMultiple(rr, NAMED[i].name);
      }
    }
    return null;
  }

  return {
    parse: parse,
    compile: compile,
    evalNode: evalNode,
    extrapolateToZero: extrapolateToZero,
    estimateOneSided: estimateOneSided,
    limit: limit,
    recognize: recognize,
    rationalApprox: rationalApprox,
    FUNCS: FUNCS,
    CONSTANTS: CONSTANTS
  };
});
