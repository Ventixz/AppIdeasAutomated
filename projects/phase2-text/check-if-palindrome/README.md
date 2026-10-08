# Check if Palindrome

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**fifth entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/), [Pig Latin](../pig-latin/) and
[Count Vowels](../count-vowels/).

> "Check if Palindrome — Checks if the string entered by the user is a
> palindrome, i.e. reads the same backwards and forwards."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Everyone writes the same first line:

```js
s === s.split("").reverse().join("")
```

Type that and `racecar` says `true` and it looks finished. It isn't, and every
place it's quietly wrong is the whole project:

- **`split("")` cuts between UTF-16 units, not characters.** An emoji or a
  maths-styled letter like `𝐚` (U+1D41A) is stored as a *surrogate pair* of two
  16-bit units. `split("")` tears the pair in half and `reverse()` swaps the
  halves, producing a mangled string. So the one-liner reports the single
  character `"😀"` as **not** a palindrome — a one-character string that isn't
  equal to itself reversed. The fix is to split by Unicode **code point**
  (`Array.from`), which keeps each astral character whole.
- **Accents live on their own.** `"é"` can arrive as one code point (NFC) or as
  `e` + a combining acute accent (NFD, two code points). Reverse the NFD form by
  code point and the accent floats off onto the wrong letter. The honest unit of
  text is the **grapheme cluster** — what a reader calls "one character" — which
  `Intl.Segmenter` provides, so `"é"` reverses as a single unit whichever way it
  was typed.
- **A palindrome of _what_?** `"RaceCar"` is a palindrome to a person and not to
  `===`. `"A man, a plan, a canal: Panama"` is the textbook palindrome and
  matches nothing character-for-character. These are **choices**, so you make
  them with four toggles: ignore case, ignore spaces & punctuation, fold accents
  to the base letter, and (to show the trap) compare by code point instead of
  grapheme.

The page shows the **naive one-liner's answer right beside** the correct one, so
you can watch them diverge the moment an emoji, an accent, or a filter is in
play.

## The two choices, made explicit

| Toggle | Off | On |
| --- | --- | --- |
| **Ignore case** | `RaceCar` ✗ | `RaceCar` ✓ |
| **Ignore spaces & punctuation** | `A man...` ✗ | `A man, a plan, a canal: Panama` ✓ |
| **Fold accents** | `eé` ✗ | `eé` ✓ (both become `e`) |
| **Compare by code point** | grapheme: `é` is one unit | code point: a combining accent can float off |

## How it's verified

The check is implemented **twice**, two structurally different ways:

- `twoPointer` walks one index in from each end, comparing the pair and stopping
  at the first mismatch — it never builds the reversed string.
- `reverseCompare` reverses the whole cleaned unit array and compares it element
  by element.

`check()` runs both and **throws if they ever disagree** on the verdict or the
first-mismatch index, so the two implementations police each other on every
call.

`tests.js` is a dependency-free suite (run with `node`) that pins:

1. a **curated corpus** — the empty string and single letters (trivial
   palindromes), `racecar`/`level`/`noon`, near-misses, mixed case, the textbook
   phrase, and accented pairs under each folding choice;
2. the **cross-check across a 40,000-string Unicode fuzz** that deliberately
   draws astral characters and combining marks;
3. the **surrogate-pair trap**, demonstrated: the engine says `true` for a lone
   emoji exactly where the naive one-liner says `false`;
4. the **combining-mark trap**: `"éé"` is a palindrome by grapheme
   and not by code point, both pinned;
5. **property tests** over random input — verdict matches *keys equal their own
   reverse*, a string concatenated with its own reverse is always a palindrome
   (a generator used as an oracle), the verdict is **normalisation-invariant**
   under folding (NFC vs NFD agree), and the kept/dropped counts always add up;
6. **option behaviour**: each toggle flips the verdict exactly where it should
   and nowhere else.

```
node projects/phase2-text/check-if-palindrome/tests.js   # -> 70040 passed, 0 failed.
```

The live page runs the same scan-vs-reverse cross-check (and the NFC/NFD
invariance, when folding is on) on every keystroke as the **✓ Verified** line,
so a regression would light up in the browser, not just in CI.

## Files

| File | What's in it |
| --- | --- |
| `palindrome-core.js` | the engine — unit segmentation, folding, the two independent checks, `analyze` |
| `tests.js` | the dependency-free suite described above |
| `index.html` | the playground markup |
| `style.css` | the dark house theme |
| `script.js` | the browser glue — verdict, folded form, mirror pairing, naive comparison, live cross-check |

---

*Part of [AppIdeasAutomated](../../../README.md) — a repository grown one
project per day by an automated [Claude Code](https://claude.com/claude-code)
routine.*
