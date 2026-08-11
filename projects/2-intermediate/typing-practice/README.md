# Typing Practice

A timed typing drill. A word appears, you type it before the countdown empties,
and every correct word makes the next timer a little shorter — so the game
gently ratchets up the pressure as you get better. Wrong entries shake and clear
the box; the scoreboard tracks **correct / tries**, your current **streak**, and
your lifetime totals across sessions. Pure vanilla HTML/CSS/JS — no build step,
no server, no network.

Source idea: [app-ideas / Typing Practice](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Typing-Practice-App.md)

## Running

Open `index.html` in any modern browser:

```bash
open projects/2-intermediate/typing-practice/index.html
```

## How to use

- Click **Start Practice** — the first word appears and the timer bar starts
  draining.
- Type the word and press **Enter**. A correct entry congratulates you, advances
  to a new word, and shortens the per-word time. A wrong entry (or a timeout)
  flashes the input red, clears it, and counts as a miss — the word stays so you
  can try again.
- The **streak** counter climbs with each consecutive hit and resets on any miss.
- Toggle **sound** for distinct blips on a new word, a correct entry, and a
  mistake.
- Click **Stop Practice** to end the session; its numbers fold into the
  **Lifetime** line, which persists in `localStorage` across visits.

## How it maps to the spec

| Spec item | Where it lives |
| --- | --- |
| Start / Stop buttons drive the session | `#startBtn` / `#stopBtn` → `beginSession()` / `endSession()` in [`script.js`](./script.js) |
| Time interval display for word completion | the timer stat + draining `.timer-bar` → `armTimer()` / `tick()` |
| Score box: successful vs. total attempts | `#score` → `state.successes` / `state.attempts` in [`typing-core.js`](./typing-core.js) |
| Prompt word in a text box + input field | `#prompt` and `#entry` in [`index.html`](./index.html) |
| Incorrect: letters flash, input clears, counter increments | `flashBad()` + `submit()` returning `lastResult: 'incorrect'` |
| Correct: new word, interval shrinks, success counter increments | `submit()` → `decreaseInterval()`, then a re-`armTimer()` |
| Retry / congratulations messages | `state.message` set inside `submit()`, rendered by `render()` |
| **Bonus:** unique audio tones for new/correct/incorrect | the Web Audio `sound.*` blips in [`script.js`](./script.js) |
| **Bonus:** persistent cumulative statistics | `mergeStats()` + `localStorage` → the **Lifetime** line |

## The core is pure and tested

Every rule — matching (case- and whitespace-insensitive), the interval decay and
its floor, scoring, streak growth and reset, word-list wrap-around, timeouts, and
the cumulative stats merge — lives in a DOM-free
[`typing-core.js`](./typing-core.js). State is an immutable value and each
function returns a **new** state rather than mutating in place. The clock, the
DOM, Web Audio, and `localStorage` all stay in [`script.js`](./script.js), so the
core is fully deterministic and ships a dependency-free test suite:

```bash
node projects/2-intermediate/typing-practice/tests.js   # -> 51 passed, 0 failed.
```

The tests cover the forgiving matcher, interval decay clamped to its floor, a
fresh session's shape, correct/incorrect/timeout transitions, streak building and
resetting, the word list wrapping around, accuracy as successes-over-attempts,
and `normalizeStats()` recovering gracefully from `null`, a string, and
partially-corrupted stored data.

### A note on the "gets faster" mechanic

The interval multiplies by `0.92` on each correct word and never drops below
`800 ms`, so a long streak converges on a steady fast pace rather than becoming
impossible. Word advancement is a plain sequential walk over the list (the UI
shuffles a fresh copy per session for variety), which keeps the core
deterministic — the same inputs always produce the same states.
