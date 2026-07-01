# Random Number Generator

Set a minimum and a maximum, press **Generate**, and get a random number inside
that range. Ranges can span negatives, and an optional toggle switches from
whole numbers to decimals with a configurable number of places.

Source idea: [app-ideas / Random Number Generator](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Random-Number-Generator.md)

## Features

- **User-defined range** — type any minimum and maximum values.
- **Generate button** — one click produces a fresh random number.
- **Negative values** *(bonus)* — ranges like `-50` to `50` work as expected.
- **Decimals** *(bonus)* — flip on *Allow decimals* and choose 0–10 places.
- **Guardrails** — clear messages for blank inputs, an inverted range, or a
  whole-number range with no integer inside it (e.g. `1.2`–`1.8`).

## How it works

`script.js` reads `min`/`max` with `parseFloat`. For integers it snaps the
bounds inward (`Math.ceil` on min, `Math.floor` on max) and uses the classic
`Math.floor(Math.random() * (hi - lo + 1)) + lo` formula so both ends are
inclusive. For decimals it scales `Math.random()` across the range and rounds
to the requested precision with `toFixed`. The result animates on each press,
and the *Places* field is disabled until decimals are enabled.

## Run it

Open `index.html` in any browser — no build step, no dependencies.
