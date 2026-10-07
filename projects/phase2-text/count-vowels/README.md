# Count Vowels

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**fourth entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/) and [Pig Latin](../pig-latin/).

> "Count Vowels — Enter a string and the program counts the number of vowels in
> the text."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Everyone writes the same first line:

```js
str.match(/[aeiou]/gi).length
```

It returns `1` for `café`, `1` for `résumé`, and has no opinion about `y`. Type
exactly that and it looks finished. It isn't, and every place it's quietly
wrong is the whole project:

- **Real text has accents.** `café` has two vowels — `a` and `e` — but the `é`
  is a different Unicode code point and never matches `[aeiou]`. The fix is to
  fold every character to its base letter (Unicode **NFD**: `é → e` + a
  combining accent, which is then dropped) and judge the base. Then
  `café → 2`, `naïve → 3`, `résumé → 3`, `jalapeño → 4` (the `ñ` folds to `n`,
  correctly *not* counted).
- **`y` is a vowel sometimes.** It's one in `rhythm` and `my`, a consonant in
  `yes`. There's no single right answer, so it's the one thing you toggle — and
  it's always reported in its own column.
- **"One character" is a choice.** A UTF-16 `.length` counts a decomposed `é`
  as two and the maths-bold letter `𝐚` as two. This engine counts by Unicode
  **code point**, so every number is about letters, not storage.
- **Ligatures and look-alikes hide vowels.** The single glyph `ﬁ` *is* an `f`
  and an `i`; `𝐚` *is* an `a`. Canonical folding leaves them alone;
  **compatibility folding (NFKD)** unpacks them so the hidden `i` and `a` count.
  Which you want is a real decision, so it's the second toggle.

The page shows the total, a per-vowel histogram, the text with every counted
vowel highlighted (hover a mark to see the base letter it folded to), and — the
point of the whole thing — the **naive one-liner's answer right beside the
correct one**, so the gap on real text is visible, not asserted.

## The interesting part: counting vowels is a Unicode problem

The naive regex is correct on exactly one kind of input — plain ASCII letters,
with `y` excluded — and wrong the moment text looks like text people actually
write. The engine earns the difference with one idea applied consistently:
**reduce every character to its base letter before judging it.**

```
baseLetters('é')  // NFD, strip combining marks, lowercase -> "e"
baseLetters('ñ')  //                                        -> "n"   (a consonant)
baseLetters('ﬁ', {compatibility:true})                      -> "fi"  (two letters!)
```

That a single source character can fold to *more than one* base letter (the
`ﬁ → fi` case) is why the reduction returns a string, not a char — and it's what
keeps the two implementations below in agreement on ligatures.

A small, satisfying consequence falls out and is asserted as a law: **the count
is normalisation-invariant.** Whether you hand the engine `café` with a
pre-composed `é` or with a separate `e` + combining accent, it returns the same
number. Folding the input to NFC or NFD first cannot change how many vowels are
in it — which is exactly what "counting vowels" ought to mean.

## How it's verified

The count rule is implemented **twice, two structurally different ways**, so
there's an independent oracle with no shared code path:

- **`analyze`** walks the string one code point at a time, folds each in
  isolation, and builds the full report — total, per-vowel histogram, distinct
  set, and the per-position data the highlighter uses.
- **`countByRegex`** normalises the **whole string** at once, strips every
  combining mark with `\p{M}` in one shot, and counts matches of a single
  character class.

They must return the same total on every input. On top of that, `tests.js`
pins:

- a **curated corpus** — plain words, accented words, the `y` question both
  ways, ligatures and maths-styled letters under both folding modes, and
  empty / letterless input — to exact expected counts;
- the **independent cross-check** across a **40,000-string Unicode fuzz** (a
  palette with accents pre-composed *and* decomposed, the `ñ` trap, a ligature,
  a maths-bold letter, bare combining marks, digits, punctuation and emoji);
- **grounding on the ASCII subset** — where the naive `/[aeiou]/gi` one-liner is
  genuinely correct, both real implementations must match it exactly, pinning
  the Unicode machinery to the obvious answer precisely where the obvious answer
  is right;
- **properties** — the histogram sums to the total, `distinct` equals the number
  of non-zero buckets, the count is **invariant under NFC/NFD normalisation**,
  and every reported highlight position lands on a real vowel-bearing code point
  and the positions' hit-counts sum to the total;
- **the gap**, demonstrated — a concrete string where naive and correct
  disagree (`résumé`: `1` vs `3`), so "the one-liner is wrong" is shown, not
  just claimed.

The same scan-vs-regex cross-check and the normalisation-invariance check run
**live in the browser** — that's the ✓ Verified line — so a regression would
show up on the page, not just in CI.

Run it:

```bash
node projects/phase2-text/count-vowels/tests.js   # -> 44 passed, 0 failed.
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the input, the two toggles, the stats line, the big total, the histogram, the highlighted text, and the naive-vs-correct comparison. |
| `style.css` | The dark house-style theme; per-vowel colours for the histogram and the highlight marks. |
| `vowels-core.js` | The engine — `baseLetters`, the per-code-point `analyze`, the whole-string `countByRegex`, and the deliberately-naive `countNaive`. No DOM, runs in Node and the browser. |
| `script.js` | Browser glue — renders the total, histogram, highlight and comparison, and runs the live cross-check. |
| `tests.js` | The dependency-free suite: curated corpus, the Unicode fuzz cross-check, the ASCII oracle, the property laws, and the naive-vs-correct gap. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
