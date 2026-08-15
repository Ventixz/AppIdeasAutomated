# Boole Bots Game

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Boole Bots spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Boole-Bot-Game.md).

Boole Bots is a game that doubles as a hands-on lesson in Boolean logic. You
configure up to four bots — each with a Boolean **value** (`0` or `1`) and an
**operation** (`AND`, `OR`, `XOR`, `NOT`) — and set them loose to bounce around
an arena. When two bots collide, each applies **its own** operation to
`(self, opponent)`:

- resolve to **0** → you lose and disappear,
- resolve to **1** → you survive,
- **matching results** → a tie; both bots resume.

Play continues until a single bot remains.

## Architecture — logic vs. presentation

As with the other advanced projects here, all game logic lives in a
**presentation-free engine** (`boole-core.js`). It knows nothing about canvases
or clicks — only bots, collisions, and Boolean verdicts. Randomness is
*injected* (`options.rng`), so a seeded generator replays any battle
deterministically. The browser UI and the test suite drive the exact same
engine.

```js
const { createArena, runBattle, resolveCollision } = require('./boole-core.js');

// Who wins a collision?
resolveCollision(
  { value: 1, operation: 'OR' },   // OR(1, 0) = 1  -> survives
  { value: 0, operation: 'AND' },  // AND(0, 1) = 0 -> disappears
); // -> { resultA: 1, resultB: 0, outcome: 'a' }

// Run a whole battle headlessly:
const result = runBattle([
  { name: 'Ada',   value: 1, operation: 'OR'  },
  { name: 'Boole', value: 0, operation: 'AND' },
], { size: 8 });
result.outcome; // { type: 'win', winner: 'Ada' }  (or { type: 'draw', survivors: [...] })
```

### Boolean combat, exactly

| self | other | AND | OR | XOR | NOT (unary) |
| :--: | :---: | :-: | :-: | :-: | :---------: |
| 0 | 0 | 0 | 0 | 0 | 1 |
| 0 | 1 | 0 | 1 | 1 | 1 |
| 1 | 0 | 0 | 1 | 1 | 0 |
| 1 | 1 | 1 | 1 | 0 | 0 |

**Stalemates are handled.** Two bots that always resolve to the same value — say
a `NOT 0` bot and an `OR 1` bot, both eternally `1` — can never eliminate each
other. The engine detects when every surviving pair ties and ends the battle in
a **draw** instead of looping forever.

## The browser game (`index.html`)

Open `index.html` and you get the full game window from the spec:

- **Configuration panel** — four bot cards with unique name, value, operation,
  a speed slider, a starting-direction dropdown, and an icon picker. Duplicate
  names raise an inline error. Bots are dropped onto random arena tiles.
- **Arena** — a canvas where bots roam, bounce off the walls *in new
  directions*, collide, and vanish when they lose. Each bot shows its icon and
  its live `OP·value` badge.
- **Controls** — one **Battle!** button that flips to **Stop!** during play and
  reverts when a champion (or a draw) emerges.
- **Leaderboard** — every bot's wins/losses, ranked, with the current
  highest-win bot highlighted.
- **Battle log** — a running feed of collisions, KOs, ties, and the finish.
- **Game clock** — elapsed time, ticking once per second.

### Bonus features (all implemented)

- ✅ **Log panel** of game milestones
- ✅ **Game clock** updating every second
- ✅ **8 directions** (diagonals) via the arena toggle
- ✅ **Customizable arena dimensions** (8×8 up to 16×16)
- ✅ **Bot icon selection** with a small palette
- ✅ **Leaderboard highlighting** for the highest-win bot

## Tests

A dependency-free, Jest-style suite covers the full Boolean truth tables, all 64
collision combinations, unit-vector directions, wall containment, deterministic
duels, 200 seeded four-bot battles (asserting each ends consistently), stalemate
detection, leaderboard ranking, and custom arena sizes:

```bash
node tests.js   # -> All 128 tests passed.
```

*Built automatically by a Claude Code routine. Idea:
[florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).*
