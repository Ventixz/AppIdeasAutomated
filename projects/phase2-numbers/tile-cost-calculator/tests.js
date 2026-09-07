/*
 * tests.js — dependency-free suite for tilecost-core.js.
 * Run with:  node projects/phase2-numbers/tile-cost-calculator/tests.js
 */

'use strict';

var core = require('./tilecost-core.js');
var F = core.Fraction;

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + name); }
}
function eq(name, got, want) {
  ok(name + ' (got ' + got + ', want ' + want + ')', String(got) === String(want));
}

/* --- Fraction: exactness where floats are wrong --------------------------- */

// The canonical float trap: 0.1 + 0.2 !== 0.3 in IEEE-754, but must be exact here.
ok('0.1 + 0.2 === 0.3 exactly',
   core.parseDecimal('0.1').add(core.parseDecimal('0.2')).cmp(core.parseDecimal('0.3')) === 0);

eq('parseDecimal(12.5) = 25/2', core.parseDecimal('12.5').n + '/' + core.parseDecimal('12.5').d, '25/2');
eq('parseDecimal(.75) = 3/4', core.parseDecimal('.75').n + '/' + core.parseDecimal('.75').d, '3/4');
eq('parseDecimal("1,000.50")', core.parseDecimal('1,000.50').toFixed(2), '1000.50');
['', '.', 'abc', '1.2.3', '-5', '1e3'].forEach(function (bad) {
  var threw = false;
  try { core.parseDecimal(bad); } catch (e) { threw = true; }
  ok('parseDecimal rejects "' + bad + '"', threw);
});

// ceil of a rational
eq('ceil(7/2)', new F(7n, 2n).ceil(), 4n);
eq('ceil(6/2)', new F(6n, 2n).ceil(), 3n);      // exact integer, no rounding up
eq('ceil(1/3)', new F(1n, 3n).ceil(), 1n);
eq('ceil(0/5)', new F(0n, 5n).ceil(), 0n);

// half-up money rounding
eq('toFixed 2.005 -> 2.01', core.parseDecimal('2.005').toFixed(2), '2.01');
eq('toFixed 2.004 -> 2.00', core.parseDecimal('2.004').toFixed(2), '2.00');
eq('toFixed 0 places', new F(7n, 2n).toFixed(0), '4');   // 3.5 -> 4

/* --- units convert exactly ------------------------------------------------ */

eq('1 ft = 12 in', core.toInches(new F(1n), 'ft').toFixed(4), '12.0000');
eq('1 yd = 36 in', core.toInches(new F(1n), 'yd').toFixed(4), '36.0000');
eq('2.54 cm = 1 in', core.toInches(core.parseDecimal('2.54'), 'cm').toFixed(6), '1.000000');
eq('1 m = 5000/127 in', core.toInches(new F(1n), 'm').n + '/' + core.toInches(new F(1n), 'm').d, '5000/127');

/* --- tile counting: the two models ---------------------------------------- */

// A 10 ft x 10 ft room (120" x 120") with 12"x12" tiles: exactly 10 x 10 = 100.
// Grid and area agree because everything divides evenly.
var ft = 'ft', inch = 'in';
function inches(v, u) { return core.toInches(core.parseDecimal(v), u); }

eq('grid 10x10ft / 12in tile', core.tilesByGrid(inches('10', ft), inches('10', ft), inches('12', inch), inches('12', inch)), 100n);
eq('area 10x10ft / 12in tile', core.tilesByArea(inches('10', ft), inches('10', ft), inches('12', inch), inches('12', inch)), 100n);

// A room that does NOT divide evenly: 10 ft (120") wide, tiles 7" wide.
// ceil(120/7) = 18 across; 120 tall / 12" tile = 10 down -> grid = 180.
eq('grid 120in / 7in across', core.tilesByGrid(inches('10', ft), inches('10', ft), inches('7', inch), inches('12', inch)), 180n);
// Area model reuses offcuts: ceil(14400 / 84) = ceil(171.43) = 172, strictly fewer.
eq('area 120x120 / 7x12', core.tilesByArea(inches('10', ft), inches('10', ft), inches('7', inch), inches('12', inch)), 172n);
ok('grid >= area (grid never underestimates)',
   core.tilesByGrid(inches('10', ft), inches('10', ft), inches('7', inch), inches('12', inch)) >=
   core.tilesByArea(inches('10', ft), inches('10', ft), inches('7', inch), inches('12', inch)));

// Half a tile over the edge still needs a whole extra row.
eq('grid rounds a partial row up',
   core.tilesByGrid(inches('12.5', ft), inches('10', ft), inches('12', inch), inches('12', inch)), 130n); // ceil(150/12)=13 across * 10

/* --- estimate(): end-to-end money ----------------------------------------- */

// 10x10 ft floor, 12"x12" tiles at $2.50 each, no waste/tax.
// 100 tiles * $2.50 = $250.00 exactly.
var e1 = core.estimate({ roomW: '10', roomH: '10', tileW: '12', tileH: '12', pricePerTile: '2.50' });
eq('e1 gridTiles', e1.gridTiles, 100n);
eq('e1 subtotal', e1.money.subtotal, '250.00');
eq('e1 total', e1.money.total, '250.00');
eq('e1 room area (sqft)', e1.roomAreaText, '100.00');

// A price that only stays exact with rational money: 3 tiles * $0.10 that a
// float would render as 0.30000000000000004.
var e2 = core.estimate({ roomW: '3', roomH: '1', tileW: '12', tileH: '12', pricePerTile: '0.10' });
eq('e2 gridTiles', e2.gridTiles, 3n);
eq('e2 subtotal exact', e2.money.subtotal, '0.30');

// Waste percentage rounds up to whole tiles: 100 tiles + 10% = 110.
var e3 = core.estimate({ roomW: '10', roomH: '10', tileW: '12', tileH: '12', pricePerTile: '2', wastePercent: '10' });
eq('e3 tilesWithWaste', e3.tilesWithWaste, 110n);
eq('e3 subtotal', e3.money.subtotal, '220.00');

// 12.5% waste on 100 = 112.5 -> 113 (round a partial tile up).
var e3b = core.estimate({ roomW: '10', roomH: '10', tileW: '12', tileH: '12', pricePerTile: '1', wastePercent: '12.5' });
eq('e3b waste rounds up', e3b.tilesWithWaste, 113n);

// Boxes: 100 tiles + 10% = 110 needed, 12 per box -> ceil(110/12) = 10 boxes =
// 120 tiles charged. Price is then per box.
var e4 = core.estimate({ roomW: '10', roomH: '10', tileW: '12', tileH: '12',
                         pricePerTile: '30.00', tilesPerBox: 12, wastePercent: '10' });
eq('e4 boxes', e4.boxes, 10n);
eq('e4 tilesCharged', e4.tilesCharged, 120n);
eq('e4 subtotal (10 boxes * $30)', e4.money.subtotal, '300.00');

// Tax, exact: $250.00 subtotal at 8.25% -> $20.625 -> total $270.63 (half-up).
var e5 = core.estimate({ roomW: '10', roomH: '10', tileW: '12', tileH: '12',
                         pricePerTile: '2.50', taxPercent: '8.25' });
eq('e5 tax', e5.money.tax, '20.63');
eq('e5 total half-up', e5.money.total, '270.63');

// Mixed units: a 3 m x 4 m room with 30 cm x 30 cm tiles. 300/30 = 10 across,
// 400/30 = 13.33 -> 14 down -> 140 tiles by the grid.
var e6 = core.estimate({ roomW: '3', roomH: '4', roomUnit: 'm',
                         tileW: '30', tileH: '30', tileUnit: 'cm', pricePerTile: '1' });
eq('e6 grid tiles (metric)', e6.gridTiles, 140n);

// Coverage always covers the floor.
ok('e6 coverage >= room area', e6.coverageSqft.cmp(e6.roomAreaSqft) >= 0);

/* --- validation ----------------------------------------------------------- */

[{ roomW: '0', roomH: '10', tileW: '12', tileH: '12', pricePerTile: '2' },
 { roomW: '10', roomH: '10', tileW: '0', tileH: '12', pricePerTile: '2' }
].forEach(function (bad, i) {
  var threw = false;
  try { core.estimate(bad); } catch (e) { threw = true; }
  ok('estimate rejects non-positive dimension #' + i, threw);
});

/* --- invariant sweep: coverage covers, grid is enough, area never over ----- *
 * For random rooms and tiles, the grid count laid out as a rectangle of whole
 * tiles must physically span the room in both directions, and the area count
 * must never exceed the grid count. This checks the models against their
 * definitions, independently of the arithmetic that produced them. */
var rng = (function () { var s = 88172645463325252n; return function (m) {
  s ^= s << 13n & ((1n << 64n) - 1n); s ^= s >> 7n; s ^= s << 17n & ((1n << 64n) - 1n);
  return s % m;
}; })();

var sweepOK = true, checked = 0;
for (var t = 0; t < 400 && sweepOK; t++) {
  var rw = core.parseDecimal((1n + rng(4000n)).toString()).div(new F(10n));   // 0.1..400.0 in
  var rh = core.parseDecimal((1n + rng(4000n)).toString()).div(new F(10n));
  var tw = core.parseDecimal((1n + rng(240n)).toString()).div(new F(10n));    // 0.1..24.0 in
  var th = core.parseDecimal((1n + rng(240n)).toString()).div(new F(10n));

  var grid = core.tilesByGrid(rw, rh, tw, th);
  var area = core.tilesByArea(rw, rh, tw, th);

  var across = rw.div(tw).ceil(), down = rh.div(th).ceil();
  // laid-out span must reach the far wall in each direction
  if (new F(across).mul(tw).cmp(rw) < 0) sweepOK = false;
  if (new F(down).mul(th).cmp(rh) < 0) sweepOK = false;
  if (grid !== across * down) sweepOK = false;
  if (area > grid) sweepOK = false;                 // area model is the optimist
  if (area < 1n && rw.isPos() && rh.isPos()) sweepOK = false;
  checked++;
}
ok('400 random layouts: grid spans the room, area <= grid (' + checked + ' checked)', sweepOK);

/* --- report --------------------------------------------------------------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
