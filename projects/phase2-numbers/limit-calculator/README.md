# Limit Calculator

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
twenty-first entry of its **Numbers** category, following
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
[Tax Calculator](../tax-calculator/),
[Factorial Finder](../factorial-finder/),
[Complex Number Algebra](../complex-number-algebra/),
[Happy Numbers](../happy-numbers/),
[Number Names](../number-names/) and
[Coin Flip Simulation](../coin-flip/).

> "Limit Calculator — calculate the limit of a function as it approaches a
> value."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. Type a function of
`x` and a point to approach, and it reports the limit — and, just as important,
*why*: whether the two sides agree, whether it runs off to ±∞, or whether the
limit simply doesn't exist.

## What it does

- **Parses real math.** A recursive-descent parser handles `+ - * / ^`,
  parentheses, unary minus, **implicit multiplication** (`2x`, `3(x+1)`,
  `x sin(x)`), the constants `pi`, `e`, `tau`, `phi`, and a full set of
  functions: `sin cos tan`, their inverses and hyperbolics, `exp`,
  `ln`/`log` (natural), `log10`, `log2`, `sqrt`, `cbrt`, `abs`, and more.
- **Approaches from both sides.** It creeps `x` toward the point from the left
  *and* the right, so it can tell a genuine two-sided limit from a jump.
- **Handles the three outcomes honestly.** A finite value, an infinite limit
  (**±∞**), or **does not exist** — each with a plain-English reason.
- **Does limits at infinity.** Type `inf` or `-inf` as the point; it substitutes
  `x = 1/t` and takes `t → 0`, so `(1 + 1/x)^x → e` and rational functions settle
  to their leading-term ratio.
- **Names the answer when it can.** A small closed-form recogniser labels results
  like `1/2`, `3/5`, `pi/2`, `e`, or `ln(2)` alongside the raw number.
- **Shows its work.** A convergence table lists the samples closing in on the
  point, so you can watch the value stabilise.

## The interesting part: getting an accurate limit from a few samples

The naïve way to estimate a limit is to plug in a point very close to the target
— say `x = a + 10⁻⁸` — and hope. That fights floating-point: subtract two nearly
equal numbers (as `sin(x)/x` or `(1-cos x)/x²` do) and catastrophic cancellation
eats your precision long before `h` gets small enough.

This calculator does the opposite. It samples at a **modest, shrinking ladder** of
offsets `h = 0.125, 0.0625, 0.03125, …` — never so tiny that rounding dominates —
and then **extrapolates to `h = 0`** with Neville's algorithm (the engine behind
Richardson extrapolation and Ridders' method). It fits the interpolating
polynomial through `(h, f(a±h))` and reads off its value at `h = 0`:

```js
// projects/phase2-numbers/limit-calculator/limit-core.js
function extrapolateToZero(hs, ys) {
  var col = ys.slice();
  for (var k = 1; k < hs.length; k++) {
    var next = [];
    for (var i = 0; i < hs.length - k; i++) {
      var hi = hs[i], hik = hs[i + k];
      next.push(((0 - hik) * col[i] - (0 - hi) * col[i + 1]) / (hi - hik));
    }
    col = next; // each pass folds in one more sample, sharpening the estimate
  }
  return col[0]; // the polynomial's value at h = 0
}
```

For a smooth function this converges to machine precision from just a handful of
comfortably-sized samples. `sin(x)/x → 1`, `(1-cos x)/x² → 1/2`, and
`(sqrt(1+x)-1)/x → 1/2` all come out to eight-plus correct digits without ever
sampling in the danger zone.

## Deciding what the limit *is*

Extrapolation gives a candidate value for each side; the verdict comes from
comparing them:

- **Both sides agree** → the limit exists and equals their shared value.
- **Both sides blow up with the same sign** → the limit is **+∞** or **−∞**.
  (Divergence is detected by a tail of samples growing in magnitude with a
  consistent sign, e.g. `1/x²`.)
- **The sides disagree** → **does not exist** (`1/x` at 0: −∞ on the left,
  +∞ on the right; `|x|/x` at 0: −1 versus +1).
- **The samples never settle** → **does not exist** (`sin(1/x)` at 0 oscillates
  forever, so no polynomial through the samples converges).

A separate, gentler fallback catches genuinely-convergent-but-slow cases like
`x·ln(x) → 0`, where the approach is monotone and Cauchy but not a clean power
series Neville can nail — the tool accepts it, flagged as a lower-confidence
estimate.

## Limits at infinity, without special-casing

`x → ∞` is just `t → 0⁺` under the substitution `x = 1/t`, so the same one-sided
machinery handles it. That's why `(1 + 1/x)^x` correctly returns `e` and
`(3x² + 2)/(x² − 1)` returns `3`: after the substitution they become ordinary,
smooth limits at zero.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure and copy — the inputs, the verdict panel, the one-sided breakdown, the convergence table, and the "how it works" note. |
| `style.css` | The dark theme shared across the routine's projects. |
| `limit-core.js` | The DOM-free brain: the expression parser/evaluator, the Neville extrapolator, the one-sided/two-sided limit logic, and the closed-form recogniser. |
| `script.js` | The thin UI layer. Reads the inputs, calls the core, paints the result. No limit math of its own. |
| `tests.js` | A dependency-free suite (68 checks) run with Node. |

## Running the tests

```bash
node projects/phase2-numbers/limit-calculator/tests.js
```

The suite checks all three layers: the parser (operator precedence, implicit
multiplication, right-associative `^`, scientific literals, and that malformed
input throws), the Neville extrapolator on a known polynomial, the estimator
against ~30 classic limits — finite, infinite, one-sided, at-infinity, and the
DNE cases `1/x`, `|x|/x`, and `sin(1/x)` — and the closed-form recogniser for
fractions and constants like `pi/2` and `ln(2)`.

## Design notes

- **The core never touches the DOM.** `limit-core.js` has no `window`,
  `document` or `fetch`, so the numbers the UI shows are exactly the numbers the
  tests prove. `script.js` only reads inputs and paints.
- **Never evaluate at the point.** A limit is about the *approach*, not the value
  there — which is often `0/0` or undefined. The calculator only ever samples
  *near* the target, then reports `f(a)` separately so you can see whether the
  function is actually continuous.
- **Extrapolate, don't shrink blindly.** Sampling too close to the point trades a
  smaller truncation error for a larger rounding error. Richardson extrapolation
  from moderate offsets sidesteps that trade entirely.
- **Numerical, so it has limits of its own.** This is a *numeric* estimator, not a
  symbolic solver: pathological or wildly oscillating functions can defeat it,
  and log-type approaches converge to fewer digits. It says so — a slow result is
  flagged, and anything it can't pin down is reported as DNE rather than guessed.
