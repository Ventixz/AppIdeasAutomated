# Bandwidth Monitor

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**second entry of its Networking category**, after the
[FTP Program](../ftp-program/).

> "Bandwidth Monitor — Monitor your Internet bandwidth and keep track of it over
> several days."

Open `index.html` in a browser for a live throughput monitor: two rate gauges
(download / upload), a rolling chart, and a **day-by-day history table**. No
build step, no dependencies. The same engine reads **real Linux interface
counters** from `/proc/net/dev` under Node (see the tests).

## What it does

A bandwidth monitor's job sounds trivial — "show me my speed" — but the data it
starts from is not a speed. A network interface only ever gives you a
**cumulative byte counter**: a number that counts up forever as bytes go by. The
whole task is turning that counter into a rate, a daily total, and a week of
history — and the counter has two nasty habits that a naive
`rate = (now − before) / seconds` gets badly wrong.

## The honest part: a counter is not a rate

### 1. Counters **wrap**

Interface byte counters are fixed-width unsigned integers. On older and embedded
stacks they are **32 bits**, so they roll over to 0 every ~4.3 GB. The instant
that happens, `now − before` goes *negative*, and a naive monitor paints a
giant downward (or, after an abs(), upward) spike that never happened.

[`RateSampler`](./bandwidth-core.js) recognises the rollover: when the counter
steps backwards, it computes the wrapped delta `now + (modulus − before)` and
accepts it **only if** the implied rate is physically plausible (≤ a 10 Gbps
ceiling). The demo's "32-bit wrap" source starts a counter just below `2³²` so
you can watch the rate stay flat *through* the rollover instead of spiking — the
moment is marked on the chart with a dashed line.

### 2. Counters **reset**

Take the interface down and back up — or reboot — and the counter restarts from
0. That *also* looks like a backwards step, but it is **not** a wrap: the implied
"wrapped" rate would be absurd (gigabytes in one tick). The sampler tells the two
apart by that plausibility test. On a reset it does the honest thing: it records
the bytes it can still account for, but reports the **rate as unknown (`null`)**
rather than inventing one — because it genuinely cannot know how long the
interface was up before the sample. The chart simply breaks its line across the
gap instead of drawing a lie.

### 3. 64-bit counters don't fit in a double

Modern Linux counters are **64-bit** (up to ~1.8 × 10¹⁹), well past the
`2⁵³` where a JavaScript `number` stops being exact. Counters are therefore held
as **`BigInt`** throughout; only the *delta* for a single interval is narrowed to
a `number` for display, where a double has all the precision a rate needs. A
64-bit counter advancing by an exact amount is tracked to the byte.

### 4. Bits vs. bytes

The oldest trap in network tooling: **data volume** is counted in bytes (and
conventionally shown in binary KiB/MiB/GiB), while **throughput** is quoted in
**bits** per second (SI, 1000-based). An 8 MB/s download is a 64 Mbit/s link.
`formatBytes` and `formatRate` keep the two worlds separate, and the chart has a
**bits/s ↔ bytes/s** toggle so you can see both without the factor-of-8 (and
1000-vs-1024) confusion.

## "Over several days"

The task asks to *keep track over several days*, so a
[`DailyLedger`](./bandwidth-core.js) buckets every interval's bytes by calendar
day, tracks each day's total and peak rate, and keeps a rolling window of the
last 30 days (older days are evicted so a long-running monitor doesn't grow
without bound). The day key is injectable, so the tests — and callers in other
time zones — stay in control of what "a day" means. The page's history table is
exactly this ledger; "add sample days" seeds a few days of plausible history so
you don't have to wait a week to see it work.

## The pieces

| File | What's in it |
| --- | --- |
| `bandwidth-core.js` | The whole engine, DOM-free and transport-agnostic: `RateSampler` (counter → rate, with wrap/reset handling), `DailyLedger`, `RingBuffer`, the `BandwidthMonitor` front door, `formatBytes` / `formatRate`, and `parseProcNetDev`. |
| `bandwidth-node.js` | Binds the same engine to **real** Linux counters by reading and sampling `/proc/net/dev`. Degrades honestly off Linux. |
| `index.html` | The single-page monitor. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — four counter sources (steady / bursty / 32-bit-wrap / **real** page-download bytes via the Resource Timing API), the tick loop, the SVG chart and the history table. |
| `tests.js` | 24 dependency-free checks, run under Node. |

## Running the tests

```bash
node projects/phase2-networking/bandwidth-monitor/tests.js
```

**24 checks**, in four layers:

1. **Pure rate math** — the baseline, steady rates honouring real elapsed time,
   a divide-by-zero-safe non-positive interval, 32-bit **wrap**, interface
   **reset** (bytes recorded, rate `null`), the wrap-vs-reset decision, and
   exact 64-bit `BigInt` deltas.
2. **Ledger, ring buffer, formatting** — per-day bucketing, retention/eviction
   oldest-first, grand totals, ring-buffer wraparound, null-aware averaging, and
   `formatBytes` / `formatRate` keeping bits (SI) and bytes (IEC) honestly apart.
3. **`/proc/net/dev` parsing** — against a fixed fixture, plus driving the
   sampler with real 64-bit counter values.
4. **Live interface read** — the host's *actual* `/proc/net/dev` counters when
   run on Linux (skipped, not faked, otherwise).

## A note on scope

A web page can't read your NIC's hardware counters — the browser sandbox won't
allow it — so the demo feeds the engine a simulated (but genuinely cumulative)
counter, with one source that reads the **real** bytes this very page has
downloaded via the Resource Timing API. The value here isn't a driver; it's a
**correct counter-to-rate engine**: wrap handling, reset handling, exact 64-bit
arithmetic, the bits/bytes distinction and multi-day bookkeeping, all written
honestly and pinned down by tests — and proven to run unchanged against real
kernel counters, not just a simulation.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
