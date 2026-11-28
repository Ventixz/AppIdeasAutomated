# Report Generator

> Source 2 (karan/Projects) · **Databases** · project 3 of 7
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Create a utility that generates a report based
on some tables in a database… generates a sales report based on the order /
order-details tables, or sums up the day's current database activity."*

This is a small **report writer**. It takes the rows of a sample sales database
— customers, products, orders, order_items — and turns them into the kinds of
reports that database actually implies: sales grouped by category with a grand
total, a two-level region→category breakdown with **subtotals**, a Top-N
customer ranking, monthly revenue with a **running total**, a category-by-month
**pivot**, and a one-day **activity summary**. Each report is built once as a
*model* and then rendered to **text, HTML, CSV, Markdown or JSON** — the same
figures, laid out five ways. No dependencies.

## Try it

**In the browser** — open `index.html`. Pick a report, switch the **Output**
selector between a rendered table and the raw text/CSV/Markdown/JSON, and watch
the bar chart track the main measure. The region report shows control-break
subtotals; "Category by Month" shows the pivot whose row and column totals both
reconcile to the same grand total. **Download** saves the current report in the
chosen format.

**In a terminal** — the same engine:

```bash
node cli.js --list                                   # what's available
node cli.js sales-by-category                         # aligned text table (default)
node cli.js sales-by-region --format md              # Markdown, two-level subtotals
node cli.js top-customers --limit 3 --format csv     # ranked, as CSV
node cli.js daily-activity --date 2024-03-15         # one day's activity digest
node cli.js category-by-month --format html --out report.html
```

**The checks** — `node tests.js` (118 of them, no dependencies).

## The three things that are actually hard

### Trap 1 — subtotals are a control break, and you cannot average the averages

The region report groups by region **then** category. A subtotal for "North"
has to land *after* North's detail rows and *before* South begins — that's the
classic **control-break** algorithm (`groupRollup`), not a total bolted onto the
end. The subtler trap is the arithmetic: it's tempting to build each subtotal by
adding up the leaf rows you already computed. That's fine for a **sum**, but it's
wrong for an **average** (the average of group averages is not the overall
average) and wrong for a **distinct count** (the same order id can appear in two
groups and must count once overall). So every subtotal and the grand total are
re-aggregated from the **raw rows** for that prefix, with fresh accumulators.
The tests pin this directly: a dataset whose group-averages average to 22.5 but
whose true average is 20.0, and a distinct id shared across two groups that must
total 2, not 3.

### Trap 2 — a pivot's columns are data, and the gaps are zero

"Category by Month" turns one column's *values* into columns. You don't know how
many columns there are, or what they're called, until you've scanned every row —
so the column set is discovered, then **sorted** for a stable layout (swap two
input rows and the output is identical). A category with no sales in a given
month gets a real **`0`**, not a blank, or the column totals stop adding up. And
the table has to reconcile two ways at once: the row totals sum to the grand
total **and** the column totals sum to the grand total. The tests check both
sums against the same number.

### Trap 3 — one model, many renderers, so the formats can't disagree

A number is formatted in exactly **one** place — `formatValue` in the report
model — and every renderer calls it. That's why the CSV, the HTML table and the
plain-text report all show `$1,234.50` the same way: there is no second opinion
to drift. The renderers only *lay out* — the text renderer measures column
widths and right-aligns figures and draws a rule above the grand total; the CSV
renderer handles RFC-4180 quoting; the HTML renderer escapes and tags subtotal
and grand rows — but none of them decides what a dollar figure looks like.

## What's in here

| File | Role |
| --- | --- |
| `report-core.js` | The engine: accumulator-based aggregators, `groupAggregate` (GROUP BY), `groupRollup` (control-break subtotals), `pivot` (crosstab), running totals, the one-place `formatValue`, the five renderers, the sample database, and the six report definitions. Runs in Node and the browser. |
| `cli.js` | Command-line generator: pick a report, a `--format`, optional `--limit` / `--date`, print or `--out` to a file. |
| `index.html` / `style.css` / `script.js` | The browser UI: report picker, parameters, live format switch, bar chart, and a download button. |
| `tests.js` | 118 checks — aggregators, GROUP BY, the two rollup traps, pivot reconciliation, running totals, formatting, every renderer, and each report against pinned totals from the sample data. |

## Honest scope

- The **database is the fixed sample set** in `report-core.js` (12 orders across
  three months). The point is the *reporting* — grouping, subtotals, pivoting,
  formatting — not a storage layer; it reads plain arrays, so pointing it at
  other tables is just supplying different rows.
- The aggregation vocabulary is the common reporting set — `sum`, `count`,
  `count distinct`, `avg`, `min`, `max`, rollup subtotals, running total, and a
  one-field pivot. `HAVING`-style filtering, multi-measure pivots and
  percent-of-total columns aren't built; the engine is shaped to make them easy
  to add.
- The bar chart is hand-drawn inline SVG (no chart library) and shows a single
  measure for the reports that declare one.
