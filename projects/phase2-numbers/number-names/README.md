# Number Names

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
nineteenth entry of its **Numbers** category, following
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
[Complex Number Algebra](../complex-number-algebra/) and
[Happy Numbers](../happy-numbers/).

> "Number Names — given a number, spell it out in words."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. It does exactly what
the brief asks — turns `1234` into *one thousand two hundred thirty-four* — and
then takes the word "number" seriously: any size, any sign, decimals, ordinals,
money, and the same thing in reverse.

## What it does

- **Names any integer, exactly.** Everything runs on `BigInt`, so a 200-digit
  number is spelled to the last digit — no float, no rounding, no `Infinity`.
- **Never runs out of scale words.** Past the everyday
  thousand/million/billion, it *generates* the Latin `-illion` names by the
  **Conway–Wechsler system**, so it can name a `centillion` (10³⁰³) and beyond
  — not a lookup table that stops at "quintillion".
- **Reads the whole number**, four ways: the plain **cardinal**
  (*one thousand…*), the **ordinal** (*twenty-third*, *one hundredth*), a
  **decimal** read digit-by-digit the way people say it (*twelve point zero
  five*), and **money** (*one thousand dollars and fifty cents*, rounded to
  cents).
- **Goes the other way too.** Type the words and it **parses** them back to an
  exact integer (*two million three thousand and one* → `2003001`).

## The interesting part: naming without a list, and proving it with the round-trip

**A number is chopped into groups of three digits.** Group 0 (the last three)
has no scale word; group 1 is *thousand*; group 2 is *million*, and so on. The
only real question is: what is the word for group number *g* when *g* is large?

Past *nonillion* the scale words are **not stored** — they are built from the
**Conway–Wechsler** rules. The name for the *z*-th `-illion` is assembled from
Latin roots for the units, tens and hundreds of *z*, glued together with the
system's *combining letters*, then a trailing vowel is dropped and `illion` is
added:

```js
// projects/phase2-numbers/number-names/names-core.js
function illionName(z) {              // z = 100  ->  "centillion" (10^303)
  if (z <= 9) return SMALL_ILLION[z] + 'llion';   // million..nonillion (irregular)
  return illionStem(z).replace(/[aeiou]$/, '') + 'illion';
}
```

The subtle bit is those combining letters. When a unit root like `tre` (3) meets
a component that "accepts" an *s* or *x*, it grows a letter: `tre + centi`
becomes **tres**centi, so index 103 is a `trescentillion`; `se + centi` becomes
**sex**centi, so 106 is a `sexcentillion`. Each tens/hundreds root carries the
set of letters it accepts, and the unit root reacts to it — which is exactly how
Conway and Wechsler defined it, and why index 23 comes out
`tresvigintillion` and index 27 `septemvigintillion`.

**Because the whole thing is exact, it can be proved by round-tripping.** The
core also *parses* an English phrase back to a `BigInt`, so the test suite spells
a number out and reads it back and demands the original — for **every** integer
from 0 to 5000, and for a spread of huge `BigInt`s straddling every group
boundary (a googol, a centillion, negatives). If any name were wrong, its
round-trip would miss.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure and copy — the input, the four registers, the reverse parser, the "how the big names are built" note. |
| `style.css` | The dark theme shared across the routine's projects. |
| `names-core.js` | The DOM-free brain: cardinal/ordinal naming, the Conway–Wechsler `-illion` generator, decimals, currency, and the reverse parser. |
| `script.js` | The thin UI layer. Reads inputs, calls the core, paints the words. No naming logic of its own. |
| `tests.js` | A dependency-free suite (100+ checks) run with Node. |

## Running the tests

```bash
node projects/phase2-numbers/number-names/tests.js
```

The suite checks concrete strings, not tolerances: the small irregulars, every
group boundary (including the awkward interior-zero cases like `1,000,123`), the
Conway–Wechsler `-illion` names up to `centillion`, negatives, decimals,
ordinals and money — and, hardest of all, the **round-trip** `cardinal → parse`
over every value in `0..5000` and a spread of enormous `BigInt`s.

## Design notes

- **The core never touches the DOM.** `names-core.js` has no `window`,
  `document` or `fetch`, so the exact words the UI shows are the words the tests
  prove. `script.js` only reads inputs and paints.
- **Big integers are first-class.** Numbers within `Number.MAX_SAFE_INTEGER`
  are accepted as plain `Number`s; anything larger is a string or `BigInt` and
  named to the last digit.
- **Scale words are generated, not tabled.** The `-illion` names come from the
  Conway–Wechsler rules, so there is no arbitrary ceiling short of index 999
  (numbers past ~10³⁰⁰²), where the core stops with a clear error rather than
  guess.
- **Money is fixed-point.** Cents are computed exactly with the dollars kept in
  `BigInt`, rounded half-up from the third decimal, carrying into the dollars
  when the cents round to 100.
