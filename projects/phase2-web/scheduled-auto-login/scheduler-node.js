#!/usr/bin/env node
'use strict';
/*
 * scheduler-node.js — the real I/O layer for "Scheduled Auto Login and Action".
 *
 * All the timing, backoff, session and redaction logic lives in scheduler-core.js
 * and is exercised offline. This file adds only the things a core must not have:
 * the real clock (setTimeout), real randomness (Math.random for jitter), reading
 * credentials from the ENVIRONMENT, and the actual run loop.
 *
 * It drives a MOCK site, on purpose. There is no real third party here, and that
 * is the point: this demonstrates the scheduling-and-resilience machinery without
 * logging in anywhere. To point it at a real service, replace the mock `site`
 * below with a thin wrapper over that service's OFFICIAL API, used with a token
 * you are entitled to use and within its terms of service and rate limits. Keep
 * credentials in the environment or a secret manager — never in source or argv —
 * and never print them: this file runs every config through redactSecrets first.
 *
 *   node scheduler-node.js --demo                 # offline: a simulated day, instant
 *   node scheduler-node.js --live --every 5s      # a real loop, fires every 5s (Ctrl-C to stop)
 *   node scheduler-node.js --live --daily 09:00   # a real loop, fires at 09:00 local
 *   node scheduler-node.js --next --daily 09:00   # just print the next few fire times
 *   node scheduler-node.js --config               # show how credentials are read + redacted
 */
const C = require('./scheduler-core.js');

// ---- tiny argv parser (no dependencies) -----------------------------------
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') o.demo = true;
    else if (a === '--live') o.live = true;
    else if (a === '--next') o.next = true;
    else if (a === '--config') o.config = true;
    else if (a === '--every') o.every = argv[++i];
    else if (a === '--daily') o.daily = argv[++i];
    else if (a === '--weekly') o.weekly = argv[++i];       // e.g. Mon@09:00
    else if (a === '--ttl') o.ttl = argv[++i];
    else if (a === '--count') o.count = Number(argv[++i]);
    else if (a === '--flaky') o.flaky = Number(argv[++i]); // 0..1 failure probability
    else if (a === '-h' || a === '--help') o.help = true;
    else o._.push(a);
  }
  return o;
}

const HELP = `Scheduled Auto Login and Action — a scheduling + resilient-session engine

  node scheduler-node.js --demo                  offline simulated day (no network, instant)
  node scheduler-node.js --next   [schedule]     print the next ${'{--count}'} fire times and exit
  node scheduler-node.js --live   [schedule]     run a real loop against a MOCK site (Ctrl-C to stop)
  node scheduler-node.js --config                show credential sourcing + redaction

Schedule (pick one):
  --every <dur>      interval, e.g. 30s, 5m, 2h            (default 5s in --live)
  --daily <HH:MM>    every day at that local wall-clock time
  --weekly <Dow@HH:MM>  e.g. Mon@09:00

Options:
  --ttl <dur>        session lifetime before re-auth is needed (default 30m)
  --count <n>        how many fire times --next prints (default 6)
  --flaky <p>        mock site failure probability 0..1 in --live (default 0.25)

Credentials are read from the environment, never argv:
  SAL_URL, SAL_USERNAME, SAL_PASSWORD   (the mock only checks they are present)

This drives a MOCK site. For a real service, wrap its official API instead and
respect its terms of service and rate limits.`;

// ---- duration parsing: "30s" / "5m" / "2h" / "500ms" ----------------------
function parseDuration(str, dflt) {
  if (str == null) return dflt;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(String(str).trim());
  if (!m) throw new Error(`cannot parse duration: ${str}`);
  const n = Number(m[1]);
  const unit = m[2] || 'ms';
  const mult = { ms: 1, s: C.MS.second, m: C.MS.minute, h: C.MS.hour, d: C.MS.day }[unit];
  return n * mult;
}

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Build a schedule object from the CLI flags, with --every 5s as the default.
function scheduleFromArgs(o) {
  if (o.daily) {
    const [h, mn] = o.daily.split(':').map(Number);
    return { kind: 'dailyAt', hour: h, minute: mn };
  }
  if (o.weekly) {
    const m = /^([A-Za-z]{3})@(\d{1,2}):(\d{2})$/.exec(o.weekly);
    if (!m) throw new Error('weekly must look like Mon@09:00');
    const wd = DOW[m[1].toLowerCase()];
    if (wd == null) throw new Error(`unknown weekday: ${m[1]}`);
    return { kind: 'weeklyAt', weekday: wd, hour: Number(m[2]), minute: Number(m[3]) };
  }
  const everyMs = parseDuration(o.every, 5 * C.MS.second);
  return { kind: 'interval', everyMs, anchorMs: 0 };
}

// The local machine's current UTC offset in minutes, so "daily 09:00" means 09:00
// where this machine is. (getTimezoneOffset is minutes behind UTC, with the
// opposite sign to our convention, hence the negation.)
const localOffset = () => -new Date().getTimezoneOffset();

// ---- credentials: from the environment, never argv, never logged -----------
function readCredentials() {
  return {
    url: process.env.SAL_URL || 'https://example.test/login',
    username: process.env.SAL_USERNAME || '(unset)',
    password: process.env.SAL_PASSWORD || '',
  };
}

// ---- subcommands -----------------------------------------------------------
function cmdConfig() {
  const creds = readCredentials();
  console.log('\nCredentials are read from the environment (SAL_URL / SAL_USERNAME / SAL_PASSWORD).');
  console.log('What the program would log about its own config — note the password is masked:\n');
  console.log(JSON.stringify(C.redactSecrets({
    site: creds,
    schedule: { kind: 'dailyAt', hour: 9, minute: 0 },
    sessionTtlMs: 30 * C.MS.minute,
    backoff: { baseMs: 1000, factor: 2, maxMs: 60000, jitter: 'full' },
  }), null, 2));
  if (!process.env.SAL_PASSWORD) {
    console.log('\n(SAL_PASSWORD is not set, so there is nothing real to mask — set it and re-run to see.)');
  }
  console.log('');
}

function cmdNext(o) {
  const schedule = scheduleFromArgs(o);
  const tz = localOffset();
  const now = Date.now();
  const count = o.count || 6;
  console.log(`\nSchedule: ${JSON.stringify(schedule)}  (local offset ${tz} min)`);
  console.log(`Next ${count} fire times after now:\n`);
  let t = now;
  for (let i = 0; i < count; i++) {
    t = C.nextRun(schedule, t, tz);
    console.log('  ' + new Date(t).toString());
  }
  console.log('');
}

function cmdDemo() {
  console.log('\n[--demo] A simulated day, offline, deterministic (seeded RNG, mock site).');
  console.log('Schedule: every 6 hours. The mock site is flaky, so watch the engine');
  console.log('back off on failures and re-authenticate when the session expires.\n');

  // A seeded, reproducible RNG (mulberry32) so --demo prints the same story each run.
  let seed = 0x9e3779b9;
  const rng = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const start = C.wallToMs({ year: 2026, month: 10, day: 12, hour: 0, minute: 0 }, 0);
  const end = start + C.MS.day - 1;
  const site = C.makeMockSite({ pLoginFail: 0.25, pActionFail: 0.2, pExpire: 0.15 }, rng);
  const { log, stats } = C.simulate({
    schedule: { kind: 'interval', everyMs: 6 * C.MS.hour, anchorMs: start },
    startMs: start, endMs: end,
    sessionTtlMs: 30 * C.MS.minute,
    site,
    backoff: { baseMs: 1000, factor: 2, maxMs: 60000, jitter: 'full' },
    maxAttempts: 5,
    rng,
  });
  for (const ev of log) console.log('  ' + C.formatEvent(ev, 0));
  console.log(`\n  summary: ${stats.fires} fires, ${stats.actionsOk} actions ok, ` +
    `${stats.logins} logins, ${stats.reauths} re-auths, ${stats.failures} failures, ` +
    `${stats.givenUp} given up`);
  console.log('');
}

// ---- the real loop: setTimeout-driven, against a mock site -----------------
async function cmdLive(o) {
  const schedule = scheduleFromArgs(o);
  const tz = localOffset();
  const ttlMs = parseDuration(o.ttl, 30 * C.MS.minute);
  const pFail = o.flaky != null ? o.flaky : 0.25;
  const backoff = { baseMs: 500, factor: 2, maxMs: 30 * C.MS.second, jitter: 'full' };
  const maxAttempts = 5;

  const creds = readCredentials();
  console.log('\n[--live] Real loop against a MOCK site (Ctrl-C to stop).');
  console.log('Config (secrets redacted):');
  console.log(JSON.stringify(C.redactSecrets({ site: creds, schedule, ttlMs, backoff }), null, 2));
  console.log('');

  const site = C.makeMockSite({ pLoginFail: pFail, pActionFail: pFail, pExpire: pFail / 2 });
  let session = C.newSession();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => Date.now();
  const stamp = () => new Date().toLocaleTimeString();

  // Run exactly one scheduled fire, with the same retry/backoff/re-auth policy
  // the core's simulate() uses — here against the wall clock.
  async function runOnce() {
    let attempt = 0;
    for (;;) {
      if (!C.sessionActive(session, now())) {
        const out = site.login();
        if (out === 'reject') { console.log(`  ${stamp()}  login rejected — bad credentials, giving up`); return; }
        if (out === 'fail') {
          attempt++;
          if (attempt >= maxAttempts) { console.log(`  ${stamp()}  giving up on login after ${attempt} attempts`); return; }
          const wait = C.backoffDelay(attempt, backoff);
          console.log(`  ${stamp()}  login failed (attempt ${attempt}) — backing off ${Math.round(wait)}ms`);
          await sleep(wait); continue;
        }
        session = C.login(session, now(), ttlMs);
        console.log(`  ${stamp()}  logged in (session good for ${Math.round(ttlMs / 1000)}s)`);
      }
      const out = site.action();
      if (out === 'ok') { console.log(`  ${stamp()}  action performed ✓`); return; }
      if (out === 'expired') { console.log(`  ${stamp()}  session expired mid-action — re-authenticating`); session = C.newSession(); continue; }
      attempt++;
      if (attempt >= maxAttempts) { console.log(`  ${stamp()}  giving up on action after ${attempt} attempts`); return; }
      const wait = C.backoffDelay(attempt, backoff);
      console.log(`  ${stamp()}  action failed (attempt ${attempt}) — backing off ${Math.round(wait)}ms`);
      await sleep(wait);
    }
  }

  // The scheduler: sleep until the next fire, run it, repeat. Recomputing the
  // next fire each loop (never "now + period") is what keeps a daily schedule
  // pinned to the wall clock instead of drifting by the run duration.
  for (;;) {
    const fireAt = C.nextRun(schedule, now(), tz);
    const waitMs = fireAt - now();
    console.log(`  ${stamp()}  next fire at ${new Date(fireAt).toLocaleTimeString()} (in ${Math.round(waitMs / 1000)}s)`);
    await sleep(Math.max(0, waitMs));
    await runOnce();
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  try {
    if (o.config) return cmdConfig();
    if (o.next) return cmdNext(o);
    if (o.live) return await cmdLive(o);
    if (o.demo) return cmdDemo();
    // Default with no subcommand: the offline demo, so the program always does
    // something safe and visible without touching the clock for minutes.
    console.log('(no subcommand given — showing --demo; see --help for --live / --next)');
    return cmdDemo();
  } catch (err) {
    console.error('\nError: ' + err.message);
    process.exit(1);
  }
}

main();
