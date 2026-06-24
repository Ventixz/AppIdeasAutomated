# Notes App

Create, edit, and keep notes that survive a browser refresh. A two-pane layout
lists your notes on the left and opens the selected one in an editor on the
right. Everything is saved to `localStorage`, so your notes are still there the
next time you open the page.

Source idea: [app-ideas / Notes App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Notes-App.md)

## Features

- **Create, edit, delete** — make a new note, type freely, or remove one (with a
  confirm guard so you don't lose it by accident).
- **Persistent** — notes are stored in the browser's `localStorage` and reload
  automatically between sessions.
- **Autosave** — edits are written ~300ms after you stop typing; the status line
  flips between “Saving…” and “Saved”.
- **Search** — filter the list by title or body as you type.
- **Markdown preview** *(bonus)* — toggle **Preview** to render the note. A small
  built-in parser handles headings, **bold**, *italic*, `inline code`, links, and
  bullet lists — no external library.
- **Creation date** *(bonus)* — each note shows when it was created, both in the
  list and above the editor.

## How it works

Notes are plain objects — `{ id, title, body, created, updated }` — held in an
array and serialized to `localStorage` under one key. The list is re-rendered
from that array on every change, sorted by most recently updated and filtered by
the search box. The Markdown preview escapes HTML first, then applies a handful
of line- and inline-level rules, so rendering untrusted-looking input stays safe.

## Run it

Open `index.html` in any browser — no build step or dependencies. Create a note,
refresh the page, and it'll still be there.
