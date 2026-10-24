#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the uptime engine. Run: node tests.js
 *
 * Every number the monitor reports is time-weighted and depends on scheduling
 * and confirmation getting the timeline right, so these tests drive the engine
 * with explicit timestamps (no real clock) and prove the awkward cases:
 * drift-free ticks, catch-up capping, flap debounce, transition dating, and
 * uptime computed by duration rather than by counting checks.
 */
'use strict';

const core = require('./checker-core');
const fx = require('./checker-fixtures');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ~${b}`); }
function throws(fn, msg) { try { fn(); fail++; console.error('  FAIL (no throw):', msg); } catch (_) { pass++; } }
function section(n) { console.log(`\n# ${n}`); }

const SEC = 1000, MIN = 60 * SEC;

/* ---- 1. Target normalisation ---- */
section('target normalisation');
eq(core.normalizeTarget('example.com').url, 'https://example.com', 'bare host gets https');
eq(core.normalizeTarget('example.com').protocol, 'https', 'default scheme https');
eq(core.normalizeTarget('http://example.com').protocol, 'http', 'explicit http kept');
eq(core.normalizeTarget('EXAMPLE.COM/Path').host, 'example.com', 'host lowercased');
eq(core.normalizeTarget('https://x.io:8443/a').port, 8443, 'explicit port parsed');
eq(core.normalizeTarget('example.com').port, 443, 'https default port 443');
eq(core.normalizeTarget('http://example.com').port, 80, 'http default port 80');
eq(core.normalizeTarget('  https://example.com/health  ').url, 'https://example.com/health', 'trimmed, path kept');
throws(() => core.normalizeTarget(''), 'empty rejected');
throws(() => core.normalizeTarget('   '), 'whitespace-only rejected');
throws(() => core.normalizeTarget('ftp://example.com'), 'non-http scheme rejected');
throws(() => core.normalizeTarget('has space.com'), 'internal whitespace rejected');

/* ---- 2. Classifying a probe ---- */
section('classify');
eq(core.classify({ ok: true, status: 200, ms: 120 }).state, 'up', '200 is up');
eq(core.classify({ ok: true, status: 301, ms: 80 }).state, 'up', '301 redirect is up by default');
eq(core.classify({ status: 404, ms: 50 }).state, 'down', '404 is down');
eq(core.classify({ status: 500, ms: 50 }).state, 'down', '500 is down');
eq(core.classify({ status: 403, ms: 50 }).state, 'up', '403 auth-wall counts as up (reachable)');
eq(core.classify({ status: 401, ms: 50 }).state, 'up', '401 counts as up');
eq(core.classify({ status: 403 }, { treatAuthAsUp: false }).state, 'down', '403 down when treatAuthAsUp off');
eq(core.classify({ error: 'ETIMEDOUT' }).state, 'down', 'transport error is down');
eq(core.classify({ error: 'ECONNREFUSED' }).reason, 'ECONNREFUSED', 'error reason surfaced');
eq(core.classify(null).state, 'down', 'no probe object is down');
eq(core.classify({ status: 200, ms: 3000 }, { slowMs: 1000 }).state, 'down', 'too-slow is down (degraded)');
ok(core.classify({ status: 200, ms: 3000 }, { slowMs: 1000 }).degraded, 'slow flagged degraded');
eq(core.classify({ status: 299, ms: 10 }).state, 'up', 'upper 2xx boundary up');

/* ---- 3. Schedule: drift-free ticks + msUntilNext ---- */
section('schedule — drift-free ticks');
let sch = core.createSchedule({ startAt: 1000, intervalMs: 10 * SEC });
eq(sch.tickTime(0), 1000, 'tick 0 at startAt');
eq(sch.tickTime(3), 1000 + 3 * 10 * SEC, 'tick 3 anchored to start, not now');
eq(sch.indexAt(1000), 0, 'indexAt start = 0');
eq(sch.indexAt(1000 + 25 * SEC), 2, 'indexAt is floor of elapsed/interval');
eq(sch.indexAt(500), -1, 'before start = -1');
// poll advances; a single interval later yields exactly one tick.
eq(sch.poll(1000).fire.length, 1, 'first poll fires tick 0');
eq(sch.poll(1000 + 5 * SEC).due, false, 'mid-interval poll not due');
eq(sch.poll(1000 + 10 * SEC).fire.length, 1, 'next interval fires one tick');
// drift check: even if polls arrive late, the next due time stays on the grid.
sch = core.createSchedule({ startAt: 0, intervalMs: 10 * SEC });
sch.poll(0);
sch.poll(13 * SEC);                      // fired tick 1 (at 10s), 3s late
eq(sch.nextDueAt(), 20 * SEC, 'next tick stays on the 10s grid despite late poll');
eq(sch.msUntilNext(13 * SEC), 7 * SEC, 'msUntilNext counts to grid point, absorbing drift');

/* ---- 4. Schedule: catch-up capping after a sleep gap ---- */
section('schedule — catch-up capping');
sch = core.createSchedule({ startAt: 0, intervalMs: SEC, maxCatchUp: 1 });
sch.poll(0);                             // fire tick 0
let gap = sch.poll(10 * SEC);            // 10 ticks passed while "asleep"
eq(gap.fire.length, 1, 'only one check fires after a long gap');
eq(gap.skipped, 9, 'nine stale ticks skipped');
eq(gap.fire[0], 10 * SEC, 'the check fired is the most recent tick, not the oldest');
// a bigger catch-up budget fires more of the backlog but still caps it.
sch = core.createSchedule({ startAt: 0, intervalMs: SEC, maxCatchUp: 3 });
sch.poll(0);
gap = sch.poll(10 * SEC);
eq(gap.fire.length, 3, 'catch-up budget of 3 fires three checks');
eq(gap.skipped, 7, 'and skips the other seven');
throws(() => core.createSchedule({ intervalMs: 0 }), 'zero interval rejected');
throws(() => core.createSchedule({ intervalMs: SEC, maxCatchUp: 0 }), 'maxCatchUp 0 rejected');

/* ---- 5. Monitor: confirmation / anti-flap debounce ---- */
section('monitor — confirmation debounce');
// confirm=1: every raw change flips immediately.
let m = new core.Monitor({ confirmations: 1 });
m.push(0, core.classify({ status: 200 }));
eq(m.confirmed, 'up', 'first up confirmed immediately at confirm=1');
let r = m.push(SEC, core.classify({ status: 500 }));
ok(r.changed && r.to === 'down', 'single failure flips at confirm=1');
// confirm=2: a lone blip must NOT flip.
m = new core.Monitor({ confirmations: 2 });
m.push(0, core.classify({ status: 200 }));
m.push(SEC, core.classify({ status: 200 }));
r = m.push(2 * SEC, core.classify({ error: 'ECONNRESET' })); // lone blip
eq(r.changed, false, 'one bad check does not flip at confirm=2');
eq(m.confirmed, 'up', 'still up after a lone blip');
r = m.push(3 * SEC, core.classify({ status: 200 }));          // recovered
eq(m.confirmed, 'up', 'blip never became an outage');
eq(m.transitions.filter((t) => t.to === 'down').length, 0, 'no down transition recorded for the blip');

/* ---- 6. Monitor: transition dated to the FIRST failing check ---- */
section('monitor — transition dating');
m = new core.Monitor({ confirmations: 3 });
m.push(0, core.classify({ status: 200 }));
m.push(10 * SEC, core.classify({ status: 503 }));   // first failure — the real moment
m.push(20 * SEC, core.classify({ status: 503 }));
r = m.push(30 * SEC, core.classify({ status: 503 })); // confirmed here (3rd)
ok(r.changed && r.to === 'down', 'confirmed down on the third failure');
eq(m.transitions[0].at, 10 * SEC, 'but the outage is dated to the first failure, not the third');

/* ---- 7. Monitor: time-weighted uptime, not check-counted ---- */
section('monitor — time-weighted uptime');
// Checks are UNEVENLY spaced on purpose: 3 up checks close together, then one
// long down segment. Counting checks would say 3/4 = 75%; by TIME it's different.
m = new core.Monitor({ confirmations: 1 });
m.push(0, core.classify({ status: 200 }));        // up  [0 .. 10s)
m.push(1 * SEC, core.classify({ status: 200 }));  // still up
m.push(2 * SEC, core.classify({ status: 200 }));  // still up
m.push(10 * SEC, core.classify({ status: 500 })); // down [10s .. 20s)
let s = m.summary(20 * SEC);
eq(s.upMs, 10 * SEC, 'up time is the duration up, not the count of up checks');
eq(s.downMs, 10 * SEC, 'down time is the open final segment up to asOf');
near(s.uptimePct, 50, 0.001, 'uptime is 50% by time (a check-count would say 75%)');
eq(s.checksUp, 3, 'check counts still tracked separately');
eq(s.checks, 4, 'four checks total');

/* ---- 8. Monitor: segments, incidents, longest outage ---- */
section('monitor — segments & incidents');
m = new core.Monitor({ confirmations: 1 });
m.push(0, core.classify({ status: 200 }));          // up
m.push(10 * SEC, core.classify({ status: 500 }));   // down (10s..30s = 20s outage)
m.push(30 * SEC, core.classify({ status: 200 }));   // up again
m.push(50 * SEC, core.classify({ status: 500 }));   // down again, ongoing
s = m.summary(60 * SEC);
eq(s.outages, 2, 'two outages detected');
eq(s.incidents[0].ms, 20 * SEC, 'first outage lasted 20s');
ok(s.incidents[1].ongoing, 'second outage flagged ongoing');
eq(s.longestOutageMs, 20 * SEC, 'longest outage is the 20s one');
eq(s.transitionCount, 4, 'four confirmed transitions (up,down,up,down)');
eq(s.current, 'down', 'current confirmed state is down');
// segments tile the whole window with no gaps/overlaps.
const total = s.segments.reduce((a, g) => a + g.ms, 0);
eq(total, 60 * SEC, 'segments tile the full 60s window exactly');

/* ---- 9. Unknown prefix before first confirmed state ---- */
section('monitor — unknown window');
m = new core.Monitor({ confirmations: 2 });
m.push(0, core.classify({ status: 200 }));   // not yet confirmed (need 2)
m.push(5 * SEC, core.classify({ status: 200 })); // confirmed up, dated to t=0
s = m.summary(5 * SEC);
eq(s.unknownMs, 0, 'first confirmed run dated to its first sample, so no unknown gap');
eq(s.current, 'up', 'confirmed up');
// A run that starts down then flips: unknown only until first confirmation.
m = new core.Monitor({ confirmations: 2 });
m.push(0, core.classify({ status: 500 }));
m.push(4 * SEC, core.classify({ status: 500 })); // confirmed down, dated to 0
s = m.summary(8 * SEC);
eq(s.current, 'down', 'confirmed down');
eq(s.unknownMs, 0, 'no unknown window once first state confirms back to its start');

/* ---- 10. Ordering guard ---- */
section('monitor — ordering guard');
m = new core.Monitor();
m.push(10 * SEC, core.classify({ status: 200 }));
throws(() => m.push(5 * SEC, core.classify({ status: 200 })), 'out-of-order check rejected');
throws(() => m.summary(3 * SEC), 'asOf before start rejected');

/* ---- 11. humanDuration ---- */
section('humanDuration');
eq(core.humanDuration(500), '500ms', 'sub-second');
eq(core.humanDuration(5 * SEC), '5s', 'seconds');
eq(core.humanDuration(90 * SEC), '1m 30s', 'minutes + seconds');
eq(core.humanDuration(2 * MIN), '2m', 'whole minutes');
eq(core.humanDuration(3 * 60 * MIN), '3h', 'hours');
eq(core.humanDuration(25 * 60 * MIN), '1d 1h', 'days + hours');
eq(core.humanDuration(null), '—', 'null duration');

/* ---- 12. End-to-end over the bundled fixtures (the demo's real path) ---- */
section('end-to-end — fixtures through scheduler + monitor');
// Replay the OUTAGE script on a 60s grid with confirm=2, exactly like the UI.
function runScript(script, { intervalMs = MIN, confirmations = 2, rules = {}, startAt = 0 } = {}) {
  const probe = fx.scriptedProbe(script);
  const monitor = new core.Monitor({ confirmations });
  const schedule = core.createSchedule({ startAt, intervalMs });
  let now = startAt;
  for (let i = 0; i < script.length; i++) {
    const poll = schedule.poll(now);
    for (const tickAt of poll.fire) monitor.push(tickAt, core.classify(probe(), rules));
    now += intervalMs;
  }
  return monitor;
}
m = runScript(fx.OUTAGE, { intervalMs: MIN, confirmations: 2 });
s = m.summary();
eq(s.current, 'up', 'OUTAGE script ends recovered (up)');
eq(s.outages, 1, 'the 5-check 503 run is exactly one confirmed outage');
ok(s.checksDown >= 4, 'several individual down checks recorded');
ok(s.uptimePct > 50 && s.uptimePct < 100, 'uptime between 50 and 100% after one mid-run outage');

// FLAPPY: lone blips with confirm=2 must yield ZERO outages and 100% uptime.
m = runScript(fx.FLAPPY, { intervalMs: MIN, confirmations: 2 });
s = m.summary();
eq(s.outages, 0, 'lone blips never become outages at confirm=2');
eq(s.current, 'up', 'flappy site stays confirmed-up');
ok(s.checksDown >= 2, 'the blips were still recorded as individual down checks');

// AUTHED: 403 throughout reads as up (reachable) the whole time.
m = runScript(fx.AUTHED, { intervalMs: MIN, confirmations: 1 });
s = m.summary();
eq(s.current, 'up', 'auth-walled site is up (reachable)');
eq(s.outages, 0, 'no outages for a 403 site');
near(s.uptimePct, 100, 0.001, 'auth-walled uptime is 100%');

// DEAD: ENOTFOUND throughout is down the whole time, 0% uptime, one open outage.
m = runScript(fx.DEAD, { intervalMs: MIN, confirmations: 1 });
s = m.summary();
eq(s.current, 'down', 'dead host confirmed down');
near(s.uptimePct, 0, 0.001, 'dead host uptime 0%');
eq(s.outages, 1, 'one continuous outage');
ok(s.incidents[0].ongoing, 'the outage is ongoing at the end');

// SOLID: never a down check, 100% uptime, zero transitions after the first.
m = runScript(fx.SOLID, { intervalMs: MIN, confirmations: 2 });
s = m.summary();
eq(s.outages, 0, 'solid site has no outages');
near(s.uptimePct, 100, 0.001, 'solid site is 100% up');
eq(s.transitionCount, 1, 'only the initial up transition');

/* ---- summary ---- */
console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
