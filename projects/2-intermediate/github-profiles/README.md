# GitHub Profiles

Search any GitHub username and see a live profile card — avatar, name, follower
counts, and the user's **top 4 repositories** ranked by stars + forks — pulled
straight from the GitHub REST API. Vanilla JS, no build, no dependencies, no API
key required.

Source idea: [app-ideas / GitHub-Profiles](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/GitHub-Profiles.md)

## Running

Open `index.html` in any browser — nothing to install:

```bash
open projects/2-intermediate/github-profiles/index.html
```

The app calls the public GitHub API from your browser, so you just need a
network connection.

## How to use

1. Type a GitHub username (try `torvalds`, `gaearon`, or `chaharshivam` from the
   spec) into the search box.
2. Press **Search** (or Enter).
3. The card fills in with the user's avatar, name, bio, follower/following/repo
   counts, and their four most-starred repositories.
4. Tap the 🌙/☀️ button in the top-right to switch between dark and light —
   your choice is remembered next time you open the app.
5. Search a name that doesn't exist and you'll get an alert, per the spec.

## How it maps to the spec

| Spec item | Where it lives |
| --- | --- |
| Input a username + click search | `search-form` submit → `search()` |
| Fetch user data from the GitHub API | `fetchJson()` against `https://api.github.com/users/{name}` |
| Show avatar, username, followers, repo count | `renderUser()` |
| Top 4 repositories by forks and stars | `topRepos()` (sorts by stars + forks, slices 4) → `renderRepos()` |
| Alert on an invalid username | `catch` on a `404` → `alert(...)` |
| **Bonus:** dark/light mode toggle | `themeToggle` click handler + `applyTheme()` |
| **Bonus:** persist theme across sessions | `localStorage` under `github-profiles-theme`, restored by `initTheme()` |

## How it works

- **Two API calls per search:** one for the user object
  (`/users/{name}`) and one for their repos
  (`/users/{name}/repos?per_page=100`). The repo list is ranked locally by a
  combined `stars + forks` score and the top four are shown, matching the
  spec's "ranked by forks and stars".
- **Error handling** is status-code aware: a `404` triggers the required
  alert, a `403` explains the (unauthenticated) rate limit, and anything else
  shows a friendly retry message — all surfaced in the live status line.
- **Theme** defaults to your OS `prefers-color-scheme`, but an explicit choice
  is saved to `localStorage` and always wins on the next visit.
- **`escapeHtml()`** guards every API-supplied string (names, descriptions,
  URLs) before it reaches `innerHTML`, so a crafted repo description can't
  inject markup.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Search form, profile card, theme toggle |
| `style.css`  | Responsive card layout with light/dark CSS variables |
| `script.js`  | API calls, ranking, rendering, theme persistence |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 48 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
