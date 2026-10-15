# Vigenère / Vernam / Caesar Ciphers

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**eleventh entry of its Text category**, following [Fizz Buzz](../fizz-buzz/),
[Reverse a String](../reverse-a-string/), [Pig Latin](../pig-latin/),
[Count Vowels](../count-vowels/), [Check if Palindrome](../check-if-palindrome/),
[Count Words in a String](../count-words/), [Text Editor](../text-editor/),
[RSS Feed Creator](../rss-feed-creator/), [Quote Tracker](../quote-tracker/) and
[Guestbook / Journal](../guestbook-journal/).

> "Vignere / Vernam / Ceasar Ciphers — Implement a program that encrypts a
> message using one of these ciphers."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Three classical ciphers, and the thing most tutorials miss: they are **one idea
seen at three scales.**

- **Caesar** — add a fixed number to every letter. Shift 3 turns `HELLO` into
  `KHOOR`. There are only 25 useful shifts.
- **Vigenère** — Caesar, but the shift *changes every letter*, driven by a
  repeating keyword. `ATTACKATDAWN` under the key `LEMON` becomes `LXFOPVEFRNHR`.
- **Vernam** — Vigenère taken to the limit: the key is as long as the message,
  perfectly random, and used exactly once (the **one-time pad**), carried out by
  XOR over raw bytes. This is the *only* cipher with a proof of perfect secrecy.

The page has four tabs: one per cipher (live encrypt/decrypt), and a **Break it**
tab that cracks Vigenère ciphertext *with no key* and demonstrates the two-time
pad catastrophe.

## The interesting part: it's one engine, and two thirds of it are broken

Everything below is the point of the project.

### Caesar *is* Vigenère with a one-letter key

The temptation is to write three ciphers. But Caesar with shift `s` is identical
to Vigenère with the single-letter key `String.fromCharCode(65 + s)`. So this
project has **one** engine — `vigenereShift(text, shifts, dir)` — and Caesar is
implemented by *calling* it with a one-element shift list:

```js
caesar.encrypt = (text, shift) => vigenereShift(text, [mod(shift, 26)], +1);
```

The test suite pins the identity down across all 26 shifts:
`caesar.encrypt(t, s) === vigenere.encrypt(t, keyForShift(s))`. They can never
drift apart because they are the same code.

### Vernam refuses to weaken itself

A one-time pad is unbreakable **only** when the key is at least as long as the
message, random, and never reused. The single most common way people turn Vernam
back into a breakable cipher is to quietly repeat a short key — at which point
it's just running-key Vigenère over bytes. So the engine **throws** rather than
encrypt with a key shorter than the message:

```
Vernam key is shorter than the message (8 < 20 bytes). A one-time pad must be
at least as long as what it hides — repeating it would break the cipher.
```

There's a 🎲 button that generates a proper random pad of exactly the right
length using the platform CSPRNG (`crypto.getRandomValues`, or Node's
`crypto.randomBytes`). It will not hand back a predictable "pad."

### The attacks are implemented, not just described

This is what makes it more than a toy. The **Break it** tab runs real
cryptanalysis:

1. **Index of coincidence** finds the key length. English prose has an IoC of
   about **0.0667** (letters are wildly non-uniform — `E` alone is 12.7%);
   random text sits near **0.0385**. Split the ciphertext into `g` columns for
   each candidate key length `g`; the right `g` is the one whose columns each
   look like English. The page shows the ranked table with bars.
2. **Chi-squared frequency analysis** solves each column. Every column was
   enciphered with one constant Caesar shift, so try all 26, and keep the shift
   whose decryption best matches English letter frequencies. Concatenate the
   per-column shifts and you have the key — **recovered from ciphertext alone.**
3. Recovered keys are collapsed to their **minimal period**, so a text with
   true period 6 reports `HAMLET`, not the equally-valid `HAMLETHAMLET`.

Load the sample, hit *Crack it*, and watch the key and plaintext fall out with
nothing supplied. (Frequency analysis needs enough text — a sentence or two is
marginal, a paragraph is plenty, which is itself an honest fact about the
attack.)

Caesar's own break is simpler still: `caesar.bruteForce()` decrypts under all 25
shifts and scores each, so the English answer floats to the top on its own.

### The two-time pad — why "one-time" is load-bearing

A one-time pad is perfect *once*. Encrypt two messages `P1`, `P2` with the
**same** key `K` and the key cancels the moment you XOR the ciphertexts:

```
C1 ⊕ C2 = (P1 ⊕ K) ⊕ (P2 ⊕ K) = P1 ⊕ P2
```

You now hold the XOR of the two plaintexts with no key anywhere, and English is
redundant enough to peel the two apart. The page encrypts two messages under one
shared pad and shows `C1 ⊕ C2` — the leak itself. This is not hypothetical: it's
the mistake that broke the Soviet VENONA traffic.

## Running the tests

```
node projects/phase2-text/vigenere-vernam-caesar-ciphers/tests.js
```

**81 checks**, six kinds:

1. **Curated corpus** — the textbook vectors: Caesar shift-3 `HELLO→KHOOR`,
   ROT13 as its own inverse, Vigenère `ATTACKATDAWN`/`LEMON`/`LXFOPVEFRNHR`.
2. **The unification law** — `caesar(s) === vigenere(keyForShift(s))` for all 26
   shifts, encrypt and decrypt.
3. **Round-trip laws** — `decrypt(encrypt(x)) === x` over 400 random texts for
   Caesar and Vigenère, and over full Unicode (emoji, CJK, combining marks) for
   Vernam.
4. **The attacks work** — `crackVigenere` recovers the exact key and plaintext
   from a Hamlet passage with no key given; Caesar brute force puts the English
   plaintext in row one; IoC separates English from ciphertext.
5. **The two-time pad leak** — `C1 ⊕ C2 === P1 ⊕ P2`, verified against an
   independent XOR of the plaintexts, and shown to be non-trivial.
6. **Guardrails** — a too-short Vernam key is refused, a Vigenère key with no
   letters is refused, a key exactly the message length is accepted.

## Files

| File | What's in it |
| --- | --- |
| `ciphers-core.js` | The DOM-free engine: one Vigenère core, Caesar as its special case, Vernam over bytes, and the attacks (IoC, chi-squared crack, two-time pad). |
| `index.html` | The four-tab playground. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — wires the tabs to the engine, renders results. |
| `tests.js` | 81 dependency-free checks, run under Node. |

## A warning worth repeating

Caesar and Vigenère are **not secure** and haven't been for over a century —
this page breaks them itself. Even Vernam is only secure under conditions
(random key, used once, kept secret) that are hard to meet in practice. This is a
teaching toy. Never protect anything real with any of it; use vetted modern
cryptography.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
