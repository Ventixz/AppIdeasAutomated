/*
 * sort-core.js — six sorting algorithms, each fully instrumented.
 *
 * A Source 2 (karan/Projects) "Classic Algorithms" project. The karan spec
 * asks for "two types of sorting algorithms: Merge sort, Bubble sort, and
 * Quicksort." This module implements all three, plus Insertion, Selection and
 * Heap sort, so the same input can be raced across the whole family.
 *
 * The point of the exercise is not just to *sort* — the language ships
 * Array.prototype.sort for that — but to make the *work* visible and countable.
 * So every algorithm runs through a single small Tracker that:
 *
 *   - counts every element-to-element COMPARISON,
 *   - counts every array WRITE (a swap is two writes),
 *   - and, on request, records a frame per operation so a UI can replay the
 *     sort step by step.
 *
 * Because every algorithm shares the same instrumented primitives, the
 * comparison and write counts are directly comparable — that is what makes the
 * classic O(n²) vs. O(n log n) gap something you can *see* rather than recite.
 *
 * The module is UMD-ish: it works with Node's require() and as a browser global
 * (window.SortCore). No dependencies, no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.SortCore = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The default comparator: numeric if both look numeric, else string order.
  // Returns <0, 0, >0 like Array.prototype.sort expects.
  function defaultCmp(a, b) {
    if (typeof a === "number" && typeof b === "number") { return a - b; }
    var sa = String(a), sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  // ---------------------------------------------------------------------------
  // Tracker — the shared instrumentation every algorithm runs through.
  // ---------------------------------------------------------------------------
  // compare(arr, i, j)  -> the sign of cmp(arr[i], arr[j]); counts one compare.
  // cmpVal(a, b)        -> compare two loose values (used by merge's scratch);
  //                        counts one compare but records nothing about indices.
  // set(arr, i, v)      -> arr[i] = v; counts one write, records a "set" frame.
  // swap(arr, i, j)     -> exchange; counts two writes, records a "swap" frame.
  //
  // Frames are only accumulated when `record` is true, so the racing mode stays
  // fast on large inputs while the single-algorithm visualiser can replay.
  function makeTracker(record) {
    var t = {
      comparisons: 0,
      writes: 0,
      reads: 0,
      frames: record ? [] : null,
      record: !!record
    };

    t.compare = function (arr, i, j) {
      t.comparisons++;
      t.reads += 2;
      if (t.record) { t.frames.push({ type: "compare", i: i, j: j }); }
      return defaultCmp(arr[i], arr[j]);
    };

    // Compare two explicit values (for merge, which reads from a scratch copy).
    t.cmpVal = function (a, b, i, j) {
      t.comparisons++;
      t.reads += 2;
      if (t.record) { t.frames.push({ type: "compare", i: i, j: j }); }
      return defaultCmp(a, b);
    };

    t.set = function (arr, i, v) {
      t.writes++;
      arr[i] = v;
      if (t.record) { t.frames.push({ type: "set", index: i, value: v }); }
    };

    t.swap = function (arr, i, j) {
      t.writes += 2;
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      if (t.record) { t.frames.push({ type: "swap", i: i, j: j }); }
    };

    // A cosmetic frame: highlight a settled/pivot index without touching data.
    t.mark = function (kind, index) {
      if (t.record) { t.frames.push({ type: "mark", kind: kind, index: index }); }
    };

    return t;
  }

  // ---------------------------------------------------------------------------
  // The algorithms. Each takes (arr, tracker) and sorts `arr` in place.
  // `arr` is assumed to be a private working copy owned by run() below.
  // ---------------------------------------------------------------------------

  // Bubble sort — repeatedly walk the array swapping adjacent out-of-order
  // pairs. The early-exit flag makes an already-sorted array cost one pass.
  function bubbleSort(arr, t) {
    var n = arr.length;
    for (var end = n - 1; end > 0; end--) {
      var swapped = false;
      for (var i = 0; i < end; i++) {
        if (t.compare(arr, i, i + 1) > 0) { t.swap(arr, i, i + 1); swapped = true; }
      }
      t.mark("sorted", end);
      if (!swapped) { break; } // no swaps in a full pass ⇒ done
    }
    t.mark("sorted", 0);
  }

  // Insertion sort — grow a sorted prefix, sliding each new element back into
  // place. Fast on nearly-sorted data; the inner loop stops early.
  function insertionSort(arr, t) {
    var n = arr.length;
    for (var i = 1; i < n; i++) {
      var key = arr[i];
      t.reads++;
      var j = i - 1;
      // Slide larger elements one slot right until key's home is found.
      while (j >= 0 && defaultCmpCounted(t, arr[j], key, j, i) > 0) {
        t.set(arr, j + 1, arr[j]);
        j--;
      }
      t.set(arr, j + 1, key);
    }
  }

  // A small helper so insertion sort can compare a stored key against arr[j]
  // while still routing the comparison through the tracker's counters.
  function defaultCmpCounted(t, a, b, i, j) {
    return t.cmpVal(a, b, i, j);
  }

  // Selection sort — each pass finds the minimum of the unsorted tail and puts
  // it in place. Exactly n−1 swaps, whatever the input.
  function selectionSort(arr, t) {
    var n = arr.length;
    for (var i = 0; i < n - 1; i++) {
      var min = i;
      for (var j = i + 1; j < n; j++) {
        if (t.compare(arr, j, min) < 0) { min = j; }
      }
      if (min !== i) { t.swap(arr, i, min); }
      t.mark("sorted", i);
    }
    t.mark("sorted", n - 1);
  }

  // Merge sort — bottom-up so it's iterative (no recursion depth worries).
  // Merges runs of width 1, 2, 4, … using a scratch buffer, writing each merged
  // element back into the array so the "set" frames animate the merge.
  function mergeSort(arr, t) {
    var n = arr.length;
    var buf = new Array(n);
    for (var width = 1; width < n; width *= 2) {
      for (var lo = 0; lo < n; lo += 2 * width) {
        var mid = Math.min(lo + width, n);
        var hi = Math.min(lo + 2 * width, n);
        merge(arr, buf, lo, mid, hi, t);
      }
    }
  }

  function merge(arr, buf, lo, mid, hi, t) {
    // Copy the two runs into scratch, then merge back into arr[lo..hi).
    for (var k = lo; k < hi; k++) { buf[k] = arr[k]; t.reads++; }
    var i = lo, j = mid, out = lo;
    while (i < mid && j < hi) {
      // Stable: take the left run when values tie (<= via not-greater).
      if (t.cmpVal(buf[i], buf[j], i, j) <= 0) { t.set(arr, out++, buf[i++]); }
      else { t.set(arr, out++, buf[j++]); }
    }
    while (i < mid) { t.set(arr, out++, buf[i++]); }
    while (j < hi) { t.set(arr, out++, buf[j++]); }
  }

  // Quicksort — Hoare-style partition around a median-of-three pivot, with an
  // explicit stack (no recursion) and always recursing into the smaller side
  // first so the stack depth stays O(log n) even on adversarial input.
  function quickSort(arr, t) {
    var n = arr.length;
    if (n < 2) { return; }
    var stack = [[0, n - 1]];
    while (stack.length) {
      var range = stack.pop();
      var lo = range[0], hi = range[1];
      while (lo < hi) {
        var p = partition(arr, lo, hi, t);
        // Push the larger sub-range, loop on the smaller — bounds the stack.
        if (p - lo < hi - p) {
          if (p - 1 > lo) { stack.push([lo, p - 1]); } // (order for animation)
          lo = p + 1;
        } else {
          if (p + 1 < hi) { stack.push([p + 1, hi]); }
          hi = p - 1;
        }
      }
    }
  }

  // Lomuto-ish partition with median-of-three pivot selection, which dodges the
  // classic O(n²) blow-up on already-sorted and organ-pipe inputs.
  function partition(arr, lo, hi, t) {
    var mid = lo + ((hi - lo) >> 1);
    // Order lo, mid, hi so the median lands at hi-1 as the pivot.
    if (t.compare(arr, mid, lo) < 0) { t.swap(arr, mid, lo); }
    if (t.compare(arr, hi, lo) < 0) { t.swap(arr, hi, lo); }
    if (t.compare(arr, hi, mid) < 0) { t.swap(arr, hi, mid); }
    t.swap(arr, mid, hi - 1 >= lo ? hi - 1 : hi);
    var pivotIdx = hi - 1 >= lo ? hi - 1 : hi;
    t.mark("pivot", pivotIdx);
    var i = lo;
    for (var j = lo; j < pivotIdx; j++) {
      if (t.compare(arr, j, pivotIdx) < 0) { t.swap(arr, i, j); i++; }
    }
    t.swap(arr, i, pivotIdx);
    return i;
  }

  // Heap sort — build a max-heap in place, then repeatedly swap the root to the
  // end and sift down. O(n log n) worst case, O(1) extra space.
  function heapSort(arr, t) {
    var n = arr.length;
    for (var start = (n >> 1) - 1; start >= 0; start--) { siftDown(arr, start, n, t); }
    for (var end = n - 1; end > 0; end--) {
      t.swap(arr, 0, end);
      t.mark("sorted", end);
      siftDown(arr, 0, end, t);
    }
    t.mark("sorted", 0);
  }

  function siftDown(arr, root, n, t) {
    while (true) {
      var child = 2 * root + 1;
      if (child >= n) { break; }
      if (child + 1 < n && t.compare(arr, child + 1, child) > 0) { child++; }
      if (t.compare(arr, child, root) > 0) { t.swap(arr, root, child); root = child; }
      else { break; }
    }
  }

  // ---------------------------------------------------------------------------
  // Registry + a uniform runner.
  // ---------------------------------------------------------------------------
  var ALGORITHMS = {
    bubble:    { name: "Bubble sort",    fn: bubbleSort,    stable: true,  best: "O(n)",       avg: "O(n²)",       worst: "O(n²)",       space: "O(1)" },
    insertion: { name: "Insertion sort", fn: insertionSort, stable: true,  best: "O(n)",       avg: "O(n²)",       worst: "O(n²)",       space: "O(1)" },
    selection: { name: "Selection sort", fn: selectionSort, stable: false, best: "O(n²)",      avg: "O(n²)",       worst: "O(n²)",       space: "O(1)" },
    merge:     { name: "Merge sort",     fn: mergeSort,     stable: true,  best: "O(n log n)", avg: "O(n log n)",  worst: "O(n log n)",  space: "O(n)" },
    quick:     { name: "Quicksort",      fn: quickSort,     stable: false, best: "O(n log n)", avg: "O(n log n)",  worst: "O(n²)",       space: "O(log n)" },
    heap:      { name: "Heap sort",      fn: heapSort,      stable: false, best: "O(n log n)", avg: "O(n log n)",  worst: "O(n log n)",  space: "O(1)" }
  };

  // Run one algorithm on a *copy* of `input`, returning a rich result. The
  // original array is never mutated. `record` toggles frame capture.
  function run(key, input, opts) {
    opts = opts || {};
    var meta = ALGORITHMS[key];
    if (!meta) { throw new Error("unknown algorithm: " + key); }
    var arr = input.slice();
    var t = makeTracker(!!opts.record);
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    meta.fn(arr, t);
    var t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    return {
      key: key,
      name: meta.name,
      sorted: arr,
      comparisons: t.comparisons,
      writes: t.writes,
      reads: t.reads,
      frames: t.frames,
      ms: t1 - t0,
      correct: isSorted(arr) && isPermutation(input, arr)
    };
  }

  // Run every algorithm on the same input and return results keyed by name,
  // plus a leaderboard sorted by comparison count (the fairest cross-metric).
  function race(input, opts) {
    var results = {};
    var order = Object.keys(ALGORITHMS);
    for (var i = 0; i < order.length; i++) {
      results[order[i]] = run(order[i], input, opts);
    }
    var board = order.slice().sort(function (a, b) {
      return results[a].comparisons - results[b].comparisons;
    });
    return { results: results, leaderboard: board };
  }

  // --- verification helpers -------------------------------------------------
  function isSorted(arr, cmp) {
    cmp = cmp || defaultCmp;
    for (var i = 1; i < arr.length; i++) {
      if (cmp(arr[i - 1], arr[i]) > 0) { return false; }
    }
    return true;
  }

  // True iff `b` is a rearrangement of `a` (same multiset of values). This is
  // what proves a sort didn't drop, duplicate or invent an element.
  function isPermutation(a, b) {
    if (a.length !== b.length) { return false; }
    var counts = Object.create(null);
    for (var i = 0; i < a.length; i++) {
      var k = typeof a[i] + ":" + a[i];
      counts[k] = (counts[k] || 0) + 1;
    }
    for (var j = 0; j < b.length; j++) {
      var kb = typeof b[j] + ":" + b[j];
      if (!counts[kb]) { return false; }
      counts[kb]--;
    }
    return true;
  }

  // --- input generators (used by the UI and the tests) ---------------------
  function makeArray(kind, n) {
    var a = new Array(n), i;
    switch (kind) {
      case "random":
        for (i = 0; i < n; i++) { a[i] = Math.floor(Math.random() * (n * 3)) + 1; }
        break;
      case "sorted":
        for (i = 0; i < n; i++) { a[i] = i + 1; }
        break;
      case "reversed":
        for (i = 0; i < n; i++) { a[i] = n - i; }
        break;
      case "nearly":
        for (i = 0; i < n; i++) { a[i] = i + 1; }
        // Perturb ~5% of positions by a small local swap.
        for (i = 0; i < Math.max(1, Math.round(n * 0.05)); i++) {
          var x = Math.floor(Math.random() * (n - 1));
          var tmp = a[x]; a[x] = a[x + 1]; a[x + 1] = tmp;
        }
        break;
      case "fewunique":
        for (i = 0; i < n; i++) { a[i] = Math.floor(Math.random() * 5) + 1; }
        break;
      default:
        throw new Error("unknown array kind: " + kind);
    }
    return a;
  }

  return {
    defaultCmp: defaultCmp,
    ALGORITHMS: ALGORITHMS,
    run: run,
    race: race,
    isSorted: isSorted,
    isPermutation: isPermutation,
    makeArray: makeArray,
    // exposed for targeted testing
    _bubbleSort: bubbleSort,
    _quickSort: quickSort,
    _mergeSort: mergeSort,
    _makeTracker: makeTracker
  };
});
