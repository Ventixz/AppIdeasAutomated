# Color Cycle

A small RGB playground. Pick a starting color and a per-channel increment, hit
**Start**, and the swatch drifts through color space — applying the increments
once every interval so you can *see* what each channel does.

Source idea: [app-ideas / Color Cycle App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Color-Cycle-App.md)

## Features

- **Hex start color** — each of red, green, and blue takes a two-digit hex value.
- **Per-channel increments** — set how much each channel moves on every step
  (negative values cycle backwards).
- **Live swatch** — the box and a text readout update on every tick.
- **Start / Stop toggle** — one button that swaps its label and color with the
  running state.
- **Edit-only-when-stopped** — color and increment inputs lock while the cycle
  runs, matching the spec.
- **Hex validation warning** — non-hex input flags the offending field and shows
  an inline warning.

### Bonus features

- **Adjustable interval** — change the milliseconds between updates (defaults to
  the spec's 250 ms).
- **Format switch** — show the live color as RGB, HEX, or HSL.

## How it works

On Start, each channel's two-digit hex is parsed into a 0–255 value. A
`setInterval` ticks at the chosen rate; each tick adds the increments and wraps
the result back into 0–255 (`((n % 256) + 256) % 256`) so cycling never gets
stuck at an edge. The swatch always paints with `rgb(...)`; the readout reformats
to whichever encoding is selected.

## Run it

Open `index.html` in any browser — no build step or dependencies.
