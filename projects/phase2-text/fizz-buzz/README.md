# Fizz Buzz

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**first entry of its Text category**, and the thirty-third Source 2 project
overall. It opens the Text category after the whole
[Data Structures category](../../phase2-data-structures/).

> "Write a program that prints the numbers from 1 to 100. But for multiples of
> three print 'Fizz' instead of the number and for the multiples of five print
> 'Buzz'. For numbers which are multiples of both three and five print
> 'FizzBuzz'."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Classic Fizz Buzz is a three-line program. The one idea worth more than three
lines — and the thing this playground is built around — is that the rules don't
have to be baked in. Make them **data**:

A **rule** is a `{ divisor, word }` pair. A number is replaced by the words of
every rule whose divisor divides it, joined in rule order, and kept as the
number when none match. Classic Fizz Buzz is then just the two rules
`3 → Fizz` and `5 → Buzz` — and `15`, divisible by both, naturally prints
`FizzBuzz` because both words concatenate.

From there the page lets you:

- **Edit the rules live.** Change a divisor or a word, add a third rule
  (`7 → Bazz`, say) or a fourth, delete one. The output grid rebuilds as you
  type, and each rule's word gets its own colour so you can see at a glance
  which numbers it claimed.
- **Pick any range.** Count `1 → 100`, or `1 → 15` to see the first FizzBuzz,
  or `-15 → 15` to watch it cross zero, or `100 → 1` to count **down** — the
  engine handles ascending and descending ranges and negative numbers alike.
- **See what the range did.** A tally shows how many numbers each word claimed
  and how many fell through unmatched, as bars and percentages.
- **Copy the output** as plain text, one line per number.
- **Trust it.** A live **✓ Verified** line re-checks every line in the grid
  against a second, independent statement of the rules (see below), so the proof
  travels with the output.

## The design decisions

A few small choices that the one-liner version never has to make, all pinned by
tests:

- **Zero is a multiple of everything.** `0 % d === 0` for every `d`, so in a
  range that includes `0` it prints the concatenation of *all* words
  (`FizzBuzz` for the classic rules). That's the mathematically honest answer,
  not a special case.
- **Divisibility ignores sign.** `-3` is a multiple of `3`, so `-3 → Fizz` and
  `-15 → FizzBuzz`. Negative ranges behave exactly like positive ones.
- **Rule order is output order.** The words concatenate in the order the rules
  are listed, so `[3→Fizz, 5→Buzz]` gives `FizzBuzz` at 15 while the reversed
  list gives `BuzzFizz`. Nothing is sorted behind your back.
- **Bad rules are rejected, not guessed.** A divisor must be a **positive
  integer** and a word must be **non-empty**; a divisor of `0` has no sensible
  meaning here and is refused rather than silently treated as "matches
  everything". The UI simply ignores a half-typed rule until it's valid again.
- **The range is capped** at 100,000 numbers, in the engine itself, so a
  fat-fingered `1 → 1000000000` can't hang the page.

## How it's verified

`tests.js` is a dependency-free suite. Its core trick is an **independent
oracle**: a naive from-scratch re-statement of the rules (`oracleLine` — "for
each rule, if the divisor divides n, append the word") that shares no code with
the engine's `range`/`label`. The two must produce the **identical** sequence:

- on the canonical `1 → 100` game and several hand-built rule sets, and
- across a **randomised fuzz loop** — hundreds of random rule sets over random
  ranges (ascending, descending, and straddling zero), checking thousands of
  individual lines.

Hand-worked cases nail down the textbook first fifteen lines, rule-order
concatenation, the zero/negative conventions above, the descending range, the
span cap, and every input-validation rejection. `stats` is cross-checked against
a separate hand re-count of the same range. The same oracle idea runs **live in
the browser** — that's the ✓ Verified line — so a regression would show up on
the page, not just in CI.

Run it:

```bash
node projects/phase2-text/fizz-buzz/tests.js
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the rule editors, range controls, output grid, and stats panel. |
| `style.css` | The dark house-style theme, one colour per rule word. |
| `fizzbuzz-core.js` | The engine — `label`, `range`, `stats`, rule validation. No DOM, runs in Node and the browser. |
| `script.js` | Browser glue — reads the controls, paints the grid, runs the live verification. |
| `tests.js` | The dependency-free suite and the independent oracle. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
