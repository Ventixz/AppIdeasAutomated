/*
 * geoip-core.js — the whole "country from an IP" engine, DOM-free and with no
 * dependencies. Works unchanged in a browser (via a <script> tag) and under
 * Node (via require), because it never touches the DOM, the network, or the
 * filesystem — those live in geoip-node.js / script.js.
 *
 * The task's one sentence — "enter an IP address and find the country that IP
 * is registered in" — is really three honest problems stacked on top of each
 * other:
 *
 *   1. PARSE the address. IPv4 and IPv6 look nothing alike, IPv6 has the `::`
 *      zero-compression shorthand and an embedded-IPv4 form, and a lookup that
 *      accepts "256.1.1.1" or "1.2.3" has already lost. We parse both into one
 *      uniform 128-bit BigInt (IPv4 mapped into its ::ffff:0:0/96 space) so the
 *      range math below is identical for both families.
 *
 *   2. CLASSIFY special-use space. Huge swathes of the address plan belong to
 *      nobody's country: RFC 1918 private ranges, loopback, link-local, the
 *      100.64/10 carrier-grade-NAT shared space, the TEST-NET documentation
 *      blocks, multicast, and so on (RFC 6890). A lookup that returns a country
 *      for 10.0.0.1 or ::1 is lying. We detect these first and say so, by name.
 *
 *   3. LOOK UP the country. This is a classic range lookup: a sorted table of
 *      non-overlapping [start, end] → country-code intervals, binary-searched.
 *      The *data* is the hard, approximate part — see the note in the README —
 *      so the engine takes any such table (the built-in demo snapshot, a CSV,
 *      or real RIR "delegated-extended" statistics files) and answers against
 *      it, and when an address falls in a gap it returns `null`, not a guess.
 *
 * "Registered in" is the honest framing the task uses: what we return is the
 * economy a block was *delegated to* by its Regional Internet Registry, which
 * is exactly what the RIR statistics files record. That is not the same thing
 * as where the host physically sits (an Irish-registered /16 can be routed in
 * Frankfurt), and the engine never pretends otherwise.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

class ParseError extends Error {
  constructor(message) { super(message); this.name = 'ParseError'; }
}
class RangeTableError extends Error {
  constructor(message) { super(message); this.name = 'RangeTableError'; }
}

/* ------------------------------------------------------------------ *
 * 1. Parsing — IPv4 and IPv6 into one uniform 128-bit BigInt
 *
 * Everything downstream works on a { version, value } pair where `value` is a
 * BigInt. IPv4 addresses are also carried as their native 32-bit value, but for
 * range lookups we use the IPv4-mapped IPv6 value (::ffff:a.b.c.d), so one
 * sorted table can hold both families and one binary search serves both.
 * ------------------------------------------------------------------ */

const V4_BITS = 32n;
const V6_BITS = 128n;
const V4_MAX = (1n << V4_BITS) - 1n;        // 255.255.255.255
const V6_MAX = (1n << V6_BITS) - 1n;
const V4_MAPPED_PREFIX = 0xffffn << 32n;    // ::ffff:0:0/96

/**
 * Parse a dotted-quad IPv4 string into a 32-bit BigInt.
 * Rejects out-of-range octets, the wrong number of octets, empty octets,
 * non-numeric octets, and leading zeros (so "010" — which some libraries read
 * as octal — is refused rather than silently reinterpreted).
 * @param {string} str
 * @returns {bigint} value in [0, 2^32)
 */
function parseIPv4(str) {
  if (typeof str !== 'string') throw new ParseError('IPv4: not a string');
  const parts = str.split('.');
  if (parts.length !== 4) throw new ParseError(`IPv4: expected 4 octets, got ${parts.length} in "${str}"`);
  let value = 0n;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) throw new ParseError(`IPv4: non-numeric octet "${part}"`);
    if (part.length > 1 && part[0] === '0') throw new ParseError(`IPv4: leading zero in octet "${part}" (ambiguous)`);
    const n = Number(part);
    if (n > 255) throw new ParseError(`IPv4: octet ${n} out of range (0-255)`);
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

/**
 * Parse an IPv6 string into a 128-bit BigInt. Handles:
 *   - full 8-group form                                  2001:db8:0:0:0:0:0:1
 *   - "::" zero-compression, at start / middle / end     ::1  fe80::  2001:db8::1
 *   - a single embedded IPv4 tail                        ::ffff:192.0.2.1
 * Enforces the one-"::"-maximum rule and the 8-group total.
 * @param {string} str
 * @returns {bigint} value in [0, 2^128)
 */
function parseIPv6(str) {
  if (typeof str !== 'string') throw new ParseError('IPv6: not a string');
  if (str.indexOf(':') === -1) throw new ParseError(`IPv6: no colons in "${str}"`);

  // Split off a "::" (zero run). At most one is allowed.
  const dbl = str.split('::');
  if (dbl.length > 2) throw new ParseError('IPv6: "::" may appear only once');

  const groups = [];
  const toGroups = (segment, side) => {
    if (segment === '') return [];
    const pieces = segment.split(':');
    const out = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      // A trailing IPv4 (only valid as the final piece) expands to two groups.
      if (piece.indexOf('.') !== -1) {
        if (i !== pieces.length - 1) throw new ParseError('IPv6: embedded IPv4 must be last');
        const v4 = parseIPv4(piece);
        out.push(Number((v4 >> 16n) & 0xffffn));
        out.push(Number(v4 & 0xffffn));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) throw new ParseError(`IPv6: bad group "${piece}"`);
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = toGroups(dbl[0], 'head');
  if (dbl.length === 2) {
    const tail = toGroups(dbl[1], 'tail');
    const fill = 8 - head.length - tail.length;
    if (fill < 1) throw new ParseError('IPv6: "::" must stand for at least one zero group');
    groups.push(...head, ...new Array(fill).fill(0), ...tail);
  } else {
    groups.push(...head);
  }
  if (groups.length !== 8) throw new ParseError(`IPv6: expected 8 groups, assembled ${groups.length}`);

  let value = 0n;
  for (const g of groups) value = (value << 16n) | BigInt(g);
  return value;
}

/**
 * Parse any IP string into { version: 4|6, value, mapped }.
 *   - `value`  is the address in its own family's space (v4: 32-bit, v6: 128-bit)
 *   - `mapped` is the 128-bit value used for the unified range table
 *     (v4 is mapped into ::ffff:0:0/96; v6 is just `value`).
 * @param {string} str
 * @returns {{version:number, value:bigint, mapped:bigint}}
 */
function parseIP(str) {
  if (typeof str !== 'string') throw new ParseError('not a string');
  const s = str.trim();
  if (s === '') throw new ParseError('empty address');
  // A ':' means IPv6; otherwise treat as IPv4.
  if (s.indexOf(':') !== -1) {
    const value = parseIPv6(s);
    return { version: 6, value, mapped: value };
  }
  const value = parseIPv4(s);
  return { version: 4, value, mapped: V4_MAPPED_PREFIX | value };
}

/**
 * Format a BigInt back to a canonical IPv4 or IPv6 string.
 * @param {bigint} value
 * @param {number} version  4 or 6
 */
function formatIP(value, version) {
  if (version === 4) {
    const o = [];
    for (let shift = 24n; shift >= 0n; shift -= 8n) o.push(Number((value >> shift) & 0xffn));
    return o.join('.');
  }
  // IPv6 with the standard "::"-longest-zero-run compression (RFC 5952).
  const groups = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) groups.push(Number((value >> shift) & 0xffffn));
  // Find the longest run of zero groups (length >= 2) to collapse.
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else { curStart = -1; curLen = 0; }
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen >= 2) {
    const before = hex.slice(0, bestStart).join(':');
    const after = hex.slice(bestStart + bestLen).join(':');
    return `${before}::${after}`;
  }
  return hex.join(':');
}

/* ------------------------------------------------------------------ *
 * CIDR → [start, end] range math
 * ------------------------------------------------------------------ */

/**
 * Convert "a.b.c.d/p" or "xxxx::/p" to an inclusive [start, end] range of
 * *mapped* 128-bit values, so v4 and v6 CIDRs land in the same number space.
 * @param {string} cidr
 * @returns {{start:bigint, end:bigint, version:number, prefix:number}}
 */
function cidrToRange(cidr) {
  const slash = cidr.indexOf('/');
  if (slash === -1) throw new ParseError(`CIDR: missing "/" in "${cidr}"`);
  const addr = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  const { version, mapped } = parseIP(addr);
  const famBits = version === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > famBits) {
    throw new ParseError(`CIDR: /${cidr.slice(slash + 1)} out of range for IPv${version}`);
  }
  // Work in the family's own space, then map v4 up afterwards.
  const famMax = version === 4 ? V4_MAX : V6_MAX;
  const native = version === 4 ? (mapped & V4_MAX) : mapped;
  const hostBits = BigInt(famBits - prefix);
  const mask = hostBits === 0n ? famMax : (famMax ^ ((1n << hostBits) - 1n));
  const start = native & mask;
  const end = start | ((1n << hostBits) - 1n);
  const toMapped = (v) => (version === 4 ? (V4_MAPPED_PREFIX | v) : v);
  return { start: toMapped(start), end: toMapped(end), version, prefix };
}

/* ------------------------------------------------------------------ *
 * 2. Special-use address classification (RFC 6890 and friends)
 *
 * These blocks belong to no country. We detect them before any table lookup so
 * the answer for 10.0.0.1, 127.0.0.1, 169.254.x.x, ::1, fe80::… is an honest
 * "no registered country — <what it actually is>", never a bogus flag.
 * ------------------------------------------------------------------ */

const SPECIAL_V4 = [
  ['0.0.0.0/8', 'this-network / unspecified'],
  ['10.0.0.0/8', 'private network (RFC 1918)'],
  ['100.64.0.0/10', 'carrier-grade NAT shared space (RFC 6598)'],
  ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local (APIPA)'],
  ['172.16.0.0/12', 'private network (RFC 1918)'],
  ['192.0.0.0/24', 'IETF protocol assignments'],
  ['192.0.2.0/24', 'documentation (TEST-NET-1)'],
  ['192.88.99.0/24', '6to4 relay anycast (deprecated)'],
  ['192.168.0.0/16', 'private network (RFC 1918)'],
  ['198.18.0.0/15', 'benchmarking (RFC 2544)'],
  ['198.51.100.0/24', 'documentation (TEST-NET-2)'],
  ['203.0.113.0/24', 'documentation (TEST-NET-3)'],
  ['224.0.0.0/4', 'multicast'],
  ['240.0.0.0/4', 'reserved for future use'],
  ['255.255.255.255/32', 'limited broadcast'],
];

const SPECIAL_V6 = [
  ['::/128', 'unspecified address'],
  ['::1/128', 'loopback'],
  ['64:ff9b::/96', 'NAT64 well-known prefix (RFC 6052)'],
  ['100::/64', 'discard-only (RFC 6666)'],
  ['2001:db8::/32', 'documentation (RFC 3849)'],
  ['2001::/23', 'IETF protocol assignments'],
  ['2002::/16', '6to4'],
  ['fc00::/7', 'unique local address (ULA, RFC 4193)'],
  ['fe80::/10', 'link-local'],
  ['ff00::/8', 'multicast'],
];

// Pre-compute the special ranges once, as mapped 128-bit intervals.
function buildSpecial(list) {
  return list.map(([cidr, label]) => {
    const r = cidrToRange(cidr);
    return { start: r.start, end: r.end, label };
  });
}
const SPECIAL_RANGES_V4 = buildSpecial(SPECIAL_V4);
const SPECIAL_RANGES_V6 = buildSpecial(SPECIAL_V6);

/**
 * If `ip` is in special-use space, return its human label; else return null.
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) is classified by its embedded IPv4.
 * @param {{version:number, value:bigint, mapped:bigint}} ip
 * @returns {string|null}
 */
function classifySpecial(ip) {
  // An IPv4-mapped IPv6 address is really an IPv4 address; judge it as one.
  if (ip.version === 6 && (ip.value & ~V4_MAX) === V4_MAPPED_PREFIX) {
    const inner = { version: 4, value: ip.value & V4_MAX, mapped: ip.value };
    const lbl = classifySpecial(inner);
    return lbl ? `${lbl} (IPv4-mapped)` : null;
  }
  const ranges = ip.version === 4 ? SPECIAL_RANGES_V4 : SPECIAL_RANGES_V6;
  for (const r of ranges) {
    if (ip.mapped >= r.start && ip.mapped <= r.end) return r.label;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 3. RangeTable — a sorted, validated, non-overlapping interval table
 *    with a binary-search lookup. This is the heart of the lookup.
 * ------------------------------------------------------------------ */

class RangeTable {
  /**
   * @param {Array<{start:bigint,end:bigint,cc:string}>} ranges
   *   Each range is an inclusive [start, end] interval of *mapped* 128-bit
   *   values with a 2-letter country code. They are sorted on construction and
   *   validated to be well-formed and non-overlapping — an overlapping table
   *   would make "the country" ambiguous, so we refuse it loudly.
   */
  constructor(ranges = []) {
    this.ranges = ranges.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    for (let i = 0; i < this.ranges.length; i++) {
      const r = this.ranges[i];
      if (r.start > r.end) throw new RangeTableError(`range ${i}: start > end`);
      if (i > 0 && this.ranges[i - 1].end >= r.start) {
        throw new RangeTableError(`overlapping ranges at index ${i} (${this.ranges[i - 1].end} >= ${r.start})`);
      }
    }
  }

  /**
   * Binary-search for the country code covering a mapped 128-bit value.
   * @param {bigint} mapped
   * @returns {{cc:string, start:bigint, end:bigint}|null} the matching range, or null in a gap
   */
  find(mapped) {
    let lo = 0, hi = this.ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.ranges[mid];
      if (mapped < r.start) hi = mid - 1;
      else if (mapped > r.end) lo = mid + 1;
      else return r;
    }
    return null;
  }

  get size() { return this.ranges.length; }

  /** Build a table from CIDR+cc pairs: [["8.8.8.0/24","US"], ...]. */
  static fromCidrs(pairs) {
    return new RangeTable(pairs.map(([cidr, cc]) => {
      const r = cidrToRange(cidr);
      return { start: r.start, end: r.end, cc: String(cc).toUpperCase() };
    }));
  }
}

/* ------------------------------------------------------------------ *
 * RIR "delegated-extended" statistics parser
 *
 * The authoritative source for "which country is this block registered to" is
 * each Regional Internet Registry's published statistics file. Its lines look
 * like:
 *     apnic|JP|ipv4|133.0.0.0|65536|19970601|assigned
 *     ripencc|NL|ipv6|2001:610::|32|19990819|allocated
 * For ipv4 the 5th field is a COUNT of addresses (so end = start + count - 1);
 * for ipv6 it is a PREFIX LENGTH. This parser turns such text into table ranges,
 * which is exactly how a real offline country-from-IP database is built — and
 * it is the same code path the built-in demo snapshot is created with.
 * @param {string} text
 * @returns {Array<{start:bigint,end:bigint,cc:string}>}
 */
function parseRirDelegated(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line[0] === '#') continue;
    const f = line.split('|');
    if (f.length < 7) continue;
    const [, cc, type, startStr, countStr, , status] = f;
    if (type !== 'ipv4' && type !== 'ipv6') continue;             // skip asn / summary / version lines
    if (cc === '' || cc === '*' || cc.length !== 2) continue;      // no country → skip (honest)
    if (status !== 'allocated' && status !== 'assigned') continue; // skip reserved / available
    if (type === 'ipv4') {
      const start = V4_MAPPED_PREFIX | parseIPv4(startStr);
      const count = BigInt(countStr);
      out.push({ start, end: start + count - 1n, cc: cc.toUpperCase() });
    } else {
      const r = cidrToRange(`${startStr}/${countStr}`);
      out.push({ start: r.start, end: r.end, cc: cc.toUpperCase() });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Country code → name + flag emoji
 *
 * A pragmatic ISO 3166-1 alpha-2 subset (enough for the demo snapshot and the
 * common cases). The flag is derived, not stored: two regional-indicator code
 * points, one per letter, which every modern platform renders as the flag.
 * ------------------------------------------------------------------ */

const COUNTRY_NAMES = {
  AU: 'Australia', BR: 'Brazil', CA: 'Canada', CH: 'Switzerland', CN: 'China',
  DE: 'Germany', EU: 'European Union', FR: 'France', GB: 'United Kingdom',
  IE: 'Ireland', IN: 'India', JP: 'Japan', KR: 'South Korea', NL: 'Netherlands',
  NZ: 'New Zealand', RU: 'Russia', SE: 'Sweden', SG: 'Singapore', US: 'United States',
  ZA: 'South Africa',
};

/** Country code → 🇺🇸-style flag emoji from regional-indicator symbols. */
function flagEmoji(cc) {
  if (!/^[A-Za-z]{2}$/.test(cc)) return '🏳';
  const base = 0x1f1e6; // regional indicator 'A'
  const up = cc.toUpperCase();
  return String.fromCodePoint(base + (up.charCodeAt(0) - 65), base + (up.charCodeAt(1) - 65));
}

function countryName(cc) {
  return COUNTRY_NAMES[String(cc).toUpperCase()] || null;
}

/* ------------------------------------------------------------------ *
 * The built-in demo snapshot
 *
 * An *illustrative* slice of real, well-known registrations, written in the RIR
 * delegated format and parsed by the same code that would ingest a full RIR
 * file. It is deliberately tiny and is NOT a geolocation database — see the
 * README. Country here means the economy the block is registered/delegated to.
 * ------------------------------------------------------------------ */

const DEMO_DELEGATED = [
  // registry | cc | type | start | count-or-prefix | date | status
  'arin|US|ipv4|8.8.8.0|256|20090101|assigned',        // Google Public DNS
  'arin|US|ipv4|8.8.4.0|256|20090101|assigned',        // Google Public DNS
  'arin|US|ipv4|208.67.222.0|512|20060101|assigned',   // Cisco / OpenDNS resolvers
  'ripencc|NL|ipv4|193.0.0.0|2048|20010101|allocated',  // RIPE NCC, Amsterdam
  'apnic|JP|ipv4|133.0.0.0|16777216|19970601|allocated', // the 133/8 block delegated to Japan (JPNIC)
  'apnic|AU|ipv4|1.1.1.0|256|20110811|assigned',        // APNIC Labs (1.1.1.1 research block)
  'lacnic|BR|ipv4|200.160.0.0|8192|19991101|allocated',  // NIC.br, Brazil
  'afrinic|ZA|ipv4|196.0.0.0|8192|20050101|allocated',   // delegated within AFRINIC region
  'ripencc|DE|ipv4|81.169.0.0|65536|20010101|allocated', // RIPE region, Germany
  'ripencc|GB|ipv4|51.140.0.0|65536|20150101|allocated', // RIPE region, United Kingdom
  'ripencc|NL|ipv6|2a00:1450::|32|20050101|allocated',   // Google Europe, IPv6
  'arin|US|ipv6|2606:4700::|32|20100101|assigned',       // Cloudflare, IPv6
  'apnic|JP|ipv6|2001:200::|32|19990819|allocated',      // WIDE / Japan, IPv6
].join('\n');

/** A fresh RangeTable built from the built-in demo snapshot. */
function demoTable() {
  return new RangeTable(parseRirDelegated(DEMO_DELEGATED));
}

/* ------------------------------------------------------------------ *
 * The one public entry point: look an address up against a table
 * ------------------------------------------------------------------ */

/**
 * Resolve a country for an IP string against a RangeTable.
 *
 * The three-step contract, each step honest about what it can't know:
 *   - malformed input                 → throws ParseError
 *   - special-use (private, etc.)     → { kind: 'special', special: <label> }, no country
 *   - in the table                    → { kind: 'global', cc, country, flag, range }
 *   - a routable address not in table → { kind: 'global', cc: null }  (unknown, not a guess)
 *
 * @param {string} ipStr
 * @param {RangeTable} [table]  defaults to the built-in demo snapshot
 * @returns {object} the lookup result (see above)
 */
function lookup(ipStr, table = demoTable()) {
  const ip = parseIP(ipStr);                       // throws on bad input
  const canonical = formatIP(ip.value, ip.version);
  const base = { input: ipStr, canonical, version: ip.version };

  const special = classifySpecial(ip);
  if (special) return { ...base, kind: 'special', special, cc: null, country: null, flag: null, range: null };

  const hit = table.find(ip.mapped);
  if (!hit) return { ...base, kind: 'global', cc: null, country: null, flag: null, range: null };

  const cc = hit.cc;
  return {
    ...base,
    kind: 'global',
    cc,
    country: countryName(cc),
    flag: flagEmoji(cc),
    range: { start: formatIP(ip.version === 4 ? (hit.start & V4_MAX) : hit.start, ip.version),
             end: formatIP(ip.version === 4 ? (hit.end & V4_MAX) : hit.end, ip.version) },
  };
}

/* ------------------------------------------------------------------ *
 * Exports (CommonJS for Node; attached to window for the browser)
 * ------------------------------------------------------------------ */

const API = {
  ParseError, RangeTableError,
  parseIPv4, parseIPv6, parseIP, formatIP, cidrToRange,
  classifySpecial, RangeTable, parseRirDelegated,
  countryName, flagEmoji, demoTable, lookup,
  DEMO_DELEGATED,
  V4_MAX, V6_MAX, V4_MAPPED_PREFIX,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.GeoIP = API;
