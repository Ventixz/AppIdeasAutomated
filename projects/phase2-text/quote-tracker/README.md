# Quote Tracker

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**ninth entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/), [Pig Latin](../pig-latin/),
[Count Vowels](../count-vowels/), [Check if Palindrome](../check-if-palindrome/),
[Count Words in a String](../count-words/), [Text Editor](../text-editor/) and
[RSS Feed Creator](../rss-feed-creator/).

> "Quote Tracker — gather and store quotes along with their attributions."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts. Your whole
collection, autosaved, stays in your browser.

## What it does

Paste a quote, see it split into the saying and its author, and save it. Browse,
search, and tag the collection; get a different "quote of the day" each day; and
export or import the whole thing as JSON. Everything persists in `localStorage`.

Storing a quote sounds like `array.push(string)`. But a *tracker* — something
you'd actually keep — has to answer four questions that the one-line version
just gets wrong, and getting them right is the whole project.

### 1. Where does the quote end and the author begin?

People paste quotes in exactly one shape —

```
"Stay hungry, stay foolish." — Steve Jobs
```

— and in every variation of it at once: straight `"…"` or curly `“…”` quote
marks (or none), and an em dash `—`, en dash `–`, double hyphen `--`, or plain
hyphen `-` before the author. The engine's `parseAttribution` recovers
`{ text, author }` from all of them:

```js
parseAttribution('"Stay hungry, stay foolish." — Steve Jobs')
// -> { text: "Stay hungry, stay foolish.", author: "Steve Jobs" }
```

The subtlety is the dash. A separator dash has spaces around it; the hyphen in
`well-being` or `self-made` does **not** — so those are never mistaken for an
attribution. And when the quote *itself* contains a dashed aside
(`Knowledge — real knowledge — is power — Bacon`), only the **last** separator
splits, so the author is `Bacon` and the aside stays in the quote. A leading
`— Author` (attributing without re-typing the quote) is understood too.

### 2. Is this the same quote I already saved?

The same saying gets pasted twice all the time — once with curly quotes, once
straight; once `The Only Way`, once `the only way `; once with the author
typed `Steve`, once `steve`. A naive store keeps all of them and your
collection fills with near-duplicates. This one computes a **canonical identity
key** — NFC-normalised (so a combining accent and its precomposed form agree),
stripped of wrapping quote glyphs, whitespace-collapsed, trimmed, lowercased —
and refuses a second copy. The same words by a *different* author are a
different quote and are kept; identity folds the noise, not the meaning.

### 3. Which quote do I show today — fairly?

A "quote of the day" that's `quotes[Math.random() * n]` repeats one quote twice
in a week and never shows another. This one rotates **fairly**: the days are cut
into cycles of length *n*, and each cycle is a seeded shuffle (mulberry32 +
Fisher–Yates), so within any run of *n* days **every quote appears exactly once
before any repeats**, and the order is reshuffled each cycle rather than looping
the same list. It's deterministic — the same day always yields the same quote —
so it needs no stored "last shown" bookkeeping.

### 4. Can I get my quotes back out?

The collection exports to a small, stable JSON document and imports back
**field-for-field**, with dedup applied on the way in — so importing the same
file twice is a no-op, and merging two exports keeps one copy of anything they
share.

## How it's built

The engine in `tracker-core.js` is DOM-free, so it runs in Node and the browser:

- **`parseAttribution(raw)` / `formatAttribution(q)`** — the split and its
  inverse, across the quote-mark and dash conventions above.
- **`quoteKey(text, author)`** — the canonical identity key (via `canon`, which
  does the NFC + unwrap + collapse + fold).
- **`Store`** — `add` (deduping), `edit` (refuses a collision), `remove`, a live
  `tagCounts` index, and a tokenised **AND** `search` over text + author + tags
  that is case- and diacritic-insensitive (so `bronte` finds `Brontë`).
- **`orderForDay(n, day)` / `store.quoteOfDay(day)`** — the fair rotation.
- **`toObject` / `toJSON` / `fromObject`** — the serialisation round-trip.

The glue in `script.js` wires a form to it: typing in the paste box live-fills
the quote/author fields, Add runs through the deduping store, every change
autosaves to `localStorage` (wrapped in try/catch, so a private window degrades
quietly), and browse/search/tag-filter and the quote-of-the-day card re-render.

## How it's verified

The four hard parts are checked as **laws over a fuzz**, not hand-picked happy
paths:

- **Attribution round-trips** — `parseAttribution(formatAttribution(q)) === q`
  over **20,000** random pairs whose palette mixes ASCII, an astral emoji
  (`😀`) and a combining mark (`e` + U+0301), so "unwrap the glyph, split on the
  right dash, never slice a code point" is tested, not asserted — alongside a
  curated corpus pinning each dash style, each quote-mark style, the
  internal-hyphen case, the last-separator case, and the leading-dash case.
- **Identity folds the noise** — `quoteKey` agrees across whitespace, case,
  wrapping glyph, and NFC/NFD variants of one saying, and keeps genuinely
  different sayings (and the same words by different authors) apart.
- **The rotation is fair** — `orderForDay` over *n* consecutive days is a
  **permutation** (every quote once, none repeated) for store sizes
  1…100 across five cycles, the per-cycle order genuinely changes, and the pick
  histogram over *k* full cycles is flat — each quote exactly *k* times.
- **Search is honest** — any substring token of a record's text/author/tags
  finds that record, over a 2,000-case fuzz, plus curated AND-token and
  tag-filter cases.
- **Serialisation round-trips** — `fromObject(store.toObject())` reproduces the
  store field-for-field over **400** random stores (object and JSON-string
  paths both), and re-importing the export is an idempotent no-op.

The same four laws run **live in the browser** — that's the ✓ Verified line in
the footer — re-checked on every change, so a regression would light up on the
page.

Run it:

```bash
node projects/phase2-text/quote-tracker/tests.js   # -> 46 passed, 0 failed.
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the quote-of-the-day card, the add form (paste box + split fields + tags), the export/import controls, and the browse column (search, tag bar, quote list). |
| `style.css` | The dark house-style theme. |
| `tracker-core.js` | The engine — attribution parse/format, the canonical identity key, the deduping `Store` with tags and search, the fair rotation, and serialisation. No DOM; runs in Node and the browser. |
| `samples.js` | A starter set of ten quotes, shown only on first load. |
| `script.js` | Browser glue — live paste parsing, add/remove, autosave, browse/search/tag-filter rendering, export/import, and the live self-check. |
| `tests.js` | The dependency-free suite: curated cases plus the round-trip, identity, rotation, search and serialisation laws over a fuzz. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
