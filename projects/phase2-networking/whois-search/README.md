# Whois Search Tool

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**sixth entry of its Networking category**, after the
[FTP Program](../ftp-program/), the [Bandwidth Monitor](../bandwidth-monitor/),
the [Port Scanner](../port-scanner/), the [Mail Checker](../mail-checker/) and
the [Country from IP Lookup](../country-from-ip/).

> "Whois Search Tool — perform a WHOIS lookup on a domain or IP address and show
> the result in a readable format."

Open `index.html` in a browser, type a domain or an IP, and see who it's
registered to — the registrar, the dates, the name servers, the status codes
(explained), and the full query path the tool took to get there. The same engine
runs under Node against the **live** port-43 servers (see `whois-node.js`). No
build step, no dependencies.

## What it actually does

WHOIS looks trivial — "connect to a server, send a name, read text" — and the
one sentence hides three honest problems. The whole design is about not cheating
on any of them.

### 1. Work out *which* server to ask

There is no single WHOIS server. Every TLD has its own registry
(`whois.verisign-grs.com` for `.com`, `whois.pir.org` for `.org`,
`whois.nic.uk` for `.uk`…), and IP addresses are answered by the five Regional
Internet Registries, not by a registry at all. You can't pick the server until
you know the **kind** of target and its **TLD** — so
[`classifyTarget`](./whois-core.js) parses the input first (stripping a pasted
`https://user@host:port/path` down to the host, refusing a non-ASCII label that
hasn't been punycoded, validating IPv4 with *no* octal leading zeros and IPv6
with `::`/embedded-v4), and [`planQuery`](./whois-core.js) maps it to a server.
Anything whose TLD isn't in the built-in map falls back to **IANA's** root
WHOIS, which refers us onward — so coverage degrades gracefully instead of
guessing.

### 2. Follow the referral — the thin/thick model

This is the part a naïve client gets wrong. `.com` and `.net` run a **thin**
registry: the registry response contains only the *sponsoring registrar* and a
pointer to **its** WHOIS server — the real record (registrant, full dates,
contacts) lives at the registrar. A correct lookup makes the **second hop**.
Most other TLDs are **thick** and answer in one shot.
[`lookup`](./whois-core.js) owns that policy: it reads the referral
(`Registrar WHOIS Server:`, or `refer:`/`ReferralServer:` for IPs), hops to it,
and **merges** the two answers — registry fields first, the registrar's fields
layered on, name servers and statuses unioned — recording in `provenance` which
server each field came from. It will not loop (a server that refers to itself
is caught), it caps the hop count, and a referral that can't be reached is a
**dead-end note on that hop**, not a lost lookup: the registry answer you
already have still stands.

The IANA root is treated as a *referral stub*, never authoritative data — it
answers an IP query with the whole administering `/8` and a `refer:` line, and
letting those coarse fields shadow the RIR's specific answer would be a lie, so
they're dropped from the merge while the referral is kept.

### 3. Parse free-form text that every registry formats differently

RFC 3912 says only "send a query, read text until the server closes." What comes
back is prose. [`parseWhois`](./whois-core.js) normalises it:

- **Dozens of field-name spellings** fold to one canonical record (`Creation
  Date` / `Created On` / `Registered on` / `Registration Time` → `created`, and
  so on), first non-empty winning.
- **Four date grammars** — ISO `2023-08-14T04:00:00Z`, date-only, Nominet's
  `05-Dec-1996`, and `.jp`'s `2023.08.14` — all parse to ISO 8601, and an
  impossible date like `2023-13-40` is **rejected**, never silently rolled over
  by `Date()`.
- **EPP status codes** are split off their trailing URL
  (`clientTransferProhibited https://icann.org/epp#…` → the code) and each is
  **explained** in plain English from a built-in table.
- **Block layouts** — `.uk` prints `Name servers:` as a header over indented,
  colon-less lines — are handled by a small section tracker.
- **GDPR/privacy redaction** (`REDACTED FOR PRIVACY`, `Data Protected`, …) is
  detected and flagged, and a `No match` / `not found` response is surfaced as
  an honest *unregistered*, not an error.
- **Legal boilerplate** (`%`/`#` comments, `>>> … <<<` banners, "TERMS OF USE…")
  is stripped so it never masquerades as a field.

## The network is injected — that's why the engine is honest *and* testable

`whois-core.js` never opens a socket and never touches the DOM. `lookup` takes a
`resolver(server, query) → text` function, and the referral policy is written
once against it:

| Where it runs | What the resolver does |
| --- | --- |
| `whois-node.js` | opens a **real TCP/43** connection, sends `query\r\n`, reads to close |
| `index.html` | returns a **bundled snapshot** from `whois-fixtures.js` |
| `tests.js` | returns **fakes**, including a self-referrer to prove the loop guard |

Same engine, same parsing, same merge — only the resolver changes.

## The pieces

| File | What's in it |
| --- | --- |
| `whois-core.js` | The whole engine, DOM- and network-free: `classifyTarget`, the TLD→server map + `planQuery`, the thin-TLD set, per-server query quirks (`domain ` for Verisign, `-T dn` for DENIC, `-B` for RIPE), `parseWhois` (field aliases, four date grammars, block sections, redaction + not-found detection, boilerplate stripping), the EPP status table + `explainStatus`, and the referral-following `lookup` with its merge/provenance/loop-guard. |
| `whois-node.js` | Binds the engine to real `net` TCP/43 sockets; reads targets from argv or stdin; text or `--json`; `--offline` uses the bundled snapshots. |
| `whois-fixtures.js` | Real-shaped WHOIS snapshots keyed by server, and a `fixtureResolver` the browser and tests share. |
| `index.html` | The single-page lookup demo. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — runs the engine over the fixtures and renders the verdict, the query path, the record, the explained statuses, and the raw responses. |
| `tests.js` | 72 dependency-free checks, run under Node. |

## Running the demo

Open `index.html` in any browser. Type a domain or IP, or click an example. The
`.com` examples show the **two-hop thin referral** (registry → registrar), the
`.org` example shows a thick GDPR-redacted record, `.uk` shows the alternate
date grammar and indented name-server block, `8.8.8.8` hops `IANA → ARIN`, and
`doesnotexist-zzzz.com` shows the honest **no-match**. Expand "Show the raw
WHOIS response(s)" to see exactly what the parser read on each hop.

## Running it against the live servers (Node)

```bash
# Real WHOIS, over TCP/43, following referrals:
node projects/phase2-networking/whois-search/whois-node.js google.com example.org 8.8.8.8

# Machine-readable:
node projects/phase2-networking/whois-search/whois-node.js google.com --json

# Batch from stdin, one target per line:
printf 'example.com\nexample.org\n' | node projects/phase2-networking/whois-search/whois-node.js

# No network — run the engine over the bundled snapshots:
node projects/phase2-networking/whois-search/whois-node.js google.com example.co.uk 8.8.8.8 --offline

# Tune the per-hop timeout (ms):
node projects/phase2-networking/whois-search/whois-node.js slow.example --timeout 8000
```

A live lookup needs outbound TCP to port 43; `--offline` needs nothing.

## Running the tests

```bash
node projects/phase2-networking/whois-search/tests.js
```

**72 checks**, in seven layers:

1. **Target classification** — URL/userinfo/port/trailing-dot stripping,
   lowercasing, single-label and empty rejection, non-ASCII refused, punycode
   accepted, bracketed-IPv6-with-port.
2. **IP validators** — IPv4 boundaries, `>255`, leading-zero (no octal) and
   wrong-octet-count rejection; IPv6 compressed/embedded-v4 forms, two-`::` and
   too-many-groups rejection.
3. **Query planning** — `.com`→Verisign (thin), `.org`→PIR (thick), unknown
   TLD and all IPs → IANA; the per-server query quirks.
4. **Date parsing** — all four grammars to ISO, with-time variants, and an
   impossible date rejected rather than rolled over.
5. **Status codes** — URL stripped off the code, several codes explained, an
   unknown code → `null`.
6. **Response parsing** — field extraction, date normalisation, multi-valued
   name servers lowercased, status codes deduped, boilerplate kept out of the
   fields, referral captured; plus not-found and redaction detection.
7. **End-to-end** — the thin `.com` two-hop referral with per-field provenance,
   an unreachable referral degrading gracefully, a thick redacted `.org`, a
   `.uk` with its own date grammar and indented name servers, an IP hopping
   `IANA → ARIN`, and a self-referral proving the loop guard and hop cap hold.

## A note on scope and the data

The browser can't open a port-43 socket, so the demo runs on a small set of
**illustrative** snapshots written in the exact text real servers emit — enough
to exercise every path (thin referral, thick, GDPR redaction, a ccTLD grammar,
an IP→RIR hop, a no-match). It is **not** a WHOIS database: the value here isn't
the data, it's a **correct client** — right server selection, an honest
thin/thick referral chain that merges without lying, and a tolerant parser that
turns five registries' worth of inconsistent prose into one record — all pinned
down by tests and ready to point at the live servers under Node.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
