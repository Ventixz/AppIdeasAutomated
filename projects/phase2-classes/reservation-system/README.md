# Airline / Hotel Reservation System

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**third entry of its Classes (Object-Oriented Programming) category**, after
[Product Inventory](../product-inventory/) and the Airline/Hotel pair's first
sibling.

> "Create a reservation system which books airline seats or hotel rooms. It
> charges various rates for particular sections of the plane or hotel. Example,
> first class is more expensive than coach. Hotel rooms have different rates for
> suites, views, beds, etc. Make a reservation system that holds the various
> information."

This one is modelled as a **hotel** (the richer of the two — rooms, types,
stays spanning nights), but the engine is the same shape an airline needs:
a **fare class** is a `RoomType`, a **seat** is a `Room`, and a **flight** is a
one-night stay. Open `index.html` to book rooms on a live calendar, or run
`node reservation-node.js` for the same classes behind a CLI. No build step, no
dependencies.

## The point of this one is the design

The Classes category isn't about features; it's about objects that are correct
by construction. "A hotel has rooms of different types at different rates; a
guest books a room for a stay" is one sentence, and it hides three things a
naïve version gets wrong. The engine ([`reservation-core.js`](./reservation-core.js))
is built around them.

### 1. A room cannot be double-booked

This is the entire reason a reservation system is hard: two overlapping stays on
the same room is the one state the system must never enter. The guard lives in
**`Room`**, not in any front end — `book` refuses an overlapping reservation
and throws, naming the clash:

```
room 101 is already booked 2026-11-01 → 2026-11-04 (reservation R-0001);
cannot also book 2026-11-03 → 2026-11-05
```

Because the guard is in the object, the browser, the CLI, and the tests all hit
it; none can route around it.

### 2. Dates are **half-open** — checkout day frees the room

The subtle off-by-one that sinks naïve booking code: if guest A checks out on
the 4th and guest B checks in on the 4th, that is **not** a conflict — A left in
the morning, B arrives in the afternoon, exactly as a real hotel turns a room
over. A stay is the half-open interval `[checkIn, checkOut)`, so two stays clash
only when each starts strictly before the other ends:

```js
this.checkIn < other.checkOut && other.checkIn < this.checkOut
```

`DateRange` keeps dates as integer "day numbers" (days since the epoch, in UTC),
so overlap and night-counting are plain integer comparisons — no timezone or DST
surprises — and `2026-02-30` is rejected rather than silently rolled into March.

### 3. Money is integer cents, and the hotel is one index of truth

A stay's price is a nightly **rate × night count**, and revenue sums that across
the property. `0.1 + 0.2 !== 0.3` in IEEE-754, so rates live as **integer
cents** (`Money.parse` / `Money.format`) and every total is exact integer math.
A `Reservation`'s total is **derived** (`rate × nights`), never stored, so it
can't drift from the room's rate. The `Hotel` keeps rooms in a `Map` keyed by
number and reservations in a `Map` keyed by id; every rollup — `availableRooms`,
`occupancyOn`, `revenueCents` — is **derived from those on demand**, so the
summary can never disagree with the bookings you see.

## Files

| File | What it is |
| --- | --- |
| [`reservation-core.js`](./reservation-core.js) | The whole engine: `Money`, `DateRange`, `RoomType`, `Room`, `Reservation`, `Hotel`, `ReservationError`. DOM-free, network-free. |
| [`reservation-fixtures.js`](./reservation-fixtures.js) | A sample hotel (five room types, nine rooms, a few stays including a same-day turnover) and a `buildHotel` helper shared by all three front ends. |
| [`tests.js`](./tests.js) | 52 dependency-free checks: the no-double-booking guard, half-open overlap, exact pricing, availability, occupancy, cancellation. |
| [`reservation-node.js`](./reservation-node.js) | A CLI front end — a room roster and reservation report plus a tiny REPL of booking commands. |
| [`index.html`](./index.html) · [`script.js`](./script.js) · [`style.css`](./style.css) | The browser demo: a booking form, an availability search, and a live reservations table over the same classes. |

## Run it

```bash
node tests.js                         # the engine's proof suite (52 checks)
node reservation-node.js              # demo hotel: room roster + reservations + revenue
node reservation-node.js --json       # the same, as JSON

# drive it with commands (also works interactively, and over a pipe):
echo "avail 2026-11-02 2026-11-05 Deluxe; book 202 'Jane Doe' 2026-11-02 2026-11-05; revenue" \
     | node reservation-node.js
```

Then open `index.html` in a browser for the interactive version.

## One engine, three front ends

`reservation-core.js` exports the classes and touches nothing outside itself —
no DOM, no hidden clock, no I/O. The CLI binds them to `stdin`/`stdout`, the demo
binds them to a form and a table, and the tests drive them with fixed dates. The
rules only exist in one place, so the three can't drift apart.

---

*Part of [AppIdeasAutomated](../../../README.md) — one project built per day by
an automated Claude Code routine. This is Phase 2, Classes category, project 3.*
