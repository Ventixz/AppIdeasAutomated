# Bit Masks

Search 16 cities by GMT offset — where the matching is done entirely with
**bitwise operations** instead of `if`/`switch` chains or `===` comparisons.

Source idea: [app-ideas / Bit Masks](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Bit-Masks-App.md)

## How the bit masking works

Every timezone from **GMT +12 down to GMT −12** is assigned one bit position in
a single 25-bit integer:

```
position = offset + 12
GMT +12 -> bit 24 ... GMT 0 -> bit 12 ... GMT -12 -> bit 0
```

- Each **city** stores a mask with exactly one bit set — its own timezone
  (`zoneBit(city.gmt)`).
- A **search** for offset _N_ builds `searchMask = zoneBit(N)`.
- A city matches when `(city.bit & searchMask) !== 0` — a bitwise AND, never an
  equality check on the offset itself.
- The **checked cities** are OR-ed together into a single selection mask, so the
  search only considers cities whose bit is present in that mask.

Each city row prints its bit inside the full 25-bit field (e.g. `1` for its zone,
`·` elsewhere) so you can see the mask that AND operates on.

## Features

- **16 cities**, GMT +9 through −7, each with a checkbox (per the spec).
- **Find Cities** by typing a GMT offset and pressing the button or Enter.
- **Live results** and a **count summary** of how many matched.

### Bonus features (from the spec)

- **Invert search** — a toggle to find cities _not_ in the entered zone, done by
  negating the AND result rather than adding branching logic.
- **Count summary** — the status line always reports the number of matches.

## Run it

Open `index.html` in any browser — no build step, no dependencies.

```bash
open projects/2-intermediate/bit-masks/index.html
```
