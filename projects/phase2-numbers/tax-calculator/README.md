# Tax Calculator

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
fifteenth entry of its **Numbers** category, following
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
[Distance Between Two Cities](../distance-between-cities/) and
[Credit Card Validator](../credit-card-validator/).

> "Tax Calculator — Ask the user to enter a cost and either a country or state
> tax. Add the tax to the cost, return the total cost with tax."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. It does the plain
thing the brief asks for (a cost plus a rate gives a total) and then two things
the brief doesn't: it runs the calculation *backwards* out of a tax-inclusive
receipt, and it runs an income through a **progressive bracket** schedule.

> ⚠️ **Not tax advice.** The arithmetic here is exact to the cent, but the built-in
> rates and schedules are *illustrative examples*, not a live rate table. Real
> tax involves deductions, credits, filing status, phase-outs and local surtaxes
> this project does not model. Nothing you type ever leaves your browser.

## What it does

- **Add tax** — a price and a rate give the tax and the total to pay.
- **Extract tax** — the reverse: hand it a total that *already includes* tax and
  it splits back to the pre-tax base and the tax inside it (not the same as
  multiplying the total by the rate — see below).
- **Progressive brackets** — an income and a schedule give the total tax, the
  take-home, a full per-band breakdown, and both the **marginal** and the
  **effective** rate — the two numbers people most often confuse.
- **Example rates and schedules** — one-click sample sales-tax rates and three
  teaching schedules (a flat rate, a simple three-band, and a five-band
  progressive), all clearly labelled as illustrative.

## The interesting part: never use a float for money

The whole point of a tax calculator is that the numbers are *right to the cent*,
and that is exactly where the obvious implementation — JavaScript floats — is
wrong. `19.99 * 0.0825` is not `1.649175`; it is `1.6491749999999998`, and
rounding *that* only papers over an error that has already happened. So the core
never touches a float. It lives in [`tax-core.js`](./tax-core.js), which is
DOM-free, I/O-free and console-free, and it carries:

- **money as an integer number of cents** (a `BigInt`), and
- **every rate as an integer number of basis points** — hundredths of a percent,
  so `8.25%` is the integer `825`.

Tax is then the exact rational `cents × bps / 10000`, and there is exactly **one**
place a whole-cent value is produced from a rational — `roundHalfUp` — rounding
half away from zero, the way a receipt does.

### Forward is easy; the reverse is the trap

Adding tax is a multiply. Taking tax back *out* of an inclusive total is the part
people get wrong: you cannot multiply the total by the rate, because the rate was
applied to the *smaller* pre-tax number. If a total already includes tax at
`bps`, then

```
total = base × (10000 + bps) / 10000
```

so the base is `round(total × 10000 / (10000 + bps))` and the tax is **whatever is
left over**. Taking the tax as the remainder guarantees `base + tax == total`
exactly — no cent is ever lost or invented. The suite checks this over thousands
of amount/rate pairs: `base + tax` always equals the total, and the recovered
base is always within a cent of the original.

### Marginal vs effective — the bracket engine

The other genuinely interesting bit is `progressiveTax()`. A schedule is a list
of brackets, each with a threshold and a rate, the top one open-ended. Income is
taxed **in slices**: the part of your income that falls in each band is taxed at
*that band's* rate — not the whole income at the top rate, which is the single
most common misunderstanding of how income tax works. The engine:

- sums the **exact** rational contributions (`slice × bps`) and rounds the total
  to a cent **once**, so the answer never drifts by a rounding step per bracket;
- reports the **marginal rate** (the top band your income actually reaches) and
  the **effective rate** (total tax ÷ income) — for a $60,000 income on the
  sample three-band schedule that is *20% marginal but only 11.67% effective*,
  the exact gap the display is built to make obvious;
- validates the schedule (thresholds must strictly increase; only the top bracket
  may be open-ended) rather than silently producing a wrong number.

`index.html` + `script.js` are only a thin layer over that core: they read the
inputs, call the core, and paint the result. They do **no** tax arithmetic of
their own — not a single float multiply — so what you see on screen is exactly
what the tested core computes.

## Tests

A dependency-free suite exercises the core without a browser:

- **Parsing** — money to cents and percent to basis points, padding one decimal,
  stripping `$`/`,`/`%`/spaces, and rejecting a third decimal instead of
  truncating it.
- **Rounding** — the half-up rule at and around the `.5` boundary, both signs.
- **Forward tax** — the `19.99 @ 8.25% → 1.65` float trap computed correctly,
  plus exact and zero-rate cases.
- **Reverse tax** — a receipt split back to base + tax, and a property sweep:
  over hundreds of amount/rate pairs, `base + tax` always equals the total and
  the base is recovered within a cent.
- **Progressive brackets** — worked examples, the per-band breakdown
  reconstructing the reported tax, threshold/shape validation, and three property
  sweeps: tax is monotonic in income, it never exceeds the top-rate cap (and the
  effective rate never exceeds the marginal rate), and a single-band flat
  schedule matches the plain `taxOn()` exactly.

```bash
node projects/phase2-numbers/tax-calculator/tests.js   # -> 64 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
