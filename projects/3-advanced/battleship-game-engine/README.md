# Battleship Game Engine

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Battleship Game Engine spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Battleship-Game-Engine.md).

Where the earlier [Battleship Bot](../battleship-bot/) was about a chat *front
end*, this project is about the opposite half: a **presentation-free game
engine**. The engine manages all game state through function calls — an API,
not a UI — and knows nothing about how a board is drawn or how a player is
prompted. Two entirely different presentation layers drive the *same* engine.

## The engine (`battleship-engine.js`)

A pure, DOM-free module. Randomness is **injected** (`options.rng`), so a seeded
generator replays any game deterministically.

```js
const { startGame } = require('./battleship-engine.js');

const game = startGame();          // 8×8 board, 3 hidden ships
const result = game.shoot(3, 4);   // fire at row 3, col 4
// result -> { hit, alreadyShot, sunk, won, shipsRemaining, board, placement }

game.board();   // the hits/misses grid: " " untargeted, "O" miss, "X" hit
game.stats();   // { turns, hits, misses, shotsFired, shipsRemaining, shipsSunk, accuracy }
```

The default fleet is the spec's three ships — Battleship (4), Cruiser (3),
Destroyer (2) — placed at random without overlaps on an 8×8 grid.

### Bonus features (all implemented)

- **Customizable board dimensions** — `startGame({ size: 12 })`.
- **`gameStats()`** — `game.stats()` returns turns, hits, misses, ships sunk,
  ships remaining, and accuracy.
- **Two-player mode** — `startGame({ players: 2 })` gives each player their own
  hidden fleet; `game.shoot(r, c, playerNumber)` fires at the *opponent's*
  board, and `game.winner()` reports who cleared it first.

## Presentation layer #1 — the terminal (`cli.js`)

The text-based presentation the spec describes: it draws the 2D board, prompts
for coordinates, prints hit/miss feedback, congratulates the winner, and offers
a replay.

```bash
node cli.js            # 1-player
node cli.js --2p       # two-player, alternating turns in one terminal (bonus)
node cli.js --size 10  # custom board dimension (bonus)
```

At any prompt, type `stats` to see the metrics (bonus) or `quit` to leave.

## Presentation layer #2 — the browser (`index.html`)

Open `index.html` for a naval-radar version of the exact same engine: click a
cell to fire, watch hits, misses and sunk ships light up, track live stats in
the HUD, switch board sizes, or **Reveal fleet** to peek. Not a line of game
logic lives here — every shot goes through `startGame`/`shoot`.

## Tests

A dependency-free, Jest-style suite covers placement, shooting, whole-game
sweeps across 100 seeds (asserting the win fires on exactly the final ship
cell), stats accounting, and two-player mode:

```bash
node tests.js   # -> All 3940 tests passed.
```

*Built automatically by a Claude Code routine. Idea:
[florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).*
