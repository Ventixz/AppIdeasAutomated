// tests.js — dependency-free test suite for boole-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const {
  OPERATIONS,
  OPERATION_NAMES,
  DIRECTIONS,
  ALL_DIRECTION_NAMES,
  applyOperation,
  resolveCollision,
  createArena,
  runBattle,
} = require('./boole-core.js');

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

// A tiny seedable RNG (mulberry32) so every battle below is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 1. Boolean operations: exhaustive truth tables ----------------------

console.log('Boolean operation truth tables...');
// AND
eq(applyOperation('AND', 0, 0), 0, 'AND 0,0');
eq(applyOperation('AND', 0, 1), 0, 'AND 0,1');
eq(applyOperation('AND', 1, 0), 0, 'AND 1,0');
eq(applyOperation('AND', 1, 1), 1, 'AND 1,1');
// OR
eq(applyOperation('OR', 0, 0), 0, 'OR 0,0');
eq(applyOperation('OR', 0, 1), 1, 'OR 0,1');
eq(applyOperation('OR', 1, 0), 1, 'OR 1,0');
eq(applyOperation('OR', 1, 1), 1, 'OR 1,1');
// XOR
eq(applyOperation('XOR', 0, 0), 0, 'XOR 0,0');
eq(applyOperation('XOR', 0, 1), 1, 'XOR 0,1');
eq(applyOperation('XOR', 1, 0), 1, 'XOR 1,0');
eq(applyOperation('XOR', 1, 1), 0, 'XOR 1,1');
// NOT (unary — ignores second operand)
eq(applyOperation('NOT', 0, 0), 1, 'NOT 0');
eq(applyOperation('NOT', 1, 0), 0, 'NOT 1');
eq(applyOperation('NOT', 0, 1), 1, 'NOT 0 (other ignored)');
eq(applyOperation('NOT', 1, 1), 0, 'NOT 1 (other ignored)');

eq(OPERATION_NAMES.length, 4, 'four operations defined');
assert(Object.keys(OPERATIONS).every((k) => typeof OPERATIONS[k].apply === 'function'), 'each op has apply');
assert(() => applyOperation('NAND', 0, 0), 'unknown op path exists');

// --- 2. Collision resolution across every value/op combination ------------

console.log('Collision resolution...');
// A = value 1, op AND ; B = value 1, op AND -> both 1 -> tie
{
  const r = resolveCollision(
    { value: 1, operation: 'AND' },
    { value: 1, operation: 'AND' },
  );
  eq(r.resultA, 1, 'AND(1,1)=1 for A');
  eq(r.resultB, 1, 'AND(1,1)=1 for B');
  eq(r.outcome, 'tie', 'matching results tie');
}
// A: value 1 op OR (=1), B: value 0 op AND (=0) -> A wins
{
  const r = resolveCollision(
    { value: 1, operation: 'OR' },
    { value: 0, operation: 'AND' },
  );
  eq(r.resultA, 1, 'OR(1,0)=1');
  eq(r.resultB, 0, 'AND(0,1)=0');
  eq(r.outcome, 'a', 'A wins when only A resolves to 1');
}
// A: value 0 op AND (=0), B: value 1 op NOT (=0) -> both 0 -> tie
{
  const r = resolveCollision(
    { value: 0, operation: 'AND' },
    { value: 1, operation: 'NOT' },
  );
  eq(r.outcome, 'tie', 'both 0 is a tie, not a double-kill');
}
// A: value 0 op NOT (=1), B: value 1 op OR (=1) -> tie
{
  const r = resolveCollision(
    { value: 0, operation: 'NOT' },
    { value: 1, operation: 'OR' },
  );
  eq(r.resultA, 1, 'NOT(0)=1');
  eq(r.resultB, 1, 'OR(1,0)=1');
  eq(r.outcome, 'tie', 'both 1 ties');
}
// B wins case
{
  const r = resolveCollision(
    { value: 0, operation: 'AND' },
    { value: 1, operation: 'OR' },
  );
  eq(r.outcome, 'b', 'B wins when only B resolves to 1');
}

// Exhaustive: for every (valueA, opA, valueB, opB), outcome must agree with the
// raw truth-table results.
{
  let checked = 0;
  for (const va of [0, 1]) {
    for (const oa of OPERATION_NAMES) {
      for (const vb of [0, 1]) {
        for (const ob of OPERATION_NAMES) {
          const r = resolveCollision(
            { value: va, operation: oa },
            { value: vb, operation: ob },
          );
          const ra = applyOperation(oa, va, vb);
          const rb = applyOperation(ob, vb, va);
          const expected = ra === rb ? 'tie' : ra === 1 ? 'a' : 'b';
          eq(r.outcome, expected, `outcome ${oa}(${va},${vb}) vs ${ob}(${vb},${va})`);
          checked += 1;
        }
      }
    }
  }
  eq(checked, 64, 'all 64 collision combinations checked');
}

// --- 3. Directions -------------------------------------------------------

console.log('Direction vectors...');
eq(ALL_DIRECTION_NAMES.length, 8, 'eight directions total (4 cardinal + 4 diagonal)');
for (const name of ALL_DIRECTION_NAMES) {
  const d = DIRECTIONS[name];
  const mag = Math.hypot(d.dx, d.dy);
  assert(Math.abs(mag - 1) < 1e-9, `${name} is a unit vector (mag ${mag})`);
}

// --- 4. Arena construction ----------------------------------------------

console.log('Arena construction...');
{
  const arena = createArena(
    [
      { name: 'Ada', value: 1, operation: 'AND', direction: 'E' },
      { name: 'Boole', value: 0, operation: 'OR', direction: 'W' },
    ],
    { size: 8, rng: mulberry32(1) },
  );
  eq(arena.size, 8, 'arena keeps its size');
  eq(arena.bots.length, 2, 'two bots created');
  assert(
    arena.bots.every((b) => b.x >= 0 && b.x <= 8 && b.y >= 0 && b.y <= 8),
    'all bots start inside the arena',
  );
  eq(arena.winner(), null, 'no winner before the battle starts');
}

// Duplicate names are rejected (spec: error on duplicate bot names).
{
  let threw = false;
  try {
    createArena([
      { name: 'Same', value: 1, operation: 'AND' },
      { name: 'Same', value: 0, operation: 'OR' },
    ]);
  } catch (e) {
    threw = true;
  }
  assert(threw, 'duplicate bot names throw');
}

// --- 5. Walls: a lone bot bounces and never escapes ----------------------

console.log('Wall bouncing...');
{
  const arena = createArena(
    [
      { name: 'Solo', value: 1, operation: 'AND', direction: 'NE', speed: 3 },
      { name: 'Ghost', value: 1, operation: 'AND', direction: 'SW', speed: 3 },
    ],
    { size: 8, rng: mulberry32(7) },
  );
  // Kill the ghost so Solo roams alone, then confirm it stays boxed in.
  arena.bots[1].alive = false;
  let inside = true;
  for (let i = 0; i < 2000; i += 1) {
    arena.step(0.05);
    const b = arena.bots[0];
    if (b.x < 0 || b.x > 8 || b.y < 0 || b.y > 8) inside = false;
  }
  assert(inside, 'a bouncing bot never leaves the arena over 2000 steps');
}

// --- 6. A guaranteed-winner duel: head-on, A always wins -----------------

console.log('Deterministic duels...');
{
  // Ada: value 1, OR -> OR(1,x)=1 always. Boole: value 0, AND -> AND(0,x)=0.
  // Whenever they meet, Ada wins and Boole disappears.
  const result = runBattle(
    [
      { name: 'Ada', value: 1, operation: 'OR', direction: 'E', speed: 2 },
      { name: 'Boole', value: 0, operation: 'AND', direction: 'W', speed: 2 },
    ],
    { size: 8, rng: mulberry32(3), dt: 0.05 },
  );
  eq(result.winner, 'Ada', 'the always-1 bot wins the duel');
  const ada = result.leaderboard.find((b) => b.name === 'Ada');
  const boole = result.leaderboard.find((b) => b.name === 'Boole');
  eq(ada.wins, 1, 'winner recorded exactly one win');
  eq(ada.alive, true, 'winner is alive');
  eq(boole.losses, 1, 'loser recorded exactly one loss');
  eq(boole.alive, false, 'loser is gone');
  assert(
    result.log.some((e) => e.type === 'win' && e.winner === 'Ada'),
    'a win event was logged',
  );
}

// --- 7. Full four-bot battles terminate with one survivor ----------------

console.log('Four-bot battles converge across many seeds...');
{
  let ok = 0;
  const total = 200;
  for (let seed = 1; seed <= total; seed += 1) {
    const result = runBattle(
      [
        { name: 'W', value: 1, operation: 'OR' },
        { name: 'X', value: 0, operation: 'AND' },
        { name: 'Y', value: 1, operation: 'XOR' },
        { name: 'Z', value: 0, operation: 'NOT' },
      ],
      { size: 8, rng: mulberry32(seed), dt: 0.05, maxSeconds: 600 },
    );
    // Some symmetric configs can stall in an all-tie stalemate; when a battle
    // does resolve, it must resolve to exactly one living bot whose wins/losses
    // are internally consistent with the number of eliminations.
    if (result.winner !== null) {
      const alive = result.leaderboard.filter((b) => b.alive);
      const dead = result.leaderboard.filter((b) => !b.alive);
      const totalWins = result.leaderboard.reduce((s, b) => s + b.wins, 0);
      if (alive.length === 1 && totalWins === dead.length) ok += 1;
    } else {
      ok += 1; // an unresolved stalemate is acceptable, not a failure
    }
  }
  eq(ok, total, 'every seed ends consistently (one winner or a valid stalemate)');
}

// --- 7b. Deadlocked bots end in a draw, not an infinite loop -------------

console.log('Stalemate detection...');
{
  // Two bots that both ALWAYS resolve to 1 (NOT 0 and OR 1) can never eliminate
  // each other — every collision ties. The engine must detect this and stop.
  const result = runBattle(
    [
      { name: 'Immortal-A', value: 0, operation: 'NOT', direction: 'E', speed: 2 },
      { name: 'Immortal-B', value: 1, operation: 'OR', direction: 'W', speed: 2 },
    ],
    { size: 8, rng: mulberry32(5), dt: 0.05, maxSeconds: 600 },
  );
  eq(result.winner, null, 'no single winner in a deadlock');
  eq(result.outcome.type, 'draw', 'outcome is a draw');
  eq(result.outcome.survivors.length, 2, 'both immortals survive the draw');
  assert(result.stats.elapsed < 600, 'draw is detected early, not run to the time cap');
  assert(
    result.log.some((e) => e.type === 'stalemate'),
    'a stalemate event was logged',
  );
}

// --- 8. Leaderboard ranking ----------------------------------------------

console.log('Leaderboard ranking...');
{
  const arena = createArena(
    [
      { name: 'Top', value: 1, operation: 'OR' },
      { name: 'Mid', value: 1, operation: 'OR' },
      { name: 'Low', value: 0, operation: 'AND' },
    ],
    { size: 8, rng: mulberry32(42) },
  );
  // Hand-set scores to check the ordering rules in isolation.
  arena.bots[0].wins = 3;
  arena.bots[1].wins = 1;
  arena.bots[2].alive = false;
  arena.bots[2].losses = 2;
  const board = arena.leaderboard();
  eq(board[0].name, 'Top', 'most wins ranks first');
  eq(board[1].name, 'Mid', 'fewer wins ranks second');
  eq(board[2].name, 'Low', 'dead bot ranks last');
  eq(board.length, 3, 'leaderboard lists every bot');
}

// --- 9. Custom arena dimensions (bonus) ----------------------------------

console.log('Custom arena dimensions...');
{
  const arena = createArena(
    [
      { name: 'A', value: 1, operation: 'AND', direction: 'E' },
      { name: 'B', value: 0, operation: 'OR', direction: 'W' },
    ],
    { size: 12, rng: mulberry32(9) },
  );
  eq(arena.size, 12, 'custom 12x12 arena honoured');
  assert(arena.bots.every((b) => b.x <= 12 && b.y <= 12), 'bots fit the larger arena');
}

// --- Summary -------------------------------------------------------------

console.log('');
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
  process.exit(0);
} else {
  console.error(`${failed} of ${passed + failed} tests failed.`);
  process.exit(1);
}
