# Christmas Lights

A display of festive bulbs that randomly fade their brightness in and out to
mimic a string of twinkling Christmas lights.

Source idea: [app-ideas / Christmas Lights](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Christmas-Lights-App.md)

## Features

- **Start / Stop** button toggles the twinkling animation.
- **Speed** slider controls the interval (60–1200 ms) between intensity changes;
  the same value drives the CSS fade so the transition always matches the timing.

### Bonus features

- **Color** picker fills every bulb with the chosen color (plus a matching glow).
- **Min intensity** sets the floor brightness, so bulbs fade between that value
  and full brightness instead of going fully dark.
- **Bulb size** resizes every circle in the row.
- **Rows** chooses how many rows of lights to show — from 1 to 7.

## How it works

Each tick, every bulb is assigned a random opacity between the chosen minimum
and `1`. CSS transitions the `opacity` change over the current interval, which
produces the smooth fade. Changing the interval while running restarts the timer
so the new speed takes effect immediately.

## Run it

Open `index.html` in any browser — no build step or dependencies.
