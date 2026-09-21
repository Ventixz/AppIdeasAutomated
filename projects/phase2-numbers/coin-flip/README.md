# Coin Flip Simulation

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
twentieth entry of its **Numbers** category, following
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
[Happy Numbers](../happy-numbers/) and
[Number Names](../number-names/).

> "Coin Flip Simulation — write a program that simulates flipping a coin. It
> should print how many heads and tails came up."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. It does exactly what
the brief asks — flip a coin *n* times and count heads and tails — and then makes
the run worth looking at: the longest streaks, the number of runs, and the
proportion of heads settling toward the coin's true bias.

## What it does

- **Counts heads and tails** over any number of flips, from 1 to 50,000,000.
- **Is reproducible.** Every run is driven by a **seeded** generator, not
  `Math.random()`, so the same seed and count always produce the identical
  coins. Type `42` (or `hello`) and you get the same run every time.
- **Shows the streaks.** It reports the longest unbroken run of heads and of
  tails, and the total number of runs (how many times the face switched).
- **Watches the Law of Large Numbers.** It samples the running proportion of
  heads at 1, 10, 100, … flips, so you can see it swing wildly at first and then
  get pulled toward `P(heads)` as the flips pile up.
- **Compares the run to theory.** Alongside the counts it shows the expected
  heads `n·p`, the standard deviation `√(n·p·(1−p))`, this run's **z-score**
  (how many SDs from expected), and the expected longest run.
- **Handles biased coins.** `P(heads)` defaults to a fair `0.5` but accepts any
  probability strictly between 0 and 1, and every statistic uses it.

## The interesting part: a *seeded* simulation, so the randomness is checkable

A coin-count is trivial. The real question for any simulation is: **can you trust
it, and can you check it?** Both answers come from refusing `Math.random()` and
using a seeded pseudo-random generator instead — here **mulberry32**, with word
seeds hashed to 32 bits by **xmur3**:

```js
// projects/phase2-numbers/coin-flip/coin-core.js
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;   // a float in [0, 1)
  };
}
```

Because the stream is a pure function of the seed, **a seed is a promise**: seed
42 with 1000 fair flips *always* comes out to exactly 480 heads, 520 tails, a
longest heads streak of 9 and a longest tails streak of 11. That is the
random-process analogue of a round-trip — pin the seed and the output is a fact,
so the test suite can assert those exact numbers instead of hand-waving about
"roughly half".

Everything is collected in **one pass with O(1) memory**: the totals, the longest
streak of each face, the number of runs, and the proportion checkpoints. Nothing
stores the full sequence, so a ten-million-flip run costs no more memory than a
ten-flip one.

## The theory it's measured against

For *n* independent flips with head-probability *p*, the head count follows a
**Binomial(n, p)** distribution: mean `n·p`, standard deviation `√(n·p·(1−p))`.
The **z-score** `(heads − n·p) / √(n·p·(1−p))` says how surprising a run is — under
about 2 is ordinary, over 3 is rare. And the expected longest run of heads is
about `log_{1/p}(n)` (≈ `log₂ n` for a fair coin), which is why a fair
thousand-flip run routinely shows a streak of ~9: long streaks are normal, not a
bug.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure and copy — the controls, the two piles, the streak/theory panel, the Law-of-Large-Numbers rows, the "how it works" note. |
| `style.css` | The dark theme shared across the routine's projects. |
| `coin-core.js` | The DOM-free brain: the seeded generator, the single-pass simulation, and the binomial theory. |
| `script.js` | The thin UI layer. Reads inputs, calls the core, paints the result. No simulation logic of its own. |
| `tests.js` | A dependency-free suite (280+ checks) run with Node. |

## Running the tests

```bash
node projects/phase2-numbers/coin-flip/tests.js
```

The suite checks concrete numbers, not tolerances: it locks in the **exact**
head/tail counts and streak lengths for a known seed, confirms the invariants
that must hold for *any* seed (heads + tails = n, streaks bounded by their pile,
checkpoints in order), verifies biased coins land near their `p`, checks the
theory block against closed-form values, and confirms — over tens of thousands of
draws — that a fair generator really is fair and that the Law of Large Numbers
pulls big runs toward `0.5`.

## Design notes

- **The core never touches the DOM.** `coin-core.js` has no `window`, `document`
  or `fetch`, so the exact numbers the UI shows are the numbers the tests prove.
  `script.js` only reads inputs and paints.
- **Seeded, never `Math.random()`.** Reproducibility is the whole design; the "New
  random seed" button just picks a fresh seed and re-runs, so even a "random" run
  is one you could reproduce by reading its seed back.
- **O(1) memory.** The simulation keeps running tallies only, so the flip count
  is bounded by patience, not RAM (capped at 50,000,000 to keep the page
  responsive).
- **Biased coins are first-class.** `P(heads)` flows through the counts, the
  streaks and every statistic, so an 80%-heads coin shows both the skewed counts
  and the longer heads streaks the theory predicts.
