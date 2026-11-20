# PDF Generator

> Source 2 (karan/Projects) · **Files** · project 4 of 6
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"An application which can read in a text file,
html file or some other file and generates a PDF file out of it."*

A real PDF writer that runs entirely in the browser — no server, no build step,
and (this is the point) **no PDF library**. It implements PDF 1.7 from the bytes
up: the object graph, the page tree, the cross-reference table, and positioned
text content streams. Drop in a `.txt` or `.html` file (or paste text), choose a
font, page size and alignment, and your browser hands back a `.pdf` that Preview,
Acrobat, Chrome, and poppler all open normally. The engine runs headless too,
under `node tests.js`.

## Try it

Open `index.html`. Drop a text or HTML file onto the drop zone (or **choose a
file**, or **load a sample**, or just type in the box). Tick **Treat as HTML** to
strip tags from a web page. Pick a font, size, page size, alignment and wrapping,
then **Build & download .pdf**. A live preview — the exact bytes you download,
rendered by the browser's own PDF engine — sits below the controls.

Run the engine tests with `node tests.js` (54 checks, no dependencies). When
poppler's `pdfinfo`/`pdftotext` are installed, the tests additionally grade the
output with them — a completely separate PDF implementation.

Everything happens locally in the page; no file ever leaves the browser.

This is a "Files" project, and a PDF is one of the most structurally unforgiving
files there is: a reader walks it by byte offset, not by reading top to bottom.
Three parts are genuinely hard, and all three live in `pdf-core.js` so they can
be tested without a browser.

## Trap 1 — the xref table is a list of byte offsets that must be exact

A PDF reader does not parse front-to-back. It reads the last line, `startxref`,
to find the **cross-reference table**, which lists the absolute byte offset of
every object in the file; then it jumps straight to the object it wants. If any
offset is wrong by a single byte — and they are all ten-digit numbers you compute
by hand as you stream the file out — the reader lands in the middle of some other
object and the document is "damaged." `buildPdf` records `out.len` at the start of
every object as it writes, and the tests parse the result back with an
**independent reader** (`parsePdf` in `tests.js`, which walks `startxref` → xref →
objects exactly as a real reader does) and assert that *every* offset lands on the
`N 0 obj` it claims to. This is the one set of numbers that must be exactly right
or nothing opens.

## Trap 2 — "generate a PDF" means laying out text yourself, with real metrics

PDF has no concept of a paragraph or a line break. Text is drawn by setting a
position and emitting a string; *you* decide where every line starts. So the
engine word-wraps the input itself — and to wrap correctly it must know how wide
each glyph is. It uses the 14 standard PDF fonts (built into every reader, so
nothing is embedded) together with the **real Adobe AFM advance widths** parsed
from the published metric files. That is what lets right-alignment, centering and
full **justification** (stretching the spaces with the `Tw` operator) line up
where the reader will actually paint the glyphs, instead of drifting off the
margin. The tests pin the metrics to known values (`Helvetica "A"` is 667 units,
Courier is 600 for everything) and assert every wrapped line fits the measured
width, that an oversized token is hard-split rather than dropped, and that Courier
behaves as a true monospace.

## Trap 3 — strings, streams, and encoding all have to agree

Text inside a PDF lives in literal strings where `(`, `)` and `\` **must** be
escaped, or the parser loses its place. Non-ASCII characters are written in
**WinAnsiEncoding**, so the generator maps Unicode smart quotes, dashes, the euro
sign and accented letters into the right single-byte codes (and encodes text as
those bytes, never as UTF-8, so the byte offsets in Trap 1 stay honest). Each
content stream also carries a `/Length` that must equal the exact number of bytes
between `stream` and `endstream` — off by one and many readers reject it. The
tests check all three: they confirm the escaping appears in the output, that
`/Length` is byte-exact on every stream across a multi-page document, and — the
real-world check — that `pdftotext` reads the words back in order and `pdfinfo`
agrees on the page count.

## A detail worth calling out: HTML in, readable PDF out

The task says "text file, html file or some other file." `htmlToText` is a small,
dependency-free converter: it drops `<script>`/`<style>`, turns block tags and
`<br>` into line breaks, maps `<li>` to bullets, strips the remaining tags, and
decodes both named and numeric entities (`&amp;`, `&mdash;`, `&#8212;`). Tick
**Treat as HTML** and a pasted web page becomes a tidy document — no browser DOM,
no parser dependency.

## Files

| File | What it is |
| --- | --- |
| `pdf-core.js` | The engine: embedded Adobe font metrics, `measure`/`wrapWord`/`wrapPre` text layout, `htmlToText`, and `buildPdf` (object graph, content streams, xref, trailer). Runs in Node and the browser. |
| `tests.js` | 54 assertions: metric values, wrapping, a full structural round-trip via an independent reader, pagination, and a real-world grade with poppler's `pdfinfo`/`pdftotext`. `node tests.js`. |
| `index.html` / `style.css` / `script.js` | The browser UI — file drop / paste, layout controls, a one-click build/download, and a live in-browser preview. Thin glue over the engine. |

## Note

This project is part of an automated daily routine run by Claude Code (see the
repository root [`README.md`](../../../README.md) and
[`PROGRESS.md`](../../../PROGRESS.md)). Each day the routine builds the next
unchecked project from its source list, writes it up, and merges it.
