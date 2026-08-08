# This or That Game

Two images, one question: *which do you like better?* Click one and a brand-new
pair slides in. Every vote is remembered, and the images climb (or don't) a live
**Top 10 leaderboard**. Pure vanilla HTML/CSS/JS — no build step, no server, no
network.

Source idea: [app-ideas / This or That](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/This-or-That-Game.md)

## Running

Open `index.html` in any modern browser — no dependencies, no network:

```bash
open projects/2-intermediate/this-or-that-game/index.html
```

## How to use

- Click either card to vote for it. The picked card flashes gold, then the pair
  fades out and a fresh matchup fades in.
- Under each card you'll see that image's share of *all* votes cast so far.
- The **Top 10 voted** board updates instantly after every pick.
- **Reset votes** clears the leaderboard and starts the tally over.

Votes are saved in your browser's `localStorage`, so the leaderboard survives a
refresh — that's this offline app's stand-in for the spec's "store voting data in
a database".

### Where do the images come from?

With no network allowed, each item renders to a **deterministic SVG** built from
its id: a stable two-colour gradient (hue derived from a hash of the id) with a
big emoji on top. Because the same id always paints the same picture, a
leaderboard thumbnail always matches the card you voted on.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| View two images simultaneously | the two `.choice` cards in [`index.html`](./index.html), painted by `paintPair()` |
| Choose the preferred image | click handlers → `vote()` in [`script.js`](./script.js) |
| A new pair appears after selecting | `pickPair()` in [`thisorthat-core.js`](./thisorthat-core.js), re-rolled to avoid immediate repeats |
| **Bonus:** smooth transitions | the `.arena.swapping` fade in [`style.css`](./style.css), timed in `vote()` |
| **Bonus:** store voting data in a database | the vote tally persisted to `localStorage` |
| **Bonus:** top-10 leaderboard | `leaderboard()` in the core + `renderBoard()` |
| **Constraint:** vanilla HTML/CSS/JS | no libraries anywhere |

## The core is pure and tested

All the game logic — pairing, the immutable vote tally, the leaderboard ranking —
lives in a DOM-free `thisorthat-core.js` with randomness **injected** (every
function that needs it takes an `rng`). That makes it fully deterministic, so it
ships a dependency-free, Jest-compatible test suite:

```bash
node projects/2-intermediate/this-or-that-game/tests.js   # -> All 15 tests passed.
```

The tests cover distinct-pair guarantees, no-immediate-repeat behaviour, tally
immutability, and the leaderboard's ranking / tie-breaking / top-N slicing.
