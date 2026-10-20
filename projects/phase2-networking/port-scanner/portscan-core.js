/*
 * portscan-core.js — the port-scanning engine, transport-agnostic and DOM-free.
 * It knows nothing about browsers, sockets, timers-as-globals or tables. It does
 * exactly one thing, and does it honestly: drive a *probe* against a list of
 * ports with bounded concurrency and a timeout, and classify each port the way a
 * real TCP connect scan must — into OPEN, CLOSED or FILTERED.
 *
 * The whole point of the exercise — "attempt to open a socket on a range of
 * ports to see which are open, closed, or filtered" — lives in that three-way
 * split, and the split is subtler than open-vs-shut:
 *
 *   OPEN      the connection completed — something is listening and accepted it.
 *   CLOSED    the host actively REFUSED the connection (a TCP RST / ECONNREFUSED).
 *             The host is up and reachable; nothing is listening on that port.
 *   FILTERED  SILENCE. The probe got no answer at all before the timeout — a
 *             firewall quietly dropped the packet. This is NOT the same as
 *             closed: closed is a definite "no", filtered is "no idea".
 *
 * A naive scanner collapses CLOSED and FILTERED into one "not open" bucket and
 * throws away the single most useful signal a scan produces: whether a
 * non-open port answered you or ignored you. This engine keeps them apart, and
 * the browser demo, the Node TCP binding and the tests all exercise the
 * distinction.
 *
 * The engine never opens a socket itself. It is handed a `probe(host, port,
 * signal)` function and only interprets what that probe does: resolve (open),
 * reject with a code (closed / unreachable), or run past the timeout (filtered).
 * `portscan-node.js` supplies a real `net`-socket probe; the demo supplies a
 * simulated one; the tests use both.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Port states — the three the task asks for, plus two honest extras.
 * ------------------------------------------------------------------ */
const STATE = Object.freeze({
  OPEN: 'open',          // connection succeeded
  CLOSED: 'closed',      // actively refused (RST / ECONNREFUSED)
  FILTERED: 'filtered',  // no response before the timeout (silently dropped)
  ERROR: 'error',        // host/network unreachable, DNS failure, etc.
  SKIPPED: 'skipped',    // scan was cancelled before this port was probed
});

/* OS/socket error codes → state. A connect scan reads these exactly:
 *   ECONNREFUSED  the host sent a RST — reachable, port shut → CLOSED
 *   ETIMEDOUT     the SYN got no reply at all → FILTERED (same as our own
 *                 client-side timeout: both mean "silence")
 *   EHOSTUNREACH / ENETUNREACH / ENOTFOUND / EAI_AGAIN
 *                 we never even reached the host → ERROR, not a port verdict
 */
function classifyError(code) {
  switch (code) {
    case 'ECONNREFUSED': return STATE.CLOSED;
    case 'ETIMEDOUT':    return STATE.FILTERED;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'ECONNRESET':   // a RST mid-handshake is still a refusal in spirit…
      return code === 'ECONNRESET' ? STATE.CLOSED : STATE.ERROR;
    default:             return STATE.ERROR;
  }
}

/* ------------------------------------------------------------------ *
 * Port-spec parsing
 *
 * Turns a human string — "22, 80, 443, 8000-8100" — into a sorted, de-duplicated
 * list of valid port numbers. This is the "range of ports" half of the task,
 * and it has to be strict: a port is an integer in 1..65535, a range needs
 * lo ≤ hi, and anything else is a loud error rather than a silently-dropped
 * token (a scanner that quietly ignores a typo'd port scans the wrong thing).
 * ------------------------------------------------------------------ */
const MIN_PORT = 1;
const MAX_PORT = 65535;

function parsePort(tok) {
  if (!/^\d{1,5}$/.test(tok)) {
    throw new RangeError(`invalid port "${tok}" — want an integer 1–65535`);
  }
  const n = Number(tok);
  if (n < MIN_PORT || n > MAX_PORT) {
    throw new RangeError(`port ${n} out of range (1–65535)`);
  }
  return n;
}

/**
 * Parse a port spec into a sorted unique array of ports.
 *   parsePortSpec("80,443,8000-8002") → [80, 443, 8000, 8001, 8002]
 * @param {string} spec
 * @param {{maxPorts?:number}} [opts] cap on how many ports to allow (default 65535)
 */
function parsePortSpec(spec, opts = {}) {
  const maxPorts = opts.maxPorts ?? MAX_PORT;
  if (typeof spec !== 'string' || !spec.trim()) {
    throw new SyntaxError('empty port spec');
  }
  const set = new Set();
  for (const rawPart of spec.split(',')) {
    const part = rawPart.trim();
    if (part === '') continue; // tolerate "80,,443" and trailing commas
    const dash = part.indexOf('-');
    if (dash === -1) {
      set.add(parsePort(part));
    } else {
      const lo = parsePort(part.slice(0, dash).trim());
      const hi = parsePort(part.slice(dash + 1).trim());
      if (lo > hi) {
        throw new RangeError(`range ${lo}-${hi} is backwards (lo must be ≤ hi)`);
      }
      for (let p = lo; p <= hi; p++) set.add(p);
      if (set.size > maxPorts) {
        throw new RangeError(`too many ports (> ${maxPorts}); narrow the range`);
      }
    }
  }
  if (set.size === 0) throw new SyntaxError('port spec resolved to no ports');
  if (set.size > maxPorts) {
    throw new RangeError(`too many ports (> ${maxPorts}); narrow the range`);
  }
  return [...set].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Well-known service names (a small, practical slice of the IANA list).
 * A scan is far more readable as "22 ssh — open" than "22 — open".
 * ------------------------------------------------------------------ */
const SERVICES = Object.freeze({
  7: 'echo', 20: 'ftp-data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp',
  53: 'dns', 67: 'dhcp', 68: 'dhcp', 69: 'tftp', 80: 'http', 110: 'pop3',
  111: 'rpcbind', 123: 'ntp', 135: 'msrpc', 137: 'netbios-ns',
  139: 'netbios-ssn', 143: 'imap', 161: 'snmp', 162: 'snmp-trap',
  179: 'bgp', 194: 'irc', 389: 'ldap', 443: 'https', 445: 'microsoft-ds',
  465: 'smtps', 514: 'syslog', 515: 'printer', 587: 'submission',
  631: 'ipp', 636: 'ldaps', 873: 'rsync', 989: 'ftps-data', 990: 'ftps',
  993: 'imaps', 995: 'pop3s', 1080: 'socks', 1194: 'openvpn',
  1433: 'ms-sql', 1521: 'oracle', 1723: 'pptp', 2049: 'nfs',
  2082: 'cpanel', 2083: 'cpanel-ssl', 2375: 'docker', 2376: 'docker-ssl',
  3000: 'dev-http', 3306: 'mysql', 3389: 'rdp', 4444: 'metasploit',
  5000: 'dev-http', 5432: 'postgresql', 5672: 'amqp', 5900: 'vnc',
  6379: 'redis', 6443: 'kube-api', 8000: 'http-alt', 8008: 'http-alt',
  8080: 'http-proxy', 8081: 'http-alt', 8443: 'https-alt', 8888: 'http-alt',
  9000: 'http-alt', 9090: 'prometheus', 9200: 'elasticsearch',
  9300: 'elasticsearch', 11211: 'memcached', 27017: 'mongodb',
  50000: 'db2',
});

/** Service name for a port, or '' if unknown. */
function serviceName(port) {
  return SERVICES[port] || '';
}

/* ------------------------------------------------------------------ *
 * withTimeout — race a probe against a deadline.
 *
 * The scanner, not the probe, owns the clock. We start the probe, hand it an
 * AbortSignal, and set a timer: whichever finishes first wins. If the timer
 * wins we abort the signal (so a real socket probe can tear its socket down)
 * and report a timeout. This is exactly how "no response → FILTERED" is made
 * to happen on a port that never answers.
 *
 * The scheduler is injectable (setTimer/clearTimer) so tests can drive time
 * deterministically instead of waiting on the wall clock.
 * ------------------------------------------------------------------ */
function withTimeout(startProbe, timeoutMs, sched) {
  const setT = (sched && sched.setTimer) || setTimeout;
  const clrT = (sched && sched.clearTimer) || clearTimeout;
  const controller = new AbortController();
  let timer = null;
  let settled = false;

  const timeout = new Promise((resolve) => {
    timer = setT(() => {
      if (settled) return;
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });

  const probe = Promise.resolve()
    .then(() => startProbe(controller.signal))
    .then(
      (value) => ({ value }),
      (error) => ({ error })
    );

  return Promise.race([probe, timeout]).then((outcome) => {
    settled = true;
    if (timer !== null) clrT(timer);
    return outcome; // { value } | { error } | { timedOut:true }
  });
}

/* ------------------------------------------------------------------ *
 * A tiny bounded-concurrency pool.
 *
 * A scanner that fires one probe at a time is correct but glacial; one that
 * fires all 1024 at once melts the host (and trips its own OS file-descriptor
 * limit). The real knob on every scanner is "how many probes in flight at
 * once", so that is a first-class option here. The pool keeps exactly
 * `concurrency` workers pulling the next port off a shared cursor until the
 * list — or a cancellation — runs out.
 * ------------------------------------------------------------------ */
function runPool(items, concurrency, worker) {
  return new Promise((resolve, reject) => {
    const n = items.length;
    const width = Math.max(1, Math.min(concurrency | 0 || 1, n || 1));
    let next = 0;
    let active = 0;
    let done = false;

    function fail(err) {
      if (done) return;
      done = true;
      reject(err);
    }
    function pump() {
      if (done) return;
      while (active < width && next < n) {
        const idx = next++;
        active++;
        Promise.resolve()
          .then(() => worker(items[idx], idx))
          .then(() => {
            active--;
            if (next >= n && active === 0) { done = true; resolve(); }
            else pump();
          }, fail);
      }
      if (next >= n && active === 0 && !done) { done = true; resolve(); }
    }
    if (n === 0) { resolve(); return; }
    pump();
  });
}

/* ------------------------------------------------------------------ *
 * PortScanner — the front door.
 *
 * Give it a host, a list of ports and a `probe`. It runs the probes with
 * bounded concurrency, applies the timeout, classifies every result into one of
 * the STATE values, times each probe, and returns the full result set plus a
 * summary. It reports progress as it goes and can be cancelled mid-flight.
 * ------------------------------------------------------------------ */
class PortScanner {
  /**
   * @param {object} opts
   * @param {string} opts.host           target host (passed straight to the probe)
   * @param {number[]} opts.ports        ports to scan (use parsePortSpec)
   * @param {Function} opts.probe        (host, port, signal) => Promise; resolve = open
   * @param {number} [opts.timeoutMs]    per-port deadline (default 1500)
   * @param {number} [opts.concurrency]  max probes in flight (default 64)
   * @param {Function} [opts.onProgress] called with (resultSoFar, {done,total})
   * @param {Function} [opts.now]        clock for latency timing (default Date.now)
   * @param {object}   [opts.sched]      {setTimer,clearTimer} for the timeout (tests)
   */
  constructor(opts) {
    if (!opts || typeof opts.probe !== 'function') {
      throw new TypeError('PortScanner needs a probe(host, port, signal) function');
    }
    this.host = opts.host;
    this.ports = (opts.ports || []).slice();
    this.probe = opts.probe;
    this.timeoutMs = opts.timeoutMs ?? 1500;
    this.concurrency = opts.concurrency ?? 64;
    this.onProgress = opts.onProgress || null;
    this.now = opts.now || Date.now;
    this.sched = opts.sched || null;
    this._cancelled = false;
    this.results = [];
  }

  /** Stop launching new probes; ports not yet started become SKIPPED. */
  cancel() { this._cancelled = true; }

  /** Classify one raw probe outcome into a result row. */
  _classify(port, outcome, latencyMs) {
    let state, reason;
    if (outcome.timedOut) {
      state = STATE.FILTERED;
      reason = `no response in ${this.timeoutMs} ms`;
    } else if ('value' in outcome) {
      state = STATE.OPEN;
      reason = 'connected';
    } else {
      const err = outcome.error || {};
      const code = err.code || (err.name === 'AbortError' ? 'ETIMEDOUT' : undefined);
      state = classifyError(code);
      if (state === STATE.FILTERED) reason = `no response in ${this.timeoutMs} ms`;
      else if (state === STATE.CLOSED) reason = 'connection refused';
      else reason = err.message || code || 'error';
      if (code) reason = `${reason} (${code})`;
    }
    return {
      port,
      state,
      service: serviceName(port),
      latencyMs: Math.round(latencyMs),
      reason,
    };
  }

  /**
   * Run the scan.
   * @returns {Promise<{host,results,summary,elapsedMs}>}
   */
  async scan() {
    const start = this.now();
    this.results = [];
    const total = this.ports.length;
    let done = 0;

    await runPool(this.ports, this.concurrency, async (port) => {
      if (this._cancelled) {
        const row = {
          port, state: STATE.SKIPPED, service: serviceName(port),
          latencyMs: 0, reason: 'cancelled',
        };
        this.results.push(row);
        done++;
        if (this.onProgress) this.onProgress(row, { done, total });
        return;
      }
      const t0 = this.now();
      const outcome = await withTimeout(
        (signal) => this.probe(this.host, port, signal),
        this.timeoutMs,
        this.sched
      );
      const latency = this.now() - t0;
      const row = this._classify(port, outcome, latency);
      this.results.push(row);
      done++;
      if (this.onProgress) this.onProgress(row, { done, total });
    });

    // Keep the output in port order regardless of completion order.
    this.results.sort((a, b) => a.port - b.port);
    const elapsedMs = this.now() - start;
    return {
      host: this.host,
      results: this.results,
      summary: summarize(this.results),
      elapsedMs,
    };
  }
}

/* ------------------------------------------------------------------ *
 * summarize — counts by state and the list of open ports.
 * ------------------------------------------------------------------ */
function summarize(results) {
  const counts = { open: 0, closed: 0, filtered: 0, error: 0, skipped: 0 };
  const openPorts = [];
  for (const r of results) {
    counts[r.state] = (counts[r.state] || 0) + 1;
    if (r.state === STATE.OPEN) openPorts.push(r.port);
  }
  openPorts.sort((a, b) => a - b);
  return { total: results.length, counts, openPorts };
}

/* ------------------------------------------------------------------ *
 * makeSimulatedHost — a deterministic probe for the demo and the tests.
 *
 * A browser can't open a TCP socket to an arbitrary host:port, so the demo
 * scans a *simulated* host instead. You describe the host as a profile — which
 * ports are open, which are explicitly closed (refused), and the rest default
 * to filtered or closed — and get back a probe with the exact contract the real
 * one honours: resolve = open, reject{code:'ECONNREFUSED'} = closed, and for a
 * filtered port it simply never settles, so the scanner's own timeout fires and
 * classifies it FILTERED. Latency is simulated via the injected scheduler.
 * ------------------------------------------------------------------ */
function makeSimulatedHost(profile = {}) {
  const open = new Set(profile.open || []);
  const closed = new Set(profile.closed || []);
  const filtered = new Set(profile.filtered || []);
  // Default for any port not named: 'closed' (a reachable host with nothing
  // listening) unless the profile says otherwise.
  const def = profile.default || STATE.CLOSED;
  const latencyMs = profile.latencyMs ?? 20;
  const setT = (profile.sched && profile.sched.setTimer) || setTimeout;

  return function simulatedProbe(host, port, signal) {
    const verdict = open.has(port) ? STATE.OPEN
      : closed.has(port) ? STATE.CLOSED
      : filtered.has(port) ? STATE.FILTERED
      : def;
    return new Promise((resolve, reject) => {
      if (verdict === STATE.FILTERED) {
        // Silence: never settle. The scanner's timeout will catch it. We do
        // listen for the abort so we don't leak, but we never resolve/reject.
        if (signal) signal.addEventListener('abort', () => {}, { once: true });
        return;
      }
      setT(() => {
        if (signal && signal.aborted) return;
        if (verdict === STATE.OPEN) resolve({ connected: true });
        else {
          const err = new Error('connection refused');
          err.code = 'ECONNREFUSED';
          reject(err);
        }
      }, latencyMs);
    });
  };
}

/* ------------------------------------------------------------------ */
const api = {
  STATE,
  MIN_PORT, MAX_PORT,
  classifyError,
  parsePort, parsePortSpec,
  SERVICES, serviceName,
  withTimeout, runPool,
  PortScanner, summarize,
  makeSimulatedHost,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;          // Node / tests
}
if (typeof window !== 'undefined') {
  window.PortScan = api;         // browser demo
}
