/*
 * recipe-fixtures.js — a sample cookbook shared by all three front ends (the
 * CLI, the browser demo, and the tests). Building it here, once, keeps the demo
 * data in one place and proves the classes compose the way the screens assume.
 *
 * The sample deliberately exercises the design:
 *   - recipes across several categories (Main, Dessert, Breakfast, Drink) so
 *     the by-category grouping has something to group;
 *   - ingredients measured in all three dimensions — mass (g), volume (cup,
 *     tbsp, ml) and count (bare "2 eggs") — plus "to taste" lines with no
 *     quantity, so scaling and the pantry check both get a real workout;
 *   - overlapping ingredients (flour, sugar, butter appear in more than one
 *     recipe) so the by-ingredient index maps one key to several recipes.
 */
'use strict';

function buildCookbook(core) {
  const { RecipeBook, Recipe, Pantry } = core;
  const book = new RecipeBook('Weeknight Cookbook');

  book.add(new Recipe('Classic Pancakes', {
    category: 'Breakfast', servings: 4, mainIngredient: 'flour',
    ingredients: [
      ['flour', '1 1/2 cup'],
      ['milk', '1 1/4 cup'],
      ['eggs', '2'],
      ['butter', '3 tbsp', 'melted'],
      ['sugar', '1 tbsp'],
      ['baking powder', '2 tsp'],
      ['salt'],
    ],
    instructions: [
      'Whisk the dry ingredients together.',
      'Beat in the milk, eggs and melted butter until just combined.',
      'Cook 1/4-cup portions on a hot griddle until bubbles form, then flip.',
    ],
  }));

  book.add(new Recipe('Chocolate Chip Cookies', {
    category: 'Dessert', servings: 24, mainIngredient: 'flour',
    ingredients: [
      ['flour', '2 1/4 cup'],
      ['butter', '1 cup', 'softened'],
      ['sugar', '3/4 cup'],
      ['brown sugar', '3/4 cup'],
      ['eggs', '2'],
      ['chocolate chips', '2 cup'],
      ['vanilla', '1 tsp'],
      ['baking soda', '1 tsp'],
      ['salt'],
    ],
    instructions: [
      'Cream the butter with both sugars.',
      'Beat in the eggs and vanilla, then the dry ingredients.',
      'Fold in the chocolate chips and bake at 190°C for 10 minutes.',
    ],
  }));

  book.add(new Recipe('Tomato Basil Pasta', {
    category: 'Main', servings: 4, mainIngredient: 'pasta',
    ingredients: [
      ['pasta', '400 g'],
      ['tomatoes', '800 g', 'crushed'],
      ['garlic', '3 clove'],
      ['olive oil', '3 tbsp'],
      ['basil', '1 cup', 'torn'],
      ['salt'],
      ['pepper'],
    ],
    instructions: [
      'Soften the garlic in the olive oil.',
      'Add the tomatoes and simmer 15 minutes; season.',
      'Toss with cooked pasta and the basil.',
    ],
  }));

  book.add(new Recipe('Garlic Butter Rice', {
    category: 'Main', servings: 4, mainIngredient: 'rice',
    ingredients: [
      ['rice', '300 g'],
      ['butter', '2 tbsp'],
      ['garlic', '2 clove'],
      ['water', '600 ml'],
      ['salt'],
    ],
    instructions: [
      'Sauté the garlic in butter.',
      'Stir in the rice, add the water, cover and cook 18 minutes.',
    ],
  }));

  book.add(new Recipe('Lemonade', {
    category: 'Drink', servings: 8, mainIngredient: 'lemon juice',
    ingredients: [
      ['lemon juice', '2 cup'],
      ['sugar', '1 cup'],
      ['water', '6 cup'],
    ],
    instructions: [
      'Dissolve the sugar in a little warm water to make a syrup.',
      'Stir in the lemon juice and the rest of the water; chill.',
    ],
  }));

  return book;
}

// A sample pantry chosen to show every verdict the "what can I make?" query can
// return, one clean example each:
//   - Pancakes and Garlic Butter Rice are fully MAKEABLE;
//   - Chocolate Chip Cookies are blocked by a MISSING item (no brown sugar);
//   - Lemonade is blocked by a SHORT item (1 cup of lemon juice, needs 2);
//   - Tomato Basil Pasta is blocked by an INCOMPARABLE unit ("6 tomatoes" by
//     count against a recipe that asks for 800 g — no density, so no guess).
// Where a comparison should succeed it is stocked in a compatible dimension
// (milk in litres vs a recipe in cups is fine — both are volume).
function buildPantry(core) {
  const { Pantry } = core;
  return new Pantry()
    .add('flour', '6 cup')
    .add('sugar', '2 cup')
    .add('butter', '2 cup')
    .add('eggs', '12')
    .add('milk', '2 l')              // litres vs the recipe's cups — same dimension, converts fine
    .add('chocolate chips', '3 cup')
    .add('vanilla', '1 floz')
    .add('baking powder', '1 cup')
    .add('baking soda', '1 cup')
    .add('rice', '1 kg')
    .add('garlic', '1 dozen')
    .add('water', '5 l')
    .add('lemon juice', '1 cup')     // the lemonade needs 2 cup → SHORT
    .add('pasta', '1 kg')
    .add('tomatoes', '6')            // a bare count vs the recipe's 800 g → INCOMPARABLE
    .add('olive oil', '1 cup')
    .add('basil', '2 cup')
    .add('salt')                     // present, unmeasured — covers "to taste"
    .add('pepper');
  // (brown sugar is deliberately NOT stocked — that is what blocks the cookies)
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildCookbook, buildPantry };
if (typeof window !== 'undefined') window.RecipeFixtures = { buildCookbook, buildPantry };
