# First DB App

A first look at **IndexedDB**, the database built into every modern browser.
The app seeds a small set of customers, queries them back through a cursor, and
clears the store — and because IndexedDB is persistent, the data survives a page
reload (try it: load, refresh, then query).

Source idea: [app-ideas / First DB App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/First-DB-App.md)

> ⚠️ Browser databases live in the (insecure) client. Only ever store
> non-sensitive data — the sample customers here are entirely fictional.

## Features

- **Three operations** — *Load DB*, *Query DB*, and *Clear DB*, each wrapped in
  its own IndexedDB transaction.
- **Notification panel** — a single status line that reports the result of the
  last action, color-coded (info / success / warning / error).
- **Operation log** — a scrollable, timestamped log narrating the start and end
  of every operation, so you can see the asynchronous steps as they happen.
- **Query results panel** — scrollable list of the returned customer records,
  with an explicit "no rows" message when the store is empty.
- **`queryAllRows`** — reads every record with an `openCursor()` loop rather
  than `getAll()`, to show the row-by-row iteration model.
- **Cross-session persistence** — reload the page and the data is still there;
  startup inspects the store and sets the UI to match.

## Bonus features implemented

- **Dynamic button states** — *Query* and *Clear* are disabled until the store
  has rows, all buttons disable while an operation is in flight, and the state
  is re-derived from the database after any error.
- **Extended data model** — each customer carries a **date of last order** and
  **total annual sales** (formatted as currency) on top of the basics.
- **Retrospective** — see the IndexedDB notes below.

## How it works

IndexedDB is asynchronous and event-based. Every helper opens the database with
`indexedDB.open(name, version)`, creating the `customers` object store in the
`onupgradeneeded` handler the first time it runs. Each operation then runs in a
transaction:

```js
const tx = db.transaction("customers", "readwrite");
tx.objectStore("customers").put(record);
tx.oncomplete = () => resolve();
```

To keep the control flow readable, each event-based request is wrapped in a
`Promise`, so the handlers can `await` them in sequence.

## Retrospective — when is IndexedDB the right tool?

**What it is.** A transactional, asynchronous, key-value/object database in the
browser. It stores structured JavaScript objects (not just strings), supports
indexes for querying, and can hold large amounts of data.

| | IndexedDB | `localStorage` | File storage |
| --- | --- | --- | --- |
| Data type | Structured objects | Strings only | Files / blobs |
| Capacity | Large (hundreds of MB+) | ~5–10 MB | OS-dependent |
| API | Async, transactional | Sync, simple | Async (File System API) |
| Querying | Indexes + cursors | None (manual) | None |

**Advantages:** persistent across sessions, large capacity, transactional, can
store rich objects, and queryable via indexes.

**Disadvantages:** the API is verbose and callback-heavy (hence the Promise
wrappers here), it is client-side and therefore insecure, and it is overkill for
a handful of simple values.

**When to reach for it:** offline-capable apps, caching sizeable structured data
client-side, or anything that outgrows `localStorage`'s string-only, ~5 MB
limit. For a few flags or preferences, `localStorage` is simpler. For anything
sensitive or authoritative, use a real server-side database.

## Run it

Open `index.html` in any browser — no build step or dependencies. (Use a normal
window; some browsers disable IndexedDB in private/incognito mode.)
