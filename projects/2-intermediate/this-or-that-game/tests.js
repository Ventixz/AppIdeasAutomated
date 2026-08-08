/*
 * tests.js — dependency-free, Jest-compatible tests for thisorthat-core.
 *
 * Runs two ways:
 *   node projects/2-intermediate/this-or-that-game/tests.js
 *   npx jest projects/2-intermediate/this-or-that-game/tests.js
 */
'use strict';

const C = require('./thisorthat-core.js');

// --- tiny test shim so this runs under plain node OR jest --------------
const isJest = typeof describe === 'function' && typeof test === 'function';
const cases = [];
function test_(name, fn) {
  if (isJest) test(name, fn);
  else cases.push({ name, fn });
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg || 'not equal') + `\n  expected ${e}\n  got      ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

// deterministic rng (mulberry32) for the property-style tests
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A small fixed pool for the deterministic pairing tests.
const POOL = [
  { id: 'a', emoji: '🅰️', label: 'A' },
  { id: 'b', emoji: '🅱️', label: 'B' },
  { id: 'c', emoji: '🇨', label: 'C' },
  { id: 'd', emoji: '🇩', label: 'D' },
];

// --- ITEMS pool integrity ---------------------------------------------
test_('the default pool has unique ids and enough variety', () => {
  ok(C.ITEMS.length >= 8, 'want a decent pool');
  const ids = new Set(C.ITEMS.map((i) => i.id));
  eq(ids.size, C.ITEMS.length, 'ids are unique');
  for (const it of C.ITEMS) {
    ok(it.emoji && it.label, `item ${it.id} has emoji + label`);
  }
});

// --- pairKey ----------------------------------------------------------
test_('pairKey is order-independent', () => {
  eq(C.pairKey('dog', 'cat'), C.pairKey('cat', 'dog'));
});

// --- hashString -------------------------------------------------------
test_('hashString is deterministic and differs across inputs', () => {
  eq(C.hashString('dog'), C.hashString('dog'), 'same input, same hash');
  ok(C.hashString('dog') !== C.hashString('cat'), 'different inputs differ');
  ok(Number.isInteger(C.hashString('house')), 'returns an integer');
});

// --- pickPair ---------------------------------------------------------
test_('pickPair always returns two distinct items', () => {
  const r = seededRng(99);
  for (let i = 0; i < 500; i++) {
    const [x, y] = C.pickPair(POOL, r);
    ok(x && y, 'two items');
    ok(x.id !== y.id, `distinct at iter ${i}: ${x.id} vs ${y.id}`);
  }
});

test_('pickPair avoids repeating the previous matchup', () => {
  const r = seededRng(3);
  let prevKey = null;
  let repeats = 0;
  for (let i = 0; i < 300; i++) {
    const [x, y] = C.pickPair(C.ITEMS, r, prevKey);
    const key = C.pairKey(x.id, y.id);
    if (key === prevKey) repeats++;
    prevKey = key;
  }
  eq(repeats, 0, 'never showed the same pair twice in a row');
});

test_('pickPair still works with only two items (no avoid possible)', () => {
  const two = [POOL[0], POOL[1]];
  const key = C.pairKey('a', 'b');
  const [x, y] = C.pickPair(two, seededRng(1), key);
  ok(x.id !== y.id, 'distinct');
});

test_('pickPair throws on a pool that is too small', () => {
  let threw = false;
  try { C.pickPair([POOL[0]], seededRng(1)); } catch (e) { threw = true; }
  ok(threw, 'expected an error for a 1-item pool');
});

// --- recordVote (immutability) ----------------------------------------
test_('recordVote increments without mutating the input', () => {
  const t0 = { dog: 2 };
  const t1 = C.recordVote(t0, 'dog');
  eq(t0, { dog: 2 }, 'original untouched');
  eq(t1, { dog: 3 }, 'incremented copy');
});

test_('recordVote seeds a brand-new id at 1', () => {
  const t = C.recordVote({}, 'cat');
  eq(t, { cat: 1 });
});

// --- totalVotes -------------------------------------------------------
test_('totalVotes sums every tally entry', () => {
  eq(C.totalVotes({}), 0);
  eq(C.totalVotes({ dog: 3, cat: 5, car: 1 }), 9);
});

// --- leaderboard ------------------------------------------------------
test_('leaderboard ranks by votes, descending', () => {
  const tally = { dog: 5, cat: 9, car: 2 };
  const board = C.leaderboard(tally, C.ITEMS, 10);
  eq(board.map((r) => r.item.id), ['cat', 'dog', 'car']);
  eq(board.map((r) => r.votes), [9, 5, 2]);
});

test_('leaderboard omits unvoted items and respects the top-N limit', () => {
  const tally = { dog: 1, cat: 2, car: 3, house: 4, pizza: 5 };
  const board = C.leaderboard(tally, C.ITEMS, 3);
  eq(board.length, 3, 'only top 3');
  eq(board.map((r) => r.item.id), ['pizza', 'house', 'car']);
});

test_('leaderboard breaks ties by id for a stable order', () => {
  const tally = { cat: 4, car: 4, dog: 4 };
  const board = C.leaderboard(tally, C.ITEMS, 10);
  eq(board.map((r) => r.item.id), ['car', 'cat', 'dog']);
});

test_('leaderboard of an empty tally is empty', () => {
  eq(C.leaderboard({}, C.ITEMS, 10), []);
});

// --- end-to-end: play a deterministic session -------------------------
test_('a simulated session builds a coherent leaderboard', () => {
  const r = seededRng(2026);
  let tally = {};
  let prevKey = null;
  for (let i = 0; i < 50; i++) {
    const pair = C.pickPair(C.ITEMS, r, prevKey);
    prevKey = C.pairKey(pair[0].id, pair[1].id);
    // Always vote for the alphabetically-first id, deterministically.
    const winner = pair[0].id < pair[1].id ? pair[0].id : pair[1].id;
    tally = C.recordVote(tally, winner);
  }
  eq(C.totalVotes(tally), 50, '50 votes total');
  const board = C.leaderboard(tally, C.ITEMS, 10);
  ok(board.length > 0 && board.length <= 10, 'board is sized sanely');
  for (let i = 1; i < board.length; i++) {
    ok(board[i - 1].votes >= board[i].votes, 'sorted descending');
  }
});

// --- standalone runner -------------------------------------------------
if (!isJest) {
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    try { c.fn(); pass++; }
    catch (e) {
      fail++;
      console.error('✗ ' + c.name);
      console.error('  ' + String(e.message).split('\n').join('\n  '));
    }
  }
  if (fail === 0) console.log(`All ${pass} tests passed.`);
  else { console.log(`${pass} passed, ${fail} failed.`); process.exitCode = 1; }
}
