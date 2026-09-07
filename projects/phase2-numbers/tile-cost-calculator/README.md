# Find Cost of Tile to Cover a W×H Floor

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
sixth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/) and
[Next Prime Number](../next-prime-number/).

> "Find the total cost of tile it would take to cover a floor plan of width and
> height, using a cost entered by the user."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Enter a floor (width × height), a tile size, a
price, and optionally a box size, a waste percentage and sales tax; it returns
how many tiles (or boxes) to buy and the cost to the cent.

## Why this isn't a one-liner

The textbook answer is `cost = W * H * pricePerSquareFoot`. Typed into a
calculator that's fine; as a tool people would actually order tile from, it's
wrong twice over:

1. **You can't buy part of a tile — and offcuts don't reappear.** A tile is a
   physical rectangle. Multiplying areas quietly assumes you can slice a tile and
   glue the leftover to the far wall. Real layouts don't work that way: the piece
   you cut off the end of a row is scrap, not the start of the next row. Counting
   *tiles* instead of *area* means rounding **each direction up** independently,
   which is a different — and always larger — number than rounding the area.
2. **Money and measurements are decimals, and floating point gets decimals
   wrong.** Rooms are `12.5 ft`, tiles are `12"`, prices are `$2.49`, tax is
   `8.25%`. In IEEE-754 doubles, `0.1 + 0.2` is `0.30000000000000004`, and a
   fraction of a cent per tile becomes real error across a few hundred tiles.
   Every value here is an **exact rational** — a `BigInt` numerator over a
   `BigInt` denominator — so nothing rounds until the two places we actually
   want it to.

## Two honest tile counts

The core reports **both** models, because they genuinely differ and the gap
between them *is* the cutting waste:

- **By layout (the contractor's estimate)** — `ceil(W / tileW)` tiles across ×
  `ceil(H / tileH)` down. Each row is laid with whole tiles and the last one in
  the row is cut to fit; the offcut is **not** reused. This is what you buy.
- **By area (the theoretical floor)** — `ceil(roomArea / tileArea)`: the fewest
  whole tiles whose combined area could cover the floor if every scrap were
  reused perfectly. Always **≤** the layout count.

For a 10 ft × 10 ft room tiled with 7"-wide tiles the layout method needs
**180** tiles and the area method **172** — the 8-tile difference is the waste
the layout builds in for free. On top of that you can add an explicit
**waste / overage %** (breakage, future repairs) and, if you buy by the box, the
order rounds up to whole **boxes**.

## How the core works

All the arithmetic lives in [`tilecost-core.js`](./tilecost-core.js), which is
DOM-free, console-free and I/O-free, so the identical file runs in the browser
and under Node for the tests.

- **`Fraction`** — an exact rational over `BigInt`, always reduced, with
  `add / sub / mul / div / cmp`, a `ceil()` (the "round tiles up" primitive) and
  a half-up `toFixed(places)` (the only place a value ever becomes a fixed number
  of decimals — for display).
- **`parseDecimal(str)`** — turns `"12.5"`, `".75"`, `"1,000.50"` into an exact
  `Fraction`, rejecting anything that isn't a clean non-negative decimal.
- **Units convert exactly.** A room in feet and a tile in inches — or a whole job
  in metres — combine without rounding: `1 ft = 12 in`, `1 m = 5000/127 in`,
  both exact `Fraction`s, so `2.54 cm` is *exactly* `1 in`.
- **`tilesByGrid` / `tilesByArea`** — the two models above.
- **`estimate(input)`** — the single entry point the UI and tests call. It takes
  the raw strings, converts units, counts tiles both ways, applies waste and
  box-rounding, then computes subtotal, tax and total — all exact until the final
  cent.

`index.html` + `script.js` are only a thin form over that core.

## Tests

A dependency-free suite covers the exact-arithmetic traps (`0.1 + 0.2 === 0.3`,
`$2.005 → $2.01` half-up), unit conversions (`2.54 cm === 1 in`), both counting
models, waste-and-box rounding, tax, and input validation. It then leans on an
**invariant sweep**: for 400 random rooms and tiles, the layout count laid out as
a rectangle of whole tiles must physically span the room in both directions, and
the area count must never exceed it — checking the models against their
definitions, independently of the arithmetic that produced them:

```bash
node projects/phase2-numbers/tile-cost-calculator/tests.js   # -> 46 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
