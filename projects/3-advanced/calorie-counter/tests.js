// tests.js — dependency-free test suite for calorie-core.js and the dataset.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const C = require('./calorie-core.js');
const foods = require('./foods.json');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function deepEq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function throwsCode(fn, code, msg) {
  let got = null;
  try { fn(); } catch (e) { got = e.code || e.message; }
  eq(got, code, msg);
}

// A small fixed fixture so relevance/ordering assertions are deterministic.
const FIX = [
  { description: 'Apple, raw, with skin', portion: '1 medium', calories: 95 },
  { description: 'Apple juice, unsweetened', portion: '1 cup', calories: 114 },
  { description: 'Pineapple, raw', portion: '1 cup', calories: 82 },
  { description: 'Green apple candy', portion: '1 piece', calories: 60 },
  { description: 'Banana, raw', portion: '1 medium', calories: 105 },
];

// --- Text helpers ---------------------------------------------------------

eq(C.normalize('  Green   APPLE '), 'green apple', 'normalize lowercases and collapses spaces');
eq(C.normalize(null), '', 'normalize handles null');
deepEq(C.tokenize('  green  apple '), ['green', 'apple'], 'tokenize splits terms');
deepEq(C.tokenize('   '), [], 'tokenize of blank is empty');

assert(C.hasWildcard('app*'), 'star is a wildcard');
assert(C.hasWildcard('b?n'), 'question mark is a wildcard');
assert(!C.hasWildcard('apple'), 'plain term has no wildcard');

eq(C.escapeRegExp('a.b+c'), 'a\\.b\\+c', 'escapeRegExp escapes regex metachars');

// --- Wildcard matching ----------------------------------------------------

assert(C.wildcardToRegExp('app*').test('apple'), 'app* matches apple');
assert(!C.wildcardToRegExp('app*').test('pineapple'), 'app* does not match pineapple (anchored)');
assert(C.wildcardToRegExp('*nut').test('peanut'), '*nut matches peanut');
assert(C.wildcardToRegExp('b?n').test('ban'), 'b?n matches ban');
assert(!C.wildcardToRegExp('b?n').test('bn'), 'b?n does not match bn (? is exactly one char)');

// --- termMatches ----------------------------------------------------------

assert(C.termMatches('apple', 'Pineapple, raw'), 'plain term is a substring match anywhere');
assert(C.termMatches('app*', 'Apple, raw'), 'wildcard term matches a whole word');
assert(!C.termMatches('app*', 'Pineapple, raw'), 'wildcard term is anchored to a word');

// --- search: empty query --------------------------------------------------

throwsCode(() => C.search(FIX, ''), 'EMPTY_QUERY', 'empty query throws EMPTY_QUERY');
throwsCode(() => C.search(FIX, '   '), 'EMPTY_QUERY', 'blank query throws EMPTY_QUERY');

// --- search: matching + ranking ------------------------------------------

const apple = C.search(FIX, 'apple');
eq(apple.matches.length, 4, 'apple matches four foods (incl. pineapple, green apple candy)');
// "Apple juice" and "Apple, raw" start with the query -> ranked before the others.
eq(apple.matches[0].description, 'Apple juice, unsweetened', 'startsWith query ranks first (alpha tiebreak)');
eq(apple.matches[1].description, 'Apple, raw, with skin', 'second startsWith match');
assert(
  apple.matches.slice(2).some((f) => f.description === 'Pineapple, raw'),
  'substring-only match ranked after startsWith matches'
);

// AND semantics across multiple terms.
const greenApple = C.search(FIX, 'green apple');
eq(greenApple.matches.length, 1, 'multi-term query requires all terms');
eq(greenApple.matches[0].description, 'Green apple candy', 'green apple -> candy only');

// No matches.
const none = C.search(FIX, 'zzzzz');
eq(none.matches.length, 0, 'nonsense query yields no matches');

// Wildcard search end to end.
const starred = C.search(FIX, 'ban*');
eq(starred.matches.length, 1, 'ban* matches banana only');
eq(starred.matches[0].description, 'Banana, raw', 'ban* -> banana');

// --- paginate -------------------------------------------------------------

eq(C.PAGE_SIZE, 25, 'default page size is 25 per the spec');

const many = Array.from({ length: 60 }, (_, i) => ({
  description: `Food ${i}`, portion: '1 unit', calories: i,
}));
const firstPage = C.paginate(many, C.PAGE_SIZE);
eq(firstPage.shown, 25, 'first page shows 25 rows');
eq(firstPage.total, 60, 'total reflects full match count');
assert(firstPage.hasMore, 'hasMore true when results exceed the page');

const secondPage = C.paginate(many, 50);
eq(secondPage.shown, 50, 'raising the limit reveals more rows');
assert(secondPage.hasMore, 'still more after 50 of 60');

const allShown = C.paginate(many, 60);
eq(allShown.shown, 60, 'limit at total shows everything');
assert(!allShown.hasMore, 'hasMore false once everything is shown');

const smallSet = C.paginate(FIX, 25);
assert(!smallSet.hasMore, 'small result set has no more pages');

// --- Dataset integrity ----------------------------------------------------

assert(C.validateFoods(foods), 'bundled foods.json passes integrity validation');
assert(foods.length >= 100, `dataset has a useful size (got ${foods.length})`);

// Descriptions should be unique so results are not confusing duplicates.
const seen = new Set();
let dupes = 0;
foods.forEach((f) => {
  const key = f.description.toLowerCase();
  if (seen.has(key)) dupes += 1;
  seen.add(key);
});
eq(dupes, 0, 'dataset has no duplicate descriptions');

// A real query against the real dataset returns something sensible.
const realApple = C.search(foods, 'apple');
assert(realApple.matches.length >= 2, 'real dataset returns multiple apple foods');
assert(
  realApple.matches.every((f) => f.description.toLowerCase().includes('apple')),
  'every apple result actually contains "apple"'
);

// validateFoods rejects a bad record.
throwsCode(
  () => C.validateFoods([{ description: 'x', portion: '1', calories: -5 }]),
  'food[0] (x) has invalid calories',
  'validateFoods rejects negative calories'
);

// --- Report ---------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
