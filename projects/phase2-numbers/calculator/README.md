# Calculator

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
tenth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/),
[Tile Cost Calculator](../tile-cost-calculator/),
[Mortgage Calculator](../mortgage-calculator/),
[Change Return Program](../change-return/) and
[Binary to Decimal and Back Converter](../binary-decimal-converter/).

> "A simple calculator to do basic operators. Make it a scientific calculator
> for added complexity."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Type an expression and it evaluates as you type;
a quick-key pad and example chips are there if you'd rather click.

## Why this isn't `eval(expr)`

The two-character answer to "evaluate a maths string" is `eval(expr)`, and it is
wrong in two different ways. Both are fixed here.

1. **`eval` runs arbitrary code.** It hands the string to the JavaScript engine,
   so `2+2` and `fetch('/steal-your-cookies')` are treated exactly alike. A
   calculator has no business executing whatever a user types. This one
   **tokenises and parses the expression itself** with a small recursive-descent
   grammar; only numbers, the operators `+ - * / % ^`, parentheses, and a fixed
   set of named functions and constants are ever interpreted. Anything else is a
   clean error, not code.

2. **`eval` does float arithmetic, and float arithmetic lies.** `eval('0.1 +
   0.2')` is `0.30000000000000004`; `eval('0.3 - 0.2')` is
   `0.09999999999999998`; `eval('1/3*3')` lands on `1` only by luck. So the
   basic operators here run on **exact rationals** — a pair of `BigInt`s kept
   reduced — and the answers are exact: `0.1 + 0.2` is `0.3`, `1/3` is exactly
   one third, `2^100` is a 31-digit integer, not a rounded float.

## What it computes

- **`+  -  *  /  %`** and **integer powers `^`** on exact `BigInt` fractions.
  Every intermediate value is a reduced `n/d`, so nothing drifts: `(1/3 + 1/6) *
  2` is exactly `1`, and `355/113` stays `355/113`.
- **Parentheses, unary minus, and real precedence.** `1 + 2 * 3` is `7`,
  `2^3^2` is `512` (right-associative, so `2^(3^2)`), and `-2^2` is `-4` (the
  power binds tighter than the unary minus) while `(-2)^2` is `4`.
- **Scientific functions** — `sqrt`, `cbrt`, `sin`, `cos`, `tan`, `asin`,
  `acos`, `atan`, `ln`, `log` (base 10), `exp`, `abs` — and the constants `pi`
  and `e`. These genuinely need floating point, so their results are computed as
  floats and **explicitly flagged "approximate"**. `abs` stays exact.

Every answer is labelled: **exact** (a terminating decimal, or an exact integer),
**exact — shown as a fraction** (a value like `1/3` that never terminates in
decimal, printed as the fraction with a rounded decimal alongside), or
**approximate** (once a float function or `pi`/`e` enters, the float propagates
and the whole result is marked rounded).

## How the core works

All the logic lives in [`calculator-core.js`](./calculator-core.js), which is
DOM-free, console-free and I/O-free, so the identical file runs in the browser
and under Node for the tests.

- **Exact values** are `{ n, d }` `BigInt` pairs, always reduced with a positive
  denominator (`gcd` via Euclid), so equal numbers share one representation.
  `add`/`sub`/`mul`/`div`/`mod`/`pow`/`neg` operate on them directly; `mod`
  floors the exact quotient so `5.5 % 2` is `1.5`, and `pow` stays exact for
  integer exponents (including negatives: `10^-3 = 0.001`).
- **Approximate values** are `{ x }` floats. The moment one meets an exact value
  in an operation, the exact one is converted and the result goes approximate —
  so `sqrt(9) + 1` is a (flagged) float even though the `+1` is exact.
- **The parser** is a hand-written recursive descent over the grammar
  `expr → term → unary → power → primary`, which is what gives correct
  precedence and associativity without a table.
- **Decimal literals become exact rationals** (`12.34 → 1234/100 → 617/50`), and
  **formatting** decides per result: a denominator whose only prime factors are
  2 and 5 terminates, so it's printed as a finite decimal by long division;
  otherwise the exact answer is the fraction, shown with a rounded decimal.

`index.html` + `script.js` are only a thin form and key-pad over that core.

## Tests

A dependency-free suite covers the exact-arithmetic promise (`0.1+0.2`,
`1/3*3`, `2^100`, `10^-3`), precedence/associativity/parentheses/unary,
the `%` remainder, the fraction-vs-terminating display decision, the scientific
functions and constants (checked to a tolerance, and checked to be *flagged*
approximate), and the whole error surface (`1/0`, `1.2.3`, unbalanced parens,
`sqrt(-1)`, unknown names, stray characters). Four property sweeps then check
behaviour rather than single points: `(a/b)*b === a` across a grid, exact
distributivity `(i+j)*k === i*k + j*k`, the geometric series `Σ 1/2^k = 1 −
1/2^n`, and clean display of terminating decimals.

```bash
node projects/phase2-numbers/calculator/tests.js   # -> 58 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
