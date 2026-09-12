# Unit Converter

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
eleventh entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/),
[Tile Cost Calculator](../tile-cost-calculator/),
[Mortgage Calculator](../mortgage-calculator/),
[Change Return Program](../change-return/),
[Binary to Decimal and Back Converter](../binary-decimal-converter/) and
[Calculator](../calculator/).

> "Unit Converter (temp, currency, volume, mass and more). Converts various
> units between one another. The user enters the type of unit being entered, the
> type of unit they want to convert to, and then the value."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Pick a category, pick two units, type a value,
and the answer updates as you type.

## Categories

Temperature, length, mass, volume, area, speed, time, digital storage, and
currency — nine categories, ~70 units in all.

## Why unit conversion is a *rational*-arithmetic problem

The naive converter stores each factor as a `Number` and multiplies. That works
until you notice two things.

1. **The factors are exact by definition — floats aren't.** `1 in` is *exactly*
   `2.54 cm`; `1 mile` is *exactly* `1609.344 m`; `1 US gallon` is *exactly*
   `3.785411784 L` (231 in³, and an inch is exactly 2.54 cm). Stored as IEEE-754
   doubles, these can't all be represented, so round-trips drift: convert
   `100 mi → km → mi` with floats and you don't get `100` back. This converter
   keeps every factor and every value as a **reduced pair of `BigInt`s**, so the
   round-trip is *exactly* `100`, and `3.6 km/h` is *exactly* `1 m/s`.

2. **Temperature isn't multiplicative — it's affine.** °C → °F is a scale *and*
   an offset (`×9/5`, then `+32`), so a one-factor table can't express it. Each
   temperature unit carries an exact rational **scale** and **offset** relative
   to Kelvin, which keeps °C ↔ °F ↔ K exact too: `-40 °C` is `-40 °F` on the
   nose, `37 °C` is `98.6 °F`, and `37 °C → °F → °C` comes back to exactly `37`.

Currency is the honest exception: there is **no exact, timeless ratio** between
dollars and euros. The rates here are a **fixed offline snapshot** (dated in the
UI), editable in a table on the page, and every currency result is flagged
**approximate** — the arithmetic is still exact rationals, but the input rate is
an estimate, so the output is too.

## What you see

Each result is labelled:

- **exact** — the value terminates as a finite decimal and is shown in full
  (`1 in → 2.54 cm`, `1 gal → 3.785411784 L`).
- **rounded for display** — the value is an exact rational but *repeats* (or is
  very long), so it's rounded to 12 significant figures and says so
  (`1 knot → 0.514444444444 m/s`).
- **approximate** — a currency conversion, resting on the snapshot rate.

## How the core works

All the logic lives in [`converter-core.js`](./converter-core.js), which is
DOM-free, I/O-free and console-free, so the identical file runs in the browser
and under Node for the tests.

- **Rationals** are `{ n, d }` `BigInt` pairs, always reduced with a positive
  denominator (`gcd` via Euclid). `parseNumber` turns user input — integers,
  decimals, `1/3` fractions, `6.022e23` scientific notation, `1_000` — into one.
- **Multiplicative categories** define each unit by a `factor` (base units per
  one unit). Conversion is `value · factorFrom / factorTo` — one multiply, one
  divide, both exact.
- **The temperature category** is affine: `base(K) = value · scale + offset`,
  inverted as `(base − offset) / scale`. It also guards **absolute zero** — any
  input below `0 K` is a clean error, not a negative Kelvin.
- **Currency** reuses the multiplicative path over an editable USD-rate table and
  tags the result approximate.
- **Formatting** decides per result: long division to detect a terminating
  decimal (shown exactly), otherwise significant-figure rounding (flagged).

`index.html` + `script.js` are only a thin set of menus and an editable rate
table over that core.

## Tests

A dependency-free suite covers the exactness promise (the defined ratios and
their reversibility), the affine temperature model (including the absolute-zero
guard and the `−40` fixed point), the number parser, the terminating-vs-rounded
display decision, currency flagging and editable rates, and the whole error
surface. Five property sweeps then check behaviour rather than single points:
**reversibility** (`x → y → x` is exact across every unit pair of every
multiplicative category), **composition** (`A → B → C` equals `A → C`),
**identity** (a unit to itself is unchanged), the **affine slope** (a `+1 °C`
step is always exactly `+9/5 °F`), and **linearity** (`f(k·v) = k·f(v)`).

```bash
node projects/phase2-numbers/unit-converter/tests.js   # -> 83 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
