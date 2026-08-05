/*
 * tests.js — dependency-free tests for the pure store logic.
 *
 * Run standalone:   node tests.js
 * Or under Jest:    npx jest tests.js   (the describe/it/expect shim is skipped
 *                                        when Jest supplies the real globals)
 */
'use strict';

var Core = require('./store-core');
var CATALOG = require('./catalog');

/* ---- minimal test harness (used only outside Jest) --------------------- */
var usingJest = typeof global.it === 'function' && typeof global.expect === 'function';
var passed = 0, failed = 0;

function it(name, fn) {
  try { fn(); passed++; if (!usingJest) console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}
function expect(actual) {
  return {
    toBe: function (exp) {
      if (actual !== exp) throw new Error('expected ' + JSON.stringify(exp) + ', got ' + JSON.stringify(actual));
    },
    toEqual: function (exp) {
      if (JSON.stringify(actual) !== JSON.stringify(exp))
        throw new Error('expected ' + JSON.stringify(exp) + ', got ' + JSON.stringify(actual));
    },
    toThrow: function () {
      var threw = false;
      try { actual(); } catch (_) { threw = true; }
      if (!threw) throw new Error('expected function to throw');
    }
  };
}
if (usingJest) { it = global.it; expect = global.expect; }

/* ---- fixtures ---------------------------------------------------------- */
var INV = [
  { id: 'A', name: 'Apple',  price: 100, stock: 5 },
  { id: 'B', name: 'Banana', price: 250, stock: 3 },
  { id: 'C', name: 'Cherry', price: 999 }   // no stock cap
];
var BY_ID = Core.indexCatalog(INV);

/* ---- tests ------------------------------------------------------------- */
it('indexCatalog builds an id lookup and rejects duplicates', function () {
  expect(BY_ID.A.name).toBe('Apple');
  expect(function () { Core.indexCatalog([{ id: 'X' }, { id: 'X' }]); }).toThrow();
});

it('addToCart is immutable and accumulates quantity', function () {
  var c0 = {};
  var c1 = Core.addToCart(c0, INV[0]);       // +1 Apple
  var c2 = Core.addToCart(c1, INV[0], 2);    // +2 Apple
  expect(c0).toEqual({});                     // original untouched
  expect(c1).toEqual({ A: 1 });
  expect(c2).toEqual({ A: 3 });
});

it('addToCart clamps to available stock', function () {
  var c = Core.addToCart({}, INV[1], 10);     // Banana stock is 3
  expect(c).toEqual({ B: 3 });
});

it('addToCart rejects non-positive quantities', function () {
  expect(function () { Core.addToCart({}, INV[0], 0); }).toThrow();
  expect(function () { Core.addToCart({}, INV[0], -1); }).toThrow();
});

it('setQuantity updates, floors, and removes on zero', function () {
  expect(Core.setQuantity({ A: 1 }, 'A', 4)).toEqual({ A: 4 });
  expect(Core.setQuantity({ A: 1 }, 'A', 2.9)).toEqual({ A: 2 });
  expect(Core.setQuantity({ A: 1, B: 2 }, 'A', 0)).toEqual({ B: 2 });
});

it('removeFromCart drops a line without touching the original', function () {
  var c = { A: 1, B: 2 };
  expect(Core.removeFromCart(c, 'A')).toEqual({ B: 2 });
  expect(c).toEqual({ A: 1, B: 2 });
});

it('itemCount sums units across lines', function () {
  expect(Core.itemCount({})).toBe(0);
  expect(Core.itemCount({ A: 3, B: 2 })).toBe(5);
});

it('lineItems expands the cart and skips unknown ids', function () {
  var lines = Core.lineItems({ A: 2, ZZZ: 9 }, BY_ID);
  expect(lines).toEqual([{ id: 'A', name: 'Apple', price: 100, qty: 2, subtotal: 200 }]);
});

it('cartTotal sums quantity x unit price', function () {
  // 2 Apples (200) + 1 Banana (250) + 3 Cherries (2997) = 3447
  expect(Core.cartTotal({ A: 2, B: 1, C: 3 }, BY_ID)).toBe(3447);
  expect(Core.cartTotal({}, BY_ID)).toBe(0);
});

it('formatMoney renders cents as dollar strings', function () {
  expect(Core.formatMoney(0)).toBe('$0.00');
  expect(Core.formatMoney(5)).toBe('$0.05');
  expect(Core.formatMoney(1999)).toBe('$19.99');
  expect(Core.formatMoney(100000)).toBe('$1000.00');
});

it('confirmationNumber is deterministic for a given cart + seed', function () {
  var a = Core.confirmationNumber({ A: 2, B: 1 }, 42);
  var b = Core.confirmationNumber({ A: 2, B: 1 }, 42);
  expect(a).toBe(b);
  expect(a.slice(0, 4)).toBe('ORD-');
  expect(a.length).toBe(10);
});

it('placeOrder returns an order record and rejects an empty cart', function () {
  var order = Core.placeOrder({ A: 2, B: 1 }, BY_ID, 7);
  expect(order.itemCount).toBe(3);
  expect(order.total).toBe(450);
  expect(order.lines.length).toBe(2);
  expect(order.confirmation.slice(0, 4)).toBe('ORD-');
  expect(function () { Core.placeOrder({}, BY_ID, 7); }).toThrow();
});

it('the shipped catalog has unique ids and positive prices', function () {
  var seen = {};
  CATALOG.forEach(function (p) {
    if (seen[p.id]) throw new Error('duplicate id in catalog: ' + p.id);
    seen[p.id] = true;
    if (!(p.price > 0)) throw new Error('non-positive price for ' + p.id);
  });
  expect(CATALOG.length > 0).toBe(true);
});

/* ---- summary ----------------------------------------------------------- */
if (!usingJest) {
  console.log('\n' + (failed ? '✗ ' + failed + ' failed, ' : 'All ') +
    passed + (failed ? ' passed' : ' tests passed') + '.');
  process.exit(failed ? 1 : 0);
}
