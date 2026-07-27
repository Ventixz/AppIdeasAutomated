# Markdown Table Generator

Fill in a spreadsheet-style **HTML table**, get a clean **GitHub-flavored
markdown table** out — live, with per-column alignment baked into the separator
row. No libraries: the table model and the markdown serializer are written from
scratch in vanilla JS, and that serializer is the real project.

Source idea: [app-ideas / Markdown-Table-Generator](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Markdown-Table-Generator.md)

## Running

Open `index.html` in any browser — nothing to install:

```bash
open projects/2-intermediate/markdown-table-generator/index.html
```

## What it does

Every user story from the spec, plus **all four** bonus features:

- **Sized table** — set rows & columns and hit *New table* (user story 1).
- **Editable cells** — every cell is `contentEditable`; type straight into the
  grid, first row is the header (user story 2).
- **Generate markdown** — the markdown regenerates live from the model on every
  keystroke and every structural edit (user story 3).
- **Preview** — the generated markdown is parsed back into a rendered HTML
  table, alignment and inline `**bold**`/`*italic*`/`` `code` `` included
  (user story 4).
- **Copy to clipboard** — one button, with an `execCommand` fallback for older
  browsers (bonus 1).
- **Insert row / column at a location** — add above/below or left/right of the
  active cell (bonus 2).
- **Delete a row or column** entirely (bonus 3).
- **Align** left / center / right, scoped to a **cell**, **column**, **row**, or
  the **whole table** via the scope selector (bonus 4).

## How it works

State is one small model — `data[rows][cols]` of cell text plus `align[cols]`
of per-column alignment — and *everything* (the editable grid, the markdown
string, the HTML preview) is rendered from it, so there's a single source of
truth.

`toMarkdown()` is the DOM-free core:

- **Pipe-safe cells** — `|` and `\` are escaped and newlines collapsed so cell
  content can never break out of its column.
- **Alignment separators** — the second row is emitted as `:---` / `:--:` /
  `---:` from each column's alignment.
- **Padded columns** — cells are padded to each column's width (respecting the
  alignment side) so the *raw* markdown lines up too, not just the rendered
  table.

Alignment is a per-column property in markdown, so the "cell" and "row" scopes
map onto columns accordingly — a note the code documents where it matters.

## Sanity check

The serializer has no DOM dependencies, so it runs in Node by slicing the file
before the app-wiring section:

```bash
cd projects/2-intermediate/markdown-table-generator
node -e 'const fs=require("fs");let s=fs.readFileSync("script.js","utf8");
s=s.slice(0,s.indexOf("/*  ====== App wiring"));
const {toMarkdown}=new Function(s+";return {toMarkdown};")();
console.log(typeof toMarkdown);'
```

During development this was run against 5 assertions covering the basic layout,
alignment separators, pipe/newline escaping and right-aligned padding — all
passing.

---

*Built automatically by a [Claude Code](https://claude.com/claude-code) routine.
See the [repo README](../../../README.md) for how the routine works.*
