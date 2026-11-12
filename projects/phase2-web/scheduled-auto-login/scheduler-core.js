'use strict';
/*
 * scheduler-core.js — the whole engine for "Scheduled Auto Login and Action",
 * with no I/O at all.
 *
 * Nothing in this file opens a socket, reads the real clock, logs in anywhere,
 * or calls Math.random. Every function is either pure or takes its clock and its
 * randomness as arguments. That is deliberate: the *interesting* parts of a
 * "log in on a schedule and do something" program are not the HTTP calls — they
 * are the three things everybody gets wrong, and all three are pure logic you
 * can pin down with a test:
 *
 *   1. WHEN does the next run happen?  "Every day at 09:00" is not "now + 24h".
 *      Adding a fixed 24 hours drifts and breaks across a clock change; the
 *      answer is the next wall-clock occurrence of 09:00, recomputed each time.
 *   2. WHAT happens when the site says no?  A login or an action fails, a session
 *      silently expires. The resilient answer is a session state machine plus
 *      exponential backoff with jitter and a give-up limit — not a tight retry
 *      loop that hammers the site.
 *   3. WHAT about the runs you MISSED while the scheduler was down?  Run them all?
 *      Run one catch-up? Skip to the next? That is a policy decision, and the
 *      wrong default quietly does the wrong thing.
 *
 * A note on scope and responsibility. The "site" this engine drives is a *mock*
 * (see makeMockSite / makeScriptedSite): there is no real third party here. For
 * a real service the right client is its official API with a token you are
 * entitled to use, used within its terms of service and rate limits. Credentials
 * must come from the environment or a secret manager, never from source or argv,
 * and must never reach a log — redactSecrets() exists for exactly that. This file
 * is the scheduling-and-resilience half of the problem; it is not, and must not
 * be turned into, a tool for logging in where you are not authorized to.
 *
 * Runs identically in Node and the browser (UMD footer at the bottom).
 */

// ===========================================================================
// 0. Small time helpers. We work entirely in epoch milliseconds, and model a
//    time zone as a FIXED offset in minutes (e.g. -300 for US Eastern Standard).
// ===========================================================================
// Why a fixed offset instead of a real time zone? Because a real zone brings
// daylight-saving transitions, which need the IANA tz database — out of scope
// for a dependency-free core. Working in a fixed offset keeps "daily at 09:00"
// exact and testable. The DST caveat is real and called out in the README: with
// a true zone, the day a clock springs forward is 23 hours long, so "+24h" would
// fire at 08:00 or 10:00. Recomputing the next wall-clock 09:00 (what we do) is
// the shape of the correct fix; only the offset lookup would change.

const MS = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };

// Break an epoch-ms instant into wall-clock parts *in the given fixed offset*.
function wallParts(ms, tzOffsetMinutes = 0) {
  const shifted = ms + tzOffsetMinutes * MS.minute; // shift so UTC getters read local
  const d = new Date(shifted);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),       // 0-11
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),       // 0 = Sunday
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  };
}

// Inverse of wallParts: a wall-clock date/time in a fixed offset -> epoch ms.
function wallToMs({ year, month, day, hour = 0, minute = 0, second = 0, ms = 0 }, tzOffsetMinutes = 0) {
  const utc = Date.UTC(year, month, day, hour, minute, second, ms);
  return utc - tzOffsetMinutes * MS.minute;
}

// Minutes since local midnight for an instant — handy for "is it past 09:00 yet".
function minutesIntoDay(ms, tzOffsetMinutes = 0) {
  const p = wallParts(ms, tzOffsetMinutes);
  return p.hour * 60 + p.minute;
}

// ===========================================================================
// 1. Schedules and the next-fire computation — the heart of "when".
// ===========================================================================
// A schedule is a small plain object. Supported kinds:
//   { kind: 'interval', everyMs, anchorMs? }   fire every N ms from an anchor
//   { kind: 'dailyAt',  hour, minute }         fire at HH:MM local, every day
//   { kind: 'weeklyAt', weekday, hour, minute} fire at HH:MM local on one weekday
// nextRun returns the first fire STRICTLY AFTER `fromMs` (so calling it with the
// time of a run that just happened gives you the *following* run, never the same
// one again — the classic off-by-one that double-fires schedulers).

function validateSchedule(s) {
  if (!s || typeof s !== 'object') throw new Error('schedule must be an object');
  switch (s.kind) {
    case 'interval':
      if (!(Number.isFinite(s.everyMs) && s.everyMs > 0)) {
        throw new Error('interval schedule needs a positive everyMs');
      }
      return s;
    case 'dailyAt':
    case 'weeklyAt':
      if (!(Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23)) {
        throw new Error(`${s.kind} schedule needs hour 0-23`);
      }
      if (!(Number.isInteger(s.minute) && s.minute >= 0 && s.minute <= 59)) {
        throw new Error(`${s.kind} schedule needs minute 0-59`);
      }
      if (s.kind === 'weeklyAt' && !(Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6)) {
        throw new Error('weeklyAt schedule needs weekday 0-6 (0 = Sunday)');
      }
      return s;
    default:
      throw new Error(`unknown schedule kind: ${s && s.kind}`);
  }
}

function nextRun(schedule, fromMs, tzOffsetMinutes = 0) {
  validateSchedule(schedule);

  if (schedule.kind === 'interval') {
    const { everyMs } = schedule;
    const anchor = Number.isFinite(schedule.anchorMs) ? schedule.anchorMs : 0;
    // The next multiple of everyMs after fromMs, measured from the anchor. This
    // is what makes an interval schedule *deterministic*: restart the process
    // and it lands on the same grid of fire times, instead of drifting by
    // however long the restart took.
    const elapsed = fromMs - anchor;
    const k = Math.floor(elapsed / everyMs) + 1; // strictly after fromMs
    return anchor + k * everyMs;
  }

  // dailyAt / weeklyAt: find today's wall-clock target, step forward if it has
  // already passed. We never add a flat 24h — we rebuild the wall-clock time on
  // the next candidate day, which is what stays correct across a clock change.
  const p = wallParts(fromMs, tzOffsetMinutes);
  for (let addDays = 0; addDays < 8; addDays++) {
    const candidate = wallToMs({
      year: p.year, month: p.month, day: p.day + addDays,
      hour: schedule.hour, minute: schedule.minute, second: 0, ms: 0,
    }, tzOffsetMinutes);
    if (candidate <= fromMs) continue;           // today's time already gone
    if (schedule.kind === 'weeklyAt') {
      const wd = wallParts(candidate, tzOffsetMinutes).weekday;
      if (wd !== schedule.weekday) continue;     // not the right day of week
    }
    return candidate;
  }
  // weeklyAt is guaranteed to hit within 7 days; the loop bound of 8 is slack.
  throw new Error('nextRun: could not find a next fire (should be unreachable)');
}

// All fire times of a schedule within [fromMs, toMs]. Bounded so a tiny interval
// over a huge window cannot loop forever.
function fireTimesBetween(schedule, fromMs, toMs, tzOffsetMinutes = 0, cap = 100000) {
  const out = [];
  let t = fromMs - 1; // so a fire exactly at fromMs is included
  while (out.length < cap) {
    t = nextRun(schedule, t, tzOffsetMinutes);
    if (t > toMs) break;
    out.push(t);
  }
  return out;
}

// ===========================================================================
// 2. Missed-run policy — what to do about fires that happened while we were down.
// ===========================================================================
// If the scheduler process was off from downFromMs to downToMs, several fires may
// have been skipped. There is no universally-right answer, so this returns the
// decision explicitly rather than burying a default:
//   'skip'    : ignore the gap, just run the next future fire. (Safe default for
//               actions that are only useful "now" — a presence check-in.)
//   'one'     : run a single catch-up immediately, then resume. (For "has it been
//               done today" actions where one is enough.)
//   'all'     : run every missed fire. (For actions that must not be dropped —
//               but beware: a day of downtime on a 5-minute schedule is 288 runs
//               fired in a burst, which can look like an attack to the far end.)
function missedRunPolicy(schedule, downFromMs, downToMs, policy, tzOffsetMinutes = 0) {
  const missed = fireTimesBetween(schedule, downFromMs, downToMs, tzOffsetMinutes);
  const next = nextRun(schedule, downToMs, tzOffsetMinutes);
  switch (policy) {
    case 'skip': return { runNow: [], next, missedCount: missed.length };
    case 'one':  return { runNow: missed.length ? [missed[missed.length - 1]] : [], next, missedCount: missed.length };
    case 'all':  return { runNow: missed, next, missedCount: missed.length };
    default: throw new Error(`unknown missed-run policy: ${policy}`);
  }
}

// ===========================================================================
// 3. Exponential backoff with jitter — the heart of "when the site says no".
// ===========================================================================
// A failed login retried immediately, in a tight loop, is how you get your IP
// blocked and how a thundering herd of clients synchronises into a spike. The
// standard fix is exponential backoff (wait longer after each failure, capped)
// plus JITTER (randomise the wait so many clients don't retry in lockstep).
//
// attempt is 1-based: attempt 1 is the first RETRY (after the first failure).
// rng is injected (a function returning [0,1)) so the jitter is testable; pass a
// fixed rng in tests, Math.random in production.
function backoffDelay(attempt, opts = {}, rng = Math.random) {
  const baseMs = opts.baseMs != null ? opts.baseMs : 1000;
  const factor = opts.factor != null ? opts.factor : 2;
  const maxMs = opts.maxMs != null ? opts.maxMs : 60000;
  const jitter = opts.jitter != null ? opts.jitter : 'full';
  if (!(attempt >= 1)) throw new Error('backoffDelay: attempt must be >= 1');

  // Uncapped ideal delay, then cap. Math.pow with factor^(attempt-1): attempt 1
  // gives base, attempt 2 gives base*factor, and so on.
  const raw = Math.min(maxMs, baseMs * Math.pow(factor, attempt - 1));

  switch (jitter) {
    case 'none':
      return raw;
    case 'full':
      // AWS "full jitter": sleep a random amount in [0, raw]. Spreads retries
      // the most; the expected wait is raw/2.
      return rng() * raw;
    case 'equal':
      // "Equal jitter": half fixed + half random, in [raw/2, raw]. Keeps some
      // guaranteed minimum spacing while still de-synchronising clients.
      return raw / 2 + rng() * (raw / 2);
    default:
      throw new Error(`unknown jitter mode: ${jitter}`);
  }
}

// ===========================================================================
// 4. The session state machine — logging in is not a one-time event.
// ===========================================================================
// A session has a lifetime. You log in, you get a session good until some
// expiry, and the next action only works if the session is still valid —
// otherwise you must re-authenticate first. The bug people ship is assuming
// "I logged in at startup" means "I am logged in now," hours later. A session is
// just { loggedInAtMs, ttlMs }; validity is a function of the current time.

function newSession() {
  return { loggedInAtMs: null, ttlMs: null };
}
function login(session, nowMs, ttlMs) {
  return { loggedInAtMs: nowMs, ttlMs };
}
function sessionActive(session, nowMs) {
  if (!session || session.loggedInAtMs == null) return false;
  return nowMs < session.loggedInAtMs + session.ttlMs;
}
function sessionStatus(session, nowMs) {
  if (!session || session.loggedInAtMs == null) return 'logged-out';
  return nowMs < session.loggedInAtMs + session.ttlMs ? 'active' : 'expired';
}
// Given a session and "is it time to act", say what the engine should do next.
// This is the small decision that ties the session to the schedule.
function decideAction(session, nowMs, isDue) {
  if (!isDue) return 'wait';
  return sessionActive(session, nowMs) ? 'act' : 'login';
}

// ===========================================================================
// 5. Credential redaction — the part that keeps secrets out of your logs.
// ===========================================================================
// Everything above eventually gets logged. A scheduler that prints its config
// for debugging will cheerfully print the password too, and now it is in a log
// file, a terminal scrollback, a CI artifact. redactSecrets walks an object and
// masks anything whose KEY looks secret (by name) so logging the whole config is
// safe by default rather than by remembering.
const SECRET_KEY = /pass(word|wd|phrase)?|secret|token|api[-_]?key|auth|credential|cookie|session[-_]?id|private[-_]?key/i;

function maskValue(v) {
  if (typeof v !== 'string') return '***';
  if (v.length <= 4) return '***';
  // Show just enough to recognise which secret it is, never enough to use it.
  return v.slice(0, 2) + '***' + v.slice(-2);
}

function redactSecrets(obj, seen = new Set()) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);
  if (Array.isArray(obj)) return obj.map((x) => redactSecrets(x, seen));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k)) out[k] = maskValue(v);
    else if (v && typeof v === 'object') out[k] = redactSecrets(v, seen);
    else out[k] = v;
  }
  return out;
}

// ===========================================================================
// 6. A MOCK site to drive — so the whole machine is demonstrable with no network.
// ===========================================================================
// A "site" here is just an object with login(creds) and action() that return an
// outcome. Two flavours:
//   makeScriptedSite([...outcomes]) — plays a fixed list of outcomes, so a test
//       can assert "fail, fail, then succeed" drives exactly two backoffs.
//   makeMockSite({...}) — a probabilistic flaky site driven by an injected rng,
//       for the CLI/browser "watch it cope" demo.
// An outcome is one of: 'ok', 'fail' (transient error), 'expired' (the server
// says your session is gone — re-auth needed), 'reject' (credentials refused —
// retrying will never help, so the engine must give up, not back off forever).
function makeScriptedSite(loginOutcomes = [], actionOutcomes = []) {
  let li = 0, ai = 0;
  return {
    kind: 'scripted',
    login() { return loginOutcomes[li++] || 'ok'; },
    action() { return actionOutcomes[ai++] || 'ok'; },
  };
}
function makeMockSite(opts = {}, rng = Math.random) {
  const pLoginFail = opts.pLoginFail != null ? opts.pLoginFail : 0.2;
  const pActionFail = opts.pActionFail != null ? opts.pActionFail : 0.15;
  const pExpire = opts.pExpire != null ? opts.pExpire : 0.1;
  return {
    kind: 'mock',
    login() { return rng() < pLoginFail ? 'fail' : 'ok'; },
    action() {
      const r = rng();
      if (r < pExpire) return 'expired';
      if (r < pExpire + pActionFail) return 'fail';
      return 'ok';
    },
  };
}

// ===========================================================================
// 7. The virtual-clock simulator — runs the whole engine deterministically.
// ===========================================================================
// This is the centrepiece: given a schedule, a site, a session TTL, backoff
// settings and a window of time, it steps from fire to fire WITHOUT a real clock
// and returns an event log. The Node CLI's --demo, the browser demo and the
// tests all run this exact function, so what you watch in the browser is the
// same code the tests pin down. Injected rng keeps it reproducible.
//
// At each scheduled fire it: ensures a valid session (logging in first if need
// be), performs the action, and on any failure retries with backoff up to
// maxAttempts — giving up on a hard 'reject', re-authenticating on 'expired'.
function simulate(config) {
  const {
    schedule,
    tzOffsetMinutes = 0,
    startMs,
    endMs,
    sessionTtlMs = 30 * MS.minute,
    site,
    backoff = { baseMs: 1000, factor: 2, maxMs: 60000, jitter: 'full' },
    maxAttempts = 5,
    rng = Math.random,
  } = config;
  if (!site) throw new Error('simulate: a site (makeMockSite/makeScriptedSite) is required');

  const log = [];
  const emit = (timeMs, type, detail) => log.push({ timeMs, type, detail: detail || {} });
  let session = newSession();
  const stats = { fires: 0, actionsOk: 0, logins: 0, failures: 0, reauths: 0, givenUp: 0 };

  let fire = nextRun(schedule, startMs - 1, tzOffsetMinutes); // include a fire at startMs
  while (fire <= endMs) {
    stats.fires++;
    emit(fire, 'fire', { status: sessionStatus(session, fire) });

    // Handle this one fire: possibly log in, then act, with backoff retries. We
    // advance a LOCAL cursor within the fire so retries have their own timestamps
    // without disturbing the schedule grid.
    let cursor = fire;
    let attempt = 0;        // counts retries for backoff
    let done = false;
    let gaveUp = false;

    while (!done) {
      // Step A: make sure we have a live session.
      if (!sessionActive(session, cursor)) {
        const out = site.login();
        stats.logins++;
        if (out === 'reject') {
          emit(cursor, 'login-rejected', { attempt });
          stats.givenUp++; gaveUp = true; break; // bad credentials: never retry
        }
        if (out === 'fail') {
          attempt++;
          stats.failures++;
          if (attempt >= maxAttempts) { emit(cursor, 'give-up', { stage: 'login', attempt }); stats.givenUp++; gaveUp = true; break; }
          const wait = backoffDelay(attempt, backoff, rng);
          emit(cursor, 'login-failed', { attempt, backoffMs: Math.round(wait) });
          cursor += wait;
          continue;
        }
        session = login(session, cursor, sessionTtlMs);
        emit(cursor, 'login-ok', { expiresAtMs: session.loggedInAtMs + session.ttlMs });
      }

      // Step B: perform the action.
      const out = site.action();
      if (out === 'ok') {
        emit(cursor, 'action-ok', {});
        stats.actionsOk++; done = true; break;
      }
      if (out === 'expired') {
        // Server says our session died mid-use. Drop it and loop: step A will
        // re-authenticate. This is NOT a backoff case — it is expected lifecycle.
        emit(cursor, 'session-expired', {});
        session = newSession();
        stats.reauths++;
        continue;
      }
      // transient 'fail' (or anything else): back off and retry the action.
      attempt++;
      stats.failures++;
      if (attempt >= maxAttempts) { emit(cursor, 'give-up', { stage: 'action', attempt }); stats.givenUp++; gaveUp = true; break; }
      const wait = backoffDelay(attempt, backoff, rng);
      emit(cursor, 'action-failed', { attempt, backoffMs: Math.round(wait) });
      cursor += wait;
    }

    void gaveUp;
    fire = nextRun(schedule, fire, tzOffsetMinutes);
  }

  return { log, stats };
}

// A compact one-line formatter for a log event, shared by the CLI and browser.
function formatEvent(ev, tzOffsetMinutes = 0) {
  const p = wallParts(ev.timeMs, tzOffsetMinutes);
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  const ss = String(p.second).padStart(2, '0');
  const stamp = `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${hh}:${mm}:${ss}`;
  const d = ev.detail || {};
  let msg = ev.type;
  if (d.backoffMs != null) msg += ` (attempt ${d.attempt}, back off ${Math.round(d.backoffMs)}ms)`;
  else if (d.attempt != null) msg += ` (attempt ${d.attempt})`;
  else if (d.status) msg += ` [session ${d.status}]`;
  else if (d.stage) msg += ` at ${d.stage}`;
  return `${stamp}  ${msg}`;
}

const api = {
  MS,
  wallParts, wallToMs, minutesIntoDay,
  validateSchedule, nextRun, fireTimesBetween,
  missedRunPolicy,
  backoffDelay,
  newSession, login, sessionActive, sessionStatus, decideAction,
  SECRET_KEY, maskValue, redactSecrets,
  makeScriptedSite, makeMockSite,
  simulate, formatEvent,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.SchedulerCore = api;
}
