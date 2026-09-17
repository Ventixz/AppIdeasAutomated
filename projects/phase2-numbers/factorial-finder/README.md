# Factorial Finder

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
sixteenth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/),
[Tile Cost Calculator](../tile-cost-calculator/),
[Mortgage Calculator](../mortgage-calculator/),
[Change Return Program](../change-return/),
[Binary to Decimal and Back Converter](../binary-decimal-converter/),
[Calculator](../calculator/),
[Unit Converter](../unit-converter/),
[Alarm Clock](../alarm-clock/),
[Distance Between Two Cities](../distance-between-cities/),
[Credit Card Validator](../credit-card-validator/) and
[Tax Calculator](../tax-calculator/).

> "The Factorial of a positive integer, n, is defined as the product of the
> sequence n, n-1, n-2, …1 and the factorial of zero, 0, is defined as being 1.
> Solve this using both loops and recursion."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. It does exactly what
the brief asks — computes `n!` with **both a loop and recursion** — and then three
things the brief doesn't: a **fast** product-tree method, the **trailing zeros**
and **digit count** of `n!` computed *without ever building the number*, and the
**inverse** (given a value, is it a factorial, and of what n?).

## What it does

- **Compute n!** — a whole `n` gives the exact value, its digit count, and its
  number of trailing zeros. The value is computed with the fast method, and the
  page reports how long it took.
- **Inverse** — hand it a number and it decides whether that number is some `n!`,
  reporting the `n` if so.
- **Presets** — one-click `0! 5! 10! 20! 50! 100! 1000!`, so the growth is
  immediate: `100!` is a 158-digit wall of digits.

## The interesting part: never a float

`13!` is `6,227,020,800` — already past a signed 32-bit integer. `21!` is past
`Number.MAX_SAFE_INTEGER`, so in ordinary JavaScript `21!` is silently **wrong**
in its low digits. `100!` is a 158-digit number a `double` can only render as
`9.33e157`, having discarded 150 digits. A factorial finder that used floats
would be a lie for any interesting input. So the core in
[`factorial-core.js`](./factorial-core.js) — which is DOM-free, I/O-free and
console-free — carries **every value as an exact `BigInt`**, and the tests prove
`20!` and `21!` land on their exact integers where a float cannot.

### Both methods the brief asks for — and why recursion is capped

The brief explicitly wants **loops and recursion**, and both are here:

- `factorialLoop(n)` — one pass, one accumulator. The workhorse everything else
  is checked against.
- `factorialRecursive(n)` — the textbook `n! = n · (n-1)!` with `0! = 1` as the
  base case. It is correct, but recursion depth grows with `n`, and a JS call
  stack is only a few thousand frames deep — so a naïve `factorialRecursive(1e6)`
  doesn't run *slowly*, it **overflows the stack**. The core guards that
  explicitly: past a conservative depth it throws a clear error pointing you at
  the loop or the fast method, rather than crashing with an opaque
  "Maximum call stack size exceeded".

The test suite runs all three methods over a sweep and asserts they return the
**identical** value.

### The fast method: a balanced product tree

The linear methods do `n-1` multiplications, but the accumulator grows huge, so
the *last* multiplications are `(giant) × (tiny)` — the worst possible shape for a
bignum multiply, which is fastest when its two operands are about the same size.
A **balanced product tree** fixes exactly that: split `2..n` in half, recurse on
each half, and multiply the two roughly-equal-sized results. Same exact answer,
far less work. It is a real, measurable win, not a micro-optimisation:

| n | linear loop | product tree |
| --- | --- | --- |
| 50,000 | ~410 ms | ~20 ms |

That is why the UI uses the product tree, and shows you the timing.

### Two facts you get without building the number

The genuinely satisfying part is learning things about `n!` far more cheaply than
computing it:

- **Trailing zeros** — `n!` ends in a run of zeros, one for every factor of 10,
  i.e. one for every matched `(2, 5)` pair among its factors. There are always
  more 2s than 5s, so the count is just the number of 5s, which **Legendre's
  formula** gives directly: `⌊n/5⌋ + ⌊n/25⌋ + ⌊n/125⌋ + …`. No multiplication at
  all — you learn `1000!` ends in **249 zeros** without forming its 2,568 digits.
- **Digit count** — the number of digits of a positive integer is
  `⌊log₁₀ x⌋ + 1`, and `log₁₀(n!) = log₁₀1 + log₁₀2 + … + log₁₀n` — a sum of `n`
  cheap floats instead of a product of `n` growing bignums. So the page can state
  that `1,000,000!` has **5,565,709 digits** by adding a million logs in
  milliseconds, never forming the five-million-digit number.

The suite checks Legendre against the *real* trailing zeros of the computed
factorial over a sweep, and the log-sum digit count against the *real* string
length — they match exactly for every `n` tested.

### The inverse

`inverseFactorial(value)` runs the definition backwards: divide the value by
`1, 2, 3, …`; a factorial peels cleanly down to `1`, and anything else leaves a
remainder or shoots past. It accepts a `BigInt` or a comma-grouped string and
returns the `n` where `value === n!`, or `null`.

`index.html` + `script.js` are only a thin layer over that core: they read the
input, call the core, and paint the result. They do **no** factorial arithmetic
of their own, so what you see on screen is exactly what the tested core computes.

## Tests

A dependency-free suite exercises the core without a browser:

- **Parsing & validation** — commas/underscores/spaces stripped, decimals, signs,
  junk and unsafe magnitudes rejected (not truncated the way `parseInt` would).
- **Known values** — `0!`…`13!`, the exact `20!`/`21!` that break a float, and
  `100!`'s 158-digit length and 24 trailing zeros.
- **Agreement** — loop, recursion and product tree return the identical value over
  `0..300`, and again at `n = 5000`.
- **Recurrence & shape** — `(n+1)! = (n+1)·n!` holds across a sweep, and `n!` is
  strictly increasing for `n ≥ 2`.
- **Recursion guard** — allowed exactly at the limit, refused one past it.
- **Trailing zeros** — Legendre's formula matches the real count of trailing `0`s
  of the computed number over `0..400`.
- **Digit count** — the log-sum matches the real string length over `0..600`.
- **Inverse** — recognises the factorials, rejects the non-factorials, and round
  trips `inverseFactorial(n!) === n`.

```bash
node projects/phase2-numbers/factorial-finder/tests.js   # -> 54 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
