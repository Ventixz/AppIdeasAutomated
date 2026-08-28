# Shell Game

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Shell Game spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Shell-Game.md).

The honest version of the street con. Hide a pea under one of three shells,
watch a **five-second shuffle**, then click the shell you think it's under.
Find it on your **first** guess and it counts as a win.

Open `index.html` in a browser. **No build step, no server, and no
dependencies** — the whole thing is a `<canvas>` and one script.

## User stories from the spec

- ✅ **Three shells and a pea** drawn on a canvas.
- ✅ **Click to choose** which shell hides the pea to start a round.
- ✅ The pea **drops under the chosen shell** as the shells settle.
- ✅ **Shuffle** runs a shell-swapping animation lasting **five seconds**.
- ✅ **Click shells after the shuffle** to hunt for the pea — input is locked
  while the shuffle is playing.
- ✅ Shells **rise to reveal** whether your guess was right or wrong.
- ✅ **Keep guessing** until you lift the shell with the pea.
- ✅ A **congratulations message** on success.
- ✅ **Start a new game** by choosing a fresh shell for the pea.

### Bonus features

- ✅ A **scoreboard** panel showing **wins**, **games played**, and a derived
  **win rate**.
- ✅ **Games** increments the moment the pea is hidden under a shell.
- ✅ **Wins** increments **only for a first-guess success** — get it on the
  second lift and the game still counts, but the win doesn't.
- ✅ The **lifted shell animates** up to reveal the felt (and the pea, when it's
  the right one).

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** (`shell-core.js`). It never touches the canvas, a
timer, or the DOM — you hand it a plain game-state object and it hands back a
new one.

- **`shell-core.js`** — the immutable game engine. `createGame` seeds the
  state and stats; `placePea` hides the pea and counts a game; `generateSwaps`
  produces a random, deterministic-when-seeded list of cup swaps (`rng` is
  injectable so tests are exact); `applySwap` / `applySwaps` follow the pea
  through a swap chain to its resting slot; `beginShuffle` flags the animation
  window; `guess` scores a lift — counting a **win only when the first guess of
  the round is right** — and lifts empty shells as it goes; `nextRound` and
  `winRate` round it out. Every mutator returns a fresh object; runs identically
  in the browser and in Node.
- **`index.html` + `style.css` + `script.js`** — the client. `script.js` owns
  only what a screen needs: drawing the felt, shells and pea on a `<canvas>`,
  tweening the lifts, animating the five-second shuffle over the *same* swap
  list the core resolves, hit-testing clicks to a slot, and updating the status
  line and scoreboard. It never decides a rule itself — every outcome comes back
  from `shell-core.js`.
- **`tests.js`** — drives that same core under Node with a tiny seeded RNG, so
  the test suite and the browser exercise identical behaviour.

## Running the tests

```bash
node tests.js
```

The suite (68 assertions) covers game creation and validation; placing the pea
and the games counter; single-swap arithmetic; the swap generator (range, no
self-swaps, normalisation, seeded determinism, and that every swap actually
moves a pea at either endpoint); resolving a full swap chain to the pea's final
slot; the shuffle phase flag; **first-guess wins vs. later finds** and the
repeat-lift guard; `nextRound`/`winRate` across a multi-round session; and a
statistical check that 3,000 random shuffles land the pea fairly on every shell.

---

*Built automatically by [Claude Code](https://claude.com/claude-code) as part of
the [AppIdeasAutomated](../../../README.md) daily routine.*
