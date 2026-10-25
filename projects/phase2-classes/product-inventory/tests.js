#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the inventory engine. Run: node tests.js
 *
 * The Classes category is about design, so these tests lean on the two things
 * the design is supposed to guarantee: money stays exact (integer cents, never
 * float drift), and a Product/Inventory can't be driven into a bad state
 * (negative stock, oversell, duplicate ids, blank fields). The last block is
 * the classic float trap, proved to NOT happen here.
 */
'use strict';

const { InventoryError, Money, Product, Inventory } = require('./inventory-core');
const { CATALOGUE } = require('./inventory-fixtures');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throwsErr(fn, msg) {
  try { fn(); fail++; console.error('  FAIL (no throw):', msg); }
  catch (e) { ok(e instanceof InventoryError, `${msg} — threw ${e.name}, want InventoryError`); }
}

/* --- Money: parse and format round-trip, reject junk --------------- */
console.log('Money');
eq(Money.parse('12.34'), 1234, 'parse dollars.cents');
eq(Money.parse('12'), 1200, 'parse whole dollars');
eq(Money.parse('12.3'), 1230, 'parse one decimal place');
eq(Money.parse('$1,299.00'), 129900, 'parse with $ and thousands comma');
eq(Money.parse(0.1) + Money.parse(0.2), 30, '0.1 + 0.2 in cents is exactly 30');
eq(Money.format(1234), '$12.34', 'format cents');
eq(Money.format(129900), '$1,299.00', 'format with thousands separator');
eq(Money.format(-500), '-$5.00', 'format negative keeps sign outside $');
throwsErr(() => Money.parse('12.345'), 'reject three decimal places');
throwsErr(() => Money.parse('abc'), 'reject non-numeric');
throwsErr(() => Money.parse(Infinity), 'reject non-finite number');

/* --- Product: invariants in the constructor and methods ------------ */
console.log('Product');
const p = new Product({ id: 'X-1', name: 'Widget', price: '2.50', quantity: 10 });
eq(p.priceCents, 250, 'price parsed to cents');
eq(p.quantity, 10, 'initial quantity via receive');
eq(p.lineValue(), 2500, 'line value = price * qty');

p.receive(5);
eq(p.quantity, 15, 'receive adds stock');
p.ship(4);
eq(p.quantity, 11, 'ship removes stock');

throwsErr(() => p.ship(999), 'ship refuses to oversell');
eq(p.quantity, 11, 'failed ship left stock unchanged');
throwsErr(() => p.receive(-1), 'receive rejects negative');
throwsErr(() => p.receive(2.5), 'receive rejects fractional units');
throwsErr(() => new Product({ id: '', name: 'x', price: 1 }), 'blank id rejected');
throwsErr(() => new Product({ id: 'y', name: '', price: 1 }), 'blank name rejected');
throwsErr(() => new Product({ id: 'z', name: 'z', price: -1 }), 'negative price rejected');

// Quantity has no setter — in strict mode assigning it throws, and either
// way the real count must be untouched.
let assignThrew = false;
try { p.quantity = -100; } catch (_) { assignThrew = true; }
ok(assignThrew, 'quantity is read-only; assignment rejected');
eq(p.quantity, 11, 'stray assignment left the real count intact');

/* --- Inventory: aggregate behaviour -------------------------------- */
console.log('Inventory');
const inv = new Inventory();
for (const spec of CATALOGUE) inv.add(spec);
eq(inv.size, CATALOGUE.length, 'all fixtures added');

throwsErr(() => inv.add({ id: 'A-100', name: 'dup', price: 1 }), 'duplicate id rejected');
throwsErr(() => inv.get('NOPE'), 'get on missing id throws');
throwsErr(() => inv.ship('NOPE', 1), 'ship on missing id throws');

// Total value: compute the expected sum independently, in cents.
let expected = 0;
for (const s of CATALOGUE) expected += Money.parse(s.price) * s.quantity;
eq(inv.totalValueCents(), expected, 'total value matches hand sum');

const unitsExpected = CATALOGUE.reduce((n, s) => n + s.quantity, 0);
eq(inv.totalUnits(), unitsExpected, 'total units matches hand sum');

// Low stock at threshold 5: B-044 (0), A-310 (3), C-915 (5), ordered by qty.
const low = inv.lowStock(5).map((x) => x.id);
eq(JSON.stringify(low), JSON.stringify(['B-044', 'A-310', 'C-915']), 'low-stock report ordered by qty');

// byValue: most expensive line first.
const top = inv.byValue()[0];
ok(top.lineValue() >= inv.byValue()[1].lineValue(), 'byValue sorts descending');

// Mutating through the inventory updates the single source of truth.
const beforeVal = inv.totalValueCents();
inv.ship('A-100', 40);
eq(inv.get('A-100').quantity, 200, 'inventory.ship reaches the product');
eq(inv.totalValueCents(), beforeVal - Money.parse('8.99') * 40, 'total reflects the shipment exactly');

inv.remove('B-044');
ok(!inv.has('B-044'), 'remove deletes the sku');
eq(inv.size, CATALOGUE.length - 1, 'size drops after remove');

/* --- The float trap, proved absent -------------------------------- */
console.log('No float drift');
// 10 cents of something, bought 3 times: naive floats give 0.30000000000000004.
const drift = new Inventory();
drift.add({ id: 'D', name: 'dime item', price: '0.10', quantity: 0 });
drift.receive('D', 3);
eq(drift.totalValueCents(), 30, '3 * $0.10 is exactly $0.30 (30 cents)');
eq(Money.format(drift.totalValueCents()), '$0.30', 'formatted exactly, no 0.30000004');

/* --- JSON shape ---------------------------------------------------- */
console.log('Serialization');
const json = inv.toJSON();
ok(Array.isArray(json.products) && json.products.length === inv.size, 'toJSON lists every product');
ok(json.summary.totalValueCents === inv.totalValueCents(), 'summary total matches');

/* ------------------------------------------------------------------ */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
