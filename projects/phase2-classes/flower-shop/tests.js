#!/usr/bin/env node
'use strict';
/*
 * tests.js — dependency-free checks for the Flower Shop engine. Run:
 *   node tests.js
 *
 * The Classes category is about design, so these lean on the GUARANTEES the
 * design makes, not on surface output:
 *
 *   - COMPOSITE: a Flower and a Bouquet are both Saleable; a bouquet's price and
 *     stem map are built from its parts, and a bouquet can contain another
 *     bouquet. Nothing branches on which kind a line is.
 *   - EXACT MONEY: cents are integers; $2.50 + 3×$0.10 is exactly $2.80; a
 *     percentage discount rounds half-up to the cent and the saving is exact.
 *   - ATOMIC INVENTORY: an order that is short by one stem changes NOTHING —
 *     stock and register are identical before and after; a fulfillable order
 *     decrements exactly the stems used and credits exactly the price.
 *   - Invalid things are refused: abstract Saleable, negative price, empty
 *     bouquet, a bouquet containing itself, unknown flower, non-whole quantity.
 */

const core = require('./flower-core');
const { ShopError, OutOfStockError, Money, Saleable, Flower, Bouquet, Cart, Shop } = core;
const { sampleShop } = require('./flower-fixtures');

let passed = 0;
const failures = [];
function check(name, cond) { if (cond) passed++; else failures.push(name); }
function throws(name, fn, Type) {
  try { fn(); failures.push(name + ' (expected throw)'); }
  catch (e) { if (Type && !(e instanceof Type)) failures.push(`${name} (wrong type: ${e.name})`); else passed++; }
}

// --- Money: exact integer cents --------------------------------------------

check('dollars("2.50") = 250c', Money.dollars('2.50').cents === 250);
check('dollars(2.5) = 250c', Money.dollars(2.5).cents === 250);
check('dollars("$1,299.99") = 129999c', Money.dollars('$1,299.99').cents === 129999);
check('2.50 + 3×0.10 = exactly 2.80', Money.dollars('2.50').plus(Money.dollars('0.10').times(3)).equals('2.80'));
check('0.1+0.2 float trap avoided', Money.dollars('0.10').plus('0.20').equals('0.30'));
check('Money.toString pads cents', Money.dollars(5).toString() === '$5.00' && Money.dollars('0.05').toString() === '$0.05');
check('times needs whole count throws', (() => { try { Money.dollars(1).times(1.5); return false; } catch { return true; } })());
throws('dollars("abc") refused', () => Money.dollars('abc'), ShopError);
throws('dollars("1.234") refused (3 decimals)', () => Money.dollars('1.234'), ShopError);
check('lessPercent 10% off $10 = $9', Money.dollars('10.00').lessPercent(10).equals('9.00'));
// half-up rounding: 1% off $0.05 (5c) → 4.95c → rounds to 5c
check('lessPercent rounds half-up to the cent', Money.dollars('0.05').lessPercent(1).cents === 5);
check('Money is immutable', Object.isFrozen(Money.dollars(1)));

// --- Flower: the leaf -------------------------------------------------------

const rose = new Flower('Rose', { color: 'red', pricePerStem: '2.50' });
check('flower is Saleable', rose instanceof Saleable);
check('flower price = unit price', rose.price().equals('2.50'));
check('flower stems() = one of its key', rose.stems().get(rose.key) === 1 && rose.stemCount() === 1);
check('flower key includes color', rose.key === 'rose|red');
check('different-color roses have different keys',
  new Flower('Rose', { color: 'white', pricePerStem: '2.75' }).key !== rose.key);
throws('abstract Saleable refused', () => new Saleable('x'), ShopError);
throws('flower without price refused', () => new Flower('Daisy', { color: 'white' }), ShopError);
throws('negative price refused', () => new Flower('Daisy', { pricePerStem: '-1.00' }), ShopError);

// --- Bouquet: the composite -------------------------------------------------

const baby = new Flower('Baby Breath', { color: 'white', pricePerStem: '0.60' });
const dozen = new Bouquet('Dozen', { items: [[rose, 12], [baby, 6]], arrangementFee: '4.00', discountPercent: 10 });
check('bouquet is Saleable too', dozen instanceof Saleable);
// subtotal = 12×2.50 + 6×0.60 = 30.00 + 3.60 = 33.60; gross +4.00 = 37.60; −10% = 33.84
check('bouquet subtotal exact', dozen.subtotal().equals('33.60'));
check('bouquet gross = subtotal + fee', dozen.gross().equals('37.60'));
check('bouquet price = gross less discount', dozen.price().equals('33.84'));
check('bouquet discount saving exact', dozen.discount().equals('3.76'));
check('bouquet stems aggregate by key', dozen.stems().get(rose.key) === 12 && dozen.stems().get(baby.key) === 6);
check('bouquet stemCount sums', dozen.stemCount() === 18);
throws('empty bouquet refused', () => new Bouquet('Empty', { items: [] }), ShopError);
throws('non-whole qty refused', () => new Bouquet('B', { items: [[rose, 1.5]] }), ShopError);
throws('discount >100 refused', () => new Bouquet('B', { items: [[rose, 1]], discountPercent: 150 }), ShopError);

// composite: a bouquet that CONTAINS another bouquet
const grand = new Bouquet('Grand', { items: [[dozen, 1], [rose, 3]], arrangementFee: '2.00' });
check('composite price recurses', grand.price().equals(dozen.price().plus(rose.price().times(3)).plus('2.00')));
check('composite stems recurse (15 roses: 12 in dozen + 3)', grand.stems().get(rose.key) === 15);
// composite nesting is honoured two levels deep
const megaGrand = new Bouquet('Mega', { items: [[grand, 2]] });
check('two-level composite stems recurse (30 roses: 2×15)', megaGrand.stems().get(rose.key) === 30);
check('two-level composite price recurses', megaGrand.price().equals(grand.price().times(2)));

// pricing a cart never switches on kind
const cart = new Cart([[rose, 2], [dozen, 1]]);
check('cart total mixes flower + bouquet', cart.total().equals(rose.price().times(2).plus(dozen.price())));
check('cart stems aggregate across kinds', cart.stems().get(rose.key) === 2 + 12);

// --- Shop: atomic inventory -------------------------------------------------

function freshShop() {
  const s = new Shop('Test', { register: 0 });
  s.stock(rose, 20, { reorderAt: 5 }).stock(baby, 10, { reorderAt: 12 });
  return s;
}

let shop = freshShop();
check('register starts empty', shop.register.isZero());
check('canFulfill one dozen (12 rose, 6 baby)', shop.canFulfill(dozen, 1));
const receipt = shop.order(dozen, 1);
check('order returns a receipt with the price', receipt.total.equals('33.84'));
check('stock decremented by exactly the stems used', shop.stockOf(rose) === 8 && shop.stockOf(baby) === 4);
check('register credited by exactly the price', shop.register.equals('33.84'));

// atomic failure: ask for more than one stem short → NOTHING changes
shop = freshShop();
const before = { rose: shop.stockOf(rose), baby: shop.stockOf(baby), reg: shop.register.cents };
throws('over-order throws OutOfStockError', () => shop.order(dozen, 2), OutOfStockError); // needs 24 roses, has 20
check('failed order left stock untouched (atomic)',
  shop.stockOf(rose) === before.rose && shop.stockOf(baby) === before.baby);
check('failed order left register untouched (atomic)', shop.register.cents === before.reg);
// the error carries the shortfall detail
try { shop.order(dozen, 2); } catch (e) {
  check('OutOfStockError lists the short flower', e.shortfalls.some((s) => s.need === 24 && s.have === 20));
}

// unknown flower in an order is refused, not silently zero-stock
throws('ordering an unstocked flower refused',
  () => freshShop().order(new Flower('Orchid', { pricePerStem: '5.00' }), 1), ShopError);

// shortfalls() is a pure query — it must not mutate
shop = freshShop();
const q = shop.shortfalls(dozen, 2); // 24 roses > 20 and 12 baby > 10 → both short
check('shortfalls() reports both short flowers without mutating',
  q.length === 2 && shop.stockOf(rose) === 20 && shop.stockOf(baby) === 10);

// low-stock reporting
check('baby breath flagged low (10 ≤ reorder 12)', shop.lowStock().some((l) => l.flower.key === baby.key));
check('rose not flagged low (20 > reorder 5)', !shop.lowStock().some((l) => l.flower.key === rose.key));

// --- The shared sample shop round-trips -------------------------------------

const { shop: sample, bouquets } = sampleShop();
check('sample: Spring Mix fulfillable', sample.canFulfill(bouquets.springMix, 1));
const r2 = sample.checkout(new Cart([[bouquets.springMix, 1], [bouquets.dozenRoses, 1]]));
check('sample checkout credits register exactly',
  sample.register.equals(bouquets.springMix.price().plus(bouquets.dozenRoses.price())));
check('sample checkout receipt JSON round-trips', JSON.parse(JSON.stringify(r2)).total === r2.total.toString());
check('sample toJSON lists inventory', sample.toJSON().inventory.length === 6);

// --- report -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('All Flower Shop assertions passed.');
