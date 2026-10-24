#!/usr/bin/env node
/*
 * checker-node.js — binds the engine to real HTTP/HTTPS requests and a real
 * clock, so the browser's scripted demo and this become the same program with a
 * different probe.
 *
 * The probe here does one HEAD request (falling back to GET if the server won't
 * HEAD) and times it; the referral-free scheduling, confirmation and uptime math
 * are all checker-core. Ticks are drift-anchored to the first check, and a long
 * pause between polls skips the stale backlog instead of stampeding the target.
 *
 * Usage:
 *   node checker-node.js https://example.com                 # watch, default 30s
 *   node checker-node.js example.com --interval 10 --count 5 # 5 checks, 10s apart
 *   node checker-node.js a.com b.com --interval 15           # watch several
 *   node checker-node.js example.com --once --json           # one check, JSON
 *   node checker-node.js example.com --confirm 2             # 2 fails = down
 *   node checker-node.js example.com --timeout 5000 --slow 2000
 */
'use strict';

const http = require('http');
const https = require('https');
const core = require('./checker-core');

// One real probe: HEAD (then GET on 405/501) with a timeout. Resolves to the
// {ok,status,ms,error} shape classify() expects — it never rejects.
function httpProbe(target, timeoutMs) {
  return (urlStr) => new Promise((resolve) => {
    const t = core.normalizeTarget(urlStr);
    const lib = t.protocol === 'https' ? https : http;
    const started = Date.now();
    let settled = false;
    const finish = (res) => { if (!settled) { settled = true; resolve(res); } };

    const run = (method, allowGetFallback) => {
      const req = lib.request(t.url, { method, headers: { 'user-agent': 'site-checker/1.0' } }, (res) => {
        const status = res.statusCode;
        res.resume(); // drain so the socket can be freed
        if (allowGetFallback && (status === 405 || status === 501)) {
          res.on('end', () => run('GET', false));
          return;
        }
        finish({ ok: status < 400, status, ms: Date.now() - started });
      });
      req.setTimeout(timeoutMs, () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)); });
      req.on('error', (e) => finish({ error: e.message, ms: Date.now() - started }));
      req.end();
    };
    run('HEAD', true);
  });
}

function parseArgs(argv) {
  const o = { interval: 30, count: Infinity, once: false, json: false, confirm: 1,
    timeout: 10000, slow: Infinity, maxCatchUp: 1, targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--interval' || a === '-i') o.interval = parseFloat(argv[++i]);
    else if (a === '--count' || a === '-n') o.count = parseInt(argv[++i], 10);
    else if (a === '--once') { o.once = true; o.count = 1; }
    else if (a === '--json') o.json = true;
    else if (a === '--confirm' || a === '-c') o.confirm = parseInt(argv[++i], 10);
    else if (a === '--timeout') o.timeout = parseInt(argv[++i], 10);
    else if (a === '--slow') o.slow = parseInt(argv[++i], 10);
    else if (a === '--catchup') o.maxCatchUp = parseInt(argv[++i], 10);
    else if (a === '-h' || a === '--help') o.help = true;
    else o.targets.push(a);
  }
  return o;
}

const HELP = `Site Checker with Time Scheduling

Usage: node checker-node.js <url…> [options]
  -i, --interval <sec>   seconds between checks        (default 30)
  -n, --count <n>        stop after n checks            (default: forever)
      --once             one check and exit            (= --count 1)
  -c, --confirm <n>      consecutive agreeing checks to confirm a flip (default 1)
      --timeout <ms>     per-request timeout            (default 10000)
      --slow <ms>        answers slower than this are "degraded" (down)
      --catchup <n>      max checks to fire after a sleep gap (default 1)
      --json             machine-readable output
  -h, --help             this help`;

function stamp(ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 19); }

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.targets.length) { console.log(HELP); if (!o.targets.length && !o.help) process.exitCode = 1; return; }
  if (!(o.interval > 0)) { console.error('--interval must be > 0 seconds'); process.exitCode = 1; return; }

  const intervalMs = Math.round(o.interval * 1000);
  const probe = httpProbe(null, o.timeout);
  const rules = { slowMs: o.slow };

  // One monitor + one schedule per target.
  const watches = o.targets.map((input) => {
    let target;
    try { target = core.normalizeTarget(input); }
    catch (e) { return { input, error: e.message }; }
    return {
      input, target,
      monitor: new core.Monitor({ confirmations: o.confirm }),
      schedule: core.createSchedule({ startAt: Date.now(), intervalMs, maxCatchUp: o.maxCatchUp }),
    };
  });

  let remaining = o.count;
  async function checkOne(w, now) {
    const raw = await probe(w.target.url);
    const cls = core.classify(raw, rules);
    const res = w.monitor.push(now, cls);
    if (o.json) {
      const s = w.monitor.summary(now);
      console.log(JSON.stringify({
        target: w.target.url, at: new Date(now).toISOString(),
        state: cls.state, reason: cls.reason, status: cls.status, ms: cls.ms,
        confirmed: res.confirmedState, changed: res.changed,
        uptimePct: s.uptimePct, outages: s.outages,
      }));
    } else {
      const icon = cls.state === 'up' ? '🟢' : '🔴';
      const s = w.monitor.summary(now);
      const up = s.uptimePct == null ? '—' : `${s.uptimePct}%`;
      const change = res.changed ? `  ⟵ ${res.from.toUpperCase()}→${res.to.toUpperCase()}` : '';
      const tgt = o.targets.length > 1 ? `  ${w.target.host}` : '';
      console.log(`${stamp(now)} ${icon} ${cls.state.toUpperCase().padEnd(4)} ${String(cls.reason).padEnd(26)} ${String(cls.ms == null ? '' : cls.ms + 'ms').padStart(7)}  up:${up}${tgt}${change}`);
    }
  }

  // The scheduling loop: sleep until the nearest next tick across all watches,
  // then poll each schedule (which decides what's actually due, with catch-up).
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  if (!o.json) console.log(`Watching ${o.targets.length} target(s) every ${o.interval}s (confirm=${o.confirm}). Ctrl-C to stop.\n`);

  let done = false;
  process.on('SIGINT', () => { done = true; });

  // Fire an immediate first check (tick 0 is due at startAt == now).
  while (!done && remaining > 0) {
    const now = Date.now();
    let fired = false;
    for (const w of watches) {
      if (w.error) continue;
      const poll = w.schedule.poll(now);
      if (!poll.due) continue;
      if (poll.skipped && !o.json) console.log(`  … skipped ${poll.skipped} overdue check(s) on ${w.target.host} after a gap`);
      // Fire once per due tick (catch-up already capped the list).
      for (let k = 0; k < poll.fire.length; k++) { await checkOne(w, poll.fire[k]); fired = true; }
    }
    if (fired) remaining -= 1;
    if (remaining <= 0 || done) break;
    // Sleep until the soonest next tick among the still-active watches.
    const next = Math.min(...watches.filter((w) => !w.error).map((w) => w.schedule.msUntilNext(Date.now())));
    await sleep(Math.max(50, Number.isFinite(next) ? next : intervalMs));
  }

  // Final per-target rollup for the human view.
  if (!o.json) {
    for (const w of watches) {
      if (w.error) { console.log(`\n${w.input}: error — ${w.error}`); continue; }
      const s = w.monitor.summary();
      console.log(`\n=== ${w.target.url} ===`);
      console.log(`  checks        : ${s.checks} (${s.checksUp} up / ${s.checksDown} down)`);
      console.log(`  current       : ${s.current.toUpperCase()} since ${stamp(s.currentSince)}`);
      console.log(`  uptime        : ${s.uptimePct == null ? '—' : s.uptimePct + '%'} over ${core.humanDuration(s.measuredMs)} measured`);
      console.log(`  outages       : ${s.outages}${s.outages ? ` (longest ${core.humanDuration(s.longestOutageMs)})` : ''}`);
      for (const inc of s.incidents) {
        console.log(`    - ${stamp(inc.from)} → ${inc.ongoing ? 'ongoing' : stamp(inc.to)}  (${core.humanDuration(inc.ms)})`);
      }
    }
  }
}

if (require.main === module) main();
module.exports = { httpProbe };
