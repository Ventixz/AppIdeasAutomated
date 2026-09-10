# Binary to Decimal and Back Converter

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
ninth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/),
[Tile Cost Calculator](../tile-cost-calculator/),
[Mortgage Calculator](../mortgage-calculator/) and
[Change Return Program](../change-return/).

> "If you can write the algorithm to convert a number from binary to decimal
> and vice versa in your favourite language, you understand computers."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Pick a direction, type a number, and it converts
as you type.

## Why this isn't `parseInt(s, 2)` / `n.toString(2)`

The two-line answer everyone reaches for is quietly wrong in two different ways,
and both are fixed here.

1. **Those built-ins lose precision.** `parseInt('1' + '0'.repeat(60), 2)` is
   **not** 2⁶⁰ — it comes back `1152921504606847000`, wrong from the 17th digit,
   because the value passes through a 64-bit float and everything past bit 53 is
   rounded away. So every integer conversion here runs on **`BigInt`, digit by
   digit**: `1101₂ → 13`, `2¹⁰⁰ → 1` followed by a hundred zeros, a 128-bit
   all-ones string → 2¹²⁸−1, all exact.

2. **Fractions are asymmetric, and the naive code hides it.** A binary fraction
   *always* terminates in decimal — `0.01₂` is exactly `0.25`, `0.101₂` is
   exactly `0.625` — because its denominator is a power of two. But a decimal
   fraction usually does **not** terminate in binary: `0.1` is
   `0.00011001100110011…₂` forever. A converter that just prints some bits is
   lying by omission. This one computes the fraction as an exact rational,
   **rounds the last bit to nearest**, and **tells you whether the answer is
   exact or was rounded** — and to how many bits.

## What it computes

- **Binary → decimal**, always exact, for integers and fractions of any length,
  with an optional sign.
- **Decimal → binary**, exact for the integer part at any size; the fractional
  part to a chosen number of bits (default 52), flagged **exact** when it
  terminates and **rounded** when it can't.
- **A round-trip check** shown alongside each result: convert, convert back, and
  confirm you land where you started.

## How the core works

All the logic lives in [`converter-core.js`](./converter-core.js), which is
DOM-free, console-free and I/O-free, so the identical file runs in the browser
and under Node for the tests.

- **`binToDec(str)`** — folds the integer bits into a `BigInt`; for the fraction
  it uses `1/2ᵏ = 5ᵏ/10ᵏ`, so the whole thing stays exact integer arithmetic and
  the decimal digits fall out directly. Validates that the string is `0`/`1`
  with at most one binary point.
- **`decToBin(str, fracBits)`** — integer part by repeated division by two over
  `BigInt`; fraction part by repeatedly doubling an exact `num/den` rational,
  reading off the carry bit each step. Stops when the remainder hits zero
  (**exact**) or the bit budget runs out (**rounded**, with round-to-nearest
  that correctly carries — `0.9` to one bit rounds up to `1`).
- **`roundTripDec(str, fracBits)`** — the single entry point the UI leans on:
  decimal → binary → decimal, returned together so a viewer can *see* the round
  trip close.

`index.html` + `script.js` are only a thin form over that core.

## Tests

A dependency-free suite covers both directions on integers and fractions, the
sign handling, the leading/trailing-zero tidy-up, and every rejection
(`2`, `1.2.3`, `0x10`, empty, …). It nails the two traps directly: **2⁶⁰ and a
128-bit number convert exactly** where `parseInt` would not, and **`0.1`
converts to a rounded, explicitly-flagged binary** rather than a fake-exact one
— including the case where rounding carries all the way into the integer part.
Three property sweeps then check the *behaviour*, not single examples: every
integer 0–2000 round-trips both ways, 500 random integers up to ~2¹⁶⁰ round-trip
exactly, and every 6-bit binary fraction round-trips exactly.

```bash
node projects/phase2-numbers/binary-decimal-converter/tests.js   # -> 57 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
