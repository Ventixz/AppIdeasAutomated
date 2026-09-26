# Closest Pair of Points

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**third entry of its Classic Algorithms category**, and the twenty-fifth
Source 2 project overall. It follows the
[Sorting](../sorting/) build.

> "Closest Pair Problem — the closest pair of points problem is a problem of
> computational geometry: given _n_ points in a metric space, find a pair of
> points with the smallest distance between them."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

- **Plots _n_ points** (3–400) drawn from four distributions — uniform,
  clustered, a regular grid, or a circle — and finds the two that are closest.
- **Animates the search, step by step.** Watch each candidate pair light up
  **amber** as it's measured and the current best pair held in **green**. In
  divide-and-conquer mode you also see the recursion's **purple split line** and
  the translucent **strip** it narrows the search to.
- **Races the two algorithms on the same points.** A table shows each one's
  **distance-evaluation count**, the closest distance it found, and its
  wall-clock time. On 400 uniform points brute force does 79,800 evaluations
  where divide-and-conquer does a few hundred — the O(n²) vs. O(n log n) gap as
  a number, not a claim.

## Two algorithms, and why the second one is clever

**Brute force — O(n²).** Check all `n(n−1)/2` pairs, keep the smallest. Obviously
correct, and that obviousness is exactly why the tests use it as the oracle.

**Divide and conquer — O(n log n).** Presort the points by _x_ once and by _y_
once. Split the _x_-sorted list at the median into a left and a right half,
recurse on each, and let `d` be the smaller of the two closest distances found.
Every pair that could still beat `d` must straddle the split line **and** lie
within `d` of it — a thin vertical **strip**. The magic is what happens inside
that strip:

> Sort the strip's points by _y_. For each one, any point close enough to beat
> `d` must be within `d` in the _y_-direction too — and a packing argument shows
> **at most a constant number (≤ 7) of the following strip points can be that
> close**. So the strip scan is linear, the merge is O(n), and
> `T(n) = 2·T(n/2) + O(n)` solves to **O(n log n)**.

```js
// projects/phase2-classic-algorithms/closest-pair/closest-pair-core.js
// The strip scan — the inner loop breaks the instant the y-gap reaches d,
// which is what keeps the merge linear rather than quadratic.
for (var i = 0; i < strip.length; i++) {
  for (var j = i + 1; j < strip.length && (strip[j].y - strip[i].y) < best.dist; j++) {
    var d2 = t.measure(strip[i], strip[j]);
    if (d2 < best.d2) { best = pair(strip[i], strip[j], d2); t.recordBest(best); }
  }
}
```

## Make the *work* visible, not just the answer

As in this project's sibling builds, both algorithms route **every**
point-to-point distance through a single small **Tracker** that counts
evaluations. Because they share the same instrumented primitive, the two counts
are directly comparable — that's what turns the textbook complexity gap into
something you read off the table. The tracker can also record a frame per
operation, and that exact same run drives the canvas animation: the UI just
replays the frames.

Two correctness details worth calling out:

- **Comparisons stay exact.** Coordinates are integers and the code compares
  **squared** distances internally (`dx² + dy²`), taking a square root only for
  display. No floating-point rounding ever decides which pair is closer, so
  ties (a grid, coincident points) are handled exactly.
- **Splits are unambiguous.** The _x_- and _y_-comparators define a *total*
  order (ties broken by the other coordinate, then original index), so the
  median split and the _y_-list partition are well-defined even when many points
  share an _x_ — the case a naive implementation gets subtly wrong.

## Tests

`tests.js` is a dependency-free suite (41 checks) that leans on brute force as
the oracle. Run it with Node:

```bash
node projects/phase2-classic-algorithms/closest-pair/tests.js
```

It verifies:

1. **Hand-checked tiny cases** (3-4-5 triangle, collinear points, a known set).
2. **Divide matches brute** across **400 random trials** and every generator
   shape and size — compared by *distance*, since ties mean the pair of ids can
   legitimately differ.
3. **Duplicate / coincident points** give distance 0, and a grid's many tied
   closest pairs still agree.
4. **The returned pair really is that distance apart** (recomputed directly).
5. **Brute does exactly `n(n−1)/2` evaluations**, and **divide is genuinely
   sub-quadratic** — under 10% of brute's count at n=2000, even on clustered
   input.
6. **Recorded frames** reference valid points and the best-so-far marker only
   ever tightens, ending exactly at the reported answer.
7. **Degenerate inputs** (empty, single point, all-collinear, all-identical)
   don't throw and return sensible results.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The visualiser: controls, point canvas, and the race table. |
| `style.css` | Dark theme, canvas/legend styling, race table. |
| `closest-pair-core.js` | Brute force + divide-and-conquer, the shared Tracker, `run`/`race`, generators. UMD-ish: works under Node and as a browser global. |
| `script.js` | DOM/canvas controller — replays recorded frames as animation. |
| `tests.js` | The Node test suite described above. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
