# Credit Card Validator

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
fourteenth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/),
[Tile Cost Calculator](../tile-cost-calculator/),
[Mortgage Calculator](../mortgage-calculator/),
[Change Return Program](../change-return/),
[Binary to Decimal and Back Converter](../binary-decimal-converter/),
[Calculator](../calculator/),
[Unit Converter](../unit-converter/),
[Alarm Clock](../alarm-clock/) and
[Distance Between Two Cities](../distance-between-cities/).

> "Credit Card Validator — Given a credit card number, determine if it is a
> valid number."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. Type a card number
and it tells you, in real time, whether it passes the checksum, which network it
belongs to, and whether the length is right.

> ⚠️ **This validates structure, not an account.** Passing every check here means
> the number is *well-formed* — it satisfies the Luhn checksum and matches a real
> network's prefix and length. It does **not** mean the card exists, was issued,
> or has funds. Only the issuing bank knows that. Every number shown in this
> project is a standard published **test** number or a generated fake; none is a
> real card, and nothing you type is ever sent anywhere.

## What it does

- **Luhn check** — the checksum every card number carries, computed live.
- **Network detection** — Visa, Mastercard, American Express, Discover, Diners
  Club, JCB, UnionPay and Maestro, from the leading digits (the IIN/BIN).
- **Length check** — each network only issues certain lengths; a right-prefix,
  wrong-length number is flagged.
- **Card-style formatting** — grouped the way it's printed on the physical card
  (Amex is `4-6-5`, Diners `4-6-4`, most others `4-4-4-4`).
- **Masking** — a `•••• •••• •••• 1234` "stored form" that keeps only the last
  four digits.
- **Fake number generator** — produce a Luhn-valid, correctly-shaped, entirely
  made-up number for any network, so you can see a "valid" result without ever
  touching a real card.

## The interesting part: a checksum designed to catch human typos

The core of this task is one small, elegant piece of arithmetic — the **Luhn
algorithm**, patented by Hans Peter Luhn at IBM in 1960 — and the interesting
thing is *what it was designed to catch*. It isn't cryptography and it stops no
fraud. It's a **check digit** whose entire job is to catch the mistakes a
*human* makes reading a number off a card and typing it in. None of it needs the
DOM, a network or any real card data, so all of it lives in
[`card-core.js`](./card-core.js), which is DOM-free, I/O-free and console-free,
so the suite can prove its properties without a browser.

### `luhnChecksum(digits)` — the algorithm

Walking the digits right-to-left, every second one is doubled; if a doubled
value goes over 9 you sum its two digits (equivalently, subtract 9). Add
everything up, and a **valid number totals a multiple of ten**. The doubling
uses a tiny lookup table (`[0,2,4,6,8,1,3,5,7,9]`) rather than an inline
`d*2>9 ? d*2-9 : d*2`, so the one place a hand-written version tends to go wrong
simply can't.

### `luhnCheckDigit(partial)` — the exact inverse

Given a number *without* its final digit, this returns the single digit that
makes the whole thing valid. It's how a real number is built (the last digit is
never chosen freely — it's computed), and it's how this project's `generate()`
finishes a fake. The tests round-trip it against the checksum thousands of times:
for any body of digits, `isValidLuhn(body + luhnCheckDigit(body))` is always
true.

### Why it's a *good* checksum — and its one blind spot

The property tests demonstrate the two facts that made Luhn worth standardising:

- **Every single-digit typo is caught.** Change any one digit to any other and
  the checksum always changes — the suite verifies this over 500 numbers.
- **Almost every adjacent transposition is caught.** Swap two neighbouring
  digits — the single most common data-entry error — and Luhn catches it *every
  time except the pair `09 ↔ 90`*. That exception is a genuine, well-known
  limitation of the algorithm, and the test asserts it precisely: zero missed
  transpositions *other than* `0`/`9`.

### `detectNetwork()` — labelling, independent of validity

Networks are recognised purely by their published **IIN ranges** (Visa starts
with `4`; Mastercard is `51–55` or the newer `2221–2720`; Amex is `34`/`37`; and
so on). Detection deliberately does **not** require the length to be right or the
Luhn check to pass, because you want to name a number's network *while it's still
being typed*. `validate()` layers the length and checksum on top, so a
`4111 1111 1111 111` (a Visa prefix, wrong length) is correctly reported as
"Visa, but the wrong number of digits".

### `generate()` — a valid number without a real card

Fill a network's real prefix, pad the middle with random digits, append the
computed check digit. The result passes every check this validator applies — and
is guaranteed *not* to be a real card. Its randomness is injectable, so the tests
generate deterministically and then assert that 1000 generated numbers all
validate.

`index.html` + `script.js` are only a thin layer over that core: one input, a
pass/fail badge, the three sub-checks (Luhn, network, length) shown separately so
you can see *why*, and a masked "stored form".

## Tests

A dependency-free suite exercises the core without a browser:

- **Luhn checksum** — known good and bad test numbers, tolerance of spaces and
  dashes, the classic `79927398713` example, and rejection of empty/non-digit
  input.
- **Check digit** — the inverse property over 2000 random bodies.
- **Network detection** — every network from its published prefixes, the
  Mastercard 2-series boundaries (`222100`–`272099` in, just outside out), and
  detection working on partial and Luhn-failing numbers.
- **Length & `validate()`** — every test number validates cleanly; wrong-length
  and unknown-network numbers are rejected with the right error.
- **Formatting & masking** — `4-4-4-4`, Amex `4-6-5`, Diners `4-6-4`, custom
  separators, and last-four masking that keeps the grouping.
- **`generate()`** — every network's fake validates and re-detects; 1000
  generated Visas all pass.
- **Two property sweeps** — every single-digit typo breaks Luhn, and every
  adjacent transposition except `0↔9` is caught.

```bash
node projects/phase2-numbers/credit-card-validator/tests.js   # -> 128 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
