'use strict';
/*
 * shape-core.js — the engine behind "Shape Area and Perimeter Classes".
 *
 * karan/Projects brief: "Create an abstract class Shape and then inherit from it
 * other shapes like diamond, rectangle, circle, triangle etc. For each shape,
 * define the respective methods to compute area and perimeter."
 *
 * The Classes category is about DESIGN, so this file is built around three ideas:
 *
 *   1. `Shape` is genuinely abstract. It owns the invariant true of every shape
 *      (a name, validated finite non-negative dimensions, and the promise that
 *      `area()` and `perimeter()` exist). Subclasses supply ONLY what differs:
 *      their dimensions and the two formulas. Nothing in the collection, the CLI
 *      or the tests ever switches on a shape's type string or uses `instanceof`
 *      to decide behaviour — adding a new shape is one new class and zero edits.
 *
 *   2. A measurement is an EXACT value, not a float. `Quantity` represents a sum
 *      of a rational part, a rational multiple of pi, and rational multiples of
 *      square-root surds (√2, √3, √13, …). A rectangle's area is exact; a circle's
 *      area is exactly r²·π; a right triangle's perimeter is exactly a+b+√(a²+b²);
 *      an equilateral triangle's area is exactly (s²/4)·√3. Floating point only
 *      ever appears when you ask for `.toNumber()`.
 *
 *   3. The design is HONEST about what cannot be exact. A regular pentagon's area
 *      and an ellipse's perimeter have no closed form in this algebra, so those
 *      quantities are flagged `exact === false` and carry a numeric approximation
 *      only. A `Quantity` always knows whether it is exact, so a report can mark
 *      the approximations instead of pretending every number is precise.
 *
 * No dependencies, no build step. Shared by the CLI, the tests and the browser.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class ShapeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShapeError';
  }
}

// ---------------------------------------------------------------------------
// Exact rational arithmetic over BigInt
// ---------------------------------------------------------------------------

function bigAbs(x) { return x < 0n ? -x : x; }
function bigGcd(a, b) {
  a = bigAbs(a); b = bigAbs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

/** An exact rational number num/den, always stored in lowest terms, den > 0. */
class Rational {
  constructor(num, den = 1n) {
    num = BigInt(num);
    den = BigInt(den);
    if (den === 0n) throw new ShapeError('rational with zero denominator');
    if (den < 0n) { num = -num; den = -den; }
    const g = bigGcd(num, den) || 1n;
    this.num = num / g;
    this.den = den / g;
    Object.freeze(this);
  }

  static from(value) {
    if (value instanceof Rational) return value;
    if (typeof value === 'bigint') return new Rational(value, 1n);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new ShapeError('cannot build a rational from ' + value);
      if (Number.isInteger(value)) return new Rational(BigInt(value), 1n);
      // Decimal string → exact fraction (e.g. 2.5 → 5/2). No float rounding.
      return Rational.parse(String(value));
    }
    if (typeof value === 'string') return Rational.parse(value);
    throw new ShapeError('cannot build a rational from ' + typeof value);
  }

  /** Accepts "3", "-7", "3/4", "2.5", "-0.125". */
  static parse(text) {
    const s = String(text).trim();
    let m = /^(-?\d+)\s*\/\s*(-?\d+)$/.exec(s);
    if (m) return new Rational(BigInt(m[1]), BigInt(m[2]));
    m = /^(-?)(\d*)(?:\.(\d+))?$/.exec(s);
    if (m && (m[2] || m[3])) {
      const sign = m[1] === '-' ? -1n : 1n;
      const intPart = m[2] || '0';
      const frac = m[3] || '';
      const num = sign * BigInt(intPart + frac);
      const den = 10n ** BigInt(frac.length);
      return new Rational(num, den);
    }
    throw new ShapeError('not a number: "' + text + '"');
  }

  add(o) { o = Rational.from(o); return new Rational(this.num * o.den + o.num * this.den, this.den * o.den); }
  sub(o) { o = Rational.from(o); return new Rational(this.num * o.den - o.num * this.den, this.den * o.den); }
  mul(o) { o = Rational.from(o); return new Rational(this.num * o.num, this.den * o.den); }
  div(o) {
    o = Rational.from(o);
    if (o.num === 0n) throw new ShapeError('division by zero');
    return new Rational(this.num * o.den, this.den * o.num);
  }
  neg() { return new Rational(-this.num, this.den); }
  get sign() { return this.num > 0n ? 1 : this.num < 0n ? -1 : 0; }
  isZero() { return this.num === 0n; }
  isInteger() { return this.den === 1n; }

  compare(o) {
    o = Rational.from(o);
    const left = this.num * o.den;
    const right = o.num * this.den;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  equals(o) { o = Rational.from(o); return this.num === o.num && this.den === o.den; }

  toNumber() { return Number(this.num) / Number(this.den); }
  toString() { return this.den === 1n ? String(this.num) : `${this.num}/${this.den}`; }
}

const ZERO = new Rational(0n);

// ---------------------------------------------------------------------------
// Surd reduction: √(rational) → rationalCoefficient · √(squareFreeInteger)
// ---------------------------------------------------------------------------

/** Largest k with k² | n, returned with m = n/k² (m square-free). n >= 0 BigInt. */
function factorSquare(n) {
  if (n < 0n) throw new ShapeError('square root of a negative number');
  if (n === 0n) return { k: 0n, m: 0n };
  let k = 1n, m = n;
  for (let d = 2n; d * d <= m; d++) {
    while (m % (d * d) === 0n) { m /= d * d; k *= d; }
  }
  return { k, m };
}

/**
 * Reduce √(p/q) with p,q positive BigInts into { coeff: Rational, radicand: BigInt }
 * where radicand is a square-free integer >= 1 (1 means the surd is rational).
 *   √(p/q) = √(p·q) / q = (k/q)·√m   with  p·q = k²·m, m square-free.
 */
function reduceSurd(radical) {
  const r = Rational.from(radical);
  if (r.sign < 0) throw new ShapeError('square root of a negative number');
  if (r.isZero()) return { coeff: ZERO, radicand: 1n };
  const pq = r.num * r.den;          // p·q, positive
  const { k, m } = factorSquare(pq);
  return { coeff: new Rational(k, r.den), radicand: m };
}

// ---------------------------------------------------------------------------
// Quantity: rational + (pi coeff)·π + Σ (coeff)·√m, or an inexact approximation
// ---------------------------------------------------------------------------

class Quantity {
  /**
   * @param {Rational} rat   rational part
   * @param {Rational} pi    coefficient of π
   * @param {Map<string,Rational>} surds  map "m" → coefficient of √m (m >= 2, square-free)
   * @param {boolean} exact  false marks a numeric-only approximation
   * @param {number} approx  cached numeric value (required when exact === false)
   */
  constructor(rat = ZERO, pi = ZERO, surds = new Map(), exact = true, approx = null) {
    this.rat = Rational.from(rat);
    this.pi = Rational.from(pi);
    this.surds = new Map();
    for (const [m, c] of surds) {
      const coeff = Rational.from(c);
      if (!coeff.isZero()) this.surds.set(String(m), coeff);
    }
    this.exact = exact;
    this._approx = approx;
    Object.freeze(this);
  }

  static zero() { return new Quantity(); }
  static rational(r) { return new Quantity(Rational.from(r)); }
  /** coeff · π */
  static piMultiple(coeff) { return new Quantity(ZERO, Rational.from(coeff)); }
  /** coeff · √radicand, exact, with the surd fully reduced. */
  static surd(coeff, radicand) {
    const red = reduceSurd(radicand);
    const c = Rational.from(coeff).mul(red.coeff);
    if (red.radicand === 1n) return Quantity.rational(c);
    return new Quantity(ZERO, ZERO, new Map([[String(red.radicand), c]]));
  }
  /** A value with no closed form here: numeric only, flagged inexact. */
  static approx(value) {
    if (!Number.isFinite(value)) throw new ShapeError('approx needs a finite number');
    return new Quantity(ZERO, ZERO, new Map(), false, value);
  }

  add(o) {
    if (!this.exact || !o.exact) return Quantity.approx(this.toNumber() + o.toNumber());
    const surds = new Map();
    for (const [m, c] of this.surds) surds.set(m, c);
    for (const [m, c] of o.surds) surds.set(m, (surds.get(m) || ZERO).add(c));
    return new Quantity(this.rat.add(o.rat), this.pi.add(o.pi), surds);
  }
  /** multiply by a rational scalar (keeps exactness) */
  scaleBy(r) {
    r = Rational.from(r);
    if (!this.exact) return Quantity.approx(this.toNumber() * r.toNumber());
    const surds = new Map();
    for (const [m, c] of this.surds) surds.set(m, c.mul(r));
    return new Quantity(this.rat.mul(r), this.pi.mul(r), surds);
  }

  isZero() { return this.exact && this.rat.isZero() && this.pi.isZero() && this.surds.size === 0; }

  /** Exact structural equality when both are exact; false if either is inexact. */
  equals(o) {
    if (!(o instanceof Quantity)) return false;
    if (!this.exact || !o.exact) return false;
    if (!this.rat.equals(o.rat) || !this.pi.equals(o.pi)) return false;
    if (this.surds.size !== o.surds.size) return false;
    for (const [m, c] of this.surds) {
      const oc = o.surds.get(m);
      if (!oc || !oc.equals(c)) return false;
    }
    return true;
  }

  toNumber() {
    if (!this.exact) return this._approx;
    let v = this.rat.toNumber() + this.pi.toNumber() * Math.PI;
    for (const [m, c] of this.surds) v += c.toNumber() * Math.sqrt(Number(m));
    return v;
  }

  /** Exact symbolic form ("6", "9π", "6 + 2√13", "(3/2)√5"), or "≈ 12.345678". */
  toString() {
    if (!this.exact) return '≈ ' + round(this.toNumber(), 6);
    const terms = [];
    const fmtCoeff = (c, unit) => {
      // c · unit, where unit is "" for rational, "π" or "√m"
      const neg = c.sign < 0;
      const a = neg ? c.neg() : c;
      let body;
      if (unit === '') {
        body = a.toString();
      } else if (a.equals(1)) {
        body = unit;
      } else if (a.isInteger()) {
        body = a.toString() + unit;
      } else {
        body = `(${a.toString()})${unit}`;
      }
      return { neg, body };
    };
    if (!this.rat.isZero()) terms.push(fmtCoeff(this.rat, ''));
    if (!this.pi.isZero()) terms.push(fmtCoeff(this.pi, 'π'));
    const keys = [...this.surds.keys()].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    for (const m of keys) terms.push(fmtCoeff(this.surds.get(m), '√' + m));
    if (terms.length === 0) return '0';
    let out = (terms[0].neg ? '-' : '') + terms[0].body;
    for (let i = 1; i < terms.length; i++) {
      out += (terms[i].neg ? ' - ' : ' + ') + terms[i].body;
    }
    return out;
  }

  toJSON() {
    return { exact: this.exact, value: this.toNumber(), display: this.toString() };
  }
}

function round(x, places) {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

// ---------------------------------------------------------------------------
// Shape — the abstract base class
// ---------------------------------------------------------------------------

class Shape {
  /**
   * @param {string} kind  human name of the concrete shape
   * @param {Object<string,Rational>} dims  validated named dimensions
   */
  constructor(kind, dims) {
    if (new.target === Shape) {
      throw new ShapeError('Shape is abstract — construct a concrete shape (Circle, Rectangle, …)');
    }
    this.kind = kind;
    this.dims = {};
    for (const [name, raw] of Object.entries(dims)) {
      const r = Rational.from(raw);
      if (r.sign <= 0) {
        throw new ShapeError(`${kind}: ${name} must be a positive number, got ${r.toString()}`);
      }
      this.dims[name] = r;
    }
  }

  // The two methods every subclass MUST provide. Calling them on a class that
  // forgot to override them is a clear programmer error, not a silent wrong answer.
  area() { throw new ShapeError(`${this.kind}.area() is not implemented`); }
  perimeter() { throw new ShapeError(`${this.kind}.perimeter() is not implemented`); }

  /**
   * Return a new shape of the SAME concrete type with every dimension multiplied
   * by `factor`. Immutability: the original is never touched. The default works
   * for every shape whose constructor takes its dimensions positionally in the
   * order `dimensionOrder` lists — subclasses that need otherwise override it.
   */
  scaled(factor) {
    const f = Rational.from(factor);
    if (f.sign <= 0) throw new ShapeError('scale factor must be positive');
    const args = this.constructor.dimensionOrder.map((name) => this.dims[name].mul(f));
    return new this.constructor(...args);
  }

  /** true when BOTH area and perimeter are exact values. */
  isExact() { return this.area().exact && this.perimeter().exact; }

  describe() {
    const dims = Object.entries(this.dims)
      .map(([k, v]) => `${k}=${v.toString()}`)
      .join(', ');
    return `${this.kind}(${dims})`;
  }

  toJSON() {
    const dims = {};
    for (const [k, v] of Object.entries(this.dims)) dims[k] = v.toString();
    return {
      kind: this.kind,
      dims,
      area: this.area().toJSON(),
      perimeter: this.perimeter().toJSON(),
      exact: this.isExact(),
    };
  }
}
// Subclasses set this to the positional dimension names their constructor takes.
Shape.dimensionOrder = [];

// ---------------------------------------------------------------------------
// Concrete shapes — each supplies only its dimensions + the two formulas
// ---------------------------------------------------------------------------

class Circle extends Shape {
  constructor(radius) { super('Circle', { radius }); }
  area() { return Quantity.piMultiple(this.dims.radius.mul(this.dims.radius)); }        // r²·π
  perimeter() { return Quantity.piMultiple(this.dims.radius.mul(2)); }                   // 2r·π
}
Circle.dimensionOrder = ['radius'];

class Rectangle extends Shape {
  constructor(width, height, kind = 'Rectangle') { super(kind, { width, height }); }
  area() { return Quantity.rational(this.dims.width.mul(this.dims.height)); }
  perimeter() { return Quantity.rational(this.dims.width.add(this.dims.height).mul(2)); }
}
Rectangle.dimensionOrder = ['width', 'height'];

// A Square IS-A Rectangle (Liskov): anywhere a Rectangle works, a Square works.
class Square extends Rectangle {
  constructor(side) { super(side, side, 'Square'); }
  scaled(factor) { return new Square(this.dims.width.mul(Rational.from(factor))); }
}
Square.dimensionOrder = ['side'];

/** Right triangle given its two legs. Hypotenuse is exact as a surd. */
class RightTriangle extends Shape {
  constructor(legA, legB) { super('RightTriangle', { legA, legB }); }
  area() { return Quantity.rational(this.dims.legA.mul(this.dims.legB).div(2)); }
  perimeter() {
    const a = this.dims.legA, b = this.dims.legB;
    const hypSquared = a.mul(a).add(b.mul(b));         // a² + b² (rational)
    const hyp = Quantity.surd(1, hypSquared);          // √(a²+b²), reduced exactly
    return Quantity.rational(a.add(b)).add(hyp);
  }
}
RightTriangle.dimensionOrder = ['legA', 'legB'];

/** Equilateral triangle: perimeter exact rational, area exactly (s²/4)·√3. */
class EquilateralTriangle extends Shape {
  constructor(side) { super('EquilateralTriangle', { side }); }
  area() { return Quantity.surd(this.dims.side.mul(this.dims.side).div(4), 3); }
  perimeter() { return Quantity.rational(this.dims.side.mul(3)); }
}
EquilateralTriangle.dimensionOrder = ['side'];

/** General triangle from three sides. Validates the triangle inequality; area by Heron. */
class Triangle extends Shape {
  constructor(a, b, c) {
    super('Triangle', { a, b, c });
    const { a: A, b: B, c: C } = this.dims;
    if (A.add(B).compare(C) <= 0 || A.add(C).compare(B) <= 0 || B.add(C).compare(A) <= 0) {
      throw new ShapeError(
        `Triangle: sides ${A}, ${B}, ${C} violate the triangle inequality`);
    }
  }
  perimeter() { return Quantity.rational(this.dims.a.add(this.dims.b).add(this.dims.c)); }
  area() {
    // Heron: area = (1/4)·√((a+b+c)(-a+b+c)(a-b+c)(a+b-c)), exact surd of a rational.
    const { a, b, c } = this.dims;
    const t1 = a.add(b).add(c);
    const t2 = a.neg().add(b).add(c);
    const t3 = a.sub(b).add(c);
    const t4 = a.add(b).sub(c);
    const radicand = t1.mul(t2).mul(t3).mul(t4);
    return Quantity.surd(new Rational(1n, 4n), radicand);
  }
}
Triangle.dimensionOrder = ['a', 'b', 'c'];

/** Rhombus (a "diamond") from its two diagonals. Area rational, perimeter a surd. */
class Rhombus extends Shape {
  constructor(diagonalP, diagonalQ) { super('Rhombus', { diagonalP, diagonalQ }); }
  area() { return Quantity.rational(this.dims.diagonalP.mul(this.dims.diagonalQ).div(2)); }
  perimeter() {
    // side = (1/2)√(p² + q²); perimeter = 4·side = 2·√(p² + q²).
    const p = this.dims.diagonalP, q = this.dims.diagonalQ;
    return Quantity.surd(2, p.mul(p).add(q.mul(q)));
  }
}
Rhombus.dimensionOrder = ['diagonalP', 'diagonalQ'];

/**
 * Regular polygon: n equal sides of length s. Perimeter is exactly n·s. Its area,
 * (n·s²)/(4·tan(π/n)), is transcendental for most n — so this shape is HONEST and
 * returns an inexact Quantity for the area.
 */
class RegularPolygon extends Shape {
  constructor(sides, sideLength) {
    super('RegularPolygon', { sideLength });
    const n = Number(Rational.from(sides).toNumber());
    if (!Number.isInteger(n) || n < 3) {
      throw new ShapeError('RegularPolygon: sides must be an integer >= 3');
    }
    this.sides = n;
  }
  perimeter() { return Quantity.rational(this.dims.sideLength.mul(this.sides)); }
  area() {
    const s = this.dims.sideLength.toNumber();
    const n = this.sides;
    return Quantity.approx((n * s * s) / (4 * Math.tan(Math.PI / n)));
  }
  scaled(factor) {
    return new RegularPolygon(this.sides, this.dims.sideLength.mul(Rational.from(factor)));
  }
  describe() { return `RegularPolygon(sides=${this.sides}, sideLength=${this.dims.sideLength})`; }
  toJSON() { return Object.assign(super.toJSON(), { sides: this.sides }); }
}
RegularPolygon.dimensionOrder = ['sideLength'];

/**
 * Ellipse with semi-axes a and b. Area is exactly π·a·b, but the perimeter has no
 * elementary closed form — so area() is exact and perimeter() is HONEST (inexact),
 * computed with Ramanujan's second approximation.
 */
class Ellipse extends Shape {
  constructor(semiMajor, semiMinor) { super('Ellipse', { semiMajor, semiMinor }); }
  area() { return Quantity.piMultiple(this.dims.semiMajor.mul(this.dims.semiMinor)); }
  perimeter() {
    const a = this.dims.semiMajor.toNumber();
    const b = this.dims.semiMinor.toNumber();
    const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
    const p = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    return Quantity.approx(p);
  }
  scaled(factor) {
    const f = Rational.from(factor);
    return new Ellipse(this.dims.semiMajor.mul(f), this.dims.semiMinor.mul(f));
  }
}
Ellipse.dimensionOrder = ['semiMajor', 'semiMinor'];

// ---------------------------------------------------------------------------
// ShapeCollection — holds shapes and answers questions polymorphically
// ---------------------------------------------------------------------------

class ShapeCollection {
  constructor(shapes = []) {
    this.shapes = [];
    for (const s of shapes) this.add(s);
  }
  add(shape) {
    if (!(shape instanceof Shape)) throw new ShapeError('can only add Shape instances');
    this.shapes.push(shape);
    return shape;
  }
  get size() { return this.shapes.length; }

  /** Total area as an exact Quantity when every member is exact; inexact otherwise. */
  totalArea() {
    return this.shapes.reduce((acc, s) => acc.add(s.area()), Quantity.zero());
  }
  totalPerimeter() {
    return this.shapes.reduce((acc, s) => acc.add(s.perimeter()), Quantity.zero());
  }

  /** Sorted copy by a numeric key ('area' | 'perimeter'), ascending by default. */
  sortedBy(key, descending = false) {
    const metric = key === 'perimeter' ? (s) => s.perimeter().toNumber()
                                       : (s) => s.area().toNumber();
    const out = [...this.shapes].sort((x, y) => metric(x) - metric(y));
    if (descending) out.reverse();
    return out;
  }
  largestByArea() {
    if (this.shapes.length === 0) return null;
    return this.sortedBy('area', true)[0];
  }

  /** Shapes whose area/perimeter are both exact (vs. the approximated ones). */
  exactOnes() { return this.shapes.filter((s) => s.isExact()); }
  approximateOnes() { return this.shapes.filter((s) => !s.isExact()); }

  toJSON() { return this.shapes.map((s) => s.toJSON()); }
}

// ---------------------------------------------------------------------------
// Registry: name → factory, so a CLI can build shapes without a type switch
// ---------------------------------------------------------------------------

const SHAPE_REGISTRY = {
  circle: { Class: Circle, args: ['radius'] },
  rectangle: { Class: Rectangle, args: ['width', 'height'] },
  square: { Class: Square, args: ['side'] },
  righttriangle: { Class: RightTriangle, args: ['legA', 'legB'] },
  equilateral: { Class: EquilateralTriangle, args: ['side'] },
  triangle: { Class: Triangle, args: ['a', 'b', 'c'] },
  rhombus: { Class: Rhombus, args: ['diagonalP', 'diagonalQ'] },
  polygon: { Class: RegularPolygon, args: ['sides', 'sideLength'] },
  ellipse: { Class: Ellipse, args: ['semiMajor', 'semiMinor'] },
};

/** Build a shape by registry name from an array of string/number args. */
function makeShape(name, rawArgs) {
  const key = String(name).toLowerCase();
  const entry = SHAPE_REGISTRY[key];
  if (!entry) throw new ShapeError(`unknown shape "${name}". Known: ${Object.keys(SHAPE_REGISTRY).join(', ')}`);
  if (rawArgs.length !== entry.args.length) {
    throw new ShapeError(`${key} needs ${entry.args.length} value(s): ${entry.args.join(', ')}`);
  }
  // polygon's first arg is an integer count, the rest are rationals; makeShape
  // passes raw strings straight through and the constructors validate.
  return new entry.Class(...rawArgs);
}

// ---------------------------------------------------------------------------

const coreApi = {
  ShapeError,
  Rational,
  Quantity,
  reduceSurd,
  factorSquare,
  Shape,
  Circle,
  Rectangle,
  Square,
  RightTriangle,
  EquilateralTriangle,
  Triangle,
  Rhombus,
  RegularPolygon,
  Ellipse,
  ShapeCollection,
  SHAPE_REGISTRY,
  makeShape,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.ShapeCore = coreApi;
