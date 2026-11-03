'use strict';
/*
 * flower-core.js — the engine behind "Flower Shop Ordering To Go".
 *
 * karan/Projects brief (Classes category): "Create a flower shop application
 * which deals in flower objects and use those flower objects in a bouquet
 * object…" — a shop that sells individual flowers and arrangements of them,
 * tracks stock, and takes orders "to go".
 *
 * The Classes category is about DESIGN, not feature count, so this file is built
 * around three ideas — each one a place where the naive version gets it wrong:
 *
 *   1. COMPOSITE — a Flower and a Bouquet are the *same kind of thing*. Both are
 *      `Saleable`: both answer `price()` and `stems()`. A Bouquet is a
 *      collection of Saleables (flowers, and even other bouquets), so pricing a
 *      cart never switches on "is this a flower or a bouquet?" — it asks the
 *      object. Adding gift baskets tomorrow is one new subclass and zero edits.
 *
 *   2. EXACT MONEY — money is integer cents, never a float. `$2.50 + 3×$0.10`
 *      is exactly `$2.80`, and a 12-stem bouquet total is never `$41.000000003`.
 *      A `Money` value object owns that arithmetic; floating point never touches
 *      a price. A percentage discount is the one place rounding is unavoidable,
 *      and the code rounds half-up to the cent *explicitly* rather than hiding it.
 *
 *   3. ATOMIC INVENTORY — the Shop owns an invariant: stock is never negative and
 *      the register and the shelves stay consistent. An order is a transaction.
 *      If any flower in it is short by even one stem, the WHOLE order is refused
 *      and nothing changes — no half-decremented inventory, no partial charge.
 *      The invariant lives inside `Shop`; callers can't reach past it.
 *
 * No dependencies, no build step. Shared by the CLI, the tests and the browser.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class ShopError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShopError';
  }
}

/** Thrown by an order the shop cannot fully fulfil. Carries the shortfalls so
 *  the caller can see exactly what was missing — and inventory is untouched. */
class OutOfStockError extends ShopError {
  constructor(shortfalls) {
    const parts = shortfalls.map((s) => `${s.name} (need ${s.need}, have ${s.have})`);
    super('cannot fulfil order — short on: ' + parts.join(', '));
    this.name = 'OutOfStockError';
    this.shortfalls = shortfalls;
  }
}

// ---------------------------------------------------------------------------
// Money — an exact value object stored as an integer number of cents
// ---------------------------------------------------------------------------

/**
 * Money is immutable and exact. Internally it is a whole number of cents, so
 * addition and whole-number multiplication never lose a fraction of a penny.
 * The only operation that must round is applying a percentage; it rounds
 * half-up to the nearest cent, and nothing else in the system rounds at all.
 */
class Money {
  constructor(cents) {
    if (!Number.isInteger(cents)) throw new ShopError('Money needs an integer number of cents');
    this.cents = cents;
    Object.freeze(this);
  }

  /** From a dollars value: a number (2.5) or a string ("2.50", "$1,299.99"). */
  static dollars(value) {
    if (value instanceof Money) return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new ShopError('price must be a finite number');
      return new Money(Math.round(value * 100));
    }
    const text = String(value).trim().replace(/[$,\s]/g, '');
    if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new ShopError(`not a money amount: "${value}"`);
    const [whole, frac = ''] = text.replace('-', '').split('.');
    const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    return new Money(text.startsWith('-') ? -cents : cents);
  }

  static zero() { return new Money(0); }

  plus(other) { return new Money(this.cents + Money.dollars(other).cents); }
  minus(other) { return new Money(this.cents - Money.dollars(other).cents); }

  /** Multiply by a whole count — exact, no rounding. */
  times(count) {
    if (!Number.isInteger(count)) throw new ShopError('Money.times needs a whole count');
    return new Money(this.cents * count);
  }

  /** Apply a percentage *off* (0–100), rounding the result half-up to the cent. */
  lessPercent(percent) {
    if (!(percent >= 0 && percent <= 100)) throw new ShopError('discount percent must be 0–100');
    const kept = this.cents * (100 - percent);
    return new Money(Math.round(kept / 100));
  }

  isZero() { return this.cents === 0; }
  compare(other) { return this.cents - Money.dollars(other).cents; }
  equals(other) { return this.cents === Money.dollars(other).cents; }

  toNumber() { return this.cents / 100; }
  toString() {
    const sign = this.cents < 0 ? '-' : '';
    const abs = Math.abs(this.cents);
    return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  }
  toJSON() { return this.toString(); }
}

// ---------------------------------------------------------------------------
// Saleable — the abstract base. A Flower and a Bouquet are both Saleable.
// ---------------------------------------------------------------------------

/**
 * Anything the shop can sell. Abstract: constructing a bare `Saleable` throws,
 * and the two things every subclass MUST answer are `price()` (a Money) and
 * `stems()` (a Map of flower-key → stem count pulled from inventory). Everything
 * the shop, the cart and the tests do is phrased against these two methods, so
 * nothing ever branches on whether a line is a flower or a bouquet.
 */
class Saleable {
  constructor(name) {
    if (new.target === Saleable) throw new ShopError('Saleable is abstract — use Flower or Bouquet');
    if (!name || typeof name !== 'string') throw new ShopError('a saleable needs a name');
    this.name = name;
  }

  // Subclasses MUST override these two.
  price() { throw new ShopError(`${this.constructor.name} must implement price()`); }
  stems() { throw new ShopError(`${this.constructor.name} must implement stems()`); }

  /** Total number of individual flower stems this saleable consumes. */
  stemCount() {
    let n = 0;
    for (const count of this.stems().values()) n += count;
    return n;
  }

  describe() { return `${this.name} — ${this.price()}`; }
  toJSON() { return { kind: this.constructor.name.toLowerCase(), name: this.name, price: this.price().toString() }; }
}

// ---------------------------------------------------------------------------
// Flower — a single kind of stem. The "leaf" of the composite.
// ---------------------------------------------------------------------------

class Flower extends Saleable {
  constructor(name, { color = 'mixed', pricePerStem } = {}) {
    super(name);
    if (pricePerStem === undefined) throw new ShopError(`${name}: a flower needs a pricePerStem`);
    this.color = color;
    this.pricePerStem = Money.dollars(pricePerStem);
    if (this.pricePerStem.compare(Money.zero()) < 0) throw new ShopError(`${name}: price can't be negative`);
    Object.freeze(this);
  }

  /** A flower is keyed by name+color, so "red Rose" and "white Rose" differ. */
  get key() { return `${this.name}|${this.color}`.toLowerCase(); }

  price() { return this.pricePerStem; }
  stems() { return new Map([[this.key, 1]]); }

  describe() { return `${this.color} ${this.name} — ${this.price()} / stem`; }
  toJSON() { return { ...super.toJSON(), color: this.color }; }
}

// ---------------------------------------------------------------------------
// Bouquet — an arrangement of saleables. The "composite" of the pattern.
// ---------------------------------------------------------------------------

/**
 * A bouquet holds a list of { item, qty } where `item` is itself any Saleable —
 * usually flowers, but a bouquet may contain another bouquet (a "double" gift),
 * which is the whole point of the composite pattern. Its price is the sum of its
 * parts plus an arrangement fee, with an optional whole-percent discount applied
 * last. Its stem map is the union of its parts' stem maps, scaled by quantity.
 */
class Bouquet extends Saleable {
  constructor(name, { items = [], arrangementFee = 0, discountPercent = 0 } = {}) {
    super(name);
    this.arrangementFee = Money.dollars(arrangementFee);
    if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      throw new ShopError(`${name}: discountPercent must be a whole number 0–100`);
    }
    this.discountPercent = discountPercent;
    this.items = [];
    for (const entry of items) this._absorb(entry);
    if (this.items.length === 0) throw new ShopError(`${name}: a bouquet needs at least one item`);
    Object.freeze(this.items);
    Object.freeze(this);
  }

  _absorb(entry) {
    const item = entry.item || entry.flower || entry[0];
    const qty = entry.qty !== undefined ? entry.qty : (entry[1] !== undefined ? entry[1] : 1);
    if (!(item instanceof Saleable)) throw new ShopError(`${this.name}: bouquet items must be Saleable`);
    if (item === this) throw new ShopError(`${this.name}: a bouquet cannot contain itself`);
    if (!Number.isInteger(qty) || qty <= 0) throw new ShopError(`${this.name}: quantity must be a positive whole number`);
    this.items.push({ item, qty });
  }

  /** Price before the arrangement fee and discount. */
  subtotal() {
    return this.items.reduce((sum, { item, qty }) => sum.plus(item.price().times(qty)), Money.zero());
  }

  /** The gross (subtotal + arrangement fee), before discount. */
  gross() { return this.subtotal().plus(this.arrangementFee); }

  /** Final price: gross, then the whole-percent discount rounded half-up. */
  price() {
    const g = this.gross();
    return this.discountPercent ? g.lessPercent(this.discountPercent) : g;
  }

  /** The amount saved by the discount (exact: gross − price). */
  discount() { return this.gross().minus(this.price()); }

  /** Union of every part's stems, scaled by quantity — recurses into bouquets. */
  stems() {
    const total = new Map();
    for (const { item, qty } of this.items) {
      for (const [key, n] of item.stems()) {
        total.set(key, (total.get(key) || 0) + n * qty);
      }
    }
    return total;
  }

  describe() {
    const parts = this.items.map(({ item, qty }) => `${qty}× ${item.name}`).join(', ');
    const disc = this.discountPercent ? ` (−${this.discountPercent}%)` : '';
    return `${this.name} [${parts}] — ${this.price()}${disc}`;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      arrangementFee: this.arrangementFee.toString(),
      discountPercent: this.discountPercent,
      stems: this.stemCount(),
      items: this.items.map(({ item, qty }) => ({ name: item.name, qty })),
    };
  }
}

// ---------------------------------------------------------------------------
// Cart — what a customer wants to buy "to go", before it is a transaction
// ---------------------------------------------------------------------------

class Cart {
  constructor(lines = []) {
    this.lines = [];
    for (const l of lines) this.add(l.item || l[0], l.qty !== undefined ? l.qty : (l[1] !== undefined ? l[1] : 1));
  }

  add(item, qty = 1) {
    if (!(item instanceof Saleable)) throw new ShopError('cart lines must be Saleable');
    if (!Number.isInteger(qty) || qty <= 0) throw new ShopError('quantity must be a positive whole number');
    this.lines.push({ item, qty });
    return this;
  }

  get size() { return this.lines.reduce((n, l) => n + l.qty, 0); }
  isEmpty() { return this.lines.length === 0; }

  total() {
    return this.lines.reduce((sum, { item, qty }) => sum.plus(item.price().times(qty)), Money.zero());
  }

  /** The combined stem demand of everything in the cart. */
  stems() {
    const total = new Map();
    for (const { item, qty } of this.lines) {
      for (const [key, n] of item.stems()) total.set(key, (total.get(key) || 0) + n * qty);
    }
    return total;
  }
}

// ---------------------------------------------------------------------------
// Receipt — the immutable record a successful order produces
// ---------------------------------------------------------------------------

class Receipt {
  constructor({ lines, total, stems, registerAfter, at }) {
    this.lines = lines;
    this.total = total;
    this.stems = stems;
    this.registerAfter = registerAfter;
    this.at = at || new Date();
    Object.freeze(this);
  }

  toString() {
    const rows = this.lines
      .map((l) => `  ${l.qty}× ${l.name.padEnd(22)} ${l.each.toString().padStart(9)}  ${l.lineTotal.toString().padStart(9)}`)
      .join('\n');
    return [
      '  --- Flower Shop receipt ---',
      rows,
      '  ' + '-'.repeat(44),
      `  TOTAL`.padEnd(36) + this.total.toString().padStart(10),
      `  (${this.stems} stems)`,
    ].join('\n');
  }

  toJSON() {
    return {
      total: this.total.toString(),
      stems: this.stems,
      lines: this.lines.map((l) => ({ name: l.name, qty: l.qty, each: l.each.toString(), lineTotal: l.lineTotal.toString() })),
    };
  }
}

// ---------------------------------------------------------------------------
// Shop — owns the inventory invariant and the register. Orders are atomic.
// ---------------------------------------------------------------------------

class Shop {
  constructor(name = 'Flower Shop', { register = 0 } = {}) {
    this.name = name;
    this.register = Money.dollars(register);
    this._flowers = new Map();   // key -> Flower
    this._stock = new Map();     // key -> integer stem count
    this._reorder = new Map();   // key -> reorder level
  }

  /** Register a flower the shop carries, with a starting stock and reorder level. */
  stock(flower, count, { reorderAt = 0 } = {}) {
    if (!(flower instanceof Flower)) throw new ShopError('only Flower objects can be stocked');
    if (!Number.isInteger(count) || count < 0) throw new ShopError('stock count must be a non-negative whole number');
    this._flowers.set(flower.key, flower);
    this._stock.set(flower.key, (this._stock.get(flower.key) || 0) + count);
    this._reorder.set(flower.key, reorderAt);
    return this;
  }

  stockOf(flower) {
    const key = flower instanceof Flower ? flower.key : String(flower).toLowerCase();
    return this._stock.get(key) || 0;
  }

  get flowers() { return [...this._flowers.values()]; }

  /** Flowers at or below their reorder level — the "time to buy more" list. */
  lowStock() {
    const low = [];
    for (const [key, flower] of this._flowers) {
      const have = this._stock.get(key) || 0;
      if (have <= (this._reorder.get(key) || 0)) low.push({ flower, have, reorderAt: this._reorder.get(key) || 0 });
    }
    return low;
  }

  /** Which stems (if any) a saleable×qty is short on — without changing anything. */
  shortfalls(saleable, qty = 1) {
    const out = [];
    for (const [key, n] of saleable.stems()) {
      const need = n * qty;
      const have = this._stock.get(key) || 0;
      if (have < need) {
        const flower = this._flowers.get(key);
        out.push({ key, name: flower ? flower.describe().split(' — ')[0] : key, need, have });
      }
    }
    return out;
  }

  canFulfill(saleable, qty = 1) { return this.shortfalls(saleable, qty).length === 0; }

  /** Order one saleable (a flower or a bouquet), qty times. Atomic. */
  order(saleable, qty = 1) { return this.checkout(new Cart([{ item: saleable, qty }])); }

  /**
   * Check a cart out as ONE transaction. Either every stem is in stock and the
   * whole cart is sold (stock decremented, register credited, Receipt returned),
   * or the first shortage aborts it and NOTHING changes.
   */
  checkout(cart) {
    if (cart.isEmpty()) throw new ShopError('cart is empty');

    // 1. Verify the whole demand up front, against unknown flowers too.
    const demand = cart.stems();
    const shortfalls = [];
    for (const [key, need] of demand) {
      if (!this._flowers.has(key)) throw new ShopError(`we don't carry "${key}"`);
      const have = this._stock.get(key) || 0;
      if (have < need) shortfalls.push({ key, name: this._flowers.get(key).describe().split(' — ')[0], need, have });
    }
    if (shortfalls.length) throw new OutOfStockError(shortfalls);

    // 2. Commit — only now does anything mutate.
    for (const [key, need] of demand) this._stock.set(key, this._stock.get(key) - need);
    const total = cart.total();
    this.register = this.register.plus(total);

    const lines = cart.lines.map(({ item, qty }) => ({
      name: item.name, qty, each: item.price(), lineTotal: item.price().times(qty),
    }));
    let stemCount = 0;
    for (const n of demand.values()) stemCount += n;
    return new Receipt({ lines, total, stems: stemCount, registerAfter: this.register });
  }

  toJSON() {
    return {
      name: this.name,
      register: this.register.toString(),
      inventory: this.flowers.map((f) => ({ name: f.name, color: f.color, stock: this.stockOf(f) })),
    };
  }
}

// ---------------------------------------------------------------------------
// Module export — works under Node (require) and the browser (global).
// ---------------------------------------------------------------------------

const coreApi = {
  ShopError, OutOfStockError,
  Money, Saleable, Flower, Bouquet, Cart, Receipt, Shop,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.FlowerCore = coreApi;
