# Stopwatch App

A stopwatch that counts up in `mm:ss.cc`, with start, stop, resume, and reset —
plus **lap** recording and clearing.

Source idea: [app-ideas / Stopwatch App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Stopwatch-App.md)

## Features

- **Start the clock** — begins counting up from zero.
- **Stop the clock** — freezes the display.
- **Resume timing** — pressing start again continues from where it stopped, rather
  than restarting.
- **Reset** — returns the clock to `00:00.00` and clears every lap.
- **Laps** *(bonus)* — record a split while running; each row shows the split
  (time since the previous lap) and the cumulative time.
- **Clear laps** *(bonus)* — reset wipes the lap list along with the clock.
- **Fastest / slowest highlight** — once there are two or more laps, the quickest
  split is tinted green and the slowest red.
- **Spacebar** toggles start/stop for hands-on-keyboard timing.

## How it works

Elapsed time is derived from `Date.now()` deltas, not from counting interval
ticks. Each run segment records the moment it started; the total is the
accumulated `elapsed` plus the time since the current segment began. Because the
value is computed from wall-clock timestamps, it stays accurate even when the
browser throttles background timers — the `setInterval` only exists to repaint
the display, not to keep time.

Resuming works because stop() folds the current segment into `elapsed` and
start() opens a fresh segment, so the count picks up exactly where it left off.

## Run it

Open `index.html` in any browser — no build step, no dependencies.
