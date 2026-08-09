# Timezone Slackbot

A tiny mock of a Slack `/tz` command. Type `/tz alice grace hiroshi` and the bot
replies with a tidy, **alternating-row** table of everyone's local time, timezone
abbreviation, and UTC offset — the fast way to answer *"is now a sane time to ping them?"*
Pure vanilla HTML/CSS/JS — no build step, no server, no network, no Slack account.

Source idea: [app-ideas / Timezone Slackbot](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Timezone-Slackbot.md)

## Running

Open `index.html` in any modern browser:

```bash
open projects/2-intermediate/timezone-slackbot/index.html
```

## How to use

- Type a command in the composer, e.g. `/tz alice bob grace`, and press **Send**.
- Or click one of the quick-command chips (`/tz everyone`, etc.).
- Names are case-insensitive and a leading `@` is fine: `/tz @Grace ALICE` works.
- Unknown names are reported back instead of silently dropped.

The roster is a fixed, representative team spanning **UTC-08:00 to UTC+13:00**
(the spec's world runs UTC-12 to UTC+14). Each member's local time is computed
from the moment you send the command.

## How it maps to the spec

| Spec item | Where it lives |
| --- | --- |
| `/tz <name> <name>…` generates a timezone table | `parseCommand()` + `handleMessage()` in [`tz-core.js`](./tz-core.js) |
| Table with **alternating row colours** for readability | `stripe` flag per row in `buildTable()`, styled by `.tz-table tr.stripe` in [`style.css`](./style.css) |
| **Bonus:** timezone abbreviation next to each name (e.g. "IST") | the `abbr` column, rendered in the accent colour |
| **Constraint:** stay within UTC-12 … UTC+14 | the hard-coded `DIRECTORY` roster |
| **Note:** a friendlier format than the ASCII example | rendered as a real Slack-style message with a proper table |

## The core is pure and tested

All the logic — command parsing, case-insensitive lookup, offset formatting, and
the day-crossing local-time math — lives in a DOM-free [`tz-core.js`](./tz-core.js).
The "current moment" is **injected** as a UTC millisecond argument rather than read
from the clock, so every function is fully deterministic. That ships a
dependency-free test suite:

```bash
node projects/2-intermediate/timezone-slackbot/tests.js   # -> 39 passed, 0 failed
```

The tests cover offset formatting (including the half-hour IST case), local-time
arithmetic across midnight in both directions (`(+1d)` / `(-1d)` markers),
case/`@`/whitespace-tolerant lookup, command parsing, and the alternating-stripe
assignment that skips unknown members.

### A note on daylight saving

For offline determinism the roster uses **fixed** UTC offsets and does not follow
DST. A real Slackbot would read each teammate's zone from their Slack profile and
resolve the current offset live; that's the one piece this self-contained mock
deliberately simplifies.
