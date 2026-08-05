# Simple Online Store — Corner Shop

A tiny, frontend-only storefront. Browse products as cards, open a product's
details, add things to a cart, tweak quantities, and **Place Order** to get a
confirmation number — all client-side, no server, no build step, and no real
charge. The cart survives a page reload, so unpurchased items are still there
when you come back.

Source idea: [app-ideas / Simple Online Store](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Simple-Online-Store.md)

## Running

Open `index.html` in any modern browser — no dependencies, no network:

```bash
open projects/2-intermediate/simple-online-store/index.html
```

The app is a small hash-router SPA, so every view has its own URL
(`#/products`, `#/cart`, `#/product/MUG-01`, …) that you can reload or bookmark.

## How to use

1. The **Landing Page** greets you with a **View Products** button and a
   **Shopping Cart** button (both also live in the top bar on every page).
2. On the **Products Page**, each product is a card with a thumbnail, name,
   price, short description, a **Details** button, and an **Add** button.
3. **Details** opens the product's own page: unique ID, full description, stock
   count, and **Add to Cart**. **Keep Browsing** returns you to the grid.
4. The **Shopping Cart** lists every line with its product ID, name, price and
   an editable **quantity** field. Changing a quantity recomputes the line
   subtotal and the grand **Total** live. **Remove** drops a line.
5. **Place Order** empties the cart and shows a **confirmation number**.
   **Cancel Order** clears the cart, and **Continue Shopping** returns to the
   grid with your cart intact.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| In-memory product inventory | [`catalog.js`](./catalog.js) — a plain array of product objects |
| *View Products* button on the Landing Page → Products Page | `renderLanding` → `#/products` in [`script.js`](./script.js) |
| Products as cards (thumb, name, price, blurb, button) | `productCard` in `script.js`, styled in [`style.css`](./style.css) |
| Product details: unique ID, extended description, add-to-cart, back | `renderDetail` (`#/product/:id`) |
| *Shopping Cart* button on Landing **and** Products pages | top bar in [`index.html`](./index.html) + in-page links |
| Cart shows ID, name, price, adjustable quantity | `renderCart` table |
| Total = Σ (quantity × unit price), updates dynamically | `cartTotal` in [`store-core.js`](./store-core.js) |
| *Place Order* → confirmation number | `placeOrder` + `confirmationNumber` |
| *Cancel Order* button | `cancelOrder` |
| Return to browsing with unpurchased items preserved | cart persisted in `localStorage` |

### Enhancements included

- **Inventory validation** — products carry a `stock` count; `addToCart` clamps
  quantities to what's available and the details view disables **Add to Cart**
  for out-of-stock items.
- **Money kept in cents** — every amount is an integer number of cents until the
  moment it's formatted, so totals never drift from floating-point rounding.

## Design notes

The logic and the DOM are kept apart. [`store-core.js`](./store-core.js) is a
pure module — a cart is just a `{ productId: qty }` map, and every operation
(`addToCart`, `setQuantity`, `cartTotal`, `placeOrder`, …) returns a **new**
cart instead of mutating in place. That immutability is what makes the whole
thing straightforward to test. [`script.js`](./script.js) is only wiring: it
turns clicks into core calls and renders the result.

The confirmation number is derived from the cart plus a caller-supplied seed
(the wall clock in the app), never from `Math.random()` inside core — so the
logic stays deterministic and testable.

## Tests

`tests.js` covers the cart math, immutability, stock clamping,
`setQuantity`/`removeFromCart`, money formatting, order placement, and the
catalog's uniqueness invariant. It runs two ways with **no dependencies**:

```bash
# standalone (built-in mini test runner)
node projects/2-intermediate/simple-online-store/tests.js

# or under Jest, unchanged, if you have it installed
npx jest projects/2-intermediate/simple-online-store/tests.js
```

```
All 13 tests passed.
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Shell: top bar, view container, script loading order |
| `style.css` | Storefront styling, responsive down to one column |
| `catalog.js` | The in-memory product inventory (unique ids, prices in cents) |
| `store-core.js` | Pure, testable cart + money + order logic (browser + Node) |
| `script.js` | Hash router + DOM wiring — clicks in, rendered views out |
| `tests.js` | Dependency-free, Jest-compatible test suite |
