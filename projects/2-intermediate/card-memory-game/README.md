# Card Memory Game

An interactive memory matching game. Flip cards two at a time to find every
matching pair before the timer runs out.

Source idea: [app-ideas / Card Memory Game](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Card-Memory-Game.md)

## Running it

Open `index.html` in any modern browser — no build step, no dependencies.

## How to play

1. Pick a **difficulty** and press **Start game**. A timer begins immediately.
2. Click a face-down card to reveal its symbol.
3. Click a second card:
   - **Match** → both cards stay up and are removed from play.
   - **No match** → both flip back after a short pause.
4. Clear every pair before the clock hits the limit to win. A
   **Congratulations** dialog shows your finishing time and move count.
5. Run out of time and the board reveals itself so you can see what you missed.

## Difficulty

| Level | Grid | Pairs | Time limit |
| --- | --- | --- | --- |
| Easy | 4×4 | 8 | 1:30 |
| Medium | 6×6 | 18 | 2:00 |
| Hard | 8×8 | 32 | 3:00 |

## Bonus features

Both bonus features from the spec are implemented:

- **Difficulty selection** — Easy / Medium / Hard change both the card count
  and the time limit.
- **Statistics** — wins, losses, and best time are tracked **per difficulty**
  and persisted in `localStorage`, shown in the records table. "Reset records"
  clears them.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup: controls, board, records table, win/lose dialog |
| `style.css` | Layout, the 3D card-flip animation, and the modal |
| `script.js` | Game state, turn logic, timer, and record persistence |

## Notes on the implementation

- The board is a CSS grid whose column count is driven by a `--cols` custom
  property, so one layout serves all three difficulties.
- Cards flip with a `rotateY` transform on an inner wrapper (`backface-visibility`
  hides the reverse side) — no image assets required, just emoji faces.
- A single 32-symbol pool feeds every board; the hardest (32 pairs) uses all of
  them, easier boards slice off the front.

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 39 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
