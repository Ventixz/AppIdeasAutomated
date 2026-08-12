# Voting App

A tiny live poll. A list of options each carry a **Vote** button; click one and
the tally updates instantly — vote counts, per-option percentage bars, a running
total, and a highlighted leader (or a called tie). You can add your own options,
reset the tally, and everything persists in `localStorage` so the poll survives a
refresh. Pure vanilla HTML/CSS/JS — no build step, no server, no network.

Source idea: [app-ideas / Voting App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Voting-App.md)

## Running

Open `index.html` in any modern browser:

```bash
open projects/2-intermediate/voting-app/index.html
```

## How to use

- Click **Vote** next to any option — its count goes up, the percentage bars
  re-scale, and the **Results** line names the current leader.
- Options are always shown **most-voted first**; ties keep their original order
  so the ranking never jumps around unpredictably.
- Type into **Add an option…** and press **Add** to introduce a new candidate
  (blank or duplicate names are quietly ignored).
- **Reset votes** zeroes every tally while keeping the options themselves.
- The whole poll is saved to `localStorage`, so your options and votes are still
  there when you come back.

## How it maps to the spec

| Spec item | Where it lives |
| --- | --- |
| Users can view a list of voteable items | `#options` rendered from `ranked()` in [`script.js`](./script.js) |
| Each item includes a clickable vote button | the `.vote-btn` per option → `castVote()` → `vote()` |
| After voting, users see the complete vote tally | live counts, `.fill` percentage bars, and the `#total` / `#leader` lines re-rendered on every vote |
| **Bonus:** persist items and votes | `save()` / `load()` via `localStorage`, recovered through `normalizePoll()` |

The other listed bonus — restricting voting to authenticated users — needs a
backend and accounts, which is out of scope for a dependency-free static app; the
persistence bonus is implemented instead, client-side.

## The core is pure and tested

Every rule — slug-based de-duplication of options, voting (including the no-op
for an unknown id), adding and resetting, the total, per-option percentages,
stable most-voted-first ranking with insertion-order tie-breaks, leader/tie
detection, and the recovery of a poll from corrupted storage — lives in a
DOM-free [`voting-core.js`](./voting-core.js). State is an immutable value and
each function returns a **new** state rather than mutating in place. The DOM,
clicks, and `localStorage` all stay in [`script.js`](./script.js), so the core is
fully deterministic and ships a dependency-free test suite:

```bash
node projects/2-intermediate/voting-app/tests.js   # -> 44 passed, 0 failed.
```

The tests cover slugification, poll construction with de-duplication and blank
dropping, voting and immutability, adding/rejecting options, resetting, totals,
percentages (including the zero-vote case), ranking with deterministic
tie-breaks, single- and multi-leader detection, and `normalizePoll()` recovering
gracefully from `null`, a string, a shapeless object, and a list riddled with
negative, fractional, blank, duplicate, and malformed entries.

### A note on ties and determinism

Ranking sorts by vote count descending, then by original insertion order — so a
three-way tie always lists the options in the order they were added, never in
whatever order the sort happens to produce. `leaders()` returns *every* option
sharing the top count, which is what lets the UI say "Tied: A & B" instead of
silently picking one. An all-zero poll reports no leader at all.
