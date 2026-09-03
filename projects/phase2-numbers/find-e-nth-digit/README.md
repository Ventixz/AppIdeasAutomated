# Find e to the Nth Digit

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
second entry of its **Numbers** category, and a companion to
[Find PI to the Nth Digit](../find-pi-nth-digit/).

> "Find e to the Nth Digit — Just like the previous problem, but with e instead
> of π. Enter a number and have the program generate e up to that many decimal
> places. Keep a limit to how far the program will go."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. It computes _e_ on the spot and shows it two ways:
expanded to N decimal places, or a single requested digit.

## Why this isn't a one-liner

The tempting answer is `Math.E.toFixed(n)`. It's wrong past ~15 digits, because a
JavaScript `number` is a 64-bit float and simply has no more precision to give.
"Find e to the **Nth** digit" is really a request for **arbitrary precision**, so
every calculation here is done in **integers** with `BigInt`, which is exact and
unbounded. No floating-point value is used in the maths at all.

## How it computes _e_ — the Taylor series (Euler, 1748)

```
e = 1/0! + 1/1! + 1/2! + 1/3! + 1/4! + …  =  Σ 1/k!
```

The whole calculation is multiplied through by `10^(N + guard)`, so every term
`10^(N+guard) / k!` is a big integer and there is no rounding drift. The running
term is kept cheaply — each step just divides the previous term by `k` — and the
loop stops the instant `k!` outgrows the scale and the term floors to zero.

Factorials grow faster than any exponential, so this converges **astonishingly
fast**: even at 20 000 digits only a few thousand terms are needed, and each is a
single `BigInt` division. A handful of **guard digits** are computed and then
dropped, which guarantees the last digit we report is the digit that actually
appears in _e_ (the expansion is **truncated**, not rounded up).

> _e_ opens with a memorable quirk: `2.7 1828 1828 45 90 45…` — the block **1828
> repeats**, and then comes `459045`, the angles of an isosceles right triangle.
> Coincidence, but a nice one to watch the expander reproduce.

## The core is DOM-free

All the number theory lives in [`e-core.js`](./e-core.js), which touches no DOM,
no console, and no I/O — so the exact same file runs in the browser and under
Node for the tests:

- `eString(digits)` → `"2.71828…"` with exactly `digits` places after the point
  (`digits = 0` → `"2"`).
- `eScaledInteger(digits)` → the exact `BigInt` equal to `⌊e · 10^digits⌋`.
- `nthDigit(n)` → the single, 1-indexed Nth digit (`1`→`2`, `2`→`7`, `3`→`1`, …).
- `eSeriesScaled(scale)` → the scaled-integer Taylor sum the formula uses.

`index.html` + `script.js` are only a thin UI over that core: two modes (expand
to N digits / pick one digit), a copy button, input validation, and a limit
(20 000 digits) so the tab never locks up — exactly the cap the spec asks for.

## Tests

A dependency-free suite checks the expansion against known-correct 100- and
250-digit references at many lengths, verifies the 1-indexed digit lookup, and
confirms the raw series reproduces _e_ at a fixed scale:

```bash
node projects/phase2-numbers/find-e-nth-digit/tests.js   # -> 45 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
