# Regex Query Tool

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**twelfth entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/), [Pig Latin](../pig-latin/),
[Count Vowels](../count-vowels/), [Check if Palindrome](../check-if-palindrome/),
[Count Words in a String](../count-words/), [Text Editor](../text-editor/),
[RSS Feed Creator](../rss-feed-creator/), [Quote Tracker](../quote-tracker/),
[Guestbook / Journal](../guestbook-journal/) and
[Vigenère / Vernam / Caesar Ciphers](../vigenere-vernam-caesar-ciphers/).

> "Regex Query Tool — A regular expression query tool that extracts regexp
> syntax (i.e. `[A-Z]`) from the user and a search string from the user and
> displays the results of matching the string with the regexp."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Type a regular expression and a search string. The page shows, live:

- the search string with **every match highlighted** (adjacent matches in
  alternating colours so you can tell them apart);
- a card per match listing **every capture group** — numbered and named — with
  its value *and its exact position*;
- a plain-English, token-by-token **reading of the pattern**;
- a flag cheat-sheet that updates as you type flags; and
- a **ReDoS warning** when the pattern has a shape that can hang the browser.

Eight ready-made patterns (email, URL, IPv4, hex colour, dates with named
groups, word boundaries, capture groups, and a deliberate ReDoS trap) are one
click away in the dropdown.

## The interesting part: the three-line version is wrong in three ways

The brief is `new RegExp(p, f)` plus `str.matchAll(re)`. That is three lines,
and it gets three things wrong. Each one is a function in
[`regex-core.js`](./regex-core.js), and the point of the project is that each is
handled honestly rather than hidden.

### 1. `matchAll` tells you *what* matched, but not *where the groups are*

`matchAll` hands you the matched text and the match's start index — but **not**
where each capture group landed. A tool that wants to highlight "group 2" has
nothing to point at. The fix is the **`d` flag** (`hasIndices`): the engine adds
it for you, reads `match.indices`, and reports a real `[start, end)` for every
group, named or numbered:

```
(?<first>\w+)\s+(?<last>\w+)  over  "Ada Lovelace"
  group 1 <first> = "Ada"      [0, 3)
  group 2 <last>  = "Lovelace" [4, 12)
```

A group that didn't participate (the untaken branch of `(a)|(b)`) reports
`value: null` and `start: null`, instead of a confusing empty string.

### 2. Zero-width matches break the naive loop *and* the naive highlighter

`/^/gm`, `/\b/g`, and `/(?=x)/g` all match **between** characters. They expose
two classic bugs at once:

- a scan loop that advances by match length **never terminates** on a
  zero-width match — `exec` returns the same empty match forever;
- a highlighter that draws "from start to end" **draws nothing**, silently
  dropping the match.

`findMatches` bumps `lastIndex` past any empty match so the loop ends, and
`segment` emits an explicit **zero-width marker** (rendered as a caret between
characters) so you can see that `/^/gm` matched the start of all three lines,
not "nothing."

### 3. Some patterns must not be run — `(a+)+$` never comes back

JavaScript has **no way to time-limit a regex**. The pattern `(a+)+$` against a
couple of dozen `a`s followed by a non-`a` takes longer than the age of the
universe — *catastrophic backtracking*, the bug behind the 2016 Cloudflare and
2019 Stack Overflow outages. The only defense is to recognise the dangerous
**shape** before running it on untrusted input, so `analyze` does a static scan
for the textbook killers:

- **nested quantifiers** — `(a+)+`, `(a*)*`, `(\d+)*`, `(a+){2,}`;
- **quantified alternation that can overlap** — `(a|a)*`, `(a|ab)*`.

It is a heuristic, not a full NFA ambiguity proof, so a clean result reads *"no
obvious catastrophic backtracking found,"* never a guarantee — and the tests pin
down both the patterns it must flag and the safe ones it must leave alone
(a bare `(a+)`, a bounded `(a+){2,5}`, a `[+*]` character class, escaped
`\(a+\)+`).

### And a reading, because a query tool you can't read you can't trust

`explain` walks the pattern token by token and names each piece —
anchors, classes, groups (capturing, non-capturing, named, lookaround),
quantifiers (including lazy ones and `{n,m}` ranges), back-references and
literals. The tokens concatenate back to the original source exactly, which is
itself a test.

## Running the tests

```
node projects/phase2-text/regex-query-tool/tests.js
```

**69 checks**, six kinds:

1. **Curated corpus** — known patterns against known strings: digits, word
   boundaries, alternation, anchors, case-insensitivity, an email pattern,
   `dotAll`.
2. **Group positions** — the `[start, end)` of every group is exact, named
   groups map onto their numbered slots, and a non-participating group reports
   `null`.
3. **Zero-width cases** — `/^/gm` finds three line-starts and the loop
   terminates; `\b` doesn't spin; the segmenter rebuilds the input character for
   character.
4. **The ReDoS analyzer** — flags `(a+)+$`, `(a*)*`, `(\d+)*`, `(a+){2,}`,
   `(a|a)*` and `((a+)+)+`; clears `\d+`, the email pattern, `(a+)`,
   `(a+){2,5}`, `(a+)?`, `[+*]+` and `\(a+\)+`.
5. **The explainer** — recognises `\d`, `{2,4}` ranges, char classes, named
   groups and lazy quantifiers, and its tokens rebuild the pattern.
6. **Guardrails** — an unclosed group, a bad flag, and a duplicate flag each
   return an error string instead of throwing; every library pattern compiles.

## Files

| File | What's in it |
| --- | --- |
| `regex-core.js` | The DOM-free engine: safe compile, `findMatches` with group positions, the zero-width-safe `segment`, the `analyze` ReDoS scanner, the `explain` tokenizer, and the pattern library. |
| `index.html` | The single-page playground. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — reads inputs, calls the engine, paints matches/groups/warnings. All output goes in via `textContent`, so a pattern can never inject markup. |
| `tests.js` | 69 dependency-free checks, run under Node. |

## A note on scope

This matches with the **host JavaScript regex engine** — it's a window onto
`RegExp`, not a reimplementation of one. That is the honest version of the
brief: the value isn't a new matcher, it's seeing precisely what the real one
did (every group, every position, every zero-width hit) and being warned before
you feed it a pattern that won't come back.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
