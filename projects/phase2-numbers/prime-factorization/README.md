# Prime Factorization

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
fourth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/) and
[Fibonacci Sequence](../fibonacci-sequence/).

> "Prime Factorization — Have the user enter a number and find all Prime
> Factors (if they exist)."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Type any whole number and it shows the
factorization, e.g. `360 = 2³ · 3² · 5`, with a plain-text expansion and a copy
button.

## Why this isn't a one-liner

The textbook answer is: divide out 2, then try every odd number up to `√n`. That
is genuinely correct — and it's what this core does for the *small* factors — but
two things break it as a general "enter a number" tool:

1. **Factoring is hard.** Trial division to `√n` costs about `√n` divisions. For
   a 12-digit number that's ~10⁶ steps (instant); for a 20-digit semiprime it's
   ~10¹⁰ (a tab frozen for minutes). The difficulty of factoring large numbers
   is the whole reason RSA works — so a naive loop is not just slow, it's the
   wrong algorithm past a dozen digits.
2. **Precision.** A JavaScript `number` is a 64-bit float and loses integer
   exactness past `2⁵³ − 1` (16 digits). The number the user typed and the
   number being divided quietly stop being equal. Every value here is a
   **`BigInt`** — exact and unbounded — and no floating-point value is used in
   the maths.

So the core strips the small primes by trial division, then switches to
**Pollard's rho** (a randomised factoring algorithm) with a **Miller–Rabin**
primality test to know when a leftover chunk is itself prime and needs no further
splitting. That factors 18–20 digit numbers in milliseconds instead of minutes.

## How the core works

All the number theory lives in [`factor-core.js`](./factor-core.js), which is
DOM-free, console-free and I/O-free, so the exact same file runs in the browser
and under Node for the tests.

- **`factorize(n)`** → the factorization of a `BigInt` `n ≥ 1`, as an array of
  `[prime, exponent]` pairs (both `BigInt`) sorted by ascending prime.
  `factorize(1n)` is `[]` (1 is the empty product); `factorize(360n)` is
  `[[2n,3n],[3n,2n],[5n,1n]]`.
  1. **Trial-divide** every prime up to 100 000. This clears the common small
     factors cheaply and shrinks whatever's left.
  2. On the hard remainder, recurse: if `isProbablePrime(v)` it's a factor;
     otherwise `pollardRho(v)` splits it into two smaller pieces and both go back
     on the stack.
- **`isProbablePrime(n)`** → deterministic Miller–Rabin. With the fixed witness
  set of the first 12 primes, the test is **provably exact for every n below
  ~3.3 × 10²⁴** — well past anything a person types — and a strong probabilistic
  test beyond that. It correctly rejects Carmichael numbers (561, 41041, …) that
  fool the naive Fermat test.
- **`pollardRho(n)`** → one non-trivial factor of a composite `n`, using the
  `x ↦ x² + c (mod n)` iteration with Floyd cycle detection. It finds a factor
  `p` in roughly `√p` steps rather than `√n`, and retries with a fresh constant
  `c` if a run degenerates.
- Supporting exact-integer helpers: `powmod` (modular exponentiation by
  squaring), `gcd` (Euclid), `isqrt` (Newton), and `product` / `formatFactorization`
  for turning pairs back into a number or a `"2^2 * 3"` string.

`index.html` + `script.js` are only a thin UI over that core: an input, example
chips, superscript rendering, the flat `= 2 × 2 × 3` expansion, and a copy
button.

## Tests

A dependency-free suite checks hand-verifiable factorizations, then leans on the
**fundamental invariant** — the product of the returned factors must equal the
input — across 400 random ~12-digit numbers, so correctness is proven
independently of *how* the answer was computed. It also confirms every returned
factor is prime, factors a 22-digit semiprime (two 10-digit primes) that would
hang trial division, checks large primes come back as themselves, and spot-checks
Miller–Rabin against known primes, Mersenne primes and Carmichael numbers:

```bash
node projects/phase2-numbers/prime-factorization/tests.js   # -> 33 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
