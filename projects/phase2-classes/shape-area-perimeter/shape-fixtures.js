'use strict';
/*
 * shape-fixtures.js — a sample collection shared by the CLI, the tests and the
 * browser demo, so all three show the same figures. Chosen to exercise every
 * kind of Quantity: pure rational, exact π-multiples, exact surds, and the two
 * honestly-inexact shapes. Works under Node (require) and the browser (global).
 */

(function (factory) {
  const core = (typeof require !== 'undefined') ? require('./shape-core') : window.ShapeCore;
  const api = factory(core);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ShapeFixtures = api;
})(function (core) {
  const {
    Circle, Rectangle, Square, RightTriangle, EquilateralTriangle,
    Triangle, Rhombus, RegularPolygon, Ellipse, ShapeCollection,
  } = core;

  function sampleCollection() {
    return new ShapeCollection([
      new Circle(7),                    // area 49π, circumference 14π
      new Rectangle(8, '5/2'),          // area 20, perimeter 21
      new Square(6),                    // area 36, perimeter 24
      new RightTriangle(3, 4),          // area 6, perimeter 12 (3-4-5)
      new EquilateralTriangle(2),       // area √3, perimeter 6
      new Triangle(13, 14, 15),         // area 84, perimeter 42
      new Rhombus(6, 8),                // area 24, perimeter 20 (side 5)
      new RegularPolygon(5, 4),         // pentagon: perimeter 20, area ≈ 27.53 (inexact)
      new Ellipse(5, 3),                // area 15π, perimeter ≈ 25.53 (inexact)
    ]);
  }

  return { sampleCollection };
});
