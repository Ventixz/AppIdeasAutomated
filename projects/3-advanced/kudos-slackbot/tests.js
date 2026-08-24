// tests.js — dependency-free test suite for kudos-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const Core = require('./kudos-core.js');
const {
  normalizeUser, isValidUser, parseCommand, parseCount, createStore, handleCommand,
} = Core;

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
function deq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

// A deterministic store: ids k1,k2,... and a clock we advance by hand.
function fixtureStore() {
  let n = 0;
  let clock = 1000;
  return createStore({ seq: () => (n += 1), now: () => (clock += 1) });
}

// --- normalizeUser / isValidUser ------------------------------------------
eq(normalizeUser('@Grace'), 'grace', 'strips @ and lowercases');
eq(normalizeUser('  @Bob '), 'bob', 'trims whitespace');
eq(normalizeUser('<@U012ABC>'), 'u012abc', 'decodes Slack mention');
eq(normalizeUser('<@U012ABC|grace>'), 'u012abc', 'decodes Slack mention with label');
eq(normalizeUser(null), '', 'null -> empty');
eq(normalizeUser(undefined), '', 'undefined -> empty');
assert(isValidUser('@grace'), 'grace is valid');
assert(isValidUser('a.b_c-d'), 'dots/underscores/hyphens allowed inside');
assert(!isValidUser('@'), 'lone @ invalid');
assert(!isValidUser(''), 'empty invalid');
assert(!isValidUser('-grace'), 'cannot start with hyphen');
assert(!isValidUser('a b'), 'spaces invalid');

// --- parseCount ------------------------------------------------------------
deq(parseCount('', 5), { ok: true, value: 5 }, 'empty count -> fallback');
deq(parseCount('*', 5), { ok: true, value: Infinity }, 'star -> Infinity');
deq(parseCount('3', 5), { ok: true, value: 3 }, 'numeric count');
eq(parseCount('x', 5).ok, false, 'non-numeric rejected');

// --- parseCommand ----------------------------------------------------------
eq(parseCommand('').ok, false, 'empty command rejected');
eq(parseCommand('   ').ok, false, 'whitespace command rejected');
eq(parseCommand('/kudo').sub, 'help', 'bare /kudo -> help');
eq(parseCommand('/kudo help').sub, 'help', 'help sub');

let p = parseCommand('/kudo add @grace shipped the release');
assert(p.ok && p.sub === 'add', 'add parses');
eq(p.to, '@grace', 'add keeps raw recipient token');
eq(p.text, 'shipped the release', 'add captures multi-word text');

p = parseCommand('add @grace shipped it'); // leading /kudo optional
assert(p.ok && p.sub === 'add', 'add works without /kudo prefix');

eq(parseCommand('/kudo add @grace').ok, false, 'add without message rejected');
eq(parseCommand('/kudo add notauser').ok, false, 'add without message rejected (2)');
deq(parseCommand('/kudo add -bad hi').code, 'bad-user', 'add rejects bad recipient');

p = parseCommand('/kudo replace k3 new wording here');
assert(p.ok && p.sub === 'replace' && p.id === 'k3', 'replace parses id');
eq(p.text, 'new wording here', 'replace captures text');
eq(parseCommand('/kudo replace k3').ok, false, 'replace without text rejected');

deq(parseCommand('/kudo delete k2'), { ok: true, sub: 'delete', id: 'k2' }, 'delete parses');
deq(parseCommand('/kudo remove k2'), { ok: true, sub: 'delete', id: 'k2' }, 'remove aliases delete');
eq(parseCommand('/kudo delete').ok, false, 'delete needs an id');

deq(parseCommand('/kudo list'), { ok: true, sub: 'list', n: Core.DEFAULT_LIST }, 'list default count');
deq(parseCommand('/kudo list 3'), { ok: true, sub: 'list', n: 3 }, 'list with count');
deq(parseCommand('/kudo list *'), { ok: true, sub: 'list', n: Infinity }, 'list all');
eq(parseCommand('/kudo list abc').ok, false, 'list bad count rejected');

p = parseCommand('/kudo user @bob');
assert(p.ok && p.sub === 'user' && p.user === '@bob', 'user parses');
eq(parseCommand('/kudo user').ok, false, 'user needs a name');

deq(parseCommand('/kudo top'), { ok: true, sub: 'top', n: Core.DEFAULT_TOP }, 'top default');
deq(parseCommand('/kudo top 3'), { ok: true, sub: 'top', n: 3 }, 'top with count');

deq(parseCommand('/kudo frobnicate').code, 'unknown-sub', 'unknown sub reported');

// --- store: add / get / size ----------------------------------------------
{
  const s = fixtureStore();
  const a = s.add('@alice', '@grace', 'shipped the release');
  eq(a.id, 'k1', 'first id is k1');
  eq(a.to, 'grace', 'recipient normalized');
  eq(a.from, 'alice', 'giver normalized');
  eq(s.size(), 1, 'size is 1');
  eq(s.get('k1').text, 'shipped the release', 'get by id');
  eq(s.get('nope'), null, 'missing id -> null');
  const b = s.add('@bob', '@grace', 'great review');
  eq(b.id, 'k2', 'ids increment');
  assert(b.at > a.at, 'clock advances');
}

// --- store: replace (author only) -----------------------------------------
{
  const s = fixtureStore();
  s.add('@alice', '@grace', 'v1');
  let r = s.replace('@alice', 'k1', 'v2');
  assert(r.ok && r.rec.text === 'v2', 'author can replace');
  r = s.replace('@bob', 'k1', 'v3');
  eq(r.ok, false, 'non-author cannot replace');
  eq(r.code, 'forbidden', 'replace forbidden code');
  eq(s.get('k1').text, 'v2', 'text unchanged after forbidden replace');
  r = s.replace('@alice', 'k9', 'x');
  eq(r.code, 'not-found', 'replace missing id');
}

// --- store: remove (author only) ------------------------------------------
{
  const s = fixtureStore();
  s.add('@alice', '@grace', 'v1');
  let r = s.remove('@bob', 'k1');
  eq(r.code, 'forbidden', 'non-author cannot delete');
  eq(s.size(), 1, 'still present after forbidden delete');
  r = s.remove('@alice', 'k1');
  assert(r.ok, 'author can delete');
  eq(s.size(), 0, 'deleted');
  eq(s.remove('@alice', 'k1').code, 'not-found', 'delete missing id');
}

// --- store: latest / forUser ----------------------------------------------
{
  const s = fixtureStore();
  s.add('@alice', '@grace', 'a');
  s.add('@bob', '@grace', 'b');
  s.add('@carol', '@dan', 'c');
  const latest2 = s.latest(2);
  deq(latest2.map((k) => k.id), ['k3', 'k2'], 'latest is newest-first');
  eq(s.latest(Infinity).length, 3, 'latest Infinity returns all');
  const grace = s.forUser('@grace');
  deq(grace.map((k) => k.id), ['k2', 'k1'], 'forUser newest-first, filtered');
  eq(s.forUser('@nobody').length, 0, 'forUser unknown -> empty');
}

// --- store: leaderboard ----------------------------------------------------
{
  const s = fixtureStore();
  s.add('@a', '@grace', '1');
  s.add('@b', '@grace', '2');
  s.add('@c', '@grace', '3');
  s.add('@a', '@bob', '1');
  s.add('@b', '@bob', '2');
  s.add('@a', '@amy', '1');
  const board = s.leaderboard(Infinity);
  deq(board, [
    { user: 'grace', count: 3 },
    { user: 'bob', count: 2 },
    { user: 'amy', count: 1 },
  ], 'leaderboard sorted desc');
  eq(s.leaderboard(2).length, 2, 'leaderboard respects n');
}

// tie-break is alphabetical
{
  const s = fixtureStore();
  s.add('@x', '@zoe', '1');
  s.add('@x', '@ann', '1');
  deq(s.leaderboard(Infinity).map((r) => r.user), ['ann', 'zoe'], 'ties break alphabetically');
}

// --- handleCommand end-to-end ---------------------------------------------
{
  const s = fixtureStore();
  let r = handleCommand(s, '/kudo add @grace shipped it', '@alice');
  eq(r.type, 'kudo', 'add returns kudo reply');
  assert(r.text.includes('k1') && r.text.includes('@grace'), 'add reply mentions id and recipient');
  eq(s.size(), 1, 'add persisted');

  r = handleCommand(s, '/kudo add @grace nice docs too', '@bob');
  eq(s.get('k2').from, 'bob', 'second add attributes bob');

  r = handleCommand(s, '/kudo list', '@alice');
  eq(r.type, 'list', 'list returns list reply');
  assert(r.data.length === 2, 'list returns two');

  r = handleCommand(s, '/kudo user @grace', '@alice');
  eq(r.data.length, 2, 'user shows both grace kudos');

  r = handleCommand(s, '/kudo replace k1 shipped the big release', '@bob');
  eq(r.type, 'error', 'bob cannot replace alice kudo');
  r = handleCommand(s, '/kudo replace k1 shipped the big release', '@alice');
  eq(r.type, 'kudo', 'alice can replace her own');
  eq(s.get('k1').text, 'shipped the big release', 'replace applied');

  r = handleCommand(s, '/kudo top', '@alice');
  eq(r.type, 'top', 'top returns leaderboard');
  eq(r.data[0].user, 'grace', 'grace tops the board');

  r = handleCommand(s, '/kudo delete k2', '@alice');
  eq(r.type, 'error', 'alice cannot delete bob kudo');
  r = handleCommand(s, '/kudo delete k2', '@bob');
  eq(r.type, 'notice', 'bob deletes his own');
  eq(s.size(), 1, 'one left after delete');

  r = handleCommand(s, '/kudo help', '@alice');
  eq(r.type, 'help', 'help returns help');

  r = handleCommand(s, '/kudo wat', '@alice');
  eq(r.type, 'error', 'unknown command errors');

  r = handleCommand(s, '/kudo list', '@x'); // still has k1
  eq(r.data.length, 1, 'list reflects deletion');
}

// empty-state replies
{
  const s = fixtureStore();
  eq(handleCommand(s, '/kudo list', '@a').type, 'notice', 'empty list -> notice');
  eq(handleCommand(s, '/kudo top', '@a').type, 'notice', 'empty top -> notice');
  eq(handleCommand(s, '/kudo user @grace', '@a').type, 'notice', 'empty user -> notice');
}

// --- report ----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
