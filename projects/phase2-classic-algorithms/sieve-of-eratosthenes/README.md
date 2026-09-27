# Sieve of Eratosthenes

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**fourth entry of its Classic Algorithms category**, and the twenty-sixth
Source 2 project overall. It follows the
[Closest Pair of Points](../closest-pair/) build.

> "Sieve of Eratosthenes — the sieve of Eratosthenes is a simple, ancient
> algorithm for finding all prime numbers up to any given limit."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

- **Sieves a grid of numbers, step by step.** Pick a limit _n_ (10–600) and
  watch the classic sieve run: each prime lights **green**, then turns
  **purple** as it strikes out its own multiples, which flash **amber** the
  instant they're crossed and settle to a dim struck-through **composite**.
- **Races four algorithms on the same _n_.** A table shows each one's
  **operation count** (division tests, or cross-outs) and wall-clock time. At
  _n_ = 600 trial division does thousands of division tests where the sieve does
  a few hundred cross-outs — the complexity gap as a number, not a claim.
- **Two prime tools.** Factorise any number into prime powers (via a
  smallest-prime-factor table the linear sieve builds for free), and count the
  primes below any _n_ with π(_n_).

## Four algorithms, and what each one teaches

**Trial division — O(n·√n / ln n).** For each _k_, test divisors up to √_k_.
Obviously correct, which is exactly why the tests use it as the oracle — and why
it's the slow baseline the others are measured against.

**Sieve of Eratosthenes — O(n log log n).** The star. Walk the numbers; the
first time you reach one still unmarked, it's prime, so cross out its multiples.
The two details that make it fast (and that a naive version gets wrong):

> - **Start crossing at _p²_, not _2p_.** Every smaller multiple of _p_ already
>   carries a smaller prime factor and was crossed on that factor's turn.
>   Starting at _p²_ is the difference between _n log log n_ and _n log n_ work.
> - **Only sieve _p_ up to √_n_.** Once _p_ > √_n_, _p²_ > _n_, so nothing is
>   left in range to cross. A number ≤ _n_ with no prime factor ≤ √_n_ is prime.

```js
// projects/phase2-classic-algorithms/sieve-of-eratosthenes/sieve-core.js
for (var p = 2; p <= n; p++) {
  if (composite[p]) { continue; }     // survived => prime
  primes.push(p);
  if (p * p <= n) {                    // nothing to cross once p > √n
    for (var m = p * p; m <= n; m += p) {   // start at p², not 2p
      composite[m] = 1; t.cross(m, p);
    }
  }
}
```

**Euler's linear sieve — O(n).** The clever cousin. By crossing _k·p_ only for
primes _p_ ≤ smallest-prime-factor(_k_) and stopping the instant _p_ divides
_k_, **every composite is crossed exactly once** — as
`(c / spf(c)) · spf(c)`. So the total cross-out count equals the number of
composites ≤ _n_, the run is genuinely linear, and it hands you a
smallest-prime-factor table as a side effect (that's what powers the factoriser).

**Segmented sieve — same answer, O(√n) memory.** Sieve the base primes up to
√_n_, then sweep [2, _n_] in fixed-size windows, crossing each base prime's
multiples inside the current window. Only one segment-sized array and the base
primes ever live in memory — how you'd sieve up to 10¹² without a 10¹²-entry
array. The cross-out pattern (and count) matches the plain sieve exactly; only
the footprint changes.

## Make the *work* visible, not just the answer

As in this project's sibling builds, every "cross out this number" and every
"test this divisor" routes through a single small **Tracker** that counts
operations. Because the sieves share the same instrumented primitive, their
counts are directly comparable — that's what turns the textbook complexity gap
into something you read off the table. The tracker can also record a frame per
operation, and that exact same run drives the grid animation: the UI just
replays the frames.

A worth-knowing contrast the counts make concrete: the **classic** sieve
re-crosses any number with several prime factors (12 is crossed by both 2 and
3), while the **linear** sieve crosses each composite once. So at _n_ = 100,000
the linear sieve does exactly `(n − 1) − π(n)` cross-outs and the classic sieve
does more — but both stay within a small constant of _n_, which is the whole
point of _log log n_.

## Tests

`tests.js` is a dependency-free suite (28 checks) that leans on an independent
trial-division oracle. Run it with Node:

```bash
node projects/phase2-classic-algorithms/sieve-of-eratosthenes/tests.js
```

It verifies:

1. **Hand-checked tiny cases** and degenerate inputs (_n_ = 0, 1, negative)
   don't throw and return the right primes.
2. **Known π(n) values** — π(10)=4, π(100)=25, π(1000)=168, π(10⁴)=1229,
   π(10⁵)=9592.
3. **All four algorithms match the oracle** across many sizes, including perfect
   squares and prime limits, and **all agree with each other** in `race()`.
4. **Segment boundaries** — the segmented sieve is correct for many awkward
   segment sizes (1, 2, 3, 7, 13, …), the classic off-by-one trap.
5. **The complexity gap is real** — the sieve does under 10% of trial division's
   work at _n_ = 10⁵.
6. **The linear sieve crosses each composite exactly once** (cross-outs =
   `(n−1) − π(n)`), and the classic sieve does strictly more but stays within a
   small constant of _n_.
7. **The start-at-p² optimisation is actually in effect** — every recorded
   cross-out _k_ satisfies _k_ ≥ _p²_.
8. **Recorded frames are consistent** — announced primes match the returned
   list, nothing is both prime and crossed, every composite is crossed.
9. **The spf table and factoriser** — `spf[p] = p` for primes, a real prime
   divisor for composites, and `factorize()` reproduces each number as a product
   of prime powers.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The visualiser: controls, the number grid, the race table, prime tools. |
| `style.css` | Dark theme, the CSS-grid of number cells, race table. |
| `sieve-core.js` | Trial division + three sieves, the shared Tracker, `run`/`race`, `factorize`, `primeCount`. UMD-ish: works under Node and as a browser global. |
| `script.js` | DOM controller — replays recorded frames as the grid animation. |
| `tests.js` | The Node test suite described above. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
