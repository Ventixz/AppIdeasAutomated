/*
 * thisorthat-core.js — pure game logic for the This or That Game.
 *
 * No DOM, no storage, no randomness of its own: every function that needs a
 * random number takes an `rng` (a function returning [0, 1)), so pairing is
 * deterministic and testable under plain node.
 *
 * An "item" is one of the two images the player chooses between:
 *   { id: 'dog', emoji: '🐶', label: 'Dog' }
 * A "tally" is a plain object mapping item id -> vote count. It is never
 * mutated: recordVote returns a fresh object.
 */
'use strict';

// The default pool of things to pit against each other. "Images can vary
// widely (dogs, cats, cars, houses, etc.)" — so this is a broad grab-bag.
// Each item renders (in the browser) to a deterministic SVG card, so the same
// id always produces the same image, which is what makes a leaderboard mean
// something.
const ITEMS = [
  { id: 'dog',        emoji: '🐶', label: 'Dog' },
  { id: 'cat',        emoji: '🐱', label: 'Cat' },
  { id: 'car',        emoji: '🚗', label: 'Car' },
  { id: 'house',      emoji: '🏠', label: 'House' },
  { id: 'pizza',      emoji: '🍕', label: 'Pizza' },
  { id: 'burger',     emoji: '🍔', label: 'Burger' },
  { id: 'coffee',     emoji: '☕', label: 'Coffee' },
  { id: 'tea',        emoji: '🍵', label: 'Tea' },
  { id: 'beach',      emoji: '🏖️', label: 'Beach' },
  { id: 'mountain',   emoji: '⛰️', label: 'Mountain' },
  { id: 'sun',        emoji: '☀️', label: 'Sun' },
  { id: 'moon',       emoji: '🌙', label: 'Moon' },
  { id: 'rocket',     emoji: '🚀', label: 'Rocket' },
  { id: 'plane',      emoji: '✈️', label: 'Plane' },
  { id: 'guitar',     emoji: '🎸', label: 'Guitar' },
  { id: 'piano',      emoji: '🎹', label: 'Piano' },
  { id: 'book',       emoji: '📚', label: 'Books' },
  { id: 'movie',      emoji: '🎬', label: 'Movies' },
  { id: 'summer',     emoji: '🌞', label: 'Summer' },
  { id: 'winter',     emoji: '❄️', label: 'Winter' },
  { id: 'robot',      emoji: '🤖', label: 'Robot' },
  { id: 'dinosaur',   emoji: '🦖', label: 'Dinosaur' },
  { id: 'donut',      emoji: '🍩', label: 'Donut' },
  { id: 'icecream',   emoji: '🍦', label: 'Ice Cream' },
];

// Stable, order-independent key for an unordered pair of ids, used to detect
// when we'd hand the player the same two images twice in a row.
function pairKey(a, b) {
  return [a, b].sort().join('|');
}

// Deterministic 32-bit hash of a string. Used by the browser layer to derive
// a stable colour scheme per item id; kept here so it's covered by tests.
function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Pick a random index in [0, n) from an rng returning [0, 1).
function pickIndex(n, rng) {
  return Math.floor(rng() * n);
}

// Choose two *distinct* items to show. If `avoidKey` (a pairKey) is given we
// re-roll a few times so the player doesn't immediately see the same matchup
// again. With only one possible pair (a 2-item pool) we give up and return it.
function pickPair(items, rng, avoidKey) {
  if (!Array.isArray(items) || items.length < 2) {
    throw new Error('pickPair needs at least two items');
  }
  const n = items.length;
  let a = 0;
  let b = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    a = pickIndex(n, rng);
    b = pickIndex(n, rng);
    if (a === b) continue;
    if (avoidKey && pairKey(items[a].id, items[b].id) === avoidKey && n > 2) continue;
    return [items[a], items[b]];
  }
  // Fallback: guarantee two distinct items even if rng is pathological.
  b = (a + 1) % n;
  return [items[a], items[b]];
}

// Record a vote for `id`, returning a brand-new tally (no mutation).
function recordVote(tally, id) {
  const next = Object.assign({}, tally);
  next[id] = (next[id] || 0) + 1;
  return next;
}

// Total number of votes cast across every item.
function totalVotes(tally) {
  return Object.keys(tally).reduce((sum, id) => sum + tally[id], 0);
}

// Top-`n` most-voted items as [{ item, votes }], highest first. Ties break
// alphabetically by id so the ordering is stable. Items with zero votes are
// omitted — an unvoted image doesn't belong on a "top voted" board.
function leaderboard(tally, items, n) {
  const limit = typeof n === 'number' ? n : 10;
  const byId = {};
  for (const it of items) byId[it.id] = it;
  return Object.keys(tally)
    .filter((id) => tally[id] > 0 && byId[id])
    .map((id) => ({ item: byId[id], votes: tally[id] }))
    .sort((x, y) => (y.votes - x.votes) || (x.item.id < y.item.id ? -1 : 1))
    .slice(0, limit);
}

const api = {
  ITEMS,
  pairKey,
  hashString,
  pickPair,
  recordVote,
  totalVotes,
  leaderboard,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ThisOrThatCore = api;
