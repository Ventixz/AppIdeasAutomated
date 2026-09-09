# Change Return Program

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
eighth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/),
[Tile Cost Calculator](../tile-cost-calculator/) and
[Mortgage Calculator](../mortgage-calculator/).

> "The user enters a cost and then the amount of money given. The program will
> figure out the change and the number of quarters, dimes, nickels, pennies
> needed for the change."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Enter a cost and the amount handed over; it
returns the change and breaks it into the fewest bills and coins.

## Why this isn't a one-liner

The obvious version is two lines: `change = (given - cost) * 100`, then peel off
the biggest coin that fits, over and over. Both halves are quietly wrong.

1. **Money is not a float.** A cost of `$0.10` plus `$0.20` is not `0.30` in
   IEEE-754 — it's `0.30000000000000004` — so `Math.round((given - cost) * 100)`
   is a coin-flip whenever the true answer sits on a half-cent. Every amount
   here is parsed **straight from its decimal string into an exact integer
   number of cents** (`"$0.10"` → `10`), and all arithmetic is integer
   arithmetic. No float ever touches the money.

2. **Greedy change is correct only by luck.** "Hand back the biggest coin that
   fits, repeat" gives the *fewest* pieces — but **only because U.S.
   denominations form a _canonical_ system.** Change the set to `{1, 3, 4}` and
   greedy botches 6¢ (`4 + 1 + 1`, three coins) where the optimum is `3 + 3`
   (two coins). So this program computes the greedy breakdown **and** the
   provably minimum-coin breakdown (dynamic programming), and tells you whether
   they agree. For real U.S. money they always do — and it says so rather than
   hoping so.

## What it computes

- **The change**, as exact cents, with a guard that the amount given is at least
  the cost (otherwise it reports the shortfall).
- **A breakdown** into hundred/fifty/twenty/ten/five-dollar bills, singles, then
  quarters, dimes, nickels and pennies — or **coins only** (quarters through
  pennies, as the exercise names) if you pick that mode.
- **A minimality guarantee.** The greedy answer is checked against a
  minimum-coin dynamic program; the UI confirms it's the fewest possible pieces.

## How the core works

All the logic lives in [`change-core.js`](./change-core.js), which is DOM-free,
console-free and I/O-free, so the identical file runs in the browser and under
Node for the tests.

- **`parseMoney(str)`** — a decimal string → an exact integer number of cents,
  by reading the digits (no `parseFloat`, no `* 100`, no rounding of a float).
  Accepts `$`, thousands commas, `.5`, `10.`; rejects `1.234`, `1e3`, `-5`, `''`.
- **`greedyChange(amount, denoms)`** — biggest-first; fast, and optimal on
  canonical systems only. Reports a `remainder` if the set can't make the amount.
- **`optimalChange(amount, denoms)`** — the honest, provably fewest pieces for
  **any** denomination set, by dynamic programming (`O(amount × #denoms)`).
- **`isCanonical(denoms)`** — does greedy equal optimal at every amount? (Checks
  up to the sum of the two largest coins, which is a real proof for coin sets.)
- **`makeChange(cost, given, denoms)`** — the single entry point the UI and
  tests call: validates, computes the change, and returns both breakdowns plus
  whether greedy was optimal and whether the system is canonical.

`index.html` + `script.js` are only a thin form and table over that core.

## Tests

A dependency-free suite covers the float trap (`$0.10 + $0.20` as exact cents),
money parsing and its rejections, the worked example (`$7.03` from a `$20` →
`$12.97` = a ten, two ones, three quarters, two dimes, two pennies), exact
payment and the overpay guard, coins-only mode, and — the heart of it — the
**canonical-system** claim: U.S. bills and coins are verified canonical, the
`{1, 3, 4}` counterexample is shown failing greedy, and a set with no penny is
shown unable to make every amount. Two sweeps then check the *properties*
directly rather than any single example: greedy equals optimal at every amount
from 0 to $5.00, and 500 random transactions each reconstruct the exact change
and stay minimal.

```bash
node projects/phase2-numbers/change-return/tests.js   # -> 39 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
