# Fibonacci Sequence

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
third entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/) and
[Find e to the Nth Digit](../find-e-nth-digit/).

> "Fibonacci Sequence — Enter a number and have the program generate the
> Fibonacci sequence to that number, or to the Nth number."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. It generates the sequence three ways: the first N
terms, every term up to a value you choose, or a single term by its index.

## Why this isn't a one-liner

Fibonacci numbers grow exponentially — the ratio between consecutive terms
approaches the golden ratio φ ≈ 1.618, so each term is roughly 1.6× the last.
They cross `Number.MAX_SAFE_INTEGER` (2⁵³ − 1) at **F(79)**, and from there a
plain JavaScript `number` silently returns rounded, wrong values. "Generate the
Fibonacci sequence" is therefore really a request for **arbitrary precision**, so
every value here is a **`BigInt`**, which is exact and unbounded. No
floating-point value is used in the maths at all.

## The three modes — matching the spec's two asks

The spec asks for the sequence "**to that number, or to the Nth number**" — two
different bounds, so the UI offers both, plus a single-term lookup:

- **First N terms** — `fibSequence(n)` builds `[F(0), F(1), …, F(n-1)]`
  iteratively, each term the sum of the previous two: N terms cost N−1 additions.
- **Terms up to a value** — `fibUpTo(max)` yields every Fibonacci number ≤ `max`.
  The bound is itself a `BigInt`, so it can be astronomically large; note that
  `fibUpTo(1)` includes **both** ones (F(1) and F(2) are each 1).
- **The single Nth term** — `fibAt(n)` returns just F(n) using **fast doubling**.

## Fast doubling — F(1 000 000) without a million additions

Walking the recurrence to F(n) takes n additions. That's fine for a few thousand
terms but wasteful for a single distant one, so `fibAt` climbs the **binary
expansion of n** instead, using the identities

```
F(2k)   = F(k) · (2·F(k+1) − F(k))
F(2k+1) = F(k+1)² + F(k)²
```

to roughly double the index each step — about `log₂(n)` big-integer multiplies in
total. F(1000) (209 digits) and far beyond return effectively instantly, and the
suite cross-checks `fibAt` against the iterative `fibSequence` for the first 500
terms so the fast method is proven to agree with the plain one.

## The core is DOM-free

All the number theory lives in [`fib-core.js`](./fib-core.js), which touches no
DOM, no console, and no I/O — so the exact same file runs in the browser and
under Node for the tests:

- `fibSequence(count)` → `[F(0), …, F(count-1)]` as `BigInt` (`count = 0` → `[]`).
- `fibUpTo(max)` → every Fibonacci number ≤ `max` (a `BigInt` bound).
- `fibAt(n)` → the single 0-indexed Nth term, via fast doubling.
- `fibPair(n)` → the pair `[F(n), F(n+1)]` the doubling recursion returns.

`index.html` + `script.js` are only a thin UI over that core: three modes, a copy
button, input validation, and a term cap (20 000) so the tab never locks up.

## Tests

A dependency-free suite checks the sequence against a 21-term reference, verifies
the recurrence holds across 60 terms, confirms the `≤ max` boundary behaviour
(including the double 1), cross-checks fast doubling against known F(100)/F(200)
references and against the iterative generator, and covers input validation:

```bash
node projects/phase2-numbers/fibonacci-sequence/tests.js   # -> 46 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
