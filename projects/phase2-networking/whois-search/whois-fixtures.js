/*
 * whois-fixtures.js — bundled, real-shaped WHOIS response snapshots.
 *
 * These are illustrative snapshots in the exact text format real servers emit,
 * keyed by WHOIS server. They exist so the browser demo (which cannot open a
 * TCP/43 socket) and the offline tests can run the REAL engine end to end:
 * plan -> query -> parse -> follow referral -> merge. They are a demo dataset,
 * not a live feed — the same engine, pointed at real sockets via whois-node.js,
 * answers against the live registries with no code change.
 *
 * The map is { server: { query: responseText } }. A server with a single
 * '*' query answers any query with that text (used for the IANA root referrals
 * and registrars that don't care how they're addressed).
 */

'use strict';

const FIXTURES = {
  // --- Thin TLD: .com registry answers only registrar + referral pointer. ---
  'whois.verisign-grs.com': {
    'domain example.com': [
      '   Domain Name: EXAMPLE.COM',
      '   Registry Domain ID: 2336799_DOMAIN_COM-VRSN',
      '   Registrar WHOIS Server: whois.iana-reserved.example',
      '   Registrar URL: http://res-dom.iana.org',
      '   Updated Date: 2024-08-14T07:01:44Z',
      '   Creation Date: 1995-08-14T04:00:00Z',
      '   Registry Expiry Date: 2025-08-13T04:00:00Z',
      '   Registrar: RESERVED-Internet Assigned Numbers Authority',
      '   Registrar IANA ID: 376',
      '   Domain Status: clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited',
      '   Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited',
      '   Domain Status: clientUpdateProhibited https://icann.org/epp#clientUpdateProhibited',
      '   Name Server: A.IANA-SERVERS.NET',
      '   Name Server: B.IANA-SERVERS.NET',
      '   DNSSEC: signedDelegation',
      '>>> Last update of whois database: 2024-10-01T12:00:00Z <<<',
      '',
      'For more information on Whois status codes, please visit https://icann.org/epp',
      '',
      'NOTICE: The expiration date displayed in this record is the date the ...',
      'TERMS OF USE: You are not authorized to access or query our Whois ...',
    ].join('\n'),
    'domain google.com': [
      '   Domain Name: GOOGLE.COM',
      '   Registrar WHOIS Server: whois.markmonitor.com',
      '   Registrar URL: http://www.markmonitor.com',
      '   Updated Date: 2019-09-09T15:39:04Z',
      '   Creation Date: 1997-09-15T04:00:00Z',
      '   Registry Expiry Date: 2028-09-14T04:00:00Z',
      '   Registrar: MarkMonitor Inc.',
      '   Registrar IANA ID: 292',
      '   Domain Status: clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited',
      '   Domain Status: serverUpdateProhibited https://icann.org/epp#serverUpdateProhibited',
      '   Name Server: NS1.GOOGLE.COM',
      '   Name Server: NS2.GOOGLE.COM',
      '   DNSSEC: unsigned',
      '>>> Last update of whois database: 2024-10-01T12:00:00Z <<<',
    ].join('\n'),
    'domain doesnotexist-zzzz.com': [
      'No match for "DOESNOTEXIST-ZZZZ.COM".',
      '>>> Last update of whois database: 2024-10-01T12:00:00Z <<<',
    ].join('\n'),
  },

  // The registrar that google.com's thin record refers us to (the real data).
  'whois.markmonitor.com': {
    '*': [
      'Domain Name: google.com',
      'Registry Domain ID: 2138514_DOMAIN_COM-VRSN',
      'Registrar WHOIS Server: whois.markmonitor.com',
      'Registrar URL: http://www.markmonitor.com',
      'Updated Date: 2019-09-09T08:39:04-0700',
      'Creation Date: 1997-09-15T00:00:00-0700',
      'Registrar Registration Expiration Date: 2028-09-13T21:00:00-0700',
      'Registrar: MarkMonitor, Inc.',
      'Registrar IANA ID: 292',
      'Registrant Organization: Google LLC',
      'Registrant State/Province: CA',
      'Registrant Country: US',
      'Admin Organization: Google LLC',
      'Name Server: ns1.google.com',
      'Name Server: ns2.google.com',
      'Name Server: ns3.google.com',
      'Name Server: ns4.google.com',
      'DNSSEC: unsigned',
      'Domain Status: clientUpdateProhibited (https://www.icann.org/epp#clientUpdateProhibited)',
      'URL of the ICANN WHOIS Data Problem Reporting System: http://wdprs.internic.net/',
    ].join('\n'),
  },

  // --- Thick TLD: .org answers the whole record in one shot, GDPR-redacted. ---
  'whois.pir.org': {
    'example.org': [
      'Domain Name: EXAMPLE.ORG',
      'Registry Domain ID: d2341a3b8c-LROR',
      'Registrar WHOIS Server: whois.example-registrar.org',
      'Updated Date: 2024-06-11T00:12:17Z',
      'Creation Date: 1995-08-31T04:00:00Z',
      'Registry Expiry Date: 2025-08-30T04:00:00Z',
      'Registrar: Example Registrar, LLC',
      'Registrar IANA ID: 9999',
      'Domain Status: serverDeleteProhibited https://icann.org/epp#serverDeleteProhibited',
      'Domain Status: serverTransferProhibited https://icann.org/epp#serverTransferProhibited',
      'Domain Status: serverUpdateProhibited https://icann.org/epp#serverUpdateProhibited',
      'Registrant Organization: REDACTED FOR PRIVACY',
      'Registrant State/Province: CA',
      'Registrant Country: US',
      'Name Server: A.IANA-SERVERS.NET',
      'Name Server: B.IANA-SERVERS.NET',
      'DNSSEC: signedDelegation',
      '>>> Last update of WHOIS database: 2024-10-01T12:00:00Z <<<',
    ].join('\n'),
  },

  // --- ccTLD with its own date grammar (dd-Mon-yyyy) and field names. ---
  'whois.nic.uk': {
    'example.co.uk': [
      '    Domain name:',
      '        example.co.uk',
      '',
      '    Registrar:',
      '        Example Internet Ltd [Tag = EXAMPLE]',
      '',
      '    Relevant dates:',
      '        Registered on: 05-Dec-1996',
      '        Expiry date:  05-Dec-2025',
      '        Last updated:  04-Nov-2023',
      '',
      '    Registration status:',
      '        Registered until expiry date.',
      '',
      '    Name servers:',
      '        ns1.example-dns.co.uk',
      '        ns2.example-dns.co.uk',
    ].join('\n'),
  },

  // --- IANA root: refers IP queries to the right RIR. ---
  'whois.iana.org': {
    '8.8.8.8': [
      '% IANA WHOIS server',
      '% for more information on IANA, visit http://www.iana.org',
      '',
      'refer:        whois.arin.net',
      '',
      'inetnum:      8.0.0.0 - 8.255.255.255',
      'organisation: Administered by ARIN',
      'status:       LEGACY',
      '',
      'whois:        whois.arin.net',
      'source:       IANA',
    ].join('\n'),
    '*': [
      '% IANA WHOIS server',
      'refer:        whois.arin.net',
      'source:       IANA',
    ].join('\n'),
  },

  // --- ARIN (an RIR): % comments, inetnum-style fields. ---
  'whois.arin.net': {
    '*': [
      '#',
      '# ARIN WHOIS data and services are subject to the Terms of Use',
      '#',
      '',
      'NetRange:       8.8.8.0 - 8.8.8.255',
      'CIDR:           8.8.8.0/24',
      'NetName:        GOGL',
      'Organization:   Google LLC (GOGL)',
      'RegDate:        2023-12-28',
      'Updated:        2023-12-28',
      'Country:        US',
      'Ref:            https://rdap.arin.net/registry/ip/8.8.8.0',
      '',
      '# end',
    ].join('\n'),
  },
};

/**
 * A resolver backed by the fixtures above. Signature matches what lookup()
 * wants: (server, query) -> text. Throws for a server with no snapshot, which
 * is exactly how a real "this TLD isn't reachable" would surface.
 */
function fixtureResolver(server, query) {
  const byQuery = FIXTURES[server];
  if (!byQuery) throw new Error(`no bundled snapshot for server ${server}`);
  if (query in byQuery) return byQuery[query];
  if ('*' in byQuery) return byQuery['*'];
  throw new Error(`no bundled snapshot for query "${query}" on ${server}`);
}

const api = { FIXTURES, fixtureResolver };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.WhoisFixtures = api;
