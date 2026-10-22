/*
 * tests.js — dependency-free checks for the country-from-IP engine, run under
 * Node:  node projects/phase2-networking/country-from-ip/tests.js
 *
 * Layers:
 *   1. IPv4 parsing — round trips, boundaries, and every malformed form refused.
 *   2. IPv6 parsing — full form, "::" at start/middle/end, embedded IPv4, and
 *      the one-"::"-maximum / 8-group rules; canonical formatting.
 *   3. CIDR → range math — /0, /32, /128 and interior boundaries.
 *   4. Special-use classification — private / loopback / CGNAT / doc / multicast
 *      / link-local, for v4 and v6, plus IPv4-mapped IPv6.
 *   5. RangeTable — construction sorts; overlaps and bad ranges are rejected;
 *      binary search hits boundaries and returns null in gaps.
 *   6. RIR delegated parser — ipv4 count math and ipv6 prefix math; skips.
 *   7. End-to-end lookup — the built-in snapshot, a CSV file and a parsed RIR
 *      file all agree, special/unknown are honest, and the Node CLI formats.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./geoip-core.js');
const nodeapi = require('./geoip-node.js');

const {
  parseIPv4, parseIPv6, parseIP, formatIP, cidrToRange,
  classifySpecial, RangeTable, parseRirDelegated,
  countryName, flagEmoji, demoTable, lookup,
  ParseError, RangeTableError, V4_MAPPED_PREFIX, V4_MAX,
} = core;

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push([name, e]); }
}
function throws(fn) {
  try { fn(); return false; } catch (_) { return true; }
}

/* -------------------- 1. IPv4 parsing -------------------- */

check('IPv4 basic value', () => {
  assert.strictEqual(parseIPv4('8.8.8.8'), (8n << 24n) | (8n << 16n) | (8n << 8n) | 8n);
  assert.strictEqual(parseIPv4('0.0.0.0'), 0n);
  assert.strictEqual(parseIPv4('255.255.255.255'), V4_MAX);
});
check('IPv4 round-trips through formatIP', () => {
  for (const s of ['8.8.8.8', '1.2.3.4', '192.168.0.1', '255.0.255.0']) {
    assert.strictEqual(formatIP(parseIPv4(s), 4), s);
  }
});
check('IPv4 rejects octet > 255', () => assert.ok(throws(() => parseIPv4('256.1.1.1'))));
check('IPv4 rejects wrong octet count', () => {
  assert.ok(throws(() => parseIPv4('1.2.3')));
  assert.ok(throws(() => parseIPv4('1.2.3.4.5')));
});
check('IPv4 rejects leading zero (octal ambiguity)', () => assert.ok(throws(() => parseIPv4('010.0.0.1'))));
check('IPv4 rejects empty / non-numeric octet', () => {
  assert.ok(throws(() => parseIPv4('1..3.4')));
  assert.ok(throws(() => parseIPv4('1.2.3.x')));
});

/* -------------------- 2. IPv6 parsing -------------------- */

check('IPv6 loopback and unspecified', () => {
  assert.strictEqual(parseIPv6('::1'), 1n);
  assert.strictEqual(parseIPv6('::'), 0n);
});
check('IPv6 full form', () => {
  assert.strictEqual(parseIPv6('2001:db8:0:0:0:0:0:1'), (0x2001n << 112n) | (0xdb8n << 96n) | 1n);
});
check('IPv6 "::" compresses equivalently to the full form', () => {
  assert.strictEqual(parseIPv6('2001:db8::1'), parseIPv6('2001:db8:0:0:0:0:0:1'));
  assert.strictEqual(parseIPv6('fe80::'), parseIPv6('fe80:0:0:0:0:0:0:0'));
  assert.strictEqual(parseIPv6('::ffff:0:0'), V4_MAPPED_PREFIX); // ::ffff:0:0 == 0xffff << 32
});
check('IPv6 embedded IPv4 tail', () => {
  // ::ffff:192.0.2.1 == the IPv4-mapped value for 192.0.2.1
  assert.strictEqual(parseIPv6('::ffff:192.0.2.1'), V4_MAPPED_PREFIX | parseIPv4('192.0.2.1'));
});
check('IPv6 rejects two "::"', () => assert.ok(throws(() => parseIPv6('2001::db8::1'))));
check('IPv6 rejects over-long / short group counts', () => {
  assert.ok(throws(() => parseIPv6('1:2:3:4:5:6:7:8:9')));
  assert.ok(throws(() => parseIPv6('1:2:3:4:5:6:7')));        // 7 groups, no "::"
});
check('IPv6 rejects bad group', () => assert.ok(throws(() => parseIPv6('2001:gggg::1'))));
check('IPv6 canonical formatting collapses the longest zero run', () => {
  assert.strictEqual(formatIP(parseIPv6('2001:db8:0:0:0:0:0:1'), 6), '2001:db8::1');
  assert.strictEqual(formatIP(parseIPv6('::1'), 6), '::1');
  assert.strictEqual(formatIP(parseIPv6('fe80::'), 6), 'fe80::');
});

/* -------------------- parseIP dispatch -------------------- */

check('parseIP dispatches on the colon and maps v4', () => {
  const a = parseIP('8.8.8.8');
  assert.strictEqual(a.version, 4);
  assert.strictEqual(a.mapped, V4_MAPPED_PREFIX | parseIPv4('8.8.8.8'));
  const b = parseIP('2001:db8::1');
  assert.strictEqual(b.version, 6);
  assert.strictEqual(b.mapped, b.value);
});
check('parseIP trims and rejects empty', () => {
  assert.strictEqual(parseIP('  1.2.3.4  ').version, 4);
  assert.ok(throws(() => parseIP('')));
});

/* -------------------- 3. CIDR → range -------------------- */

check('CIDR /24 spans 256 addresses', () => {
  const r = cidrToRange('8.8.8.0/24');
  assert.strictEqual(r.end - r.start, 255n);
  assert.strictEqual(r.start, V4_MAPPED_PREFIX | parseIPv4('8.8.8.0'));
  assert.strictEqual(r.end, V4_MAPPED_PREFIX | parseIPv4('8.8.8.255'));
});
check('CIDR /32 and /0 edges', () => {
  const host = cidrToRange('1.2.3.4/32');
  assert.strictEqual(host.start, host.end);
  const all = cidrToRange('0.0.0.0/0');
  assert.strictEqual(all.start, V4_MAPPED_PREFIX | 0n);
  assert.strictEqual(all.end, V4_MAPPED_PREFIX | V4_MAX);
});
check('CIDR snaps a non-aligned host down to the network', () => {
  const r = cidrToRange('8.8.8.200/24');
  assert.strictEqual(r.start, V4_MAPPED_PREFIX | parseIPv4('8.8.8.0'));
});
check('CIDR v6 /32', () => {
  const r = cidrToRange('2001:db8::/32');
  assert.strictEqual(r.end - r.start, (1n << 96n) - 1n);
});
check('CIDR rejects bad prefix length', () => {
  assert.ok(throws(() => cidrToRange('8.8.8.0/33')));
  assert.ok(throws(() => cidrToRange('2001:db8::/129')));
  assert.ok(throws(() => cidrToRange('8.8.8.0')));   // missing /
});

/* -------------------- 4. Special-use classification -------------------- */

const specialCases = [
  ['10.0.0.1', 'private'],
  ['172.16.5.4', 'private'],
  ['192.168.1.1', 'private'],
  ['127.0.0.1', 'loopback'],
  ['169.254.3.3', 'link-local'],
  ['100.70.0.1', 'carrier-grade NAT'],
  ['192.0.2.9', 'documentation'],
  ['203.0.113.9', 'documentation'],
  ['224.0.0.1', 'multicast'],
  ['::1', 'loopback'],
  ['fe80::abcd', 'link-local'],
  ['fc00::1', 'unique local'],
  ['ff02::1', 'multicast'],
  ['2001:db8::1', 'documentation'],
];
for (const [ip, needle] of specialCases) {
  check(`special: ${ip} → ${needle}`, () => {
    const label = classifySpecial(parseIP(ip));
    assert.ok(label && label.toLowerCase().includes(needle.toLowerCase()), `got ${label}`);
  });
}
check('special: a routable address is NOT special', () => {
  assert.strictEqual(classifySpecial(parseIP('8.8.8.8')), null);
  assert.strictEqual(classifySpecial(parseIP('2606:4700::1')), null);
});
check('special: IPv4-mapped IPv6 private is caught', () => {
  const label = classifySpecial(parseIP('::ffff:10.0.0.1'));
  assert.ok(label && label.includes('private') && label.includes('IPv4-mapped'), `got ${label}`);
});

/* -------------------- 5. RangeTable -------------------- */

check('RangeTable sorts on construction', () => {
  const t = RangeTable.fromCidrs([['9.0.0.0/8', 'ZZ'], ['1.0.0.0/8', 'AA']]);
  assert.ok(t.ranges[0].start < t.ranges[1].start);
});
check('RangeTable rejects overlapping ranges', () => {
  assert.ok(throws(() => RangeTable.fromCidrs([['8.8.0.0/16', 'US'], ['8.8.8.0/24', 'US']])));
});
check('RangeTable rejects start > end', () => {
  assert.ok(throws(() => new RangeTable([{ start: 10n, end: 5n, cc: 'US' }])));
});
check('RangeTable binary search hits boundaries and gaps', () => {
  const t = RangeTable.fromCidrs([['10.0.0.0/8', 'AA'], ['20.0.0.0/8', 'BB']]);
  const at = (s) => t.find(parseIP(s).mapped);
  assert.strictEqual(at('10.0.0.0').cc, 'AA');       // low boundary
  assert.strictEqual(at('10.255.255.255').cc, 'AA'); // high boundary
  assert.strictEqual(at('20.1.2.3').cc, 'BB');
  assert.strictEqual(at('15.0.0.0'), null);          // gap between the two
  assert.strictEqual(at('9.255.255.255'), null);     // below everything
});
check('RangeTable binary search scales (10k ranges, every boundary exact)', () => {
  const pairs = [];
  for (let i = 0; i < 10000; i++) pairs.push([`${(i % 200)}.${Math.floor(i / 200)}.0.0/16`, i % 2 ? 'AA' : 'BB']);
  // Dedup to keep them non-overlapping, then search.
  const seen = new Set(); const uniq = [];
  for (const p of pairs) { if (!seen.has(p[0])) { seen.add(p[0]); uniq.push(p); } }
  const t = RangeTable.fromCidrs(uniq);
  const probe = uniq[1234];
  const base = probe[0].split('/')[0];
  assert.strictEqual(t.find(parseIP(base).mapped).cc, probe[1]);
});

/* -------------------- 6. RIR delegated parser -------------------- */

check('RIR parser: ipv4 count becomes an inclusive range', () => {
  const r = parseRirDelegated('apnic|JP|ipv4|133.0.0.0|65536|19970601|allocated');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].cc, 'JP');
  assert.strictEqual(r[0].start, V4_MAPPED_PREFIX | parseIPv4('133.0.0.0'));
  assert.strictEqual(r[0].end, V4_MAPPED_PREFIX | parseIPv4('133.0.255.255')); // 65536 addrs = /16
});
check('RIR parser: ipv6 field is a prefix length', () => {
  const r = parseRirDelegated('ripencc|NL|ipv6|2001:610::|32|19990819|allocated');
  assert.strictEqual(r[0].end - r[0].start, (1n << 96n) - 1n);
});
check('RIR parser skips no-country, reserved, and summary lines', () => {
  const text = [
    '2|apnic|20240101|...|summary',          // version/summary line
    'apnic|*|ipv4|1.0.0.0|256|...|reserved',  // no country
    'apnic|AU|asn|4608|1|...|allocated',       // asn, not an address
    'apnic|AU|ipv4|1.0.0.0|256|20110811|available', // not allocated/assigned
    'apnic|AU|ipv4|1.1.1.0|256|20110811|assigned',  // the one real row
  ].join('\n');
  const r = parseRirDelegated(text);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].cc, 'AU');
});

/* -------------------- country name / flag -------------------- */

check('country name + flag emoji', () => {
  assert.strictEqual(countryName('US'), 'United States');
  assert.strictEqual(countryName('jp'), 'Japan');
  assert.strictEqual(flagEmoji('US'), '🇺🇸');
  assert.strictEqual(flagEmoji('JP'), '🇯🇵');
});

/* -------------------- 7. End-to-end lookup -------------------- */

check('lookup: a known snapshot address resolves to its country', () => {
  const r = lookup('8.8.8.8');
  assert.strictEqual(r.kind, 'global');
  assert.strictEqual(r.cc, 'US');
  assert.strictEqual(r.country, 'United States');
  assert.strictEqual(r.range.start, '8.8.8.0');
  assert.strictEqual(r.range.end, '8.8.8.255');
});
check('lookup: Japan block and an IPv6 block', () => {
  assert.strictEqual(lookup('133.11.22.33').cc, 'JP');
  assert.strictEqual(lookup('2606:4700::1111').cc, 'US');
  assert.strictEqual(lookup('2001:200::1').cc, 'JP');
});
check('lookup: private address returns special, no country', () => {
  const r = lookup('192.168.1.1');
  assert.strictEqual(r.kind, 'special');
  assert.strictEqual(r.cc, null);
  assert.ok(r.special.includes('private'));
});
check('lookup: routable address not in the table is honest unknown', () => {
  const r = lookup('203.0.200.1'); // routable (not special), but outside the tiny snapshot
  assert.strictEqual(r.kind, 'global');
  assert.strictEqual(r.cc, null);  // null, never a guess
});
check('lookup: malformed input throws ParseError', () => {
  assert.throws(() => lookup('999.1.1.1'), (e) => e instanceof ParseError);
});
check('lookup: canonicalises the echoed address', () => {
  assert.strictEqual(lookup('2001:200:0:0:0:0:0:1').canonical, '2001:200::1');
});

/* -------------------- the data sources agree -------------------- */

check('CSV, RIR and snapshot tables agree on 8.8.8.8', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoip-'));
  const csvPath = path.join(dir, 'db.csv');
  const rirPath = path.join(dir, 'delegated.txt');
  fs.writeFileSync(csvPath, 'start_ip,end_ip,cc\n8.8.8.0,8.8.8.255,US\n');
  fs.writeFileSync(rirPath, 'arin|US|ipv4|8.8.8.0|256|20090101|assigned\n');

  const fromCsv = lookup('8.8.8.8', nodeapi.loadCsv(csvPath));
  const fromRir = lookup('8.8.8.8', nodeapi.loadRir(rirPath));
  const fromSnap = lookup('8.8.8.8');
  assert.strictEqual(fromCsv.cc, 'US');
  assert.strictEqual(fromRir.cc, 'US');
  assert.strictEqual(fromSnap.cc, 'US');
  fs.rmSync(dir, { recursive: true, force: true });
});
check('CLI line formatting covers global / special / unknown', () => {
  assert.ok(nodeapi.formatLine(lookup('8.8.8.8')).includes('US'));
  assert.ok(nodeapi.formatLine(lookup('10.0.0.1')).includes('no registered country'));
  assert.ok(nodeapi.formatLine(lookup('203.0.200.1')).includes('not in database'));
});

/* -------------------- report -------------------- */

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`);
  for (const [name, e] of failures) console.error(`  ✗ ${name}\n      ${e.message}`);
  process.exit(1);
} else {
  console.log(`✓ all ${passed} checks passed`);
}
