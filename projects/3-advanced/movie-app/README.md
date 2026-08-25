# Movie App

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Movie App spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Movie-App.md).

Discover films on a poster wall, scroll to load more (newest releases first),
open any movie for its rating, synopsis, and cast, and keep a personal
**watchlist** with your own short reviews.

Open `index.html` in a browser. **No build step, no server, and no API key
required** — the app ships with a small bundled sample catalog so it works
immediately. Paste a free [TheMovieDB](https://www.themoviedb.org/settings/api)
API key in the *Data source* panel to browse live movies instead; the key is
stored in your browser only (localStorage) and never leaves the page.

## User stories from the spec

- ✅ **View the latest movies on the homepage.** The catalog is sorted by
  release date, newest first.
- ✅ **Scroll to browse additional movies sorted by release date.** An
  `IntersectionObserver` sentinel fetches the next page as you reach the bottom
  and merges it in, de-duplicating by movie id.
- ✅ **Select any movie to open its dedicated detail page.**
- ✅ **View comprehensive movie information** — rating, vote count, runtime,
  genres, synopsis, and cast — on the detail page.

### Bonus features

- ✅ **Personal watchlist.** Add or remove any movie with one button; the list
  persists in localStorage.
- ✅ **Movie reviews.** Write a short review on each watchlist entry; it's saved
  as you type (on blur).
- ➕ **Title search** across the catalog, on top of the required browse flow.

> The spec's "account creation" bonus is deliberately met with **per-browser
> local persistence** instead of a real backend — this repo is a collection of
> static, serverless apps, so there's no server to hold accounts. The watchlist
> and reviews live in your browser, which gives the same feature without a login.

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** (`movie-core.js`). It never touches the DOM or the
network — you hand it the raw JSON a movie API returns and it does the thinking.

- **`movie-core.js`** — API URL builders (discover / detail / search) and the
  poster-CDN URL builder; `normalizeMovie` (the API's dozens of fields → a small
  stable shape, rejecting garbage records and correctly keeping `id: 0`); rating
  clamping, year extraction, and genre-id → name resolution; `buildCatalog`
  (drop dateless movies, sort newest-first with a title tie-break); `mergePage`
  (de-dupe by id for infinite scroll); `detailModel` with human-readable rating,
  vote-count, and runtime formatting; the watchlist rules
  (`add`/`remove`/`toggle`/`setReview`, all immutable) with `serialize`/`parse`
  that tolerate corrupt storage; and `describeStatus` (HTTP status → a friendly
  message). Runs identically in the browser and in Node.
- **`sample-data.js`** — a dozen real, API-shaped movie records plus tiny
  `page`/`find`/`search` helpers that emulate the live endpoints, so the app has
  something to show with zero configuration.
- **`index.html` + `style.css` + `script.js`** — the client. `script.js` picks a
  data source (live TheMovieDB when a key is present, the sample catalog
  otherwise), hands the JSON to the core, and paints whatever comes back. Every
  value from the data source is written with `textContent` (never `innerHTML`),
  so a synopsis or cast name can't inject markup.
- **`tests.js`** — drives the *same* core over hand-built API-shaped records, so
  the Node suite and the browser exercise identical behaviour.

## Running the tests

```bash
node tests.js
```

The suite (90 assertions) covers the API URL builders (endpoints, paging clamps,
query encoding) and poster URLs; `normalizeMovie`'s field mapping, its rejection
of malformed records, and the `id: 0` edge case; rating clamping and year
extraction; genre and cast normalization; catalog ordering (newest/oldest with a
title tie-break) and the dateless-movie filter; `mergePage` de-duplication;
`detailModel` and the count/runtime formatters; the full watchlist lifecycle
(add/remove/toggle/review, immutability); serialize/parse round-tripping and
corruption tolerance; and the HTTP-status-to-message mapping.

---

*Built automatically by [Claude Code](https://claude.com/claude-code) as part of
the [AppIdeasAutomated](../../../README.md) daily routine.*
