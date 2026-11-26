# Report Generator

> Source 2 (karan/Projects) · **Databases** · project 3 of 7
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Use a database to generate a report (in PDF,
HTML, etc.)."* You hand it rows — the kind you'd get back from a query — and it
groups them, totals them, breaks them across pages, and hands back a finished
report document.

The first two Databases projects got data *out* of a database: the
[SQL Query Analyzer](../sql-query-analyzer/) ran a query inside the page, and the
[Remote SQL Tool](../remote-sql-tool/) fetched rows over the wire. This one is
the other end of the pipeline — turning rows into something a person reads. The
interesting format is **PDF**, so the PDF here is **written from the bytes up**:
no `pdfkit`, no `jspdf`, no headless browser. The object graph, the content
streams, the font metrics and the cross-reference table are all assembled by
hand, and the result is graded by an independent reader **and** by poppler.

```
rows → filter → sort → group (nested) → aggregate (subtotals + grand total)
     → flatten → paginate → render {text | csv | html | PDF bytes}
```

## Try it

**In the browser** — open `index.html`. Pick the group-by columns (drag to
reorder outer → inner), choose which columns aggregate and how, and the report
redraws live. The **PDF structure** tab proves the bytes: it validates the file
Claude just built with an independent parser and shows the object count, page
count and whether every stream length is byte-exact. **Download PDF** hands you
those exact bytes — open them in any reader.

**In a terminal** — the *same* core:

```bash
# A grouped text report of the sample sales data:
node cli.js --preset byRegionRep

# A real PDF, grouped two deep, summing units and revenue:
node cli.js --preset byRegionRep --format pdf --out sales.pdf

# Your own rows (a JSON array of objects), grouped and summed:
node cli.js --data orders.json --group region,rep --sum revenue --format pdf --out r.pdf

# Or CSV / HTML to stdout:
node cli.js --preset byCategory --format csv
```

**The checks** — `node tests.js` (97 of them, no dependencies). The PDF section
is graded by `parsePdf` (an independent reader) and, when the tools are
installed, cross-checked against `qpdf`/`pdftotext`. A Playwright end-to-end
check drives the page, downloads a PDF in-browser, and confirms poppler can read
its title, pages and grand total.

## The three things that are actually hard

### Trap 1 — a grand total is *not* the total of the subtotals you printed

For `SUM` and `COUNT` it happens to be — sum the region subtotals and you get the
grand sum. For `AVG`, `MIN` and `MAX` it is **wrong**, and quietly so. Average
rep revenue of 807 and 318 is not "the average", 562.50; the real average divides
*all* the rows' revenue by *all* the rows. So every aggregate — at every group
level and at the grand-total line — is computed from that node's **raw rows**,
never by combining the children's results. The tests pin exactly this: two groups
with averages 3 and 6, whose average-of-averages is 4.5, but whose true overall
average is 4.0, and the engine returns 4.0.

The other half is **SQL NULL semantics**, because a report runs on real data with
holes in it. `SUM`/`AVG`/`MIN`/`MAX` ignore NULL inputs; `AVG` divides by the
count of *non-null* values, not the row count; `COUNT(*)` counts rows but
`COUNT(col)` skips NULLs; and an aggregate over zero non-null values is NULL
(except `COUNT`, which is 0). The sample data has an unassigned rep and an order
with unknown units specifically to exercise all of that.

### Trap 2 — one layout model has to drive every renderer

A report that looks right in HTML but breaks in the PDF — column headers missing
on page 2, a group's subtotal stranded alone at the top of a page, numbers
drifting out of their columns — is a bug, not a styling choice. So the layout is
computed **once** in the core: `flattenReport` turns the group tree into an
ordered list of lines (`groupHeader` / `data` / `subtotal` / `grandTotal`), each
carrying the group headers that enclose it; `paginate` then splits that list and,
on every page after the first, **re-emits the enclosing group headers** (marked
*continued*) so a row is never shown without the group it belongs to. A group
header is never the last line on a page, and a subtotal never lands first on a
page without its header above it. The tests assert the invariants directly:
dropping the *continued* lines reproduces the original stream exactly, no page
exceeds its row budget, and nothing is orphaned.

### Trap 3 — the PDF cross-reference table is absolute byte offsets, and columns need the *formatted* width

A PDF reader doesn't scan the file top to bottom; it seeks. `startxref` gives the
byte offset of the **xref table**, and the xref gives the byte offset of every
object. One byte off and the reader reports the file as damaged. So `buildPdf`
records each object's offset *as it streams the bytes*, and `parsePdf` — a
separate reader used only by the tests — walks `startxref → xref → "N 0 obj"` and
throws if any offset doesn't land exactly on its object (a test perturbs one
digit and confirms the rejection). Each stream's `/Length` is checked byte-exact
too.

And because PDF has no table layout, right-aligning a number means *measuring* it:
`stringWidth` uses the **real Adobe AFM advance widths** of Helvetica and
Helvetica-Bold (two of the 14 standard fonts, so nothing is embedded). The catch
is that you must measure the **formatted** string — `"$1,234.50"`, commas and all
— not the raw number, or the alignment drifts by exactly the width of the
separators. Columns are sized by measuring every formatted cell, then scaled to
the page width.

## What's in here

| File | Role |
| --- | --- |
| `report-core.js` | The whole engine: SQL-semantic aggregates, grouping with subtotals + grand total, flatten, pagination, the text/CSV/HTML renderers, the from-the-bytes-up PDF emitter with Helvetica AFM widths, and `parsePdf` (the independent grader). No dependencies; runs in Node and the browser. |
| `cli.js` | A command-line generator: presets or your own JSON, any format, PDF to a file. |
| `index.html` / `style.css` / `script.js` | The browser report builder: group-by chips, per-column aggregates, live text/CSV/HTML preview, a PDF-structure inspector, and in-browser downloads. |
| `tests.js` | 97 checks — aggregate semantics, the grand-total-≠-subtotals trap, pagination invariants, CSV/HTML escaping, AFM widths, and the PDF graded by `parsePdf` + poppler. |

## Honest scope

- The **PDF** uses the two standard Helvetica fonts and the WinAnsi encoding, so
  text outside Latin-1 is rendered as `?` (a full font-embedding + Unicode path
  is out of scope for one day). It writes the *simple* cross-reference table and
  a single page tree — enough that poppler, qpdf and browser viewers all accept
  it — not compressed object streams (PDF 1.5+) or tagged/accessible PDF.
- The "database" is an in-memory array of row objects (the CLI also reads a JSON
  array). Connecting to a live SQL database is the previous two projects' job;
  this one starts from the rows they'd return.
- Aggregates cover the common reporting set (`sum`, `avg`, `min`, `max`,
  `count`, `countDistinct`). There's no expression language for *computed*
  aggregate columns beyond what you precompute into the rows (the sample data
  precomputes `revenue = units × unitPrice`).
- Pagination is applied to the PDF (which has fixed pages); the HTML and text
  renderers emit one continuous document, which is what those formats want.
