# Find PI to the Nth Digit

The **first project of Source 2**, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) —
the opening entry of its **Numbers** category.

> "Find PI to the Nth Digit — Enter a number and have the program generate π
> (pi) up to that many decimal places. Keep a limit to how far the program will
> go."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. It computes π on the spot and shows it two ways:
expanded to N decimal places, or a single requested digit.

## Why this isn't a one-liner

The tempting answer is `Math.PI.toFixed(n)`. It's wrong past ~15 digits, because
a JavaScript `number` is a 64-bit float and simply has no more precision to give.
"Find PI to the **Nth** digit" is really a request for **arbitrary precision**,
so every calculation here is done in **integers** with `BigInt`, which is exact
and unbounded. The only floating-point value in the project is `Math.PI`, and it
is never used for the maths.

## How it computes π — Machin's formula (1706)

```
π = 16·arctan(1/5) − 4·arctan(1/239)
```

Each `arctan(1/x)` is summed from its Taylor series

```
arctan(1/x) = 1/x − 1/(3·x³) + 1/(5·x⁵) − …
```

entirely in **scaled integers**: the whole calculation is multiplied through by
`10^(N + guard)`, so every term is a big integer and there is no rounding drift.
Because `1/5` and `1/239` are small, the alternating series converges quickly —
1000 digits land in a couple of milliseconds. A handful of **guard digits** are
computed and then dropped, which guarantees the last digit we report is the digit
that actually appears in π (the expansion is **truncated**, not rounded up, so
`…35` stays `…35`).

## The core is DOM-free

All the number theory lives in [`pi-core.js`](./pi-core.js), which touches no DOM,
no console, and no I/O — so the exact same file runs in the browser and under
Node for the tests:

- `piString(digits)` → `"3.1415…"` with exactly `digits` places after the point
  (`digits = 0` → `"3"`).
- `piScaledInteger(digits)` → the exact `BigInt` equal to `⌊π · 10^digits⌋`.
- `nthDigit(n)` → the single, 1-indexed Nth digit (`1`→`3`, `2`→`1`, `3`→`4`, …).
- `arctanReciprocal(x, scale)` → the scaled-integer arctangent the formula uses.

`index.html` + `script.js` are only a thin UI over that core: two modes (expand
to N digits / pick one digit), a copy button, input validation, and a limit
(20000 digits) so the tab never locks up — exactly the cap the spec asks for.

## Tests

A dependency-free suite checks the expansion against a known-correct 100-digit
reference at many lengths, verifies the 1-indexed digit lookup, and even lands
on the **Feynman point** (the run of six 9s beginning at decimal 762):

```bash
node projects/phase2-numbers/find-pi-nth-digit/tests.js   # -> 43 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
