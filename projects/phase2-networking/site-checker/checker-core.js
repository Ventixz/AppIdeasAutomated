/*
 * checker-core.js — the whole uptime-monitor engine, DOM-free and network-free.
 *
 * The task ("Site Checker with Time Scheduling") reads as one sentence — "ping a
 * site every N seconds and say whether it's up" — and, like most networking
 * tasks, the sentence hides the parts that are actually easy to get wrong. This
 * engine is built around three of them, and does none of them by eye:
 *
 *   1. SCHEDULING that doesn't drift and doesn't stampede. Ticks are anchored to
 *      a start time (tick k = start + k·interval), never "now + interval", so a
 *      slow check can't push every future check later. When the monitor was
 *      asleep (laptop lid, throttled background tab) and a dozen ticks are now
 *      overdue, it does NOT fire a dozen catch-up checks — it skips the stale
 *      ones and reports how many it dropped. (createSchedule / Schedule.)
 *
 *   2. CONFIRMATION, so one dropped packet isn't an "outage". A raw check is up
 *      or down; the *confirmed* state only flips after N consecutive agreeing
 *      checks (anti-flap / debounce), and the change is dated honestly to the
 *      FIRST of that run — the moment the site really changed — not to the check
 *      that happened to confirm it. (Monitor.push.)
 *
 *   3. UPTIME MATH that is time-weighted, not check-counted. "99% uptime" means
 *      99% of the *elapsed time* was up, so the engine builds a segment timeline
 *      from the confirmed transitions and weighs each segment by its duration,
 *      including the still-open final segment up to "as of now". Counting checks
 *      ("90 of 100 were up") quietly lies the moment checks aren't evenly spaced.
 *      (Monitor.summary.)
 *
 * The network is injected, exactly as in this folder's other tools: the engine
 * never opens a socket. A probe is any function url -> {ok,status,ms,error} (or a
 * promise of one); checker-node.js supplies a real HTTP/HTTPS probe, the browser
 * and tests supply scripted ones. Same scheduling, same confirmation, same math.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * 0. Target normalisation
 *    Accept what a person would paste ("example.com", "https://x.io/path")
 *    and produce a URL we can actually probe, without pretending a bare
 *    host is invalid.
 * ------------------------------------------------------------------ */

class CheckerError extends Error {
  constructor(msg) { super(msg); this.name = 'CheckerError'; }
}

// Turn user input into {url, protocol, host, port, display}. A bare host or
// host/path gets https:// prepended. We reject only genuinely unusable input.
function normalizeTarget(input) {
  if (input == null) throw new CheckerError('no target given');
  let s = String(input).trim();
  if (!s) throw new CheckerError('no target given');
  if (/\s/.test(s)) throw new CheckerError('target contains whitespace');

  // Prepend a scheme if the user gave none. "//host" and "host:port" both count
  // as scheme-less; a leading "ftp://" etc. we refuse — this is an HTTP checker.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');

  let u;
  try {
    u = typeof URL !== 'undefined' ? new URL(s) : require('url').parse(s);
  } catch (_) {
    throw new CheckerError(`not a valid URL: ${input}`);
  }
  const protocol = (u.protocol || '').replace(/:$/, '').toLowerCase();
  if (protocol !== 'http' && protocol !== 'https') {
    throw new CheckerError(`unsupported scheme "${protocol}" (only http/https)`);
  }
  const host = (u.hostname || '').toLowerCase();
  if (!host) throw new CheckerError('no host in target');

  const port = u.port ? parseInt(u.port, 10) : (protocol === 'https' ? 443 : 80);
  const path = (u.pathname || '/') + (u.search || '');
  const url = `${protocol}://${host}${u.port ? ':' + u.port : ''}${path === '/' ? '' : path}`;
  return { url: url || `${protocol}://${host}`, protocol, host, port, path };
}

/* ------------------------------------------------------------------ *
 * 1. Classifying ONE probe result into up / down
 *    A probe returns {ok, status, ms, error}. "Up" means the server answered
 *    with a status we accept (2xx/3xx by default) inside the latency budget.
 *    Everything else — 4xx/5xx, a transport error, or a too-slow answer — is
 *    down, with a human reason. This is pure: no network here.
 * ------------------------------------------------------------------ */

const DEFAULT_RULES = {
  // Which HTTP statuses count as "up". A redirect (3xx) still means the server
  // is alive and answering, so it's up by default; flip includeRedirects off to
  // require a 2xx. A 401/403 means the server is up but refusing us — that's a
  // reachability success for an uptime monitor, so treat auth-required as up.
  upMin: 200, upMax: 399,
  treatAuthAsUp: true,     // 401 & 403: server is up, just guarding the resource
  slowMs: Infinity,        // answers slower than this are "degraded" -> down
};

function classify(probe, rules) {
  const r = Object.assign({}, DEFAULT_RULES, rules || {});
  if (!probe || typeof probe !== 'object') {
    return { state: 'down', reason: 'no response', status: null, ms: null };
  }
  const status = probe.status == null ? null : probe.status;
  const ms = probe.ms == null ? null : probe.ms;

  // A transport-level failure (DNS, refused, reset, timeout) never produced a
  // status code — it's unambiguously down.
  if (probe.error) {
    return { state: 'down', reason: String(probe.error), status, ms };
  }
  if (status == null) {
    return { state: 'down', reason: probe.ok === false ? 'request failed' : 'no status', status: null, ms };
  }
  const authUp = r.treatAuthAsUp && (status === 401 || status === 403);
  const inRange = status >= r.upMin && status <= r.upMax;
  if (!inRange && !authUp) {
    return { state: 'down', reason: `HTTP ${status}`, status, ms };
  }
  if (ms != null && ms > r.slowMs) {
    return { state: 'down', reason: `too slow: ${ms}ms > ${r.slowMs}ms budget`, status, ms, degraded: true };
  }
  const reason = authUp ? `HTTP ${status} (up, auth required)` : `HTTP ${status}`;
  return { state: 'up', reason, status, ms };
}

/* ------------------------------------------------------------------ *
 * 2. The schedule — drift-free ticks with catch-up capping
 *    Ticks are start + k·interval, so they never slide. poll(now) reports which
 *    ticks are newly due; if the monitor was asleep and many are overdue, it
 *    fires at most `maxCatchUp` of them (the most recent) and tells you how many
 *    stale ticks it skipped, so a resumed tab doesn't stampede the target.
 * ------------------------------------------------------------------ */

function createSchedule(opts) {
  const o = opts || {};
  const intervalMs = o.intervalMs;
  if (!(intervalMs > 0)) throw new CheckerError('intervalMs must be > 0');
  const startAt = o.startAt == null ? 0 : o.startAt;
  const maxCatchUp = o.maxCatchUp == null ? 1 : o.maxCatchUp;
  if (maxCatchUp < 1) throw new CheckerError('maxCatchUp must be >= 1');

  // Index of the most recent tick at or before `now` (-1 before the first tick).
  function indexAt(now) {
    if (now < startAt) return -1;
    return Math.floor((now - startAt) / intervalMs);
  }
  const tickTime = (i) => startAt + i * intervalMs;

  let lastFired = -1; // highest tick index already handed out
  return {
    startAt, intervalMs, maxCatchUp,
    tickTime, indexAt,
    // When is the next not-yet-fired tick due? Always drift-anchored.
    nextDueAt() { return tickTime(lastFired + 1); },
    // How long to wait from `now` until the next tick (never negative).
    msUntilNext(now) { return Math.max(0, this.nextDueAt() - now); },
    // Advance to `now`, returning the tick times to actually check at.
    poll(now) {
      const latest = indexAt(now);
      if (latest <= lastFired) return { fire: [], skipped: 0, due: false };
      const firstNew = lastFired + 1;
      const totalNew = latest - lastFired;
      let fromIndex = firstNew;
      let skipped = 0;
      if (totalNew > maxCatchUp) {
        skipped = totalNew - maxCatchUp;   // drop the stale backlog
        fromIndex = latest - maxCatchUp + 1;
      }
      const fire = [];
      for (let i = fromIndex; i <= latest; i++) fire.push(tickTime(i));
      lastFired = latest;
      return { fire, skipped, due: true };
    },
    peekLastFired() { return lastFired; },
  };
}

/* ------------------------------------------------------------------ *
 * 3. The Monitor — confirmation + the time-weighted timeline
 *    Feed it classified checks (push). It keeps the confirmed-state timeline
 *    (anti-flap debounce) and can summarise uptime as of any instant.
 * ------------------------------------------------------------------ */

class Monitor {
  // confirmations: consecutive agreeing raw checks needed to flip the confirmed
  // state (1 = react instantly, no debounce). startAt: when monitoring began
  // (defaults to the first check's time).
  constructor(opts) {
    const o = opts || {};
    this.confirmations = o.confirmations == null ? 1 : o.confirmations;
    if (this.confirmations < 1) throw new CheckerError('confirmations must be >= 1');
    this.startAt = o.startAt == null ? null : o.startAt;
    this.checks = [];            // every raw check: {t, state, reason, status, ms}
    this.transitions = [];       // confirmed changes: {at, from, to}
    this.confirmed = 'unknown';  // current confirmed state
    this._runState = null;       // current run of identical raw states
    this._runStart = null;
    this._runCount = 0;
    this._pending = null;        // a candidate flip waiting for confirmation
  }

  // Record one check. `t` is its timestamp, `state`/meta from classify().
  // Returns {changed, from, to, confirmedState} describing any confirmed flip.
  push(t, classified) {
    const state = classified && classified.state === 'up' ? 'up' : 'down';
    if (this.checks.length && t < this.checks[this.checks.length - 1].t) {
      throw new CheckerError('checks must be pushed in non-decreasing time order');
    }
    if (this.startAt == null) this.startAt = t;
    this.checks.push({
      t, state,
      reason: (classified && classified.reason) || null,
      status: classified ? classified.status : null,
      ms: classified ? classified.ms : null,
    });

    // Track the run of identical raw states and date it to its first sample.
    if (state === this._runState) {
      this._runCount += 1;
    } else {
      this._runState = state;
      this._runStart = t;
      this._runCount = 1;
    }

    let changed = false, from = this.confirmed, to = this.confirmed;
    if (state !== this.confirmed && this._runCount >= this.confirmations) {
      from = this.confirmed;
      to = state;
      this.confirmed = state;
      this.transitions.push({ at: this._runStart, from, to });
      changed = true;
    }
    return { changed, from, to, confirmedState: this.confirmed };
  }

  // Build the confirmed-state segment timeline as of `asOf` (default: last
  // check). Each segment is {from, to, state, ms}. The first segment before the
  // first confirmed state is 'unknown'.
  segments(asOf) {
    const end = asOf == null
      ? (this.checks.length ? this.checks[this.checks.length - 1].t : this.startAt)
      : asOf;
    if (this.startAt == null) return [];
    if (end < this.startAt) throw new CheckerError('asOf is before monitoring started');

    const points = [{ at: this.startAt, state: 'unknown' }];
    for (const tr of this.transitions) {
      // Collapse a transition that lands exactly on startAt into the opener.
      if (tr.at <= this.startAt) points[0].state = tr.to;
      else points.push({ at: tr.at, state: tr.to });
    }
    const segs = [];
    for (let i = 0; i < points.length; i++) {
      const from = points[i].at;
      const to = i + 1 < points.length ? points[i + 1].at : end;
      if (to < from) continue;            // a later transition past asOf
      if (i + 1 < points.length && points[i + 1].at > end) {
        segs.push({ from, to: end, state: points[i].state, ms: end - from });
        break;
      }
      segs.push({ from, to, state: points[i].state, ms: to - from });
    }
    return segs;
  }

  // The headline numbers, time-weighted. asOf defaults to the last check.
  summary(asOf) {
    const segs = this.segments(asOf);
    const end = asOf == null
      ? (this.checks.length ? this.checks[this.checks.length - 1].t : this.startAt)
      : asOf;
    let upMs = 0, downMs = 0, unknownMs = 0;
    let longestUp = 0, longestDown = 0;
    const incidents = [];
    for (const s of segs) {
      if (s.state === 'up') { upMs += s.ms; if (s.ms > longestUp) longestUp = s.ms; }
      else if (s.state === 'down') {
        downMs += s.ms;
        if (s.ms > longestDown) longestDown = s.ms;
        const ongoing = s.to === end && s === segs[segs.length - 1];
        incidents.push({ from: s.from, to: s.to, ms: s.ms, ongoing });
      } else unknownMs += s.ms;
    }
    const measured = upMs + downMs;
    const checksUp = this.checks.filter((c) => c.state === 'up').length;
    const last = this.checks.length ? this.checks[this.checks.length - 1] : null;
    const currentSince = this.transitions.length
      ? this.transitions[this.transitions.length - 1].at
      : this.startAt;
    return {
      startAt: this.startAt,
      asOf: end,
      current: this.confirmed,
      currentSince,
      checks: this.checks.length,
      checksUp,
      checksDown: this.checks.length - checksUp,
      lastReason: last ? last.reason : null,
      upMs, downMs, unknownMs,
      measuredMs: measured,
      totalMs: upMs + downMs + unknownMs,
      // Time-weighted availability over the measured (non-unknown) window.
      uptimeRatio: measured > 0 ? upMs / measured : null,
      uptimePct: measured > 0 ? Math.round((upMs / measured) * 10000) / 100 : null,
      transitions: this.transitions.slice(),
      transitionCount: this.transitions.length,
      incidents,
      outages: incidents.length,
      longestUptimeMs: longestUp,
      longestOutageMs: longestDown,
      segments: segs,
    };
  }
}

/* ------------------------------------------------------------------ *
 * 4. A small helper: format a millisecond duration the way a status page would.
 * ------------------------------------------------------------------ */
function humanDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/* ------------------------------------------------------------------ */

const coreApi = {
  CheckerError,
  normalizeTarget,
  DEFAULT_RULES, classify,
  createSchedule,
  Monitor,
  humanDuration,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.SiteChecker = coreApi;
