# Guestbook / Journal

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**tenth entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/), [Pig Latin](../pig-latin/),
[Count Vowels](../count-vowels/), [Check if Palindrome](../check-if-palindrome/),
[Count Words in a String](../count-words/), [Text Editor](../text-editor/),
[RSS Feed Creator](../rss-feed-creator/) and [Quote Tracker](../quote-tracker/).

> "Guestbook / Journal — a simple app where people can add comments or journal
> entries. The app can allow or disallow comments and add timestamps to entries;
> it could also work as a shout box."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts. Every entry is
autosaved in your browser.

## What it does

Leave a note — a name (or stay anonymous) and a message. Entries show up grouped
by day, newest first, each stamped with a human time (*just now*, *yesterday*,
*3 days ago*, then a real date). Search them. Switch the book between **open**,
**moderated**, and **closed**. Export or import the whole book as JSON.

Adding a note sounds like `entries.push(text)`. But a guestbook — something you
would actually open to other people — has to answer four questions that the
one-line version just gets wrong, and getting them right is the whole project.

### 1. What happens when a visitor types `<script>`?

This is the question a guestbook exists to answer. The page shows text that
*other people* wrote, so the moment you render it as HTML you have handed every
visitor a way to inject markup. `guestbook-core.js`'s `escapeHtml` turns the five
dangerous characters (`& < > " '`) into entities, and `linkify` goes one step
further — it escapes the text **and** turns a bare `https://…` into a safe
`<a>` in a single pass:

```js
linkify('x <img src=y onerror=alert(1)> see https://example.com/a?b=1&c=2')
// -> 'x &lt;img src=y onerror=alert(1)&gt; see
//     <a href="https://example.com/a?b=1&amp;c=2" rel="nofollow noopener noreferrer"
//        target="_blank">https://example.com/a?b=1&amp;c=2</a>'
```

Only `http(s)` links are made clickable (never `javascript:` or `data:`), a URL
stops at the first `<`, `>`, `"` or `'` so it can't swallow following markup, and
trailing sentence punctuation (`(see https://x.com).`) is left out of the link.
The result is safe to assign to `innerHTML`: **the only tags it can ever contain
are the `<a>` wrappers the engine itself wrote.**

### 2. How long ago was that — said like a human?

`new Date(at).toString()` is accurate and unreadable. `relativeTime` says it the
way a person would: *just now*, *1 minute ago*, *5 minutes ago*, *3 hours ago*,
*yesterday*, *4 days ago*, *2 weeks ago*, then `on Mar 4` (or `on Mar 4, 2022`
once the year differs). The subtleties are the ones everyone gets wrong:
singular vs plural (`1 minute` / `5 minutes`), **calendar-day** boundaries
(*yesterday* is the previous day, so 11pm→1am reads as *yesterday*, not "2 hours
ago"), and a clamp so a clock-skewed future timestamp never reads "in -3
minutes". It's **monotonic**: for a fixed now, a more recent entry never reads
as older than a less recent one.

### 3. Is the book open, closed, or moderated?

The spec asks to "allow or disallow comments", so the store has a **mode**:

- **open** — entries appear immediately (a shout box);
- **moderated** — a new entry is `pending` and invisible to readers until you
  **approve** it;
- **closed** — posting is refused outright.

`post()` returns an honest result — `{ ok: true, entry }` or `{ ok: false,
reason }` where `reason` is `closed`, `empty`, or `duplicate`. That last one is a
flood guard: an entry **identical to the one just before it** is refused (the
double-submit / spam case), but the *same words by a different author*, or the
same author again after someone else posts, are kept — because in a guestbook
those are real, separate notes.

### 4. Where does one day end and the next begin?

The journal view groups entries into **Today**, **Yesterday**, and dated
sections. `groupByDay` buckets a newest-first list by **local calendar day**,
and it's a genuine partition: every entry lands in exactly one group, the groups
run newest-day-first, and concatenating them reproduces the input order exactly —
so nothing is ever dropped, duplicated, or reordered on the way to the screen.

Plus the house-standard **serialisation round-trip**: the book exports to a small
JSON document and imports back field-for-field, with import merging by entry id
(so re-importing the same file is a no-op) and the internal id counter kept ahead
of every imported id so new posts never collide.

## How it's built

The engine in `guestbook-core.js` is DOM-free, so it runs in Node and the
browser:

- **`escapeHtml(s)` / `linkify(raw)`** — safe rendering (question 1).
- **`relativeTime(then, now)`**, with `startOfLocalDay`, `dayDiff`, `formatDate` —
  human, monotonic timestamps (question 2).
- **`Guestbook`** — `post` (mode-gated, deduping), `approve`, `edit`, `remove`,
  `visible` / `pending` / `all` (newest-first with a stable id tie-break), and a
  tokenised **AND** `search` over name + body (question 3).
- **`groupByDay(entries, now)`** — the day partition (question 4).
- **`toObject` / `toJSON` / `fromObject`** — the serialisation round-trip.

The glue in `script.js` wires a form to it: Add runs through the mode-gated
store, bodies are rendered through `linkify` (the only place untrusted text
reaches the page), moderated posts show an *Awaiting approval* queue, every
change autosaves to `localStorage` (wrapped in try/catch, so a private window
degrades quietly), and the journal re-renders grouped by day — refreshed once a
minute so *just now* ages into *a minute ago* on its own.

## How it's verified

The hard parts are checked as **laws over a fuzz**, not hand-picked happy paths:

- **Rendering is injection-proof and lossless** — over **20,000** random strings
  built from a palette full of `<`, `>`, `&`, quotes and URLs, `linkify`'s output
  (a) contains no `<` except the `<a>` tags it writes, and (b) round-trips: strip
  the anchors, decode the entities, and you get the original text back exactly —
  alongside curated cases pinning the escape map, the URL detection, trailing
  punctuation, and the "can't break out with a tag" case.
- **Time never runs backward** — over **20,000** random pairs, a more recent
  entry never reads as older than a less recent one; plus curated exact strings
  for every boundary (minute, hour, yesterday-across-midnight, days, weeks, date)
  and the future-clamp.
- **The store behaves** — mode gating (open shows, moderated queues, closed
  refuses), the consecutive-duplicate guard (and that different authors aren't
  folded), stable same-millisecond ordering, approve / edit / remove, and
  tokenised AND search that excludes pending posts.
- **Days partition cleanly** — over **2,000** random day-spreads, `groupByDay`
  puts every entry in exactly one group, keeps the groups newest-day-first, and
  reproduces the input order on concatenation.
- **Serialisation round-trips** — `fromObject(book.toObject())` reproduces the
  book field-for-field over **400** random books (object and JSON-string paths
  both), the export shape is stable, and the id counter stays ahead of imported
  ids.

The core of these laws also runs **live in the browser** — that's the ✓ Verified
line in the footer — re-checked on every change, so a regression would light up
on the page.

Run it:

```bash
node projects/phase2-text/guestbook-journal/tests.js   # -> 56 passed, 0 failed.
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the sign-the-book form, the open/moderated/closed controls, the approval queue, the export/import controls, and the day-grouped entry list. |
| `style.css` | The dark house-style theme. |
| `guestbook-core.js` | The engine — safe rendering, human timestamps, the mode-gated deduping store with search, the day partition, and serialisation. No DOM; runs in Node and the browser. |
| `samples.js` | A few starter entries, shown only on first load. |
| `script.js` | Browser glue — posting, moderation, safe rendering, day-grouped rendering, autosave, export/import, and the live self-check. |
| `tests.js` | The dependency-free suite: curated cases plus the rendering, timestamp, store, grouping and serialisation laws over a fuzz. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
