/*
 * checker-fixtures.js — scripted probe sequences for the browser demo.
 *
 * A browser can't open raw sockets to arbitrary hosts and run a real multi-hour
 * uptime history in a few seconds, so the demo replays canned probe *scripts*:
 * each scenario is an ordered list of what the server "answered" on successive
 * checks. These are fed to the SAME engine (classify + Monitor + schedule) the
 * Node tool runs against live HTTP — only the probe source changes.
 *
 * Each entry in a script is {ok, status, ms, error} — exactly the shape a real
 * probe returns. `scriptedProbe(script)` returns a probe function that hands out
 * the next entry on each call and repeats the last one once the script is spent.
 */
'use strict';

// A reliable site: always 200, healthy latency with a little jitter.
const SOLID = Array.from({ length: 40 }, (_, i) => ({
  ok: true, status: 200, ms: 110 + ((i * 37) % 90),
}));

// A site that has a real outage in the middle: up, then a 5-check 503 outage,
// then recovers. With confirmation=2 this is one confirmed incident, not noise.
const OUTAGE = [
  { ok: true, status: 200, ms: 130 },
  { ok: true, status: 200, ms: 142 },
  { ok: true, status: 200, ms: 121 },
  { ok: true, status: 200, ms: 155 },
  { ok: false, status: 503, ms: 90 },   // outage begins here (dated to this tick)
  { ok: false, status: 503, ms: 88 },   // confirmed down on the 2nd failure
  { error: 'ETIMEDOUT' },
  { error: 'ECONNREFUSED' },
  { ok: false, status: 503, ms: 95 },
  { ok: true, status: 200, ms: 160 },   // recovery begins
  { ok: true, status: 200, ms: 138 },   // confirmed up again on the 2nd success
  { ok: true, status: 200, ms: 129 },
  { ok: true, status: 200, ms: 133 },
  { ok: true, status: 200, ms: 141 },
];

// A flapper: a single dropped check between healthy ones. Confirmation=2 means
// the blip is NEVER promoted to an outage — this is the whole point of debounce.
const FLAPPY = [
  { ok: true, status: 200, ms: 120 },
  { ok: true, status: 200, ms: 118 },
  { error: 'ECONNRESET' },             // one blip
  { ok: true, status: 200, ms: 125 },  // back before it could confirm down
  { ok: true, status: 200, ms: 119 },
  { error: 'ETIMEDOUT' },              // another lone blip
  { ok: true, status: 200, ms: 122 },
  { ok: true, status: 200, ms: 117 },
  { ok: true, status: 200, ms: 121 },
  { ok: true, status: 200, ms: 124 },
];

// A site behind auth: 403 throughout. treatAuthAsUp means "the server is up, it
// just won't let us in" counts as reachable.
const AUTHED = Array.from({ length: 20 }, () => ({ ok: false, status: 403, ms: 95 }));

// A site that is simply down the whole time (DNS failure).
const DEAD = Array.from({ length: 20 }, () => ({ error: 'ENOTFOUND' }));

const SCRIPTS = {
  'status.solid.example': { label: 'Rock-solid service', rules: {}, script: SOLID },
  'shop.example': { label: 'Shop with a real outage', rules: {}, script: OUTAGE },
  'flaky.example': { label: 'Flaky link (lone blips)', rules: {}, script: FLAPPY },
  'members.example': { label: 'Auth-walled (403 = up)', rules: {}, script: AUTHED },
  'gone.example': { label: 'Dead host (DNS fails)', rules: {}, script: DEAD },
};

function scriptedProbe(script) {
  let i = 0;
  const probe = function () {
    const entry = script[Math.min(i, script.length - 1)];
    i += 1;
    return Object.assign({}, entry);
  };
  probe.reset = () => { i = 0; };
  probe.remaining = () => Math.max(0, script.length - i);
  return probe;
}

const fixturesApi = { SCRIPTS, scriptedProbe, SOLID, OUTAGE, FLAPPY, AUTHED, DEAD };
if (typeof module !== 'undefined' && module.exports) module.exports = fixturesApi;
if (typeof window !== 'undefined') window.SiteCheckerFixtures = fixturesApi;
