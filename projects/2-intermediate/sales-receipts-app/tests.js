/*
 * tests.js — dependency-free tests for the pure receipt logic.
 *
 * Run standalone:   node tests.js
 * Or under Jest:    npx jest tests.js   (the describe/it/expect shim is skipped
 *                                        when Jest supplies the real globals)
 */
'use strict';

var Core = require('./receipt-core');
var INVENTORY = require('./inventory');

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
  { itemNo: 1, description: 'Coffee', unitPrice: 2.50 },
  { itemNo: 2, description: 'Bagel',  unitPrice: 2.75 },
  { itemNo: 3, description: 'Penny',  unitPrice: 0.01 }
];

/* ---- tests ------------------------------------------------------------- */
it('toCents avoids float drift', function () {
  expect(Core.toCents(0.01) + Core.toCents(0.07)).toBe(8); // classic 0.1+0.2 trap
});

it('formatMoney pads and signs correctly', function () {
  expect(Core.formatMoney(0)).toBe('$0.00');
  expect(Core.formatMoney(250)).toBe('$2.50');
  expect(Core.formatMoney(-99)).toBe('-$0.99');
});

it('addItem appends a new line with qty 1', function () {
  var c = Core.addItem([], INV, 1);
  expect(c).toEqual([{ itemNo: 1, description: 'Coffee', unitPrice: 2.50, qty: 1 }]);
});

it('addItem bumps qty for a repeated item, not a duplicate line', function () {
  var c = Core.addItem(Core.addItem([], INV, 1), INV, 1);
  expect(c.length).toBe(1);
  expect(c[0].qty).toBe(2);
});

it('addItem does not mutate the input cart', function () {
  var a = [];
  var b = Core.addItem(a, INV, 1);
  expect(a.length).toBe(0);
  expect(b.length).toBe(1);
});

it('addItem throws on an unknown item number', function () {
  expect(function () { Core.addItem([], INV, 999); }).toThrow();
});

it('totalCents sums quantities and prices', function () {
  var c = Core.addItem(Core.addItem(Core.addItem([], INV, 1), INV, 1), INV, 2);
  expect(Core.totalCents(c)).toBe(2 * 250 + 275); // 775
  expect(Core.itemCount(c)).toBe(3);
});

it('clearEntry decrements the last line, then removes it', function () {
  var c = Core.addItem(Core.addItem([], INV, 1), INV, 1); // Coffee x2
  c = Core.clearEntry(c);
  expect(c[0].qty).toBe(1);
  c = Core.clearEntry(c);
  expect(c.length).toBe(0);
});

it('clearEntry on an empty cart is a no-op', function () {
  expect(Core.clearEntry([])).toEqual([]);
});

it('cancelAll empties the cart', function () {
  expect(Core.cancelAll()).toEqual([]);
});

it('buildReceipt freezes the cart with a passed-in timestamp', function () {
  var c = Core.addItem([], INV, 2);
  var r = Core.buildReceipt(c, 1700000000000, '  Ada  ');
  expect(r.timestamp).toBe(1700000000000);
  expect(r.customer).toBe('Ada');       // trimmed
  expect(r.totalCents).toBe(275);
  expect(r.itemCount).toBe(1);
  expect(r.items[0].lineTotalCents).toBe(275);
});

it('buildReceipt defaults a blank customer to Guest', function () {
  var r = Core.buildReceipt(Core.addItem([], INV, 1), 0, '   ');
  expect(r.customer).toBe('Guest');
});

it('buildReceipt refuses an empty cart', function () {
  expect(function () { Core.buildReceipt([], 0, 'x'); }).toThrow();
});

it('summarize rolls up multiple receipts', function () {
  var r1 = Core.buildReceipt(Core.addItem([], INV, 1), 1, 'a'); // 250
  var r2 = Core.buildReceipt(Core.addItem([], INV, 2), 2, 'b'); // 275
  var s = Core.summarize([r1, r2]);
  expect(s).toEqual({ totalCents: 525, itemCount: 2, receiptCount: 2 });
});

it('summarize of nothing is all zeros', function () {
  expect(Core.summarize([])).toEqual({ totalCents: 0, itemCount: 0, receiptCount: 0 });
});

it('the shipped inventory has unique item numbers', function () {
  var seen = {};
  INVENTORY.forEach(function (i) {
    if (seen[i.itemNo]) throw new Error('duplicate itemNo ' + i.itemNo);
    seen[i.itemNo] = true;
  });
  expect(INVENTORY.length > 0).toBe(true);
});

/* ---- report (standalone only) ------------------------------------------ */
if (!usingJest) {
  if (failed === 0) console.log('\nAll ' + passed + ' tests passed.');
  else { console.log('\n' + passed + ' passed, ' + failed + ' failed.'); process.exit(1); }
}
