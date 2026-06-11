# Countdown Timer

Name an event, pick a date (and optionally a time), and watch it tick down in
days, hours, minutes, and seconds. All of the date math is done with builtin
`Date` arithmetic — no MomentJS or any other library, as the spec requires.

Source idea: [app-ideas / Countdown Timer App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Countdown-Timer-App.md)

## Features

- **Event input** — name, date, and an optional time. A blank time defaults to
  midnight local time.
- **Live countdown** — a `setInterval` ticks once a second; seconds cascade into
  minutes, minutes into hours, hours into days.
- **Validation warnings** — inline alerts for a blank name, a missing/invalid
  date, or a date beyond the range JS `Date` can represent.

### Bonus features

- **Persistence** — events are stored in `localStorage`, so they survive a page
  reload or browser restart.
- **Multiple events** — track as many countdowns as you like, side by side.
- **Arrival alert** — when a countdown hits zero it flashes "It's time!" and
  fires a one-time `alert`, then stays marked as done.

## How it works

Each event stores its target as a millisecond epoch timestamp. On every tick the
remaining span (`target - Date.now()`) is split into whole days/hours/minutes/
seconds with plain integer math (`Math.floor` and `%`). The DOM list is built
once on `render()`; the per-second `tick()` only rewrites the number cells, which
keeps it cheap even with many events.

## Run it

Open `index.html` in any browser — no build step or dependencies.
