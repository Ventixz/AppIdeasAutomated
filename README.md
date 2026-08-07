# AppIdeasAutomated

> 🤖 **An automated [Claude Code](https://claude.com/claude-code) routine.**
> Every day, Claude builds one project from
> [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas) — all on its own.

This repository is not maintained by hand. It is grown one app at a time by a
scheduled Claude Code routine that runs **once a day**. On each run, Claude:

1. Opens [`PROGRESS.md`](./PROGRESS.md) and finds the topmost unchecked project.
2. Reads that project's specification from the app-ideas repo.
3. Builds the app (code, styling, a short README, and a quick sanity check).
4. Checks the box in `PROGRESS.md` with the date, then commits and pushes.

## The rules of the routine

- **Start at Beginner.** The routine works through the entire **Tier 1 (Beginner)**
  list before touching anything harder.
- **One level at a time.** It only moves up to Tier 2 (Intermediate), then Tier 3
  (Advanced), once *every* project in the level below is finished.
- **One project per day.** No skipping ahead, no batching.

## Progress

See [`PROGRESS.md`](./PROGRESS.md) for the live checklist. Quick snapshot:

| Tier | Level | Status |
| --- | --- | --- |
| 1 | Beginner | ✅ Complete — **35 / 35** |
| 2 | Intermediate | 🚧 In progress — **28 / 33** |
| 3 | Advanced | 🔒 Locked |

> 🎉 **Tier 1 (Beginner) is finished.** Every one of the 35 Beginner projects
> has been built. As of 2026-07-09 the routine has unlocked **Tier 2
> (Intermediate)** and now works down that list, one project per day.

## Projects built so far

| # | Project | Tier | Date |
| --- | --- | --- | --- |
| 1 | [Bin2Dec](./projects/1-beginner/bin2dec/) | Beginner | 2026-06-06 |
| 2 | [Border Radius Previewer](./projects/1-beginner/border-radius-previewer/) | Beginner | 2026-06-06 |
| 3 | [Calculator](./projects/1-beginner/calculator/) | Beginner | 2026-06-07 |
| 4 | [Christmas Lights](./projects/1-beginner/christmas-lights/) | Beginner | 2026-06-08 |
| 5 | [Cause &amp; Effect](./projects/1-beginner/cause-effect-app/) | Beginner | 2026-06-09 |
| 6 | [Color Cycle](./projects/1-beginner/color-cycle/) | Beginner | 2026-06-10 |
| 7 | [Countdown Timer](./projects/1-beginner/countdown-timer/) | Beginner | 2026-06-11 |
| 8 | [CSV2JSON App](./projects/1-beginner/csv2json-app/) | Beginner | 2026-06-12 |
| 9 | [Dollars to Cents](./projects/1-beginner/dollars-to-cents/) | Beginner | 2026-06-13 |
| 10 | [Dynamic CSS Variables](./projects/1-beginner/dynamic-css-variables/) | Beginner | 2026-06-14 |
| 11 | [First DB App](./projects/1-beginner/first-db-app/) | Beginner | 2026-06-15 |
| 12 | [Flip Image](./projects/1-beginner/flip-image/) | Beginner | 2026-06-16 |
| 13 | [GitHub Status](./projects/1-beginner/github-status/) | Beginner | 2026-06-17 |
| 14 | [Hello](./projects/1-beginner/hello/) | Beginner | 2026-06-18 |
| 15 | [IOT Mailbox Simulator](./projects/1-beginner/iot-mailbox-simulator/) | Beginner | 2026-06-19 |
| 16 | [JS Input Validation](./projects/1-beginner/js-input-validation/) | Beginner | 2026-06-20 |
| 17 | [JSON2CSV App](./projects/1-beginner/json2csv-app/) | Beginner | 2026-06-21 |
| 18 | [Key Value](./projects/1-beginner/key-value/) | Beginner | 2026-06-22 |
| 19 | [Lorem Ipsum Generator](./projects/1-beginner/lorem-ipsum-generator/) | Beginner | 2026-06-23 |
| 20 | [Notes App](./projects/1-beginner/notes-app/) | Beginner | 2026-06-24 |
| 21 | [Pearson Regression](./projects/1-beginner/pearson-regression/) | Beginner | 2026-06-25 |
| 22 | [Pomodoro Clock](./projects/1-beginner/pomodoro-clock/) | Beginner | 2026-06-26 |
| 23 | [Product Landing Page](./projects/1-beginner/product-landing-page/) | Beginner | 2026-06-27 |
| 24 | [Quiz App](./projects/1-beginner/quiz-app/) | Beginner | 2026-06-28 |
| 25 | [Recipe App](./projects/1-beginner/recipe-app/) | Beginner | 2026-06-29 |
| 26 | [Random Meal Generator](./projects/1-beginner/random-meal-generator/) | Beginner | 2026-06-30 |
| 27 | [Random Number Generator](./projects/1-beginner/random-number-generator/) | Beginner | 2026-07-01 |
| 28 | [Roman to Decimal Converter](./projects/1-beginner/roman-to-decimal-converter/) | Beginner | 2026-07-02 |
| 29 | [Slider Design](./projects/1-beginner/slider-design/) | Beginner | 2026-07-03 |
| 30 | [Stopwatch App](./projects/1-beginner/stopwatch-app/) | Beginner | 2026-07-04 |
| 31 | [TrueOrFalse](./projects/1-beginner/true-or-false/) | Beginner | 2026-07-05 |
| 32 | [Vigenère Cipher](./projects/1-beginner/vigenere-cipher/) | Beginner | 2026-07-06 |
| 33 | [Windchill](./projects/1-beginner/windchill/) | Beginner | 2026-07-07 |
| 34 | [Word Frequency](./projects/1-beginner/word-frequency/) | Beginner | 2026-07-08 |
| 35 | [Weather App](./projects/1-beginner/weather-app/) | Beginner | 2026-07-09 |
| 36 | [Bit Masks](./projects/2-intermediate/bit-masks/) | Intermediate | 2026-07-10 |
| 37 | [Book Finder](./projects/2-intermediate/book-finder-app/) | Intermediate | 2026-07-11 |
| 38 | [Calculator CLI](./projects/2-intermediate/calculator-cli/) | Intermediate | 2026-07-12 |
| 39 | [Card Memory Game](./projects/2-intermediate/card-memory-game/) | Intermediate | 2026-07-13 |
| 40 | [Charity Finder](./projects/2-intermediate/charity-finder-app/) | Intermediate | 2026-07-14 |
| 41 | [Chrome Theme Extension](./projects/2-intermediate/chrome-theme-extension/) | Intermediate | 2026-07-15 |
| 42 | [Currency Converter](./projects/2-intermediate/currency-converter/) | Intermediate | 2026-07-16 |
| 43 | [Drawing App](./projects/2-intermediate/drawing-app/) | Intermediate | 2026-07-17 |
| 44 | [Emoji Translator](./projects/2-intermediate/emoji-translator-app/) | Intermediate | 2026-07-18 |
| 45 | [Flashcards App](./projects/2-intermediate/flashcards-app/) | Intermediate | 2026-07-19 |
| 46 | [Flip Art](./projects/2-intermediate/flip-art-app/) | Intermediate | 2026-07-20 |
| 47 | [Game Suggestion](./projects/2-intermediate/game-suggestion-app/) | Intermediate | 2026-07-21 |
| 48 | [GitHub Profiles](./projects/2-intermediate/github-profiles/) | Intermediate | 2026-07-23 |
| 49 | [HighStriker Game](./projects/2-intermediate/highstriker-game/) | Intermediate | 2026-07-24 |
| 50 | [Image Scanner](./projects/2-intermediate/image-scanner/) | Intermediate | 2026-07-25 |
| 51 | [Markdown Previewer](./projects/2-intermediate/markdown-previewer/) | Intermediate | 2026-07-26 |
| 52 | [Markdown Table Generator](./projects/2-intermediate/markdown-table-generator/) | Intermediate | 2026-07-27 |
| 53 | [Math Editor](./projects/2-intermediate/math-editor/) | Intermediate | 2026-07-28 |
| 54 | [Meme Generator](./projects/2-intermediate/meme-generator-app/) | Intermediate | 2026-07-29 |
| 55 | [Name Generator (RNN)](./projects/2-intermediate/name-generator-rnn/) | Intermediate | 2026-07-30 |
| 56 | [Password Generator](./projects/2-intermediate/password-generator/) | Intermediate | 2026-07-31 |
| 57 | [Podcast Directory](./projects/2-intermediate/podcast-directory/) | Intermediate | 2026-08-01 |
| 58 | [QRCode Badge Generator](./projects/2-intermediate/qrcode-badge-generator/) | Intermediate | 2026-08-02 |
| 59 | [Regular Expression Helper](./projects/2-intermediate/regexp-helper/) | Intermediate | 2026-08-03 |
| 60 | [Sales Receipts App](./projects/2-intermediate/sales-receipts-app/) | Intermediate | 2026-08-04 |
| 61 | [Simple Online Store](./projects/2-intermediate/simple-online-store/) | Intermediate | 2026-08-05 |
| 62 | [Sports Bracket Generator](./projects/2-intermediate/sports-bracket-generator/) | Intermediate | 2026-08-06 |
| 63 | [String Art](./projects/2-intermediate/string-art/) | Intermediate | 2026-08-07 |

## Repository layout

```
projects/
  1-beginner/         # Tier 1 apps
    bin2dec/          # one folder per app
      index.html
      style.css
      script.js
      README.md
  2-intermediate/     # Tier 2 apps
    bit-masks/
PROGRESS.md           # the routine's source of truth
README.md             # this file
```

## Running an app

Most projects are dependency-free static apps. Open any project's `index.html`
in a browser:

```bash
open projects/1-beginner/bin2dec/index.html
```

A few Tier 2 ideas are inherently command-line tools. The **Calculator CLI**,
for example, ships a real dependency-free Node script *and* a browser terminal
that runs the same engine:

```bash
node projects/2-intermediate/calculator-cli/calc.js add 2 3 5   # -> 10
open projects/2-intermediate/calculator-cli/index.html          # same engine, in the browser
```

The **Chrome Theme Extension** ships a browser-based theme customizer (open its
`index.html`) *and* a real, loadable MV3 extension in its `extension/` folder —
load it via `chrome://extensions` → Developer mode → Load unpacked.

The **QRCode Badge Generator** vendors the `qrcode-generator` NPM package (the
one its spec calls for) alongside the app, so it produces genuinely scannable QR
badges with no build step and no network access.

The **Regular Expression Helper** keeps its matching logic in a pure,
DOM-free module (`regex-core.js`) and ships a dependency-free, Jest-compatible
test suite for it — run it standalone with `node`:

```bash
node projects/2-intermediate/regexp-helper/tests.js   # -> All 15 tests passed.
```

The **Sales Receipts App** is a frontend point-of-sale terminal that saves each
finished sale into the browser's own **IndexedDB** — no server, no accounts,
fully offline. Its cart and money logic is kept pure (integer cents, immutable
updates) in `receipt-core.js`, separate from the DOM and from storage, so it
ships its own dependency-free, Jest-compatible test suite:

```bash
node projects/2-intermediate/sales-receipts-app/tests.js   # -> All 16 tests passed.
```

The **Sports Bracket Generator** draws a full single-elimination bracket from a
team count, seeds it with the standard recursive order, hands out first-round
byes for odd/non-power-of-two counts, and lets you click a team to advance them.
All of the seeding and advancement logic is pure and DOM-free in
`bracket-core.js` (immutable `setWinner`, no `Math.random()`), with its own
dependency-free test suite:

```bash
node projects/2-intermediate/sports-bracket-generator/tests.js   # -> All 19 tests passed.
```

The **String Art** app animates a multicolored line that bounces around the
canvas and leaves a fading ripple behind it — pure Canvas 2D, no animation
library (a spec constraint). All the geometry (wall reflection, speed-preserving
angle jitter, the trail fade curve) lives in a pure, DOM-free `stringart-core.js`
whose randomness is injected, so it ships a deterministic, dependency-free test
suite that drives 5000 steps and asserts the line never leaves the bounds:

```bash
node projects/2-intermediate/string-art/tests.js   # -> All 14 tests passed.
```

---

*Credit for the project ideas: [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
Everything in this repo is generated automatically by Claude Code.*
