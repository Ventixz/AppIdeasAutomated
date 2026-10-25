/*
 * inventory-core.js — the whole inventory engine as classes, DOM-free.
 *
 * The task ("Product Inventory Project") is the first of karan/Projects' Classes
 * category, and the point of that category is the *design*, not the feature
 * list. The one-sentence version — "a Product has a price, id and quantity; an
 * Inventory holds products and can sum their value" — hides the three things a
 * naive version gets wrong, and this engine is built around them:
 *
 *   1. MONEY IS INTEGER CENTS, never a float. `0.1 + 0.2 !== 0.3` in every
 *      language with IEEE-754 floats, and an inventory's whole job is to add
 *      prices up hundreds of times. A Product stores `priceCents` (an integer);
 *      dollars only ever appear at the edges, parsed in and formatted out
 *      (`Money.parse` / `Money.format`). Totalling is plain integer addition,
 *      so it is exact no matter how many line items there are.
 *
 *   2. THE INVARIANTS LIVE IN THE CLASS, not in the caller. You cannot build a
 *      Product with a negative price, a fractional quantity or a blank id, and
 *      you cannot reach in and set `quantity = -5`: stock only moves through
 *      `receive(n)` and `ship(n)`, and `ship` REFUSES to oversell rather than
 *      going negative. An object that can't be put into a bad state is the whole
 *      reason to reach for a class here.
 *
 *   3. THE INVENTORY IS AN AGGREGATE WITH ONE INDEX OF TRUTH. Products are keyed
 *      by id in a Map; adding a duplicate id is an error, not a silent
 *      overwrite that would strand the old stock. Every rollup (total value,
 *      unit count, low-stock report) is derived from that one Map, so the
 *      summary can never disagree with the line items.
 *
 * Nothing here touches the DOM, the clock or the network. `inventory-node.js`
 * drives these same classes from a CLI; `script.js` drives them in a browser;
 * `tests.js` drives them with fixed data. One engine, three front ends.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Errors — one named type so callers (and tests) can tell a rejected
 * operation from a genuine bug.
 * ------------------------------------------------------------------ */

class InventoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InventoryError';
  }
}

/* ------------------------------------------------------------------ *
 * Money — integer cents in, formatted dollars out. Kept as a flat
 * helper rather than a class because a cent amount IS just an integer;
 * wrapping every price in an object buys nothing and costs allocations.
 * ------------------------------------------------------------------ */

const Money = {
  // "12.34", "12", "$12.34", 12.34 -> 1234 cents. Rejects anything with
  // more than two decimal places or that isn't a number at all.
  parse(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new InventoryError('price must be a finite number');
      return Money.parse(value.toFixed(2));
    }
    if (typeof value !== 'string') throw new InventoryError('price must be a number or string');
    const cleaned = value.trim().replace(/^\$/, '').replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      throw new InventoryError(`"${value}" is not a valid price (use e.g. 12 or 12.34)`);
    }
    const [dollars, cents = ''] = cleaned.split('.');
    return Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  },

  // 1234 -> "$12.34". Handles the negative sign on the outside of the $.
  format(cents) {
    if (!Number.isInteger(cents)) throw new InventoryError('cents must be an integer');
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const dollars = Math.floor(abs / 100);
    const rem = String(abs % 100).padStart(2, '0');
    return `${sign}$${dollars.toLocaleString('en-US')}.${rem}`;
  },
};

/* ------------------------------------------------------------------ *
 * Product — price (in cents), id, quantity on hand, plus a name so the
 * demo reads like a real catalogue. The constructor is the only place a
 * Product's price or id is ever set; quantity changes go through methods.
 * ------------------------------------------------------------------ */

class Product {
  constructor({ id, name, price, quantity = 0 }) {
    const cleanId = String(id == null ? '' : id).trim();
    if (!cleanId) throw new InventoryError('product id is required');
    const cleanName = String(name == null ? '' : name).trim();
    if (!cleanName) throw new InventoryError(`product ${cleanId} needs a name`);

    this.id = cleanId;
    this.name = cleanName;
    this.priceCents = Money.parse(price);
    if (this.priceCents < 0) throw new InventoryError('price cannot be negative');

    this._quantity = 0;
    if (quantity) this.receive(quantity); // routes through the invariant check
  }

  get quantity() {
    return this._quantity;
  }

  // Deliberately no setter: the only ways to move stock are receive/ship,
  // so quantity can never be assigned a bad value from the outside.

  get price() {
    return this.priceCents;
  }

  set price(value) {
    const cents = Money.parse(value);
    if (cents < 0) throw new InventoryError('price cannot be negative');
    this.priceCents = cents;
  }

  // Add stock. Whole units only, never negative.
  receive(n) {
    const units = Product._units(n, 'receive');
    this._quantity += units;
    return this._quantity;
  }

  // Remove stock. Refuses to oversell rather than going negative — the
  // caller gets a clear error naming the shortfall.
  ship(n) {
    const units = Product._units(n, 'ship');
    if (units > this._quantity) {
      throw new InventoryError(
        `cannot ship ${units} of ${this.id} — only ${this._quantity} on hand`
      );
    }
    this._quantity -= units;
    return this._quantity;
  }

  // Value of the stock on hand, in cents. Exact integer math.
  lineValue() {
    return this.priceCents * this._quantity;
  }

  static _units(n, verb) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new InventoryError(`${verb} amount must be a positive whole number, got ${n}`);
    }
    return n;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      priceCents: this.priceCents,
      quantity: this._quantity,
      lineValueCents: this.lineValue(),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Inventory — the aggregate. One Map keyed by product id is the single
 * source of truth; every rollup is derived from it on demand.
 * ------------------------------------------------------------------ */

class Inventory {
  constructor() {
    this._products = new Map();
  }

  get size() {
    return this._products.size;
  }

  // Add a Product (or a plain spec, which gets constructed into one).
  // Duplicate ids are rejected: silently overwriting would strand stock
  // and make the totals lie.
  add(productOrSpec) {
    const product =
      productOrSpec instanceof Product ? productOrSpec : new Product(productOrSpec);
    if (this._products.has(product.id)) {
      throw new InventoryError(`product id ${product.id} already exists`);
    }
    this._products.set(product.id, product);
    return product;
  }

  has(id) {
    return this._products.has(String(id).trim());
  }

  // Look a product up, erroring if it's missing — callers that mutate
  // stock want the failure here, not a TypeError three lines later.
  get(id) {
    const key = String(id).trim();
    const product = this._products.get(key);
    if (!product) throw new InventoryError(`no product with id ${key}`);
    return product;
  }

  remove(id) {
    const key = String(id).trim();
    if (!this._products.delete(key)) {
      throw new InventoryError(`no product with id ${key}`);
    }
  }

  receive(id, n) {
    return this.get(id).receive(n);
  }

  ship(id, n) {
    return this.get(id).ship(n);
  }

  // Insertion order, which Map preserves — stable output for the CLI and tests.
  products() {
    return [...this._products.values()];
  }

  // The headline number the task asks for: sum of every line's value.
  // Integer cents the whole way, so it's exact for any catalogue size.
  totalValueCents() {
    let total = 0;
    for (const p of this._products.values()) total += p.lineValue();
    return total;
  }

  // Total units across all products, and count of distinct SKUs.
  totalUnits() {
    let units = 0;
    for (const p of this._products.values()) units += p.quantity;
    return units;
  }

  // Products at or below a reorder threshold — the report a real stockroom
  // actually runs. Out-of-stock first, then by how low they are.
  lowStock(threshold = 5) {
    return this.products()
      .filter((p) => p.quantity <= threshold)
      .sort((a, b) => a.quantity - b.quantity || a.id.localeCompare(b.id));
  }

  // The most valuable line items first — where the money is tied up.
  byValue() {
    return this.products().sort((a, b) => b.lineValue() - a.lineValue());
  }

  summary() {
    return {
      skuCount: this.size,
      totalUnits: this.totalUnits(),
      totalValueCents: this.totalValueCents(),
      lowStockCount: this.lowStock().length,
    };
  }

  toJSON() {
    return {
      products: this.products().map((p) => p.toJSON()),
      summary: this.summary(),
    };
  }
}

/* ------------------------------------------------------------------ */

const coreApi = { InventoryError, Money, Product, Inventory };

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.ProductInventory = coreApi;
