# JSON2CSV App

Paste a JSON array of objects, choose a delimiter, and convert it into CSV.
The union of every object's keys becomes the header row, so even records with
missing or extra fields line up into the right columns. The CSV is assembled
and quoted by hand — no library, as the spec requires. This is the inverse of
the [CSV2JSON App](../csv2json-app/).

Source idea: [app-ideas / JSON2CSV App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/JSON2CSV-App.md)

## Features

- **Paste & convert** — drop in JSON and hit *Convert to CSV*; the result lands
  in the output box.
- **Validation warnings** — inline alerts for empty input, malformed JSON (with
  the parser's message), or a shape that isn't an object / array of objects.
- **Clear** — wipes both boxes and any warning in one click.

### Bonus features

- **Open file…** — load a `.json` file straight from disk (the browser stand-in
  for the spec's "enter a file path / Open" story).
- **Download** — save the converted CSV as `data.csv` (the browser stand-in for
  the "Save to a file path" story).
- **Multiple delimiters** — comma, semicolon, tab, or pipe.
- **Optional header row** — toggle the column-name line on or off.
- **Copy to clipboard** — one click, with a graceful fallback for browsers that
  block the async Clipboard API.
- **Load sample** — a built-in example with a quoted comma and an embedded
  quote so you can see the escaping at work.

## How it works

`JSON.parse` validates the input for free — any syntax error becomes the warning
message. `collectHeaders()` then walks every record once to build the column
list in first-seen order (this is what handles objects with differing keys).
Each cell is run through `escapeCell()`, which wraps a value in double quotes and
doubles any embedded quote whenever it contains the delimiter, a quote, or a
newline, following RFC 4180. Nested objects/arrays are stringified before
escaping so they survive as a single cell.

## Run it

Open `index.html` in any browser — no build step or dependencies.
