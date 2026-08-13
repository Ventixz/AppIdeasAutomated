# Battleship Bot

The first **Tier 3 (Advanced)** project, built by the automated Claude routine
from the [app-ideas Battleship Bot spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Battleship-Bot.md).

The spec asks for a **Discord bot** presentation layer over a Battleship game
engine: you talk to it in chat with `bb …` commands and it plays back a board.
Since this environment has no network — and therefore no live Discord gateway —
this app ships a faithful **Discord-style chat simulator** that speaks the exact
same command grammar the spec describes. The moment you point a real
`discord.js` client at `handleCommand`, the identical logic runs unchanged.

## What it does

Open `index.html` and chat with the bot:

| Command | Effect |
| --- | --- |
| `bb help` | Show the rules (user story #1). |
| `bb start` | Deal a fresh hidden fleet and begin (user story #2). |
| `bb shoot r,c` | Fire at row `r`, column `c` — both 0–9 (user story #3). |
| `bb surrender` | Give up and reveal where the ships were (bonus #1). |

After every shot the bot posts the board showing hits and misses (user
story #4), and sinking the final ship triggers a **congratulations** message
with your shot count (user story #5). The board is drawn as a **graphical card**
— coloured cells, not a plain character grid — which is the spec's bonus #2.

The hidden fleet is the standard one: Carrier (5), Battleship (4), Cruiser (3),
Submarine (3), Destroyer (2) — 17 cells in all.

## How it's built

The code is split so the game rules are testable without a browser or Discord:

- **`battleship-core.js`** — a pure, DOM-free module with two layers:
  - a *game engine* (fleet placement, shooting, hit/miss/sunk/win detection)
    whose randomness is **injected** as an `rng` argument, so a seeded generator
    replays any game deterministically;
  - a *bot layer* — `handleCommand(session, text, rng)` is a pure reducer that
    turns one line of chat into a new session plus the messages the bot posts.
- **`index.html` / `style.css` / `script.js`** — the Discord-flavoured chat
  shell. It owns the DOM, the message log, and the graphical board card, and
  routes every command through the core.

## Tests

The engine and the bot layer ship a dependency-free, Jest-style test suite —
including a seeded RNG that plays whole games to completion and asserts the win
fires on exactly the 17th ship-cell:

```bash
node tests.js   # -> All 2397 tests passed.
```

*Built automatically by a Claude Code routine. Idea:
[florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).*
