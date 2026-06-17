# GitHub Status

A tiny dashboard that fetches and displays the **live operational status of
GitHub's services** — Git operations, API requests, webhooks, issues, pull
requests, Actions, Packages, Pages and the rest — straight from the official
[GitHub Status](https://www.githubstatus.com/) JSON API.

Source idea: [app-ideas / GitHub-Status-App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/GitHub-Status-App.md)

## Features

- **Component list** — every top-level GitHub component is shown as a row with
  its current state (Operational, Degraded, Partial/Major Outage, Maintenance).
- **"Get Status" button** — re-fetches the most recent data on demand. The page
  also fetches once automatically on load so it's useful immediately.
- **Overall banner** — GitHub's own summary description (e.g. "All Systems
  Operational") with a healthy/unhealthy colour.

## Bonus features implemented

- **Visual distinction for non-operational components** — operational rows stay
  calm with a green accent, while degraded ones turn amber, outages turn red and
  **gently pulse** with a CSS animation, and maintenance turns indigo. The left
  border, status dot and label colour all follow the component's state.
- **Last-updated timestamp** taken from the API's own `updated_at` field.
- **Graceful error handling** for offline / network failures.

## A note on "web scraping"

The original spec frames this as a web-scraping exercise using the NPM
[`request`](https://www.npmjs.com/package/request) package against
`githubstatus.com`. GitHub's status page is powered by Statuspage.io, which
publishes a clean, **CORS-enabled** JSON API:

```
https://www.githubstatus.com/api/v2/summary.json
```

Because that endpoint allows cross-origin requests, the browser's native
`fetch` is the direct, dependency-free equivalent of `request` — no Node
server, proxy, or HTML parsing required. That keeps this project consistent
with the rest of the repo: a single static page with no build step.

```js
const res = await fetch("https://www.githubstatus.com/api/v2/summary.json");
const data = await res.json();
// data.status.description  -> overall banner
// data.components[]        -> per-component rows
```

## Run it

Open `index.html` in any browser — no build step or dependencies. It needs a
network connection to reach the GitHub Status API.
