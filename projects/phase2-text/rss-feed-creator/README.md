# RSS Feed Creator

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**eighth entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/), [Pig Latin](../pig-latin/),
[Count Vowels](../count-vowels/), [Check if Palindrome](../check-if-palindrome/),
[Count Words in a String](../count-words/) and [Text Editor](../text-editor/).

> "RSS Feed Creator — given a link to an RSS/Atom feed, get all posts and
> display them."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and three scripts. Paste a
feed's XML (or load a bundled sample), and it's parsed as you type.

## What it does

Paste the XML of an **RSS 2.0** *or* an **Atom 1.0** feed and get every post,
normalised into one shape — title, link, id, date, author, and body — and
rendered on the page. Then rebuild a clean RSS 2.0 file from those posts and
download it: the reader's writer is its inverse.

The easy reading of the spec is "fetch a URL and list the `<item>` titles," and
almost every tutorial stops there. The two words that carry the whole project
are **RSS *and* Atom** — they are two different XML vocabularies, and reconciling
them is the work:

| | RSS 2.0 | Atom 1.0 |
| --- | --- | --- |
| post element | `<item>` | `<entry>` |
| date | `<pubDate>` — **RFC-822** (`Wed, 02 Oct 2026 13:00:00 +0000`) | `<updated>` — **RFC-3339** (`2026-10-02T13:00:00Z`) |
| link | `<link>` *text* | `<link href="…" rel="alternate">` *attribute* |
| identity | `<guid>` | `<id>` |
| body | `<description>` + `content:encoded` | `<summary>` + `<content>` |
| author | `<author>` / `dc:creator` | `<author><name>` |

Both land in the **same** post model, so "get all posts" means the same thing
whichever format the feed happens to speak. The two bundled samples — one of
each — both parse, and both round-trip.

## The two problems underneath

### 1. There is no `DOMParser` in Node, so the XML is parsed by hand

To make the parser testable (and the app dependency-free), `feed-core.js` ships
its own small, lenient XML parser rather than leaning on the browser. It is not
a toy: it handles **CDATA** sections (kept literal, never entity-decoded),
**comments** and **processing instructions** (skipped), **self-closing** tags,
**namespace prefixes** (`dc:creator` and `creator` are the same field to us),
and the full entity story — the five predefined names plus **numeric character
references**, decimal *and* hex, including astral code points
(`&#128512;` → 😀). Real feeds in the wild contain every one of these, so the
parser that doesn't handle them doesn't work.

### 2. Two date formats, parsed to a real instant — not `new Date(str)`

`new Date()` guesses, and guesses differently across engines. The engine parses
both **RFC-822** (RSS, with optional day name and seconds, and numeric *or*
named zones like `EST`) and **RFC-3339/ISO-8601** (Atom, with `Z` or an offset
and optional fractional seconds) into an exact UTC instant — or `null`, because
a feed with an unreadable date is still a valid feed; the date is just unknown,
and the UI says so rather than inventing one.

## How it's built

`feed-core.js` is the engine — DOM-free, so it runs in Node and the browser:

- **`parseXml(src)`** — the hand-written tolerant XML parser → a
  `{name, local, attrs, children, text}` tree.
- **`parseFeed(xml)`** — detects `<rss>` vs `<feed>` and normalises either into
  `{kind, title, link, description, posts:[…]}`.
- **`parseRfc822` / `parseRfc3339` / `parseDate`** — the two date grammars.
- **`decodeEntities` / `escapeXml`** — the entity table, both directions.
- **`toRss(feed)`** — the **Creator** half: emit a canonical RSS 2.0 document,
  entities escaped, dates in RFC-822, `dc:`/`content:` namespaces declared. It
  is the inverse of `parseFeed` for every field the post model carries.

`script.js` wires it to the page: it parses the textarea on every keystroke,
renders the posts (all feed text placed with `textContent`, **never**
`innerHTML`, so a feed's own markup is shown as text and can't execute),
autosaves your draft to `localStorage` inside try/catch, and offers the RSS 2.0
rebuild as a download (`Blob` + a temporary `<a download>`) or a clipboard copy.

## How it's verified

The reader and the writer are inverses, and the suite leans on exactly that:

- **The round-trip law, over a fuzz** — `parseFeed(toRss(feed))` reproduces a
  random feed, field for field, over **8,000** generated feeds. One law pins
  the parser, the serialiser, the entity table *and* the RFC-822 date format all
  at once. The fuzz palette deliberately mixes the XML specials `< > & " '`, a
  literal CDATA terminator `]]>`, an astral emoji and a combining mark, so
  "escaping is faithful" and "a code point is never split" are *tested*, not
  asserted. (The law holds modulo the whitespace-trim every feed reader applies
  to XML text content — the suite mirrors that trim rather than claiming a
  cleaner law than is true.)
- **Entities** — the five named entities and numeric references (decimal, hex,
  astral) decode exactly; unknown names like `&nbsp;` are left verbatim, which
  is what XML-without-a-DTD actually means.
- **Dates** — RFC-822 (day name and seconds optional, numeric and named zones)
  and RFC-3339 (`Z`, offsets, fractional seconds) parse to the right instant,
  and `toRfc822 → parseRfc822` round-trips over 5,000 random dates.
- **The real samples** — the bundled RSS and Atom feeds parse to the exact posts
  a human reads off them: counts, titles, links, the namespaced
  `dc:creator`/`content:encoded` fields, CDATA kept literal, and Atom's
  `updated`-over-`published` and xhtml-in-a-`<div>` rules.
- **Edge cases** — comments and PIs skipped, self-closing tags, mismatched
  closing tags tolerated, and the documented errors thrown.

The same round-trip law runs **live in the browser** — that's the ✓ Verified
line in the status bar — re-parsing the RSS 2.0 rebuild of whatever feed you're
looking at on every change, so a regression would light up on the page.

Run it:

```bash
node projects/phase2-text/rss-feed-creator/tests.js   # -> 61 passed, 0 failed.
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the source toolbar (RSS/Atom samples, Open, Clear), the XML textarea, the status bar (detected format, post count, ✓ Verified), the side cards (feed meta, the RSS 2.0 rebuild, the live check), and the posts list. |
| `style.css` | The dark house-style theme; the toolbar, the source surface, the format badge, the feed cards, and the post cards. |
| `feed-core.js` | The engine — the hand-written XML parser, the RSS and Atom readers, the two date grammars, the entity table, and the canonical RSS 2.0 writer. No DOM; runs in Node and the browser. |
| `samples.js` | Two hand-written, real-shaped feeds (one RSS, one Atom), shared by the app and the tests so the parser meets the same bytes in both. |
| `script.js` | Browser glue — parses on input, renders the posts with `textContent`, runs the live round-trip check, autosaves, and drives download/copy. |
| `tests.js` | The dependency-free suite: the round-trip law over a fuzz, the entity and date checks, the real-sample assertions, and the edge cases. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
