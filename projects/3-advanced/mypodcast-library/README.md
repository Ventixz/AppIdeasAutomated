# MyPodcast Library

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas MyPodcast Library spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/MyPodcast-Library-app.md).

Keep a personal library of favourite Podbean podcasts: add a show by its
Podbean URL, browse each podcast's most recent episodes in a sortable table,
**heart** the episodes you love, give them a **five-star rating**, and tag them
with freeform **hashtags** you can search across your whole library.

Open `index.html` in a browser. **No build step, no server, and no scraping
required** — the app ships with a small bundled library of Podbean-shaped
sample shows so it works immediately. Your library (podcasts, favourites,
ratings, and hashtags) is stored in your browser only (localStorage) and never
leaves the page.

## User stories from the spec

**Favourite podcast display**
- ✅ **Podcasts in a table**, each row showing its **icon, name, and recent
  episode count** (episodes broadcast within the last 30 days).
- ✅ **"No podcasts added yet" watermark** when the library is empty.
- ✅ **Clicking a podcast** opens its most recent episodes.

**Favourite podcast entry**
- ✅ A **"+ Add a new podcast"** button opens a panel with a **URL field, Save,
  and Cancel**.
- ✅ **Save validates** that the URL is a Podbean podcast page (the
  `podbean.com/podcast-detail/…` path or a `*.podbean.com` show subdomain) and
  surfaces a **404** when no podcast lives there.
- ✅ **Valid podcasts persist** across browser sessions; **Cancel** dismisses
  the panel without saving.

**Most recent episodes page**
- ✅ Episodes in a table with **icon, title, broadcast date, and a heart icon**.
- ✅ **Episode icons link out** to the (Podbean) episode page.
- ✅ **Heart icons toggle favourite status**, which persists between sessions.
- ✅ The list **prioritises recent episodes, then favourites** — a hearted
  episode floats to the top of the timeline.

### Bonus features

- ✅ **Episode ratings.** Five stars per episode: clicking fills left-to-right;
  clicking the current top star deselects one (the "right-to-left" behaviour).
  A **Top rated** toggle sorts the list by descending rating.
- ✅ **Hashtags & search.** Attach freeform hashtags to any episode, then search
  a hashtag across **every** podcast in your library; a **Cancel** button
  returns to the main page.

> The spec builds this with **Puppeteer scraping Podbean live**. This repo is a
> collection of static, serverless apps, so instead of a live scraper the "look
> up a podcast by URL" step is emulated by a bundled sample set (`sample-data.js`)
> shaped exactly like a scrape's output. Swapping in a real Puppeteer-backed
> endpoint is a matter of replacing `Sample.find(url)` — the engine and UI don't
> change, because the engine only ever sees normalized records.

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** (`podcast-core.js`). It never touches the DOM, the
network, or Puppeteer — you hand it the raw records a scrape produces and it
does the thinking.

- **`podcast-core.js`** — Podbean URL validation (`isValidPodcastUrl`) and
  canonicalization for de-duping; `normalizePodcast` / `normalizeEpisode` (loose
  scrape records → a small stable shape, rejecting garbage and keeping `id: 0`);
  rating clamping; hashtag parsing/normalization; `buildLibrary`,
  `recentEpisodeCount`, and `sortEpisodes` (favourites-first-then-recency, or
  the bonus rating sort); the immutable library mutations
  (`addPodcast`/`removePodcast`/`toggleFavorite`/`rateEpisode`/`setEpisodeHashtags`)
  with the star-click rule (`nextRating`); cross-library `searchByHashtag` and
  `allHashtags`; `serialize`/`parseLibrary` that tolerate corrupt storage; and
  `describeStatus` (HTTP status → a friendly message, 404 included). Runs
  identically in the browser and in Node.
- **`sample-data.js`** — four real-looking, Podbean-shaped podcasts with recent
  episodes (icons are inline data-URI SVGs, so nothing is fetched) plus a
  `find(url)` helper that emulates the "fetch a podcast by its Podbean URL"
  step, returning a 404 for unknown URLs.
- **`index.html` + `style.css` + `script.js`** — the client. `script.js` owns
  the clock, localStorage, and the three views (library, one podcast's
  episodes, hashtag search). Every value from the data source is written with
  `textContent` (never `innerHTML`), so an episode title or hashtag can't inject
  markup.
- **`tests.js`** — drives the *same* core over hand-built scrape-shaped records,
  so the Node suite and the browser exercise identical behaviour.

## Running the tests

```bash
node tests.js
```

The suite (109 assertions) covers URL validation (detail path, subdomain,
lookalike and bare-host rejection, whitespace) and canonicalization;
podcast/episode normalization including the `id: 0` edge case and
malformed-record filtering; rating clamping; hashtag parsing/de-duping;
`recentEpisodeCount` windows; episode ordering (favourites-first and the bonus
rating sort with tie-breaks); the immutable library mutations and URL/id
de-duplication; the star-click semantics; hashtag editing and cross-library
search; serialize/parse round-tripping and corruption tolerance; the HTTP
status messages; and the integrity of the bundled sample data.

---

*Built automatically by [Claude Code](https://claude.com/claude-code) as part of
the [AppIdeasAutomated](../../../README.md) daily routine.*
