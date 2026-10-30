/*
 * recipe-core.js — a recipe creator and manager, DOM-free.
 *
 * The task ("Recipe Creator and Manager") is the sixth* of karan/Projects'
 * Classes (Object-Oriented Programming) category:
 *
 *   "Create a recipe class with ingredients. Then create a manager that can
 *    store these recipes and categorise them (e.g. by category such as dessert
 *    or main course, or by their main ingredient)."
 *
 * (*the Classes list's sixth entry; this repo's sixth project in the category.)
 *
 * Like every task in this category, the point is the *design*, not the feature
 * list. "Store recipes and categorise them" is one sentence that hides the three
 * things a naive version gets wrong:
 *
 *   1. A QUANTITY IS AN EXACT AMOUNT WITH A UNIT — NOT A FLOAT. "1 cup" plus
 *      "2 tbsp" is a real, exact sum; scaling a 4-serving recipe to 6 multiplies
 *      every amount by exactly 3/2, so 1 cup becomes exactly 1½ cups, not
 *      1.4999999. Amounts are exact rationals over BigInt and units convert by
 *      exact ratios (1 cup = 236.5882365 ml, to the last digit), so a recipe
 *      scaled up and back down is the recipe you started with — floats drift,
 *      this doesn't.
 *
 *   2. THE MANAGER'S CATEGORIES ARE A *DERIVED* INDEX, NOT A SECOND COPY. The
 *      brief's "categorise by category or by main ingredient" is the trap: the
 *      naive manager keeps a list AND per-category lists AND per-ingredient
 *      lists, and the day one of them is updated and another isn't, the views
 *      disagree. Here the recipes are the single source of truth; the by-category
 *      and by-ingredient indexes are rebuilt from them and kept in lock-step on
 *      every add and remove, so a lookup can never show a recipe the book no
 *      longer holds (a test proves the indexes always equal a fresh scan).
 *
 *   3. "WHAT CAN I MAKE?" IS UNIT-AWARE AND HONEST. Given what's in the pantry,
 *      the manager answers which recipes are makeable — comparing *quantities*
 *      in a common unit (500 g of flour covers a recipe needing 2 cups? only if
 *      we can compare them), treating un-measured "to taste" seasonings as always
 *      on hand, and — crucially — refusing to guess across incompatible
 *      dimensions (you cannot convert grams to millilitres without a density), so
 *      it reports "can't compare" rather than silently passing or failing.
 *
 * `Recipe` holds the ingredients, the title, the category and the steps, and
 * knows how to scale itself. `RecipeBook` (the manager) stores recipes and owns
 * the two indexes. `Pantry` holds what you have at home. Nothing here touches the
 * DOM, a clock, or the network: `recipe-node.js` drives these classes from a CLI,
 * `script.js` drives them in a browser, `tests.js` drives them with fixed data.
 * One engine, three front ends.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Errors — one named type so callers (and tests) can tell a rejected
 * operation (bad quantity, unknown unit, cross-dimension math, duplicate
 * recipe, unknown id) from a real bug.
 * ------------------------------------------------------------------ */

class RecipeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecipeError';
  }
}

/* ------------------------------------------------------------------ *
 * Rational — an exact fraction over BigInt. A recipe scaled by 1/3 and
 * back by 3 must be the recipe you started with, and "1/2 cup + 1/4 cup"
 * must be exactly "3/4 cup"; floating point gives neither. Kept small:
 * only the operations quantities actually need.
 * ------------------------------------------------------------------ */

function gcdBig(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; }

class Rational {
  constructor(num, den = 1n) {
    num = BigInt(num); den = BigInt(den);
    if (den === 0n) throw new RecipeError('a rational cannot have a zero denominator');
    if (den < 0n) { num = -num; den = -den; }
    const g = gcdBig(num, den) || 1n;
    this.n = num / g;
    this.d = den / g;
    Object.freeze(this);
  }

  // Accept an integer, a Rational, or a string: "3", "1/2", "1.5", "1 1/2".
  static from(value) {
    if (value instanceof Rational) return value;
    if (typeof value === 'bigint') return new Rational(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RecipeError(`not a finite number: ${value}`);
      if (Number.isInteger(value)) return new Rational(BigInt(value));
      return Rational.from(String(value));
    }
    const s = String(value).trim();
    if (s === '') throw new RecipeError('empty quantity');
    let m = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(s);          // mixed: "1 1/2"
    if (m) {
      const whole = new Rational(BigInt(m[1]));
      const frac = new Rational(BigInt(m[2]), BigInt(m[3]));
      return whole.n < 0n ? whole.sub(frac) : whole.add(frac);
    }
    m = /^(-?\d+)\/(-?\d+)$/.exec(s);                     // fraction: "3/4"
    if (m) return new Rational(BigInt(m[1]), BigInt(m[2]));
    m = /^(-?)(\d*)\.(\d+)$/.exec(s);                     // decimal: "1.5", ".25"
    if (m) {
      const sign = m[1] === '-' ? -1n : 1n;
      const whole = m[2] === '' ? 0n : BigInt(m[2]);
      const frac = BigInt(m[3]);
      const scale = 10n ** BigInt(m[3].length);
      return new Rational(sign * (whole * scale + frac), scale);
    }
    m = /^-?\d+$/.exec(s);                                // integer: "3"
    if (m) return new Rational(BigInt(s));
    throw new RecipeError(`not a quantity: "${value}"`);
  }

  add(o) { o = Rational.from(o); return new Rational(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Rational.from(o); return new Rational(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Rational.from(o); return new Rational(this.n * o.n, this.d * o.d); }
  div(o) {
    o = Rational.from(o);
    if (o.n === 0n) throw new RecipeError('division by zero');
    return new Rational(this.n * o.d, this.d * o.n);
  }

  isZero() { return this.n === 0n; }
  isNegative() { return this.n < 0n; }
  // sign of (this - o): -1, 0, or 1 — exact, no float.
  cmp(o) { o = Rational.from(o); const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }

  toNumber() { return Number(this.n) / Number(this.d); }

  // "3/4", "1 1/2", "2" — the human-readable mixed form used on screen.
  toString() {
    if (this.d === 1n) return this.n.toString();
    const whole = this.n / this.d;
    const rem = this.n % this.d;
    if (whole === 0n) return `${this.n}/${this.d}`;
    const r = rem < 0n ? -rem : rem;
    return `${whole} ${r}/${this.d}`;
  }

  // A decimal rounded to `places` — honestly an approximation, used only for
  // display where a decimal reads better (e.g. grams). Round half up.
  toDecimal(places = 2) {
    const scale = 10n ** BigInt(places);
    const scaled = this.n * scale;
    let q = scaled / this.d;
    const rem2 = (scaled % this.d) * 2n;
    const ad = this.d < 0n ? -this.d : this.d;
    if ((rem2 < 0n ? -rem2 : rem2) >= ad) q += this.n < 0n ? -1n : 1n;
    const neg = q < 0n; if (neg) q = -q;
    const s = q.toString().padStart(places + 1, '0');
    const int = s.slice(0, s.length - places);
    const frac = places ? '.' + s.slice(s.length - places) : '';
    return (neg ? '-' : '') + int + frac;
  }
}

/* ------------------------------------------------------------------ *
 * Units — three dimensions (mass, volume, count), each with a base unit
 * and exact conversion ratios. The volume ratios are the US customary
 * definitions derived from 1 gallon = 3.785411784 L exactly, so they are
 * exact rationals, not rounded decimals. You can convert within a
 * dimension; you cannot convert across one (grams ↔ millilitres needs a
 * density the recipe doesn't carry), and asking to is an error, never a
 * silent guess.
 * ------------------------------------------------------------------ */

const UNITS = {
  // mass, base = gram
  g: { dim: 'mass', per: '1' }, gram: { dim: 'mass', per: '1', alias: 'g' },
  kg: { dim: 'mass', per: '1000' }, mg: { dim: 'mass', per: '1/1000' },
  oz: { dim: 'mass', per: '28.349523125' }, lb: { dim: 'mass', per: '453.59237' },
  // volume, base = millilitre
  ml: { dim: 'volume', per: '1' }, l: { dim: 'volume', per: '1000' },
  tsp: { dim: 'volume', per: '4.92892159375' }, tbsp: { dim: 'volume', per: '14.78676478125' },
  floz: { dim: 'volume', per: '29.5735295625' }, cup: { dim: 'volume', per: '236.5882365' },
  pint: { dim: 'volume', per: '473.176473' }, quart: { dim: 'volume', per: '946.352946' },
  // count, base = one item
  unit: { dim: 'count', per: '1' }, pcs: { dim: 'count', per: '1', alias: 'unit' },
  piece: { dim: 'count', per: '1', alias: 'unit' }, dozen: { dim: 'count', per: '12' },
  clove: { dim: 'count', per: '1', alias: 'unit' }, pinch: { dim: 'count', per: '1', alias: 'unit' },
};

const Units = {
  // Fold aliases and plurals ("cups" -> "cup") to the canonical unit name.
  canon(unit) {
    let u = String(unit == null ? '' : unit).trim().toLowerCase();
    if (u === '') return null; // unit-less: a plain count like "2 eggs"
    if (!UNITS[u] && u.endsWith('s') && UNITS[u.slice(0, -1)]) u = u.slice(0, -1);
    const def = UNITS[u];
    if (!def) throw new RecipeError(`unknown unit: "${unit}"`);
    return def.alias || u;
  },
  dimensionOf(unit) {
    if (unit == null) return 'count';   // a bare number ("2 eggs") is a count
    return UNITS[Units.canon(unit)].dim;
  },
  // how many base units one `unit` is worth, as an exact Rational
  perBase(unit) {
    if (unit == null) return new Rational(1n); // a bare count is 1 base "unit"
    return Rational.from(UNITS[Units.canon(unit)].per);
  },
  known() { return Object.keys(UNITS); },
};

/* ------------------------------------------------------------------ *
 * Quantity — an exact amount paired with a unit (or no unit, for a bare
 * count like "2 eggs"). It knows its dimension, converts within that
 * dimension exactly, scales by a rational factor, and adds to / compares
 * with another quantity ONLY when the dimensions agree. Immutable: every
 * operation returns a new Quantity.
 * ------------------------------------------------------------------ */

class Quantity {
  constructor(amount, unit = null) {
    this.amount = Rational.from(amount);
    if (this.amount.isNegative()) throw new RecipeError(`a quantity cannot be negative: ${this.amount}`);
    this.unit = unit == null ? null : Units.canon(unit);
    this.dim = Units.dimensionOf(this.unit);
    Object.freeze(this);
  }

  // Parse "1 1/2 cup", "200 g", "2" (bare count), "3 eggs" (count, "eggs" is
  // not a unit so it's treated as unit-less — the item name carries "egg").
  static parse(text) {
    const s = String(text).trim();
    const m = /^([\d./\s]+?)\s*([a-zA-Z]+)?$/.exec(s);
    if (!m) throw new RecipeError(`not a quantity: "${text}"`);
    const amount = Rational.from(m[1].trim());
    let unit = m[2] ? m[2].toLowerCase() : null;
    if (unit != null) {
      try { unit = Units.canon(unit); } catch { unit = null; } // a trailing word that isn't a unit (e.g. "eggs") → bare count
    }
    return new Quantity(amount, unit);
  }

  inBase() { return this.amount.mul(Units.perBase(this.unit)); }

  convertTo(unit) {
    const target = unit == null ? null : Units.canon(unit);
    if (Units.dimensionOf(target) !== this.dim) {
      throw new RecipeError(`cannot convert ${this.dim} to ${Units.dimensionOf(target)} (${this.unit || 'count'} → ${target || 'count'})`);
    }
    return new Quantity(this.inBase().div(Units.perBase(target)), target);
  }

  scale(factor) { return new Quantity(this.amount.mul(Rational.from(factor)), this.unit); }

  add(other) {
    if (!(other instanceof Quantity)) throw new RecipeError('add() takes a Quantity');
    if (other.dim !== this.dim) throw new RecipeError(`cannot add ${this.dim} and ${other.dim}`);
    return new Quantity(this.inBase().add(other.inBase()).div(Units.perBase(this.unit)), this.unit);
  }

  // sign of (this - other) in base units; throws across dimensions.
  cmp(other) {
    if (!(other instanceof Quantity)) throw new RecipeError('cmp() takes a Quantity');
    if (other.dim !== this.dim) throw new RecipeError(`cannot compare ${this.dim} and ${other.dim}`);
    return this.inBase().cmp(other.inBase());
  }

  covers(need) { return this.cmp(need) >= 0; }

  toString() {
    const a = this.amount.toString();
    return this.unit == null ? a : `${a} ${this.unit}`;
  }

  toJSON() { return { amount: this.amount.toString(), unit: this.unit }; }
}

/* ------------------------------------------------------------------ *
 * Ingredient — one line of a recipe: an item (the normalised food name),
 * an optional measured Quantity, and an optional note ("finely chopped").
 * A null quantity means "to taste" / "as needed" — a real thing in
 * recipes (salt, pepper) that must NOT be treated as "zero" or dropped.
 * ------------------------------------------------------------------ */

class Ingredient {
  constructor(item, quantity = null, note = '') {
    const name = String(item == null ? '' : item).trim();
    if (!name) throw new RecipeError('an ingredient needs an item name');
    this.item = name;
    this.key = name.toLowerCase();                 // the index key (case-insensitive)
    this.quantity = quantity == null ? null
      : quantity instanceof Quantity ? quantity : Quantity.parse(quantity);
    this.note = String(note || '').trim();
    Object.freeze(this);
  }

  get measured() { return this.quantity != null; }

  scale(factor) {
    return new Ingredient(this.item, this.quantity ? this.quantity.scale(factor) : null, this.note);
  }

  toString() {
    const q = this.quantity ? `${this.quantity} ` : '';
    const n = this.note ? ` (${this.note})` : '';
    return `${q}${this.item}${n}`.trim();
  }

  toJSON() {
    return { item: this.item, quantity: this.quantity ? this.quantity.toJSON() : null, note: this.note || undefined };
  }
}

/* ------------------------------------------------------------------ *
 * Recipe — the heart of the task. Holds the title, a category, the
 * number of servings it is written for, its ingredients, and its steps.
 * It knows how to scale itself to a different number of servings (every
 * measured amount × the exact rational factor), and it exposes its
 * "main ingredient" — the brief's second way to categorise — as either
 * an explicit choice or, failing that, its first ingredient.
 *
 * A Recipe is immutable once built: scaling returns a NEW recipe, so the
 * book's stored copy is never mutated behind the index's back.
 * ------------------------------------------------------------------ */

let _rSeq = 0;

function slug(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `recipe-${++_rSeq}`;
}

class Recipe {
  constructor(title, opts = {}) {
    const t = String(title == null ? '' : title).trim();
    if (!t) throw new RecipeError('a recipe needs a title');
    this.title = t;
    this.id = opts.id ? String(opts.id) : slug(t);
    this.category = String(opts.category || 'Uncategorised').trim() || 'Uncategorised';

    const serv = opts.servings == null ? 1 : Number(opts.servings);
    if (!Number.isInteger(serv) || serv < 1) throw new RecipeError(`servings must be a positive integer, got ${opts.servings}`);
    this.servings = serv;

    this.ingredients = (opts.ingredients || []).map((ing) =>
      ing instanceof Ingredient ? ing
        : Array.isArray(ing) ? new Ingredient(ing[0], ing[1], ing[2])
          : new Ingredient(ing.item, ing.quantity, ing.note));
    if (!this.ingredients.length) throw new RecipeError(`recipe "${t}" has no ingredients`);

    this.instructions = (opts.instructions || []).map((s) => String(s).trim()).filter(Boolean);

    // The "main ingredient" is an explicit choice when given, else the first
    // listed ingredient (recipes conventionally lead with the star of the dish).
    const main = opts.mainIngredient != null ? String(opts.mainIngredient).trim() : this.ingredients[0].item;
    this.mainIngredient = main;
    this.mainKey = main.toLowerCase();

    Object.freeze(this);
  }

  // The set of ingredient keys this recipe uses (for the by-ingredient index).
  ingredientKeys() { return this.ingredients.map((i) => i.key); }

  hasIngredient(item) {
    const k = String(item).trim().toLowerCase();
    return this.ingredients.some((i) => i.key === k);
  }

  // Scale by an exact factor (a number, "3/2", or a Rational).
  scaleBy(factor) {
    const f = Rational.from(factor);
    if (f.isNegative() || f.isZero()) throw new RecipeError('scale factor must be positive');
    const scaled = this.ingredients.map((i) => i.scale(f));
    // servings is a display integer; scale it and round to the nearest whole.
    const newServ = Math.max(1, Math.round(this.servings * f.toNumber()));
    return new Recipe(this.title, {
      id: this.id, category: this.category, servings: newServ,
      ingredients: scaled, instructions: this.instructions, mainIngredient: this.mainIngredient,
    });
  }

  // Scale to an exact target number of servings. The factor target/servings is
  // exact, so scaling 4→6→4 returns the original amounts to the last digit.
  scaleToServings(target) {
    const n = Number(target);
    if (!Number.isInteger(n) || n < 1) throw new RecipeError(`target servings must be a positive integer, got ${target}`);
    const scaled = this.ingredients.map((i) => i.scale(new Rational(BigInt(n), BigInt(this.servings))));
    return new Recipe(this.title, {
      id: this.id, category: this.category, servings: n,
      ingredients: scaled, instructions: this.instructions, mainIngredient: this.mainIngredient,
    });
  }

  toJSON() {
    return {
      id: this.id, title: this.title, category: this.category, servings: this.servings,
      mainIngredient: this.mainIngredient,
      ingredients: this.ingredients.map((i) => i.toJSON()),
      instructions: this.instructions,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Pantry — what you have at home, as item -> Quantity. Adding the same
 * item twice sums the quantities (exact, unit-aware). `has` answers the
 * loose question (is the item here at all?) and `enough` the strict one
 * (is there enough, in compatible units?). It is the input to the book's
 * "what can I make?" query.
 * ------------------------------------------------------------------ */

class Pantry {
  constructor() { this._items = new Map(); } // key -> { item, quantity|null }

  add(item, quantity = null) {
    const ing = new Ingredient(item, quantity);
    const existing = this._items.get(ing.key);
    if (!existing) { this._items.set(ing.key, { item: ing.item, quantity: ing.quantity }); return this; }
    // Sum when we can; if either side is unmeasured, keep it "present, unmeasured".
    if (existing.quantity && ing.quantity) existing.quantity = existing.quantity.add(ing.quantity);
    else existing.quantity = existing.quantity || ing.quantity || null;
    if (ing.quantity == null && existing.quantity != null) existing.quantity = existing.quantity; // no-op, clarity
    return this;
  }

  has(item) { return this._items.has(String(item).trim().toLowerCase()); }

  quantityOf(item) {
    const e = this._items.get(String(item).trim().toLowerCase());
    return e ? e.quantity : undefined;
  }

  items() { return [...this._items.values()].map((e) => new Ingredient(e.item, e.quantity)); }

  // Can this pantry satisfy one recipe ingredient? Returns a verdict object so
  // the caller can explain WHY, not just yes/no:
  //   { ok, reason: 'missing' | 'short' | 'incomparable' | 'have' | 'to-taste' }
  satisfies(ingredient) {
    const ing = ingredient instanceof Ingredient ? ingredient : new Ingredient(ingredient.item, ingredient.quantity);
    if (!this.has(ing.key)) return { ok: false, reason: 'missing', item: ing.item };
    if (!ing.measured) return { ok: true, reason: 'to-taste', item: ing.item }; // "to taste" + we have it at all
    const have = this.quantityOf(ing.key);
    if (have == null) return { ok: true, reason: 'have', item: ing.item };       // present but unmeasured — assume enough
    if (have.dim !== ing.quantity.dim) return { ok: false, reason: 'incomparable', item: ing.item }; // g vs cup — won't guess
    return have.covers(ing.quantity)
      ? { ok: true, reason: 'have', item: ing.item }
      : { ok: false, reason: 'short', item: ing.item, need: ing.quantity, have };
  }
}

/* ------------------------------------------------------------------ *
 * RecipeBook — the manager. The recipes themselves are the single source
 * of truth (a Map id -> Recipe); the by-category and by-ingredient
 * indexes are DERIVED from them and maintained in lock-step on every add
 * and remove. Nothing reads a category list that the recipes no longer
 * back — which is exactly the bug the naive "keep three parallel lists"
 * manager ships. `_reindex()` can rebuild the indexes from scratch, and a
 * test asserts the live indexes always equal that rebuild.
 * ------------------------------------------------------------------ */

class RecipeBook {
  constructor(name = 'Cookbook') {
    this.name = String(name).trim() || 'Cookbook';
    this._recipes = new Map();      // id -> Recipe (source of truth)
    this._byCategory = new Map();   // categoryKey -> Set<id>
    this._byIngredient = new Map(); // ingredientKey -> Set<id>
    this._byMain = new Map();       // mainIngredientKey -> Set<id>
  }

  get size() { return this._recipes.size; }
  all() { return [...this._recipes.values()]; }
  has(id) { return this._recipes.has(String(id)); }

  get(id) {
    const r = this._recipes.get(String(id));
    if (!r) throw new RecipeError(`no recipe "${id}"`);
    return r;
  }

  _idx(map, key, id, add) {
    if (add) { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); }
    else { const s = map.get(key); if (s) { s.delete(id); if (!s.size) map.delete(key); } }
  }

  _index(recipe, add) {
    this._idx(this._byCategory, recipe.category.toLowerCase(), recipe.id, add);
    this._idx(this._byMain, recipe.mainKey, recipe.id, add);
    for (const k of new Set(recipe.ingredientKeys())) this._idx(this._byIngredient, k, recipe.id, add);
  }

  add(recipe) {
    if (!(recipe instanceof Recipe)) throw new RecipeError('add() takes a Recipe');
    if (this._recipes.has(recipe.id)) throw new RecipeError(`a recipe with id "${recipe.id}" is already in the book`);
    this._recipes.set(recipe.id, recipe);
    this._index(recipe, true);
    return recipe;
  }

  remove(id) {
    const r = this.get(id);
    this._index(r, false);
    this._recipes.delete(r.id);
    return r;
  }

  // Rebuild every index from the recipes. The live indexes should always match
  // what this produces — that invariant is what the tests lean on.
  _reindex() {
    this._byCategory = new Map(); this._byIngredient = new Map(); this._byMain = new Map();
    for (const r of this._recipes.values()) this._index(r, true);
  }

  _fromIndex(map, key) {
    const s = map.get(String(key).trim().toLowerCase());
    return s ? [...s].map((id) => this._recipes.get(id)) : [];
  }

  categories() { return [...this._byCategory.keys()].map((k) => this.get([...this._byCategory.get(k)][0]).category).sort(); }
  ingredientsUsed() { return [...this._byIngredient.keys()].sort(); }
  byCategory(cat) { return this._fromIndex(this._byCategory, cat).sort((a, b) => a.title.localeCompare(b.title)); }
  withIngredient(item) { return this._fromIndex(this._byIngredient, item).sort((a, b) => a.title.localeCompare(b.title)); }
  byMainIngredient(item) { return this._fromIndex(this._byMain, item).sort((a, b) => a.title.localeCompare(b.title)); }

  // Group every recipe by category (or by main ingredient) — the two
  // organisations the brief asks for, each a Map of label -> recipes.
  groupByCategory() {
    const out = new Map();
    for (const r of this.all().sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))) {
      if (!out.has(r.category)) out.set(r.category, []);
      out.get(r.category).push(r);
    }
    return out;
  }

  groupByMainIngredient() {
    const out = new Map();
    for (const r of this.all().sort((a, b) => a.mainIngredient.localeCompare(b.mainIngredient) || a.title.localeCompare(b.title))) {
      if (!out.has(r.mainIngredient)) out.set(r.mainIngredient, []);
      out.get(r.mainIngredient).push(r);
    }
    return out;
  }

  // Search with AND semantics across the given filters, each served from an
  // index (not a full scan): a category, one or more required ingredients, and
  // a free-text match on the title.
  search({ category, ingredients, text } = {}) {
    let ids = null; // null means "everything so far"
    const intersect = (list) => {
      const set = new Set(list.map((r) => r.id));
      ids = ids == null ? set : new Set([...ids].filter((id) => set.has(id)));
    };
    if (category) intersect(this.byCategory(category));
    for (const ing of ingredients || []) intersect(this.withIngredient(ing));
    let recipes = ids == null ? this.all() : [...ids].map((id) => this._recipes.get(id));
    if (text) {
      const q = String(text).trim().toLowerCase();
      recipes = recipes.filter((r) => r.title.toLowerCase().includes(q));
    }
    return recipes.sort((a, b) => a.title.localeCompare(b.title));
  }

  // "What can I make?" Given a pantry, return each recipe with a verdict:
  // which ingredients it's missing / short on / can't compare. `makeable` lists
  // only the recipes that pass every ingredient.
  whatCanIMake(pantry) {
    if (!(pantry instanceof Pantry)) throw new RecipeError('whatCanIMake() takes a Pantry');
    return this.all().map((recipe) => {
      const checks = recipe.ingredients.map((ing) => pantry.satisfies(ing));
      const blockers = checks.filter((c) => !c.ok);
      return { recipe, ok: blockers.length === 0, checks, blockers };
    }).sort((a, b) => (a.ok === b.ok ? a.recipe.title.localeCompare(b.recipe.title) : a.ok ? -1 : 1));
  }

  makeable(pantry) { return this.whatCanIMake(pantry).filter((r) => r.ok).map((r) => r.recipe); }

  toJSON() { return { name: this.name, recipes: this.all().map((r) => r.toJSON()) }; }
}

/* ------------------------------------------------------------------ */

const coreApi = {
  RecipeError, Rational, Units, Quantity, Ingredient, Recipe, Pantry, RecipeBook,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.RecipeManager = coreApi;
