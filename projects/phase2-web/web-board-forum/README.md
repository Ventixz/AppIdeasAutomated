# Web Board (Forum)

> Source 2 (karan/Projects) · **Web** · project 8 of 9
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Web Board (Forum) — a simple message board
system."*

A tiny flat-file forum that runs entirely in the browser: start threads, reply
to any post, nest replies as deep as you like, pin a thread, and delete posts.
No server, no build step — open `index.html`. Content lives in `localStorage`
with JSON export.

A forum *looks* like a two-line CRUD app. It is not. Three things about it are
genuinely hard, and the whole project is built around getting all three right.

## Try it

Open `index.html`, then click **Load demo data** in the footer. You'll see a
pinned "Welcome" thread on top and a Q&A thread with a nested reply and a
`[deleted]` tombstone. Click a thread to open it, use **Reply** on any post, and
**Delete** to see soft-deletion keep the replies underneath alive.

Run the logic tests with `node tests.js` (72 checks, no dependencies).

## Trap 1 — the reply tree is stored flat, and it breaks three ways

The board stores posts as a flat list; each reply just records its `parentId`.
The UI needs a *tree*. The naïve "recurse down from the root" builder breaks in
three different ways, and all three happen in real forums:

- **Orphans.** Delete a post that has replies, or let a reply point at an id that
  no longer exists, and the naïve recursion simply *drops the whole subtree* —
  the replies vanish. This board instead **soft-deletes** (a tombstone keeps the
  row), and the tree builder re-parents any genuinely orphaned post to the thread
  root rather than losing it. A reply that names a parent in a *different* thread
  is treated the same way.
- **Cycles.** Editing can produce `A → B → A`. Recurse into that and you get an
  infinite loop / stack overflow. `buildTree` resolves each post's *effective*
  parent by walking the parent chain with a `seen` set; any post that can't reach
  the root (because it's trapped in a cycle) is re-parented to the root, and the
  final DFS carries its own `visited` guard as a second line of defence.
- **Order.** Siblings must appear in a **stable** order no matter what sequence
  posts arrived in, so they're sorted by `(createdAt, id)`.

`buildTree` returns a clean nested structure and provably loses no posts — the
tests assert the node count is preserved across deleted parents, true orphans,
cross-thread parents, and a deliberately injected cycle.

## Trap 2 — "latest" is the wrong sort, and deletes must not bump

A forum index is ordered by **last activity**, not creation time — a 2-year-old
thread with a reply today belongs at the top. Easy enough, until you notice two
things the obvious `max(createdAt)` gets wrong:

- A **deleted** reply must *not* float its thread. If a spammer posts and a mod
  removes it, the thread should drop back down. `lastActivity` is computed over
  *live* posts only; a thread whose posts are all deleted falls back to its own
  creation time so it still has a stable slot.
- **Sticky** threads pin to the very top regardless of activity.

`listThreads` sorts sticky-first, then by live last-activity, then by id as a
final deterministic tiebreak.

## Trap 3 — every post is hostile text

A message board is the textbook stored-XSS target: one person types, everyone
else's browser renders it. `renderBody` is a strict pipeline —

1. **escape** the entire raw string (`<`, `>`, `&`, `"`, `'`),
2. **autolink** bare URLs in the *already-escaped* text, emitting only anchors we
   build ourselves, and only for `http`/`https` (so `javascript:` and `data:`
   URLs are never linked — the regex doesn't match them),
3. turn newlines into `<br>`.

Because the raw text is escaped *before* anything else runs, a post can never
introduce a tag we didn't choose to emit. The autolinker also handles the classic
trailing-punctuation bug: `(see http://x.com).` links `http://x.com` and leaves
`).` outside the link, while a balanced `…/Foo_(bar)` keeps its parenthesis.

The browser smoke test confirms it end to end: a reply containing
`<script>window.__pwned=1</script>` renders as visible text, sets no global, and
produces zero `<script>` nodes in the DOM.

## Files

| File | What's in it |
| --- | --- |
| `forum-core.js` | The engine: `escapeHtml`, `autolink`, `renderBody`, `excerpt`, and the `Board` class (threads, replies, soft-delete, bump order, `buildTree`). Zero dependencies; runs in Node and the browser. |
| `tests.js` | 72 Node checks covering all three traps. `node tests.js`. |
| `index.html` / `style.css` / `script.js` | The browser UI. `script.js` only renders and wires events — all logic is in the core, and the one `innerHTML` it uses is fed exclusively by `renderBody`. |

## About this project

This is one entry in an automated series: a scheduled Claude Code routine builds
one project per day from a public "list of projects" repository, working from the
easiest level up. See the [repository README](../../../README.md) and
[`PROGRESS.md`](../../../PROGRESS.md) for the full story.
