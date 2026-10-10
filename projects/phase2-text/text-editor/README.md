# Text Editor

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**seventh entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/), [Pig Latin](../pig-latin/),
[Count Vowels](../count-vowels/), [Check if Palindrome](../check-if-palindrome/)
and [Count Words in a String](../count-words/).

> "Text Editor — a Notepad which can open, write, and save documents."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts. Everything,
including the autosaved draft, stays in your browser.

## What it does

Open a `.txt` file from your computer, type, undo and redo, and save it back
out — plus a live word/character/line/byte count and an autosaved working copy
in `localStorage` so a reload never loses your draft.

Opening a file and saving a `Blob` is the easy twenty lines, and it's all a
"Notepad" strictly needs. But a `<textarea>` you can save isn't an *editor* —
it's a text box. Two problems sit underneath the typing, and getting them right
is the whole project:

### 1. An `input` event doesn't tell you *what* changed

The browser hands you the textarea's **new value** and nothing else: not where
the edit happened, not whether it was a keystroke, a paste, a delete, or a
select-all-and-retype. The naive editor shrugs and keeps the whole new string.
A real editor has to **diff** the old and new values to recover the minimal
changed range — because everything below depends on knowing it:

```js
diffEdit("the cat", "the dog")  // -> { from: 4, to: 7, insert: "dog", removed: "cat" }
```

It's a common-prefix / common-suffix peel, done in **code points** so an emoji
or a combining mark is never sliced down the middle (`"😀".length` is `2` in
JavaScript — splitting an edit between those halves yields a lone surrogate and
mojibake). The result is *minimal*: it names exactly the span that moved and
nothing more.

### 2. Undo is not "one step per keystroke"

Type `hello` in any real editor, press <kbd>Ctrl</kbd>+<kbd>Z</kbd> once, and
the whole word vanishes — not one letter. Editors **coalesce** a contiguous run
of typing (or of backspacing) into a single undo step, and **break** the run
when you cross a newline, pause, jump the caret, or switch from typing to
deleting. The naive editor pushes one undo entry per `input` event, so
<kbd>Ctrl</kbd>+<kbd>Z</kbd> claws your text back a character at a time — the
single most common home-grown-editor complaint there is.

This editor coalesces. The **history strip** on the page draws one block per
undo step so you can *watch* a typed run stay a single block and a newline start
a new one, and the **"coalesced vs naive"** card shows, live, how many undo
steps you've actually banked against the per-keystroke count a naive editor
would keep. Typing one line of prose is routinely 1–3 real undo steps versus
dozens of naive ones — the gap is shown, not asserted.

## How it's built

The engine in `editor-core.js` is a tiny, honest edit model, DOM-free so it runs
in Node and the browser:

- **`diffEdit(old, new)` → `{from, to, insert, removed}`** — the minimal
  single-range edit, code-point safe.
- **`applyEdit(doc, edit)` → `{doc, inverse}`** — replaces a code-point range
  and returns the **inverse edit**, so the exact same machinery runs undo:
  apply the inverse to the result and you're back to the original, bit for bit.
- **`History`** — an undo/redo stack whose steps are net edits computed with
  `diffEdit`. Its `commit(newDoc, caret, meta)` is the whole coalescing
  decision: extend the open group (rewriting the top step in place) only when
  the change is the same coalescible kind, arrived within `coalesceMs`, and the
  group hasn't been sealed by a newline; otherwise push a fresh step. Undo and
  redo clear the redo tail and never merge across an undo boundary.

The glue in `script.js` wires a `<textarea>` to it: on every `input` it
classifies the change, converts the caret from a UTF-16 index to a code-point
offset, commits, mirrors a copy to `localStorage`, and repaints. Open uses
`FileReader`; Save builds a `Blob` and clicks a temporary `<a download>`;
<kbd>Ctrl</kbd>+<kbd>S</kbd>, <kbd>Ctrl</kbd>+<kbd>Z</kbd>,
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> and
<kbd>Ctrl</kbd>+<kbd>O</kbd> all work. Every storage access is wrapped in
try/catch, so a private window or blocked storage degrades quietly.

## How it's verified

The two hard parts are verified as **round-trip laws over a fuzz**, not as
hand-picked happy paths:

- **The diff is faithful** — `applyEdit(old, diffEdit(old, new)).doc === new`
  over **20,000** random edits.
- **The inverse inverts** — `applyEdit(new, inverse).doc === old` over the same
  fuzz. The fuzz palette deliberately mixes ASCII, an astral emoji, and a
  decomposed accent (`e` + U+0301), so the "never split a code point" claim is
  *tested*, not asserted.
- **The history is exact** — replay a random editing session, then undo all the
  way down and you reach the *initial* document; redo all the way up and you
  reach the *final* one; and any random interleaving of undo/redo keeps the
  live document equal to an **independent reconstruction** that applies the
  applied steps forward from scratch (no shared code with `History`'s own
  bookkeeping).
- **The coalescing rules, each isolated** — a typed run is one step, a newline
  breaks it, a pause longer than `coalesceMs` breaks it, switching type↔delete
  breaks it, a backspace run is one step, and a fresh edit after an undo
  discards the redo tail.
- **The gap, demonstrated** — typing `hello` is **1** coalesced undo step but
  **5** naive ones, the exact complaint the coalescing exists to fix.
- **The statistics**, pinned where the answer is countable by eye — including
  that one emoji is **1** character and **4** UTF-8 bytes, not JavaScript's
  `.length` of 2.

The same exactness check runs **live in the browser** — that's the ✓ Verified
line in the status bar — reconstructing the current text forward from the
history on every change, so a regression would light up on the page.

Run it:

```bash
node projects/phase2-text/text-editor/tests.js   # -> 41 passed, 0 failed.
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the toolbar (file name, New / Open / Save / Undo / Redo), the editing textarea, the status bar, and the side panel (history strip, coalesced-vs-naive card, autosave). |
| `style.css` | The dark house-style theme; the toolbar, the editing surface, the filled/hollow history blocks, and the comparison card. |
| `editor-core.js` | The engine — `diffEdit`, `applyEdit`, the coalescing `History`, the naive-step rival, and `stats`. No DOM; runs in Node and the browser. |
| `script.js` | Browser glue — classifies each change, drives the history, handles Open/Save/shortcuts and autosave, draws the history strip, and runs the live exactness check. |
| `tests.js` | The dependency-free suite: curated diffs, the round-trip laws over a Unicode fuzz, the isolated coalescing rules, the naive gap, and the statistics. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
