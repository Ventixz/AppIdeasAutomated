// tests.js — dependency-free test suite for calendar-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const C = require('./calendar-core.js');

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
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (_e) { threw = true; }
  assert(threw, msg);
}

// A deterministic id generator so events get predictable ids.
function seqIds() {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

// --- Date helpers --------------------------------------------------------

eq(C.pad2(3), '03', 'pad2 single digit');
eq(C.dateKey(2026, 8, 16), '2026-08-16', 'dateKey builds key');
deepEq(C.parseDateKey('2026-08-16'), { year: 2026, month: 8, day: 16 }, 'parseDateKey');
throws(() => C.parseDateKey('2026-13-01'), 'parseDateKey rejects month 13');
throws(() => C.parseDateKey('2026-02-30'), 'parseDateKey rejects Feb 30');
throws(() => C.parseDateKey('not-a-date'), 'parseDateKey rejects garbage');

assert(C.isValidDateKey('2026-01-31'), 'isValidDateKey accepts real date');
assert(!C.isValidDateKey('2026-04-31'), 'isValidDateKey rejects Apr 31');
assert(!C.isValidDateKey(''), 'isValidDateKey rejects empty');

assert(C.isValidTime(''), 'empty time allowed');
assert(C.isValidTime('09:30'), 'valid time');
assert(C.isValidTime('23:59'), 'valid edge time');
assert(!C.isValidTime('24:00'), 'reject 24:00');
assert(!C.isValidTime('9:30'), 'reject unpadded hour');
assert(!C.isValidTime('12:60'), 'reject minute 60');

eq(C.daysInMonth(2026, 2), 28, 'Feb 2026 has 28 days');
eq(C.daysInMonth(2024, 2), 29, 'Feb 2024 (leap) has 29 days');
eq(C.daysInMonth(2000, 2), 29, 'Feb 2000 (leap) has 29 days');
eq(C.daysInMonth(1900, 2), 28, 'Feb 1900 (not leap) has 28 days');
eq(C.daysInMonth(2026, 4), 30, 'April has 30 days');

// 2026-08-16 is a Sunday.
eq(C.weekdayOf('2026-08-16'), 0, 'weekdayOf Sunday');
eq(C.weekdayOf('2026-08-17'), 1, 'weekdayOf Monday');

// addMonths wraps years both directions.
deepEq(C.addMonths(2026, 12, 1), { year: 2027, month: 1 }, 'addMonths forward across year');
deepEq(C.addMonths(2026, 1, -1), { year: 2025, month: 12 }, 'addMonths back across year');
deepEq(C.addMonths(2026, 6, 8), { year: 2027, month: 2 }, 'addMonths +8');
deepEq(C.addMonths(2026, 3, -5), { year: 2025, month: 10 }, 'addMonths -5');
eq(C.monthLabel(2026, 8), 'August 2026', 'monthLabel');

// --- Month grid ----------------------------------------------------------

const grid = C.monthGrid(2026, 8, '2026-08-16');
assert(grid.every((w) => w.length === 7), 'every week has 7 cells');
// August 2026 starts on a Saturday (2026-08-01 is Sat), so the first row is
// mostly July with Aug 1 in the last cell.
eq(grid[0].length, 7, 'first week has 7 cells');
eq(grid[0][6].key, '2026-08-01', 'Aug 1 sits in the last cell of week 1');
assert(!grid[0][0].inMonth, 'leading cells are out of month');
const flat = grid.flat();
const inMonth = flat.filter((c) => c.inMonth);
eq(inMonth.length, 31, 'August has 31 in-month cells');
eq(inMonth[0].key, '2026-08-01', 'first in-month cell is the 1st');
eq(inMonth[30].key, '2026-08-31', 'last in-month cell is the 31st');
const today = flat.find((c) => c.isToday);
eq(today.key, '2026-08-16', 'today is flagged');
eq(flat.filter((c) => c.isToday).length, 1, 'exactly one today cell');

// A month that starts on Sunday needs no leading cells.
const feb = C.monthGrid(2026, 2, null); // 2026-02-01 is a Sunday
eq(feb[0][0].key, '2026-02-01', 'Feb 2026 grid starts on the 1st');
assert(feb[0][0].inMonth, 'Feb 1 is in month');

// --- Event validation ----------------------------------------------------

assert(C.validateEvent({ title: 'Dentist', date: '2026-08-20' }).valid, 'minimal event valid');
assert(!C.validateEvent({ title: '', date: '2026-08-20' }).valid, 'empty title invalid');
assert(!C.validateEvent({ title: '  ', date: '2026-08-20' }).valid, 'whitespace title invalid');
assert(!C.validateEvent({ title: 'x', date: 'bad' }).valid, 'bad date invalid');
assert(!C.validateEvent({ title: 'x', date: '2026-08-20', time: '99:99' }).valid, 'bad time invalid');
assert(!C.validateEvent({ title: 'x', date: '2026-08-20', reminderMinutes: -5 }).valid, 'negative reminder invalid');
assert(!C.validateEvent({ title: 'x', date: '2026-08-20', reminderMinutes: 1.5 }).valid, 'fractional reminder invalid');
assert(C.validateEvent({ title: 'x', date: '2026-08-20', reminderMinutes: 0 }).valid, 'zero reminder valid');
const longTitle = 'a'.repeat(121);
assert(!C.validateEvent({ title: longTitle, date: '2026-08-20' }).valid, 'over-long title invalid');
deepEq(
  Object.keys(C.validateEvent({ title: '', date: 'bad', time: 'x' }).errors).sort(),
  ['date', 'time', 'title'],
  'multiple errors reported',
);

// --- createEvent ---------------------------------------------------------

const ids = seqIds();
const e1 = C.createEvent({ title: '  Lunch ', date: '2026-08-16', time: '12:30', description: ' with Sam ' }, { idGen: ids });
eq(e1.id, 'id-1', 'createEvent uses injected id');
eq(e1.title, 'Lunch', 'title trimmed');
eq(e1.description, 'with Sam', 'description trimmed');
eq(e1.time, '12:30', 'time kept');
eq(e1.reminderMinutes, null, 'no reminder by default');
eq(e1.color, C.DEFAULT_COLOR, 'default color applied');
throws(() => C.createEvent({ title: '', date: '2026-08-16' }, { idGen: ids }), 'createEvent throws on invalid');

// --- add / update / delete -----------------------------------------------

let events = [];
events = C.addEvent(events, { title: 'A', date: '2026-08-16' }, { idGen: ids });
events = C.addEvent(events, { title: 'B', date: '2026-08-17', time: '09:00' }, { idGen: ids });
eq(events.length, 2, 'two events added');
const aId = events[0].id;
const bId = events[1].id;

const afterEdit = C.updateEvent(events, aId, { title: 'A-edited', time: '15:00' });
eq(afterEdit.find((e) => e.id === aId).title, 'A-edited', 'update changes title');
eq(afterEdit.find((e) => e.id === aId).time, '15:00', 'update changes time');
eq(events.find((e) => e.id === aId).title, 'A', 'original array untouched (immutable)');
throws(() => C.updateEvent(events, aId, { title: '' }), 'update re-validates');

const afterDelete = C.deleteEvent(events, aId);
eq(afterDelete.length, 1, 'delete removes one');
assert(!afterDelete.some((e) => e.id === aId), 'deleted id gone');
eq(events.length, 2, 'delete is immutable');

// --- moveEvent (drag between dates) --------------------------------------

const moved = C.moveEvent(events, aId, '2026-08-25');
eq(moved.find((e) => e.id === aId).date, '2026-08-25', 'moveEvent changes date');
eq(events.find((e) => e.id === aId).date, '2026-08-16', 'moveEvent is immutable');
throws(() => C.moveEvent(events, aId, 'nope'), 'moveEvent rejects bad date');
const noMove = C.moveEvent(events, aId, '2026-08-16');
eq(noMove.find((e) => e.id === aId), events.find((e) => e.id === aId), 'moveEvent to same date is a no-op reference');

// Moving clears a fired reminder so it can fire again on the new date.
let remEvents = [C.createEvent({ title: 'R', date: '2026-08-16', time: '10:00', reminderMinutes: 10, remindedAt: 123 }, { idGen: ids })];
const rId = remEvents[0].id;
remEvents = C.moveEvent(remEvents, rId, '2026-08-20');
eq(remEvents[0].remindedAt, null, 'move reschedules reminder');

// Editing the time also reschedules the reminder.
let re2 = [C.createEvent({ title: 'R2', date: '2026-08-16', time: '10:00', reminderMinutes: 10, remindedAt: 999 }, { idGen: ids })];
re2 = C.updateEvent(re2, re2[0].id, { time: '11:00' });
eq(re2[0].remindedAt, null, 'time edit reschedules reminder');
// Editing an unrelated field keeps remindedAt.
let re3 = [C.createEvent({ title: 'R3', date: '2026-08-16', time: '10:00', reminderMinutes: 10, remindedAt: 777 }, { idGen: ids })];
re3 = C.updateEvent(re3, re3[0].id, { description: 'note' });
eq(re3[0].remindedAt, 777, 'non-schedule edit keeps remindedAt');

// --- Querying ------------------------------------------------------------

const qEvents = [
  C.createEvent({ title: 'Zebra', date: '2026-08-16' }, { idGen: ids }),        // all-day
  C.createEvent({ title: 'Apple', date: '2026-08-16', time: '09:00' }, { idGen: ids }),
  C.createEvent({ title: 'Mango', date: '2026-08-16', time: '09:00' }, { idGen: ids }),
  C.createEvent({ title: 'Other', date: '2026-08-17', time: '08:00' }, { idGen: ids }),
];
const day16 = C.eventsForDate(qEvents, '2026-08-16');
deepEq(day16.map((e) => e.title), ['Apple', 'Mango', 'Zebra'], 'timed events sort before all-day, ties by title');
eq(C.eventsForDate(qEvents, '2026-08-18').length, 0, 'empty day returns []');
const byDate = C.eventsByDate(qEvents);
eq(byDate['2026-08-16'].length, 3, 'eventsByDate groups the 16th');
eq(byDate['2026-08-17'].length, 1, 'eventsByDate groups the 17th');
deepEq(byDate['2026-08-16'].map((e) => e.title), ['Apple', 'Mango', 'Zebra'], 'eventsByDate sorts each day');

// --- Reminders -----------------------------------------------------------

const startMs = C.eventStartMs({ date: '2026-08-16', time: '10:00' });
eq(startMs, Date.UTC(2026, 7, 16, 10, 0), 'eventStartMs uses date+time');
eq(C.eventStartMs({ date: '2026-08-16', time: '' }), Date.UTC(2026, 7, 16, 0, 0), 'all-day starts at midnight');

const remEv = C.createEvent({ title: 'Call', date: '2026-08-16', time: '10:00', reminderMinutes: 15 }, { idGen: ids });
eq(C.reminderFireMs(remEv), Date.UTC(2026, 7, 16, 9, 45), 'fire time is 15 min before start');
eq(C.reminderFireMs({ reminderMinutes: null }), null, 'no reminder -> null fire time');

const pool = [
  C.createEvent({ title: 'Soon', date: '2026-08-16', time: '10:00', reminderMinutes: 15 }, { idGen: ids }),
  C.createEvent({ title: 'Later', date: '2026-08-16', time: '18:00', reminderMinutes: 15 }, { idGen: ids }),
  C.createEvent({ title: 'NoReminder', date: '2026-08-16', time: '10:00' }, { idGen: ids }),
];
const at945 = Date.UTC(2026, 7, 16, 9, 45);
let due = C.dueReminders(pool, at945);
deepEq(due.map((e) => e.title), ['Soon'], 'only the 09:45 reminder is due at 09:45');
// Nothing due a minute earlier.
deepEq(C.dueReminders(pool, at945 - 60000).map((e) => e.title), [], 'nothing due before fire time');
// Both due by the evening.
deepEq(C.dueReminders(pool, Date.UTC(2026, 7, 16, 20, 0)).map((e) => e.title), ['Soon', 'Later'], 'both reminders due, sorted by fire time');
// Marking reminded removes it from the due set.
const marked = C.markReminded(pool, pool[0].id, at945);
deepEq(C.dueReminders(marked, at945).map((e) => e.title), [], 'marked reminder no longer due');
eq(pool[0].remindedAt, null, 'markReminded is immutable');

// wallClockNow mirrors eventStartMs for a Date.
const d = new Date(2026, 7, 16, 9, 45, 0);
eq(C.wallClockNow(d), Date.UTC(2026, 7, 16, 9, 45, 0), 'wallClockNow matches Date.UTC of wall time');

// --- Storage round-trips and tolerates corruption ------------------------

const store = C.serialize(qEvents);
const back = C.deserialize(store);
eq(back.length, qEvents.length, 'serialize/deserialize preserves count');
deepEq(back.map((e) => e.title).sort(), qEvents.map((e) => e.title).sort(), 'serialize/deserialize preserves titles');

eq(C.deserialize('').length, 0, 'empty string -> []');
eq(C.deserialize(null).length, 0, 'null -> []');
eq(C.deserialize('{not json').length, 0, 'bad JSON -> []');
eq(C.deserialize('42').length, 0, 'non-array payload -> []');
// A mix of good and corrupt events: the good ones survive.
const mixed = JSON.stringify({
  version: 1,
  events: [
    { id: 'ok', title: 'Good', date: '2026-08-16' },
    { id: 'bad1', title: '', date: '2026-08-16' },     // no title
    { id: 'bad2', title: 'X', date: 'nope' },          // bad date
    null,                                              // junk
    'string',                                          // junk
    { id: 'ok2', title: 'AlsoGood', date: '2026-08-17', time: '09:00' },
  ],
});
const recovered = C.deserialize(mixed);
deepEq(recovered.map((e) => e.title).sort(), ['AlsoGood', 'Good'], 'corrupt events dropped, good ones kept');
// Deserialised events are fully normalised.
assert(recovered.every((e) => e.color && e.reminderMinutes === null), 'recovered events are normalised');

// Also accept a bare array payload (older format).
eq(C.deserialize(JSON.stringify([{ title: 'Bare', date: '2026-08-16' }])).length, 1, 'bare-array payload accepted');

// --- Report --------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
else console.log('All ' + passed + ' tests passed.');
