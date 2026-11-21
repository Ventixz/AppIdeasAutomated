# MP3 Tagger

> Source 2 (karan/Projects) · **Files** · project 5 of 6
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Analyze a group of MP3 files and tag them if
they are missing the Title, Artist, Album, Year or other ID3 v1 and v2 fields."*

A real ID3 tag reader and writer that runs entirely in the browser — no server,
no build step, and (this is the point) **no tagging library**. It implements the
ID3 formats from the bytes up: it reads the 128-byte **ID3v1** footer at the end
of a file and the **ID3v2** header-and-frames block at the front (v2.2, v2.3 and
v2.4, each of which lays its sizes out differently), merges them into one view,
and reports exactly which standard fields are **missing** — which is the whole
ask. Fill the gaps in and it writes a clean ID3v2.3 block and a fresh ID3v1.1
footer back around the untouched audio. The engine runs headless too, under
`node tests.js`.

## Try it

Open `index.html`. Drop a batch of `.mp3` files onto the drop zone (or **choose
files**, or **load a sample** — a genuine silent MP3 with no tags, so you can
watch every field get flagged). Each file gets a card showing its tag status, a
list of the **missing** fields, and an editable form. Fill in Title, Artist,
Album, Year, Track, Genre and Comment, then **Write tags & download** — the file
comes back fully tagged. **Auto-fill from filename** guesses Title/Artist from an
`Artist - Title.mp3` name.

Run the engine tests with `node tests.js` (61 checks, no dependencies). When
`id3v2` or `ffprobe` are installed, the tests additionally grade the written
files with them — completely separate ID3 implementations.

Everything happens locally in the page; no file ever leaves the browser.

This is a "Files" project, and MP3/ID3 is a format with three byte-level traps
that are easy to get subtly wrong. All three live in `id3-core.js` so they can be
tested without a browser.

## Trap 1 — synchsafe integers

The size of an ID3v2 tag is not stored as a normal 32-bit integer. If it were, a
size byte could happen to equal `0xFF` and an MP3 decoder scanning for the audio
frame-sync word (`0xFFE…`) would false-trigger inside the tag. So ID3v2 stores
sizes **synchsafe**: only the low 7 bits of each byte carry data, the top bit is
always 0, and four bytes hold 28 bits. Read a synchsafe size with a naive
`(b0<<24)|(b1<<16)|…` and you land about 11% past where you should and parse
garbage — `0,0,2,1` means **257**, not 513. `encodeSynchsafe`/`decodeSynchsafe`
handle it, and the tests pin them to hand-computed spec values (not just a
round-trip of our own encoder) and prove the synchsafe reading differs from the
naive one.

## Trap 2 — every ID3v2 version lays its frames out differently

"Read the ID3v2 tag" is really three parsers. **v2.2** uses 3-character frame IDs
(`TT2` for the title) and 3-byte sizes. **v2.3** uses 4-character IDs (`TIT2`) and
plain 32-bit big-endian sizes. **v2.4** keeps the 4-character IDs but makes the
frame sizes **synchsafe too** — so the exact same tag is walked three different
ways, and getting the size width wrong by one byte desynchronises the whole frame
loop. `readV2` detects the major version, aliases the old 3-char IDs onto their
modern names, and reads each frame's size the right way. The tests parse a
**hand-built v2.2 tag** — bytes the writer never emits — to check the reader
stands on its own, and also normalise the awkward real-world values: a `TRCK` of
`"3/12"` becomes track `3`, a `TCON` of `"(17)"` resolves through the genre table
to `Rock`, and a v2.4 `TDRC` timestamp collapses to a 4-digit year.

## Trap 3 — text frames carry their own encoding

Every ID3v2 text frame begins with an **encoding byte**: `0` = ISO-8859-1, `1` =
UTF-16 with a byte-order mark, `2` = UTF-16BE without one (v2.4), `3` = UTF-8
(v2.4). Guess wrong and a title turns to mojibake — decode UTF-16 bytes as Latin-1
and `café` becomes `caf?`; decode Latin-1 as UTF-16 and two letters fuse into one
CJK glyph. `decodeText` honours the byte (and any BOM) for all four cases;
`encodeText` writes the smallest faithful encoding — ISO-8859-1 when every code
point fits in a byte, UTF-16+BOM otherwise, which every v2.3 reader understands.
ID3v1, by contrast, is Latin-1 only and its fields are a fixed width, so the
writer truncates to 30 bytes and the tests confirm an over-long title still
produces exactly 128 bytes.

## A detail worth calling out: the audio is never touched

Tagging must not re-encode or corrupt a single sample. `applyTags` reads where
the existing tags end (`audioStart` after any ID3v2, `audioEnd` before any
ID3v1), slices out the audio in between, and wraps **new** tags around it — so
re-tagging an already-tagged file replaces the tags instead of stacking them. The
tests assert the audio bytes come back identical, that the first preserved byte is
still a real MPEG frame-sync (`0xFF 0xFB`), and that a second tagging pass leaves
the audio length unchanged.

## Files

| File | What it is |
| --- | --- |
| `id3-core.js` | The engine: synchsafe codec, ID3v1 read/write, ID3v2 (v2.2/2.3/2.4) frame reader and v2.3 writer, the four text encodings, the genre table, `readTags`/`missingFields`/`applyTags`, and a tiny silent-MP3 maker. Runs in Node and the browser. |
| `tests.js` | 61 assertions: synchsafe spec values, all four encodings, an ID3v1 round-trip, an ID3v2 round-trip, a hand-built v2.2 tag parsed independently, missing-field analysis, byte-exact audio preservation, and a real-world grade with `id3v2`/`ffprobe`. `node tests.js`. |
| `index.html` / `style.css` / `script.js` | The browser UI — multi-file drop, a per-file status badge and missing-field report, an editable tag form, and one-click write/download. Thin glue over the engine. |

## Note

This project is part of an automated daily routine run by Claude Code (see the
repository root [`README.md`](../../../README.md) and
[`PROGRESS.md`](../../../PROGRESS.md)). Each day the routine builds the next
unchecked project from its source list, writes it up, and merges it.
