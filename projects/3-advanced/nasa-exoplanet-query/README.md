# NASA Exoplanet Query

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas NASA Exoplanet Query spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/NASA-Exoplanet-Query.md).

Query a snapshot of NASA's archive of confirmed exoplanets — the thousands of
worlds discovered around other stars since 1992. Build a query from four
dropdowns (**year of discovery, discovery method, host name, discovery
facility**), pick one or many values in each, and get a **sortable table** of
every planet that matches.

Open `index.html` in a browser. **No build step, no server, and no network
required** — the app ships with a bundled snapshot of real exoplanets shaped
exactly like a NASA Exoplanet Archive CSV export.

## User stories from the spec

- ✅ **Query panel** with dropdowns for **year of discovery, discovery method,
  host name, and discovery facility**.
- ✅ **Clear** and **Search** buttons in the query panel.
- ✅ **Single or multiple** value selection in any dropdown (they're real
  `multiple` selects — ⌘/Ctrl-click or drag to pick several).
- ✅ **Search matches all selected values**: it's **OR within a box** (any of the
  years you picked) and **AND across boxes** (that year *and* that method).
- ✅ **Error message** when you press Search with **nothing selected** — the app
  never dumps the whole archive.
- ✅ **Tabular results** showing the queriable fields (plus the planet name as
  each row's identity).
- ✅ **Clear** resets every dropdown and empties the results.

### Bonus features

- ✅ **Host name as a hyperlink** to NASA's **Confirmed Planet Overview** page
  (`exoplanetarchive.ipac.caltech.edu/overview/<host>`).
- ✅ Those links **open in a new browser tab**.
- ✅ **Sort arrows (▲ / ▼)** on each queriable column header — click a header (or
  press Enter on it) to sort; it cycles **ascending → descending**, numeric for
  the year and alphabetical otherwise, with blanks always sorted last.

> The spec loads the archive's live ~4,000-row CSV. This repo is a collection of
> static, serverless apps, so instead of a live download the data is a **bundled
> snapshot** (`sample-data.js`) — real, historically notable exoplanets written
> as the very same CSV text an archive export produces (leading `#` comment lines
> and all), so the engine's CSV reader runs on genuine formatting. Pointing it at
> the full live download is a one-line change in `script.js`; the engine never
> sees anything but this CSV shape.

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** (`exoplanet-core.js`). It never touches the DOM or
the network — you hand it CSV text and it does the thinking.

- **`exoplanet-core.js`** — an RFC-4180-ish `parseCSV` (honouring quotes,
  doubled-`""` escapes, CRLF, and the archive's `#` comment lines);
  `normalizeRecord` (loose CSV row → a small stable shape, coercing `disc_year`
  to a real number and rejecting rows with no planet or host); `buildDataset`,
  which also derives the **unique, sorted option list** for each dropdown;
  the query layer — `selectedValues`, `hasSelection`, `matchesRow`, and
  `search` (OR-within / AND-across, throwing `NO_SELECTION` when nothing is
  picked); a **stable** `sortRows` (numeric vs. locale, blanks last, both
  directions); and `overviewUrl` for the NASA host link. Runs identically in the
  browser and in Node.
- **`sample-data.js`** — ~50 real confirmed exoplanets (from PSR B1257+12 in 1992
  and 51 Peg b in 1995 through the Kepler/K2/TESS transit era, the whole
  TRAPPIST-1 system, and nearby small planets) as archive-shaped CSV text.
- **`index.html` + `style.css` + `script.js`** — the client. `script.js` builds
  the dropdowns and the sortable table and owns the Search/Clear buttons; every
  value from the data is written with `textContent` (never `innerHTML`), so a
  planet or facility name can't inject markup.
- **`tests.js`** — drives the *same* core over hand-built CSV and the bundled
  snapshot, so the Node suite and the browser exercise identical behaviour.

## Running the tests

```bash
node tests.js
```

The suite (386 assertions) covers the CSV reader (quotes, `""` escapes, CRLF,
`#` comments inside vs. outside quotes, blank lines, no trailing newline); year
coercion and record normalization; dataset building and numeric-vs-alphabetical
option ordering; the selection helpers; `search`'s OR-within / AND-across
semantics and the no-selection error; stable ascending/descending sorting with
blanks last; the NASA overview-URL builder; and the integrity of the bundled
snapshot (row counts, the 7-planet TRAPPIST-1 system, the three 1992 pulsar
planets, 51 Peg b's attribution, and a quoted facility name surviving parsing).

---

*Built automatically by [Claude Code](https://claude.com/claude-code) as part of
the [AppIdeasAutomated](../../../README.md) daily routine.*
