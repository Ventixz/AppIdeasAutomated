// calorie-core.js — the presentation-free search engine for the Calorie Counter.
//
// It knows nothing about the DOM, events, or how food data is loaded. It takes a
// plain array of food records and a query string and returns matches, ranked and
// paginated. Everything here is a pure function, so the same code runs in the
// browser and in the Node test suite (tests.js).
//
// A food record is: { description: string, portion: string, calories: number }.

'use strict';

// The results panel shows at most this many rows before the "load more" control
// is needed (per the app-ideas spec: "scrollable panel (max 25 entries)").
const PAGE_SIZE = 25;

// --- Text helpers ---------------------------------------------------------

// Lower-case, trim, and collapse internal runs of whitespace to a single space.
function normalize(str) {
  return String(str == null ? '' : str)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Split a normalized query into individual search terms.
function tokenize(query) {
  const n = normalize(query);
  return n === '' ? [] : n.split(' ');
}

// True if a term uses wildcard syntax: `*` (zero or more chars) or `?` (one char).
function hasWildcard(term) {
  return term.indexOf('*') !== -1 || term.indexOf('?') !== -1;
}

// Escape the RegExp metacharacters we do NOT treat as wildcards.
function escapeRegExp(str) {
  return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

// Build an anchored RegExp from a wildcard term: `*` -> `.*`, `?` -> `.`.
// Anchored so a wildcard term is matched against a whole word, e.g. `app*`
// matches the word "apple" but not "pineapple".
function wildcardToRegExp(term) {
  const body = escapeRegExp(term).replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + body + '$');
}

// Does a single term match a food description?
//   - plain term      -> case-insensitive substring match anywhere
//   - wildcard term   -> matches any single word of the description
function termMatches(term, description) {
  const text = normalize(description);
  if (!hasWildcard(term)) {
    return text.indexOf(term) !== -1;
  }
  const re = wildcardToRegExp(term);
  return text.split(' ').some((word) => re.test(word));
}

// A food matches the query when EVERY term matches (logical AND).
function foodMatches(terms, food) {
  return terms.every((t) => termMatches(t, food.description));
}

// --- Ranking --------------------------------------------------------------

// Lower score = more relevant. We favour descriptions that begin with the whole
// query, then those with a word starting with the first term, then the rest.
function relevanceScore(food, normalizedQuery, firstTerm) {
  const text = normalize(food.description);
  if (text.indexOf(normalizedQuery) === 0) return 0;
  if (firstTerm && !hasWildcard(firstTerm)) {
    if (text.split(' ').some((w) => w.indexOf(firstTerm) === 0)) return 1;
  }
  return 2;
}

// --- Public search API ----------------------------------------------------

// Search `foods` for `query`. Returns { terms, matches }.
// Throws Error('EMPTY_QUERY') when the query has no usable search terms — the UI
// layer turns that into the "please enter a search term" warning.
function search(foods, query) {
  const terms = tokenize(query);
  if (terms.length === 0) {
    const err = new Error('EMPTY_QUERY');
    err.code = 'EMPTY_QUERY';
    throw err;
  }
  const normalizedQuery = normalize(query);
  const firstTerm = terms[0];

  const matches = (foods || [])
    .filter((food) => foodMatches(terms, food))
    .map((food) => ({
      food,
      score: relevanceScore(food, normalizedQuery, firstTerm),
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return normalize(a.food.description) < normalize(b.food.description) ? -1 : 1;
    })
    .map((entry) => entry.food);

  return { terms, matches };
}

// Slice `matches` down to the first `limit` rows for progressive display.
// Returns { rows, shown, total, hasMore }.
function paginate(matches, limit) {
  const total = matches.length;
  const cap = Math.max(0, limit == null ? PAGE_SIZE : limit);
  const rows = matches.slice(0, cap);
  return { rows, shown: rows.length, total, hasMore: total > rows.length };
}

// --- Dataset integrity check ---------------------------------------------

// Validate a loaded dataset so a malformed record fails loudly in tests rather
// than silently producing wrong calorie totals in the UI.
function validateFoods(foods) {
  if (!Array.isArray(foods)) throw new Error('foods dataset must be an array');
  foods.forEach((f, i) => {
    if (typeof f.description !== 'string' || f.description.trim() === '') {
      throw new Error(`food[${i}] has an empty description`);
    }
    if (typeof f.portion !== 'string' || f.portion.trim() === '') {
      throw new Error(`food[${i}] (${f.description}) has an empty portion`);
    }
    if (typeof f.calories !== 'number' || !isFinite(f.calories) || f.calories < 0) {
      throw new Error(`food[${i}] (${f.description}) has invalid calories`);
    }
  });
  return true;
}

const API = {
  PAGE_SIZE,
  normalize,
  tokenize,
  hasWildcard,
  escapeRegExp,
  wildcardToRegExp,
  termMatches,
  foodMatches,
  relevanceScore,
  search,
  paginate,
  validateFoods,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else {
  this.CalorieCore = API;
}
