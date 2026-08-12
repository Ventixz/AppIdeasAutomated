// tests.js — dependency-free test suite for voting-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const {
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
} = require('./voting-core.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${b}, got ${a})`);
}

// --- slugify --------------------------------------------------------------
eq(slugify('  Hello World  '), 'hello-world', 'slugify trims and hyphenates');
eq(slugify('C++'), 'c', 'slugify strips trailing symbols');
eq(slugify('JavaScript'), 'javascript', 'slugify lowercases');
eq(slugify(''), '', 'slugify of empty is empty');
eq(slugify(null), '', 'slugify of null is empty');

// --- createPoll -----------------------------------------------------------
const fresh = createPoll(['Cats', 'Dogs', 'Birds']);
eq(fresh.items.length, 3, 'poll has three options');
eq(fresh.items[0].votes, 0, 'options start at zero votes');
eq(fresh.items[0].id, 'cats', 'option id is the slug');

const deduped = createPoll(['Tea', 'tea', '  TEA  ', 'Coffee']);
eq(deduped.items.length, 2, 'duplicate labels collapse by slug');
eq(deduped.items[1].label, 'Coffee', 'first-seen label is kept');

const blanks = createPoll(['', '   ', 'Real']);
eq(blanks.items.length, 1, 'blank labels are dropped');

const fallback = createPoll([]);
eq(fallback.items.length, DEFAULT_ITEMS.length, 'empty input falls back to defaults');

// --- vote -----------------------------------------------------------------
let s = createPoll(['A', 'B', 'C']);
s = vote(s, 'b');
eq(findItem(s, 'b').votes, 1, 'voting increments the target');
eq(findItem(s, 'a').votes, 0, 'voting leaves others untouched');
s = vote(s, 'b');
eq(findItem(s, 'b').votes, 2, 'voting twice accumulates');

const before = createPoll(['A', 'B']);
const after = vote(before, 'nope');
assert(after === before, 'voting for an unknown id is a no-op returning the same state');

// immutability: the original state is never mutated
const original = createPoll(['X', 'Y']);
vote(original, 'x');
eq(original.items[0].votes, 0, 'vote does not mutate the input state');

// --- addItem --------------------------------------------------------------
let p = createPoll(['One']);
p = addItem(p, 'Two');
eq(p.items.length, 2, 'addItem appends a new option');
eq(p.items[1].votes, 0, 'a new option starts at zero votes');
const dup = addItem(p, ' one ');
assert(dup === p, 'addItem rejects a duplicate slug');
const empty = addItem(p, '   ');
assert(empty === p, 'addItem rejects a blank label');

// --- resetVotes -----------------------------------------------------------
let r = createPoll(['A', 'B']);
r = vote(vote(vote(r, 'a'), 'a'), 'b');
eq(totalVotes(r), 3, 'total counts every vote');
r = resetVotes(r);
eq(totalVotes(r), 0, 'resetVotes zeroes the tally');
eq(r.items.length, 2, 'resetVotes keeps the options');

// --- percentFor -----------------------------------------------------------
let q = createPoll(['A', 'B', 'C', 'D']);
q = vote(vote(vote(q, 'a'), 'b'), 'a'); // A=2, B=1
eq(percentFor(q, 'a'), 66.66666666666666, 'percent is votes over total * 100');
eq(percentFor(q, 'c'), 0, 'an option with no votes is 0%');
eq(percentFor(createPoll(['A']), 'a'), 0, 'percent is 0 when nothing voted yet');
eq(percentFor(q, 'missing'), 0, 'percent of an unknown id is 0');

// --- ranked ---------------------------------------------------------------
let rk = createPoll(['A', 'B', 'C']);
rk = vote(vote(vote(rk, 'c'), 'c'), 'a'); // C=2, A=1, B=0
const order = ranked(rk).map((it) => it.id);
eq(order.join(','), 'c,a,b', 'ranked sorts most-voted first');

// ties break by original insertion order, deterministically
let tie = createPoll(['A', 'B', 'C']);
tie = vote(vote(tie, 'b'), 'c'); // A=0, B=1, C=1
const tieOrder = ranked(tie).map((it) => it.id);
eq(tieOrder.join(','), 'b,c,a', 'ties keep original insertion order');

// --- leaders --------------------------------------------------------------
eq(leaders(createPoll(['A', 'B'])).length, 0, 'no leader when nothing is voted');
let ld = createPoll(['A', 'B', 'C']);
ld = vote(vote(ld, 'a'), 'a');
eq(leaders(ld).length, 1, 'a single top vote-getter is the sole leader');
eq(leaders(ld)[0].id, 'a', 'the leader is the most-voted item');
let tied = vote(vote(createPoll(['A', 'B']), 'a'), 'b');
eq(leaders(tied).length, 2, 'an even split reports both as leaders');

// --- normalizePoll --------------------------------------------------------
eq(normalizePoll(null).items.length, DEFAULT_ITEMS.length, 'null recovers to defaults');
eq(normalizePoll('garbage').items.length, DEFAULT_ITEMS.length, 'a string recovers to defaults');
eq(normalizePoll({}).items.length, DEFAULT_ITEMS.length, 'a shapeless object recovers to defaults');
eq(
  normalizePoll({ items: [] }).items.length,
  DEFAULT_ITEMS.length,
  'an empty item list recovers to defaults'
);

const dirty = normalizePoll({
  items: [
    { label: 'Good', votes: 5 },
    { label: 'Negative', votes: -3 },
    { label: 'Floaty', votes: 2.9 },
    { label: '  ', votes: 1 },
    { label: 'Good', votes: 9 }, // duplicate slug
    { votes: 4 }, // no label
    null,
    'not-an-object',
  ],
});
eq(dirty.items.length, 3, 'normalize keeps only usable, unique items');
eq(findItem(dirty, 'good').votes, 5, 'first-seen good item is kept, duplicate dropped');
eq(findItem(dirty, 'negative').votes, 0, 'a negative vote count clamps to 0');
eq(findItem(dirty, 'floaty').votes, 2, 'a fractional vote count floors to an integer');

// a healthy stored poll round-trips unchanged in shape
const healthy = normalizePoll({ items: [{ label: 'Alpha', votes: 3 }, { label: 'Beta', votes: 1 }] });
eq(healthy.items.length, 2, 'a healthy poll keeps its options');
eq(totalVotes(healthy), 4, 'a healthy poll keeps its votes');

// --- summary --------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
