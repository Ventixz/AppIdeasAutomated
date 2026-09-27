/*
 * sieve-core.js — the Sieve of Eratosthenes, and three siblings that let you
 * *see* why it wins.
 *
 * A Source 2 (karan/Projects) "Classic Algorithms" project. The karan spec
 * reads:
 *
 *   "Sieve of Eratosthenes — the sieve of Eratosthenes is a simple, ancient
 *    algorithm for finding all prime numbers up to any given limit."
 *
 * Four algorithms compute "every prime ≤ n" here, and the whole point of putting
 * them side by side is the contrast in *how much work* each one does:
 *
 *   - trial(n)    — test each number 2..n for a divisor up to its square root.
 *                   Dead simple, obviously correct, and the tests' oracle. About
 *                   O(n·√n / ln n) division tests.
 *   - sieve(n)    — the classic sieve: for each prime p, cross out p², p²+p,
 *                   p²+2p, … A composite with several prime factors is crossed
 *                   more than once. O(n log log n) cross-outs.
 *   - linear(n)   — Euler's linear sieve: each composite is crossed *exactly
 *                   once*, by its smallest prime factor. O(n) cross-outs, and it
 *                   falls out with a smallest-prime-factor table for free.
 *   - segmented(n)— the classic sieve run over fixed-size windows using only the
 *                   base primes ≤ √n, so memory is O(√n) instead of O(n). The
 *                   answer and the cross-out count match the plain sieve exactly;
 *                   only the memory footprint differs.
 *
 * As in this project's sibling builds, the *work* is instrumented, not just the
 * answer. Every "cross out this number as composite" and every "test this
 * divisor" routes through a single Tracker that counts operations, so the
 * O(n·√n) vs. O(n log log n) vs. O(n) gap is a number you read off a table
 * rather than a claim you take on faith. The Tracker can also record a frame per
 * operation, which is what drives the step-by-step grid animation in the UI.
 *
 * Two correctness details the sieves get subtly right, and a naive version gets
 * wrong:
 *
 *   - Start crossing at p², not 2p. Every smaller multiple of p (2p, 3p, …,
 *     (p−1)p) already carries a smaller prime factor and was crossed when that
 *     factor's turn came. Starting at p² is why the total cross-out count is
 *     n log log n and not n log n.
 *   - Only sieve p up to √n. Once p > √n, p² > n, so there is nothing left in
 *     range to cross — a number ≤ n with no prime factor ≤ √n is itself prime.
 *
 * The module is UMD-ish: it works with Node's require() and as a browser global
 * (window.SieveCore). No dependencies, no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.SieveCore = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Tracker — shared instrumentation every algorithm runs through.
  // ---------------------------------------------------------------------------
  // ops                 -> total counted operations (cross-outs, or division
  //                        tests for trial division). This is the apples-to-
  //                        apples "work" number the race table compares.
  // cross(k, by)        -> record that k is being marked composite (a multiple
  //                        of the prime `by`). Counts one op; if recording, push
  //                        a "cross" frame. Returns nothing.
  // test()              -> count one division test (trial division only).
  // note(frame)         -> push a non-op frame (e.g. "prime found").
  // Frames are only accumulated when `record` is true, so the racing/counting
  // path stays fast on large n while the visualiser can replay a small one.
  function makeTracker(record) {
    var t = { ops: 0, frames: record ? [] : null, record: !!record };

    t.cross = function (k, by) {
      t.ops++;
      if (t.record) { t.frames.push({ type: "cross", k: k, by: by }); }
    };

    t.test = function () { t.ops++; };

    t.note = function (frame) {
      if (t.record) { t.frames.push(frame); }
    };

    t.prime = function (p) {
      if (t.record) { t.frames.push({ type: "prime", p: p }); }
    };

    return t;
  }

  // ---------------------------------------------------------------------------
  // Trial division — the O(n·√n) baseline and the tests' oracle.
  // ---------------------------------------------------------------------------
  // For each k from 2..n, try dividing by every candidate factor from 2 up to
  // √k. The first that divides proves k composite; none dividing proves k prime.
  // Obviously correct, which is exactly why the property tests lean on it.
  function trialOn(n, t) {
    var primes = [];
    for (var k = 2; k <= n; k++) {
      var isPrime = true;
      for (var d = 2; d * d <= k; d++) {
        t.test();
        if (k % d === 0) { isPrime = false; break; }
      }
      if (isPrime) { primes.push(k); t.prime(k); }
    }
    return primes;
  }

  // ---------------------------------------------------------------------------
  // Sieve of Eratosthenes — O(n log log n). The star of the show.
  // ---------------------------------------------------------------------------
  // `composite[k]` starts all-false. Walk k = 2..n. The first time we reach a k
  // still marked prime, it *is* prime (nothing ≤ it crossed it out); record it
  // and cross out k², k²+k, … Every composite ≤ n is some prime's multiple, so
  // it gets crossed; every prime is never crossed, so it survives.
  function sieveOn(n, t) {
    if (n < 2) { return []; }
    var composite = new Uint8Array(n + 1); // 0 = still prime, 1 = crossed out
    var primes = [];
    for (var p = 2; p <= n; p++) {
      if (composite[p]) { continue; }
      primes.push(p);
      t.prime(p);
      // Only p ≤ √n has any multiple ≤ n beyond itself; p² would overflow past
      // n otherwise. Cap the *starting* multiple check with p*p <= n.
      if (p * p <= n) {
        for (var m = p * p; m <= n; m += p) {
          composite[m] = 1;
          t.cross(m, p);
        }
      }
    }
    return primes;
  }

  // ---------------------------------------------------------------------------
  // Euler's linear sieve — O(n). Each composite crossed exactly once.
  // ---------------------------------------------------------------------------
  // The trick: cross out k·p only for primes p ≤ spf(k) (the smallest prime
  // factor of k), and *stop the inner loop the instant p divides k*. That makes
  // every composite c get crossed exactly once — namely as (c / spf(c))·spf(c) —
  // so the total cross-out count equals the number of composites ≤ n, and the
  // run is genuinely linear. It also yields spf[] (smallest prime factor) for
  // free, a table worth having in its own right.
  function linearOn(n, t) {
    if (n < 2) { return { primes: [], spf: new Int32Array(Math.max(0, n + 1)) }; }
    var spf = new Int32Array(n + 1); // 0 = prime (no smaller factor yet)
    var primes = [];
    for (var i = 2; i <= n; i++) {
      if (spf[i] === 0) { spf[i] = i; primes.push(i); t.prime(i); }
      for (var j = 0; j < primes.length; j++) {
        var p = primes[j];
        if (p > spf[i] || i * p > n) { break; }
        spf[i * p] = p;      // p is the smallest prime factor of i*p
        t.cross(i * p, p);
        // (the `p > spf[i]` guard above is the "stop once p divides i" rule:
        //  spf[i] is the smallest prime factor of i, so p == spf[i] is the last
        //  p we allow, and the next iteration's p > spf[i] breaks.)
      }
    }
    primes.sort(function (a, b) { return a - b; });
    return { primes: primes, spf: spf };
  }

  // ---------------------------------------------------------------------------
  // Segmented sieve — same answer, O(√n) memory.
  // ---------------------------------------------------------------------------
  // First sieve the base primes up to √n the ordinary way. Then sweep [2, n] in
  // fixed-size segments, and for each base prime cross out its multiples that
  // fall inside the current window. Only one segment-sized boolean array and the
  // base primes live in memory at once — how you'd sieve up to 10¹² without a
  // 10¹²-entry array. The cross-out pattern (and count) matches the plain sieve.
  function segmentedOn(n, t, segSize) {
    segSize = segSize || Math.max(1, Math.floor(Math.sqrt(n)) + 1);
    var primes = [];
    if (n < 2) { return primes; }

    // Base primes up to √n, via a small plain sieve. These crossings are part of
    // the same total work, so they run through the tracker too.
    var limit = Math.floor(Math.sqrt(n));
    var baseComposite = new Uint8Array(limit + 1);
    var basePrimes = [];
    for (var p = 2; p <= limit; p++) {
      if (baseComposite[p]) { continue; }
      basePrimes.push(p);
      primes.push(p);
      t.prime(p);
      if (p * p <= limit) {
        for (var m = p * p; m <= limit; m += p) { baseComposite[m] = 1; t.cross(m, p); }
      }
    }

    // Sweep the rest of [2, n] one window at a time. Start past √n: the base
    // primes are already recorded and their multiples inside [2, √n] were the
    // crossings above.
    var lo = limit + 1;
    if (lo < 2) { lo = 2; }
    var seg = new Uint8Array(segSize);
    for (var low = lo; low <= n; low += segSize) {
      var high = Math.min(low + segSize - 1, n);
      seg.fill(0);
      for (var b = 0; b < basePrimes.length; b++) {
        var q = basePrimes[b];
        // First multiple of q that is ≥ low and ≥ q² (smaller multiples already
        // carry a smaller factor — the same "start at p²" rule, per segment).
        var start = Math.max(q * q, Math.ceil(low / q) * q);
        for (var k = start; k <= high; k += q) {
          seg[k - low] = 1;
          t.cross(k, q);
        }
      }
      for (var i = low; i <= high; i++) {
        if (!seg[i - low]) { primes.push(i); t.prime(i); }
      }
    }
    return primes;
  }

  // ---------------------------------------------------------------------------
  // A uniform runner + a race.
  // ---------------------------------------------------------------------------
  function runWith(fn, n, opts) {
    opts = opts || {};
    var t = makeTracker(!!opts.record);
    var t0 = now();
    var out = fn(n, t, opts.segSize);
    var t1 = now();
    var primes = Array.isArray(out) ? out : out.primes;
    return {
      primes: primes,
      count: primes.length,
      ops: t.ops,
      frames: t.frames,
      ms: t1 - t0,
      n: n,
      spf: (out && out.spf) || null
    };
  }

  function now() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  var ALGORITHMS = {
    trial:     { name: "Trial division",  complexity: "O(n·√n / ln n)", unit: "division tests" },
    sieve:     { name: "Sieve of Eratosthenes", complexity: "O(n log log n)", unit: "cross-outs" },
    linear:    { name: "Linear (Euler) sieve",  complexity: "O(n)", unit: "cross-outs" },
    segmented: { name: "Segmented sieve",       complexity: "O(n log log n), O(√n) memory", unit: "cross-outs" }
  };

  function trial(n, opts)     { return runWith(trialOn, n, opts); }
  function sieve(n, opts)     { return runWith(sieveOn, n, opts); }
  function linear(n, opts)    { return runWith(linearOn, n, opts); }
  function segmented(n, opts) { return runWith(segmentedOn, n, opts); }

  function run(key, n, opts) {
    switch (key) {
      case "trial":     return trial(n, opts);
      case "sieve":     return sieve(n, opts);
      case "linear":    return linear(n, opts);
      case "segmented": return segmented(n, opts);
      default: throw new Error("unknown algorithm: " + key);
    }
  }

  // Race every algorithm on the same n. `agree` reports whether they all return
  // the identical list of primes — the operation counts differ (that's the whole
  // point), but the *answer* must be byte-for-byte the same.
  function race(n, opts) {
    var results = {};
    var keys = ["trial", "sieve", "linear", "segmented"];
    for (var i = 0; i < keys.length; i++) { results[keys[i]] = run(keys[i], n, opts); }
    var ref = results.sieve.primes;
    var agree = true;
    for (var k = 0; k < keys.length; k++) {
      if (!sameList(results[keys[k]].primes, ref)) { agree = false; break; }
    }
    return { results: results, agree: agree, n: n };
  }

  function sameList(a, b) {
    if (a.length !== b.length) { return false; }
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
    return true;
  }

  // ---------------------------------------------------------------------------
  // A couple of small number-theory helpers the UI shows off.
  // ---------------------------------------------------------------------------
  // π(n): the number of primes ≤ n (just the sieve's count, named for what it is).
  function primeCount(n) { return sieve(n).count; }

  // Prime factorisation via a linear-sieve spf table — repeated division by the
  // smallest prime factor, O(log k) per number. Used by the UI's "factor" box.
  function factorize(k, spf) {
    if (k < 2) { return []; }
    var factors = [];
    while (k > 1) {
      var p = spf[k];
      var e = 0;
      while (k % p === 0) { k = k / p; e++; }
      factors.push({ prime: p, power: e });
    }
    return factors;
  }

  return {
    ALGORITHMS: ALGORITHMS,
    trial: trial,
    sieve: sieve,
    linear: linear,
    segmented: segmented,
    run: run,
    race: race,
    primeCount: primeCount,
    factorize: factorize,
    sameList: sameList,
    // exposed for targeted testing
    _makeTracker: makeTracker
  };
});
