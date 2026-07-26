# Markdown Previewer

Type GitHub-flavored **markdown** on the left, watch it render to **HTML** on the
right — live. The app-ideas spec suggests reaching for the `marked` library; this
routine forbids dependencies, so the markdown parser here is **written from
scratch in vanilla JS**. That parser is the real project.

Source idea: [app-ideas / Markdown-Previewer](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Markdown-Previewer.md)

## Running

Open `index.html` in any browser — nothing to install:

```bash
open projects/2-intermediate/markdown-previewer/index.html
```

## What it does

- **Split editor / preview** with a two-pane layout (stacks on mobile).
- **Live preview** — HTML updates as you type. Toggle it off to render only on
  demand with the **Render →** button (both the core user story *and* the bonus).
- **Persistent storage** — your document is saved to `localStorage` on every
  keystroke, so it survives a browser restart (bonus feature).
- **Copy HTML** — one click copies the rendered HTML source to the clipboard,
  with an `execCommand` fallback for older browsers (bonus feature).
- Extras: live **char/word count**, a **Sample** doc, **Clear**, and soft-tab
  (2-space) indentation inside the editor.

## The parser

`markdownToHtml()` in `script.js` is a small two-stage converter:

1. **Block stage** walks the document line by line and recognises fenced &
   indented code, ATX headings, blockquotes (parsed recursively), tables with
   column alignment, ordered/unordered/**nested** lists, task lists, horizontal
   rules and paragraphs.
2. **Inline stage** (`parseInline`) handles bold / italic / bold-italic,
   strikethrough, inline code, images, links, bare-URL autolinks and hard line
   breaks.

### Safety

The preview is injected as HTML, so escaping matters. Every text node is
HTML-escaped, inline code is protected with placeholder tokens before other
rules run, and `safeUrl()` drops any `href`/`src` whose scheme isn't
`http(s)`, `mailto`, an anchor or a relative path — so `javascript:` and `data:`
URLs (and raw `<script>` tags) can't slip through.

## Sanity check

The parser has no DOM dependencies, so its core can be exercised in Node:

```bash
node -e 'const fs=require("fs");let s=fs.readFileSync("script.js","utf8");
s=s.slice(0,s.indexOf("/*  App wiring"));
const {markdownToHtml}=new Function(s+";return {markdownToHtml};")();
console.log(markdownToHtml("# Hi\n- [x] **done**"));'
```

During development this was run against 13 assertions covering headings,
emphasis, nested lists, task lists, aligned tables, fenced code, blockquotes,
links, HTML-escaping and blocked `javascript:` URLs — all passing.

---

*Built automatically by a [Claude Code](https://claude.com/claude-code) routine.
See the [repo README](../../../README.md) for how the routine works.*
