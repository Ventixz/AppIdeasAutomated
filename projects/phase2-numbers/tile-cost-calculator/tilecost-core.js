/*
 * tilecost-core.js — the whole calculation for "Find Cost of Tile to Cover a
 * W x H Floor", from karan/Projects (Numbers). DOM-free, console-free, I/O-free,
 * so the identical file runs in the browser and under Node for the tests.
 *
 * Everything the user types is a decimal (12.5 ft, a 12"x12" tile, $2.49 each,
 * 8.25% tax). Money and measurement done in floating point is quietly wrong —
 * 0.1 + 0.2 is 0.30000000000000004, and a tenth of a cent per tile becomes real
 * money across a big order. So NOTHING here is a float: every quantity is an
 * exact rational (a BigInt numerator over a BigInt denominator), and the only
 * rounding that ever happens is the two we actually want — whole tiles rounded
 * UP (you cannot buy 6.2 tiles), and the final dollar figure rounded to the
 * nearest cent, half-up, at the very end.
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Fraction: an exact rational n/d over BigInt, always reduced, d > 0.
 * ------------------------------------------------------------------ */

function gcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { var t = a % b; a = b; b = t; }
  return a;
}

function Fraction(n, d) {
  if (d === undefined) d = 1n;
  n = BigInt(n); d = BigInt(d);
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) { n = -n; d = -d; }         // keep the sign on the numerator
  var g = gcd(n, d) || 1n;
  this.n = n / g;
  this.d = d / g;
}

Fraction.prototype.add = function (o) { return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); };
Fraction.prototype.sub = function (o) { return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); };
Fraction.prototype.mul = function (o) { return new Fraction(this.n * o.n, this.d * o.d); };
Fraction.prototype.div = function (o) { return new Fraction(this.n * o.d, this.d * o.n); };
Fraction.prototype.cmp = function (o) {                       // -1 / 0 / +1
  var a = this.n * o.d, b = o.n * this.d;
  return a < b ? -1 : a > b ? 1 : 0;
};
Fraction.prototype.lte = function (o) { return this.cmp(o) <= 0; };
Fraction.prototype.isZero = function () { return this.n === 0n; };
Fraction.prototype.isPos = function () { return this.n > 0n; };

/* Smallest integer >= this (ceil), returned as a BigInt. */
Fraction.prototype.ceil = function () {
  var q = this.n / this.d, r = this.n % this.d;               // BigInt division truncates toward 0
  if (r > 0n) q += 1n;                                        // positive remainder → round up
  return q;
};

/* Number, for display only — never fed back into a calculation. */
Fraction.prototype.toNumber = function () { return Number(this.n) / Number(this.d); };

/* Round to `places` decimals, half-up, and format with a fixed width. Used only
 * to render the final figures; the value rounded is already exact. */
Fraction.prototype.toFixed = function (places) {
  var neg = this.n < 0n;
  var n = neg ? -this.n : this.n;
  var scale = 10n ** BigInt(places);
  var scaled = (n * scale * 2n + this.d) / (this.d * 2n);     // half-up
  var s = scaled.toString().padStart(places + 1, '0');
  var whole = s.slice(0, s.length - places) || '0';
  var frac = places ? '.' + s.slice(s.length - places) : '';
  return (neg && scaled !== 0n ? '-' : '') + whole + frac;
};

/* Parse a decimal string ("12", "12.5", ".75", "1,000.50") into an exact
 * Fraction. Rejects anything that isn't a clean non-negative decimal. */
function parseDecimal(str) {
  var s = String(str).trim().replace(/[,_\s]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.?\d*$/.test(s) || s === '.') {
    throw new Error('not a number: "' + str + '"');
  }
  var dot = s.indexOf('.');
  if (dot === -1) return new Fraction(BigInt(s), 1n);
  var digits = s.slice(0, dot) + s.slice(dot + 1);
  var scale = 10n ** BigInt(s.length - dot - 1);
  return new Fraction(BigInt(digits || '0'), scale);
}

/* ------------------------------------------------------------------ *
 * Units. Everything is converted to a common base (inches) as an EXACT
 * rational before any area is taken, so a room in feet and a tile in
 * inches — or a whole job in metres — combine without rounding.
 * ------------------------------------------------------------------ */

var UNIT_TO_INCHES = {
  in:  new Fraction(1n, 1n),
  ft:  new Fraction(12n, 1n),
  yd:  new Fraction(36n, 1n),
  cm:  new Fraction(50n, 127n),      // 1 cm = 1/2.54 in = 50/127 in, exact
  m:   new Fraction(5000n, 127n),    // 1 m  = 100/2.54 in = 5000/127 in, exact
  mm:  new Fraction(5n, 127n)
};

function toInches(value, unit) {
  var f = UNIT_TO_INCHES[unit];
  if (!f) throw new Error('unknown unit: ' + unit);
  return value.mul(f);
}

/* ------------------------------------------------------------------ *
 * Tile counting. Two honest models, because they genuinely differ:
 *
 *  • GRID (the contractor's estimate): a tile is a physical rectangle you
 *    cannot stretch. Along the width you lay ceil(W / tileW) tiles, cutting the
 *    last one; down the height ceil(H / tileH). The offcut from a cut tile is
 *    NOT carried to the next row (standard practice — you don't want visible
 *    seams from scraps), so the count is the product of the two ceilings. This
 *    is what you actually buy.
 *
 *  • AREA (the theoretical floor): ceil(roomArea / tileArea) — the fewest whole
 *    tiles whose combined area covers the floor, as if every offcut were reused
 *    perfectly. Always <= the grid count; the gap between the two is the cutting
 *    waste the grid method builds in for free.
 *
 * We report the grid count as the order quantity and show the area count so the
 * built-in waste is visible, then let the user add an explicit waste/overage %
 * on top for breakage and future repairs.
 * ------------------------------------------------------------------ */

function tilesByGrid(roomW, roomH, tileW, tileH) {
  var across = roomW.div(tileW).ceil();
  var down = roomH.div(tileH).ceil();
  return across * down;                 // BigInt
}

function tilesByArea(roomW, roomH, tileW, tileH) {
  var roomArea = roomW.mul(roomH);
  var tileArea = tileW.mul(tileH);
  return roomArea.div(tileArea).ceil(); // BigInt
}

/* ------------------------------------------------------------------ *
 * estimate(input) — the one entry point the UI and tests call.
 *
 * input = {
 *   roomW, roomH,          // decimal strings, in `roomUnit`
 *   tileW, tileH,          // decimal strings, in `tileUnit`
 *   roomUnit, tileUnit,    // 'in'|'ft'|'yd'|'cm'|'m'|'mm' (default ft / in)
 *   pricePerTile,          // decimal string, dollars (or price per box, see below)
 *   tilesPerBox,           // optional int >= 1: buy by the box, price is per box
 *   wastePercent,          // optional decimal, e.g. '10' for 10% overage
 *   taxPercent             // optional decimal, e.g. '8.25'
 * }
 *
 * Returns an object of exact Fractions / BigInts plus pre-formatted strings.
 * ------------------------------------------------------------------ */

function estimate(input) {
  var roomUnit = input.roomUnit || 'ft';
  var tileUnit = input.tileUnit || 'in';

  var roomW = toInches(parseDecimal(input.roomW), roomUnit);
  var roomH = toInches(parseDecimal(input.roomH), roomUnit);
  var tileW = toInches(parseDecimal(input.tileW), tileUnit);
  var tileH = toInches(parseDecimal(input.tileH), tileUnit);

  if (!roomW.isPos() || !roomH.isPos()) throw new Error('room dimensions must be positive');
  if (!tileW.isPos() || !tileH.isPos()) throw new Error('tile dimensions must be positive');

  var price = parseDecimal(input.pricePerTile);
  if (price.n < 0n) throw new Error('price cannot be negative');

  var waste = parseDecimal(input.wastePercent || '0');
  if (waste.n < 0n) throw new Error('waste percent cannot be negative');
  var tax = parseDecimal(input.taxPercent || '0');
  if (tax.n < 0n) throw new Error('tax percent cannot be negative');

  var gridTiles = tilesByGrid(roomW, roomH, tileW, tileH);
  var areaTiles = tilesByArea(roomW, roomH, tileW, tileH);

  // Apply waste to the grid (order) count, rounding up to a whole tile.
  var wasteFactor = new Fraction(100n, 1n).add(waste).div(new Fraction(100n, 1n));
  var tilesWithWaste = new Fraction(gridTiles, 1n).mul(wasteFactor).ceil();

  // Boxes: you buy whole boxes; the number you pay for is the boxed-up count.
  var tilesPerBox = input.tilesPerBox ? BigInt(input.tilesPerBox) : null;
  var boxes = null, tilesCharged = tilesWithWaste;
  if (tilesPerBox) {
    if (tilesPerBox < 1n) throw new Error('tiles per box must be >= 1');
    boxes = new Fraction(tilesWithWaste, 1n).div(new Fraction(tilesPerBox, 1n)).ceil();
    tilesCharged = boxes * tilesPerBox;      // you own (and pay for) full boxes
  }

  // Money — exact until the cent.
  var subtotal = new Fraction(tilesCharged, 1n).mul(price);   // price is per tile OR per box
  if (tilesPerBox) subtotal = new Fraction(boxes, 1n).mul(price);
  var taxAmount = subtotal.mul(tax).div(new Fraction(100n, 1n));
  var total = subtotal.add(taxAmount);

  // Areas, in square feet, for the human-readable summary.
  var inPerFt = new Fraction(12n, 1n);
  var roomAreaSqft = roomW.mul(roomH).div(inPerFt.mul(inPerFt));
  var coverageSqft = new Fraction(tilesCharged, 1n)
    .mul(tileW).mul(tileH).div(inPerFt.mul(inPerFt));

  return {
    // exact quantities
    roomAreaSqft: roomAreaSqft,
    coverageSqft: coverageSqft,
    areaTiles: areaTiles,          // theoretical minimum whole tiles
    gridTiles: gridTiles,          // realistic layout count (what you'd cut to)
    tilesWithWaste: tilesWithWaste,// after the overage %
    tilesPerBox: tilesPerBox,
    boxes: boxes,
    tilesCharged: tilesCharged,    // the number you actually pay for
    subtotal: subtotal,
    taxAmount: taxAmount,
    total: total,
    // formatted for display
    money: {
      subtotal: subtotal.toFixed(2),
      tax: taxAmount.toFixed(2),
      total: total.toFixed(2)
    },
    roomAreaText: roomAreaSqft.toFixed(2),
    coverageText: coverageSqft.toFixed(2)
  };
}

/* ------------------------------------------------------------------ */

var api = {
  Fraction: Fraction,
  parseDecimal: parseDecimal,
  toInches: toInches,
  tilesByGrid: tilesByGrid,
  tilesByArea: tilesByArea,
  estimate: estimate,
  UNIT_TO_INCHES: UNIT_TO_INCHES
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.TileCostCore = api;
