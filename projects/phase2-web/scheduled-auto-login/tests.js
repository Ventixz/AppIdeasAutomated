'use strict';
/*
 * tests.js — dependency-free checks for scheduler-core.js.
 *
 * Anchored on facts you can check by hand: exact next-fire times across a day
 * boundary, the exponential backoff sequence and its jitter bounds, the session
 * state machine's transitions, the missed-run policies, credential redaction, and
 * a full scripted simulation whose event log is asserted event-by-event. The
 * clock and the randomness are injected everywhere, so every result is
 * deterministic. Run: `node tests.js`.
 */
const C = require('./scheduler-core.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function eq(name, got, want) {
  const good = got === want;
  if (!good) console.log(`      got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  ok(name, good);
}

// A fixed point in time to anchor the wall-clock tests. Work in UTC (offset 0)
// unless a test says otherwise, so the numbers are easy to verify.
const D = (iso) => Date.parse(iso);

console.log('\nWall-clock helpers (fixed offset, no DST)');
eq('wallParts reads hour in UTC', C.wallParts(D('2026-11-12T09:30:00Z'), 0).hour, 9);
eq('a -300min offset shifts 09:30Z to 04:30 local',
   C.wallParts(D('2026-11-12T09:30:00Z'), -300).hour, 4);
eq('wallToMs is the inverse of wallParts',
   C.wallToMs({ year: 2026, month: 10, day: 12, hour: 9, minute: 30 }, 0),
   D('2026-11-12T09:30:00Z'));
eq('minutesIntoDay for 09:30 is 570', C.minutesIntoDay(D('2026-11-12T09:30:00Z'), 0), 570);

console.log('\nnextRun — interval schedules land on a deterministic grid');
const iv = { kind: 'interval', everyMs: 15 * C.MS.minute, anchorMs: D('2026-11-12T00:00:00Z') };
eq('first fire after 00:00 is 00:15',
   C.nextRun(iv, D('2026-11-12T00:00:00Z'), 0), D('2026-11-12T00:15:00Z'));
eq('from 00:07 the next fire is still 00:15 (grid-aligned, not +15 from now)',
   C.nextRun(iv, D('2026-11-12T00:07:00Z'), 0), D('2026-11-12T00:15:00Z'));
eq('nextRun is STRICTLY after: from exactly 00:15 gives 00:30',
   C.nextRun(iv, D('2026-11-12T00:15:00Z'), 0), D('2026-11-12T00:30:00Z'));

console.log('\nnextRun — dailyAt recomputes the wall-clock time, never adds 24h');
const daily = { kind: 'dailyAt', hour: 9, minute: 0 };
eq('before 09:00, next fire is 09:00 today',
   C.nextRun(daily, D('2026-11-12T08:00:00Z'), 0), D('2026-11-12T09:00:00Z'));
eq('after 09:00, next fire is 09:00 tomorrow',
   C.nextRun(daily, D('2026-11-12T10:00:00Z'), 0), D('2026-11-13T09:00:00Z'));
eq('exactly at 09:00, next fire is tomorrow (strictly after)',
   C.nextRun(daily, D('2026-11-12T09:00:00Z'), 0), D('2026-11-13T09:00:00Z'));
// With a -300 offset, 09:00 LOCAL is 14:00Z.
eq('dailyAt respects the fixed offset (09:00 local = 14:00Z)',
   C.nextRun(daily, D('2026-11-12T00:00:00Z'), -300), D('2026-11-12T14:00:00Z'));

console.log('\nnextRun — weeklyAt picks the right weekday');
// 2026-11-12 is a Thursday (weekday 4). Ask for Monday (1) at 09:00.
const weekly = { kind: 'weeklyAt', weekday: 1, hour: 9, minute: 0 };
const nextMon = C.nextRun(weekly, D('2026-11-12T12:00:00Z'), 0);
eq('next Monday after Thu 2026-11-12 is 2026-11-16', nextMon, D('2026-11-16T09:00:00Z'));
eq('and it really is a Monday (weekday 1)', C.wallParts(nextMon, 0).weekday, 1);

console.log('\nnextRun rejects malformed schedules');
ok('unknown kind throws', (() => { try { C.nextRun({ kind: 'yearly' }, 0, 0); return false; } catch (e) { return true; } })());
ok('interval with no everyMs throws', (() => { try { C.nextRun({ kind: 'interval' }, 0, 0); return false; } catch (e) { return true; } })());
ok('dailyAt hour 24 throws', (() => { try { C.nextRun({ kind: 'dailyAt', hour: 24, minute: 0 }, 0, 0); return false; } catch (e) { return true; } })());

console.log('\nfireTimesBetween enumerates every fire in a window');
const fires = C.fireTimesBetween(iv, D('2026-11-12T00:00:00Z'), D('2026-11-12T01:00:00Z'), 0);
eq('four 15-min fires in the first hour (00:00,00:15,00:30,00:45,01:00)', fires.length, 5);
eq('first enumerated fire is 00:00', fires[0], D('2026-11-12T00:00:00Z'));

console.log('\nbackoffDelay — exponential sequence (jitter off is exact)');
const bo = { baseMs: 1000, factor: 2, maxMs: 30000, jitter: 'none' };
eq('attempt 1 = base (1000ms)', C.backoffDelay(1, bo), 1000);
eq('attempt 2 = base*factor (2000ms)', C.backoffDelay(2, bo), 2000);
eq('attempt 3 = 4000ms', C.backoffDelay(3, bo), 4000);
eq('attempt 4 = 8000ms', C.backoffDelay(4, bo), 8000);
eq('attempt 6 is capped at maxMs (30000)', C.backoffDelay(6, bo), 30000);
ok('attempt 0 is rejected', (() => { try { C.backoffDelay(0, bo); return false; } catch (e) { return true; } })());

console.log('\nbackoffDelay — jitter stays within its documented bounds');
// Full jitter: result in [0, raw]. Drive rng to its extremes.
eq('full jitter at rng=0 gives 0', C.backoffDelay(3, { ...bo, jitter: 'full' }, () => 0), 0);
eq('full jitter at rng~1 approaches raw (4000)', C.backoffDelay(3, { ...bo, jitter: 'full' }, () => 0.9999999) > 3999, true);
// Equal jitter: result in [raw/2, raw].
eq('equal jitter at rng=0 gives raw/2 (2000)', C.backoffDelay(3, { ...bo, jitter: 'equal' }, () => 0), 2000);
eq('equal jitter at rng~1 approaches raw (4000)', C.backoffDelay(3, { ...bo, jitter: 'equal' }, () => 0.9999999) > 3999, true);

console.log('\nSession state machine — validity is a function of time, not startup');
let s = C.newSession();
eq('a fresh session is logged-out', C.sessionStatus(s, 0), 'logged-out');
s = C.login(s, D('2026-11-12T09:00:00Z'), 30 * C.MS.minute);
eq('right after login the session is active', C.sessionStatus(s, D('2026-11-12T09:10:00Z')), 'active');
eq('just before TTL it is still active', C.sessionActive(s, D('2026-11-12T09:29:59Z')), true);
eq('at the TTL boundary it has expired', C.sessionActive(s, D('2026-11-12T09:30:00Z')), false);
eq('well past TTL the status reads expired', C.sessionStatus(s, D('2026-11-12T10:00:00Z')), 'expired');
eq('decideAction: due + active -> act', C.decideAction(s, D('2026-11-12T09:10:00Z'), true), 'act');
eq('decideAction: due + expired -> login', C.decideAction(s, D('2026-11-12T10:00:00Z'), true), 'login');
eq('decideAction: not due -> wait', C.decideAction(s, D('2026-11-12T09:10:00Z'), false), 'wait');

console.log('\nMissed-run policy — what to do about fires during downtime');
// Down from 00:02 to 00:50 on a 15-min interval: fires at 00:15, 00:30, 00:45.
const from = D('2026-11-12T00:02:00Z'), to = D('2026-11-12T00:50:00Z');
eq('three fires were missed', C.missedRunPolicy(iv, from, to, 'skip', 0).missedCount, 3);
eq('skip runs none now', C.missedRunPolicy(iv, from, to, 'skip', 0).runNow.length, 0);
eq('one runs a single catch-up', C.missedRunPolicy(iv, from, to, 'one', 0).runNow.length, 1);
eq('one catches up with the LAST missed fire (00:45)',
   C.missedRunPolicy(iv, from, to, 'one', 0).runNow[0], D('2026-11-12T00:45:00Z'));
eq('all runs every missed fire', C.missedRunPolicy(iv, from, to, 'all', 0).runNow.length, 3);
eq('next fire after downtime is 01:00', C.missedRunPolicy(iv, from, to, 'skip', 0).next, D('2026-11-12T01:00:00Z'));
ok('an unknown policy throws', (() => { try { C.missedRunPolicy(iv, from, to, 'nope', 0); return false; } catch (e) { return true; } })());

console.log('\nCredential redaction — secrets never survive to a log');
const cfg = {
  url: 'https://example.test', username: 'alice',
  password: 'hunter2-very-secret', apiKey: 'sk-abcdef123456',
  nested: { token: 'tok_ABCDEFGHIJ', note: 'keep me' },
  retries: 5,
};
const red = C.redactSecrets(cfg);
eq('username is kept (not a secret key)', red.username, 'alice');
eq('retries is kept', red.retries, 5);
eq('nested non-secret note is kept', red.nested.note, 'keep me');
ok('password is masked', red.password !== cfg.password && /\*\*\*/.test(red.password));
ok('apiKey is masked', /\*\*\*/.test(red.apiKey));
ok('nested token is masked', /\*\*\*/.test(red.nested.token));
ok('mask shows only the first/last 2 chars', red.password === 'hu***et');
ok('the original object is not mutated', cfg.password === 'hunter2-very-secret');
ok('circular references do not crash redaction', (() => {
  const o = { password: 'secretsecret' }; o.self = o;
  const r = C.redactSecrets(o); return /\*\*\*/.test(r.password) && r.self === '[circular]';
})());

console.log('\nSimulation — a scripted site drives an exact event log');
// Login fails once then succeeds; action fails once then succeeds. Single fire.
const scripted = C.makeScriptedSite(['fail', 'ok'], ['fail', 'ok']);
const oneFire = { kind: 'dailyAt', hour: 9, minute: 0 };
const simR = C.simulate({
  schedule: oneFire,
  startMs: D('2026-11-12T09:00:00Z'),
  endMs: D('2026-11-12T09:00:00Z'),          // exactly one fire
  sessionTtlMs: 30 * C.MS.minute,
  site: scripted,
  backoff: { baseMs: 1000, factor: 2, maxMs: 30000, jitter: 'none' },
  maxAttempts: 5,
  rng: () => 0.5,
});
const types = simR.log.map((e) => e.type);
eq('log begins with the fire', types[0], 'fire');
ok('it records a failed login then an ok login',
   types.includes('login-failed') && types.includes('login-ok'));
ok('it records a failed action then an ok action',
   types.includes('action-failed') && types.includes('action-ok'));
eq('exactly one successful action', simR.stats.actionsOk, 1);
eq('exactly two failures (one login, one action)', simR.stats.failures, 2);
eq('nothing was given up', simR.stats.givenUp, 0);

console.log('\nSimulation — a hard credential rejection gives up, never loops');
const rejects = C.makeScriptedSite(['reject'], []);
const rejR = C.simulate({
  schedule: oneFire,
  startMs: D('2026-11-12T09:00:00Z'), endMs: D('2026-11-12T09:00:00Z'),
  site: rejects, maxAttempts: 5, rng: () => 0.5,
});
eq('a rejected credential is given up on immediately', rejR.stats.givenUp, 1);
eq('and it never counts a successful action', rejR.stats.actionsOk, 0);
ok('the log names the rejection', rejR.log.some((e) => e.type === 'login-rejected'));

console.log('\nSimulation — a mid-action expiry triggers one re-auth, then succeeds');
const expiry = C.makeScriptedSite(['ok', 'ok'], ['expired', 'ok']);
const expR = C.simulate({
  schedule: oneFire,
  startMs: D('2026-11-12T09:00:00Z'), endMs: D('2026-11-12T09:00:00Z'),
  site: expiry, maxAttempts: 5, rng: () => 0.5,
});
eq('exactly one re-authentication', expR.stats.reauths, 1);
eq('two logins happened (initial + re-auth)', expR.stats.logins, 2);
eq('the action ultimately succeeded', expR.stats.actionsOk, 1);
eq('expiry is not counted as a failure (it is lifecycle)', expR.stats.failures, 0);

console.log('\nSimulation over a window fires on schedule the expected number of times');
const daySim = C.simulate({
  schedule: { kind: 'interval', everyMs: 6 * C.MS.hour, anchorMs: D('2026-11-12T00:00:00Z') },
  startMs: D('2026-11-12T00:00:00Z'), endMs: D('2026-11-12T23:59:00Z'),
  site: C.makeScriptedSite([], []),           // everything succeeds
  rng: () => 0.5,
});
eq('a 6-hour interval fires 4 times in a day (00,06,12,18)', daySim.stats.fires, 4);
eq('all four actions succeeded', daySim.stats.actionsOk, 4);

console.log('\nformatEvent renders a readable line');
ok('formatEvent includes the timestamp and type',
   /2026-11-12 09:00:00\s+fire/.test(C.formatEvent(simR.log[0], 0)));

console.log('\n' + (fail === 0
  ? `✓ all ${pass} checks passing`
  : `✗ ${fail} failed, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
