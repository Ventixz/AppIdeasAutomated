# Calculator

A classic four-function calculator with a fixed **8-digit** display, built
without using JavaScript's `eval()`.

Source idea: [app-ideas / Calculator](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Calculator-App.md)

## Features

- Digit pad (0–9), the four operations (`+`, `−`, `×`, `÷`), and `=`.
- **C** clears the last entry; if the last press was an operator, it cancels
  that operator and restores the preceding value.
- **AC** wipes every working value back to `0`.
- Numbers are capped at 8 digits — extra digits are ignored.
- `ERR` is shown when a result can't fit on the display (or on divide-by-zero);
  only **AC** recovers from it.

### Bonus features

- **+/−** toggles the sign of the displayed number.
- Decimal point support, rounded to 3 decimal places.

## Run it

Open `index.html` in any browser — no build step or dependencies.
