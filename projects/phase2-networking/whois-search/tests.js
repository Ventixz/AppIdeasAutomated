#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the WHOIS engine. Run: node tests.js
 */

'use strict';

const core = require('./whois-core');
const { fixtureResolver } = require('./whois-fixtures');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throws(fn, msg) { try { fn(); fail++; console.error('  FAIL (no throw):', msg); } catch (_) { pass++; } }
function section(name) { console.log(`\n# ${name}`); }

/* ---- 1. Target classification ---- */
section('target classification');
eq(core.classifyTarget('Example.COM').kind, 'domain', 'domain kind');
eq(core.classifyTarget('example.com').tld, 'com', 'tld extracted');
eq(core.classifyTarget('  http://user:pw@WWW.Example.co.uk:8080/path?x#y  ').value, 'www.example.co.uk', 'url stripped to host, lowercased');
eq(core.classifyTarget('example.com.').value, 'example.com', 'trailing root dot dropped');
eq(core.classifyTarget('8.8.8.8').kind, 'ipv4', 'ipv4 kind');
eq(core.classifyTarget('2001:4860:4860::8888').kind, 'ipv6', 'ipv6 kind');
eq(core.classifyTarget('[2606:4700::1111]:443').kind, 'ipv6', 'bracketed v6 with port');
throws(() => core.classifyTarget('localhost'), 'single label rejected');
throws(() => core.classifyTarget(''), 'empty rejected');
throws(() => core.classifyTarget('münchen.de'), 'non-ASCII label rejected (needs punycode)');
eq(core.classifyTarget('xn--mnchen-3ya.de').kind, 'domain', 'punycode label accepted');

/* ---- 2. IP validators ---- */
section('ip validators');
ok(core.isIPv4('0.0.0.0') && core.isIPv4('255.255.255.255'), 'ipv4 boundaries');
ok(!core.isIPv4('256.1.1.1'), 'ipv4 octet > 255 rejected');
ok(!core.isIPv4('010.0.0.1'), 'ipv4 leading zero rejected (no octal)');
ok(!core.isIPv4('1.2.3'), 'ipv4 wrong octet count rejected');
ok(core.isIPv6('::1') && core.isIPv6('fe80::1') && core.isIPv6('2001:db8::8a2e:370:7334'), 'ipv6 compressed forms');
ok(core.isIPv6('::ffff:192.0.2.1'), 'ipv6 with embedded v4 tail');
ok(!core.isIPv6('2001::db8::1'), 'two "::" rejected');
ok(!core.isIPv6('1:2:3:4:5:6:7:8:9'), 'too many groups rejected');

/* ---- 3. Query planning + server selection ---- */
section('query planning');
eq(core.planQuery('example.com').server, 'whois.verisign-grs.com', '.com -> verisign');
eq(core.planQuery('example.com').thin, true, '.com is thin');
eq(core.planQuery('example.org').server, 'whois.pir.org', '.org -> pir');
eq(core.planQuery('example.org').thin, false, '.org is thick');
eq(core.planQuery('whatever.zzunknown').server, core.IANA_SERVER, 'unknown tld -> IANA fallback');
eq(core.planQuery('8.8.8.8').server, core.IANA_SERVER, 'IP -> IANA root');
eq(core.planQuery('example.com').query, 'domain example.com', 'verisign needs "domain " prefix');
eq(core.formatQuery('whois.denic.de', 'example.de'), '-T dn example.de', 'denic query flag');
eq(core.formatQuery('whois.ripe.net', '193.0.0.1'), '-B 193.0.0.1', 'ripe -B flag');
eq(core.formatQuery('whois.nic.io', 'x.io'), 'x.io', 'default query is bare target');

/* ---- 4. Date parsing (four grammars + validation) ---- */
section('date parsing');
eq(core.parseWhoisDate('2023-08-14T04:00:00Z'), '2023-08-14T04:00:00.000Z', 'ISO with time');
eq(core.parseWhoisDate('2023-08-14'), '2023-08-14T00:00:00.000Z', 'ISO date only');
eq(core.parseWhoisDate('05-Dec-1996'), '1996-12-05T00:00:00.000Z', 'dd-Mon-yyyy');
eq(core.parseWhoisDate('2023.08.14'), '2023-08-14T00:00:00.000Z', 'yyyy.mm.dd');
eq(core.parseWhoisDate('14-Aug-2023 09:30:00'), '2023-08-14T09:30:00.000Z', 'dd-Mon-yyyy with time');
eq(core.parseWhoisDate('2023-13-40'), null, 'impossible date rejected, not rolled over');
eq(core.parseWhoisDate('sometime last year'), null, 'free text -> null');
eq(core.parseWhoisDate(''), null, 'empty -> null');

/* ---- 5. EPP status codes ---- */
section('status codes');
eq(core.statusCode('clientTransferProhibited https://icann.org/epp#x'), 'clientTransferProhibited', 'URL stripped from status');
ok(/registry/i.test(core.explainStatus('serverHold')), 'serverHold explained');
ok(/restore|deleted/i.test(core.explainStatus('redemptionPeriod')), 'redemptionPeriod explained');
ok(/grace/i.test(core.explainStatus('addPeriod')), 'addPeriod explained as a grace period');
eq(core.explainStatus('nonsenseStatus'), null, 'unknown status -> null');

/* ---- 6. Parsing a single response ---- */
section('response parsing');
const comText = require('./whois-fixtures').FIXTURES['whois.verisign-grs.com']['domain example.com'];
const rec = core.parseWhois(comText);
eq(rec.domainName, 'EXAMPLE.COM', 'domain name parsed');
eq(rec.registrar, 'RESERVED-Internet Assigned Numbers Authority', 'registrar parsed');
eq(rec.dates.created, '1995-08-14T04:00:00.000Z', 'creation date parsed to ISO');
eq(rec.nameServers.length, 2, 'two name servers collected');
ok(rec.nameServers.includes('a.iana-servers.net'), 'name server lowercased');
eq(rec.statuses.length, 3, 'three statuses collected (dedup-safe)');
ok(rec.statuses.includes('clientTransferProhibited'), 'status code captured without its URL');
ok(!/terms of use/i.test(JSON.stringify(rec.fields)), 'boilerplate not captured as a field');
eq(rec.referral, 'whois.iana-reserved.example', 'registrar whois server taken as referral');

section('not-found + redaction detection');
const nf = core.parseWhois(require('./whois-fixtures').FIXTURES['whois.verisign-grs.com']['domain doesnotexist-zzzz.com']);
ok(nf.notFound, '"No match" flagged as notFound');
const orgRec = core.parseWhois(require('./whois-fixtures').FIXTURES['whois.pir.org']['example.org']);
ok(orgRec.redacted, 'REDACTED FOR PRIVACY flagged');

/* ---- 7. End-to-end lookup via the injected resolver ---- */
section('end-to-end lookup (thin -> registrar referral)');
(async () => {
  const g = await core.lookup('google.com', fixtureResolver);
  eq(g.chain.map((h) => h.server), ['whois.verisign-grs.com', 'whois.markmonitor.com'], 'thin lookup makes two hops');
  eq(g.thin, true, 'google.com flagged thin');
  eq(g.record.registrar, 'MarkMonitor Inc.', 'registry registrar used (first non-empty wins)');
  eq(g.record.registrant, 'Google LLC', 'registrant org came from the registrar hop');
  eq(g.record.provenance.registrant, 'whois.markmonitor.com', 'provenance records the referral hop');
  ok(g.record.nameServers.length >= 4, 'name servers unioned across both hops');

  const e = await core.lookup('example.com', fixtureResolver);
  eq(e.chain.length, 1, 'example.com referral points to an unreachable server -> stops after one hop gracefully');
  // (The referral host has no fixture; lookup must not have thrown — it just
  //  didn't make a second hop because the referral target was never resolved.)

  const org = await core.lookup('example.org', fixtureResolver);
  eq(org.thin, false, 'example.org thick');
  ok(org.record.redacted, 'thick record redaction surfaced');
  eq(org.record.dates.created, '1995-08-31T04:00:00.000Z', 'thick created date');

  const uk = await core.lookup('example.co.uk', fixtureResolver);
  eq(uk.record.dates.created, '1996-12-05T00:00:00.000Z', 'ccTLD dd-Mon-yyyy date parsed');
  eq(uk.record.dates.expiry, '2025-12-05T00:00:00.000Z', 'ccTLD expiry parsed');
  ok(uk.record.nameServers.includes('ns1.example-dns.co.uk'), 'ccTLD indented name servers collected');

  section('end-to-end lookup (IP -> IANA refer -> RIR)');
  const ip = await core.lookup('8.8.8.8', fixtureResolver);
  eq(ip.chain.map((h) => h.server), ['whois.iana.org', 'whois.arin.net'], 'IP follows IANA refer: to ARIN');
  eq(ip.record.cidr, '8.8.8.0/24', 'RIR CIDR parsed');
  eq(ip.record.organization, 'Google LLC (GOGL)', 'RIR org parsed (prefers IANA then ARIN first non-empty)');
  eq(ip.record.netRange, '8.8.8.0 - 8.8.8.255', 'RIR NetRange parsed');

  section('referral loop + hop cap safety');
  let calls = 0;
  const loopResolver = () => { calls++; return 'Refer: whois.loop.test\nDomain Name: X'; };
  const looped = await core.lookup('loop.org', loopResolver, { maxHops: 5 });
  ok(calls <= 2, `self-referral does not loop forever (made ${calls} calls)`);
  ok(looped.chain.length <= 2, 'hop chain bounded when a server refers to itself');

  console.log(`\n${fail === 0 ? 'OK' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
