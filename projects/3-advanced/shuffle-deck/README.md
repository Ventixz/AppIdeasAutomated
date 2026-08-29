# Shuffle Deck Benchmark

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Shuffle Deck spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Shuffle-Deck-App.md).

The spec is really about **measuring app performance**: implement a couple of
pseudorandom number generators and benchmark them. A card shuffle is the perfect
workload for that — a shuffle is nothing but a tight loop of RNG calls — so this
app races generators by timing how long each one takes to shuffle a 52-card deck
a number of times you choose.

Open `index.html` in a browser. **No build step, no server, and no
dependencies** — just an HTML page and two scripts.

## User stories from the spec

- ✅ **Input panel** with a rounds text box, three output boxes (**start time**,
  **end time**, **total time**), and algorithm buttons for **JS Random** and
  **Xorshift**.
- ✅ Enter **1–10,000 rounds** to specify how many shuffles each run performs.
- ✅ Clicking an algorithm button **runs that generator** for the chosen number
  of rounds.
- ✅ **Validation warnings** for a missing, non-numeric, fractional, or
  out-of-range round entry.
- ✅ Results appear in a **table** showing algorithm name, start time, end time,
  and elapsed time.
- ✅ A **warning dialog** appears if you change the round count before all the
  algorithms have been run.
- ✅ The dialog offers **Cancel** (dismiss, revert the field) and **OK** (clear
  results and proceed) — so every algorithm is always compared over the same
  number of shuffles.

### Bonus features

- ✅ A **third algorithm button** for **WELL512a**, ported from the reference
  `WELL512a.c`.
- ✅ **Performance analysis** — once two or more algorithms have run, a line
  spells out the fastest and slowest generators and how many times slower the
  slowest is.

## The three generators

| Algorithm | State | Notes |
| --- | --- | --- |
| **JS Random** | — | The built-in `Math.random`. The honest baseline; can't be seeded. |
| **Xorshift** | 32 bits | Marsaglia's `xorshift32` — three shifts and three XORs. About as small as a usable generator gets. |
| **WELL512a** *(bonus)* | 512 bits | Panneton–L'Ecuyer–Matsumoto's "Well Equidistributed Long-period Linear" generator. Period 2⁵¹²−1 and far better equidistribution, at more work per draw. |

Each generator is a factory that returns a `Math.random`-style function yielding
a float in `[0, 1)`. The shuffle itself is an unbiased **Fisher–Yates**.

## Architecture — engine vs. presentation

As with every other advanced project here, all the logic lives in a
**presentation-free engine** (`shuffle-core.js`). It never touches the DOM, a
timer widget, or a button — you hand it a round count and a clock and it hands
back a result object (`{ label, start, end, elapsed, rounds }`). That means the
**exact same code** runs in the browser and under Node in `tests.js`.

- `shuffle-core.js` — the three RNGs, the Fisher–Yates shuffle, rounds
  validation, the benchmark runner, the "have all core algorithms run?" gate,
  and the fastest-vs-slowest analysis.
- `script.js` — the browser layer: reads the input, runs a benchmark on
  `performance.now`, paints the table, and drives the confirmation dialog.
- `index.html` / `style.css` — the page and its styling.
- `tests.js` — the test suite.

Because the engine takes the clock as a parameter, the tests inject a **fake
clock** and a **fixed seed**, so every timing and every shuffle is exact and
nothing is flaky.

## Running the tests

```bash
node tests.js
```

41 assertions cover the RNG output range, deterministic seeding (and the
zero-seed guard), that a shuffle is always a true permutation of all 52 cards,
rounds validation across every edge, the benchmark's use of the injected clock,
the completion gate, and the fastest/slowest analysis.

## A note on measurement

Timings depend on your machine, browser, and how warm the JIT is. Run each
algorithm a few times, and lean on larger round counts (say 5,000+) so the
numbers rise above measurement noise. The interesting result isn't the absolute
milliseconds — it's the **relative** ordering, and how it lines up (or doesn't)
with what you'd expect from each generator's complexity.
