# Sort Excel/CSV File Utility

> Source 2 (karan/Projects) · **Files** · project 2 of 6
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Takes a CSV file and sorts its rows. Give the
user the option of which column to sort by, ascending or descending, and write
the sorted rows back to a new file."*

A self-contained CSV sorter: it reads a CSV file, sorts the rows by one or more
columns — picking the right comparison for each column's data — and writes the
sorted file back out, losslessly. No server and no build step: open
`index.html`, open a `.csv` or paste one, choose your sort keys, and download the
result. The engine that does the real work runs in Node too, under
`node tests.js`.

## Try it

Open `index.html` and click **Load sample** (or open any `.csv`, or paste one).
The column pickers fill in automatically. Pick a column to **Sort** by, choose
ascending/descending, **+ Add sort key** for tie-breakers, and hit **Sort**. You
get a preview table and a **Download sorted.csv** button. Run the logic tests
with `node tests.js` (51 checks, no dependencies).

This is a "Files" project, so the whole thing is built around the file: a correct
CSV reader, a sorter that respects what the data *is*, and a writer that puts it
back together without corrupting anything. The three things that are genuinely
hard live in `csv-core.js`, where they can be tested without a browser.

## Trap 1 — you cannot sort a CSV until you can actually *read* one

"Split each line on commas" is the bug that every naive CSV tool ships with. Real
CSV (RFC 4180) allows a quoted field to contain the delimiter, a literal double
quote (written `""`), **and newlines** — so a single record can span several
lines of text. `"Smith, John"` is one field, not two; split on commas and every
row below a quoted newline shifts by a column and the sort scrambles the file.

So `parseCSV` is a character-level state machine, not a `split`. It tracks
whether it is inside a quoted field, and that single bit decides what a comma, a
newline, or a quote *means*. It also handles the quiet real-world details:
CRLF / lone-CR line endings, a leading UTF-8 BOM (Excel adds one), and a trailing
newline that must **not** invent a blank final row. The tests feed it commas,
escaped quotes, and newlines all nested inside one field and assert the field
survives intact.

## Trap 2 — "sort by a column" is meaningless until you decide what the column *is*

Sort a column of quantities as text and `10` lands before `9`, because `'1'` <
`'9'`. Sort dates as text and `2024-03` beats `2024-12-31`... sometimes. The sort
a human wants depends on the *type* of the data, and a CSV carries no types — so
the utility infers them.

`detectType` looks at every non-blank value in a column: the column is `number`
only if **all** of them parse as numbers, `date` only if all parse as dates,
otherwise `string`. One stray label collapses the whole column to text, which is
the safe default — a half-numeric column sorted numerically is nonsense. Then
each type gets the comparison it deserves: numbers compared as numbers, dates
chronologically, and text with a locale-aware, case-insensitive, natural-number
collation so `item2` sorts before `item10`. You can override the detected type
per key in the UI. Blank cells always sort to the end, in either direction — a
missing value is not "less than zero".

## Trap 3 — multi-column sort only works if the sort is *stable*

Give the user tie-breakers and stability stops being academic. Sort by `city`,
then add `name` as a second key, and you expect "by city, and within each city by
name". That only holds if equal-city rows preserve the order the previous key
left them in — i.e. the sort is **stable**. Historically not every JS engine
guaranteed that, so `sortRows` doesn't rely on it: it decorates each row with its
original index and uses that index as the final tie-breaker, after all the real
keys are exhausted. The tests sort rows with identical keys and assert the
original order is preserved, and sort by two keys and assert the second one only
decides ties within the first.

## Trap 4 — writing it back has to be the exact inverse of reading it

A sort tool that corrupts the file on the way out is worthless. `serializeCSV`
quotes a field **only** when it must — when it contains the delimiter, a quote,
or a newline — doubling any interior quote, and leaves everything else bare so a
simple file stays simple. The test that matters takes a deliberately messy file
(commas, escaped quotes, and embedded newlines inside fields), runs
parse → serialize → parse, and asserts the rows come back byte-identical.

## Files

| File | What it is |
| --- | --- |
| `csv-core.js` | The engine: `parseCSV` / `parseTable`, `detectType`, `sortRows`, `serializeCSV`, `sortCSVText`. Runs in Node and the browser. |
| `tests.js` | 51 assertions over parsing, type detection, stable multi-key sorting, and lossless round-trips. `node tests.js`. |
| `sample-data.csv` | An example file with quoted commas, apostrophes, numbers, and dates. |
| `index.html` / `style.css` / `script.js` | The browser UI — thin glue over the engine. |

## Note

This project is part of an automated daily routine run by Claude Code (see the
repository root [`README.md`](../../../README.md) and
[`PROGRESS.md`](../../../PROGRESS.md)). Each day the routine builds the next
unchecked project from its source list, writes it up, and merges it.
