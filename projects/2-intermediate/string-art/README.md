# String Art

A multicolored line spawns at a random spot, drifts across the canvas, bounces
off every wall — jittering its angle a little on each bounce — and leaves a
fading ripple of its recent positions behind it. Pure vanilla canvas: no
animation library, no build step, no server.

Source idea: [app-ideas / String Art](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/String-Art.md)

## Running

Open `index.html` in any modern browser — no dependencies, no network:

```bash
open projects/2-intermediate/string-art/index.html
```

## How to use

The animation starts on its own. The controls below the canvas are live:

- **Lines** — draw 1–8 independent strands, each on its own trajectory and hue.
- **Line length** — how long each line segment is, in pixels.
- **Velocity** — how fast the endpoints travel each tick.
- **Trail length** — how many past positions linger. Only the most recent ~75%
  of the trail is bright enough to see, which is what creates the ripple.
- **Pause / Resume** and **Reset** (re-seed all strands).

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Draw a multicolored line at a random start position | `createLine()` in [`stringart-core.js`](./stringart-core.js) |
| Redraw every 20ms along a trajectory | `STEP_MS = 20` throttle in [`script.js`](./script.js) |
| Bounce off the boundary and randomly alter the angle | `stepPoint()` + `jitterVelocity()` in the core |
| Progressively fade old lines to ~10–20 visible | `trailAlpha()` + the history ring buffer in `script.js` |
| **Bonus:** user-set line length and velocity | the **Line length** / **Velocity** sliders |
| **Bonus:** multiple lines on different trajectories | the **Lines** slider (each strand is seeded independently) |
| **Constraint:** vanilla HTML/CSS/JS only | no libraries anywhere — just the Canvas 2D API |

## Design notes

- **Reflection preserves speed.** When an endpoint crosses a wall, `stepPoint`
  reflects its position back inside and flips the relevant velocity component,
  so a line never escapes the box or gets stuck on an edge.
- **Angle jitter is a rotation, not a random re-aim.** `jitterVelocity` rotates
  the velocity vector by a small random angle while keeping its magnitude, so
  bounces feel organic without lines speeding up or stalling.
- **The core is pure and deterministic.** Every function that needs randomness
  takes an injected `rng`, so [`tests.js`](./tests.js) can drive thousands of
  steps with a seeded generator and assert the endpoints never leave the bounds.

## Tests

The geometry/physics is covered by a dependency-free suite:

```bash
node projects/2-intermediate/string-art/tests.js
# or, if you use Jest:
npx jest projects/2-intermediate/string-art/tests.js
```

Covered: interior movement, wall reflection off all four sides, speed-preserving
angle jitter, hue cycling, no-mutation of inputs, a 5000-step in-bounds property
check, `createLine` length/speed/placement invariants, and the trail fade curve.
