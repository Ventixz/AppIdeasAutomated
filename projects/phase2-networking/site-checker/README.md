# Site Checker with Time Scheduling

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**seventh and final entry of its Networking category**, after the
[FTP Program](../ftp-program/), the [Bandwidth Monitor](../bandwidth-monitor/),
the [Port Scanner](../port-scanner/), the [Mail Checker](../mail-checker/), the
[Country from IP Lookup](../country-from-ip/) and the
[Whois Search Tool](../whois-search/).

> "Make an application which checks whether a website is up or down. It should
> support a timer that automatically checks it at intervals, and report the
> uptime over a longer period of time."

Open `index.html`, pick a site scenario, and watch it get checked on a schedule:
a live up/down verdict, an availability timeline, the uptime percentage, a list
of outages, and a running check log. The same engine runs under Node against
**live** HTTP (see `checker-node.js`). No build step, no dependencies.

## What it actually does

"Ping a site every N seconds and say if it's up" is the one-sentence version,
and — as with every networking task in this folder — the sentence hides the
parts that are genuinely easy to get wrong. The engine is built around three of
them, and does none of them by eye.

### 1. Scheduling that doesn't drift, and doesn't stampede

A check takes time. If you schedule the next one as `now + interval`, every slow
check pushes all future checks later, and over a day the monitor quietly falls
behind — the classic `setInterval`-vs-`setTimeout` drift bug. So ticks here are
**anchored to a start time**: tick *k* is always `start + k·interval`
([`createSchedule`](./checker-core.js)), and the schedule reports the next due
time off that fixed grid, absorbing any drift.

The second half is the one most toy monitors miss. When the process was asleep —
a closed laptop, a throttled background tab — and a dozen ticks are now overdue,
firing a dozen catch-up requests at once is exactly the wrong thing to do to a
site that may already be struggling. `poll(now)` instead **skips the stale
backlog**, fires at most `maxCatchUp` checks (the most recent), and tells you how
many it dropped. The `checker-node.js` run prints `… skipped 9 overdue check(s)
after a gap` when it happens.

### 2. Confirmation — one dropped packet is not an outage

Networks blip. A single failed check is not the same thing as "the site is
down", and a monitor that pages you on every lone timeout is a monitor you turn
off. So a check has a **raw** state (up/down) and a **confirmed** state, and the
confirmed state only flips after **N consecutive agreeing checks**
(`confirmations`, the anti-flap / debounce). The "Flaky link" demo scenario has
lone blips between healthy checks: at `confirm = 2` it registers **zero
outages**, which is the correct answer.

And when a real outage *is* confirmed, it's dated **honestly** — to the **first**
of the failing run, the moment the site actually went down, not the later check
that happened to confirm it. You can see this in the demo's check log: the raw
state goes down at `04:00`, the confirmed state only flips at `05:00` (the second
failure, marked `⟵`), but the recorded incident starts at `04:00`.

### 3. Uptime that is time-weighted, not check-counted

"99% uptime" means 99% of the elapsed *time* was up. The tempting shortcut —
"90 of 100 checks passed, so 90%" — is a lie the moment checks aren't perfectly
evenly spaced (and after a sleep-gap skip, they aren't). So the engine builds a
**segment timeline** from the confirmed transitions and weighs each segment by
its **duration**, including the still-open final segment up to "as of now"
([`Monitor.summary`](./checker-core.js)). The test suite pins this down with a
deliberately uneven run where counting checks says 75% but the honest
time-weighted answer is 50%.

The same timeline gives the rest for free: the list of outages (each with its
start, end-or-ongoing, and duration), the longest outage, the current state and
how long it's held, and the share of time that was never confirmed either way.

## The network is injected — that's why it's honest *and* testable

`checker-core.js` never opens a socket and never touches the DOM. A **probe** is
any function `url → {ok, status, ms, error}` (or a promise of one), and the
scheduling, classification, confirmation and uptime math are all written once
against it:

| Where it runs | What the probe does |
| --- | --- |
| `checker-node.js` | a **real** HTTP/HTTPS `HEAD` request (GET fallback on 405/501), timed, with a timeout |
| `index.html` | replays a **scripted** scenario from `checker-fixtures.js` in simulated time |
| `tests.js` | hands the engine **explicit** results at **explicit** timestamps — no clock, no network |

Same scheduler, same confirmation, same math — only the probe and the clock
change.

## What counts as "up"

[`classify`](./checker-core.js) turns one probe result into up/down with a human
reason:

- **2xx / 3xx → up.** A redirect still means the server is alive and answering.
- **401 / 403 → up** (by default). The server is reachable; it's just guarding
  the resource. For an *uptime* monitor that's a success, not an outage. (Turn
  `treatAuthAsUp` off to require real access.)
- **4xx / 5xx → down**, with the status in the reason (`HTTP 503`).
- **A transport error → down** (`ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`, …),
  surfaced verbatim.
- **Too slow → down (degraded).** Answers past an optional latency budget
  (`--slow` / `slowMs`) count as down, because "up but unusably slow" is an
  outage to a user.

## The pieces

| File | What's in it |
| --- | --- |
| `checker-core.js` | The whole engine, DOM- and network-free: `normalizeTarget` (bare host → URL), `classify` (the up/down rules), `createSchedule` (drift-free ticks + catch-up capping), the `Monitor` (confirmation debounce, the confirmed-state segment timeline, and the time-weighted `summary`), and `humanDuration`. |
| `checker-node.js` | Binds the engine to real `http`/`https` `HEAD` requests and a real clock; watches one or many URLs on an interval; `--once`, `--count`, `--confirm`, `--timeout`, `--slow`, `--json`. |
| `checker-fixtures.js` | Scripted probe scenarios (solid, a real outage, a flapper, an auth-wall, a dead host) and the `scriptedProbe` the browser shares. |
| `index.html` | The single-page monitoring demo. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — drives the engine in simulated time and renders the verdict, timeline, stats, incidents and log. |
| `tests.js` | 92 dependency-free checks, run under Node. |

## Running the demo

Open `index.html` in any browser. Pick a scenario, set the interval and the
confirmation threshold, and press **Start** (or **Step one check** to go a tick
at a time). Watch the "Shop with a real outage" scenario register one confirmed
incident; then raise **Confirm** and watch the "Flaky link" scenario's blips
stop counting as outages.

## Running it against a live site (Node)

```bash
# Watch a site every 30s (the default), forever, until Ctrl-C:
node projects/phase2-networking/site-checker/checker-node.js https://example.com

# Five checks, 10s apart, needing 2 consecutive failures to call it down:
node projects/phase2-networking/site-checker/checker-node.js example.com --interval 10 --count 5 --confirm 2

# Watch several at once:
node projects/phase2-networking/site-checker/checker-node.js a.com b.com c.io --interval 15

# One check, machine-readable:
node projects/phase2-networking/site-checker/checker-node.js example.com --once --json

# Treat anything slower than 2s as a (degraded) outage:
node projects/phase2-networking/site-checker/checker-node.js example.com --slow 2000
```

A bare host defaults to `https://`; pass `http://…` explicitly for a plaintext
site. A live run needs outbound HTTP/HTTPS; the demo and the tests need nothing.

## Running the tests

```bash
node projects/phase2-networking/site-checker/tests.js
```

**92 checks**, in twelve layers:

1. **Target normalisation** — bare host → `https://`, scheme/host/port/path
   extraction, non-http and empty/whitespace input rejected.
2. **Classification** — 2xx/3xx up, 4xx/5xx down, 401/403 as up (and off),
   transport errors down, the slow-budget "degraded" rule, boundary statuses.
3. **Schedule — drift-free ticks** — ticks anchored to the start, `indexAt`, and
   the next due time staying on the grid despite a late poll.
4. **Schedule — catch-up capping** — a long gap fires only `maxCatchUp` checks
   (the most recent), reports the skipped count, and the budget is configurable.
5. **Confirmation debounce** — instant flips at `confirm = 1`; a lone blip never
   flipping at `confirm = 2`.
6. **Transition dating** — a confirmed outage dated to the *first* failing check,
   not the one that confirmed it.
7. **Time-weighted uptime** — an uneven run where counting checks (75%) and
   weighing by time (50%) disagree, and the engine gives the honest 50%.
8. **Segments & incidents** — multiple outages, an ongoing one, the longest-outage
   figure, and segments that tile the whole window with no gaps or overlaps.
9. **The unknown window** — the before-first-confirmation span handled correctly.
10. **Ordering guard** — out-of-order checks and an `asOf` before the start are
    rejected rather than silently miscounted.
11. **`humanDuration`** — ms / s / m / h / d formatting.
12. **End-to-end over the fixtures** — every bundled scenario driven through the
    scheduler and monitor exactly as the UI does, asserting its outage count,
    final state and uptime.

## A note on scope and the data

A browser can't open arbitrary sockets or sit watching a site for real hours, so
the demo replays **scripted** probe sequences through the real engine in
**simulated** time — enough to light up every path (a clean site, a confirmed
outage with recovery, a debounced flapper, an auth-wall, a dead host). It is not
a hosted uptime service: the value here isn't the pinging, it's a **correct
scheduler** that doesn't drift or stampede, **confirmation** that tells a blip
from an outage and dates the change honestly, and **uptime math** that weighs
time instead of counting checks — all pinned down by tests and ready to point at
live sites under Node.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
