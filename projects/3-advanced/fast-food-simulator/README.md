# Fast Food Simulator

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Fast Food Simulator spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/FastFood-App.md).

A take-away restaurant modelled end to end. Customers **arrive** in the order
line at a fixed interval, an **order taker** writes each ticket, the **cook**
works through the kitchen queue one order at a time, and the **server** calls
finished orders at the pickup counter. Set the intervals, press **Start**, and
watch the shop run — orders back up in the kitchen when the cook can't keep pace,
then drain again when arrivals slow down.

Open `index.html` in a browser. No build step or server required.

## What it does

- **Configurable pipeline.** Two required intervals — customer arrival and order
  fulfilment — plus three bonus knobs: order-taker time, server delivery time,
  and a total simulation duration.
- **Input validation with tailored warnings.** Each field gets its own message
  for empty, non-numeric, non-positive, too-fast, or too-slow entries, and
  **Start** refuses to run until every field is valid.
- **Five live stations.** Order line (count of people waiting), order taker
  (which order is being written), kitchen (order cooking + queue length with a
  progress bar), pickup (the order number now being served + serving-line
  length), and a served tally. The active stations light up as work moves.
- **Event log.** Every arrival, order taken, order placed, cook start/finish,
  pickup, and hand-over is written to a scrollable, timestamped log.
- **Start / Stop.** Stop freezes the shop mid-service; Start begins a fresh run.
- Adjustable **playback speed** (1×–8×) and a light/dark theme toggle.

## The Promise model the spec asks for

The spec is explicit: *"Order tickets can be represented as two different types
of Promises — one the Server waits on while the Cook prepares the order and
another the Customer waits on while in the serving line,"* and JavaScript
developers must use **native Promises, not `async/await`**.

This build follows that literally. Every order ticket (`createTicket` in
`fastfood-core.js`) carries **two native `Promise` objects**:

- **`prep`** — resolves when the cook finishes the food. The server "waits on"
  this: an order is only eligible for pickup once its `prep` promise has settled.
- **`serve`** — resolves when the server hands the order over. The customer
  "waits on" this while standing in the serving line.

The engine holds each promise's resolver and settles it at the matching state
transition (`cook-done` → `prep`, `served` → `serve`). No `async`/`await`
appears anywhere in the codebase — ticket flow is expressed with real Promise
objects, and the test suite awaits them to prove `prep` settles before `serve`,
each with the correct order number.

## Honoring the spec's constraints

- **Native features only, no simulation libraries.** The whole shop is plain
  JavaScript — one dependency-free engine module and a DOM renderer.
- **Fixed arrival interval.** New customers join the order line at exactly the
  configured cadence (`spawnArrivals`), with catch-up handling so a slow frame
  never drops an arrival.
- **Constant fulfilment rate.** The cook prepares one order at a time, each
  taking exactly the fulfilment interval — so a fast arrival rate visibly backs
  the kitchen queue up.

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** (`fastfood-core.js`). It knows nothing about the
DOM: you hand it a config and call `step(dt)` with elapsed seconds, and it
returns the events that happened and exposes a `snapshot()` of the shop.

- **`index.html` + `script.js`** drive that engine with `requestAnimationFrame`
  (scaled by the speed selector) and paint the stations, counters, and log. The
  browser never re-implements any restaurant logic; it only renders snapshots
  and reacts to events.
- **`tests.js`** drives the *same* engine by stepping simulated time, so the
  Node suite and the browser exercise identical behaviour.

## Running the tests

```bash
node tests.js
```

The suite (48 assertions) covers interval validation and its warning reasons,
the two-Promise ticket model, a customer flowing arrive → order → cook → serve,
event ordering, sequential order numbers, the kitchen backing up under load, the
server only picking up cooked orders, Stop, the bonus total-duration auto-stop,
and that `pendingCount()` conserves people (nobody is lost or double-counted).

---

*Built automatically by [Claude Code](https://claude.com/claude-code) as part of
the [AppIdeasAutomated](../../../README.md) daily routine.*
