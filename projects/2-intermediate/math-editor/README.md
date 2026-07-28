# Math Editor

Write a document, drop **real math formulas** into it, then save and reload
with every formula intact. The formulas aren't images or third-party widgets —
they're compiled from LaTeX to native browser **MathML** by a small
from-scratch compiler that is the actual project here. No libraries.

Source idea: [app-ideas / Math Editor](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/math-editor.md)

## Running

Open `index.html` in any modern browser — nothing to install:

```bash
open projects/2-intermediate/math-editor/index.html
```

## What it does

Every user story from the spec, plus **all three** bonus features:

- **Write a document** — the body is a rich `contentEditable` surface; type,
  format, and structure text freely (user story 1).
- **Add a math formula** — *Insert formula* opens a dialog with a LaTeX box, a
  live MathML preview, quick-insert snippets, and an inline/block toggle (user
  story 2).
- **Save locally** — *Save* writes a `.mathdoc` file (JSON) to disk; formulas
  store their LaTeX source in a `data-latex` attribute so nothing is lossy
  (user story 3).
- **Load with formulas intact** — *Load* reads a `.mathdoc` back and
  **recompiles every formula from its stored LaTeX**, so they come back live
  and re-editable — double-click any formula to reopen it (user story 4).
- **Change font size** — Small / Normal / Large / Huge on the selection (bonus 1).
- **Change other text attributes** — bold, italic, underline, colour, headings,
  lists (bonus 2).
- **Add images** — inserted as self-contained `data:` URIs so a saved document
  needs no external files (bonus 3).

There's also an **Export HTML** button that writes a standalone `.html` file —
open it anywhere and the MathML renders natively.

## How it works

The star is `latexToMathML()` in `script.js` — a proper little compiler, not a
pile of regexes:

1. **Tokenizer** splits the source into commands (`\frac`), numbers, variables,
   braces, `^`/`_` markers, and operators.
2. **Recursive parser** builds MathML: `\frac{}{}` → `<mfrac>`, `\sqrt[n]{}` →
   `<mroot>`, `^`/`_` → `<msup>`/`<msub>`/`<msubsup>`, and big operators
   (`\sum`, `\prod`) get `<munderover>` so limits sit above and below.
3. **Symbol tables** map ~120 names — Greek letters, relations, arrows, big
   operators, and named functions (`\sin`, `\log`) — to the right Unicode.

Because it's pure (string in, string out, no DOM), the editor and the Node
sanity check call the exact same code. Formulas are stored in the document as
`<span class="math-formula" data-latex="…">` — the rendered MathML is
disposable; the LaTeX in `data-latex` is the source of truth, which is what
makes save/load lossless and round-trippable.

## Sanity check

The compiler has no DOM dependencies, so it runs straight in Node:

```bash
cd projects/2-intermediate/math-editor
node -e 'const {latexToMathML}=require("./script.js");
console.log(latexToMathML("\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"));'
```

During development this was exercised against 19 assertions covering fractions,
scripts, roots, big-operator limits, Greek letters, relations, multi-digit
numbers, named functions, nesting, and `<`/`>`/`&` escaping — all passing.

---

*Built automatically by a [Claude Code](https://claude.com/claude-code) routine.
See the [repo README](../../../README.md) for how the routine works.*
