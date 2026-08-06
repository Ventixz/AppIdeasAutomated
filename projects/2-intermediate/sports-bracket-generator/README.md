# Sports Bracket Generator

Name a tournament, set its date range, say how many teams are competing — and
the app draws a full single-elimination bracket for you. Click a team to send
them to the next round; the winner flows forward automatically until you crown
a champion. No manual box-drawing, no server, no build step.

Source idea: [app-ideas / Sports Bracket Generator](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Sports-Bracket-Generator.md)

## Running

Open `index.html` in any modern browser — no dependencies, no network:

```bash
open projects/2-intermediate/sports-bracket-generator/index.html
```

## How to use

1. Type a **tournament name** and an optional **start / end date**. An invalid
   range (bad date, or end before start) shows a warning and blocks generation.
2. Set the **number of teams**. An **odd count** shows a bye warning but is still
   allowed — the bracket rounds up to the next power of two and hands out
   first-round byes.
3. Optionally fill in **team names**, seeded `#1…#N`. Blank ones fall back to
   `Team 1`, `Team 2`, …
4. Hit **Generate bracket**. Click either team in a match to advance them; the
   winner is highlighted and carried into the next round. Change your mind and
   click the other team — the stale downstream result is cleared for you.
5. Optionally record a **date** and **scores** per match. Everything (including
   results in progress) is saved to `localStorage`, so a reload picks up exactly
   where you left off. **Clear saved** wipes it.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Tournament name entry | `#tname` field in [`index.html`](./index.html) |
| Tournament date range (start & end) | `#start` / `#end` fields |
| Number of competing teams entry | `#teams` field |
| Invalid date warning | `validateDateRange` in [`bracket-core.js`](./bracket-core.js) → `#date-warning` |
| Odd team count warning | `teamCountWarning` in `bracket-core.js` → `#team-warning` |

### Bonus features (all included)

| Bonus | Where it lives |
| --- | --- |
| Competing team names per match | seeded name inputs → `buildBracket({ teamNames })` |
| Individual match date entry | per-match `<input type="date">` in `renderMatch` |
| Final score entry per match | per-slot score input in `renderSlot` |
| Data persistence across sessions | `persist` / `restore` via `localStorage` in [`script.js`](./script.js) |

## Design notes

The tournament logic and the DOM are kept apart. [`bracket-core.js`](./bracket-core.js)
is a pure module with no DOM and no `Math.random()`:

- **Seeding** uses the standard recursive bracket order (`1 v 8, 4 v 5, 2 v 7,
  3 v 6`, …), so the top seed and bottom seed start at opposite ends.
- **Non-power-of-two** counts round up to the next power of two; the extra slots
  become **byes**, placed next to the strongest seeds, and any team facing a bye
  is auto-advanced so round two shows a real matchup instead of a phantom TBD.
- **`setWinner` is immutable** — it returns a *new* bracket every time. Flipping
  an earlier result recursively clears the winner's stale trail deeper in the
  tree, so the bracket can never show a team that no longer belongs there.

[`script.js`](./script.js) is only wiring: it reads the form, calls the core,
renders the returned bracket, and mirrors state into `localStorage`.

## Tests

`tests.js` covers date validation (including rolled-over dates like Feb 31),
odd-count warnings, seed order, bracket shape, byes and auto-advancement,
immutability of `setWinner`, downstream clearing when a result changes, champion
detection, and round naming. It runs two ways with **no dependencies**:

```bash
# standalone (built-in mini test runner)
node projects/2-intermediate/sports-bracket-generator/tests.js

# or under Jest, unchanged, if you have it installed
npx jest projects/2-intermediate/sports-bracket-generator/tests.js
```

```
All 19 tests passed.
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Shell: setup form + bracket panel, script load order |
| `style.css` | Dark bracket styling, horizontally scrollable rounds |
| `bracket-core.js` | Pure, testable seeding / bracket / advancement logic (browser + Node) |
| `script.js` | Form reading, bracket rendering, click-to-advance, persistence |
| `tests.js` | Dependency-free, Jest-compatible test suite |
