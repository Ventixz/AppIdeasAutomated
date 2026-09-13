# Alarm Clock

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
twelfth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/),
[Tile Cost Calculator](../tile-cost-calculator/),
[Mortgage Calculator](../mortgage-calculator/),
[Change Return Program](../change-return/),
[Binary to Decimal and Back Converter](../binary-decimal-converter/),
[Calculator](../calculator/) and
[Unit Converter](../unit-converter/).

> "Alarm Clock — A simple clock where it plays a sound after X number of
> minutes/seconds or at a particular time."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Set an alarm for a clock time, or start a
countdown timer; when one rings, the page beeps (synthesised with Web Audio —
no sound files) and shows a snooze / dismiss card.

## What it does

- **Clock-time alarms** — "07:30", once or repeating. Repeat presets for
  **Every day**, **Weekdays**, **Weekends**, or tap individual days.
- **Countdown timers** — "after X minutes/seconds", entered as `5m`, `1h30m`,
  `90` (seconds) or `mm:ss` / `hh:mm:ss`. Live countdown in the list.
- **Snooze** (9 minutes) and **dismiss** on the ringing card; enable/disable
  toggles and delete on each scheduled item.
- Alarms persist in this browser via `localStorage`.

## The interesting part: scheduling is arithmetic, and it belongs in a testable core

An alarm clock looks like a UI problem, but the part that actually has to be
*correct* is pure arithmetic over timestamps: given the wall clock, when does
this alarm next ring, and — each time the page ticks — which alarms have crossed
their ring time since the previous tick? None of that needs the DOM, audio, or
the real `Date.now()`. So all of it lives in [`alarm-core.js`](./alarm-core.js),
which is DOM-free, I/O-free and console-free, and takes **every "now" as an
argument**. That single decision is what makes the behaviour testable: the suite
fast-forwards through days and weeks in milliseconds instead of waiting for real
time to pass.

### `nextAlarmOccurrence(alarm, nowMs)`

Returns the next ring **strictly after** `nowMs`, computed in *local* wall-clock
time (so "07:30" is 07:30 regardless of DST). A one-shot rolls to tomorrow once
today's time has passed; a repeating alarm scans up to a week ahead for its next
matching weekday. "Strictly after" is the detail that stops an alarm from
re-firing at the exact instant it just rang.

### `tick(nowMs)` — the half-open window

The core reports every ring whose moment falls in the **half-open** interval
`(lastTick, now]`. Half-open at the bottom is what guarantees a ring is reported
**exactly once** even when a tick lands precisely on it. And because the window
can be arbitrarily wide, a tab that slept for three days still catches every
missed daily ring on its next tick — the core walks each occurrence in the gap
rather than assuming one ring per tick.

Firing a one-shot alarm disables it; firing a timer marks it done; a fulfilled
snooze clears itself. **Snooze is tracked separately** from an alarm's normal
schedule, so snoozing a daily alarm still leaves tomorrow's ring in place.

### Parsing and formatting

`parseTimeOfDay` accepts 24-hour and 12-hour input (`07:30`, `7:30 AM`,
`23:05:09`) and rejects impossible times with plain-English errors.
`parseDuration` accepts `90`, `5m`, `1h30m`, `1h 30m 15s`, `1:30` and `1:30:00`.
Each has a formatting inverse the tests round-trip against.

`index.html` + `script.js` are only a thin layer over that core: the DOM, a
`setInterval` feeding the real clock into `tick`, a Web Audio beep, and
`localStorage`.

## Tests

A dependency-free suite exercises the core without any waiting:

- **Parsing/formatting** — 24h and 12h times, all the duration forms, their
  error surfaces, and parse→format→parse round-trips.
- **Scheduling** — one-shot / daily / weekly / weekend next-occurrence,
  including the "already passed today", "exact instant", and "wraps a full week"
  edges.
- **`tick` contract** — fires once, half-open boundary behaviour, no double
  fire on a repeated instant, one-shot self-disable, and catching every missed
  ring across a multi-day gap.
- **Timers and snooze** — fire once at the right moment; snooze fires later and
  leaves a repeating alarm's schedule intact.
- **Five property sweeps** — occurrences are always strictly future, one-shots
  land within 24h, weekly alarms always land on a chosen day, minute-by-minute
  ticking fires a daily alarm exactly once per day, and hour-by-hour ticking
  fires a Weekdays alarm exactly five times a week.

```bash
node projects/phase2-numbers/alarm-clock/tests.js   # -> 95 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
