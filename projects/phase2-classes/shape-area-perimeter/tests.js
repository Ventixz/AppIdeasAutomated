#!/usr/bin/env node
'use strict';
/*
 * tests.js — dependency-free checks for the Shape engine. Run:
 *   node tests.js
 *
 * The Classes category is about design, so these lean on the GUARANTEES the
 * design makes, not on surface output:
 *
 *   - Shape is genuinely abstract and every subclass answers area()/perimeter();
 *     nothing branches on a type string.
 *   - Measurements are EXACT: a rectangle's area is a rational, a circle's is
 *     exactly r²·π, a right triangle's perimeter is a+b+√(a²+b²), an equilateral
 *     triangle's area is (s²/4)√3 — pinned by exact equality, not float deltas.
 *   - Surds reduce correctly (√50 = 5√2) and Heron gives 84 for a 13-14-15
 *     triangle exactly.
 *   - Scaling multiplies area by the factor SQUARED and perimeter by the factor,
 *     exactly, for every shape.
 *   - The design is HONEST: regular-polygon area and ellipse perimeter are flagged
 *     inexact, and a collection can separate the exact figures from the approximate.
 *   - Invalid shapes (negative dims, broken triangle inequality, abstract Shape)
 *     are refused.
 */

const core = require('./shape-core');
const {
  ShapeError, Rational, Quantity, reduceSurd, factorSquare,
  Shape, Circle, Rectangle, Square, RightTriangle, EquilateralTriangle,
  Triangle, Rhombus, RegularPolygon, Ellipse, ShapeCollection, makeShape,
} = core;
const { sampleCollection } = require('./shape-fixtures');

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; } else { failures.push(name); }
}
function throws(name, fn) {
  try { fn(); failures.push(name + ' (expected throw)'); }
  catch (e) {
    if (e instanceof ShapeError) passed++;
    else failures.push(name + ' (threw ' + e.name + ', not ShapeError)');
  }
}
const Q = (s) => s.toString();
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

// --- Rational ---------------------------------------------------------------
check('rational reduces', Q(new Rational(4n, 8n)) === '1/2');
check('rational parses fraction', Q(Rational.parse('3/4')) === '3/4');
check('rational parses decimal exactly', Q(Rational.parse('2.5')) === '5/2');
check('rational parses negative decimal', Q(Rational.parse('-0.125')) === '-1/8');
check('rational add', Q(new Rational(1n, 3n).add(new Rational(1n, 6n))) === '1/2');
check('rational mul', Q(new Rational(2n, 3n).mul(new Rational(3n, 4n))) === '1/2');
check('rational compare', new Rational(1n, 3n).compare(new Rational(1n, 2n)) === -1);
throws('rational zero denominator', () => new Rational(1n, 0n));
throws('division by zero', () => new Rational(1n).div(new Rational(0n)));

// --- Surd reduction ---------------------------------------------------------
check('factorSquare 72 = 36·2', (() => { const r = factorSquare(72n); return r.k === 6n && r.m === 2n; })());
check('√50 = 5√2', Q(Quantity.surd(1, 50)) === '5√2');
check('√(1/4) = 1/2 (rational)', Q(Quantity.surd(1, new Rational(1n, 4n))) === '1/2');
check('√(8/2) = 2 (rational)', Q(Quantity.surd(1, new Rational(8n, 2n))) === '2');
check('reduceSurd(18) → 3√2', (() => { const r = reduceSurd(18); return r.radicand === 2n && Q(r.coeff) === '3'; })());
throws('√ of negative refused', () => Quantity.surd(1, -4));

// --- Quantity algebra -------------------------------------------------------
check('quantity exact equality', Quantity.piMultiple(49).equals(Quantity.piMultiple(49)));
check('quantity inequality', !Quantity.piMultiple(49).equals(Quantity.piMultiple(50)));
check('π and rational do not collapse', !Quantity.piMultiple(1).equals(Quantity.rational(1)));
check('quantity add surds combine', Q(Quantity.surd(1, 2).add(Quantity.surd(3, 2))) === '4√2');
check('quantity sum display', Q(Quantity.rational(6).add(Quantity.surd(2, 13))) === '6 + 2√13');
check('quantity scaleBy', Q(Quantity.piMultiple(2).scaleBy(new Rational(3n))) === '6π');
check('inexact + exact is inexact', Quantity.approx(1.5).add(Quantity.rational(2)).exact === false);
check('inexact never equals', !Quantity.approx(1).equals(Quantity.rational(1)));
check('inexact toString marked', Quantity.approx(12.3456789).toString().startsWith('≈'));
check('quantity toNumber of 49π', near(Quantity.piMultiple(49).toNumber(), 49 * Math.PI));

// --- Shape is abstract; subclasses implement the hooks ----------------------
throws('Shape is abstract', () => new Shape('X', {}));
check('every sample shape answers area() and perimeter()',
  sampleCollection().shapes.every((s) => s.area() instanceof Quantity && s.perimeter() instanceof Quantity));
check('no shape is a bare Shape',
  sampleCollection().shapes.every((s) => s.constructor !== Shape && s instanceof Shape));

// --- Exact areas & perimeters -----------------------------------------------
check('circle area = 49π', Circle.prototype && new Circle(7).area().equals(Quantity.piMultiple(49)));
check('circle circumference = 14π', new Circle(7).perimeter().equals(Quantity.piMultiple(14)));
check('rectangle area exact', new Rectangle(8, '5/2').area().equals(Quantity.rational(20)));
check('rectangle perimeter exact', new Rectangle(8, '5/2').perimeter().equals(Quantity.rational(21)));
check('square area = 36', new Square(6).area().equals(Quantity.rational(36)));
check('square perimeter = 24', new Square(6).perimeter().equals(Quantity.rational(24)));
check('right triangle area = 6', new RightTriangle(3, 4).area().equals(Quantity.rational(6)));
check('right triangle perimeter = 12 (3-4-5)', new RightTriangle(3, 4).perimeter().equals(Quantity.rational(12)));
check('right triangle 1-1 perimeter = 2 + √2', Q(new RightTriangle(1, 1).perimeter()) === '2 + √2');
check('equilateral area = √3', new EquilateralTriangle(2).area().equals(Quantity.surd(1, 3)));
check('equilateral perimeter = 6', new EquilateralTriangle(2).perimeter().equals(Quantity.rational(6)));
check('Heron: 13-14-15 area = 84 exactly', new Triangle(13, 14, 15).area().equals(Quantity.rational(84)));
check('Heron: 13-14-15 perimeter = 42', new Triangle(13, 14, 15).perimeter().equals(Quantity.rational(42)));
check('equilateral-as-Triangle matches EquilateralTriangle',
  near(new Triangle(2, 2, 2).area().toNumber(), new EquilateralTriangle(2).area().toNumber()));
check('rhombus area = 24', new Rhombus(6, 8).area().equals(Quantity.rational(24)));
check('rhombus perimeter = 20 (6-8 diagonals, side 5)', new Rhombus(6, 8).perimeter().equals(Quantity.rational(20)));
check('rhombus 2-2 perimeter = 4√2', Q(new Rhombus(2, 2).perimeter()) === '4√2');

// --- Honesty about what cannot be exact -------------------------------------
check('regular pentagon perimeter is exact', new RegularPolygon(5, 4).perimeter().exact === true);
check('regular pentagon area is inexact', new RegularPolygon(5, 4).area().exact === false);
check('regular pentagon area ≈ 27.5276', near(new RegularPolygon(5, 4).area().toNumber(), 27.5276, 1e-3));
check('square-as-RegularPolygon area ≈ exact square', near(new RegularPolygon(4, 5).area().toNumber(), 25, 1e-6));
check('ellipse area = 15π exact', new Ellipse(5, 3).area().equals(Quantity.piMultiple(15)));
check('ellipse perimeter is inexact', new Ellipse(5, 3).perimeter().exact === false);
check('ellipse(r,r) area = circle(r) area', near(new Ellipse(4, 4).area().toNumber(), new Circle(4).area().toNumber()));
check('circle is exact', new Circle(7).isExact());
check('pentagon is NOT exact', new RegularPolygon(5, 4).isExact() === false);
check('ellipse is NOT exact (perimeter)', new Ellipse(5, 3).isExact() === false);

// --- Scaling: area ×factor², perimeter ×factor, exactly, every shape --------
for (const shape of [
  new Circle(7), new Rectangle(8, '5/2'), new Square(6), new RightTriangle(3, 4),
  new EquilateralTriangle(2), new Triangle(13, 14, 15), new Rhombus(6, 8),
  new RegularPolygon(5, 4), new Ellipse(5, 3),
]) {
  const k = new Rational(3n);
  const big = shape.scaled(k);
  const areaScaled = near(big.area().toNumber(), shape.area().toNumber() * 9);
  const perimScaled = near(big.perimeter().toNumber(), shape.perimeter().toNumber() * 3);
  check(`${shape.kind}: scale×3 ⇒ area×9`, areaScaled);
  check(`${shape.kind}: scale×3 ⇒ perimeter×3`, perimScaled);
  check(`${shape.kind}: scaling does not mutate original`,
    shape.scaled(k) !== shape && shape instanceof shape.constructor);
}
check('exact shape stays exact after scaling (square)', new Square(6).scaled(2).area().equals(Quantity.rational(144)));
throws('scale factor must be positive', () => new Square(6).scaled(0));

// --- Validation -------------------------------------------------------------
throws('negative radius refused', () => new Circle(-1));
throws('zero side refused', () => new Square(0));
throws('triangle inequality enforced (1,2,3)', () => new Triangle(1, 2, 3));
throws('triangle inequality enforced (1,1,5)', () => new Triangle(1, 1, 5));
check('degenerate-safe triangle (2,3,4) is fine', new Triangle(2, 3, 4) instanceof Triangle);
throws('polygon needs >= 3 sides', () => new RegularPolygon(2, 5));
throws('polygon sides must be integer', () => new RegularPolygon('5/2', 5));

// --- Liskov: a Square behaves as a Rectangle --------------------------------
check('Square IS-A Rectangle', new Square(5) instanceof Rectangle);
check('Square used where Rectangle expected', (() => {
  const useRect = (r) => r.area().toNumber();            // written for Rectangle
  return near(useRect(new Square(5)), 25);
})());

// --- ShapeCollection --------------------------------------------------------
const col = sampleCollection();
check('collection size', col.size === 9);
check('collection total area is inexact (pentagon+ellipse)', col.totalArea().exact === false);
check('collection total area ≈ sum', near(
  col.totalArea().toNumber(),
  col.shapes.reduce((a, s) => a + s.area().toNumber(), 0)));
check('exactOnes excludes pentagon and ellipse', col.exactOnes().length === 7);
check('approximateOnes = pentagon + ellipse', col.approximateOnes().length === 2);
check('largestByArea is the circle (49π ≈ 153.9)', col.largestByArea() instanceof Circle);
check('sortedBy area ascending', (() => {
  const s = col.sortedBy('area');
  for (let i = 1; i < s.length; i++) if (s[i].area().toNumber() < s[i - 1].area().toNumber()) return false;
  return true;
})());
check('exact-only collection keeps an exact total', (() => {
  const c = new ShapeCollection([new Square(3), new RightTriangle(3, 4), new Circle(1)]);
  // 9 + 6 + π  → exact
  return c.totalArea().exact === true && c.totalArea().equals(Quantity.rational(15).add(Quantity.piMultiple(1)));
})());

// --- Registry / makeShape (no type switch in callers) -----------------------
check('makeShape circle', makeShape('circle', [7]).area().equals(Quantity.piMultiple(49)));
check('makeShape is case-insensitive', makeShape('SQUARE', [6]).area().equals(Quantity.rational(36)));
check('makeShape triangle', makeShape('triangle', [13, 14, 15]).area().equals(Quantity.rational(84)));
check('makeShape polygon', makeShape('polygon', [5, 4]).perimeter().equals(Quantity.rational(20)));
throws('makeShape unknown name', () => makeShape('trapezoid', [1, 2, 3, 4]));
throws('makeShape wrong arity', () => makeShape('circle', [1, 2]));

// --- toJSON round-trip ------------------------------------------------------
check('shape toJSON carries exact flag and display', (() => {
  const j = new Circle(7).toJSON();
  return j.kind === 'Circle' && j.area.display === '49π' && j.area.exact === true;
})());

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('All assertions passed.');
