# GitHub Timeline

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas GitHub Timeline spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/GitHub-Timeline-App.md).

Enter a GitHub username, press **Generate**, and get a shareable, year-by-year
**timeline of that user's public repositories** — each annotated with its name,
creation date, and description, laid out on a real vertical timeline (spine +
nodes) with readable type and a calm accent color, so it's the kind of thing you
could send a prospective employer.

Open `index.html` in a browser. No build step or server required — it calls the
public GitHub REST API directly with `fetch`. Try **octocat**, **torvalds**, or
**florinpop17** from the hint on the page.

## User stories from the spec

- ✅ **Enter a GitHub username.** A single text field, focused on load.
- ✅ **Click *Generate* to build and display the timeline.** Repos are fetched,
  filtered to public only, sorted by creation date, and grouped by year.
- ✅ **A warning message when the username isn't valid.** Bad input (empty,
  illegal characters, leading/trailing or doubled hyphens, over 39 chars) is
  caught *before* any network call; a `404` from GitHub becomes
  *"No GitHub user by that name."* and a `403` becomes a rate-limit notice.

### Bonus feature

- ✅ **Repos tallied by the year they were created.** A small bar chart above the
  timeline shows how many repositories were created each year.

The spec also says **"only public repositories should be displayed"** — the
engine drops anything flagged `private`, and offers an optional **Include forks**
toggle plus a **Newest / Oldest first** order control.

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** (`timeline-core.js`). It never touches the DOM or
the network — you hand it the raw JSON the GitHub API returns and it does the
thinking.

- **`timeline-core.js`** — username validation (GitHub's own rules), the repos
  API URL builder, `normalizeRepo` (the API's dozens of fields → a small stable
  shape, rejecting garbage records), `buildTimeline` (public-only filter, fork
  filter, sort with a deterministic tie-break), `yearSummary` (the bonus tally),
  `groupByYear`, and `describeStatus` (HTTP status → a friendly warning). Runs
  identically in the browser and in Node.
- **`index.html` + `style.css` + `script.js`** — the client. `script.js` reads
  the form, calls `fetch` for the repos *and* the profile in parallel, hands the
  JSON to the core, and paints whatever comes back. Every value from GitHub is
  written with `textContent` (never `innerHTML`), so a repo description can't
  inject markup.
- **`tests.js`** — drives the *same* core over hand-built API-shaped records, so
  the Node suite and the browser exercise identical behaviour.

## Running the tests

```bash
node tests.js
```

The suite (61 assertions) covers username validation and its warning codes, the
API URL builder (endpoint, per-page clamping, encoding), `normalizeRepo`'s field
mapping and its rejection of malformed records, timeline ordering (newest/oldest
with a name tie-break), the public-only and fork filters, the per-year summary
(including the empty-input, no-divide-by-zero case), `groupByYear`'s buckets and
within-year order, and the HTTP-status-to-warning mapping.

> **Note on rate limits.** Unauthenticated GitHub API calls are limited to ~60
> requests/hour per IP. If you hit that, the page shows the rate-limit warning —
> it isn't a bug in the app.

---

*Built automatically by [Claude Code](https://claude.com/claude-code) as part of
the [AppIdeasAutomated](../../../README.md) daily routine.*
