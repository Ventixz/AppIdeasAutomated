# Flip Art

Build a flip-book animation by loading a sequence of image frames, arranging
them, and playing them back at an adjustable speed — all in vanilla JS, no
libraries. Ships with a built-in bouncing-ball sample so it animates the
moment you open it.

Source idea: [app-ideas / Flip-Art-App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Flip-Art-App.md)

## Running

Open `index.html` in any browser — no build, no dependencies:

```bash
open projects/2-intermediate/flip-art-app/index.html
```

## How to use

1. Press **Load Sample Frames** for an instant demo, or click a **+** under any
   slot to load your own image.
2. Once an image loads, its **+** turns into a **−** to remove or replace it.
3. Drag any filled thumbnail onto another to **reorder** the sequence.
4. Set **Transition Speed** (ms per frame) and, optionally, a **Transition
   Type** for a cross-fade between frames.
5. Press **Start Animation** to play; the button flips to **Stop Animation**.
   The frame currently on stage is highlighted in the Configuration Panel.
6. **Clear Configuration** empties every slot; **+ Slot** adds more than eight.

## How it maps to the spec

| Spec item | Where it lives |
| --- | --- |
| Configuration / Operation / Display panels | three `<section>`s in `index.html` |
| Eight thumbnail slots | `slots` array seeded with 8 nulls in `script.js` |
| '+' button to add, file dialog for images | `onSlotButton()` → shared `#file-input` |
| Button toggles to '−' after load | `render()` picks the button class/glyph |
| '−' removes / replaces | `onSlotButton()` clears the slot |
| Transition Speed slider | `#speed` → `startAnimation()` interval |
| 'Clear Configuration' | `clearBtn` handler |
| 'Start Animation' disabled until images added | `updateControls()` sets `playBtn.disabled` |
| Label toggles Start/Stop, click starts/stops | `togglePlay()` |
| Display panel transitions at slider rate | `setInterval(tick, speed)` in `startAnimation()` |
| **Bonus:** highlight the displayed thumbnail | `highlightPlaying()` toggles `.thumb--active` |
| **Bonus:** unlimited thumbnails | **+ Slot** button → `slots.push(null)` |
| **Bonus:** transition-type dropdown | `#transition` → cross-fade in `showFrame()` |
| **Bonus:** drag-and-drop reordering | `dragstart`/`drop` handlers in `render()` |

## How it works

- **State** is a single `slots` array — each entry is `null` (empty) or a
  data-URL string. Adding, removing, reordering, and clearing are all just
  edits to that array followed by a `render()`.
- **Loading images** reuses one hidden `<input type="file">`. `fillTarget`
  records which slot the dialog is filling; a `FileReader` turns the chosen
  file into a data URL so nothing touches the network or disk.
- **Playback** walks the filled frames with `setInterval`; changing the speed
  slider mid-play tears down and rebuilds the interval so the new rate takes
  effect immediately.
- **`frames.js`** generates the 8-frame sample as inline SVG data URIs, so the
  demo is self-contained with no binary assets in the repo.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Configuration, operation, and display panels |
| `style.css`  | Dark, responsive two-panel layout |
| `frames.js`  | Built-in bouncing-ball sample frames (SVG data URIs) |
| `script.js`  | Slot management, file loading, reordering, playback |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 46 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
