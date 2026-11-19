# Create Zip File Maker

> Source 2 (karan/Projects) · **Files** · project 3 of 6
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Create a zip file maker. Give the user the
option to put the files and give the program a location, then zip up everything
into a zip file."*

A real ZIP archiver that runs entirely in the browser — no server, no build
step, and (this is the point) **no zip library**. It implements the ZIP format
from the bytes up: CRC-32, a from-scratch DEFLATE compressor, and the ZIP
container itself. Drop files in, name the archive, click build, and your browser
hands back a `.zip` that `unzip`, Explorer, Finder, and 7-Zip all open normally.
The engine runs headless too, under `node tests.js`.

## Try it

Open `index.html`. Drag files onto the drop zone (or **choose files**, or
**add a text file by hand**, or **load samples**). They appear in a list with
sizes. Name the archive, optionally tick **Store only** to skip compression,
and hit **Build & download .zip**. The status line reports how much smaller the
archive came out. Run the engine tests with `node tests.js` (28 checks, no
dependencies — it uses Node's built-in `zlib` only to *grade* the output).

Everything happens locally in the page; no file ever leaves the browser.

This is a "Files" project, and a zip is the most format-heavy file there is: it
is a precise little binary database of other files. Three parts are genuinely
hard, and all three live in `zip-core.js` so they can be tested without a
browser.

## Trap 1 — a wrong CRC-32 makes every entry "corrupt"

Each file in a ZIP carries a CRC-32 of its *uncompressed* bytes, stored twice
(local header and central directory). Unzip tools recompute it on extract and
reject the entry if it disagrees — so a checksum that is off by one bit fails
the *whole* archive, not just a little. `crc32` is the standard table-driven,
reflected IEEE implementation (polynomial `0xEDB88320`). The tests pin it to
published check values — `crc32("123456789") === 0xCBF43926` — and, when the
Node build exposes `zlib.crc32`, cross-check against that too. This is the one
number that must be exactly right or nothing works.

## Trap 2 — "zip it up" means actually implementing DEFLATE

A tool that only stores files is a packager, not a compressor; a real zip makes
the bytes smaller. So `deflateRaw` implements DEFLATE (RFC 1951) itself:
LZ77 back-reference matching over a 32 KiB sliding window — found with a
zlib-style hash-chain so it is not quadratic — then encodes the literals and
`(length, distance)` matches with DEFLATE's **fixed Huffman** code set
(`BTYPE=01`), which needs no code table in the output. The fiddly part is the
bit order: DEFLATE packs bits into bytes least-significant-first, but Huffman
codes are defined most-significant-first, so every code is bit-reversed before
it is written. Getting that backwards produces a stream that looks plausible and
inflates to garbage.

The tests refuse to let the compressor grade itself: they take our output and
inflate it with **Node's built-in `zlib.inflateRawSync`** — a completely
separate implementation — and assert the bytes come back identical, across empty
input, runs, repeating patterns, 5,000 lines of structured text, and arbitrary
binary. If the bit packing were wrong by a hair, zlib would throw or return the
wrong bytes.

## Trap 3 — the container is a graph of byte offsets that must all agree

A ZIP is laid out as `[local header + data] × N`, then a **central directory**
of records (one per file) that each point *back* at their local header by
absolute byte offset, then an **end-of-central-directory** record that points at
where the central directory starts and how big it is. Unzip tools read the file
back-to-front: EOCD → central directory → each local header. If any one of those
offsets or sizes is wrong — and they are all little-endian integers you compute
by hand as you stream the file out — the archive is unreadable, often with a
baffling error.

`buildZip` tracks every offset as it writes, emits all three structures, and the
tests parse the result straight back with `readZip` (an independent reader that
walks EOCD → central dir → local headers), confirming every filename, every
byte of content, every CRC, directory entries, UTF-8 filenames, backslash-path
normalisation, and that compressible entries actually shrank. As a final
real-world check, the archives this engine builds pass `unzip -t`'s integrity
test and extract byte-for-byte.

## A detail worth calling out: compress only when it helps

ZIP lets each entry choose its own method. `buildZip` deflates each file, keeps
the result **only if it came out smaller**, and otherwise stores the raw bytes —
so a tiny or already-compressed file is never made *bigger* by a compression
header. That is standard ZIP behaviour and the tests assert both directions: the
repetitive entry picks DEFLATE (method 8), the 14-byte `hello.txt` stays stored
(method 0).

## Files

| File | What it is |
| --- | --- |
| `zip-core.js` | The engine: `crc32`, `deflateRaw` (LZ77 + fixed Huffman), `buildZip`, and `readZip`. Runs in Node and the browser. |
| `tests.js` | 28 assertions: CRC against published vectors, DEFLATE verified by round-tripping through Node's `zlib`, and full container round-trips via `readZip`. `node tests.js`. |
| `index.html` / `style.css` / `script.js` | The browser UI — drag-and-drop file intake, a file list, and a one-click build/download. Thin glue over the engine. |

## Note

This project is part of an automated daily routine run by Claude Code (see the
repository root [`README.md`](../../../README.md) and
[`PROGRESS.md`](../../../PROGRESS.md)). Each day the routine builds the next
unchecked project from its source list, writes it up, and merges it.
