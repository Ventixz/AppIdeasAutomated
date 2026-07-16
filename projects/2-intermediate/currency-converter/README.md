# Currency Converter

Convert an amount from one currency to another using **live exchange rates**,
with instant results as you type. Falls back to a bundled rate snapshot so it
keeps working offline.

Source idea: [app-ideas / Currency Converter](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Currency-Converter.md)

## Running

Open `index.html` in any browser — no build, no dependencies:

```bash
open projects/2-intermediate/currency-converter/index.html
```

On load it fetches current rates from the free, key-less
[open.er-api.com](https://www.exchangerate-api.com/docs/free) endpoint. If that
request fails (no network, blocked), it quietly switches to an approximate
bundled snapshot and says so in the status line.

## How to use

1. Type an **amount** (up to 9 digits, decimals allowed).
2. Pick a **From** and **To** currency from the sorted dropdowns.
3. The converted value appears immediately, rounded to two decimal places,
   along with the unit exchange rate.
4. Hit the **⇄** button to swap the two currencies.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Input up to 9 digits for the amount | `parseAmount()` caps the digit count at 9 |
| Sorted dropdown for the source currency | `buildDropdowns()` sorts codes alphabetically |
| Sorted dropdown for the destination currency | same, second `<select>` |
| Live, two-decimal result on any change | `input`/`change` listeners → `convert()` + `Intl.NumberFormat` |
| Alert on non-numeric input | `parseAmount()` validation → inline `role="alert"` message |
| **Bonus:** swap source ⇄ destination | the **⇄** button → `swap()` |

## How the conversion works

All rates are stored relative to **1 USD**. To convert between any two
currencies the app goes through that base:

```
amountInUSD = amount / rate(from)
result      = amountInUSD * rate(to)
```

This keeps a single source of truth for rates and makes every pair a cheap
cross-rate calculation.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup: amount field, two dropdowns, swap button, result panel |
| `style.css`  | Dark, card-based responsive styling |
| `script.js`  | Rate fetching + offline fallback, validation, live conversion, swap |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 42 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
