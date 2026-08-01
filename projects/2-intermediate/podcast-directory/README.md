# Podcast Directory

Pull recent episodes from two podcasts — **JavaScript Jabber** and **Techpoint
Charlie** — and show them in one combined, date-sorted list. Each row has a
clickable play icon that opens the episode on Podbean, and you can toggle each
podcast in or out of the table.

Source idea: [app-ideas / Podcast Directory](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Podcast-Directory-App.md)

## Running

Open `index.html` in any browser — no build, no dependencies:

```bash
open projects/2-intermediate/podcast-directory/index.html
```

The browser app renders a bundled snapshot of episodes (`episodes.js`). To
refresh that snapshot from the live Podbean pages, run the scraper (below).

## How to use

1. The table loads with **both** podcasts' episodes, newest first.
2. Use the checkboxes in the **Podcasts** summary to include or exclude a
   podcast — the table updates immediately and the counts stay visible.
3. Click the round **▶** icon on any row to open that episode on Podbean.
4. Scroll the table to browse the full list; the header stays pinned.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| See a table of podcast episodes | `<table class="episodes">` + `renderRows()` |
| Rows show a clickable icon, title, and broadcast date | `renderRows()` builds each `<tr>` |
| Scroll through the list | `.table-wrap { max-height; overflow-y:auto }` |
| Click the icon to view the episode on Podbean | `.play-link` `<a target="_blank">` |
| **Bonus:** alternating row background colors | `tbody tr:nth-child(even)` in `style.css` |
| **Bonus:** summary with per-podcast episode counts | `buildSummary()` → `.count-pill` |
| **Bonus:** checkbox per podcast to include it | `buildSummary()` checkbox → `included` set |

## The scraper (the real spec mechanism)

The original spec introduces **Puppeteer** — it opens each podcast's Podbean
page in a headless browser and reads the episode links out of the DOM with
`querySelectorAll`. A pure-browser app can't do that (it can't run a headless
browser, and it can't fetch `podbean.com` cross-origin), so `scrape.js` is a
real Node script that performs the scrape, and the browser app renders its
output:

```bash
npm install puppeteer
node projects/2-intermediate/podcast-directory/scrape.js          # prints combined JSON
node projects/2-intermediate/podcast-directory/scrape.js --write  # rewrites episodes.js
```

`scrape.js` visits both Podbean pages, extracts each episode's title, link and
date, normalizes dates to ISO, and emits a combined newest-first list — the
same shape the browser app consumes. Podbean's markup drifts over time, so the
selectors are a documented starting point to adjust if a run comes back empty.

## Files

| File | Purpose |
| --- | --- |
| `index.html`  | Summary panel + scrollable episodes table |
| `style.css`   | Dark, card-based layout, sticky header, alternating rows |
| `script.js`   | Renders the table, per-podcast counts, include toggles |
| `episodes.js` | Bundled episode snapshot the browser app reads |
| `scrape.js`   | Puppeteer scraper that regenerates `episodes.js` from Podbean |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 57 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
