# Happy Numbers

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
eighteenth entry of its **Numbers** category, following
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
[Factorial Finder](../factorial-finder/) and
[Complex Number Algebra](../complex-number-algebra/).

> "Happy Numbers — **a happy number is defined by the following process:**
> starting with any positive integer, replace the number by the sum of the
> squares of its digits, and repeat the process until the number equals 1 (where
> it will stay), or it loops endlessly in a cycle that does not include 1. Those
> numbers for which this process ends in 1 are happy numbers; those that do not
> are unhappy."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. It does exactly what
the brief asks — decides whether a number is happy — and around that shows the
*whole path* it takes, plots it, and stretches the idea to inputs with thousands
of digits and to other bases and powers.

## What it does

- **Classifies any number** as happy or unhappy, and shows the **full
  trajectory** as a chain of chips: `7 → 49 → 97 → 130 → 10 → 1` (happy), or
  `4 → 16 → 37 → 58 → 89 → 145 → 42 → 20 → 4` (unhappy — the loop is highlighted).
- **Plots the sequence** — the value at every step on a small canvas, so a happy
  path visibly dives to 1 and an unhappy one flattens into its cycle.
- **Handles enormous inputs.** Paste a 302-digit number (there's a `2^1000`
  preset) and it still answers instantly — because the first step is taken
  straight from the digit string and collapses any number to something small.
- **Flags happy primes** (7, 13, 19, 23, 31, …) when you're playing the standard
  base-10 / squares game.
- **An explorer** colours every number from 1 to a limit by its fate, reports the
  share that are happy, and looks up the *k*-th happy number.
- **Generalises** to any base (2–36) and any digit power (1–10), detecting the
  terminating cycle directly rather than assuming which one it'll be.

## The interesting part: why this terminates, and how huge inputs stay cheap

The definition sounds like it could run forever, and the honest question is *why
doesn't it?* Two facts carry the whole project.

**1. The map shrinks big numbers in a single step.** A `d`-digit number's
digit-square-sum is at most `81·d` (every digit is at most 9, and `9² = 81`). So
a 4-digit number maps to at most `324`, a 3-digit number; and after *one* step
**every** input, however enormous, is already below 1000. From there the
sequence wanders a finite set of small numbers, so by the pigeonhole principle it
must eventually revisit a value — the process cannot help but terminate, either
at the fixed point `1` or in a cycle.

That same fact is what lets the core classify a number with thousands of digits
without ever holding it as a float (which would be `Infinity`, or a lie past
`2^53`). For a big input it reads the **digit string directly**, sums the powered
digits into a small integer, and only then starts iterating:

```js
// projects/phase2-numbers/happy-numbers/happy-core.js
function firstStepFromDigits(str, base, power) {
  var sum = 0;
  for (var i = 0; i < str.length; i++) {
    var d = digitValue(str.charAt(i));
    // ...validate d against base...
    var t = 1; for (var k = 0; k < power; k++) t *= d;
    sum += t;                       // at most 81 per digit, base 10 power 2
  }
  return sum;                       // small — normal Number arithmetic from here
}
```

So `2^1000` (302 digits) is classified in microseconds: its first step is just a
sum of a few hundred squared digits.

**2. In base 10 with squares there is exactly one unhappy cycle** — the 8-long
loop `4 → 16 → 37 → 58 → 89 → 145 → 42 → 20 → 4`. Every unhappy number, without
exception, drains into *that* loop. So "happy" is precisely "does not reach the
4-cycle." The code does **not** hard-code this to decide happiness — it detects a
repeat honestly, which is what makes the same core correct for other bases and
powers (where the cycles are different, and in base 4 there are *no* unhappy
numbers at all). But the test suite asserts the fact by classifying every start
up to 2000 and confirming the unhappy ones fall into exactly one cycle — because
that uniqueness is the reason the whole notion is well-defined.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure and copy — the classifier, the explorer, the "why it terminates" note. |
| `style.css` | The dark theme shared across the routine's projects. |
| `happy-core.js` | The DOM-free brain: the step map, big-input first step, trajectory + cycle detection, memoised bulk classifier, ranges, *k*-th happy, happy primes. |
| `script.js` | The thin UI layer. Reads inputs, calls the core, paints the verdict, chain, plot and grid. No happy-number logic of its own. |
| `tests.js` | A dependency-free suite (56 checks) run with Node. |

## Running the tests

```bash
node projects/phase2-numbers/happy-numbers/tests.js
```

The suite checks concrete truths, not tolerances: the two textbook trajectories,
the canonical happy list below 100 (matching OEIS A007770), the guarantee of
exactly one unhappy cycle in base 10 with squares, huge string inputs going
through the digit-string first step, the memoised range/`k`-th helpers agreeing
with the plain classifier, happy primes (OEIS A035497), and the generalisations —
that *every* number is happy in base 4, and that `153` (a narcissistic number) is
a fixed point under cubes and so loops without reaching 1.

## Design notes

- **The core never touches the DOM.** `happy-core.js` has no `window`,
  `document` or `fetch`, so the exact logic the UI shows is the logic the tests
  prove. `script.js` only reads inputs and paints.
- **Big inputs are first-class, not an afterthought.** Numbers within
  `Number.MAX_SAFE_INTEGER` iterate as plain integers; anything larger is accepted
  as a string or `BigInt` and reduced by the digit-string first step.
- **Bulk queries are memoised.** Once a value's fate is known it's cached, so the
  explorer, range counts and *k*-th lookups reuse each other's work instead of
  re-walking shared tails.
- **Cycles are detected, not assumed.** Recording the path and stopping on the
  first repeat means the same code is correct for every base and power, and can
  *report* the cycle it found rather than printing a memorised one.
