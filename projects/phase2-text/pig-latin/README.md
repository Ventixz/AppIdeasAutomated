# Pig Latin

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**third entry of its Text category**, following [Fizz Buzz](../fizz-buzz/) and
[Reverse a String](../reverse-a-string/).

> "Pig Latin — Pig Latin is a game of alterations played on the English
> language game. To form the Pig Latin form of an English word the initial
> consonant sound is transposed to the end of the word and an *ay* is affixed."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Everyone remembers Pig Latin as *"move the first letter to the end and add
`ay`"* — `pig → igpay`. Write exactly that and it looks finished. It isn't, and
the gap is the whole project:

- **What moves is the _onset_, not the first letter.** The onset is the run of
  consonants before the first vowel, so `smile → ilesmay` (move `sm`),
  `glove → oveglay` (`gl`), `string → ingstray` (`str`).
- **"Vowel" is not five fixed letters.** `y` is a **consonant at the start** of
  a word (`yellow → ellowyay`) but a **vowel everywhere else** (`my → ymay`,
  `rhythm → ythmrhay`). And the **`qu` digraph** moves as one unit, because that
  `u` isn't acting as a vowel (`quiet → ietquay`, `square → aresquay`).
- **Vowel-initial words take a different suffix.** `apple → appleway` — and
  which suffix (`way` / `yay` / `ay`) is the one genuine matter of taste, so
  it's the one thing the page lets you choose.
- **Real text isn't a bare word.** Capitalisation is carried onto the result
  (`Pig → Igpay`, `HELLO → ELLOHAY`), and punctuation, spaces and digits are
  left exactly where they were (`Hello, world! → Ellohay, orldway!`).

The page translates your text, then shows the **work for every word** — the
onset that split off, the rest, and the suffix, each colour-coded — and badges
the cases that make the rule interesting (`vowel start`, `qu unit`,
`y = consonant`, `no vowel`). A live census counts how many of each your text
contains.

## The interesting part, 1: the onset is a syllable rule

"Transpose the initial consonant **sound**" is doing a lot of quiet work. The
engine reduces it to a precise rule and implements it as a small scan
(`onsetLength`):

- consume consonants from the front until the first vowel;
- `a e i o u` are always vowels; `y` is a vowel **only after position 0**, so a
  leading `y` is consumed (`yes → esyay`) but an interior one stops the onset
  (`gym → ymgay`);
- when a `q` is consumed and the next letter is `u`, the `u` goes with it
  (`qu`), because it's part of the consonant sound, not the nucleus.

Consonant-only words fall out for free: `nth` has no vowel, so the whole word is
the onset and the rest is empty — `nth → nthay`.

## The interesting part, 2: Pig Latin can't be undone

Reverse a String was an *involution* — reversing twice returns the original.
Pig Latin is the opposite kind of transform: **it loses information**, and the
page makes that concrete. The consonant rule turns a word into
`rest + onset + "ay"` — which is a **rotation** of the word's letters plus a
fixed suffix — and *nothing in the output records how far it rotated*. So
inverting it means **guessing the rotation**: every split whose onset
re-encodes to the input is a valid original.

Type a Pig Latin word into the **"Undo it — if you can"** box and you'll
usually get several:

- `igpay` → `pig`, `gpi`
- `appleway` → **`apple`** (vowel rule) *and* **`wapple`** (consonant rule) — the
  two suffix conventions collide
- `antpay` → `pant`, `tpan`, `ntpa`

The true word is always in the list (the decoder is *sound* — it never loses
it), but the rules alone can't pick it out. Most pre-images aren't English
words, of course — but the transform has no dictionary, which is exactly why
it's **not invertible**.

## The design decisions

- **Letters move; everything else is inviolate.** Only maximal runs of ASCII
  letters are translated. Apostrophes are gaps, so a contraction is
  piglatinised in parts (`don't → onday'tay`) — an honest, lossless choice
  rather than a guess about English morphology. The upside is a hard guarantee:
  the text round-trips through tokenising unchanged.
- **Case is a shape, re-applied.** The transform runs in lowercase, then the
  original's case shape is put back: `ALLCAPS → ALLCAPS`, `Titlecase →
  Titlecase`, anything else as-is. A lone capital (`I`, or `A` starting a
  sentence) reads as Titlecase, not as a shout.
- **Only the vowel suffix is configurable.** `way` / `yay` / `ay`. The
  consonant case is always `ay`; there's nothing to decide there.
- **Strings only.** Every entry point rejects a non-string argument rather than
  coercing it, and `encodeWord` rejects anything that isn't a run of letters.

## How it's verified

With no `Intl.Segmenter`-style platform oracle to lean on, the suite grows its
own: the onset rule is implemented **twice, two structurally different ways** —
`onsetLength` (a forward scan) and `onsetLengthOracle` (find the first vowel,
then repair for `qu`) — and they must agree on a curated word list and across a
**20,000-word fuzz loop**. On top of that, `tests.js` pins:

- a **curated corpus** of textbook words and sentences (onset clusters, `y` both
  ways, the `qu` digraph, vowel words, caps, punctuation, no-vowel words) to
  exact expected output;
- **text preservation** — `detokenize(tokenize(s)) === s`, and `encode` leaves
  every non-letter in place, over 5,000 random strings each;
- the **anagram invariant** — `encodeWord` is a permutation of the letters plus
  a suffix, over 20,000 words;
- **decoder soundness** — the real word is always among `decodeCandidates`, and
  every candidate re-encodes to the input, over tens of thousands of words in
  all three suffix styles;
- **non-injectivity**, demonstrated with a concrete collision (`pant` and `tpan`
  both encode to `antpay`).

The same two-implementation cross-check runs **live in the browser** — that's
the ✓ Verified line — alongside the text round-trip, so a regression would show
up on the page, not just in CI.

Run it:

```bash
node projects/phase2-text/pig-latin/tests.js   # -> 79 passed, 0 failed.
```

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure: the input, suffix toggle, census, translated-text card, word-by-word table, and the decode box. |
| `style.css` | The dark house-style theme; colour-coded onset/rest/suffix and case badges. |
| `piglatin-core.js` | The engine — the onset rule (twice), word and passage encoding, tokenising, decoding, `analyze`. No DOM, runs in Node and the browser. |
| `script.js` | Browser glue — renders the cards, drives the decode box, runs the live cross-check. |
| `tests.js` | The dependency-free suite: curated corpus, the independent-oracle fuzz, the property tests, and the non-injectivity demo. |

---

*Part of [AppIdeasAutomated](../../../README.md), a repository grown one project
per day by an automated [Claude Code](https://claude.com/claude-code) routine.*
