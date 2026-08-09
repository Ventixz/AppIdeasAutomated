// tests.js — dependency-free test suite for tz-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const {
  DIRECTORY,
  formatOffset,
  localTime,
  formatLocalTime,
  lookupUser,
  parseCommand,
  buildTable,
  handleMessage,
} = require('./tz-core.js');

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
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// A fixed instant: 2026-08-09T12:00:00Z.
const NOON_UTC = Date.UTC(2026, 7, 9, 12, 0, 0);

// --- formatOffset ---------------------------------------------------------
eq(formatOffset(0), 'UTC+00:00', 'zero offset');
eq(formatOffset(-8 * 60), 'UTC-08:00', 'negative whole-hour offset');
eq(formatOffset(5 * 60 + 30), 'UTC+05:30', 'half-hour offset (IST)');
eq(formatOffset(13 * 60), 'UTC+13:00', 'far-east offset stays inside range');

// --- localTime / formatLocalTime -----------------------------------------
eq(localTime(NOON_UTC, 0), { hh: 12, mm: 0, dayShift: 0 }, 'UTC noon at zero offset');
eq(localTime(NOON_UTC, -8 * 60), { hh: 4, mm: 0, dayShift: 0 }, 'noon UTC is 04:00 in PST');
eq(localTime(NOON_UTC, 5 * 60 + 30), { hh: 17, mm: 30, dayShift: 0 }, 'IST half-hour math');
// +13h from noon crosses midnight into the next day.
eq(localTime(NOON_UTC, 13 * 60), { hh: 1, mm: 0, dayShift: 1 }, 'crossing forward past midnight');
// A far-west offset near UTC midnight lands on the previous day.
eq(localTime(Date.UTC(2026, 7, 9, 2, 0, 0), -8 * 60), { hh: 18, mm: 0, dayShift: -1 }, 'crossing back before midnight');
eq(formatLocalTime(NOON_UTC, 13 * 60), '01:00 (+1d)', 'next-day marker rendered');
eq(formatLocalTime(Date.UTC(2026, 7, 9, 2, 0, 0), -8 * 60), '18:00 (-1d)', 'prev-day marker rendered');
eq(formatLocalTime(NOON_UTC, 0), '12:00', 'same-day has no marker');

// --- lookupUser -----------------------------------------------------------
assert(lookupUser(DIRECTORY, 'alice') !== null, 'known user found');
assert(lookupUser(DIRECTORY, 'ALICE') !== null, 'lookup is case-insensitive');
assert(lookupUser(DIRECTORY, '@Grace') !== null, 'leading @ is tolerated');
assert(lookupUser(DIRECTORY, '  bob  ') !== null, 'surrounding whitespace tolerated');
assert(lookupUser(DIRECTORY, 'nobody') === null, 'unknown user is null');
assert(lookupUser(DIRECTORY, 42) === null, 'non-string is null');

// --- parseCommand ---------------------------------------------------------
eq(parseCommand('/tz alice bob'), { command: 'tz', args: ['alice', 'bob'] }, 'basic parse');
eq(parseCommand('  /tz   alice   @Bob '), { command: 'tz', args: ['alice', '@Bob'] }, 'extra whitespace collapsed');
eq(parseCommand('/TZ alice'), { command: 'tz', args: ['alice'] }, 'command lowercased');
eq(parseCommand('/tz'), { command: 'tz', args: [] }, 'command with no args');
assert(parseCommand('hello world') === null, 'non-slash message is null');
assert(parseCommand('') === null, 'empty string is null');
assert(parseCommand('/') === null, 'lone slash is null');

// --- buildTable -----------------------------------------------------------
{
  const { rows, unknown } = buildTable(DIRECTORY, ['alice', 'grace', 'hiroshi'], NOON_UTC);
  eq(rows.length, 3, 'three known users -> three rows');
  eq(unknown, [], 'no unknowns');
  eq(rows.map((r) => r.stripe), [0, 1, 0], 'stripes alternate for readability');
  eq(rows[1].abbr, 'IST', 'Grace carries the IST abbreviation (bonus feature)');
  eq(rows[0].localTime, '04:00', 'Alice local time computed');
  eq(rows[0].offset, 'UTC-08:00', 'Alice offset formatted');
}

{
  // Unknown users are collected, and stripes only count the visible rows.
  const { rows, unknown } = buildTable(DIRECTORY, ['alice', 'ghost', 'bob'], NOON_UTC);
  eq(rows.length, 2, 'unknown user is skipped from rows');
  eq(unknown, ['ghost'], 'unknown user is reported');
  eq(rows.map((r) => r.stripe), [0, 1], 'stripes ignore the skipped unknown row');
}

// --- handleMessage --------------------------------------------------------
{
  const res = handleMessage(DIRECTORY, '/tz alice bob', NOON_UTC);
  assert(res.ok === true, 'valid command succeeds');
  eq(res.rows.length, 2, 'handleMessage returns rows');
}
{
  const res = handleMessage(DIRECTORY, '/tz', NOON_UTC);
  assert(res.ok === false && res.error === 'no-users', 'no-users error surfaced');
}
{
  const res = handleMessage(DIRECTORY, '/weather nyc', NOON_UTC);
  assert(res.ok === false && res.error === 'unknown-command', 'non-tz command rejected');
}
{
  const res = handleMessage(DIRECTORY, 'just chatting', NOON_UTC);
  assert(res.ok === false && res.error === 'unknown-command', 'plain chat rejected');
}

// --- summary --------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed.');
}
