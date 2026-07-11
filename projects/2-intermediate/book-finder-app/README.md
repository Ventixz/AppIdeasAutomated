# Book Finder

Search millions of books by **title**, **author**, or **subject** and browse
the results as a responsive card grid — cover art, author, and first-published
year included, each linking out to more information.

Source idea: [app-ideas / Book Finder App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Book-Finder-App.md)

## How it works

The app talks to the free, **no-API-key**, CORS-friendly
[Open Library Search API](https://openlibrary.org/dev/docs/api/search):

```
https://openlibrary.org/search.json?title=the+hobbit&limit=24
```

- The dropdown scopes the query to a field (`title`, `author`, `subject`) or a
  generic `q` for "All".
- Each result (`doc`) is turned into a card. Covers come from the
  [Covers API](https://covers.openlibrary.org) using the book's `cover_i` id;
  books without a cover get an emoji placeholder.
- Results are capped at 24 per search, with a status line reporting how many of
  the total matches are shown.

## Features

- **Field-scoped search** — All / Title / Author / Subject.
- **Card grid** with cover, title, author, and first-published year.
- **Keyboard-friendly** — submit with Enter, visible focus rings, ARIA live
  regions for status and results.

### Bonus features (from the spec)

- **External links** — every card title and its "More info →" link open the
  book's Open Library page in a new tab.
- **Responsive design** — the grid reflows from multi-column down to a single
  column on narrow screens; the search bar stacks on phones.
- **Loading animations** — a bouncing-dot loader while fetching, plus a
  fade-in on each card as results render. Covers use native lazy-loading.

## Running

A dependency-free static app — open it in any browser (it needs network access
for the Open Library API):

```bash
open index.html
```
