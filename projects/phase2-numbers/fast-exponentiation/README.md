# Fast Exponentiation

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
twenty-second entry of its **Numbers** category, following
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
[Alarm Clock](../alarm-clock/),
[Distance Between Two Cities](../distance-between-cities/),
[Credit Card Validator](../credit-card-validator/),
[Tax Calculator](../tax-calculator/),
[Factorial Finder](../factorial-finder/),
[Complex Number Algebra](../complex-number-algebra/),
[Happy Numbers](../happy-numbers/),
[Number Names](../number-names/),
[Coin Flip Simulation](../coin-flip/) and
[Limit Calculator](../limit-calculator/).

> "Fast Exponentiation — quickly calculate exponential values using the
> squaring method."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. Type a base and an
exponent and it raises one to the other by **squaring and multiplying** along
the exponent's binary digits, shows the whole ladder, counts the multiplications
it saves versus the naïve loop, and — if you give it a modulus — takes the power
**mod m** without ever forming the giant number.

## What it does

- **Exponentiation by squaring, over BigInt.** Arbitrary-precision integers, so
  `2^1000` (302 digits) is exact and instant.
- **Shows its work.** Every square and every multiply is listed in order, tagged
  to the exponent's binary digit that triggered it.
- **Counts the win.** It reports the fast method's multiplication count beside
  the naïve `base × base × …` count — e.g. **14 vs 999** for `2^1000` — so the
  payoff is a number, not a claim.
- **Modular exponentiation.** Give it a modulus and it reduces after every step,
  so `7^1000000 mod 13` is immediate even though `7^1000000` has over 800,000
  digits. This is the exact operation behind RSA and Diffie–Hellman.
- **A second payoff: Fibonacci in O(log n).** The same trick applied to a 2×2
  matrix computes `F(n)` in a handful of matrix multiplies. `F(1,000,000)` — a
  208,988-digit number — comes out in under 60 matrix multiplies.

## The interesting part: exponent bits *are* the algorithm

Raising `b` to `e` looks like it needs `e − 1` multiplications. It doesn't. Write
`e` in binary and the work falls out of the digits themselves. Scan them from the
most significant down, keeping a running result: at **every** digit, square the
result; at every **1** digit, also multiply by the base.

```js
// projects/phase2-numbers/fast-exponentiation/fastexp-core.js
var result = reduce(base);            // the leading bit is always 1 — seed with base
for (var i = 1; i < bits.length; i++) {
  result = reduce(result * result);   // every bit: square
  if (bits[i] === 1) {
    result = reduce(result * base);   // a 1-bit: also multiply by the base
  }
}
```

For `13 = 1101₂` that's: seed with `3` (the leading 1-bit), then for the
remaining bits `1, 0, 1` — **square & multiply**, **square**, **square &
multiply** — giving 3 squarings and 2 multiplies for `3^13`. The trace in the
app makes the exact sequence visible. The cost is about `log₂(e)` squarings plus one multiply per 1-bit,
roughly `2·log₂(e)` operations instead of `e − 1`. The naïve cost grows with the
exponent; the fast cost grows only with its *number of digits*.

## Modular exponentiation: keeping the numbers small

The single change that makes cryptography practical is reducing `mod m` after
every operation:

```js
var reduce = function (x) { return mod == null ? x : ((x % mod) + mod) % mod; };
```

Now no intermediate value ever exceeds `m²`, so raising a number to a
thousand-bit secret exponent never forms the astronomically large true power —
it only ever juggles numbers the size of the modulus. The convergence trace in
the app shows every value staying below `m` the whole way.

## Fibonacci, from the same idea

Because

```
[[1, 1], [1, 0]] ^ n  =  [[F(n+1), F(n)], [F(n), F(n-1)]]
```

raising that 2×2 matrix by fast exponentiation yields `F(n)` in `O(log n)`
matrix multiplies rather than `n` additions. It's a good reminder that "fast
exponentiation" isn't about numbers — it's about *any* associative operation:
plug in matrix multiply and you get logarithmic-time linear recurrences for free.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Structure and copy — the inputs, the result panel, the multiplication comparison, the square-and-multiply trace, the Fibonacci bonus, and the "how it works" note. |
| `style.css` | The dark theme shared across the routine's projects. |
| `fastexp-core.js` | The DOM-free brain: square-and-multiply over BigInt, modular exponentiation, the multiplication counter, and 2×2 matrix power for Fibonacci. |
| `script.js` | The thin UI layer. Reads the inputs, calls the core, paints the result and the trace. No exponentiation math of its own. |
| `tests.js` | A dependency-free suite (280 checks) run with Node. |

## Running the tests

```bash
node projects/phase2-numbers/fast-exponentiation/tests.js
```

The suite checks all four layers: the plain power against JavaScript's own `**`
(including a 302-digit `2^1000` and negative bases), the step trace's squaring /
multiply counts, modular exponentiation (with **Fermat's little theorem** —
`a^(p−1) ≡ 1 (mod p)` — across several primes, and a check that every modular
step stays below the modulus), the multiplication counter cross-checked against
the actual trace for every exponent up to 200, and the matrix-powered Fibonacci
against an independent iterative computation.

## Design notes

- **The core never touches the DOM.** `fastexp-core.js` has no `window`,
  `document` or `fetch`, so the numbers the UI shows are exactly the numbers the
  tests prove. `script.js` only reads inputs and paints.
- **BigInt everywhere.** Powers overflow `Number` almost immediately
  (`2^53` already loses precision), so every value is an arbitrary-precision
  BigInt. That's why the results are exact rather than "close".
- **The trace is honest about work.** The leading 1-bit seeds the result with
  the base instead of doing a pointless "square 1, then multiply", so the
  squaring / multiply counts reflect the operations actually performed — and
  match the standalone counter to the digit.
- **One idea, two demos.** Modular exponentiation and matrix Fibonacci are the
  same square-and-multiply skeleton over two different operations, which is the
  real lesson: fast exponentiation generalises to anything associative.
