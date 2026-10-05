# Reverse a String

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**second entry of its Text category**, following [Fizz Buzz](../fizz-buzz/).

> "Reverse a String — Enter a string and the program will reverse it and print
> it out."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Reversing a string is the archetypal one-liner:

```js
s.split("").reverse().join("")
```

and for plain ASCII it is completely correct. The reason it's worth more than
one line — and the thing this playground is built around — is that **a
JavaScript string is a sequence of UTF-16 code units, not of the characters a
reader sees.** Reverse the code units and you tear emoji in half and float
accents onto the wrong letter.

So the page reverses your text at **three honestly-labelled granularities**,
from the naive-and-broken one up to the one a human actually means, and marks
each ✓ safe or ✗ corrupting for *your* input:

| Level | What it reverses | Breaks on… |
| --- | --- | --- |
| **Code units** — `split("").reverse()` | raw UTF-16 units | anything astral: an emoji or a 𝐁old math letter splits into a broken surrogate pair (shown as �) |
| **Code points** — `[...s].reverse()` | Unicode code points | combining marks (`e` + ◌́) and multi-code-point emoji — a 🇺🇸 flag flips to 🇸🇺, a 👨‍👩‍👧 family comes apart |
| **Grapheme clusters** | user-perceived characters | nothing — this is the reversal you mean |

A fourth mode reverses the **order of words** (each word left forward), the
other thing people mean by "reverse this".

Alongside the reversals the page shows **what's actually in your text** — the
three counts (code units / code points / graphemes), which diverge exactly when
the naive reversal would go wrong — and a **grapheme breakdown**: a chip per
user-perceived character (hover for its code points), with the multi-code-point
ones highlighted.

## The interesting part: grapheme segmentation, from scratch

The correct reversal needs to split text into **extended grapheme clusters**
(Unicode's model of "one character as a person perceives it"). Modern platforms
ship `Intl.Segmenter` for exactly this — but the engine here implements the
[UAX #29](https://unicode.org/reports/tr29/) cluster rules **by hand**, with no
dependency on it, so the same `reverse-core.js` runs identically in an old
browser and under Node, **and** so the test suite can use `Intl.Segmenter` as a
fully independent oracle (see below).

The segmenter walks code points and keeps a cluster going across:

- **combining marks** — `e` + ◌́ stays one character (`\p{Grapheme_Extend}`);
- **ZWJ emoji sequences** — `👨‍👩‍👧` is man·ZWJ·woman·ZWJ·girl, one cluster
  (GB11, and only when the ZWJ actually follows an emoji — `a`·ZWJ·`👩` is *not*
  joined);
- **regional-indicator flags** — `🇺🇸` is two letters that pair up two-at-a-time,
  so `🇺🇸🇫🇷` is two flags, not one run (GB12/GB13);
- **skin-tone modifiers** (`👍🏽`), **variation selectors**, and **CRLF**.

Classification uses Unicode property escapes (`\p{Grapheme_Extend}`,
`\p{Extended_Pictographic}`, `\p{Regional_Indicator}`, …) rather than
hard-coded code-point tables, so it tracks the engine's Unicode version instead
of shipping a frozen copy of the database.

## The design decisions

- **Three reversals, honestly labelled.** The naive one isn't hidden — it's
  shown *failing*, with a ✗ badge and a lone-surrogate `�`, next to the one that
  works, because the whole point is to see the difference.
- **Reversing twice is the identity.** Every level is an involution:
  `reverse(reverse(s)) === s`. The grapheme level reverses the *list of
  clusters*, so the multiset of characters is preserved and only their order
  flips.
- **Word reversal normalises whitespace.** Runs of whitespace collapse to a
  single space and the ends are trimmed, so for already single-spaced text,
  reversing the words twice returns the original.
- **Strings only.** Every entry point rejects a non-string argument rather than
  coercing it.

## How it's verified

`tests.js` is a dependency-free suite. Its core trick is an **independent
oracle**: the platform's own `Intl.Segmenter`, which shares no code with the
hand-written segmenter. The two must agree —

- on a **curated corpus** (combining accents, astral characters, flags, a lone
  regional indicator, a ZWJ family, a skin-tone modifier, CRLF), and
- across a **randomised fuzz loop** of ~1,500 strings assembled from a palette
  of every grapheme kind — both the segmentation *and* the resulting grapheme
  reversal are compared cluster-for-cluster.

On top of the oracle, property tests pin the claims that hold regardless of
segmentation: every level is an **involution** over ~2,000 random strings, the
grapheme reversal is exactly the cluster list reversed, code-unit reversal is
shown to **leak a lone surrogate** on astral input while the grapheme reversal
does not, and `analyze` reports the three counts and safety flags correctly.
The same oracle runs **live in the browser** — that's the ✓ Verified line — so
a regression would show up on the page, not just in CI.

Run it:

```bash
node projects/phase2-text/reverse-a-string/tests.js
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the input, the counts and grapheme breakdown, the four reversal cards. |
| `style.css` | The dark house-style theme; ✓/✗ accents on each card. |
| `reverse-core.js` | The engine — the three reversals, word reversal, the UAX #29 grapheme segmenter, `analyze`. No DOM, runs in Node and the browser. |
| `script.js` | Browser glue — reads the textarea, paints the cards, runs the live `Intl.Segmenter` verification. |
| `tests.js` | The dependency-free suite and the independent oracle. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
