# Report Generator

> Source 2 (karan/Projects) · **Databases** · project 3 of 7
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Use a database system to produce a report.
Create tables that hold records. Then enter records, and then produce a report
from the records using some complex query (e.g. SQL). Format the report nicely."*

A flat SQL result grid is **not a report**. A report takes sorted records,
**breaks them into bands**, and prints a subtotal every time a group changes plus
a grand total at the end — structure that lives *outside* relational algebra,
which is exactly why report writers (RPG, Crystal, Jasper, SSRS) exist as a layer
*on top of* the database. This project is that layer: a **control-break /
banded report generator** plus a **crosstab (pivot)**, hand-written with **no
dependencies** in `report-core.js`, running in Node and the browser.

```
Report: Sales by Region and Category
 Region: East
   Category: Hardware
     Laptop   Ada    3  $3,597.00
     Monitor  Ada    6  $1,194.00
   Total Hardware (2)   Amount $4,791.00     ← a control break fired here
   …
 Total East (7)        Amount $10,405.20     ← and the outer break fired here
 …
 GRAND TOTAL (22)      Amount $42,529.90     ← = the sum of the region subtotals, to the cent
```

## Try it

**In the browser** — open `index.html`. Pick a dataset, click dimensions to
**group by** them (click order = outer → inner), add **aggregates** (SUM / AVG /
MIN / MAX / COUNT / COUNT DISTINCT), choose **detail columns**, and the banded
report rebuilds live. Switch to **Crosstab** for a pivot table. Add a **filter**,
then **Copy text** / **Download CSV** / **Download Markdown**.

**In a terminal** — the same engine:

```bash
node cli.js --demo        # a full banded report + a crosstab, from the sample data

# build your own:
node cli.js --dataset sales --group region,category \
            --sum amountCents --sum units --avg amountCents \
            --detail product,rep,units,amountCents

node cli.js --dataset sales --crosstab region/category --sum amountCents
node cli.js --dataset tickets --group team --count --avg resolveMins --format md

# your own CSV (money columns are given in dollars, stored internally as cents):
node cli.js --csv data.csv --money amount --group region --sum amount --format csv
```

**The checks** — `node tests.js` (101 of them, no dependencies). A Playwright
end-to-end run also drives the browser UI (renders the banded report, applies a
filter, and confirms the crosstab's row/column/grand totals reconcile on screen).

## The three things that are actually hard

### Trap 1 — a control break cascades, and the bands unwind inner-first

Group by `(region, category)`. The naive engine asks, per level, "did *this*
column change?" — and gets it wrong, because **an outer break forces every inner
break**: when `region` goes East → North, the open `category` subtotal must close
*even though the category value might be the same on both sides of the boundary*.
So the break is found at the **first** differing level, and then footers emit from
the **deepest open level down to that break** (innermost first) while the new
headers open from the break **outward → inward** (outermost first). The other
half of the trap: a control break only works on **sorted** input — feed the same
group in two non-adjacent places and it silently becomes **two bands** that each
look complete. `buildReport` sorts by the full group key defensively; a test
shuffles the rows into an interleaved order and asserts you still get exactly one
band per region.

### Trap 2 — aggregates, NULL, and a total that actually reconciles

- **`AVG` of nothing is `NULL`** — not `0`, and never `NaN` from `0/0`. `SUM` and
  `AVG` skip NULLs; `SUM` over the empty/all-NULL set is `NULL` (SQL semantics),
  `COUNT(*)` counts rows while `COUNT(col)` counts non-NULLs — so when a column
  has a NULL, `COUNT(*) ≠ COUNT(col)`, and the tests pin all of it (the support
  dataset has a ticket with no resolution time precisely to prove it).
- **`AVG` is weighted** — `sum / count` over the whole set, **never the mean of
  the group means**. Averaging averages is the classic report lie: groups of
  `[10, 10]` and `[40]` have group means 10 and 40, whose average is 25, but the
  real average is `60 / 3 = 20`. A test asserts the engine reports 20.
- **Money is integer cents**, so the grand total **equals the sum of the group
  subtotals exactly**. A test adds ten `$0.10` rows across two groups and asserts
  the cent path reconciles to exactly `$1.00` — the drift you'd get from summing
  floating-point dollars is the bug the cents representation removes.

### Trap 3 — the crosstab's columns are a union, an empty cell is not a zero

A pivot of `region × product` has a column for **every product that appears
anywhere**, not just the ones in the first row — so the column axis is the
**sorted union** of all distinct values (`Dock` shows up because *North* sells it,
`Consulting` because *South* does). A cell where no record matches is **`null`**,
rendered as `·` / blank — deliberately **not `0`**, because "no sales" and "sales
totalling zero" are different facts. And the margins must **reconcile**: the sum
of the row totals, the sum of the column totals, and the grand total are all the
same number (computed from the raw rows, so it stays correct for `AVG`/`COUNT`
too). Then the monospace renderer pads every column to its widest value and
right-aligns the numbers, so the thing lines up and reads as a report — that's
the task's "format it nicely" taken literally. A test asserts every line of the
text crosstab is the same width.

## What's in here

| File | Role |
| --- | --- |
| `report-core.js` | The whole engine: aggregates (SQL-faithful NULL handling), the control-break `buildReport`, derived groups (e.g. group by `month(date)`), WHERE/HAVING, `crosstab`, and renderers for text, CSV, Markdown and HTML. No dependencies; runs in Node and the browser. |
| `data.js` | Two sample "tables": `sales` (region/category/product/rep/date/units/amount, money as cents) and `tickets` (team/priority/agent/channel, with a deliberate NULL). |
| `cli.js` | A command-line report builder: built-in datasets or a `--csv` file, any grouping/aggregates/filter, banded or crosstab, in text/csv/md/html. |
| `index.html` / `style.css` / `script.js` | The browser UI: click-to-group, add aggregates, detail columns, filters, a crosstab mode, and clipboard/CSV/Markdown export. |
| `tests.js` | 101 checks — formatting, aggregate semantics, the cascading control break, reconciliation (including the float-vs-cents proof), WHERE/HAVING, derived groups, the crosstab union/null/reconciliation, and the renderers. |

## Honest scope

- The report **spec** is the "complex query": multi-level `GROUP BY` with
  aggregates, a `WHERE` filter, a `HAVING` on group aggregates, and ordering. It
  is not a full SQL parser — yesterday's *SQL Query Analyzer* already built one;
  here the point is the **report structure** (bands, subtotals, crosstabs) that
  sits above a query's result.
- Aggregates cover `COUNT(*)`, `COUNT(col)`, `COUNT DISTINCT`, `SUM`, `AVG`,
  `MIN`, `MAX`. Integer and money sums are exact; a `number` (float) column is
  supported but carries ordinary floating-point behaviour — which is the whole
  reason money is stored as cents.
- The CSV reader in `cli.js` is a small quoted-field parser with numeric/string
  type inference (`--money` marks money columns); it is not a full dialect
  handler. The export CSV re-imports its own detail rows and also carries the
  subtotal/grand-total section marked in a leading `_band` column.
