# Sorting

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**second entry of its Classic Algorithms category**, and the twenty-fourth
Source 2 project overall. It follows the
[Collatz Conjecture](../collatz-conjecture/), the category's first project.

> "Sorting — Implement two types of sorting algorithms: Merge sort, Bubble
> sort, and Quicksort."

This build implements **all three the spec names, plus three more** — Insertion,
Selection and Heap sort — so the same array can be raced across the whole
classic family. Open `index.html` in a browser. **No build step, no server, no
dependencies, and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

- **Animate one sort, step by step.** Pick an algorithm and watch it run over a
  bar chart of the array: bars turn **amber** when compared, **green** when
  written, **purple** when chosen as a quicksort pivot, and **blue** once
  settled into place. Play continuously, single-step, or drag the speed slider.
- **Race all six on one array.** A leaderboard sorts them by comparison count
  (fewest first) and shows writes and wall-clock time beside each. On 2,000
  random values the O(n log n) sorts do ~22,000 comparisons where the O(n²)
  sorts do ~2 million — a gap you can read off the table.
- **Five input shapes.** Random, nearly-sorted, reversed, already-sorted, and
  few-unique-values — so you can see, for instance, that **insertion sort is
  linear on nearly-sorted data** and that **quicksort doesn't blow up** on a
  sorted or reversed array.

## The interesting part: make the *work* visible, not just the result

The language already ships `Array.prototype.sort`. The point of the exercise is
to count and *watch* the work each algorithm does. So every algorithm runs
through a single small **Tracker** that owns the array's primitive operations:

```js
// projects/phase2-classic-algorithms/sorting/sort-core.js
t.compare = function (arr, i, j) { t.comparisons++; /* record a frame */ return defaultCmp(arr[i], arr[j]); };
t.swap    = function (arr, i, j) { t.writes += 2;   /* record a frame */ /* exchange */ };
t.set     = function (arr, i, v) { t.writes++;      /* record a frame */ arr[i] = v; };
```

Because **all six sorts share the same instrumented primitives**, their
comparison and write counts are directly comparable — that is what turns the
textbook "O(n²) vs. O(n log n)" claim into something measured rather than
recited. And because the tracker can *record a frame per operation*, the exact
same run that produced the counts also drives the animation: the UI just replays
the frames.

## The six algorithms

| Algorithm | Best | Average | Worst | Space | Stable? |
| --- | --- | --- | --- | --- | --- |
| Bubble sort | O(n) | O(n²) | O(n²) | O(1) | ✅ |
| Insertion sort | O(n) | O(n²) | O(n²) | O(1) | ✅ |
| Selection sort | O(n²) | O(n²) | O(n²) | O(1) | ❌ |
| Merge sort | O(n log n) | O(n log n) | O(n log n) | O(n) | ✅ |
| Quicksort | O(n log n) | O(n log n) | O(n²) | O(log n) | ❌ |
| Heap sort | O(n log n) | O(n log n) | O(n log n) | O(1) | ❌ |

A few implementation choices worth calling out:

- **Bubble** and **insertion** both **early-exit**, so an already-sorted array
  costs a single linear pass (`n−1` comparisons, zero swaps).
- **Merge sort is bottom-up (iterative)** — it merges runs of width 1, 2, 4, …
  using a scratch buffer — so there's no recursion depth to worry about, and the
  merge is **stable** (it takes the left run on ties).
- **Quicksort uses a median-of-three pivot** and an **explicit stack** that
  always recurses into the smaller side first, keeping stack depth O(log n) and
  dodging the classic O(n²) blow-up on sorted and reversed inputs.
- **Heap sort** builds a max-heap in place and repeatedly sifts down — O(n log n)
  worst case with O(1) extra space.

## Tests

`tests.js` is a dependency-free suite (49 checks). Run it with Node:

```bash
node projects/phase2-classic-algorithms/sorting/tests.js
```

It verifies, for every algorithm across many shapes and sizes:

1. **Correctness** — output equals the reference sort **and** is a true
   permutation of the input (nothing dropped, duplicated or invented).
2. **The original array is never mutated** — every sort works on a copy.
3. **Stability** — the stable sorts match the reference on duplicate-heavy input.
4. **Frames replay to the sorted array** — the recorded compare/set/swap frames,
   applied to a copy of the input, reproduce exactly the reported output.
5. **Counts hit known bounds** — selection sort always does exactly `n(n−1)/2`
   comparisons; bubble/insertion do `n−1` comparisons and zero swaps on a sorted
   array; and the O(n log n) sorts use strictly fewer comparisons than the O(n²)
   sorts on random data.
6. **Quicksort stays sub-quadratic** on adversarial (sorted/reversed) input.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The visualiser: controls, bar chart, and race leaderboard. |
| `style.css` | Dark theme, bar/legend styling, race table. |
| `sort-core.js` | The six algorithms, the shared Tracker, `run`/`race`, and verification helpers. UMD-ish: works under Node and as a browser global. |
| `script.js` | DOM controller — records frames via the core and replays them as animation. |
| `tests.js` | The Node test suite described above. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
