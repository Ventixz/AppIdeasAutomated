# Country from IP Lookup

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**fifth entry of its Networking category**, after the
[FTP Program](../ftp-program/), the [Bandwidth Monitor](../bandwidth-monitor/),
the [Port Scanner](../port-scanner/) and the
[Mail Checker](../mail-checker/).

> "Country from IP Lookup — Enter an IP address and find the country that IP is
> **registered** in."

Open `index.html` in a browser, type an IP (v4 or v6), and get the country it's
registered to — with the full reasoning shown as three steps. The same engine
runs under Node against **real registry data** (see `geoip-node.js` and the
tests). No build step, no dependencies, no network calls.

## What it actually does

The task's one sentence hides three honest problems, and the whole design is
about not cheating on any of them.

### 1. Parse the address — both families, for real

IPv4 and IPv6 look nothing alike, and a lookup that accepts `256.1.1.1`, `1.2.3`
or `010.0.0.1` (octal!) has already lost. [`parseIP`](./geoip-core.js) dispatches
on the colon and parses each family strictly:

- **IPv4** — four octets, each `0–255`, **leading zeros refused** (so `010` is
  never silently read as octal `8`).
- **IPv6** — the full 8-group form, the `::` zero-compression shorthand (at the
  start, middle *or* end), and a single embedded-IPv4 tail (`::ffff:192.0.2.1`),
  with the one-`::`-maximum and 8-group-total rules enforced.

Both parse into one uniform **128-bit `BigInt`** — IPv4 mapped into its
`::ffff:0:0/96` space — so every range comparison downstream is identical for
the two families and one sorted table serves both. Output is re-canonicalised
(RFC 5952 longest-zero-run `::` compression), so `2001:200:0:0:0:0:0:1` echoes
back as `2001:200::1`.

### 2. Recognise special-use space — it belongs to no country

Huge parts of the address plan are reserved and have **no country at all**:
RFC 1918 private ranges (`10/8`, `172.16/12`, `192.168/16`), loopback
(`127/8`, `::1`), link-local (`169.254/16`, `fe80::/10`), the `100.64/10`
carrier-grade-NAT shared space, the `192.0.2/24` / `198.51.100/24` /
`203.0.113/24` documentation blocks, multicast, ULA (`fc00::/7`), and more
(RFC 6890). A lookup that returns a flag for `10.0.0.1` or `::1` is **lying**, so
[`classifySpecial`](./geoip-core.js) checks these **first** and names what the
address actually is. IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is judged by its
embedded IPv4, so a private address can't sneak through in v6 clothing.

### 3. Look it up — a binary search over a validated range table

The lookup itself is the classic problem: a sorted table of non-overlapping
`[start, end] → country` intervals, binary-searched.
[`RangeTable`](./geoip-core.js) sorts its ranges on construction and **refuses an
overlapping or malformed table outright** — because if two ranges claimed the
same address, "the country" would be ambiguous, and silently picking one is the
kind of bug that makes a geo-database wrong in a way nobody notices. `find()` is
an ordinary binary search returning the matching range, or **`null` in a gap**.

That last point is the whole ethic of the thing: a routable address that isn't
in the table comes back as **unknown**, never a nearest-neighbour guess.

## "Registered in" — what the answer really means

The task says *registered*, and that word is doing real work. What this returns
is the economy a block was **delegated to by its Regional Internet Registry** —
which is exactly what the five RIRs (ARIN, RIPE NCC, APNIC, LACNIC, AFRINIC)
publish in their **delegated-extended statistics** files. That is *not* the same
as where a host physically sits: a block registered to Ireland can be routed in
Frankfurt, and a CDN announces the same prefix from dozens of countries at once.
This engine answers the registration question honestly and doesn't pretend to be
a GPS.

The authoritative data is those RIR files, whose lines look like:

```
apnic|JP|ipv4|133.0.0.0|16777216|19970601|allocated
ripencc|NL|ipv6|2001:610::|32|19990819|allocated
```

For IPv4 the fifth field is a **count of addresses** (so `end = start + count - 1`);
for IPv6 it's a **prefix length**. [`parseRirDelegated`](./geoip-core.js) turns
that straight into table ranges — and it's the *same* code path that builds the
built-in demo snapshot, so the demo and a full registry file are never two
different code bases that can drift apart.

## The pieces

| File | What's in it |
| --- | --- |
| `geoip-core.js` | The whole engine, DOM-free and dependency-free: `parseIPv4` / `parseIPv6` / `parseIP`, `formatIP` (canonical v6), `cidrToRange`, the RFC 6890 special-use tables and `classifySpecial`, the `RangeTable` (validate + binary-search), the `parseRirDelegated` statistics parser, country-name + flag-emoji helpers, the illustrative demo snapshot, and the one public `lookup`. |
| `geoip-node.js` | Binds the engine to disk and I/O: loads a **CSV** range database or a real **RIR delegated** file, reads IPs from argv or stdin, and prints (text or `--json`). |
| `index.html` | The single-page lookup demo. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — reads the input, calls the engine, renders the verdict and the three honest steps. |
| `tests.js` | 54 dependency-free checks, run under Node. |

## Running the demo

Open `index.html` in any browser. Type an IP or click an example; the verdict
and a three-step breakdown (parse → classify → range search) appear instantly.
The green examples resolve to a country, the amber ones are special-use (no
country), and `203.0.200.1` shows the honest **unknown** for a routable address
outside the tiny snapshot.

## Running it under Node

```bash
# Look up one or more addresses against the built-in snapshot:
node projects/phase2-networking/country-from-ip/geoip-node.js 8.8.8.8 2606:4700::1111 10.0.0.1

# Batch from stdin, one IP per line:
printf '8.8.4.4\nfe80::1\n' | node projects/phase2-networking/country-from-ip/geoip-node.js

# Use a real registry database — a CSV of start,end,cc …
node projects/phase2-networking/country-from-ip/geoip-node.js 1.2.3.4 --csv ranges.csv
#   … or an actual RIR delegated-extended statistics file:
node projects/phase2-networking/country-from-ip/geoip-node.js 1.2.3.4 --rir delegated-apnic-extended-latest

# Machine-readable output:
node projects/phase2-networking/country-from-ip/geoip-node.js 8.8.8.8 --json
```

The `--rir` files are the ones published for free by each RIR (e.g.
`https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest`); the engine
parses them with no changes. This program doesn't fetch them — pointing a real
network tool at a URL is a separate concern, and the tests stay fully offline.

## Running the tests

```bash
node projects/phase2-networking/country-from-ip/tests.js
```

**54 checks**, in seven layers:

1. **IPv4 parsing** — value and round-trip; octet-out-of-range, wrong octet
   count, leading-zero and non-numeric octets all refused.
2. **IPv6 parsing** — full form, `::` at start/middle/end (proven equal to the
   expanded form), embedded IPv4, two-`::` and group-count rejection, and
   canonical `::` formatting.
3. **CIDR → range** — `/0`, `/32`, `/128`, interior boundaries, host-snapped-to-
   network, and bad prefix lengths.
4. **Special-use classification** — private / loopback / CGNAT / documentation /
   multicast / link-local / ULA for v4 and v6, IPv4-mapped v6, and that a
   routable address is *not* flagged special.
5. **RangeTable** — construction sorts; overlapping and `start > end` tables are
   refused; binary search hits both boundaries and returns `null` in gaps;
   a 10 000-range table is searched correctly.
6. **RIR delegated parser** — IPv4 count → inclusive range, IPv6 prefix math,
   and that no-country / reserved / ASN / summary lines are skipped.
7. **End-to-end** — a known address resolves to its country; private → special;
   a routable address outside the table → honest `null`; malformed → `ParseError`;
   and the snapshot, a CSV file and a parsed RIR file **all agree** on `8.8.8.8`.

## A note on scope and the data

The built-in table is a deliberately tiny, **illustrative** snapshot of real,
well-known registrations (Google's `8.8.8.0/24`, the Japanese `133/8`,
Cloudflare's `2606:4700::/32`, a few RIPE/LACNIC/AFRINIC blocks) — enough to show
every path light up. It is **not** a geolocation database, and swapping in a real
one is a one-liner: point `--rir` at a registry file. The value here isn't the
data; it's a **correct lookup engine** — strict dual-family parsing, honest
special-use handling, a validated non-overlapping range table with a real binary
search, and an unknown that stays unknown — all pinned down by tests.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
