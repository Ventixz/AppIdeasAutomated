/*
 * closest-pair-core.js — the closest pair of points, two ways.
 *
 * A Source 2 (karan/Projects) "Classic Algorithms" project. The karan spec
 * reads:
 *
 *   "Closest Pair Problem — the closest pair of points problem is a problem of
 *    computational geometry: given n points in a metric space, find a pair of
 *    points with the smallest distance between them."
 *
 * Two algorithms solve it here, and the whole point of pairing them is the
 * contrast:
 *
 *   - brute(points)   — check every one of the n(n−1)/2 pairs. Dead simple,
 *                       obviously correct, and O(n²).
 *   - divide(points)  — the classic divide-and-conquer that presorts the points
 *                       and, at each merge, only has to check a thin vertical
 *                       strip around the split line — where a geometric fact
 *                       (see below) caps the work at a handful of neighbours per
 *                       point. O(n log n).
 *
 * As in this project's sibling builds, the *work* is instrumented, not just the
 * answer. Both algorithms route every point-to-point distance through a single
 * Tracker that counts "distance evaluations", so the O(n²) vs. O(n log n) gap
 * is a number you can read off rather than a claim you have to take on faith.
 * The Tracker can also record a frame per operation, which is what drives the
 * step-by-step canvas animation in the browser UI.
 *
 * The module is UMD-ish: it works with Node's require() and as a browser global
 * (window.ClosestPairCore). No dependencies, no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.ClosestPairCore = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Points and distance.
  // ---------------------------------------------------------------------------
  // A point is { x, y, id }. `id` is the point's index in the caller's original
  // array, carried through every sort and split so a result can always name the
  // two original points — never the shuffled working copies.
  function toPoints(input) {
    return input.map(function (p, i) {
      if (Array.isArray(p)) { return { x: +p[0], y: +p[1], id: i }; }
      return { x: +p.x, y: +p.y, id: i };
    });
  }

  // Squared Euclidean distance. Everything internal compares *squared*
  // distances: it avoids a sqrt per comparison and, more importantly, keeps the
  // comparisons exact for integer coordinates (no float rounding decides ties).
  function dist2(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
  function dist(a, b) { return Math.sqrt(dist2(a, b)); }

  // ---------------------------------------------------------------------------
  // Tracker — shared instrumentation both algorithms run through.
  // ---------------------------------------------------------------------------
  // evals               -> number of point-to-point distance evaluations.
  // measure(a, b)       -> dist2(a,b), counting one evaluation and (if
  //                        recording) pushing a "compare" frame.
  // note(frame)         -> push a non-distance frame (divide line, strip, best…).
  // Frames are only accumulated when `record` is true, so the racing/counting
  // path stays fast on large inputs while the visualiser can replay a small one.
  function makeTracker(record) {
    var t = { evals: 0, frames: record ? [] : null, record: !!record, bestSoFar: Infinity };

    t.measure = function (a, b) {
      t.evals++;
      if (t.record) { t.frames.push({ type: "compare", i: a.id, j: b.id }); }
      return dist2(a, b);
    };

    t.note = function (frame) {
      if (t.record) { t.frames.push(frame); }
    };

    // Record a "best" frame only when the pair improves on the smallest
    // distance seen *anywhere* so far. Divide-and-conquer finds a local best in
    // each subproblem, but the animation wants one global best-so-far marker
    // that only ever tightens — so the frames stay monotonic across branches.
    t.recordBest = function (p) {
      if (p.dist < t.bestSoFar) {
        t.bestSoFar = p.dist;
        if (t.record) { t.frames.push({ type: "best", i: p.i, j: p.j, dist: p.dist }); }
      }
    };

    return t;
  }

  // A "pair" result. `d2` is the squared distance (exact, used for comparisons);
  // `dist` is the real Euclidean distance (for display). i/j are original ids.
  function pair(a, b, d2) {
    return { a: a, b: b, i: a.id, j: b.id, d2: d2, dist: Math.sqrt(d2) };
  }
  var NO_PAIR = { a: null, b: null, i: -1, j: -1, d2: Infinity, dist: Infinity };

  function better(p, q) { return p.d2 <= q.d2 ? p : q; }

  // ---------------------------------------------------------------------------
  // Brute force — O(n²). Check every unordered pair, keep the smallest.
  // ---------------------------------------------------------------------------
  function bruteOn(pts, t) {
    var best = NO_PAIR;
    for (var i = 0; i < pts.length; i++) {
      for (var j = i + 1; j < pts.length; j++) {
        var d2 = t.measure(pts[i], pts[j]);
        if (d2 < best.d2) {
          best = pair(pts[i], pts[j], d2);
          t.recordBest(best);
        }
      }
    }
    return best;
  }

  function brute(input, opts) { return runWith(bruteOn, input, opts); }

  // ---------------------------------------------------------------------------
  // Divide and conquer — O(n log n).
  // ---------------------------------------------------------------------------
  // Presort once by x (Px) and once by y (Py). Split Px at the median into a
  // left and right half; recurse on each; let d be the smaller of the two
  // returned distances. The only pairs left to consider are those straddling the
  // split line, and both must lie within d of it — a vertical *strip*. Sorted by
  // y, each point in the strip can be beaten only by points within d in y, and a
  // geometric packing argument shows at most a constant number (≤ 7) of later
  // strip points can be that close. So the merge is linear, and the recurrence
  // T(n) = 2T(n/2) + O(n) gives O(n log n).
  function divideOn(pts, t) {
    if (pts.length < 2) { return NO_PAIR; }
    var Px = pts.slice().sort(cmpX);
    var Py = pts.slice().sort(cmpY);
    return recurse(Px, Py, t);
  }

  function recurse(Px, Py, t) {
    var n = Px.length;

    // Base case: 2 or 3 points — brute force is cheaper than more splitting.
    if (n <= 3) {
      t.note({ type: "base", x0: minX(Px), x1: maxX(Px) });
      return bruteOn(Px, t);
    }

    var mid = n >> 1;
    var midPoint = Px[mid];
    t.note({ type: "divide", midX: midPoint.x, x0: minX(Px), x1: maxX(Px) });

    // Split Px at the median. Partition Py into the same two halves *while
    // preserving y-order*, using the exact comparator Px was sorted by so the
    // boundary is unambiguous even when several points share an x.
    var Qx = Px.slice(0, mid), Rx = Px.slice(mid);
    var Qy = [], Ry = [];
    for (var k = 0; k < Py.length; k++) {
      if (cmpX(Py[k], midPoint) < 0) { Qy.push(Py[k]); }
      else { Ry.push(Py[k]); }
    }

    var best = better(recurse(Qx, Qy, t), recurse(Rx, Ry, t));

    // The strip: points within `best.dist` of the split line, in y-order.
    var d = best.dist;
    var strip = [];
    for (var m = 0; m < Py.length; m++) {
      if (Math.abs(Py[m].x - midPoint.x) < d) { strip.push(Py[m]); }
    }
    t.note({ type: "strip", midX: midPoint.x, halfWidth: d, x0: minX(Px), x1: maxX(Px) });

    // For each strip point, only later points within d in y can beat `best`.
    // The inner loop breaks the instant the y-gap reaches d, so it runs a
    // bounded number of times per point — this is the linear-merge crux.
    for (var i = 0; i < strip.length; i++) {
      for (var j = i + 1; j < strip.length && (strip[j].y - strip[i].y) < best.dist; j++) {
        var d2 = t.measure(strip[i], strip[j]);
        if (d2 < best.d2) {
          best = pair(strip[i], strip[j], d2);
          t.recordBest(best);
        }
      }
    }
    return best;
  }

  // Comparators give a *total* order (ties broken by the other coordinate then
  // id), so the median split and the Py partition are always well-defined.
  function cmpX(a, b) { return (a.x - b.x) || (a.y - b.y) || (a.id - b.id); }
  function cmpY(a, b) { return (a.y - b.y) || (a.x - b.x) || (a.id - b.id); }

  function minX(a) { var m = Infinity; for (var i = 0; i < a.length; i++) { if (a[i].x < m) { m = a[i].x; } } return m; }
  function maxX(a) { var m = -Infinity; for (var i = 0; i < a.length; i++) { if (a[i].x > m) { m = a[i].x; } } return m; }

  function divide(input, opts) { return runWith(divideOn, input, opts); }

  // ---------------------------------------------------------------------------
  // A uniform runner + a race.
  // ---------------------------------------------------------------------------
  function runWith(fn, input, opts) {
    opts = opts || {};
    var pts = toPoints(input);
    var t = makeTracker(!!opts.record);
    var t0 = now();
    var res = fn(pts, t);
    var t1 = now();
    return {
      i: res.i, j: res.j,
      a: res.a, b: res.b,
      dist: res.dist, d2: res.d2,
      evals: t.evals,
      frames: t.frames,
      ms: t1 - t0,
      n: pts.length
    };
  }

  function now() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  var ALGORITHMS = {
    brute:  { name: "Brute force",         complexity: "O(n²)" },
    divide: { name: "Divide and conquer",  complexity: "O(n log n)" }
  };

  function run(key, input, opts) {
    if (key === "brute") { return brute(input, opts); }
    if (key === "divide") { return divide(input, opts); }
    throw new Error("unknown algorithm: " + key);
  }

  // Race both on the same input. `equalPair` reports whether they agree on the
  // *distance* — the pair of ids may legitimately differ when several pairs tie
  // for closest, so distance, not identity, is the thing that must match.
  function race(input, opts) {
    var b = brute(input, opts);
    var d = divide(input, opts);
    return {
      brute: b,
      divide: d,
      equalDist: almostEqual(b.dist, d.dist),
      speedup: d.evals > 0 ? b.evals / d.evals : Infinity
    };
  }

  // Floats only ever enter via sqrt for display; comparisons stay on the exact
  // squared integers. This tolerant compare is for cross-checking the two
  // reported Euclidean distances.
  function almostEqual(a, b) {
    if (a === b) { return true; }
    var diff = Math.abs(a - b);
    return diff <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }

  // ---------------------------------------------------------------------------
  // Point generators (used by the UI and the tests).
  // ---------------------------------------------------------------------------
  // All coordinates are integers in [0, w) × [0, h) so distance comparisons stay
  // exact. `rng` lets tests pass a seeded generator for reproducibility.
  function makePoints(kind, n, opts) {
    opts = opts || {};
    var w = opts.w || 1000, h = opts.h || 1000;
    var rng = opts.rng || Math.random;
    var pts = [], i;
    switch (kind) {
      case "uniform":
        for (i = 0; i < n; i++) { pts.push({ x: irand(rng, w), y: irand(rng, h) }); }
        break;
      case "clustered": {
        var clusters = Math.max(1, Math.round(Math.sqrt(n) / 2));
        var centers = [];
        for (i = 0; i < clusters; i++) { centers.push({ x: irand(rng, w), y: irand(rng, h) }); }
        for (i = 0; i < n; i++) {
          var c = centers[i % clusters];
          pts.push({
            x: clamp(Math.round(c.x + (rng() - 0.5) * w * 0.08), 0, w - 1),
            y: clamp(Math.round(c.y + (rng() - 0.5) * h * 0.08), 0, h - 1)
          });
        }
        break;
      }
      case "grid": {
        // A regular lattice: the closest distance is exactly the cell spacing,
        // and every adjacent pair ties for it — a good stress test for ties.
        var side = Math.max(1, Math.floor(Math.sqrt(n)));
        var step = Math.floor(Math.min(w, h) / (side + 1));
        for (var r = 0; r < side && pts.length < n; r++) {
          for (var col = 0; col < side && pts.length < n; col++) {
            pts.push({ x: (col + 1) * step, y: (r + 1) * step });
          }
        }
        break;
      }
      case "circle": {
        // Points on a circle: no two coincide, distances vary smoothly.
        var cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.42;
        for (i = 0; i < n; i++) {
          var ang = (2 * Math.PI * i) / n;
          pts.push({ x: Math.round(cx + rad * Math.cos(ang)), y: Math.round(cy + rad * Math.sin(ang)) });
        }
        break;
      }
      default:
        throw new Error("unknown point kind: " + kind);
    }
    return pts;
  }

  function irand(rng, max) { return Math.floor(rng() * max); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // A tiny seeded PRNG (mulberry32) so tests are deterministic.
  function seeded(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    toPoints: toPoints,
    dist: dist,
    dist2: dist2,
    ALGORITHMS: ALGORITHMS,
    brute: brute,
    divide: divide,
    run: run,
    race: race,
    almostEqual: almostEqual,
    makePoints: makePoints,
    seeded: seeded,
    // exposed for targeted testing
    _cmpX: cmpX,
    _cmpY: cmpY,
    _makeTracker: makeTracker
  };
});
