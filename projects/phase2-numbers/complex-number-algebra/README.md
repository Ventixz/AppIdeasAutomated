# Complex Number Algebra

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
seventeenth entry of its **Numbers** category, following
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
[Credit Card Validator](../credit-card-validator/),
[Tax Calculator](../tax-calculator/) and
[Factorial Finder](../factorial-finder/).

> "Complex Number Algebra — **show co-ordinates on a coordinate plane based on
> user input.**"

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. It does exactly what
the brief asks — takes complex numbers you type and plots them as co-ordinates on
the complex plane — and around that builds a full **algebra**: add, subtract,
multiply, divide, conjugate, negate, reciprocal, square, principal square root,
and the **n distinct nth roots**.

## What it does

- **Parse complex numbers the way you write them** — `3 + 4i`, `-i`, `4i + 3`,
  `2.5e-3 - 1.5i`, `-2 - 3j` (engineers use `j`). A bare `i` is `1i`; a bare
  number is real.
- **Do the algebra** — pick an operation and it computes the result, formats it
  back into `a + bi`, and shows the **polar** readout (`|z|` and `arg z` in
  radians and degrees).
- **Plot it** — an **Argand diagram** draws operand A, operand B and the result
  as points and vectors from the origin, on an auto-scaling grid. For **nth
  roots** it plots *all* of them, evenly spaced on their circle of radius
  `|A|^(1/n)` — the picture that makes roots of unity click.

## The interesting part: division that doesn't overflow

Complex algebra is, unlike factorial, a genuinely **floating-point** problem — a
modulus, an argument or an nth root is irrational in general, so there is no exact
integer to preserve. The care here is therefore *numeric*, and it shows up
sharpest in **division**.

The formula every textbook prints is

```
a + bi     (ac + bd) + (bc - ad)i
------  =  ----------------------
c + di            c² + d²
```

which is correct in exact arithmetic and **treacherous in floating point**: it
squares the denominator's components. Feed it `c = d = 1e200` and `c² + d²`
overflows to `Infinity`, so a perfectly ordinary quotient comes back as `NaN`.
Feed it `1e-200` and `c² + d²` underflows to `0`. The core in
[`complex-core.js`](./complex-core.js) — which is DOM-free, I/O-free and
console-free — instead uses **Smith's algorithm**: divide through by the *larger*
of `|c|`, `|d|` first, so every intermediate quantity stays near unit scale and
nothing is ever squared:

```
if |c| ≥ |d|:  r = d/c;  den = c + d·r;  result = (a + b·r)/den + ((b - a·r)/den)i
else:          r = c/d;  den = c·r + d;  result = (a·r + b)/den + ((b·r - a)/den)i
```

The suite proves it: `(1e200 + 1e200i) / (1e200 + 1e200i)` returns exactly `1`,
and so does the `1e-200` version, where the schoolbook formula returns `NaN` and
`0` respectively.

The same instinct runs through the rest of the core:

- **Modulus** is `Math.hypot(re, im)`, which computes `√(re² + im²)` **without**
  forming `re² + im²`, so `|1e200 + 1e200i|` is a finite `1.414e200` instead of
  `Infinity`.
- **Square root** uses the numerically stable branch of the closed-form `√z`
  (the LAPACK `csqrt` shape) rather than the polar `√r · e^{iθ/2}` route, so it
  keeps its precision near the negative real axis where the angle method degrades.
  The test sweep checks `√z · √z = z` for cases sitting right on and just off that
  axis.
- **Integer powers** go by exponentiation-by-squaring with exact complex
  multiplies (no polar round-trip), and negative powers via a single reciprocal.

## The payoff: co-ordinates on a plane

The brief asks for co-ordinates, and the satisfying case is **roots**. The `n`
nth-roots of a complex number all share one modulus, `|z|^(1/n)`, and are spaced
exactly `2π/n` apart in angle — so they land as `n` evenly-spaced points on a
circle. The app draws that circle and every root on it, and the test suite
confirms the math three ways: each root raised to the `n` returns the original,
they all share one modulus, and (for `n ≥ 2`) they **sum to zero**.

`index.html` + `script.js` are only a thin layer over the core: they read the
inputs, call `ComplexCore.compute(...)`, print the result, and paint the diagram.
They do **no** complex arithmetic of their own, so what you see plotted is exactly
what the tested core computes.

## Tests

A dependency-free suite exercises the core without a browser:

- **Parsing** — all the spellings above, plus `j`, unicode minus, and stripped
  spaces/underscores; junk (`12x`, `3 + 4k`, a trailing `+`) is rejected, not
  silently truncated.
- **Formatting** — `a + bi` / `a - bi`, `i` and `-i` with the coefficient
  dropped, `-0` shown as `0`, display rounding, and `parse(format(z)) === z`.
- **Field axioms** — over a 500-case pseudo-random sweep: addition and
  multiplication commute, multiplication is associative and distributes over
  addition, `(a·b)/b = a`, and `conj(a·b) = conj(a)·conj(b)`.
- **Identities** — `z · conj(z) = |z|²` (and is real), De Moivre for integer
  powers, and Euler's `e^{iπ} = -1`, `e^{iπ/2} = i`, with `log(exp z) = z`.
- **Extreme scale** — Smith division and `hypot` survive `1e±200` where the
  schoolbook formulas overflow/underflow.
- **Roots** — `√z · √z = z` across a sweep including the negative real axis; the
  `n` nth-roots each power back to `z`, share one modulus, and sum to zero.

```bash
node projects/phase2-numbers/complex-number-algebra/tests.js   # -> 86 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
