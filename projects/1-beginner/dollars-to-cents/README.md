# Dollars to Cents

Enter a dollar amount and convert it to a whole number of cents, then see that
total broken down into the fewest coins possible. No frameworks — just a little
arithmetic.

Source idea: [app-ideas / Dollars to Cents App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Dollars-To-Cents-App.md)

## Features

- **Dollar → cents** — accepts floats like `$2.75` and reports `275` cents.
- **Fewest-coins breakdown** — splits the total into quarters, dimes, nickels,
  and pennies using the minimum number of coins.
- **Validation** — inline warnings for empty or negative/invalid input.

## How it works

Converting dollars to cents looks trivial, but `2.75 * 100` can drift to
`274.9999…` in floating-point, so `toCents()` rounds to the nearest integer to
stay exact. The coin breakdown is a greedy pass from the largest denomination
down — for the canonical US coin set (25/10/5/1) greedy always yields the
minimum coin count, so each step takes as many of the current coin as fit and
carries the remainder forward.

## Run it

Open `index.html` in any browser — no build step or dependencies.
