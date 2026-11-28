# SQL Query Analyzer

> Source 2 (karan/Projects) · **Databases** · project 1 of 7
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"A utility application which a user can enter a
query and have it run against a local database and look for ways to make it more
efficient."*

A real SQL database and query optimizer that run **entirely in the browser** —
no server, no build step, and (this is the point) **no SQL library**. No
`sql.js`, no WASM SQLite, no parser generator. The whole pipeline is hand-written:

```
tokenize → parse (recursive descent → AST) → plan + execute → analyze
```

You type a query, it runs against an in-memory database, and the analyzer looks
at *how* it ran — counting the rows every operator touched — and tells you,
concretely, how to make it faster. Because the engine can actually **use** an
index once you create one, the advice is verifiable: click **Apply & re-run** on
a suggestion and watch "rows examined" collapse. The engine runs headless too,
under `node tests.js`.

## Try it

Open `index.html`. A sample database (5,000 users, 12,000 orders, **no indexes**)
loads automatically. Run the default query, or click a chip:

- **filter by city** — an equality filter the analyzer will want to index.
- **join users & orders** — a nested-loop join; watch the rows-examined count.
- **group & aggregate** — `GROUP BY` with `COUNT`/`AVG`.
- **a slow query** — `WHERE UPPER(city) = 'BERLIN'`, which *can't* use an index,
  and the analyzer says so and why.

Each run shows the **result grid**, an **execution plan** (every node annotated
with rows examined vs rows out), and **optimization suggestions** — several with
a ready-to-run `CREATE INDEX` and an **Apply & re-run** button that creates the
index and re-executes so you can see the improvement immediately. Press
`Ctrl/Cmd+Enter` in the editor to run.

Run the engine tests with `node tests.js` (69 checks, no dependencies).

Three things about this are genuinely hard, and all three live in `sql-core.js`
so they can be tested without a browser.

## Trap 1 — SQL is parsed, not split on keywords

The tempting way to "read a query" is to split the string on `WHERE`, `FROM`,
`GROUP BY`. It falls apart on the first real query. A keyword can sit inside a
**string literal** (`WHERE note = 'see the WHERE clause'`), `<=` is one operator
and not `<` followed by `=`, and — most importantly — `a OR b AND c` does **not**
mean `(a OR b) AND c`; `AND` binds tighter than `OR`, and no amount of splitting
captures that.

So the front end is a real two-stage parser. `tokenize` scans character by
character into typed tokens, recognizing a string as one whole unit *before*
anything looks for keywords inside it, and matching multi-character operators
longest-first. Then a recursive-descent `Parser` builds an AST with **precedence
encoded in the call chain** (`OR` < `AND` < `NOT` < comparison < `+`/`-` <
`*`/`/`), which is the only correct way to get the grouping right. The tests pin
all of it: the keywords inside `'the where and from clause'` are never tokenized
as keywords, `'O''Brien'` round-trips its escaped quote, `a OR b AND c` parses
with `OR` on top and the `AND` as its right child, and `2 + 3 * 4` evaluates to
`14`, not `20`.

## Trap 2 — "more efficient" has to be measured, not asserted

An analyzer that just prints "add an index" is useless — it has to be *right*,
and it has to *prove* it. So the executor is **instrumented**: every operator
records `rowsExamined`, counting only the rows it actually reads from storage. A
`WHERE city = 'Berlin'` with no index is a **SeqScan** that examines all 5,000
rows; with an index on `city` it becomes an **IndexLookup** that examines only
the matching bucket. The analyzer computes, *from the live data*, exactly how
many rows a hypothetical index would examine, and ships that as a before/after
with the `CREATE INDEX` DDL. You can hold it to the number: the tests assert that
after applying the suggested index the query examines *precisely* the predicted
count, and the browser's **Apply & re-run** shows 5,000 → 833 in one click.

Crucially, it also knows when an index **won't** help, and doesn't over-promise.
A predicate that wraps the column in a function (`UPPER(city) = 'BERLIN'`), a
`LIKE '%foo'` with a leading wildcard, or a range on a hash index — all of these
are **non-sargable**, and the analyzer flags *why* instead of suggesting an
index that would never be used. The tests confirm the engine refuses to use an
index in exactly those cases (and still uses it for the plain equality).

## Trap 3 — a join's cost is a product, and the inner side is everything

A nested-loop join of A (n rows) and B (m rows) examines **n × m** rows — unless
B can be probed by an index on the join key, which turns each pass into a direct
lookup and collapses the cost to roughly n. That is the single biggest lever in
query performance, so the planner checks the `ON` equality against the inner
table's indexes and picks an **index join** when it can, a **scan join** when it
can't — and the analyzer, seeing a scan join, recommends an index on the exact
inner join column. The tests build a 100 × 1,000 join: unindexed it examines
~100,000 rows; with an index on `orders.user_id` it drops by more than 10×, and
both return the identical result set. `LEFT JOIN` is handled too, emitting NULLs
for unmatched outer rows.

## What's supported

A practical subset of SQL, all hand-implemented:

- `CREATE TABLE`, `INSERT`, `CREATE INDEX` (hash index on a column)
- `SELECT` with `DISTINCT`, qualified/aliased columns, `*` and `table.*`
- `FROM` + `INNER`/`LEFT JOIN ... ON`
- `WHERE` with `AND`/`OR`/`NOT`, `=` `<>` `<` `<=` `>` `>=`, `LIKE`, `IN (...)`,
  `BETWEEN`, `IS [NOT] NULL`, arithmetic, and scalar functions (`UPPER`, `LOWER`,
  `LENGTH`, `ABS`, `ROUND`)
- `GROUP BY` / `HAVING` with `COUNT` / `SUM` / `AVG` / `MIN` / `MAX`
  (and `COUNT(DISTINCT ...)`)
- `ORDER BY ... ASC|DESC`, `LIMIT` / `OFFSET`
- three-valued NULL logic throughout (NULL comparisons are *unknown*, aggregates
  skip NULLs)

## Files

| File | What it is |
| --- | --- |
| `sql-core.js` | The whole engine — tokenizer, parser, catalog, instrumented executor, and cost analyzer. No dependencies; runs in Node and the browser. |
| `tests.js` | 69 assertions grouped by the three traps plus engine correctness, join cost, and the analyzer. Run `node tests.js`. |
| `index.html` / `style.css` / `script.js` | The browser app: editor, result grid, annotated plan, and apply-able suggestions. |

## How the analyzer decides

Given a parsed query, its plan, and the catalog, it looks for:

1. **Un-indexed equality filters** → suggests `CREATE INDEX`, with the real
   before/after row count (only when the predicate is selective).
2. **Scan joins** → suggests an index on the inner join column.
3. **Non-sargable predicates** (function on a column, leading-wildcard `LIKE`,
   range on a hash index) → explains why no index applies.
4. **`SELECT *`** → advises explicit projection.
5. **Large in-memory sorts** → notes an ordered index would avoid the sort.

Suggestions are ranked by severity, and the index ones come with runnable DDL —
so the loop from "slow query" to "fast query" is one click.
