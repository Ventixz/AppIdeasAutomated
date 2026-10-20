# Port Scanner

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**third entry of its Networking category**, after the
[FTP Program](../ftp-program/) and the [Bandwidth Monitor](../bandwidth-monitor/).

> "Port Scanner — Write a program that will attempt to open a socket on a range
> of ports to see which are **open**, **closed**, or **filtered**."

Open `index.html` in a browser for a live scanner against a simulated host:
type a port range, pick a target profile, and watch each port light up as its
verdict comes back — a colour-coded **port map**, a running summary, and a
per-port results table. No build step, no dependencies. The same engine drives
**real TCP sockets** under Node (see `portscan-node.js` and the tests).

## What it does

The task's one sentence hides the whole lesson: a scan's value isn't "open vs.
shut", it's the **three-way** split.

| State | What happened | What it tells you |
| --- | --- | --- |
| **open** | the connection completed | something is listening and accepted it |
| **closed** | the host actively **refused** (a TCP `RST` / `ECONNREFUSED`) | the host is up and reachable — nothing is listening *here* |
| **filtered** | **silence** — no answer at all before the timeout | a firewall quietly dropped the packet |

A naive scanner collapses *closed* and *filtered* into one "not open" bucket and
throws away the single most useful signal a scan produces: **whether a non-open
port answered you or ignored you.** This engine keeps them apart — and the
browser demo, the Node TCP binding and the tests all exercise the distinction.

## The honest part: closed is not filtered

The difference comes down to *who owns the clock*.

- A **closed** port is a fast, definite "no": the kernel on the far side sends a
  `RST`, your `connect()` fails with `ECONNREFUSED`, and you know for certain the
  host is reachable but nothing is bound there.
- A **filtered** port is **absence of evidence**. Your `SYN` goes out and
  *nothing* comes back — no `RST`, no `SYN/ACK`, nothing. A firewall has silently
  dropped the packet. You can't wait forever, so **the scanner itself owns a
  timeout**: when it expires with no answer, that silence *is* the verdict.

That's why the engine, not the probe, holds the timer. [`withTimeout`](./portscan-core.js)
races the probe against a deadline; whichever finishes first wins. If the probe
resolves → **open**; if it rejects with `ECONNREFUSED` → **closed**; if the
deadline wins first, the engine aborts the probe (tearing down a real socket so
no descriptor leaks) and records **filtered**. Host- and network-unreachable
errors (`EHOSTUNREACH`, `ENETUNREACH`, DNS failures) are a fourth thing —
**error** — because they aren't a verdict about the *port* at all; they mean you
never reached the host.

## Two more things a real scanner must get right

### Concurrency, bounded

Scanning 1024 ports one at a time is correct but glacial; firing all 1024 at
once melts the host and trips your own OS file-descriptor limit. So
"how many probes in flight at once" is a first-class knob. The
[`runPool`](./portscan-core.js) keeps exactly `concurrency` workers pulling the
next port off a shared cursor — the demo's **Concurrency** field drives it, and
a test asserts the ceiling is never exceeded.

### A strict port-spec parser

"A range of ports" means a human types `22, 80, 443, 8000-8100`.
[`parsePortSpec`](./portscan-core.js) turns that into a sorted, de-duplicated
list of valid ports — and is **strict on purpose**: a port is an integer in
1–65535, a range needs `lo ≤ hi`, and a typo like `80,htp` is a loud error, not
a silently-dropped token. (A scanner that quietly ignores a bad port scans the
wrong thing and tells you it found nothing.)

## It's a connect scan

The probe here is a plain TCP **connect** scan — open a full connection, and the
instant it succeeds, close it again (we want the verdict, not to hold the
socket). That's the only kind of scan an *unprivileged* program can do; SYN /
"stealth" scans need raw sockets and root. Honest about its scope, like the rest
of the routine's projects.

## The pieces

| File | What's in it |
| --- | --- |
| `portscan-core.js` | The whole engine, DOM-free and transport-agnostic: `PortScanner` (the pool + timeout + classifier), `parsePortSpec`, `classifyError`, `serviceName`, `summarize`, `withTimeout`, `runPool`, and `makeSimulatedHost` for deterministic demos/tests. |
| `portscan-node.js` | Binds the same engine to **real** TCP sockets via Node's `net` module — a connect probe that honours the exact contract the core expects. Includes a tiny CLI. |
| `index.html` | The single-page scanner demo. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — four simulated host profiles, the scan loop, the port-map heatmap, the summary and the results table. |
| `tests.js` | 28 dependency-free checks, run under Node. |

## Running it for real

```bash
# Scan common ports on a host you are authorised to scan:
node projects/phase2-networking/port-scanner/portscan-node.js 127.0.0.1 22,80,443,3306 1500 64
```

> ⚠️ **Only scan hosts you own or have explicit permission to scan.** Unsolicited
> port scanning of third-party systems is, in many jurisdictions and on most
> networks' acceptable-use policies, not OK. The tests only ever touch
> **loopback** (`127.0.0.1`) and a reserved non-routable address.

## Running the tests

```bash
node projects/phase2-networking/port-scanner/tests.js
```

**28 checks**, in four layers:

1. **Port-spec parsing** — single ports, comma lists, inclusive ranges, dedup &
   ordering, boundary ports (1 and 65535), and strict rejection of port 0,
   65536, non-numeric tokens, backwards ranges, empty specs and over-large
   ranges.
2. **The classifier & scanner** — the open/closed/filtered three-way split
   driven by a simulated host (the **filtered** verdict comes from the scanner's
   *real* timeout firing), closed-vs-filtered kept distinct, port-ordered output
   regardless of finish order, the concurrency bound never exceeded, progress
   callbacks, cancellation (→ `skipped`), and the summary.
3. **Service names & summary** — the well-known-port table and the counts/open
   list.
4. **Real TCP sockets** — a real loopback server scans as **open**, a released
   port scans as **closed** (a genuine `ECONNREFUSED`), a non-routable address
   never produces a false **open**, and three listeners scanned at once all come
   back open — all over actual `net` connections.

## A note on scope

A web page can't open an arbitrary TCP socket — the browser sandbox won't allow
it — so the demo scans a **simulated** host whose profile declares which ports
are open, which refuse, and which a firewall silently drops. The value here
isn't the simulation; it's a **correct scanning engine**: bounded concurrency,
an honest timeout, the open/closed/filtered/error classification and a strict
range parser, all pinned down by tests — and proven to run unchanged against
real kernel sockets, not just a mock.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
