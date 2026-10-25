# Product Inventory

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**first entry of its Classes (Object-Oriented Programming) category**, and so
the first project of a new category after the seven-project
[Networking](../../phase2-networking/) run.

> "Create an application which manages an inventory of products. Create a product
> class which has a price, ID, and quantity on hand. Then create an inventory
> class which keeps track of various products and can sum up the inventory value."

Open `index.html` to drive a live stock table — add products, receive and ship
stock, and watch the total inventory value update — or run `node inventory-node.js`
for the same classes behind a CLI. No build step, no dependencies.

## The point of this one is the design

The Classes category isn't about features; it's about objects that are correct
by construction. "A product has a price, an id and a quantity; an inventory
holds products and sums their value" is one sentence, and it hides three things
a naïve version gets wrong. The engine ([`inventory-core.js`](./inventory-core.js))
is built around them.

### 1. Money is integer cents, never a float

`0.1 + 0.2` is `0.30000000000000004`, and an inventory's whole job is to add
prices up — once per line item, every time you ask for the total. Store prices
as floating-point dollars and the headline number drifts the moment the
catalogue is big enough. So a `Product` stores **`priceCents`, an integer**;
dollars exist only at the edges, parsed on the way in and formatted on the way
out (`Money.parse` / `Money.format`). Totalling is plain integer addition, exact
for any number of line items. The test suite proves the classic trap is gone:

```
3 × $0.10 is exactly $0.30 (30 cents), formatted "$0.30" — not "$0.30000000000000004"
```

### 2. The invariants live in the class, not in the caller

An object worth making a class is one that **cannot be put into a bad state**:

- You can't construct a `Product` with a negative price, a fractional or
  negative quantity, or a blank id/name — the constructor rejects it.
- `quantity` is a **getter with no setter**. The only ways to move stock are
  `receive(n)` and `ship(n)`, and `ship` **refuses to oversell** — it throws
  naming the shortfall rather than letting the count go negative:

  ```
  cannot ship 999999 of A-100 — only 240 on hand
  ```

The browser demo, the CLI, and the tests all hit that same guard, because the
guard is in the object, not in any one front end.

### 3. The inventory is an aggregate with one index of truth

`Inventory` keeps its products in a `Map` keyed by id — one source of truth.
Adding a duplicate id is an **error**, not a silent overwrite that would strand
the old stock and make the totals lie. Every rollup — `totalValueCents()`,
`totalUnits()`, `lowStock(threshold)`, `byValue()` — is **derived from that one
Map on demand**, so the summary can never disagree with the line items you see.

## Files

| File | What it is |
| --- | --- |
| [`inventory-core.js`](./inventory-core.js) | The whole engine: `Money`, `Product`, `Inventory`, `InventoryError`. DOM-free, network-free. |
| [`inventory-fixtures.js`](./inventory-fixtures.js) | A sample catalogue (healthy, low, and sold-out stock) shared by all three front ends. |
| [`tests.js`](./tests.js) | 41 dependency-free checks: money round-trips, invariants, aggregate math, the float trap. |
| [`inventory-node.js`](./inventory-node.js) | A CLI front end — a report-and-total view plus a tiny REPL of inventory commands. |
| [`index.html`](./index.html) · [`script.js`](./script.js) · [`style.css`](./style.css) | The browser demo: a live stock table over the same classes. |

## Run it

```bash
node tests.js                 # the engine's proof suite (41 checks)
node inventory-node.js        # demo catalogue: stock report + total value
node inventory-node.js --json # the same, as JSON

# drive it with commands (also works interactively, and over a pipe):
echo "add Z-1 'Standing Desk' 149.99 10; ship A-100 50; value" | node inventory-node.js
```

Then open `index.html` in a browser for the interactive version.

## One engine, three front ends

`inventory-core.js` exports the classes and touches nothing outside itself — no
DOM, no clock, no I/O. The CLI binds them to `stdin`/`stdout`, the demo binds
them to a table and a form, and the tests drive them with fixed data. The rules
only exist in one place, so the three can't drift apart.

---

*Part of [AppIdeasAutomated](../../../README.md) — one project built per day by
an automated Claude Code routine. This is Phase 2, Classes category, project 1.*
