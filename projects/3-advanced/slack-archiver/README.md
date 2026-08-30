# Slack Archiver

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Slack Archiver spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Slack-Archiver.md).

Slack's free tier purges messages once a workspace passes 10,000, and a team's
"institutional knowledge" goes with them. The spec asks for a tool that extracts
channel history through Slack's `channels.history` API — rate-limited to about
50 messages a minute — into a database, resuming from the last message it saw,
driven only by Team owners, with a file export and a bonus retrieval API.

Open `index.html` in a browser. **No build step, no server, and no
dependencies** — an HTML page and two scripts.

## Why it's a *mock* Slack (and why that's the point)

There's no Slack workspace to talk to here and no network, so the app ships a
**faithful mock of the two things a real archiver depends on**:

- A **stand-in workspace** whose `history()` method behaves exactly like
  `channels.history`: paginated, oldest-first, and hard-capped at the rate
  limit per call.
- The browser's **own storage as the database** — the archive persists across
  reloads.

Everything *around* those two seams — access control, the resume-from-cursor
extraction loop, de-duplication, export, and the retrieval query — is the real
logic the spec is about, and it's written so that swapping the mock for the live
Slack Web API and a real database would never touch it.

## User stories from the spec

- ✅ **Choose which channels to archive**, adding and removing them freely.
- ✅ **Only Team owners may archive.** Sign in as a member and every owner-only
  control — channel management, start/stop, run-a-pass — locks.
- ✅ **Periodic extraction from the last retrieved message.** Each pass reads the
  archive's per-channel cursor and asks Slack only for messages *after* it, so
  history is never re-pulled.
- ✅ **Writes to a database.** The de-duplicated archive persists to the
  browser's storage between visits.
- ✅ **Export archived channels to files** — JSON or plain text.
- ✅ **Runs automatically.** "Start auto-archiving" fires a pass every second and
  stops on its own once every subscribed channel is caught up.

### Bonus feature

- ✅ **A retrieval API for other applications** — `queryArchive()` filters a
  channel's stored messages by text (case-insensitive), author, and time, newest
  first, with a limit. The archive viewer's search box is itself just a client of
  that API.

## The rate limit, made visible

The spec's headline constraint is the ~50-messages-per-minute ceiling on
`channels.history`. The mock enforces it: **one pass = one API call per
subscribed channel, and no call ever returns more than 50 messages.** Watch a
260-message channel fill in over six passes, exactly as a real rate-limited
extraction would trickle in.

## Architecture — engine vs. presentation

As with every other advanced project here, all the logic lives in a
**presentation-free engine** (`archiver-core.js`). It never touches the DOM, a
timer, or storage:

- `archiver-core.js` — the seeded mock workspace and its rate-limited
  `history()`, the append-only/de-duplicating archive with per-channel cursors,
  owner-based access control, the archiver service (`tick()`), export, the
  retrieval query, and serialize/deserialize (with corruption recovery).
- `script.js` — the browser layer: the mock data, the identity switcher, the
  1-second auto-tick, persistence to `localStorage`, and file downloads.
- `index.html` / `style.css` — the page and its styling.
- `tests.js` — the test suite.

Because the workspace is seeded and the archive de-duplicates by Slack `ts`,
every page boundary, cursor advance, and count is exact.

## Running the tests

```bash
node tests.js
```

54 assertions cover timestamp ordering, the rate-limited and resumable
`history()` (no page overlap), archive de-duplication and cursor tracking,
owner-only access control on every gated operation, the multi-channel extraction
tick (including the no-op-until-started and drained-channel edges), both export
formats, every filter of the retrieval API, and a serialize/deserialize
round-trip that recovers gracefully from corrupt data.

## A note on faithfulness

A production version would replace `createMockSlack` with a thin adapter over
the Slack Web API (passing your bot token and honouring the real
`Retry-After`/`has_more` responses) and swap `localStorage` for a server
database. The archiver service, the cursor logic, the access checks, the export,
and the retrieval API — the parts the tests pin down — would carry over
unchanged.
