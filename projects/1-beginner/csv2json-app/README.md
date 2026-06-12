# CSV2JSON App

Paste a block of CSV, choose a delimiter, and convert it into formatted JSON.
The first row is treated as the header, so every column name becomes a key on
each output object. The CSV parser is written by hand — no PapaParse or any
other library, as the spec requires.

Source idea: [app-ideas / CSV2JSON App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/CSV2JSON-App.md)

## Features

- **Header-driven conversion** — the first row supplies the JSON keys; each
  later row becomes one object.
- **Pretty-printed output** — JSON is emitted with two-space indentation.
- **Validation warnings** — inline alerts for empty input, a missing data row,
  or a blank header column.

### Bonus features

- **Multiple delimiters** — comma, semicolon, tab, or pipe.
- **Type casting** — optionally coerce `12`, `3.14`, `true`/`false`, and `null`
  tokens into real JSON numbers, booleans, and null (toggle it off to keep
  everything as strings).
- **Copy to clipboard** — one click, with a graceful fallback for browsers that
  block the async Clipboard API.
- **Load sample / Clear** — a built-in example demonstrates quoted fields that
  contain commas.

## How it works

`parseCsv()` walks the input one character at a time, tracking whether it is
inside a quoted field. That state machine is what lets a quoted value hold the
delimiter, a newline, or a doubled `""` escaped quote without breaking the row.
Once the rows are split, the first becomes the header and each remaining row is
zipped against it into an object; optional `coerce()` upgrades numeric/boolean/
null-looking strings to their JSON types.

## Run it

Open `index.html` in any browser — no build step or dependencies.
