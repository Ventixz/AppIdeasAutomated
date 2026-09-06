# Next Prime Number

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
fifth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/) and
[Prime Factorization](../prime-factorization/).

> "Next Prime Number — Have the program find prime numbers until the user
> chooses to stop asking for the next one."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Type any whole number and it shows the smallest
prime greater than it, the gap it jumped, and the prime just below, e.g. for
`89` → **97** *(gap of +8, previous prime 89)*.

## Why this isn't a one-liner

The obvious version — "start at `n+1`, and for each candidate divide by every
number up to `√candidate` until one is prime" — is correct but breaks as a
general "enter a number" tool for two reasons:

1. **Precision.** A JavaScript `number` is a 64-bit float and loses integer
   exactness past `2⁵³ − 1` (16 digits). "The next prime after this" is a
   question you naturally ask of much bigger numbers, and a float silently gives
   the wrong answer there — the candidate you test stops being the candidate you
   meant. Every value here is a **`BigInt`**: exact and unbounded, with no
   floating-point value used anywhere in the maths.
2. **Speed.** Testing each candidate by trial division to `√candidate` costs
   ~`√n` operations *per candidate*; for a 30-digit `n` that's ~10¹⁵ divisions
   before you even finish rejecting one composite. That's the wrong algorithm.

So the core uses a **deterministic Miller–Rabin** primality test — polylogarithmic
per candidate instead of `√n` — and steps candidates along a **2·3·5 wheel** so it
never even tests the 73% of integers that are obviously divisible by 2, 3 or 5.
The two together factor out both costs: a 40-digit input answers in single-digit
milliseconds.

## How the core works

All the number theory lives in [`nextprime-core.js`](./nextprime-core.js), which
is DOM-free, console-free and I/O-free, so the exact same file runs in the
browser and under Node for the tests.

- **`nextPrime(n)`** → the smallest prime strictly greater than `n`, for any
  `BigInt` (negatives included — `nextPrime(-5)` is `2`). It snaps to the
  enclosing multiple of 30 and walks the **wheel** of the eight residues mod 30
  that can be prime (`1, 7, 11, 13, 17, 19, 23, 29`), skipping 22 of every 30
  integers. Consecutive prime gaps near `n` average ~`ln n`, so only a handful
  of candidates are ever tested — even for 100-digit inputs.
- **`isProbablePrime(n)`** → primality. It first **trial-divides by the primes
  below 1000** (built once by a small sieve, not pasted by hand), which rejects
  almost every composite in a few cheap operations, then runs **deterministic
  Miller–Rabin**. With the fixed witness set of the first 12 primes, the test is
  **provably exact for every n below ~3.3 × 10²⁴** — well past anything a person
  types — and a strong probabilistic test beyond that. It correctly rejects
  Carmichael numbers (561, 41041, …) that fool the naive Fermat test.
- **`prevPrime(n)`** → the largest prime strictly below `n` (or `null` when none
  exists), the mirror of `nextPrime`, used to show the interval the answer sits
  in.
- **`nextPrimes(n, count)`** → the next `count` primes after `n`, in order — the
  "keep asking for the next one" loop from the brief, in one call.
- **`powmod(base, exp, m)`** → modular exponentiation by squaring, the engine of
  Miller–Rabin, kept exact with `BigInt` throughout.

`index.html` + `script.js` are only a thin UI over that core: an input, example
chips, the gap-and-neighbour context line, and a copy button.

## Tests

A dependency-free suite checks hand-verifiable next/previous primes and known
primes, Mersenne primes and Carmichael numbers, then leans on the defining
**invariant**: for 300 random inputs, `nextPrime(n)` must be prime, strictly
greater than `n`, and *minimal* — every integer between `n` and the result is
verified composite, so no prime was skipped. That proves the answer independently
of *how* it was computed. It also confirms exact large cases (the next primes
after `10¹⁸` and `2⁶⁴`) and a famous prime gap (after `370261` the next prime is
`370373`):

```bash
node projects/phase2-numbers/next-prime-number/tests.js   # -> 53 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
