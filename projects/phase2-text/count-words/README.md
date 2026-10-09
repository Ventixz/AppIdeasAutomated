# Count Words in a String

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**sixth entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/), [Pig Latin](../pig-latin/),
[Count Vowels](../count-vowels/) and [Check if Palindrome](../check-if-palindrome/).

> "Count Words in a String — Enter a string and the program counts the number of
> words in the string."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Everyone writes the same first line:

```js
str.trim().split(/\s+/).length
```

Feed it `"the quick brown fox"`, get `4`, and it looks finished. It isn't, and
every place it's quietly wrong is the whole project:

- **The empty string counts as one word.** `"".split(/\s+/)` is `[""]`, whose
  length is `1`. So is `"   "` once it's trimmed. A string with no words in it
  should count `0` — this is the single most common word-count bug there is, and
  the one every naive tutorial ships.
- **Punctuation isn't a word.** Split `"hi -- there :) !!!"` on whitespace and
  you get five tokens; three of them — `--`, `:)`, `!!!` — are pure punctuation
  and emoticons. A token is only a word if it carries at least one **letter or
  digit** (`\p{L}` or `\p{N}`).
- **"Whitespace" is a Unicode set, not `[ \t\n]`.** Real text separates words
  with no-break spaces (U+00A0), the narrow no-break space inside French numbers
  (U+202F), ideographic spaces (U+3000), line/paragraph separators (U+2028 /
  U+2029) and more. This engine splits on `\p{White_Space}`, the whole Unicode
  property, so every real separator ends a word.

The page shows the total, the text with every counted word highlighted (and the
dropped non-word tokens dimmed and struck through), the list of what was
dropped, and — the point of the whole thing — the **naive one-liner's answer and
the Unicode segmenter's answer right beside the honest one**, so the gaps on
real text are visible, not asserted.

## The interesting part: whitespace can only take you so far

The honest count above is a real improvement on the one-liner, and for text
written in a script that puts spaces between words it's the right answer. But
there's a ceiling built into the whole idea, and it's worth seeing clearly:

**No whitespace rule, however careful, can count words in a script that doesn't
use whitespace.** `你好世界` is four words — "hello" and "world" — with no
separator anywhere. Thai runs whole sentences together the same way. Split on
every space Unicode defines and you still get *one* token, because there are no
spaces to split on.

The only thing that can find those boundaries is **Unicode text segmentation
(UAX #29)**, which the platform ships as `Intl.Segmenter`:

```js
const seg = new Intl.Segmenter(undefined, { granularity: "word" });
[...seg.segment("你好世界")].filter(s => s.isWordLike).length   // -> 4
```

So the page carries that number too, as the **exhibit** — the way Count Vowels
shows the naive regex beside the correct count. For plain spaced text the
segmenter broadly tracks the whitespace count; for scriptio continua it reveals
the words the whitespace rule literally cannot see. It's shown, not hidden,
because the ceiling is the honest lesson of the project: *counting words is a
language-segmentation problem the moment the text stops being space-separated
English.*

## How it's verified

The word rule is implemented **twice, two structurally different ways**, so
there's an independent oracle with no shared code path:

- **`scanWords`** walks the string one code point at a time, tracking whether
  it's inside a non-whitespace run and whether that run has yet seen a letter or
  digit, and banks a word at each whitespace boundary. It never builds a token
  array.
- **`regexWords`** splits the whole string on `/\p{White_Space}+/u` in one shot,
  then keeps the tokens that contain a letter or digit.

They must return the same count **and the same ordered list of word tokens** on
every input. On top of that, `tests.js` pins:

- a **curated corpus** — empty and whitespace-only input, apostrophes and
  hyphens, pure-punctuation tokens, exotic Unicode spaces, accented words
  (precomposed and decomposed), digit tokens, and emoji — to exact expected
  counts;
- the **independent cross-check** across a **40,000-string Unicode fuzz** (a
  palette of Latin letters, accents pre-composed *and* decomposed, every kind of
  Unicode space, punctuation, CJK, Thai, emoji and a maths-bold letter);
- **grounding on clean ASCII** — on plain space-separated words, where the naive
  `split(/\s+/)` one-liner is genuinely correct, both real implementations
  *and* the naive one match exactly, pinning the Unicode machinery to the
  obvious answer precisely where the obvious answer is right;
- **properties** — the count equals the word-list length and is never negative,
  the render segments **tile the input exactly** (concatenating them reproduces
  the original string), the number of highlighted "word" segments equals the
  count and the "nonword" segments equal the dropped list, and the count is
  **stable under whitespace normalisation** (join the words with single spaces,
  recount, same number);
- **the gaps**, demonstrated — the naive one-liner's empty-string `1` and its
  over-count on punctuation, and the segmenter seeing more words than whitespace
  can in `你好世界`.

The same scan-vs-regex cross-check runs **live in the browser** — that's the ✓
Verified line — so a regression would show up on the page, not just in CI.

Run it:

```bash
node projects/phase2-text/count-words/tests.js   # -> 243 passed, 0 failed.
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the input, presets, the stats line, the big total, the three-way comparison, the highlighted breakdown, and the dropped-token chips. |
| `style.css` | The dark house-style theme; the word highlight, the struck-through non-words, and the three comparison cards. |
| `words-core.js` | The engine — `scanWords`, `regexWords`, the `Intl.Segmenter` exhibit, the deliberately-naive one-liner, and `analyze`. No DOM; runs in Node and the browser. |
| `script.js` | Browser glue — renders the total, comparison, highlight and chips, and runs the live cross-check. |
| `tests.js` | The dependency-free suite: curated corpus, the Unicode fuzz cross-check, the ASCII grounding, the property laws, and the naive-and-segmenter gaps. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
