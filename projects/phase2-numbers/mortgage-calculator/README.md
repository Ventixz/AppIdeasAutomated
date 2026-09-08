# Mortgage Calculator

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
seventh entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/) and
[Tile Cost Calculator](../tile-cost-calculator/).

> "Calculate the monthly payment of a fixed-term mortgage over given fixed
> interest rate and principal."

Open `index.html` in a browser. **No build step, no server, no dependencies** —
one HTML page and two scripts. Enter a loan amount, an annual rate, a term and a
payment frequency (and optionally an extra principal payment); it returns the
monthly payment, the total interest, and the full amortization schedule.

## Why this isn't a one-liner

Every mortgage calculator prints the same textbook formula for the level
payment:

```
        P · i · (1 + i)ⁿ
M  =  ────────────────────       i = periodic rate,  n = number of payments
        (1 + i)ⁿ − 1
```

Typed into a calculator that's fine. As the thing a lender actually bills, it's
incomplete twice over:

1. **A lender bills whole cents, and interest compounds on the rounded
   balance.** `M` almost never comes out to an exact number of cents, so it gets
   rounded — and once it is, those level payments no longer amortize the loan
   *exactly*. After 359 identical payments the 360th is a few cents different,
   and the "total interest" on the disclosure is the **sum of 360 individually
   cent-rounded interest charges**, not `P·n·`anything. You only get the right
   figure by *running* the schedule month by month: interest on the current
   balance rounded to the cent, principal = payment − interest, repeat, with the
   final payment trimmed so the balance lands on **exactly $0.00**.
2. **Money and rates are decimals, and floating point gets decimals wrong.**
   `$300,000`, `6.5%`, `$1,896.20` — in IEEE-754 doubles, `0.1 + 0.2` is
   `0.30000000000000004`, and a fraction of a cent per month becomes real error
   across 360 months. Every value here is an **exact rational** — a `BigInt`
   numerator over a `BigInt` denominator — including `(1 + i)ⁿ`, which is exact
   because `i` is. Nothing rounds until the one place a lender rounds: each
   month's interest, to the cent.

## What it computes

- **The scheduled (level) payment** — the formula above, evaluated exactly, then
  rounded to the cent. A `0%` loan is handled as its own case: just `P / n`.
- **A real amortization schedule** — every row is `payment = interest +
  principal`, interest is `roundCents(balance × i)`, and the balance strictly
  decreases to exactly zero. The **final payment differs** from the level one by
  the accumulated rounding drift — that difference is the whole point.
- **Total interest and total paid** — summed from the actual rows, so they
  reflect the cents a borrower really pays.
- **Extra principal payments** — add a fixed amount each period and the loan pays
  off early; the schedule shows how many payments you save and how much interest.
  For `$300k / 6.5% / 30 yr`, an extra `$300/mo` cuts the term from **360 to 250
  payments** and the interest from **~$382,637 to ~$247,519**.
- **Any payment frequency** — monthly, biweekly, quarterly or annual, as long as
  `years × payments-per-year` is a whole number of payments.

## How the core works

All the arithmetic lives in [`mortgage-core.js`](./mortgage-core.js), which is
DOM-free, console-free and I/O-free, so the identical file runs in the browser
and under Node for the tests.

- **`Fraction`** — an exact rational over `BigInt`, always reduced, with
  `add / sub / mul / div / cmp`, a `pow(k)` (exponentiation by squaring, for
  `(1+i)ⁿ`) and a half-up `toFixed(places)` for display.
- **`roundCents(f)`** — the one money primitive: round an exact fraction of
  dollars to the nearest cent, half-up, and return it as an **exact** `cents/100`
  rational so it keeps flowing through exact arithmetic. This is what a lender
  does every month.
- **`scheduledPayment(P, i, n)`** — the level payment as an exact rational, with
  the `i = 0` case split out.
- **`amortize(input)`** — the single entry point the UI and tests call. It takes
  the raw strings, computes and cent-rounds the payment, then runs the schedule
  to a zero balance and returns exact `Fraction`s/`BigInt`s plus a full schedule
  and pre-formatted strings.

`index.html` + `script.js` are only a thin form and table over that core.

## Tests

A dependency-free suite covers the exact-arithmetic traps (`0.1 + 0.2 === 0.3`,
half-up cent rounding, exact `pow`), the classic worked example (`$100k / 6% /
30 yr → $599.55`, 360 payments, ~$115,838 interest), the properties that make a
mortgage *not* the textbook formula (balance ends at exactly `$0.00`, the final
payment differs from the level one, principal portions sum to the loan, interest
portions sum to the reported total), the `0%` case, extra-payment acceleration,
and input validation. It then leans on an **invariant sweep**: for 300 random
loans it checks the schedule against its own *definition* — every interest
charge equals `roundCents(previous balance × i)`, every row balances to the
cent, and the balance reaches exactly zero without ever overshooting — verifying
the models independently of the arithmetic that produced them:

```bash
node projects/phase2-numbers/mortgage-calculator/tests.js   # -> 35 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
