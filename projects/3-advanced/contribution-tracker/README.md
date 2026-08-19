# Contribution Tracker

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Contribution Tracker spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Contribution-Tracker-App.md).

Record your charitable contributions and watch them roll up into monthly and
yearly analytics. It's a small single-page app with three views reached through
the navigation bar's **hamburger menu** — a **Transactions** ledger, a
**Dashboard** of charts, and an **About** page — plus a footer with an About
link on every page, exactly as the spec lays out.

Open `index.html` in a browser. No build step or server required.

## What it does

- **Transactions page.** An input panel takes a date, payee, amount and memo,
  with **Clear** and **Add** buttons. Bad input is caught and reported in a
  single **consolidated error box** (invalid date, blank payee, non-numeric
  amount — all at once). Every row in the ledger below has **Modify** and
  **Delete** buttons.
  - *Modify* loads the row back into the input panel and relabels **Add → Modify**;
    submitting updates the row in place instead of adding a new one.
  - *Delete* opens a **confirmation dialog** with **Cancel** and **Okay**.
- **Dashboard page.** Hand-drawn SVG charts summarize your giving: a
  **contributions-by-month** bar chart for the chosen year, a **total-by-year**
  chart colored by whether each year rose or fell, and headline cards for the
  **year-over-year change** and the **average per contribution / per active
  month**.
- **About page.** Who built it (this routine) and where the idea came from.

### Bonus features from the spec

- **Date picker** — the date field is a native calendar input.
- **Alternating row colors** in the ledger.
- **Sortable columns** — click any header (Date, Payee, Amount, Memo) to sort;
  click again to flip direction. The choice is remembered.
- **Export** — the ledger exports to **CSV** or **JSON**, and a **Print / PDF**
  button produces a clean, ledger-only printout you can save as a PDF.
  (JSON files can be imported back in.)

## Honoring the spec's constraints

The spec is unusually specific about two things, and this build follows both:

- **"Monetary calculations must be done manually — no third-party libraries."**
  Every amount is parsed straight into an **integer number of cents** and all
  the arithmetic (totals, averages, year-over-year deltas, currency formatting
  with thousands separators) is done on integers. No floating-point dollars are
  ever added, so the classic `0.1 + 0.2` rounding drift simply cannot happen —
  there's a test that pins it.
- **"Sensitive data, like transactions, must not be maintained in local
  storage."** Transactions are therefore **not** kept in `localStorage`. They
  live in an **IndexedDB** database in the browser (the spec's "database"
  persistence), and can be exported to a **file** at any time. Only the theme
  and the last sort choice — non-sensitive UI preferences — use `localStorage`.

## Architecture — logic vs. presentation

As with the other advanced projects here, all the rules live in a
**presentation-free engine** (`contrib-core.js`). It knows nothing about the
DOM, IndexedDB, or SVG — only how to parse and validate a contribution, do the
money maths by hand, keep an immutable ledger, sort it, and aggregate it into
the dashboard's numbers. The exact same code runs in the browser and in the Node
test suite.

```js
const C = require('./contrib-core.js');
C.parseAmount('$1,200.00');        // -> 120000  (cents, no floats)
C.formatMoney(120000);             // -> "$1,200.00"
C.yearOverYear(ledger);            // -> [{ year, cents, deltaCents, pct }, ...]
```

Because the engine is pure, it ships a dependency-free test suite covering money
parsing/formatting, date validation, consolidated entry validation, immutable
add/modify/delete, sorting, every analytics rollup, and corrupt-row recovery on
import:

```bash
node projects/3-advanced/contribution-tracker/tests.js   # -> 82 passed, 0 failed.
```

## Files

| File | Role |
| --- | --- |
| `index.html` | The SPA shell — nav bar, three views, footer, dialog. |
| `contrib-core.js` | Pure engine: money maths, validation, ledger, analytics. |
| `script.js` | DOM wiring, IndexedDB persistence, SVG charts, routing. |
| `style.css` | Light/dark theming, ledger, dashboard, dialog. |
| `tests.js` | Node test suite for the engine. |
