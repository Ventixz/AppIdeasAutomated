/*
 * fastexp-core.js — the DOM-free brain of the Fast Exponentiation demo.
 *
 * Four independent pieces, none of which touch the DOM:
 *   1. Left-to-right "square-and-multiply" exponentiation over BigInt, which
 *      reads the exponent's binary digits from the top down and records every
 *      square / multiply step so the UI can show its work.
 *   2. Modular exponentiation (base^exp mod m) — the same ladder, but reducing
 *      after every step, so 7^1000000 mod 13 stays a two-digit number the whole
 *      way. This is the operation that makes RSA / Diffie-Hellman practical.
 *   3. A multiplication counter: how many big-integer multiplies the fast
 *      method needs versus the naive "multiply base by itself exp times" loop.
 *   4. 2x2 integer matrix exponentiation, used to compute Fibonacci numbers in
 *      O(log n) multiplies — a second, very different payoff of the same trick.
 *
 * Runs in the browser (attaches to window.FastExpCore) and in Node
 * (module.exports), so the UI and the test suite share the exact same code.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FastExpCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2);

  // Parse a decimal string / number into a BigInt, rejecting junk. We do this
  // ourselves rather than trusting BigInt() so the caller gets a friendly
  // message instead of a raw SyntaxError.
  function toBig(value, label) {
    label = label || "value";
    if (typeof value === "bigint") return value;
    var s = String(value).trim();
    if (s === "") throw new Error("The " + label + " is empty.");
    if (!/^[+-]?\d+$/.test(s)) throw new Error("The " + label + " must be a whole number.");
    return BigInt(s);
  }

  // The exponent's binary digits, most-significant first. bits([13]) -> [1,1,0,1].
  function bitsOf(n) {
    if (n < ZERO) throw new Error("The exponent must be zero or positive.");
    if (n === ZERO) return [0];
    var out = [];
    while (n > ZERO) {
      out.push(Number(n & ONE));
      n >>= ONE;
    }
    out.reverse();
    return out;
  }

  // Count the 1-bits (population count) of a non-negative BigInt.
  function popcount(n) {
    var c = 0;
    while (n > ZERO) { c += Number(n & ONE); n >>= ONE; }
    return c;
  }

  /*
   * Left-to-right square-and-multiply, over BigInt.
   *
   * Starting from result = 1, walk the exponent's bits from the top:
   *   - every bit: square the running result;
   *   - a 1-bit: also multiply by the base.
   * The very first (leading) bit is always 1, so instead of "square 1 then
   * multiply" we just seed result = base and start from the second bit — that
   * keeps the step list honest about the work actually done.
   *
   * Returns { value, steps, squarings, multiplies }. Each step is
   * { bit, op, note, value } where op is "seed" | "square" | "multiply".
   * `mod` (a BigInt > 1) switches on modular reduction after each operation.
   */
  function squareAndMultiply(base, exp, mod) {
    base = toBig(base, "base");
    exp = toBig(exp, "exponent");
    if (exp < ZERO) throw new Error("The exponent must be zero or positive.");
    if (mod != null) {
      mod = toBig(mod, "modulus");
      if (mod <= ONE) throw new Error("The modulus must be greater than 1.");
    }

    var reduce = function (x) { return mod == null ? x : ((x % mod) + mod) % mod; };
    var steps = [];
    var squarings = 0, multiplies = 0;

    if (exp === ZERO) {
      var one = reduce(ONE);
      steps.push({ bit: null, op: "seed", note: "anything^0 = 1", value: one });
      return { value: one, steps: steps, squarings: 0, multiplies: 0 };
    }

    var bits = bitsOf(exp);
    var result = reduce(base);
    steps.push({
      bit: bits[0], op: "seed",
      note: "leading 1-bit → start at the base",
      value: result
    });

    for (var i = 1; i < bits.length; i++) {
      result = reduce(result * result);
      squarings++;
      steps.push({ bit: bits[i], op: "square", note: "read next bit → square", value: result });
      if (bits[i] === 1) {
        result = reduce(result * base);
        multiplies++;
        steps.push({ bit: bits[i], op: "multiply", note: "bit is 1 → multiply by base", value: result });
      }
    }

    return { value: result, steps: steps, squarings: squarings, multiplies: multiplies };
  }

  // Plain power, no modulus. Thin wrapper the UI and tests call by name.
  function power(base, exp) {
    return squareAndMultiply(base, exp, null);
  }

  // Modular power: base^exp mod m. Kept separate so its intent reads clearly.
  function modPow(base, exp, mod) {
    return squareAndMultiply(base, exp, mod);
  }

  /*
   * How many multiplications does each method spend?
   *
   *   naive  : result = base; multiply by base (exp-1) more times  → exp-1 mults
   *            (exp 0 or 1 needs none).
   *   fast   : one squaring per non-leading bit, plus one multiply per 1-bit
   *            after the leading one → (bitlen-1) + (popcount-1).
   *
   * We return the counts as regular Numbers where they fit; for astronomically
   * large exponents the naive count is returned as a BigInt so nothing lies by
   * overflowing. `saved` is naive - fast.
   */
  function multiplyCounts(exp) {
    exp = toBig(exp, "exponent");
    if (exp < ZERO) throw new Error("The exponent must be zero or positive.");
    var naive = exp <= ONE ? ZERO : exp - ONE;
    var bitlen = exp === ZERO ? 0 : bitsOf(exp).length;
    var fast = exp <= ONE ? ZERO : BigInt((bitlen - 1) + (popcount(exp) - 1));
    return {
      naive: naive,
      fast: fast,
      saved: naive - fast,
      bitLength: bitlen,
      oneBits: popcount(exp)
    };
  }

  // --- 2x2 integer matrices, for the Fibonacci payoff ----------------------
  // A matrix is [a, b, c, d] meaning [[a, b], [c, d]], entries BigInt.
  function matMul(m, n, mod) {
    var a = m[0] * n[0] + m[1] * n[2];
    var b = m[0] * n[1] + m[1] * n[3];
    var c = m[2] * n[0] + m[3] * n[2];
    var d = m[2] * n[1] + m[3] * n[3];
    if (mod != null) { a %= mod; b %= mod; c %= mod; d %= mod; }
    return [a, b, c, d];
  }

  // Matrix fast-exponentiation. Returns { matrix, multiplies } where each
  // 2x2 multiply counts as one (it is 8 scalar multiplies underneath).
  function matPow(m, exp, mod) {
    exp = toBig(exp, "exponent");
    if (exp < ZERO) throw new Error("The exponent must be zero or positive.");
    var result = [ONE, ZERO, ZERO, ONE]; // identity
    var base = m.slice();
    var mults = 0;
    while (exp > ZERO) {
      if (exp & ONE) { result = matMul(result, base, mod); mults++; }
      exp >>= ONE;
      if (exp > ZERO) { base = matMul(base, base, mod); mults++; }
    }
    return { matrix: result, multiplies: mults };
  }

  /*
   * Fibonacci by matrix power: [[1,1],[1,0]]^n = [[F(n+1), F(n)], [F(n), F(n-1)]].
   * F(0)=0, F(1)=1. Returns { value, multiplies } — value is F(n) as BigInt.
   */
  function fibonacci(n, mod) {
    n = toBig(n, "index");
    if (n < ZERO) throw new Error("The Fibonacci index must be zero or positive.");
    if (n === ZERO) return { value: mod == null ? ZERO : ZERO % mod, multiplies: 0 };
    var r = matPow([ONE, ONE, ONE, ZERO], n, mod == null ? null : toBig(mod, "modulus"));
    return { value: r.matrix[1], multiplies: r.multiplies };
  }

  return {
    toBig: toBig,
    bitsOf: bitsOf,
    popcount: popcount,
    power: power,
    modPow: modPow,
    squareAndMultiply: squareAndMultiply,
    multiplyCounts: multiplyCounts,
    matMul: matMul,
    matPow: matPow,
    fibonacci: fibonacci
  };
});
