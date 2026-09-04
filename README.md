# AppIdeasAutomated

> 🤖 **An automated [Claude Code](https://claude.com/claude-code) routine.**
> Every day, Claude builds one project — on its own, start to finish.

This repository is not maintained by hand. It is grown one app at a time by a
scheduled Claude Code routine that runs **once a day**. On each run, Claude:

1. Opens [`PROGRESS.md`](./PROGRESS.md) and finds the topmost unchecked project.
2. Reads that project's specification from the current source list.
3. Builds the app (code, styling, a short README, and a quick sanity check).
4. Checks the box in `PROGRESS.md` with the date, then commits and pushes.

The first source, worked from beginning to end, was
[florinpop17/app-ideas](https://github.com/florinpop17/app-ideas). With all
three of its tiers finished, the routine has moved on to a **second source** and
keeps going (see [_What's next_](#whats-next) below).

## The rules of the routine

- **Start at the easiest level.** Within a source, the routine works through the
  entire beginner list before touching anything harder.
- **One level at a time.** It only moves up once *every* project in the level
  below is finished.
- **One project per day.** No skipping ahead, no batching.
- **When a source runs out, find another.** Once every project in a source list
  is built, the routine picks a new "list of projects to build" repo and carries
  on from the top.

## Progress

See [`PROGRESS.md`](./PROGRESS.md) for the live checklist. Quick snapshot:

**Source 1 — [app-ideas](https://github.com/florinpop17/app-ideas) — ✅ COMPLETE (88 / 88)**

| Tier | Level | Status |
| --- | --- | --- |
| 1 | Beginner | ✅ Complete — **35 / 35** |
| 2 | Intermediate | ✅ Complete — **33 / 33** |
| 3 | Advanced | ✅ Complete — **20 / 20** |

**Source 2 — [karan/Projects](https://github.com/karan/Projects) — 🚧 In progress (3 built)**

| Category | Status |
| --- | --- |
| Numbers | 🚧 In progress — **3 / 21** |

> 🎉 **app-ideas is finished — every one of its 88 projects is built** (35
> Beginner + 33 Intermediate + 20 Advanced). The final one, **Survey App**, went
> in on 2026-09-01, completing Tier 3.
>
> <a name="whats-next"></a>**What's next — and now underway.** Having run out of
> app-ideas, the routine picked a new source:
> [karan/Projects](https://github.com/karan/Projects), the "Mega Project List" —
> a big curated set of practical projects grouped by category. It is now working
> down that list one project per day, beginning with the **Numbers** category.
> The first entry, **Find PI to the Nth Digit**, went in on 2026-09-02, its
> companion **Find e to the Nth Digit** followed on 2026-09-03, and the
> **Fibonacci Sequence** — three generators over exact `BigInt`, with fast
> doubling for distant terms — landed on 2026-09-04. Same rules, new list.

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
| 64 | [This or That Game](./projects/2-intermediate/this-or-that-game/) | Intermediate | 2026-08-08 |
| 65 | [Timezone Slackbot](./projects/2-intermediate/timezone-slackbot/) | Intermediate | 2026-08-09 |
| 66 | [To-Do App](./projects/2-intermediate/todo-app/) | Intermediate | 2026-08-10 |
| 67 | [Typing Practice](./projects/2-intermediate/typing-practice/) | Intermediate | 2026-08-11 |
| 68 | [Voting App](./projects/2-intermediate/voting-app/) | Intermediate | 2026-08-12 |
| 69 | [Battleship Bot](./projects/3-advanced/battleship-bot/) | Advanced | 2026-08-13 |
| 70 | [Battleship Game Engine](./projects/3-advanced/battleship-game-engine/) | Advanced | 2026-08-14 |
| 71 | [Boole Bots Game](./projects/3-advanced/boole-bots-game/) | Advanced | 2026-08-15 |
| 72 | [Calendar](./projects/3-advanced/calendar/) | Advanced | 2026-08-16 |
| 73 | [Calorie Counter](./projects/3-advanced/calorie-counter/) | Advanced | 2026-08-17 |
| 74 | [Chat App](./projects/3-advanced/chat-app/) | Advanced | 2026-08-18 |
| 75 | [Contribution Tracker](./projects/3-advanced/contribution-tracker/) | Advanced | 2026-08-19 |
| 76 | [Elevator](./projects/3-advanced/elevator/) | Advanced | 2026-08-20 |
| 77 | [Fast Food Simulator](./projects/3-advanced/fast-food-simulator/) | Advanced | 2026-08-21 |
| 78 | [Instagram Clone](./projects/3-advanced/instagram-clone/) | Advanced | 2026-08-22 |
| 79 | [GitHub Timeline](./projects/3-advanced/github-timeline/) | Advanced | 2026-08-23 |
| 80 | [Kudos Slackbot](./projects/3-advanced/kudos-slackbot/) | Advanced | 2026-08-24 |
| 81 | [Movie App](./projects/3-advanced/movie-app/) | Advanced | 2026-08-25 |
| 82 | [MyPodcast Library](./projects/3-advanced/mypodcast-library/) | Advanced | 2026-08-26 |
| 83 | [NASA Exoplanet Query](./projects/3-advanced/nasa-exoplanet-query/) | Advanced | 2026-08-27 |
| 84 | [Shell Game](./projects/3-advanced/shell-game/) | Advanced | 2026-08-28 |
| 85 | [Shuffle Deck](./projects/3-advanced/shuffle-deck/) | Advanced | 2026-08-29 |
| 86 | [Slack Archiver](./projects/3-advanced/slack-archiver/) | Advanced | 2026-08-30 |
| 87 | [Spell-It](./projects/3-advanced/spell-it/) | Advanced | 2026-08-31 |
| 88 | [Survey App](./projects/3-advanced/survey-app/) | Advanced | 2026-09-01 |
| 89 | [Find PI to the Nth Digit](./projects/phase2-numbers/find-pi-nth-digit/) | Numbers · Source 2 | 2026-09-02 |
| 90 | [Find e to the Nth Digit](./projects/phase2-numbers/find-e-nth-digit/) | Numbers · Source 2 | 2026-09-03 |
| 91 | [Fibonacci Sequence](./projects/phase2-numbers/fibonacci-sequence/) | Numbers · Source 2 | 2026-09-04 |

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
  3-advanced/         # Tier 3 apps
    battleship-bot/
    battleship-game-engine/   # a headless engine + CLI *and* browser front ends
    boole-bots-game/          # Boolean-logic combat: a pure engine + a canvas game
    calendar/                 # month-view scheduler: pure date/event engine + drag-to-reschedule UI
    calorie-counter/          # food-calorie search: pure search/wildcard engine + JSON dataset
    chat-app/                 # multi-user chat over BroadcastChannel: pure parser engine + live tabs
    contribution-tracker/     # charitable-giving ledger + SVG dashboard, integer-cents money engine
    elevator/                 # four-floor building sim: pure FIFO+dwell state machine + animated shaft UI
  phase2-numbers/     # Source 2 (karan/Projects) — Numbers category
    find-pi-nth-digit/        # arbitrary-precision π via Machin's formula, in BigInt
    find-e-nth-digit/         # arbitrary-precision e via the Taylor series Σ 1/k!, in BigInt
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

The **This or That Game** shows two images and records which one you prefer, then
slides in a fresh pair — with a live **Top 10 leaderboard** of the most-voted
images (a spec bonus). With no network allowed, each image is a deterministic SVG
built from a hash of its id, and votes persist to `localStorage` as the offline
stand-in for the spec's "store voting data in a database". All the pairing, vote
tally, and leaderboard logic is pure and DOM-free in `thisorthat-core.js` (rng
injected), with its own dependency-free test suite:

```bash
node projects/2-intermediate/this-or-that-game/tests.js   # -> All 15 tests passed.
```

The **Timezone Slackbot** mocks a Slack `/tz name name …` command: it replies
with an alternating-row table of each teammate's local time, timezone
abbreviation (the spec bonus), and UTC offset. The whole logic layer —
command parsing, case/`@`-tolerant lookup, and the day-crossing local-time math
that emits `(+1d)`/`(-1d)` markers — lives in a DOM-free `tz-core.js` with the
"current moment" injected as an argument, so it stays fully deterministic and
ships its own dependency-free test suite:

```bash
node projects/2-intermediate/timezone-slackbot/tests.js   # -> 39 passed, 0 failed.
```

The **To-Do App** is the classic list: add items, check them off, edit them
inline (double-click or ✎), delete them, and filter between **All / Active /
Done** with live counts — plus a "time ago" stamp on each item. It's fully
offline, persisting to `localStorage` so the list survives closing the tab (the
spec's core requirement). Every rule — add/toggle/edit/delete, the three filter
views, the timestamp label, and validating data read back from storage — lives
in a pure, immutable, DOM-free `todo-core.js` with the clock and ids injected,
so it ships its own dependency-free test suite:

```bash
node projects/2-intermediate/todo-app/tests.js   # -> 42 passed, 0 failed.
```

The **Voting App** — the Tier 2 finale — is a live poll: each option carries a
**Vote** button, and clicking one instantly re-tallies counts, percentage bars, a
running total, and a highlighted leader (or a called tie). You can add options
and reset votes, and the whole poll persists to `localStorage` (the spec's
"persist items and votes" bonus, client-side). All the rules — slug-based
de-duplication, voting, totals, percentages, stable most-voted-first ranking with
insertion-order tie-breaks, leader/tie detection, and recovering a poll from
corrupted storage — live in a pure, immutable, DOM-free `voting-core.js` with its
own dependency-free test suite:

```bash
node projects/2-intermediate/voting-app/tests.js   # -> 44 passed, 0 failed.
```

The **Battleship Bot** opens Tier 3 (Advanced). Its spec calls for a **Discord
bot** you play Battleship against in chat; with no network here, the app is a
faithful **Discord-style chat simulator** speaking the same `bb help` / `bb
start` / `bb shoot r,c` / `bb surrender` grammar. After every shot the bot posts
the board as a coloured **graphical card** (the spec's bonus) and congratulates
you when the 17th and last ship-cell falls. The whole game engine *and* the bot's
command layer are pure and DOM-free in `battleship-core.js` — fleet placement
takes an injected rng, and `handleCommand` is a pure reducer over
`(session, text)` — so it ships a deterministic test suite that plays seeded
games to completion:

```bash
node projects/3-advanced/battleship-bot/tests.js   # -> All 2397 tests passed.
```

The **Boole Bots Game** is a playable lesson in Boolean logic. You configure up
to four bots — each with a value (`0`/`1`) and an operation (`AND`, `OR`, `XOR`,
`NOT`) — and set them loose in a canvas arena. When two bots collide, each
applies its own operation to `(self, opponent)`; resolve to `0` and you vanish,
`1` and you fight on, matching results tie. It has the full spec game window
(config panel with duplicate-name errors, leaderboard with highest-win
highlighting, battle log, per-second clock) and every listed bonus (diagonals,
custom arena sizes, icon palette). All the combat and physics live in a pure,
DOM-free `boole-core.js` (rng injected) — which also detects the deadlock where
two always-`1` bots would tie forever and ends it as a draw — so it ships a
deterministic test suite that runs the full truth tables, all 64 collision
combinations, and 200 seeded battles:

```bash
node projects/3-advanced/boole-bots-game/tests.js   # -> All 128 tests passed.
```

The **Calendar** is a month-view scheduler. Click a day to add an event, click
an event to edit it, **drag an event chip onto another day** to reschedule it
(the spec's drag bonus), and give any event a **reminder** that pops a toast when
it comes due. There's a light/dark theme toggle (remembered) and everything
persists to `localStorage`, so the calendar survives a reload. All the date maths
(leap years, month wrapping, the 7-column grid), immutable event
create/edit/delete/move, and the reminder-due logic live in a pure, DOM-free
`calendar-core.js` — timezone-independent because timestamps are computed over
wall-clock components with `Date.UTC` and "now" is injected — so it ships a
deterministic test suite whose storage tests even recover a corrupted store
event-by-event instead of wiping it:

```bash
node projects/3-advanced/calendar/tests.js   # -> All 94 tests passed.
```

The **Calorie Counter** searches a database of 135 common foods for their
portion size and calories. Type a food, hit **Search**, and browse ranked
matches in a scrollable panel capped at 25 rows with a **Load more** button for
the rest (the spec's paging bonus), a live match count, and **wildcards** —
`app*` matches *apple* but not *pineapple*, `*nut` matches *peanut*, `b?n`
matches *ban*. **Clear** resets everything, and empty or no-match searches raise
a warning. The canonical data is a plain `foods.json`; `foods-data.js` is a
build-time mirror of it so the page also runs from `file://`. All the search,
wildcard-to-regex, ranking, and paging logic is pure and DOM-free in
`calorie-core.js`, which also validates the dataset, so it ships a
dependency-free test suite:

```bash
node projects/3-advanced/calorie-counter/tests.js   # -> 42 passed, 0 failed.
```

The **Chat App** is a multi-user chat interface. Pick a username, send a
message, and it lands in the chat box as **`Username: Message`** — the spec's
MVP. Its headline bonus is *real-time visibility across all connected users*,
which normally means a WebSocket server; with nothing to run one against, the app
makes **every open browser tab a connected user** and delivers each message
instantly over `BroadcastChannel`, so you can open two tabs and watch two people
talk. `localStorage` is the persistent database (a corrupt store recovers to
empty), a heartbeat drives a live **"N tabs connected"** presence readout, and
joining posts a **join notification** to everyone else. It also does the rest of
the bonus list — **channels** (Slack-style rooms), **private messages**
(`/msg user text`, with `"quoted names"`), inline **links and images**, and an
**emoji** picker with `:shortcode:` expansion. All the rules — username and
channel validation, the slash-command parser, and the token parser that splits a
message into safe text / link / image / mention nodes (so user text is never
rendered as HTML) — live in a pure, DOM-free `chat-core.js`, so it ships a
dependency-free test suite:

```bash
node projects/3-advanced/chat-app/tests.js   # -> 74 passed, 0 failed.
```

The **Contribution Tracker** records charitable giving and rolls it up into a
dashboard. A nav-bar **hamburger menu** switches between a **Transactions**
ledger, a **Dashboard**, and an **About** page (with a footer on every one). On
the Transactions page an input panel (date, payee, amount, memo) with **Clear**
and **Add** validates into a single **consolidated error box**; every ledger row
has **Modify** (which loads the row back and relabels Add → Modify) and
**Delete** (which pops a **Cancel / Okay** confirmation). The bonus list is all
there too — a **date picker**, **alternating row colors**, **sortable columns**,
and **CSV / JSON / Print-to-PDF** export. The Dashboard draws hand-rolled **SVG**
charts: contributions by month, total by year colored by direction, and cards
for year-over-year change and averages. The spec has two hard rules and the
build follows both: **money maths are done by hand in integer cents** (so
`0.1 + 0.2` drift is impossible — there's a test pinning it), and because
*"transactions must not be maintained in local storage"* the ledger lives in an
**IndexedDB** database with file export, never `localStorage`. All the money
parsing, validation, immutable ledger ops and analytics live in a pure, DOM-free
`contrib-core.js`, so it ships a dependency-free test suite:

```bash
node projects/3-advanced/contribution-tracker/tests.js   # -> 82 passed, 0 failed.
```

The **Instagram Clone** ("Instagage") is a full-stack MVP collapsed into one
serverless page. You **register or log in** (accounts store a *salted password
digest*, never plaintext; you can log in by username or email), **upload photos**
with captions by picking or dragging a file, get a **profile grid** of your
uploads with post/follower/following counts, **follow other users**, and see a
**Home feed** of the accounts you follow (newest first) plus a bonus global
**Explore** feed, a **People** directory, and **likes**. The spec asks for a
MERN/MEAN server that stores images in a database; with no build step allowed,
the routine keeps that *shape* — `createApp(store)` stands in for the Express API,
an injectable **store** (`localStorage`) stands in for MongoDB, and images are
held as **data URLs**. All of it — validation, salted hashing, the follow graph,
and the derived feeds — lives in a DOM-free `instagram-core.js` with a
dependency-free suite:

```bash
node projects/3-advanced/instagram-clone/tests.js   # -> 56 passed, 0 failed.
```

The **GitHub Timeline** turns any GitHub username into a shareable, year-by-year
**timeline of that user's public repositories**, each annotated with its name,
creation date, and description on a real vertical timeline (spine + nodes) — the
kind of thing you could send a prospective employer. You **type a username** and
hit **Generate**; the page calls the public GitHub REST API with `fetch`, keeps
**only public repos** (per the spec), sorts them by creation date, and groups
them by year. Bad input and API errors surface as a **warning** — validation runs
*before* the network (GitHub's own username rules), a `404` becomes *"No GitHub
user by that name."*, and a `403` becomes a rate-limit notice. The bonus feature
is there too: a **per-year bar chart** tallying how many repos were created each
year, plus optional **Include forks** and **Newest/Oldest** controls. Every value
from GitHub is written with `textContent`, never `innerHTML`. All the rules —
validation, `normalizeRepo`, ordering, the year tally, and the HTTP-status-to-
warning mapping — live in a DOM-free `timeline-core.js` with a dependency-free
suite:

```bash
node projects/3-advanced/github-timeline/tests.js   # -> 61 passed, 0 failed.
```

The **Kudos Slackbot** lets a team recognize each other's effort with a
`/kudo` slash command — and, unlike a nice message in a busy channel, the
recognition doesn't scroll away. It's a **self-contained mock of a Slack
channel**, so you can drive the whole command surface right on the page: `add`
a kudo for a teammate, `list` the latest (or `*` for all), filter to one person
with `user @grace`, `replace`/`delete` your own (those two are **author-scoped**
— only the giver can change a kudo, which you can see by switching who you're
*"posting as"* in the sidebar), and rank everyone with the bonus `top`
leaderboard. All the behaviour — user-id normalization (including Slack's
`<@U…|label>` mention encoding), command parsing, the author-only rules, and the
leaderboard sort — lives in a DOM-free `kudos-core.js` with an **injected clock
and id counter**, so a real Slack app would just be a thin adapter over the same
tested engine. Dependency-free suite:

```bash
node projects/3-advanced/kudos-slackbot/tests.js   # -> 88 passed, 0 failed.
```

The **Movie App** is a poster-wall movie browser: the homepage shows the latest
releases newest-first, you **scroll to load more** (an `IntersectionObserver`
sentinel pages in the next batch and de-dupes by id), and any poster opens a
**detail page** with the rating, vote count, runtime, genres, synopsis, and cast.
The bonus **watchlist** and per-movie **reviews** persist in the browser
(localStorage) — no login needed. It runs with **zero setup** on a bundled
sample catalog and switches to **live [TheMovieDB](https://www.themoviedb.org/)**
the moment you paste an API key (kept in your browser only). As always, the rules
— API URL building, record normalization (including the `id: 0` edge case),
newest-first sorting, page de-duplication, rating/runtime formatting, and the
immutable watchlist logic — live in a DOM-free `movie-core.js`. Dependency-free
suite:

```bash
node projects/3-advanced/movie-app/tests.js   # -> 90 passed, 0 failed.
```

The **MyPodcast Library** keeps a personal collection of Podbean podcasts. The
**"+ Add a new podcast"** panel **validates** that a URL is a real Podbean
podcast page (the `podcast-detail/…` path or a `*.podbean.com` show subdomain)
and surfaces a **404** for a dead link before saving. Each saved show lists its
**recent episodes** in a sortable table where you **heart** favourites (which
float to the top), give a **five-star rating** (click to fill left-to-right,
click the top star to deselect), and attach freeform **hashtags** you can
**search across the whole library**. Everything persists in the browser
(localStorage). The spec builds this by scraping Podbean with Puppeteer; since
this repo is all static serverless apps, the "fetch a podcast by URL" step is
emulated by a bundled sample set shaped exactly like a scrape's output — so
swapping in a real scraper never touches the engine. As always the rules — URL
validation, record normalization, favourite/rating/hashtag logic, ordering, and
cross-library search — live in a DOM-free `podcast-core.js`. Dependency-free
suite:

```bash
node projects/3-advanced/mypodcast-library/tests.js   # -> 109 passed, 0 failed.
```

The **NASA Exoplanet Query** app searches a snapshot of NASA's archive of
confirmed exoplanets. Pick one or many values across four dropdowns — **year of
discovery, discovery method, host name, discovery facility** — and it returns a
**sortable table** of matching planets, with each **host name linking out** to
NASA's Confirmed Planet Overview page (the spec's bonuses). Matching is **OR
within a box, AND across boxes**, and searching with nothing selected raises an
error instead of dumping the archive. The spec loads the live ~4,000-row CSV;
with no network here the data is a bundled snapshot of real exoplanets written as
the same archive CSV text, so the engine's RFC-4180-ish CSV reader runs on
genuine formatting. All the rules — CSV parsing, option lists, the query
semantics, stable sorting, and the overview-URL builder — live in a pure,
DOM-free `exoplanet-core.js`. Dependency-free suite:

```bash
node projects/3-advanced/nasa-exoplanet-query/tests.js   # -> 386 passed, 0 failed.
```

The **Slack Archiver** rescues a team's "institutional knowledge" before Slack's
free tier purges it past 10,000 messages. It extracts channel history the way
the spec's `channels.history` API does — **paginated, oldest-first, and
hard-capped at ~50 messages per call** — resuming from the last message it saw
so history is never re-pulled, and only **Team owners** may drive it (sign in as
a member and every control locks). With no Slack workspace or network here, a
**seeded mock workspace** stands in for the API and the browser's storage is the
database; the de-duplicating archive persists across reloads, exports to JSON or
text, and exposes the bonus **retrieval API** (`queryArchive` — filter by text,
author, and time), which the viewer's search box is itself a client of. As
always the rules — the rate-limited resumable `history()`, the cursor-tracking
archive, owner access control, the extraction tick, export, and the query —
live in a DOM-free `archiver-core.js`. Dependency-free suite:

```bash
node projects/3-advanced/slack-archiver/tests.js   # -> 54 passed, 0 failed.
```

**Spell-It** is a spelling trainer in the spirit of the TI *Speak & Spell*: it
**plays a word aloud** (Web Speech API), you **type what you hear**, and it tells
you whether you were right while a dashboard tracks correct count, attempts, and
success percentage. The word being practised is **only ever spoken, never
rendered** until you submit — a spelling test you can read isn't a test. Correct
answers get a rising chime and wrong ones a low buzz, **both synthesised with the
Web Audio API** (no sound files), and a **Hint** button paints each letter green
/ red / dashed / amber for right / wrong / missing / extra — without spending an
attempt. Enter submits from both the keyboard and the button. The engine is
DOM-, audio-, and timer-free: `spellDiff()` backs *both* correctness and the hint
highlighting off one comparison, so they can never disagree. Dependency-free
suite:

```bash
node projects/3-advanced/spell-it/tests.js   # -> 56 passed, 0 failed.
```

**Survey App** — the final app-ideas project — is a two-role feedback platform on
one shared site: **coordinators** sign in to author surveys (**1–10 questions,
1–5 mutually-exclusive options each**), open and close them, and read the
results; **respondents** answer whatever is open and review anything closed. The
role split is enforced in the *engine*, not just the UI — every admin call
(`createSurvey`, `openSurvey`, `closeSurvey`) throws without an authenticated
coordinator session. Submissions are one-selection-per-question and rejected if
incomplete; the bonus **duplicate-submission prevention** keys on a per-browser
respondent id, and results tabulate to per-option counts and percentages drawn
as bar charts. As always the rules — the 1–10 / 1–5 validation, the
`draft → open → closed` lifecycle, submission validation, the dup rule, and the
result maths — live in a DOM-free `survey-core.js`. Dependency-free suite:

```bash
node projects/3-advanced/survey-app/tests.js   # -> 52 passed, 0 failed.
```

With Survey App done, **every app-ideas project across all three tiers is built**,
and the routine has moved on to its second source — see
[_What's next_](#whats-next) at the top.

**Find PI to the Nth Digit** — the first project of Source 2
([karan/Projects](https://github.com/karan/Projects), Numbers) — computes π to
any requested precision. The catch the spec hints at is that `Math.PI` dies past
~15 digits (it's a 64-bit float), so this is really an **arbitrary-precision**
task: every step runs in exact `BigInt` integers using **Machin's formula**
(`π = 16·arctan(1/5) − 4·arctan(1/239)`), each `arctan` summed as a scaled-integer
Taylor series with guard digits so the last reported digit is **truncated, not
rounded**. The DOM-free `pi-core.js` exposes `piString(n)`, `piScaledInteger(n)`,
and a 1-indexed `nthDigit(n)`; the page expands π to N places or plucks a single
digit, capped at 20000 as the spec asks. 1000 digits compute in a couple of
milliseconds. Dependency-free suite:

```bash
node projects/phase2-numbers/find-pi-nth-digit/tests.js   # -> 43 passed, 0 failed.
```

**Find e to the Nth Digit** — the second Numbers project, and π's natural
companion. Same arbitrary-precision problem (`Math.E` dies past ~15 digits), same
approach: exact `BigInt` integers, guard digits, and a **truncated** last place.
Here the engine is the defining Taylor series **`e = Σ 1/k!`** (Euler, 1748),
summed in scaled integers by keeping a running term and dividing it by `k` each
step. Because factorials outgrow any exponential, it converges far faster than the
`arctan` series — **20 000 digits land in under 40 ms**, only a few thousand terms.
The DOM-free `e-core.js` exposes `eString(n)`, `eScaledInteger(n)`, and a 1-indexed
`nthDigit(n)`; the page expands _e_ to N places or plucks a single digit, capped at
20000. Dependency-free suite, checked against 100- and 250-digit references:

```bash
node projects/phase2-numbers/find-e-nth-digit/tests.js   # -> 45 passed, 0 failed.
```

**Fibonacci Sequence** — the third Numbers project. Fibonacci numbers grow ~1.6×
per term and cross `Number.MAX_SAFE_INTEGER` at **F(79)**, so this is another
arbitrary-precision task done entirely in exact `BigInt`. The DOM-free
`fib-core.js` covers both of the spec's asks and then some: `fibSequence(n)` (the
first N terms, built iteratively), `fibUpTo(max)` (every term ≤ a `BigInt` bound),
and `fibAt(n)` — a single distant term via **fast doubling**, climbing the binary
expansion of `n` with `F(2k)=F(k)·(2F(k+1)−F(k))`, `F(2k+1)=F(k+1)²+F(k)²` so it
needs ~`log₂(n)` multiplies instead of `n` additions. The page offers all three
modes; the suite cross-checks fast doubling against the iterative generator over
the first 500 terms and against known F(100)/F(200) references:

```bash
node projects/phase2-numbers/fibonacci-sequence/tests.js   # -> 46 passed, 0 failed.
```

---

*Credit for the project ideas: [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas)
(Source 1, complete) and [karan/Projects](https://github.com/karan/Projects)
(Source 2, in progress). Everything in this repo is generated automatically by
Claude Code.*
