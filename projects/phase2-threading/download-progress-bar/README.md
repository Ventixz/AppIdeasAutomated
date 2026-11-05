# Download Progress Bar

> Source 2 (karan/Projects) · **Threading** · project 1 of 2
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Progress Bar — Download a file from a server
and show a progress bar as the download goes. (threading)"*

The deliverable is a bar that creeps to 100%. That part is easy. The reason this
sits in the **Threading** category is the part nobody mentions: a real download
runs **several transfers at once** — split the file into ranges, fetch them in
parallel, finish in a quarter of the time — and now every one of those transfers
wants to move the *same* bar at the same time. Get the coordination wrong and the
bar lies: it stalls at 97%, or races past 100%, or jitters backwards. This
project is about getting that one thing right.

## The bug the naive version has

The obvious design keeps a single shared counter and lets each worker add to it
as bytes arrive:

```js
function onChunk(chunk) {
  shared.done += chunk.length;        // <-- read, add, write back
  redraw(shared.done / shared.total);
}
```

`shared.done += n` is not one step. It is **read** `done`, **add** `n`, **write**
`done`. When two workers' chunks are handled around the same moment — two threads,
or two interleaved async callbacks, or two events off the same loop — both read
the *same* old value, both add their own bytes, and the second write clobbers the
first. One chunk's bytes vanish from the total. Nothing crashes. The download
completes perfectly on disk. The **bar just never reaches 100%**, because it
quietly lost count somewhere around byte forty million.

The usual "fix" is to wrap the `+=` in a lock. That removes the lost update, but
it serialises every worker on the hottest path in the program, and it *still*
breaks the instant an update is delivered twice (a retried request) or dropped
(a coalesced event) — the counter is now permanently off by that chunk.

## The design: absolute positions, one owner

The fix is to change *what* a worker reports, not to guard the shared write:

> Each worker reports its **own cumulative bytes so far** — an absolute,
> monotonic position — never a delta. One **aggregator** stores the latest
> position *per worker* and the total is the sum of those positions.

A worker never reads the shared total, so there is no read-modify-write to lose.
And because the number it sends is an **absolute position**, the update is
**idempotent and order-independent**:

| what goes wrong in flight | why the total is still correct |
| --- | --- |
| the same update is **delivered twice** | writing `worker 2 = 8 MiB` twice is a no-op the second time |
| an update is **dropped** | the next update carries the true position and overwrites the gap — self-healing |
| updates arrive **out of order** | a stale position is *lower* than what's stored, so it's ignored (monotonic guard) |
| a worker **reports past its size** | clamped to its declared total — one part can't overflow the whole |

Compare that to deltas: a dropped `+= n` is gone *forever*, and a duplicated
`+= n` inflates the total *forever*. Absolute reporting turns every one of those
failures into something that corrects itself on the very next packet. That is the
entire idea, and it is the same principle that makes idempotent writes the
backbone of reliable distributed systems.

`ProgressAggregator` is the single owner. Workers only ever call
`report(id, bytesSoFar)`; the sum is computed in exactly one place, so the "race"
doesn't need a lock because it doesn't exist.

## Two more things a progress bar has to get right

**A smoothed rate, or the ETA is noise.** Instantaneous rate (bytes since last
tick ÷ seconds since last tick) swings wildly because TCP arrives in bursts — an
ETA computed from it flickers between "3s" and "5 min" and is worthless.
`EwmaRate` keeps an exponentially-weighted moving average with one knob, a
`halfLife`: an old sample's weight halves every `halfLife` seconds. Unlike a
fixed-window average it needs no history buffer and copes correctly with the
*irregular* sample spacing that real I/O produces. ETA is then just
`bytesRemaining / smoothedRate`.

**Unknown total is a real state, not zero.** A chunked HTTP response has no
`Content-Length`. A bar that treats "unknown" as "0 of 0 = 100%" is a lie, and
one that divides by zero is worse. Here an unknown total makes `fraction` and
`etaSec` explicitly `null`, and the renderer shows an **indeterminate** bar until
the size is learned (`setTotal`) mid-flight.

## Files

| file | what it is |
| --- | --- |
| `progress-core.js` | the whole engine — `ProgressAggregator`, `EwmaRate`, formatting, `renderBar`. No DOM, no sockets, no timers. |
| `progress-node.js` | real I/O: downloads a URL with **N concurrent HTTP range requests**, each a worker reporting its own bytes, live bar in the terminal. |
| `index.html` + `script.js` + `style.css` | a browser demo that simulates the concurrent workers, with a **Chaos mode** that drops, duplicates and reorders updates so you can watch the bar stay correct anyway. |
| `tests.js` | dependency-free checks. The core ones replay, drop, duplicate and scramble updates and assert the aggregate is still exact. |

## Run it

**The browser demo** — open `index.html`. Hit *Start download*, then tick
*Chaos mode* and start again: the chaos log shows updates being dropped,
duplicated and reordered, and the bar still lands on exactly 100%.

**Real concurrent download** (Node, no dependencies):

```bash
# split a file into 4 parallel range-requests, live bar in the terminal:
node progress-node.js https://example.com/big.iso out.iso --concurrency=4

# no network handy? simulate four concurrent parts:
node progress-node.js --demo
```

**The tests:**

```bash
node tests.js
#  ✓ all 21 checks passing
```

## What this demonstrates about threading

The lesson generalises past progress bars: when many concurrent actors share
state, the robust move is usually to **give each actor its own slice and derive
the whole from the parts**, rather than to let them all mutate one aggregate
behind a lock. Reporting absolute, monotonic positions instead of deltas makes
the updates idempotent — and idempotent updates survive the drops, duplicates
and reorderings that concurrency and unreliable delivery guarantee you'll get.

---

*Part of a daily automated [Claude Code](https://claude.com/claude-code)
routine that builds one project per day. See the repository
[`README.md`](../../../README.md) and [`PROGRESS.md`](../../../PROGRESS.md).*
