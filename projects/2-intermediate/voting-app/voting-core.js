// voting-core.js — DOM-free, deterministic core for the Voting App.
//
// The whole poll is modelled as an immutable value. Every function takes a state
// and returns a *new* state; nothing is mutated in place and nothing reaches for
// the clock, the DOM, a random source, or storage on its own. That keeps the
// tallying rules — voting, percentages, leader detection, ranking, ties, and the
// recovery of a poll from whatever came back out of `localStorage` — fully
// testable in Node without a browser.

'use strict';

const DEFAULT_ITEMS = [
  'JavaScript',
  'Python',
  'Rust',
  'Go',
  'TypeScript',
];

// Turn a free-text label into a stable, url-ish id. Two labels that differ only
// in case or surrounding space collapse to the same slug, which is how we stop
// the same option being added twice.
function slugify(label) {
  return String(label == null ? '' : label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Build a fresh poll from a list of labels. Blank labels are dropped and
// duplicates (by slug) are collapsed to the first occurrence, so a poll always
// has unique, non-empty options.
function createPoll(labels) {
  const source = Array.isArray(labels) && labels.length ? labels : DEFAULT_ITEMS;
  const items = [];
  const seen = new Set();
  for (const raw of source) {
    const label = String(raw == null ? '' : raw).trim();
    const id = slugify(label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label, votes: 0 });
  }
  return { items };
}

function findItem(state, id) {
  return state.items.find((it) => it.id === id) || null;
}

// Cast one vote for an item. Voting for an unknown id is a no-op that returns
// the same state, so a stale button in the DOM can never corrupt the tally.
function vote(state, id) {
  let changed = false;
  const items = state.items.map((it) => {
    if (it.id === id) {
      changed = true;
      return { ...it, votes: it.votes + 1 };
    }
    return it;
  });
  return changed ? { ...state, items } : state;
}

// Add a new option to a running poll. Blank or duplicate (by slug) labels are
// rejected and the original state is returned unchanged.
function addItem(state, label) {
  const clean = String(label == null ? '' : label).trim();
  const id = slugify(clean);
  if (!id || state.items.some((it) => it.id === id)) return state;
  return { ...state, items: [...state.items, { id, label: clean, votes: 0 }] };
}

// Reset every tally to zero without forgetting the options themselves.
function resetVotes(state) {
  return { ...state, items: state.items.map((it) => ({ ...it, votes: 0 })) };
}

function totalVotes(state) {
  return state.items.reduce((sum, it) => sum + it.votes, 0);
}

// An item's share of the total, as a 0..100 percentage (0 when no votes yet).
function percentFor(state, id) {
  const total = totalVotes(state);
  const item = findItem(state, id);
  if (!item || total === 0) return 0;
  return (item.votes / total) * 100;
}

// Items sorted most-voted first. Ties are broken by original insertion order so
// the ranking is stable and deterministic — never dependent on sort internals.
function ranked(state) {
  return state.items
    .map((it, index) => ({ ...it, index }))
    .sort((a, b) => (b.votes - a.votes) || (a.index - b.index))
    .map(({ index, ...it }) => it);
}

// The current leader(s). Returns every item sharing the top vote count, so a tie
// yields more than one — and an all-zero poll reports no leader at all.
function leaders(state) {
  const total = totalVotes(state);
  if (total === 0) return [];
  const top = Math.max(...state.items.map((it) => it.votes));
  return state.items.filter((it) => it.votes === top && it.votes > 0);
}

// ---- Persistence recovery --------------------------------------------------
// Rebuild a trustworthy poll from whatever `localStorage` handed back: null, a
// string, a partial object, missing/negative/non-integer vote counts, blank or
// duplicate labels. Anything unusable falls back to a fresh default poll.

function normalizePoll(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
    return createPoll(DEFAULT_ITEMS);
  }
  const items = [];
  const seen = new Set();
  for (const entry of raw.items) {
    if (!entry || typeof entry !== 'object') continue;
    const label = String(entry.label == null ? '' : entry.label).trim();
    const id = slugify(label);
    if (!id || seen.has(id)) continue;
    const votes =
      typeof entry.votes === 'number' && isFinite(entry.votes) && entry.votes > 0
        ? Math.floor(entry.votes)
        : 0;
    seen.add(id);
    items.push({ id, label, votes });
  }
  return items.length ? { items } : createPoll(DEFAULT_ITEMS);
}

const API = {
  DEFAULT_ITEMS,
  slugify,
  createPoll,
  findItem,
  vote,
  addItem,
  resetVotes,
  totalVotes,
  percentFor,
  ranked,
  leaders,
  normalizePoll,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
if (typeof window !== 'undefined') {
  window.votingCore = API;
}
