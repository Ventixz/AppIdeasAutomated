# Pearson Regression

Calculate the **Pearson correlation coefficient** between two data sets to see
how strongly they move together. Enter `x`/`y` pairs (or upload a CSV), press
**Calculate**, and the app reports the means, standard deviations, the
coefficient `r`, a plain-English interpretation, and a scatter plot with a
fitted regression line.

Source idea: [app-ideas / Pearson Regression](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Pearson-Regression-App.md)

## Features

- **Add points** — type an `x` and `y`; non-numeric input is rejected with a
  clear error message.
- **Editable table** — every observation is listed and can be removed
  individually.
- **Guarded Calculate** — the button stays disabled until at least two valid
  points exist (you can't correlate a single point).
- **Results** — arithmetic means (x̄, ȳ), population standard deviations
  (σₓ, σᵧ), and the coefficient `r` with an interpretation band
  (none → weak → moderate → strong → very strong, signed by direction).
- **Scatter plot + regression line** *(bonus)* — points and a least-squares line
  drawn on a `<canvas>`, no charting library.
- **File upload** *(bonus)* — load a CSV / whitespace-separated two-column file;
  header rows and junk lines are skipped automatically.
- **Sample data** — one click loads a "hours studied vs. exam score" set so you
  can see a strong positive correlation immediately.

## The math (no libraries)

Everything is computed by hand in `script.js`:

```
r = Σ(xᵢ − x̄)(yᵢ − ȳ) / √( Σ(xᵢ − x̄)² · Σ(yᵢ − ȳ)² )
```

The regression line uses the least-squares slope `b = r · (σᵧ / σₓ)` passing
through the centroid `(x̄, ȳ)`. When a variable has no spread the denominator is
zero, so `r` is reported as undefined rather than dividing by zero.

## Run it

Open `index.html` in any browser — no build step or dependencies. Click
**Load sample data** for an instant demo, or add your own points.

A few pure helpers are exposed on `window.__pearson` (`mean`, `stdDev`,
`pearson`, `interpret`) for quick sanity checks from the console.
