/*
 * collatz-core.js — the DOM-free brain of the Collatz Conjecture demo.
 *
 * The Collatz map: starting from a positive integer n, repeat
 *     n -> n / 2      when n is even
 *     n -> 3n + 1     when n is odd
 * The (unproven, 90-year-old) conjecture is that this always reaches 1.
 *
 * Four independent pieces, none of which touch the DOM:
 *   1. analyze(n): the full trajectory (hailstone sequence) from n to 1, over
 *      BigInt so the peaks are exact no matter how high they fly, plus its
 *      length (total stopping time), its highest value (the "altitude"), and
 *      the even / odd step split.
 *   2. shortcut(n): the same orbit under the accelerated map T(n) = (3n+1)/2
 *      for odd n, which folds each 3n+1 and the halving that always follows it
 *      into one step — the form number theorists actually study.
 *   3. records(limit): the record-holders in 1..limit — the number with the
 *      longest trajectory and the one that climbs highest — found with a
 *      memoised sweep so the whole range costs about as much as one long walk.
 *   4. binaryStep helpers: the parity of n is just its last bit, which is why
 *      the whole map is really a statement about binary digits.
 *
 * Runs in the browser (attaches to window.CollatzCore) and in Node
 * (module.exports), so the UI and the test suite share the exact same code.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CollatzCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2), THREE = BigInt(3);

  // Parse a decimal string / number into a positive BigInt, rejecting junk. We
  // do this ourselves rather than trusting BigInt() so the caller gets a
  // friendly message instead of a raw SyntaxError.
  function toPositiveInt(value, label) {
    label = label || "value";
    if (typeof value === "bigint") {
      if (value < ONE) throw new Error("The " + label + " must be 1 or greater.");
      return value;
    }
    var s = String(value).trim();
    if (s === "") throw new Error("The " + label + " is empty.");
    if (!/^\+?\d+$/.test(s)) throw new Error("The " + label + " must be a whole number (1 or greater).");
    var n = BigInt(s);
    if (n < ONE) throw new Error("The " + label + " must be 1 or greater.");
    return n;
  }

  function isEven(n) { return (n & ONE) === ZERO; }

  // One step of the standard Collatz map.
  function step(n) {
    return isEven(n) ? n / TWO : THREE * n + ONE;
  }

  // One step of the accelerated ("shortcut") map T: odd n jumps straight to
  // (3n+1)/2, since 3n+1 is always even. Even n still halves.
  function shortcutStep(n) {
    return isEven(n) ? n / TWO : (THREE * n + ONE) / TWO;
  }

  /*
   * The full standard trajectory from n down to 1.
   *
   * Returns:
   *   start       the BigInt we began with
   *   sequence    [n, ..., 1] as BigInts, every value visited
   *   steps       total stopping time = sequence.length - 1
   *   peak        the highest BigInt reached ("maximum altitude")
   *   peakIndex   where the peak sits in the sequence (0 = the start)
   *   evens       how many steps were halvings
   *   odds        how many steps were 3n+1
   */
  function analyze(n) {
    n = toPositiveInt(n, "number");
    var seq = [n];
    var peak = n, peakIndex = 0;
    var evens = 0, odds = 0;
    var cur = n, i = 0;
    while (cur !== ONE) {
      if (isEven(cur)) evens++; else odds++;
      cur = step(cur);
      i++;
      seq.push(cur);
      if (cur > peak) { peak = cur; peakIndex = i; }
    }
    return {
      start: n,
      sequence: seq,
      steps: seq.length - 1,
      peak: peak,
      peakIndex: peakIndex,
      evens: evens,
      odds: odds
    };
  }

  /*
   * The accelerated trajectory under T(n) = (3n+1)/2 for odd n. Same shape as
   * analyze(), but the odd steps also carry the halving, so the sequence is
   * shorter and each "up" step is a net multiply-by-3/2.
   */
  function shortcut(n) {
    n = toPositiveInt(n, "number");
    var seq = [n];
    var peak = n, peakIndex = 0;
    var ups = 0, downs = 0;
    var cur = n, i = 0;
    while (cur !== ONE) {
      if (isEven(cur)) downs++; else ups++;
      cur = shortcutStep(cur);
      i++;
      seq.push(cur);
      if (cur > peak) { peak = cur; peakIndex = i; }
    }
    return {
      start: n,
      sequence: seq,
      steps: seq.length - 1,
      peak: peak,
      peakIndex: peakIndex,
      ups: ups,
      downs: downs
    };
  }

  // Just the standard step count for n, without keeping the sequence. Handy
  // when the trajectory itself isn't needed.
  function stoppingTime(n) {
    n = toPositiveInt(n, "number");
    var cur = n, s = 0;
    while (cur !== ONE) { cur = step(cur); s++; }
    return s;
  }

  /*
   * Record-holders across 1..limit.
   *
   * A memoised sweep: for each start we walk the standard map until we reach a
   * value <= limit whose steps AND peak are already cached, then fold the walk
   * back in — so every number in the range is really only visited once. The
   * peak folds in values above `limit` too (they just aren't cached, to keep
   * memory bounded by the range rather than by how high the orbits fly).
   *
   * Returns:
   *   limit          the range ceiling actually used
   *   longest        { n, steps }  — longest total stopping time in the range
   *   highest        { n, peak }   — highest altitude reached in the range
   *   recordSteps    [{ n, steps }]  running records for stopping time
   *   recordPeaks    [{ n, peak }]   running records for altitude
   */
  function records(limit) {
    var big = toPositiveInt(limit, "limit");
    var MAX = 2000000;
    if (big > BigInt(MAX)) {
      throw new Error("Keep the range at " + MAX.toLocaleString() + " or below.");
    }
    var lim = Number(big);
    var limBig = big;

    // memo[k] = { steps, peak(BigInt) } for 1 <= k <= lim. Seed 1 -> done.
    var steps = new Array(lim + 1);
    var peaks = new Array(lim + 1);
    steps[1] = 0;
    peaks[1] = ONE;

    var longest = { n: 1, steps: 0 };
    var highest = { n: 1, peak: ONE };
    var recordSteps = [{ n: 1, steps: 0 }];
    var recordPeaks = [{ n: 1, peak: ONE }];

    for (var start = 2; start <= lim; start++) {
      if (steps[start] !== undefined) continue; // already filled by a longer walk
      var stack = [];
      var cur = BigInt(start);
      var tailSteps, tailPeak;
      // Walk until we hit an already-known value (always terminates at 1, which
      // is known). Values <= lim are looked up in the arrays; larger values are
      // never cached, so they're just pushed and folded in on the way back.
      while (true) {
        if (cur <= limBig) {
          var k = Number(cur);
          if (steps[k] !== undefined) { tailSteps = steps[k]; tailPeak = peaks[k]; break; }
        }
        stack.push(cur);
        cur = step(cur);
      }
      // Fold the walked prefix back in, from the value nearest the known tail
      // outward to `start`. Each hop adds one step; the peak is the running max.
      for (var j = stack.length - 1; j >= 0; j--) {
        var node = stack[j];
        tailSteps = tailSteps + 1;
        if (node > tailPeak) tailPeak = node;
        if (node <= limBig) {
          var idx = Number(node);
          if (steps[idx] === undefined) { steps[idx] = tailSteps; peaks[idx] = tailPeak; }
        }
      }
      // start is stack[0]; its totals are now tailSteps / tailPeak.
      var sSteps = steps[start], sPeak = peaks[start];
      if (sSteps > longest.steps) {
        longest = { n: start, steps: sSteps };
        recordSteps.push(longest);
      }
      if (sPeak > highest.peak) {
        highest = { n: start, peak: sPeak };
        recordPeaks.push(highest);
      }
    }

    return {
      limit: lim,
      longest: longest,
      highest: highest,
      recordSteps: recordSteps,
      recordPeaks: recordPeaks
    };
  }

  return {
    toPositiveInt: toPositiveInt,
    isEven: isEven,
    step: step,
    shortcutStep: shortcutStep,
    analyze: analyze,
    shortcut: shortcut,
    stoppingTime: stoppingTime,
    records: records
  };
});
