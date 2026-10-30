#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the recipe engine. Run: node tests.js
 *
 * The Classes category is about design, so these tests lean on what the design
 * is supposed to guarantee: a Quantity is an exact amount with a unit (sums and
 * scales are exact, conversions are exact, cross-dimension math is refused not
 * guessed), a Recipe scales to a new serving count exactly (4→6→4 is a round
 * trip), the RecipeBook's by-category / by-ingredient indexes are DERIVED and
 * always equal a fresh rebuild (add and remove keep them in lock-step), and the
 * "what can I make?" query is unit-aware and honest about what it can't compare.
 */
'use strict';

const core = require('./recipe-core');
const { RecipeError, Rational, Units, Quantity, Ingredient, Recipe, Pantry, RecipeBook } = core;
const fixtures = require('./recipe-fixtures');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throwsErr(fn, msg) {
  try { fn(); fail++; console.error('  FAIL (no throw):', msg); }
  catch (e) { ok(e instanceof RecipeError, `${msg} — threw ${e.name}: ${e.message}`); }
}

/* --- Rational: exact fractions --------------------------------------- */
eq(Rational.from('1/2').add('1/4').toString(), '3/4', '1/2 + 1/4 is exactly 3/4');
eq(Rational.from('1.5').toString(), '1 1/2', '1.5 parses to 3/2, shown as the mixed 1 1/2');
eq(Rational.from('1 1/2').toString(), '1 1/2', 'the mixed number 1 1/2 round-trips');
eq(Rational.from('1.5').mul('2').toString(), '3', '1 1/2 × 2 is exactly 3');
eq(Rational.from('2/4').toString(), '1/2', 'fractions reduce');
eq(new Rational(1n, 3n).mul(3n).toString(), '1', '1/3 × 3 is exactly 1 (no float drift)');
eq(Rational.from('0.1').add('0.2').toString(), '3/10', '0.1 + 0.2 is exactly 3/10, not 0.30000000000000004');
eq(Rational.from('3/4').toDecimal(2), '0.75', '3/4 renders as 0.75');
eq(Rational.from('2/3').toDecimal(2), '0.67', '2/3 rounds half-up to 0.67');
eq(Rational.from('5').toString(), '5', 'an integer stays whole');
eq(Rational.from('3/2').cmp('1'), 1, '3/2 > 1');
eq(Rational.from('1/2').cmp('1/2'), 0, '1/2 == 1/2');
throwsErr(() => new Rational(1n, 0n), 'a zero denominator is refused');
throwsErr(() => Rational.from('abc'), 'junk is not a quantity');

/* --- Units & Quantity: exact, dimension-aware ------------------------ */
eq(Units.dimensionOf('cup'), 'volume', 'a cup is a volume');
eq(Units.dimensionOf('g'), 'mass', 'a gram is a mass');
eq(Units.dimensionOf(null), 'count', 'a bare number is a count');
eq(Units.canon('cups'), 'cup', 'the plural "cups" folds to "cup"');
eq(Units.canon('grams'), 'g', '"grams" folds to the canonical g');

eq(new Quantity('1', 'kg').convertTo('g').toString(), '1000 g', '1 kg is exactly 1000 g');
eq(new Quantity('1000', 'g').convertTo('kg').toString(), '1 kg', '1000 g is exactly 1 kg');
eq(new Quantity('1', 'cup').convertTo('tbsp').toString(), '16 tbsp', '1 cup is exactly 16 tbsp');
eq(new Quantity('3', 'tsp').convertTo('tbsp').toString(), '1 tbsp', '3 tsp is exactly 1 tbsp');
eq(new Quantity('1', 'l').convertTo('ml').toString(), '1000 ml', '1 L is 1000 ml');
// a round trip through another unit returns the original amount exactly:
eq(new Quantity('2', 'cup').convertTo('ml').convertTo('cup').toString(), '2 cup', 'cup→ml→cup is a lossless round trip');

eq(new Quantity('1/2', 'cup').add(new Quantity('1/4', 'cup')).toString(), '3/4 cup', '1/2 cup + 1/4 cup is 3/4 cup');
eq(new Quantity('250', 'g').add(new Quantity('1', 'kg')).toString(), '1250 g', '250 g + 1 kg = 1250 g (converted to the left unit)');
eq(new Quantity('2', 'cup').scale('3/2').toString(), '3 cup', 'scaling 2 cup by 3/2 gives 3 cup');
eq(new Quantity('1', 'kg').cmp(new Quantity('500', 'g')), 1, '1 kg > 500 g');
ok(new Quantity('1', 'kg').covers(new Quantity('900', 'g')), '1 kg covers a 900 g need');
ok(!new Quantity('400', 'g').covers(new Quantity('1', 'kg')), '400 g does not cover a 1 kg need');

throwsErr(() => new Quantity('1', 'cup').convertTo('g'), 'volume cannot convert to mass');
throwsErr(() => new Quantity('1', 'cup').add(new Quantity('1', 'g')), 'cannot add a volume and a mass');
throwsErr(() => new Quantity('1', 'cup').cmp(new Quantity('1', 'g')), 'cannot compare a volume and a mass');
throwsErr(() => new Quantity('-1', 'g'), 'a negative quantity is refused');
throwsErr(() => new Quantity('1', 'furlong'), 'an unknown unit is refused');

eq(Quantity.parse('1 1/2 cup').toString(), '1 1/2 cup', 'parses a mixed quantity with a unit');
eq(Quantity.parse('200 g').toString(), '200 g', 'parses a mass quantity');
eq(Quantity.parse('3').toString(), '3', 'parses a bare count');
eq(Quantity.parse('3 eggs').unit, null, '"3 eggs" is a count — "eggs" is not a unit');

/* --- Ingredient: measured vs "to taste" ------------------------------ */
const salt = new Ingredient('Salt');
ok(!salt.measured, '"Salt" with no quantity is a to-taste ingredient');
eq(salt.key, 'salt', 'the index key is the lower-cased item');
const flour = new Ingredient('Flour', '2 cup');
ok(flour.measured, 'flour with a quantity is measured');
eq(flour.scale('1/2').quantity.toString(), '1 cup', 'halving 2 cup of flour gives 1 cup');
eq(salt.scale(10).measured, false, 'scaling a to-taste ingredient leaves it unmeasured');
throwsErr(() => new Ingredient(''), 'an ingredient needs a name');

/* --- Recipe: exact serving scaling ----------------------------------- */
const pancakes = new Recipe('Pancakes', {
  category: 'Breakfast', servings: 4,
  ingredients: [['flour', '1 1/2 cup'], ['milk', '1 1/4 cup'], ['eggs', '2'], ['salt']],
  instructions: ['Mix.', 'Cook.'],
});
eq(pancakes.id, 'pancakes', 'the id is a slug of the title');
eq(pancakes.mainIngredient, 'flour', 'the main ingredient defaults to the first listed');
eq(pancakes.servings, 4, 'the recipe is written for 4');

const big = pancakes.scaleToServings(6);
eq(big.servings, 6, 'scaled to 6 servings');
eq(big.ingredients[0].quantity.toString(), '2 1/4 cup', '1 1/2 cup × 6/4 = 2 1/4 cup (exact)');
eq(big.ingredients[1].quantity.toString(), '1 7/8 cup', '1 1/4 cup × 6/4 = 1 7/8 cup (exact)');
eq(big.ingredients[2].quantity.toString(), '3', '2 eggs × 6/4 = 3 eggs');
ok(!big.ingredients[3].measured, 'the to-taste salt is still to taste after scaling');
// the round trip: 4 → 6 → 4 restores every amount exactly.
const back = big.scaleToServings(4);
eq(back.ingredients[0].quantity.toString(), '1 1/2 cup', 'scaling 4→6→4 restores 1 1/2 cup exactly');
eq(back.ingredients[1].quantity.toString(), '1 1/4 cup', 'scaling 4→6→4 restores 1 1/4 cup exactly');
ok(pancakes !== big && pancakes.ingredients[0].quantity.toString() === '1 1/2 cup', 'scaling returns a NEW recipe; the original is untouched');
eq(pancakes.scaleBy(2).ingredients[0].quantity.toString(), '3 cup', 'scaleBy(2) doubles the flour');
throwsErr(() => pancakes.scaleToServings(0), 'cannot scale to 0 servings');
throwsErr(() => pancakes.scaleBy(0), 'cannot scale by 0');
throwsErr(() => new Recipe('Empty', { ingredients: [] }), 'a recipe needs at least one ingredient');
throwsErr(() => new Recipe('', { ingredients: [['x']] }), 'a recipe needs a title');

/* --- RecipeBook: derived indexes stay in lock-step ------------------- */
const book = new RecipeBook('Test Book');
book.add(pancakes);
book.add(new Recipe('Waffles', { category: 'Breakfast', servings: 2, ingredients: [['flour', '1 cup'], ['eggs', '2']] }));
book.add(new Recipe('Omelette', { category: 'Breakfast', servings: 1, mainIngredient: 'eggs', ingredients: [['eggs', '3'], ['cheese', '50 g']] }));
eq(book.size, 3, 'three recipes in the book');
eq(book.byCategory('Breakfast').length, 3, 'all three are Breakfast');
eq(book.withIngredient('flour').length, 2, 'two recipes use flour (pancakes, waffles)');
eq(book.withIngredient('eggs').length, 3, 'all three use eggs');
eq(book.byMainIngredient('eggs').length, 1, 'only the omelette has eggs as its main ingredient');
eq(book.search({ ingredients: ['flour', 'eggs'] }).length, 2, 'flour AND eggs matches pancakes + waffles');
eq(book.search({ category: 'Breakfast', ingredients: ['cheese'] }).length, 1, 'Breakfast AND cheese is just the omelette');
eq(book.search({ text: 'waff' }).length, 1, 'a title text search finds the waffles');
throwsErr(() => book.add(pancakes), 'a duplicate recipe id is refused');

// The invariant: the live indexes equal a fresh rebuild, before and after a remove.
function indexSnapshot(b) {
  const dump = (m) => [...m.entries()].map(([k, s]) => `${k}:${[...s].sort().join(',')}`).sort().join('|');
  return [dump(b._byCategory), dump(b._byIngredient), dump(b._byMain)].join('||');
}
const liveBefore = indexSnapshot(book);
book._reindex();
eq(indexSnapshot(book), liveBefore, 'the live indexes equal a full reindex');

book.remove('waffles');
eq(book.size, 2, 'removing a recipe shrinks the book');
eq(book.withIngredient('flour').length, 1, 'after removing waffles, only pancakes uses flour');
const liveAfter = indexSnapshot(book);
book._reindex();
eq(indexSnapshot(book), liveAfter, 'the indexes still equal a reindex after a remove');
throwsErr(() => book.get('waffles'), 'the removed recipe is gone');

// grouping: the two organisations the brief asks for.
const groups = book.groupByCategory();
ok(groups.has('Breakfast') && groups.get('Breakfast').length === 2, 'groupByCategory collects the two remaining Breakfast recipes');

/* --- Pantry & "what can I make?" — unit-aware and honest -------------- */
const pantry = new Pantry()
  .add('flour', '500 g')     // NOTE: pancakes ask for flour in CUPS → incomparable
  .add('eggs', '6')
  .add('cheese', '100 g')
  .add('salt');              // present, unmeasured → covers "to taste"

eq(pantry.quantityOf('eggs').toString(), '6', 'the pantry holds 6 eggs');
pantry.add('eggs', '6');
eq(pantry.quantityOf('eggs').toString(), '12', 'adding 6 more eggs sums to a dozen');

// Omelette needs 3 eggs + 50 g cheese; the pantry has 12 eggs + 100 g cheese.
const omelette = book.get('omelette');
const vMake = pantry.satisfies(omelette.ingredients[0]);
ok(vMake.ok && vMake.reason === 'have', 'the pantry has enough eggs for the omelette');
ok(pantry.satisfies(omelette.ingredients[1]).ok, 'and enough cheese');

const results = book.whatCanIMake(pantry);
const omeletteResult = results.find((r) => r.recipe.id === 'omelette');
ok(omeletteResult.ok, 'the omelette is makeable from the pantry');
ok(book.makeable(pantry).some((r) => r.id === 'omelette'), 'the omelette is in the makeable list');

// Pancakes: flour is asked for in cups, pantry has grams → honest "incomparable".
const pancakeResult = results.find((r) => r.recipe.id === 'pancakes');
ok(!pancakeResult.ok, 'the pancakes are NOT reported makeable');
ok(pancakeResult.blockers.some((b) => b.reason === 'incomparable' && b.item.toLowerCase() === 'flour'),
  'the blocker is an honest "incomparable" (cups vs grams), not a silent pass/fail');

// A missing ingredient reads as "missing", and being short reads as "short".
const bare = new Pantry().add('eggs', '1');
const short = bare.satisfies(new Ingredient('eggs', '3'));
ok(!short.ok && short.reason === 'short', '1 egg against a need of 3 is "short"');
const absent = bare.satisfies(new Ingredient('flour', '1 cup'));
ok(!absent.ok && absent.reason === 'missing', 'an ingredient not in the pantry is "missing"');
ok(bare.satisfies(new Ingredient('eggs', '1')).ok, '1 egg covers a need of exactly 1');
throwsErr(() => book.whatCanIMake({}), 'whatCanIMake needs a real Pantry');

/* --- the shipped fixtures build and compose -------------------------- */
const demo = fixtures.buildCookbook(core);
eq(demo.size, 5, 'the sample cookbook has five recipes');
ok(demo.categories().includes('Dessert'), 'the sample has a Dessert category');
ok(demo.withIngredient('flour').length >= 2, 'flour spans more than one sample recipe');
const demoPantry = fixtures.buildPantry(core);
ok(demo.whatCanIMake(demoPantry).length === demo.size, 'every sample recipe gets a verdict');
eq(JSON.parse(JSON.stringify(demo.toJSON())).recipes.length, 5, 'the cookbook round-trips through JSON');

/* --- report ---------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
