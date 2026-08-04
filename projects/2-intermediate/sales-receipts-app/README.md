# Sales Receipts — Point of Sale

A tiny, frontend-only point-of-sale terminal. Tap items to ring up a sale, watch
the running total, and press **Checkout** to save the receipt straight into the
browser's own **IndexedDB**. Pull the day's takings back up at any time with
**Daily Sales** — no server, no accounts, works fully offline.

Per the spec, the browser database holds **no confidential or personally
identifiable information** — only item numbers, descriptions, prices, an optional
free-text customer label, and a timestamp.

Source idea: [app-ideas / Sales Receipts (Sales-DB-App)](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Sales-DB-App.md)

## Running

Open `index.html` in any modern browser — no build step, no dependencies, no
network:

```bash
open projects/2-intermediate/sales-receipts-app/index.html
```

IndexedDB persists per-origin, so opening the file again shows the sales you
saved earlier. **Clear All** wipes the stored receipts.

## How to use

1. **Tap items** in the Purchase panel to add them to the current sale. Tapping
   the same item again bumps its quantity.
2. The **Receipt** panel lists every line and keeps a **running total**.
3. Optionally type a **customer name** (defaults to *Guest*).
4. **Clear Entry** removes the most recently added unit; **Cancel All** empties
   the whole pre-checkout sale.
5. **Checkout** stores the receipt in IndexedDB and resets the panel for the next
   customer.
6. **Show Daily Sales** lists every stored receipt with a grand total; **Clear
   All (wipe DB)** deletes them after a confirmation.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Purchase panel with item buttons (number, description, price) | `buildGrid()` in `script.js`, styled `.item-grid` |
| Click items to add to the purchase | item-button `click` → `ReceiptCore.addItem` |
| Running total of the sale | `renderCart()` → `ReceiptCore.totalCents` |
| Receipt panel with date/time and selected items | `.receipt-panel` + `#receipt-time` |
| Clear button removes purchases before checkout | **Cancel All** → `ReceiptCore.cancelAll` |
| Checkout finalizes, stores to DB, clears the panel | `checkout()` → `ReceiptDB.addReceipt` |
| Daily Sales shows all purchases with a total | `showDailySales()` → `ReceiptDB.getAllReceipts` + `summarize` |
| Clear All empties the panel and deletes DB records | `clearDatabase()` → `ReceiptDB.clearAll` |

### Bonus features (all implemented)

| Bonus | Where it lives |
| --- | --- |
| Item thumbnail images on the buttons | emoji `.item-thumb` (offline, no network) |
| Split Clear into **Clear Entry** + **Cancel All** | two buttons in `.actions` |
| Clear Entry removes the last selected item | `ReceiptCore.clearEntry` |
| Cancel All clears the pre-checkout purchase | `ReceiptCore.cancelAll` |
| Customer name associated with the purchase | `#customer` → `ReceiptCore.buildReceipt` |

## Design notes

- **Logic is separated from the DOM and from storage.** All the money and cart
  math lives in [`receipt-core.js`](./receipt-core.js) as pure functions;
  [`db.js`](./db.js) is a thin Promise wrapper over IndexedDB; and
  [`script.js`](./script.js) only reads the form, calls those two, and paints the
  result. That split is what makes the logic unit-testable without a browser.
- **Money is integer cents.** Prices are converted to whole cents on the way in
  and only formatted back to dollars at the edges, so totals never accumulate
  floating-point error (the classic `0.1 + 0.2` trap is covered by a test).
- **Immutable cart updates.** `addItem` / `clearEntry` return a *new* cart rather
  than mutating in place, so state changes are easy to reason about and to test.
- **Safe rendering.** Receipt lines and report cards are built from text nodes
  and elements, never string-concatenated HTML, so a customer name can't inject
  markup.
- **Purity for testability.** `buildReceipt` takes the timestamp as an argument
  instead of reading the clock, which keeps it deterministic under test.

## Tests

`tests.js` covers the cart math, immutability, `clearEntry`/`cancelAll`,
receipt building, the daily-sales roll-up, and the inventory's uniqueness
invariant. It runs two ways with **no dependencies**:

```bash
# standalone (built-in mini test runner)
node projects/2-intermediate/sales-receipts-app/tests.js

# or under Jest, unchanged, if you have it installed
npx jest projects/2-intermediate/sales-receipts-app/tests.js
```

```
All 16 tests passed.
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Three-panel layout: Purchase · Receipt · Daily Sales |
| `style.css` | Point-of-sale styling, responsive down to one column |
| `inventory.js` | The shop catalogue (unique item numbers, prices, emoji thumbnails) |
| `receipt-core.js` | Pure, testable cart + money logic (browser + Node) |
| `db.js` | Promise wrapper around IndexedDB for saved receipts |
| `script.js` | DOM wiring — turns taps into carts, carts into stored receipts |
| `tests.js` | Dependency-free, Jest-compatible test suite |
