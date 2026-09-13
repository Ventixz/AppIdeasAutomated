/*
 * tests.js — dependency-free suite for alarm-core.js. Run with:
 *   node projects/phase2-numbers/alarm-clock/tests.js
 *
 * Because every "now" is injected, the suite can fast-forward through minutes,
 * days and weeks instantly. It covers time and duration parsing (and their
 * formatting inverses), next-occurrence scheduling for one-shot / daily /
 * weekly / weekend alarms, the tick() ring-detection contract (half-open
 * window, no double fire, one-shot self-disable, catching up a long gap),
 * countdown timers, snooze, and a batch of property sweeps.
 */

'use strict';

var core = require('./alarm-core.js');
var AlarmClock = core.AlarmClock;

var passed = 0, failed = 0;

function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}

function eq(name, got, want) {
  var ok = got === want;
  if (!ok) { console.error('  FAIL: ' + name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); failed++; }
  else { passed++; }
}

function throws(name, fn) {
  try { fn(); check(name + ' throws', false); }
  catch (e) { check(name + ' throws', true); }
}

/* Local time helper so tests are timezone-independent. */
function at(y, mo, d, h, mi, s) { return new Date(y, mo - 1, d, h, mi, s || 0).getTime(); }

/* ---------- time-of-day parsing --------------------------------------- */

eq('parse 07:30', core.parseTimeOfDay('07:30'), 7 * 3600 + 30 * 60);
eq('parse 7:30', core.parseTimeOfDay('7:30'), 7 * 3600 + 30 * 60);
eq('parse 23:05:09', core.parseTimeOfDay('23:05:09'), 23 * 3600 + 5 * 60 + 9);
eq('parse 00:00', core.parseTimeOfDay('00:00'), 0);
eq('parse 12:00 am -> midnight', core.parseTimeOfDay('12:00 am'), 0);
eq('parse 12:00 pm -> noon', core.parseTimeOfDay('12:00 pm'), 12 * 3600);
eq('parse 1:05 pm', core.parseTimeOfDay('1:05 pm'), 13 * 3600 + 5 * 60);
eq('parse 7:30AM no space', core.parseTimeOfDay('7:30AM'), 7 * 3600 + 30 * 60);
eq('parse 11:59 pm', core.parseTimeOfDay('11:59 pm'), 23 * 3600 + 59 * 60);
eq('parse whitespace', core.parseTimeOfDay('  08:15  '), 8 * 3600 + 15 * 60);

throws('empty time', function () { core.parseTimeOfDay(''); });
throws('minutes 60', function () { core.parseTimeOfDay('07:60'); });
throws('hours 24', function () { core.parseTimeOfDay('24:00'); });
throws('seconds 60', function () { core.parseTimeOfDay('07:30:60'); });
throws('12h hour 0', function () { core.parseTimeOfDay('0:30 am'); });
throws('12h hour 13', function () { core.parseTimeOfDay('13:00 pm'); });
throws('garbage', function () { core.parseTimeOfDay('half past seven'); });
throws('too many parts', function () { core.parseTimeOfDay('1:2:3:4'); });
throws('non-numeric', function () { core.parseTimeOfDay('aa:bb'); });

/* ---------- time-of-day formatting (inverse) -------------------------- */

eq('format 27000', core.formatTimeOfDay(27000), '07:30');
eq('format seconds', core.formatTimeOfDay(23 * 3600 + 5 * 60 + 9), '23:05:09');
eq('format 12h am', core.formatTimeOfDay(0, { hour12: true }), '12:00 AM');
eq('format 12h noon', core.formatTimeOfDay(12 * 3600, { hour12: true }), '12:00 PM');
eq('format 12h pm', core.formatTimeOfDay(13 * 3600 + 5 * 60, { hour12: true }), '1:05 PM');
eq('format wraps negative', core.formatTimeOfDay(-3600), '23:00');

// Round-trip: parse . format . parse is stable for a spread of times.
(function () {
  var samples = ['00:00', '06:07', '07:30', '12:00', '13:45', '23:59', '09:09:09'];
  var ok = true;
  for (var i = 0; i < samples.length; i++) {
    var sod = core.parseTimeOfDay(samples[i]);
    if (core.parseTimeOfDay(core.formatTimeOfDay(sod, { seconds: true })) !== sod) { ok = false; }
  }
  check('time parse/format round-trip', ok);
})();

/* ---------- duration parsing & formatting ----------------------------- */

eq('dur bare seconds', core.parseDuration('90'), 90);
eq('dur 5m', core.parseDuration('5m'), 300);
eq('dur 1h30m', core.parseDuration('1h30m'), 5400);
eq('dur spaced tokens', core.parseDuration('1h 30m 15s'), 5415);
eq('dur mm:ss', core.parseDuration('1:30'), 90);
eq('dur hh:mm:ss', core.parseDuration('1:30:00'), 5400);
eq('dur 45s', core.parseDuration('45s'), 45);
eq('dur reorder', core.parseDuration('15s 1h'), 3615);

throws('dur empty', function () { core.parseDuration(''); });
throws('dur zero', function () { core.parseDuration('0'); });
throws('dur zero tokens', function () { core.parseDuration('0m'); });
throws('dur negative-ish', function () { core.parseDuration('-5'); });
throws('dur repeated unit', function () { core.parseDuration('5m 5m'); });
throws('dur junk', function () { core.parseDuration('soon'); });
throws('dur mixed junk', function () { core.parseDuration('5x'); });

eq('fmt dur 5415', core.formatDuration(5415), '1h 30m 15s');
eq('fmt dur 90', core.formatDuration(90), '1m 30s');
eq('fmt dur 0', core.formatDuration(0), '0s');
eq('fmt dur 3600', core.formatDuration(3600), '1h');
eq('fmt clock 90', core.formatClock(90), '01:30');
eq('fmt clock 3661', core.formatClock(3661), '01:01:01');

// Round-trip: parseDuration(formatClock(n)) === n for positive n (a timer is
// always > 0, and formatClock(0) -> "00:00" -> parseDuration rejects zero).
(function () {
  var ok = true;
  for (var n = 1; n < 100000; n += 777) {
    if (core.parseDuration(core.formatClock(n)) !== n) { ok = false; break; }
  }
  check('duration clock round-trip', ok);
})();

/* ---------- describeDays / normalizeDays ------------------------------ */

eq('describe once', core.describeDays([]), 'Once');
eq('describe every day', core.describeDays([0, 1, 2, 3, 4, 5, 6]), 'Every day');
eq('describe weekdays', core.describeDays([1, 2, 3, 4, 5]), 'Weekdays');
eq('describe weekends', core.describeDays([0, 6]), 'Weekends');
eq('describe some', core.describeDays([1, 3]), 'Mon, Wed');
eq('normalize dedup+sort', core.normalizeDays([3, 1, 3, 0]).join(','), '0,1,3');
throws('normalize bad day', function () { core.normalizeDays([7]); });
throws('normalize non-int', function () { core.normalizeDays([1.5]); });

/* ---------- nextAlarmOccurrence --------------------------------------- */

// 2026-09-14 is a Monday (JS getDay()===1). Anchor the schedule tests to it.
(function () {
  var mondayMorning = at(2026, 9, 14, 6, 0, 0); // Mon 06:00

  // One-shot at 07:30 today -> today 07:30.
  var oneShot = { at: core.parseTimeOfDay('07:30'), days: [] };
  eq('one-shot later today', core.nextAlarmOccurrence(oneShot, mondayMorning), at(2026, 9, 14, 7, 30, 0));

  // One-shot at 05:00 (already passed) -> tomorrow 05:00.
  var passedToday = { at: core.parseTimeOfDay('05:00'), days: [] };
  eq('one-shot rolls to tomorrow', core.nextAlarmOccurrence(passedToday, mondayMorning), at(2026, 9, 15, 5, 0, 0));

  // Daily at 07:30 from Mon 08:00 (passed) -> Tue 07:30.
  var daily = { at: core.parseTimeOfDay('07:30'), days: [0, 1, 2, 3, 4, 5, 6] };
  eq('daily rolls to tomorrow', core.nextAlarmOccurrence(daily, at(2026, 9, 14, 8, 0, 0)), at(2026, 9, 15, 7, 30, 0));

  // Weekly Wednesday-only from Monday -> that Wednesday.
  var wed = { at: core.parseTimeOfDay('09:00'), days: [3] };
  eq('weekly to Wednesday', core.nextAlarmOccurrence(wed, mondayMorning), at(2026, 9, 16, 9, 0, 0));

  // Weekly on the same weekday but time already passed -> next week.
  var monLate = { at: core.parseTimeOfDay('05:00'), days: [1] };
  eq('weekly wraps a full week', core.nextAlarmOccurrence(monLate, mondayMorning), at(2026, 9, 21, 5, 0, 0));

  // Exactly at the ring instant is treated as passed (strictly future).
  var exact = { at: core.parseTimeOfDay('06:00'), days: [] };
  eq('exact instant is not "next"', core.nextAlarmOccurrence(exact, mondayMorning), at(2026, 9, 15, 6, 0, 0));
})();

/* ---------- tick(): ring detection ------------------------------------ */

// A one-shot alarm rings once, in the right window, then disables itself.
(function () {
  var c = new AlarmClock();
  var a = c.addAlarm(core.parseTimeOfDay('07:30'), [], 'wake');
  c.tick(at(2026, 9, 14, 7, 29, 0));                 // prime lastTick, nothing due
  var f1 = c.tick(at(2026, 9, 14, 7, 30, 30));       // window crosses 07:30
  eq('one-shot fires once', f1.length, 1);
  check('fired id matches', f1.length === 1 && f1[0].id === a.id);
  var f2 = c.tick(at(2026, 9, 14, 7, 31, 0));        // next tick: nothing
  eq('one-shot does not re-fire', f2.length, 0);
  check('one-shot disabled after firing', a.enabled === false);
})();

// The window is half-open: a ring exactly on a tick boundary fires exactly once.
(function () {
  var c = new AlarmClock();
  c.addAlarm(core.parseTimeOfDay('07:30'), [1, 2, 3, 4, 5], 'work');
  c.tick(at(2026, 9, 14, 7, 29, 59));
  var onBoundary = c.tick(at(2026, 9, 14, 7, 30, 0)); // exactly 07:30
  eq('fires on boundary tick', onBoundary.length, 1);
  var after = c.tick(at(2026, 9, 14, 7, 30, 0));      // same instant again
  eq('same instant not repeated', after.length, 0);
})();

// A daily alarm rings each day.
(function () {
  var c = new AlarmClock();
  c.addAlarm(core.parseTimeOfDay('07:30'), [0, 1, 2, 3, 4, 5, 6]);
  c.tick(at(2026, 9, 14, 0, 0, 0));
  var d1 = c.tick(at(2026, 9, 14, 12, 0, 0)); // Mon: crossed 07:30
  var d2 = c.tick(at(2026, 9, 15, 12, 0, 0)); // Tue: crossed 07:30
  eq('daily fires Monday', d1.length, 1);
  eq('daily fires Tuesday', d2.length, 1);
})();

// A long gap between ticks catches every missed daily ring (sleeping tab).
(function () {
  var c = new AlarmClock();
  c.addAlarm(core.parseTimeOfDay('07:30'), [0, 1, 2, 3, 4, 5, 6]);
  c.tick(at(2026, 9, 14, 8, 0, 0));            // after Monday's ring
  var caught = c.tick(at(2026, 9, 17, 8, 0, 0)); // three days later
  eq('gap catches Tue/Wed/Thu', caught.length, 3); // 15th,16th,17th at 07:30
})();

// A weekend alarm ignores weekdays.
(function () {
  var c = new AlarmClock();
  c.addAlarm(core.parseTimeOfDay('09:00'), [0, 6], 'lie-in');
  c.tick(at(2026, 9, 14, 0, 0, 0));            // Monday
  var mon = c.tick(at(2026, 9, 14, 12, 0, 0));
  eq('weekend skips Monday', mon.length, 0);
  c.tick(at(2026, 9, 19, 0, 0, 0));            // Saturday start
  var sat = c.tick(at(2026, 9, 19, 12, 0, 0));
  eq('weekend fires Saturday', sat.length, 1);
})();

// Disabled alarms never fire.
(function () {
  var c = new AlarmClock();
  var a = c.addAlarm(core.parseTimeOfDay('07:30'), [1]);
  c.setEnabled(a.id, false);
  c.tick(at(2026, 9, 14, 7, 0, 0));
  var f = c.tick(at(2026, 9, 14, 8, 0, 0));
  eq('disabled alarm silent', f.length, 0);
})();

/* ---------- timers ---------------------------------------------------- */

(function () {
  var c = new AlarmClock();
  var start = at(2026, 9, 14, 10, 0, 0);
  var t = c.addTimer(300, start, 'tea'); // 5 minutes
  c.tick(start);
  var early = c.tick(start + 4 * 60000);  // 4 min in: not yet
  eq('timer not early', early.length, 0);
  var done = c.tick(start + 5 * 60000 + 500); // just past 5 min
  eq('timer fires', done.length, 1);
  check('timer marked fired', t.fired === true);
  var again = c.tick(start + 10 * 60000);
  eq('timer fires once only', again.length, 0);
})();

throws('timer zero duration', function () { new AlarmClock().addTimer(0, 0); });

/* ---------- snooze ---------------------------------------------------- */

(function () {
  var c = new AlarmClock();
  var start = at(2026, 9, 14, 6, 0, 0);
  var a = c.addAlarm(core.parseTimeOfDay('06:00'), [], 'x');
  // Manually snooze 9 minutes from a ring at 06:00.
  var ringMs = at(2026, 9, 14, 6, 0, 0);
  // move it to a future one-shot first via next occurrence tomorrow; test snooze independently:
  c.snooze(a.id, ringMs, 9);
  c.tick(ringMs);
  var pre = c.tick(ringMs + 8 * 60000); // 8 min: snooze not yet
  eq('snooze not early', pre.length, 0);
  var post = c.tick(ringMs + 9 * 60000 + 100); // past 9 min
  eq('snooze fires', post.length, 1);
  check('snooze flagged', post.length === 1 && post[0].snoozed === true);
})();

// Snoozing a repeating alarm keeps its normal schedule intact.
(function () {
  var c = new AlarmClock();
  var a = c.addAlarm(core.parseTimeOfDay('07:30'), [0, 1, 2, 3, 4, 5, 6], 'daily');
  var base = at(2026, 9, 14, 7, 30, 5); // just rang
  c.tick(base);
  c.snooze(a.id, base, 5);
  var snoozeRing = c.tick(base + 5 * 60000 + 100);
  eq('repeating snooze fires', snoozeRing.length, 1);
  // Next day's normal ring still happens.
  var nextDay = c.tick(at(2026, 9, 15, 8, 0, 0));
  eq('repeating still fires next day', nextDay.length, 1);
})();

/* ---------- nextRingMs ------------------------------------------------ */

(function () {
  var c = new AlarmClock();
  var a = c.addAlarm(core.parseTimeOfDay('07:30'), [], 'x');
  var now = at(2026, 9, 14, 6, 0, 0);
  eq('nextRingMs one-shot', c.nextRingMs(a, now), at(2026, 9, 14, 7, 30, 0));
  c.setEnabled(a.id, false);
  eq('nextRingMs disabled -> null', c.nextRingMs(a, now), null);
})();

/* ---------- remove / get --------------------------------------------- */

(function () {
  var c = new AlarmClock();
  var a = c.addAlarm(core.parseTimeOfDay('07:30'), []);
  check('get finds it', c.get(a.id) === a);
  check('remove returns true', c.remove(a.id) === true);
  check('get gone', c.get(a.id) === null);
  check('remove missing false', c.remove('nope') === false);
})();

/* ---------- property sweeps ------------------------------------------- */

// (1) nextAlarmOccurrence is always strictly in the future.
(function () {
  var ok = true;
  var now = at(2026, 9, 14, 13, 37, 0);
  for (var sod = 0; sod < core.SECONDS_PER_DAY; sod += 137) {
    var occ = core.nextAlarmOccurrence({ at: sod, days: [] }, now);
    if (!(occ > now)) { ok = false; break; }
  }
  check('sweep: occurrence strictly future', ok);
})();

// (2) A one-shot always fires within the next 24h.
(function () {
  var ok = true;
  var now = at(2026, 9, 14, 13, 37, 0);
  for (var sod = 0; sod < core.SECONDS_PER_DAY; sod += 311) {
    var occ = core.nextAlarmOccurrence({ at: sod, days: [] }, now);
    if (occ - now > core.SECONDS_PER_DAY * 1000 + 1000) { ok = false; break; }
  }
  check('sweep: one-shot within 24h', ok);
})();

// (3) A weekly alarm always lands on one of its days.
(function () {
  var ok = true;
  var now = at(2026, 9, 14, 13, 37, 0);
  var daySets = [[0], [3], [1, 4], [0, 6], [2, 3, 5]];
  for (var i = 0; i < daySets.length; i++) {
    var occ = core.nextAlarmOccurrence({ at: 9 * 3600, days: daySets[i] }, now);
    if (occ == null || daySets[i].indexOf(new Date(occ).getDay()) === -1) { ok = false; break; }
  }
  check('sweep: weekly lands on a chosen day', ok);
})();

// (4) Ticking minute-by-minute across a day fires a daily alarm exactly once.
(function () {
  var c = new AlarmClock();
  c.addAlarm(core.parseTimeOfDay('07:30'), [0, 1, 2, 3, 4, 5, 6]);
  var count = 0;
  var startMs = at(2026, 9, 14, 0, 0, 0);
  c.tick(startMs);
  for (var min = 1; min <= 24 * 60; min++) {
    count += c.tick(startMs + min * 60000).length;
  }
  eq('sweep: daily fires once per day of minute-ticks', count, 1);
})();

// (5) Across a week, a Weekdays alarm fires exactly 5 times.
(function () {
  var c = new AlarmClock();
  c.addAlarm(core.parseTimeOfDay('07:30'), [1, 2, 3, 4, 5]);
  var count = 0;
  var startMs = at(2026, 9, 14, 0, 0, 0); // Monday
  c.tick(startMs);
  for (var h = 1; h <= 7 * 24; h++) {
    count += c.tick(startMs + h * 3600000).length;
  }
  eq('sweep: weekdays fires 5x/week', count, 5);
})();

/* ---------- report ---------------------------------------------------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
