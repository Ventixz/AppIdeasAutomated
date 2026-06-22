# Key Value

Press any key and watch the browser reveal how it encodes the keystroke: the
`key` value (the character or named key) and the `code` (the physical key on the
layout). Four indicators track the modifier keys — alt, control, meta, and
shift — flipping from **False** to **True** while they're held.

Source idea: [app-ideas / Key Value App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Key-Value-App.md)

## Features

- **Live key readout** — `key` value and `code` update the instant a key is
  pressed, using the [KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent)
  Web API.
- **Modifier indicators** — alt / control / meta / shift each show True while
  held and reset to False on release.
- **Spacebar handled** — a bare space is labelled `Space` so it's not invisible.

### Bonus features

- **Audio feedback** — a short tone plays on each keypress (toggleable), built
  with the Web Audio API so there are no sound files to ship.
- **Visual color change** — the `key` and `code` panels flash the accent color
  on every press, re-triggering cleanly even on rapid typing.

## How it works

A single `keydown` listener reads `event.key`, `event.code`, and the four
boolean modifier flags (`event.altKey`, `event.ctrlKey`, `event.metaKey`,
`event.shiftKey`). `event.preventDefault()` stops the page from scrolling or the
browser from acting on shortcuts so every key is captured. The matching
`keyup` listener clears the flash and resets any modifier that is no longer
held. The tone is generated on demand by an `OscillatorNode`; the
`AudioContext` is created lazily on the first press, which doubles as the user
gesture browsers require before audio can play.

## Run it

Open `index.html` in any browser — no build step or dependencies. Click the
panel first if keystrokes aren't being picked up.
