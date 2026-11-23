# Code Snippet Manager

> Source 2 (karan/Projects) · **Files** · project 6 of 6
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"A utility for saving functions, classes, or
other reusable code for later, organized by snippet type or language. An optional
extra is adding syntax highlighting based on the language."*

A local snippet library that runs entirely in the browser — no server, no build
step, and (this is the point) **no syntax-highlighting library**. The highlighter
is a hand-written lexer that reads the code the way a compiler's front end does:
character by character, in priority order, so that a `//` inside a string stays
part of the string and the `for` buried inside `information` is never mistaken for
a keyword. Snippets are organized by language and by free-form tags, found through
a ranked search with composable filters, and persisted to `localStorage`. The
engine runs headless too, under `node tests.js`.

## Try it

Open `index.html`. Click **Load samples** to drop in a few snippets across
JavaScript, Python, SQL and C, or **+ New** to start your own. Pick a language,
add comma-separated tags, and type into the **Source** pane — the **Preview**
pane re-highlights live. Changes autosave (and save on blur, on `Ctrl/Cmd+S`, and
before you leave the page). Search with plain words (ranked across title, tags
and code), narrow with `lang:py`, and filter by tag with `tag:api` or `#api`; the
language/tag chips do the same with a click. **Copy** puts the code on your
clipboard. Everything lives in your browser; nothing is uploaded.

Run the engine tests with `node tests.js` (112 checks, no dependencies).

This is a "Files" project — the "file" here is your snippet library, serialized to
and reloaded from storage — and three things about it are genuinely hard. All
three live in `snippet-core.js` so they can be tested without a browser.

## Trap 1 — a syntax highlighter is a lexer, not a bag of regexes

The naive way to "add syntax highlighting" is a stack of regular expressions: one
for strings, one for comments, one for keywords. They fight each other the moment
code gets real. A `//` *inside a string* (`"http://x"`) looks exactly like the
start of a comment. A `#` *inside a Python string* (`'use #tags'`) looks like the
start of one too. And a `\bfor\b`-style keyword rule either misses `for` or — far
worse — the word-boundary gymnastics still trip over `formatter` and
`information`. Regexes can't resolve these because the correct answer depends on
*where you already are* in the text.

So the highlighter is a single character-level scanner (`tokenize`) that walks the
string once and, at each position, tries the token kinds in a fixed **priority
order**: comment → string → number → identifier → operator → punctuation. Because
a string is recognized as one whole unit *before* anything looks for a comment
marker, the `//` inside it is never seen. Because an identifier is read to its end
and *then* classified, `information` is one token and the keyword check runs on
the whole word, not a substring. The tests pin all of this: `"http://x//y"` yields
no comment token, a Python string keeps its `#`, and `var information = formatter`
reports exactly one keyword (`var`). The scanner is also **lossless** — every
token's text concatenated back together equals the original source byte for byte —
which the tests assert across JavaScript, Python, SQL, C and plain text, including
unicode and emoji.

## Trap 2 — highlighting must escape HTML, exactly once, after tokenizing

To show colored code you emit `<span>` tags around it. But the code is *user
text*, and user text contains `<`, `>` and `&`. Escape in the wrong order — wrap
raw code in spans and then escape the whole thing — and you destroy your own
markup. Don't escape at all and a snippet containing `</span><script>alert(1)
</script>` both breaks the layout and runs as script: a stored-XSS hole in what
looks like an innocent viewer.

The fix is the ordering: `highlightHtml` **tokenizes first**, then escapes each
token's text exactly once (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`) as it wraps
it. So a literal `</span>` in a snippet becomes visible, inert text and can never
close one of our spans; a `<script>` becomes `&lt;script&gt;`. The tests assert
the raw `<script>` never appears in the output, that `&&` escapes to two `&amp;`
and not `&amp;amp;` (no double-escaping), and — the real proof — that stripping
the spans and un-escaping the result reproduces the exact source. A Playwright
end-to-end check backs this in a real browser: it types `</span><script>
window.__pwned=1</script>` into a snippet and confirms the script never executes.

## Trap 3 — search must rank and compose, and the store must never trust its own data

"Search your snippets" is two problems. First, **relevance**: a snippet *named*
`parseDate` should beat one that merely *calls* `parseDate` in its body. So a free
term scores far higher for a title hit than a tag hit than a language hit than a
code hit, and a snippet's score is the sum across terms; multiple terms are ANDed
(each must match somewhere). Second, **composition**: `lang:` and `tag:`/`#tag`
are filters that narrow the candidate set and combine freely with each other and
with ranked words, so `lang:python parse` means "Python snippets about parse."
The tests cover title-over-code ranking, `tag:x` ≡ `#x`, AND semantics across
terms, and alias-aware language filtering (`lang:ts` finds JavaScript).

And because the library is serialized to storage and read back, the loader
**never trusts what it reads**. `SnippetStore.deserialize` parses defensively:
invalid JSON, a non-array, or `null` all yield an empty store instead of throwing;
a mixed array keeps the valid records and silently drops the junk (a `null`, a
bare number); an unknown language is coerced to `plain`; and colliding ids are
made unique on load. The round-trip itself is proven exact on deliberately nasty
code — embedded quotes, backslashes, newlines, unicode and HTML — coming back
byte-identical.

## Files

| File | What it is |
| --- | --- |
| `snippet-core.js` | The engine: the language specs, the lexer (`tokenize`), HTML rendering (`highlightHtml` / `escapeHtml`), tag/query normalization, and the `SnippetStore` (CRUD, ranked `search`, aggregates, defensive `serialize`/`deserialize`). Runs in Node and the browser. |
| `tests.js` | 112 assertions: lexer losslessness and priority-order correctness, escapes/numbers/aliases, injection-safe HTML rendering, search ranking and filter composition, normalization, store CRUD/validation, and round-trip + defensive loading. `node tests.js`. |
| `index.html` / `style.css` / `script.js` | The browser UI — a two-pane editor with live highlighted preview, language/tag facet chips, ranked search, autosave to `localStorage`, copy-to-clipboard and keyboard shortcuts. Thin glue over the engine. |

## Note

This project is part of an automated daily routine run by Claude Code (see the
repository root [`README.md`](../../../README.md) and
[`PROGRESS.md`](../../../PROGRESS.md)). Each day the routine builds the next
unchecked project from its source list, writes it up, and merges it.
