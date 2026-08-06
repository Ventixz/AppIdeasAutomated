/*
 * tests.js — dependency-free, Jest-compatible tests for bracket-core.
 *
 * Runs two ways:
 *   node projects/2-intermediate/sports-bracket-generator/tests.js
 *   npx jest projects/2-intermediate/sports-bracket-generator/tests.js
 */
'use strict';

const C = require('./bracket-core.js');

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
function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'expected truthy');
}

// --- date validation ---------------------------------------------------
test_('valid date range passes', () => {
  eq(C.validateDateRange('2026-08-01', '2026-08-10').valid, true);
});
test_('end before start is invalid', () => {
  const r = C.validateDateRange('2026-08-10', '2026-08-01');
  eq(r.valid, false);
  ok(/before/.test(r.message));
});
test_('malformed date is invalid', () => {
  eq(C.validateDateRange('2026-13-40', '2026-08-01').valid, false);
  eq(C.validateDateRange('nonsense', '2026-08-01').valid, false);
});
test_('rolled-over date (Feb 31) is rejected', () => {
  eq(C.parseISODate('2026-02-31'), null);
});
test_('equal start and end is allowed', () => {
  eq(C.validateDateRange('2026-08-01', '2026-08-01').valid, true);
});

// --- team-count warnings ----------------------------------------------
test_('even count has no warning', () => {
  eq(C.teamCountWarning(8), null);
});
test_('odd count warns about a bye', () => {
  ok(/bye/i.test(C.teamCountWarning(7)));
});
test_('fewer than two teams warns', () => {
  ok(/at least 2/.test(C.teamCountWarning(1)));
});

// --- seeding -----------------------------------------------------------
test_('seed order for 4 is 1,4,2,3', () => {
  eq(C.seedOrder(4), [1, 4, 2, 3]);
});
test_('seed order for 8 pairs 1v8, 4v5, 2v7, 3v6', () => {
  eq(C.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});
test_('nextPowerOfTwo rounds up', () => {
  eq(C.nextPowerOfTwo(5), 8);
  eq(C.nextPowerOfTwo(8), 8);
  eq(C.nextPowerOfTwo(13), 16);
});

// --- building ----------------------------------------------------------
test_('power-of-two bracket has the right shape', () => {
  const b = C.buildBracket({ numTeams: 8 });
  eq(b.totalRounds, 3);
  eq(b.rounds.map((r) => r.length), [4, 2, 1]);
  // top seed faces the lowest seed in match 0
  eq(b.rounds[0][0].a.seed, 1);
  eq(b.rounds[0][0].b.seed, 8);
});
test_('custom team names are used', () => {
  const b = C.buildBracket({ numTeams: 4, teamNames: ['Lions', 'Bears', 'Wolves', 'Hawks'] });
  eq(b.rounds[0][0].a.name, 'Lions'); // seed 1
  eq(b.rounds[0][1].a.name, 'Bears'); // seed 2
});
test_('odd/non-power-of-two count creates byes and auto-advances', () => {
  const b = C.buildBracket({ numTeams: 6 });
  eq(b.size, 8);
  // Two byes exist among first-round slots.
  const byes = b.rounds[0].flatMap((m) => [m.a, m.b]).filter((s) => s.type === 'bye');
  eq(byes.length, 2);
  // Every match containing a bye already has a winner and fed round 2.
  const withBye = b.rounds[0].filter((m) => m.a.type === 'bye' || m.b.type === 'bye');
  ok(withBye.every((m) => m.winner !== null));
});
test_('buildBracket rejects fewer than 2 teams', () => {
  let threw = false;
  try { C.buildBracket({ numTeams: 1 }); } catch (e) { threw = true; }
  ok(threw);
});

// --- advancing ---------------------------------------------------------
test_('setWinner advances a team to the next round', () => {
  const b0 = C.buildBracket({ numTeams: 4 });
  const b1 = C.setWinner(b0, 0, 0, 'a'); // seed 1 beats seed 4
  eq(b1.rounds[1][0].a.seed, 1);
  // purity: original bracket untouched
  eq(b0.rounds[1][0].a.type, 'tbd');
});
test_('champion is null until the final is decided, then set', () => {
  let b = C.buildBracket({ numTeams: 4 });
  eq(C.champion(b), null);
  b = C.setWinner(b, 0, 0, 'a'); // seed 1
  b = C.setWinner(b, 0, 1, 'a'); // seed 2
  b = C.setWinner(b, 1, 0, 'a'); // final: seed 1 beats seed 2
  eq(C.champion(b).seed, 1);
});
test_('changing an earlier result clears the stale downstream advancement', () => {
  let b = C.buildBracket({ numTeams: 4 });
  b = C.setWinner(b, 0, 0, 'a'); // seed 1 advances
  b = C.setWinner(b, 1, 0, 'a'); // seed 1 into final slot a as winner
  eq(C.champion(b).seed, 1);
  // Now flip the first match: seed 4 wins instead.
  b = C.setWinner(b, 0, 0, 'b');
  eq(b.rounds[1][0].a.seed, 4);      // final slot updated
  eq(b.rounds[1][0].winner, null);   // downstream winner cleared
  eq(C.champion(b), null);
});

// --- round names -------------------------------------------------------
test_('round names read from the end', () => {
  eq(C.roundName(2, 3), 'Final');
  eq(C.roundName(1, 3), 'Semifinals');
  eq(C.roundName(0, 3), 'Quarterfinals');
  eq(C.roundName(0, 4), 'Round of 16');
});

// --- standalone runner -------------------------------------------------
if (!isJest) {
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    try {
      c.fn();
      pass++;
    } catch (e) {
      fail++;
      console.error('✗ ' + c.name);
      console.error('  ' + String(e.message).split('\n').join('\n  '));
    }
  }
  if (fail === 0) console.log(`All ${pass} tests passed.`);
  else {
    console.log(`${pass} passed, ${fail} failed.`);
    process.exitCode = 1;
  }
}
