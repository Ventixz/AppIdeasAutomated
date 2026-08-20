# Elevator

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Elevator App spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Elevator-App.md).

A four-floor building, one elevator car, and a **FIFO queue** of hall calls
answered in the order they came in — no "nearest floor first" cheating. When
the car arrives, you have a **5-second dwell window** to pick a destination on
the panel; if the timer runs out, it moves on to the next request. When
everything is served the car quietly returns to floor 1.

Open `index.html` in a browser. No build step or server required.

## What it does

- **Building cross-section.** A shaft on the left with the elevator car
  animating up and down, and four floors on the right with their appropriate
  hall buttons (▲ / ▼) beside each one — no down button on the ground floor,
  no up button on the top.
- **Elevator panel.** A row of destination buttons that only accept input
  while the car is standing at a floor. A visible **dwell bar** ticks down
  the 5 seconds you have to press one.
- **Live request queue.** The panel on the right shows every pending hall call
  in FIFO order, with the head of the queue highlighted; a badge shows the
  total open items (hall + panel).
- **Event log.** Every dispatch, arrival, dwell timeout, return-to-1, and
  queue-full alarm is written to a scrollable log so you can watch the state
  machine work.

### Bonus features from the spec

- **Queue-full alarm.** When the request queue reaches the developer-defined
  capacity (default 8, adjustable in Settings), a **triad alarm tone** plays
  and the queue panel flashes.
- **Arrival ding.** A soft two-tone ding when the car arrives at any floor.
  Sound can be muted from the header.
- **Animated occupants.** A toggle drops random 🧑 / 👩 / 👨 emoji onto
  random floors and presses the correct hall button on their behalf; when
  the car reaches them they board and disappear.
- **Configurable occupant frequency.** The Settings drawer takes a
  seconds-per-occupant number.

## Honoring the spec's constraints

The spec is very specific about two things, and this build follows both:

- **"One event handler for all floor buttons."** The entire hall (eight
  buttons — up + down across the middle floors, one on each edge) is served
  by a **single click listener** on the `<ol>` of floors, using event
  delegation off `data-floor` / `data-direction`.
- **"One event handler for all elevator panel buttons."** All four
  destination buttons share a **single click listener** on the panel `<div>`.

Together that's **two listeners for every button in the UI**, exactly what
the spec's "single handler" constraint asks for.

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** (`elevator-core.js`). It knows nothing about the
DOM, CSS, or audio — only about the state machine:

- `IDLE` → nothing to do,
- `MOVING` → travelling toward a target floor at `speed` floors/second,
- `WAITING` → arrived, counting down the 5-second dwell window.

Time is passed in as `dt` seconds, so the same engine runs in the browser at
60 fps and headlessly in the Node test suite:

```js
const { createElevator } = require('./elevator-core.js');
const el = createElevator({ speed: 4, dwellSeconds: 1 });
el.pressHall({ floor: 3, direction: 'up' });
el.pressHall({ floor: 4, direction: 'down' });
el.pressHall({ floor: 2, direction: 'up' });
const { log, finalFloor } = el.runToIdle();
// log holds every dispatch/arrive/return-home event; finalFloor is 1.
```

Because the engine is pure it ships a dependency-free test suite covering
hall-call validation, spec defaults, FIFO servicing, duplicate coalescing,
dwell timeout, panel-press priority, invalid-press rejection, queue-full
alarm, movement kinematics, return-home behaviour, and shaft-bound
invariants:

```bash
node projects/3-advanced/elevator/tests.js   # -> 65 passed, 0 failed.
```

## Files

| File | Role |
| --- | --- |
| `index.html` | The building UI shell — shaft, floors, panel, log. |
| `elevator-core.js` | Pure engine: FIFO queue, dwell timer, movement kinematics. |
| `script.js` | DOM wiring: two delegated listeners, requestAnimationFrame loop, sound, occupants. |
| `style.css` | Light/dark theming, shaft, floors, buttons, queue. |
| `tests.js` | Node test suite for the engine. |
