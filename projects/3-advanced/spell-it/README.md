# Spell-It

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Spell-It spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/SpellIt-App.md).

> "Knowing how to spell is a fundamental part of being fluent in any language."

Spell-It is a spelling trainer in the spirit of the Texas Instruments *Speak &
Spell*: it **plays a word aloud**, you **type what you hear**, and it tells you
whether you got it right — while a dashboard tracks your correct count, total
attempts, and success percentage.

Open `index.html` in a browser. **No build step, no server, and no
dependencies** — an HTML page and two scripts. (Chrome, Edge, and Safari speak
the words out of the box via the Web Speech API; if a browser can't, the app
says so and falls back to the *Meaning* clue.)

## The whole point: you can't read the word

A spelling test you can read isn't a test. So the word being practised is
**only ever spoken, never rendered** until you submit an attempt. The engine
holds the target; the browser layer speaks it and reveals it only once you've
committed to a spelling.

## User stories from the spec

- ✅ **Play button triggers audio playback of the target word** — spoken with the
  Web Speech API (`speechSynthesis`). A *Slower* button re-says it at half speed.
- ✅ **Typed letters display in real-time** — each keystroke echoes into a row of
  letter tiles as you type.
- ✅ **Enter submits the attempt** — from *both* the keyboard **and** the Enter
  button (a bonus story), because the input lives in a `<form>`.
- ✅ **Confirmation message for correct spellings** — plus the word is revealed and
  the app auto-advances to the next one.
- ✅ **Error message prompts re-entry for incorrect spellings** — you stay on the
  same word and can listen again.
- ✅ **Statistics dashboard** — correct count, total attempts, and success
  percentage, updated live.

### Bonus features

- ✅ **Audio confirmation sound for correct answers** — a short rising chime.
- ✅ **Audio warning sound for incorrect answers** — a low buzz.
  Both are **synthesised with the Web Audio API**, so there are no sound files to
  ship.
- ✅ **Hint button highlights the misspelled letters** — green for right, red for
  wrong, dashed for missing, amber for extra — *without* spending an attempt.
- ✅ **Enter key + Enter button both submit.**

There's also a **Meaning** clue (a short definition of the current word) and a
**Skip** button, so a word you truly can't get never blocks the session.

## Architecture — engine vs. presentation

As with every other advanced project here, all the logic lives in a
**presentation-free engine** (`spell-core.js`). It never touches the DOM, a
timer, or the audio APIs:

- `spell-core.js` — the word bank (with definitions), `spellDiff()` (the
  letter-by-letter comparison that backs *both* correctness and the hint
  highlighting), and `createGame()` (a deterministic, reshuffling word order,
  attempt accounting, once-per-word scoring, the statistics, and reset).
- `script.js` — the browser layer: speaking the word (`speechSynthesis`), the
  synthesised bonus tones (Web Audio), the real-time input echo, the hint
  colouring, and Enter-to-submit from keyboard and button.
- `index.html` / `style.css` — the page and its styling.
- `tests.js` — the test suite.

Because correctness and hinting both read off the single `spellDiff()` result,
they can never disagree: a letter the hint paints green is, by construction, one
that would count toward a correct answer.

## Running the tests

```bash
node tests.js
```

56 assertions cover the case- and whitespace-insensitive correctness rule, the
letter-by-letter diff (correct / wrong / missing / extra letters, and the empty
attempt), the statistics dashboard, the rule that a word scores at most once no
matter how many times you re-spell it, the fact that a hint never consumes an
attempt, the deterministic-but-reshuffling word order (every word once per round
before any repeat), history recording, and reset.

## A note on faithfulness

A production version wouldn't change the engine at all: it would swap the
`speechSynthesis` call for a recorded-audio player (or a nicer TTS voice) and
maybe grow the word bank into a graded curriculum. The correctness rule, the
hint diff, the scoring, and the statistics — the parts the tests pin down —
would carry over unchanged.
