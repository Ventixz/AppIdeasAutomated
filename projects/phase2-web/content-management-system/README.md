# Content Management System

> Source 2 (karan/Projects) · **Web** · project 7 of 9
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Content Management System — Make a content
management system like WordPress, Blogger etc. and make it easy to install and
set up."*

**Flatpress** is a tiny flat-file CMS that runs entirely in the browser — no
database, no build step, no install. You write posts and pages in Markdown,
tag them, keep them as drafts or publish them, and the CMS renders a complete
static website you can preview live. Everything is stored in `localStorage`;
nothing is uploaded anywhere.

"Easy to install and set up" is taken literally: open `index.html` and it works.

## Try it

Open `index.html` in a browser. It loads with a small sample set so there's
something to look at.

- **Content tab** — the admin. Create a post or page, write Markdown in the
  left pane and watch it render live on the right. Set tags, search, filter by
  status, publish/unpublish, delete.
- **Site preview tab** — the generated website. Pick a page from the dropdown;
  it renders in a sandboxed `<iframe>`. Only *published* content appears.
- **Export / import tab** — copy the whole store out as JSON, paste one back
  in, load the sample set, or wipe everything.

Run the tests with `node tests.js` (**104 checks**, no dependencies).

## Where the real work is

A CMS is a machine that takes text written by one person and turns it into HTML
served to everyone else. That sentence contains the whole danger: **untrusted
input becomes markup**. The engine (`cms-core.js`) is built around getting that
one thing right, and three traps cluster around it.

### Trap 1 — render Markdown *without* opening an XSS hole

The naïve Markdown renderer does regex replacements on the raw string and hands
the result to `innerHTML`. That means anything the author types as literal HTML
— `<script>alert(document.cookie)</script>` — sails straight through to every
reader. A CMS is exactly the place this matters, because the author of a post
and the reader of a post are different people.

The fix is an ordering discipline:

1. **Pull code spans out first.** `` `*not italic*` `` must stay literal, so
   backtick spans are replaced with placeholders *before* anything else runs,
   and restored at the very end. (The placeholder contains a null byte, which
   can't occur in the source text.)
2. **Escape everything.** The entire remaining string is HTML-escaped. After
   this point there is no live markup in the document at all.
3. **Re-introduce only the tags we generate.** Bold, italic, links, images,
   headings, lists — each is produced by our own code from already-escaped
   text. The author can never inject a tag we didn't choose to emit.

So a post body of `Hi <script>alert(1)</script>` renders as the visible text
`Hi <script>alert(1)</script>`, not as a running script. There's an
end-to-end test that renders a deliberately malicious post through the static
site and asserts no `<script>` tag and no `javascript:` href survive to the
output.

### Trap 2 — a link's *scheme* is an attack surface

Escaping the text isn't enough, because `[click me](javascript:alert(1))` puts
the payload in an attribute we *do* emit. `escapeHtml` on the URL doesn't help —
`javascript:alert(1)` contains no characters that escaping changes.

`sanitizeUrl` is a scheme allowlist: `http/https/mailto/tel/ftp`, plus relative,
root-relative, fragment and protocol-relative URLs. Anything that declares some
*other* scheme collapses to `#`. It also strips control characters first, so the
classic `java\tscript:` bypass (browsers ignore the tab) is caught. Both links
and images go through it.

### Trap 3 — slugs must be unique *and* stable

Every published post needs a URL, derived from its title. Two independent
requirements pull against each other:

- **Unique.** Two posts both titled "Hello" can't both be `hello.html`.
  `uniqueSlug` appends `-2`, `-3`, … until it finds a free one.
- **Stable.** Once a post is published and linked-to, renaming its title must
  **not** silently change its URL and break every existing link. So `update()`
  deliberately leaves the slug alone when the title changes — re-slugging is an
  explicit action (the `↻` button), and even then the result is de-duplicated
  against the other posts.

Slug derivation also has to survive real titles: `slugify` folds accents to
ASCII (`Café` → `cafe`) via Unicode NFKD, lowercases, turns every run of
non-alphanumerics into a single hyphen, and falls back to `untitled` when a
title has no usable characters at all (e.g. a title that is only emoji).

## What's in the box

| File | Role |
| --- | --- |
| `cms-core.js` | The whole engine: HTML escaping, URL sanitisation, slugs, the Markdown renderer, the `CMS` content store, and the static-site renderer. No dependencies, no I/O. |
| `index.html` | The three-tab admin shell. |
| `script.js` | Browser glue — wires the DOM to the engine, persists to `localStorage`. Contains no content logic of its own. |
| `style.css` | Styling, light + dark. |
| `tests.js` | 104 Node assertions over the engine. |

The split is deliberate: **every behaviour the UI shows is a function in
`cms-core.js`, and every one of those functions is exercised by `tests.js`.**
The browser and the test runner drive the same code.

## The Markdown subset

Headings (`#`–`######`), bold, italic, inline code, fenced code blocks (with an
optional language class), links, images, unordered and ordered lists,
blockquotes, horizontal rules, and paragraphs. Markdown inside code spans and
code fences is left literal; code everywhere is HTML-escaped.

## Notes & limitations

- Storage is per-browser `localStorage`; it isn't shared between machines (use
  **Export / import** to move content). This is the honest shape of a
  zero-install, zero-server CMS.
- The renderer is a well-defined *subset* of Markdown, not CommonMark. It
  favours being small, safe and fully testable over covering every edge of the
  spec.
- The static-site renderer returns an in-memory `{ path: html }` map, which the
  preview shows in a sandboxed iframe. Writing those files to disk would be the
  one extra step to turn this into a real static-site generator.
