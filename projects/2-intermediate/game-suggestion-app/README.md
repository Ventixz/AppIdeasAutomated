# Game Suggestion App

A client-side polling app for game night: create a poll, suggest games from a
searchable catalog, vote, and watch the group's favourites rise to a **Top 5**
or **Top 10** ranking. All vanilla JS, no build, no dependencies — polls persist
in `localStorage`.

Source idea: [app-ideas / Game-Suggestion-App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Game-Suggestion-App.md)

## Running

Open `index.html` in any browser — nothing to install:

```bash
open projects/2-intermediate/game-suggestion-app/index.html
```

## How to use

1. **Create a poll** — give it a title. Optionally restrict it to a single
   genre (a bonus feature) and choose whether results show a Top 5 or Top 10.
2. **Suggest a game** — start typing in the poll's search box. Matching titles
   drop down instantly; click one (or use ↑/↓ and Enter) to add it. Suggesting
   a game casts your first vote for it.
3. **Vote** — press **▲ Vote** on any game in the results to bump it up.
4. **Watch the ranking** — the results list re-sorts live and shows the top
   N most-voted games, with a 🏆 on the leader.
5. Come back later — every poll and vote is saved in your browser.

## A note on IGDB

The spec suggests pulling titles from the **IGDB** database via an AJAX search.
IGDB requires OAuth credentials (a Twitch client ID/secret) and a live network,
neither of which fits a self-contained, no-build, no-key project. So this build
ships a **curated local catalog** (`games.js`, 60 popular titles across 17
genres) and searches it in memory. The search is isolated in a single
`searchGames()` function — swapping in the real IGDB API later is a one-function
change and nothing else in the app has to move.

## How it maps to the spec

| Spec item | Where it lives |
| --- | --- |
| Users can create new polls | `create-form` → `createForm` submit handler |
| Users vote by suggesting games | `searchGames()` + `suggestGame()` (suggesting = first vote) |
| Additional votes on existing games | `voteFor()` and the **▲ Vote** button |
| Results ranked as a Top 5 / Top 10 list | `renderResults()` sorts by votes, slices `poll.topN` |
| "AJAX search" for game lookup | `searchGames()` — local substring search over the catalog |
| **Bonus:** filter voting by genre | `poll.genre` restriction in `searchGames()` + genre `<select>` |
| **Bonus:** revisit previously created polls | `localStorage` persistence, poll list on the home view |

## How it works

- **State** is an array of poll objects, each holding its games and their vote
  counts. Every mutation (`create`, `suggest`, `vote`, `delete`) edits the array
  and calls `savePolls()`, which serialises it to `localStorage` under one key.
- **Two views**, home (create + list) and poll (suggest + results), are plain
  `<section>`s toggled with the `hidden` attribute — no router, no framework.
- **Search** filters the catalog by substring, skips titles already suggested,
  and honours the poll's genre restriction. Results support full keyboard
  navigation (↑/↓/Enter/Esc).
- **Ranking** sorts a copy of the games by votes descending and slices to the
  poll's `topN`, so the source order is never mutated.
- **`escapeHtml()`** guards every user-supplied string (poll titles) before it
  reaches `innerHTML`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Home and poll views, footer |
| `style.css`  | Dark, responsive layout with a live results board |
| `games.js`   | Built-in game catalog (stand-in for IGDB) |
| `script.js`  | Poll state, search, voting, ranking, persistence |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 47 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
