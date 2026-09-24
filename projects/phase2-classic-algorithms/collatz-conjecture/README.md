# Collatz Conjecture

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**first entry of its Classic Algorithms category**, and the twenty-third
Source 2 project overall. It opens a new category after the routine finished
all 22 projects in the **Numbers** category (the last of which was
[Fast Exponentiation](../../phase2-numbers/fast-exponentiation/)).

> "Collatz Conjecture — check if a number is even or odd. If it's even, divide
> it by 2. If it's odd, multiply it by 3 and add 1. Repeat until you reach 1."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. Type a starting
number and it plays out the whole **hailstone sequence** to 1: it counts the
steps, tracks the highest altitude it reaches, plots the climbs and plunges on a
log scale, and — in a second panel — sweeps a whole range to find the numbers
with the longest orbits and the highest peaks.

## What it does

- **The full trajectory, over BigInt.** From your number it applies `n/2` (even)
  or `3n+1` (odd) until it hits 1, keeping every value exactly — so
  `27`'s famous climb to **9,232** and `63,728,127`'s soar past **966 billion**
  are precise, not rounded.
- **Counts what matters.** Total stopping time (steps to reach 1), the peak value
  and where in the orbit it occurs, and the even/odd step split.
- **A log-scaled hailstone chart.** One bar per value — amber for a climb
  (`3n+1`), blue for a fall (`n/2`), green for the peak — so the trademark
  up-and-down "hailstone" motion is visible at a glance. Heights are
  log-scaled because a single orbit can span a dozen orders of magnitude.
- **The shortcut map too.** A toggle switches to the accelerated map
  `T(n) = (3n+1)/2` for odd `n` — folding each `3n+1` and the halving that must
  follow it into one step. It's the form number theorists actually study, and
  the app shows its orbit is always a subset of the standard one.
- **A record hunt.** Sweep `1 … N` and it names the champions: the number with
  the longest orbit (e.g. **6,171** with 261 steps under 10,000) and the one
  that climbs highest. A **memoised** pass makes the whole range cost about as
  much as one long walk.

## The interesting part: it's really about binary digits

Whether a number is even or odd is nothing more than its **last binary bit**. So
the whole map is secretly a statement about binary:

- an **even** step (`n/2`) just **drops a trailing zero** — a pure right-shift;
- an **odd** step (`3n+1`) shuffles the bits upward and forces a new trailing
  zero, which the next even step immediately sheds.

That's why the **shortcut map** is the honest one to study: every `3n+1` is
guaranteed even, so pairing it with the halving that always follows loses no
information and halves the bookkeeping.

```js
// projects/phase2-classic-algorithms/collatz-conjecture/collatz-core.js
function step(n)         { return isEven(n) ? n / TWO : THREE * n + ONE; }
function shortcutStep(n) { return isEven(n) ? n / TWO : (THREE * n + ONE) / TWO; }
```

## The record hunt: one walk, not N walks

Finding the longest orbit in `1 … N` naïvely re-walks every number from scratch.
But orbits **merge**: once two starts reach the same value, their remaining paths
are identical. So the sweep caches each value's `(steps, peak)` and, for a new
start, walks only until it lands on something already known:

```js
// walk until we reach an already-known value (1 is known), collecting the path
while (true) {
  if (cur <= limBig && steps[Number(cur)] !== undefined) { /* known tail */ break; }
  stack.push(cur);
  cur = step(cur);
}
// then fold the walked prefix back in — each hop is +1 step, peak is the running max
```

Values above the ceiling are folded into the peak but never cached, so memory
stays bounded by the range rather than by how high the orbits fly. The result is
that a sweep of 100,000 numbers finishes in a few milliseconds.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure and copy — the inputs, the result panel with stats, the trajectory chart, the raw sequence, the record hunt, and the "why it's fascinating" note. |
| `style.css` | The dark theme shared across the routine's projects, plus the hailstone chart and sequence styling. |
| `collatz-core.js` | The DOM-free brain: the standard and shortcut maps, full-trajectory analysis over BigInt, and the memoised record sweep. |
| `script.js` | The thin UI layer. Reads the inputs, calls the core, paints the stats, the log-scaled chart and the records. No Collatz math of its own. |
| `tests.js` | A dependency-free suite (82 checks) run with Node. |

## Running the tests

```bash
node projects/phase2-classic-algorithms/collatz-conjecture/tests.js
```

The suite checks all four layers: the single-step map and parity rules, the full
trajectory (against hand-verified sequences like `6 → 3 → 10 → 5 → 16 → 8 → 4 →
2 → 1` and against published OEIS step counts — `27` in 111 steps, `871` in 178,
`6171` in 261 — plus an internal re-check that every value really is its
predecessor's Collatz step), the shortcut map (proving its orbit is a subset of
the standard one), and the memoised records sweep (cross-checked against a slow,
direct brute-force scan and against the known record-holders 871 and 6,171).

## Design notes

- **The core never touches the DOM.** `collatz-core.js` has no `window`,
  `document` or `fetch`, so the numbers the UI shows are exactly the numbers the
  tests prove. `script.js` only reads inputs and paints.
- **BigInt everywhere.** Collatz peaks overflow `Number` quickly (`63,728,127`
  already reaches ~9.7 × 10¹¹, and larger seeds go far higher), so every value
  is an arbitrary-precision BigInt. That's why the altitudes are exact.
- **The chart is log-scaled on purpose.** A linear axis would flatten the entire
  descent into a sliver beneath one spike. Log scale is what makes the repeated
  climbs and falls — the "hailstone" shape — readable.
- **Memoise, don't re-walk.** The record hunt exploits the fact that orbits
  merge, turning an `O(N × orbit length)` brute force into roughly `O(total
  distinct steps)`. The test suite pins it to the brute-force answer so the
  optimisation can't silently drift.
