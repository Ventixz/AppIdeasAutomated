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
| 1 | Beginner | 🚧 In progress — **2 / 35** |
| 2 | Intermediate | 🔒 Locked |
| 3 | Advanced | 🔒 Locked |

## Projects built so far

| # | Project | Tier | Date |
| --- | --- | --- | --- |
| 1 | [Bin2Dec](./projects/1-beginner/bin2dec/) | Beginner | 2026-06-06 |
| 2 | [Border Radius Previewer](./projects/1-beginner/border-radius-previewer/) | Beginner | 2026-06-06 |

## Repository layout

```
projects/
  1-beginner/
    bin2dec/          # one folder per app
      index.html
      style.css
      script.js
      README.md
PROGRESS.md           # the routine's source of truth
README.md             # this file
```

## Running an app

These are dependency-free static apps. Open any project's `index.html` in a browser:

```bash
open projects/1-beginner/bin2dec/index.html
```

---

*Credit for the project ideas: [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
Everything in this repo is generated automatically by Claude Code.*
