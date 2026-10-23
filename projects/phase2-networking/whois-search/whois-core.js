/*
 * whois-core.js — the WHOIS engine, DOM-free and dependency-free.
 *
 * A "Whois Search Tool" (karan/Projects, Networking category) has three honest
 * problems hiding inside one sentence, and this file refuses to cheat on any:
 *
 *   1. Figure out WHAT is being asked and WHERE to ask it. A WHOIS query is not
 *      one thing: a domain goes to its TLD's registry, an IP goes to a Regional
 *      Internet Registry, and you cannot know the server without first knowing
 *      the kind of target and its TLD. planQuery() does that dispatch.
 *
 *   2. Follow the referral. The ".com"/".net" registries are THIN — they hold
 *      only the sponsoring registrar and a pointer to *its* WHOIS server; the
 *      real record lives there. A correct client makes the second hop. Thick
 *      registries (.org and most others) answer in one shot. lookup() owns the
 *      chain and never pretends a thin answer is the whole story.
 *
 *   3. Parse free-form text that every registry formats differently. WHOIS
 *      responses (RFC 3912 just says "send a query, read text until close") are
 *      key/value prose with dozens of field-name spellings, four date grammars,
 *      EPP status codes glued to URLs, GDPR redaction, and pages of legal
 *      boilerplate. parseWhois() normalises all of that into one record.
 *
 * The network itself is injected as a `resolver(server, query) -> text` so this
 * engine stays free of sockets and the DOM: Node feeds it real TCP/43, the
 * browser feeds it bundled snapshots, the tests feed it fakes — same code path.
 */

'use strict';

class ParseError extends Error {
  constructor(message) { super(message); this.name = 'ParseError'; }
}

/* ------------------------------------------------------------------ *
 * 1. Classify the target: domain vs IPv4 vs IPv6.
 * ------------------------------------------------------------------ */

// Strict IPv4: four octets 0-255, no leading zeros (so "010" is never octal).
function isIPv4(s) {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255);
}

// IPv6: accept the common forms (full, "::" compression, embedded v4 tail).
function isIPv6(s) {
  if (s.indexOf(':') === -1) return false;
  const dbl = s.split('::');
  if (dbl.length > 2) return false; // at most one "::"
  const head = dbl[0] ? dbl[0].split(':') : [];
  const tail = dbl.length === 2 && dbl[1] ? dbl[1].split(':') : [];
  const groups = [...head, ...tail];
  let count = groups.length;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.indexOf('.') !== -1) {
      // Embedded IPv4 is only allowed as the final group, and counts as two.
      if (i !== groups.length - 1 || !isIPv4(g)) return false;
      count += 1;
    } else if (!/^[0-9a-fA-F]{1,4}$/.test(g)) {
      return false;
    }
  }
  if (dbl.length === 2) return count <= 7; // "::" must stand for >=1 zero group
  return count === 8;
}

/**
 * Turn raw user input into a typed, normalised target.
 * Domains are lowercased and stripped of scheme/path/userinfo/port and any
 * trailing dot; IPs are validated. Returns { kind, value, tld?, labels? }.
 */
function classifyTarget(input) {
  if (typeof input !== 'string') throw new ParseError('target must be a string');
  let s = input.trim();
  if (!s) throw new ParseError('empty target');

  // Allow pasting a URL: drop scheme, userinfo, path/query/fragment, and port.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  s = s.replace(/^[^@/]*@/, '');          // user:pass@
  s = s.replace(/[/?#].*$/, '');          // path/query/fragment

  // A bracketed IPv6 literal, optionally with :port.
  const br = s.match(/^\[([^\]]+)\]/);
  if (br) {
    if (!isIPv6(br[1])) throw new ParseError(`not a valid IPv6 literal: ${br[1]}`);
    return { kind: 'ipv6', value: br[1].toLowerCase() };
  }

  if (isIPv4(s)) return { kind: 'ipv4', value: s };
  if (isIPv6(s)) return { kind: 'ipv6', value: s.toLowerCase() };

  // Otherwise it's a domain. Strip a single trailing :port (never from v6,
  // which is handled above) and a trailing dot (the DNS root).
  s = s.replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();

  if (!s) throw new ParseError('empty domain');
  const labels = s.split('.');
  if (labels.length < 2) {
    throw new ParseError(`"${s}" is not a registrable domain (need at least one dot)`);
  }
  for (const label of labels) {
    if (!/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(label) && !/^xn--/.test(label)) {
      // IDNs must already be punycode (xn--…): WHOIS speaks ASCII on the wire.
      if (/[^\x00-\x7f]/.test(label)) {
        throw new ParseError(
          `"${label}" is a non-ASCII (internationalised) label — convert it to punycode (xn--…) first`,
        );
      }
      throw new ParseError(`"${label}" is not a valid domain label`);
    }
  }
  return { kind: 'domain', value: s, labels, tld: labels[labels.length - 1] };
}

/* ------------------------------------------------------------------ *
 * 2. Decide which server to ask, and exactly what to send it.
 * ------------------------------------------------------------------ */

// The root. IANA's WHOIS answers for any TLD/IP with a `refer:`/`refer` line
// pointing at the authoritative server — so this is always a safe starting hop.
const IANA_SERVER = 'whois.iana.org';

// A small, real map of TLD -> registry WHOIS server. It is deliberately NOT
// exhaustive: anything missing falls back to IANA, which refers us onward, so
// coverage degrades gracefully instead of lying.
const TLD_SERVERS = {
  com: 'whois.verisign-grs.com',
  net: 'whois.verisign-grs.com',
  org: 'whois.pir.org',
  info: 'whois.afilias.net',
  io: 'whois.nic.io',
  dev: 'whois.nic.google',
  app: 'whois.nic.google',
  co: 'whois.nic.co',
  me: 'whois.nic.me',
  uk: 'whois.nic.uk',
  de: 'whois.denic.de',
  nl: 'whois.domain-registry.nl',
  ca: 'whois.cira.ca',
  au: 'whois.auda.org.au',
  jp: 'whois.jprs.jp',
  fr: 'whois.nic.fr',
  eu: 'whois.eu',
  ai: 'whois.nic.ai',
  xyz: 'whois.nic.xyz',
};

// Thin registries: the registry response only names the registrar + its WHOIS
// server; the full record must be fetched from that registrar. Everything else
// is thick (self-contained).
const THIN_TLDS = new Set(['com', 'net', 'jobs', 'cc', 'tv', 'bz']);

/**
 * Some servers need their query dressed up, or they return a disambiguation
 * list instead of a record. These are real quirks:
 *   - Verisign (.com/.net) wants `domain <name>` for an exact match + referral.
 *   - DENIC (.de) wants `-T dn <name>`.
 *   - RIPE wants `-B` to show the full object (otherwise some fields hide).
 * Everything else just gets the bare target.
 */
function formatQuery(server, target) {
  const host = server.toLowerCase();
  if (host.endsWith('verisign-grs.com')) return `domain ${target}`;
  if (host === 'whois.denic.de') return `-T dn ${target}`;
  if (host === 'whois.ripe.net') return `-B ${target}`;
  return target;
}

/**
 * Plan the first hop: { server, query, type, thin }.
 * Domains with an unknown TLD, and all IPs, start at IANA and get referred.
 */
function planQuery(target) {
  const t = typeof target === 'string' ? classifyTarget(target) : target;
  if (t.kind === 'domain') {
    const server = TLD_SERVERS[t.tld] || IANA_SERVER;
    return { server, query: formatQuery(server, t.value), type: 'domain', thin: THIN_TLDS.has(t.tld), target: t };
  }
  // IPs: start at IANA; its `refer:` line sends us to the right RIR.
  return { server: IANA_SERVER, query: t.value, type: 'ip', thin: false, target: t };
}

/* ------------------------------------------------------------------ *
 * 3. Parse the free-form response.
 * ------------------------------------------------------------------ */

// Canonical field <- the many spellings registries actually use (lowercased,
// non-alphanumerics folded to spaces, trimmed). Order matters only for aliases
// that otherwise collide; first match wins per line.
const FIELD_ALIASES = {
  domainName: ['domain name', 'domain', 'domainname'],
  registrar: ['registrar', 'sponsoring registrar', 'registrar name'],
  registrarWhoisServer: ['registrar whois server', 'whois server'],
  registrarUrl: ['registrar url', 'referral url'],
  registrarIanaId: ['registrar iana id'],
  createdDate: ['creation date', 'created', 'created on', 'created date', 'registered on', 'registration time', 'domain registration date'],
  updatedDate: ['updated date', 'last updated', 'last modified', 'changed', 'update date', 'last update'],
  expiryDate: ['registry expiry date', 'expiration date', 'expiry date', 'expires', 'expire date', 'expires on', 'paid-till', 'renewal date'],
  registrant: ['registrant name', 'registrant', 'registrant organization', 'registrant org', 'org', 'holder'],
  registrantCountry: ['registrant country', 'registrant country code', 'country'],
  dnssec: ['dnssec'],
  // IP / RIR objects:
  netRange: ['netrange', 'inetnum', 'inet6num'],
  netName: ['netname'],
  cidr: ['cidr', 'route', 'route6'],
  organization: ['organization', 'org-name', 'orgname', 'descr'],
  orgCountry: ['country'],
};

// Fields that legitimately repeat and should accumulate into a list.
const MULTI_FIELDS = {
  nameServers: ['name server', 'nserver', 'nameserver', 'name servers', 'ns'],
  statuses: ['domain status', 'status'],
};

// Referral pointers, by the many names registries give them.
const REFERRAL_KEYS = ['refer', 'referralserver', 'registrar whois server', 'whois'];

// A line is boilerplate/comment when it starts with % or # (RIPE/IANA style),
// is a >>> … <<< banner, or is obviously legalese rather than a field.
function isNoise(line) {
  const t = line.trim();
  if (!t) return true;
  if (t[0] === '%' || t[0] === '#') return true;
  if (/^>>>.*<<<$/.test(t)) return true;
  if (/^(terms of use|notice|the data|by submitting|for more information|please)/i.test(t)) return true;
  if (/^url of the icann/i.test(t)) return true;
  return false;
}

// The handful of strings registries use to mean "redacted for privacy/GDPR".
const REDACTED_RE = /redacted for privacy|data protected|gdpr masked|not disclosed|statutory masking|privacy protect|whois privacy|contact privacy/i;

/**
 * Parse one WHOIS date into an ISO 8601 string, or null if unrecognised.
 * Real registries use at least these grammars:
 *   2023-08-14T04:00:00Z        (ISO, verisign/ICANN)
 *   2023-08-14                  (date only)
 *   14-Aug-2023                 (nominet, some ccTLDs)
 *   2023.08.14                  (jprs/.jp)
 *   before Aug-2023 / Thu ...   (free text — give up, return null)
 */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseWhoisDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // ISO with optional time/zone.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (m) return toISO(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  // dd-Mon-yyyy (e.g. 14-Aug-2023), optional time.
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return toISO(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  // yyyy.mm.dd (jprs).
  m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (m) return toISO(+m[1], +m[2] - 1, +m[3], 0, 0, 0);
  return null;
}

function toISO(y, mo, d, h, mi, s) {
  // Validate the calendar fields so "2023-13-40" is rejected, not silently
  // rolled over by Date().
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(Date.UTC(y, mo, d, h, mi, s));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;
  return dt.toISOString();
}

// Split "clientTransferProhibited https://icann.org/epp#..." into just the code.
function statusCode(value) {
  return String(value).trim().split(/\s+/)[0];
}

/**
 * Normalise a raw WHOIS response into a structured record.
 * Returns { domainName, registrar, …, nameServers[], statuses[], referral,
 *           redacted, dates{…}, raw, fields{canonical->value}, _lines }.
 */
function parseWhois(text, opts = {}) {
  if (typeof text !== 'string') throw new ParseError('response must be a string');
  const rec = {
    nameServers: [],
    statuses: [],
    referral: null,
    redacted: false,
    notFound: false,
    fields: {},
  };

  // "No match"/"not found" is a real, meaningful answer — flag it, don't crash.
  if (/\b(no match|not found|no entries found|no data found|no object found|status:\s*available)\b/i.test(text)) {
    rec.notFound = true;
  }
  if (REDACTED_RE.test(text)) rec.redacted = true;

  // Build a reverse lookup from every alias -> canonical field name once.
  const aliasToField = buildAliasIndex();

  // Some ccTLDs (notably Nominet/.uk) use an indented block layout: a bare
  // "Name servers:" header followed by value-only lines. Track the current
  // section so those orphan values find their field. A blank line ends it.
  let section = null;
  const SECTION_HEADERS = { 'name servers': 'nameServers', 'name server': 'nameServers', 'domain name': 'domainName', 'relevant dates': null };

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) { section = null; continue; }
    if (isNoise(rawLine)) continue;
    const idx = rawLine.indexOf(':');

    // Value-only line (no colon): attach it to the active block section.
    if (idx < 0) {
      const v = rawLine.trim();
      if (section === 'nameServers') {
        const ns = v.toLowerCase();
        if (ns && !rec.nameServers.includes(ns)) rec.nameServers.push(ns);
      } else if (section === 'domainName' && rec.fields.domainName === undefined) {
        rec.fields.domainName = v;
      }
      continue;
    }
    if (idx === 0) continue;
    const key = rawLine.slice(0, idx).trim();
    let val = rawLine.slice(idx + 1).trim();
    const norm = key.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    // A bare "Header:" with no value opens a block section (and nothing else).
    if (!val) {
      section = norm in SECTION_HEADERS ? SECTION_HEADERS[norm] : null;
      continue;
    }
    section = null; // an ordinary key: value line closes any open block

    // Referral pointer? (Captured even when it's also a normal field below.)
    if (REFERRAL_KEYS.includes(norm) && !rec.referral) {
      const host = val.replace(/^(r?whois|https?):\/\//i, '').replace(/[/:].*$/, '').trim();
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) rec.referral = host.toLowerCase();
    }

    // Multi-valued accumulators (name servers, statuses).
    let matchedMulti = false;
    for (const [field, aliases] of Object.entries(MULTI_FIELDS)) {
      if (aliases.includes(norm)) {
        const item = field === 'statuses' ? statusCode(val) : val.toLowerCase().replace(/\s+\d.*$/, '').trim();
        if (item && !rec[field].includes(item)) rec[field].push(item);
        matchedMulti = true;
        break;
      }
    }
    if (matchedMulti) continue;

    // Single-valued canonical fields (first non-empty wins).
    const field = aliasToField[norm];
    if (field && rec.fields[field] === undefined) {
      rec.fields[field] = val;
    }
  }

  // Promote the canonical fields onto the record and parse dates.
  for (const [field, value] of Object.entries(rec.fields)) rec[field] = value;
  rec.dates = {
    created: parseWhoisDate(rec.createdDate),
    updated: parseWhoisDate(rec.updatedDate),
    expiry: parseWhoisDate(rec.expiryDate),
  };
  // A registrar WHOIS server is the usual thin-model referral.
  if (!rec.referral && rec.registrarWhoisServer) {
    rec.referral = rec.registrarWhoisServer.toLowerCase();
  }
  rec.raw = opts.keepRaw === false ? undefined : text;
  return rec;
}

let _aliasIndex = null;
function buildAliasIndex() {
  if (_aliasIndex) return _aliasIndex;
  const idx = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) if (!(a in idx)) idx[a] = field;
  }
  _aliasIndex = idx;
  return idx;
}

/* ------------------------------------------------------------------ *
 * EPP status codes — explained. (ICANN registry/registrar grace & lock codes.)
 * ------------------------------------------------------------------ */

const EPP_STATUS = {
  ok: 'No pending operations or prohibitions. The standard "active" state.',
  active: 'The domain is active (RIR/ccTLD spelling of "ok").',
  inactive: 'No name servers are associated — the domain will not resolve.',
  clienttransferprohibited: 'Registrar lock: the registry will reject transfer requests.',
  clientupdateprohibited: 'Registrar lock: the registry will reject updates to the domain.',
  clientdeleteprohibited: 'Registrar lock: the registry will reject deletion requests.',
  clientrenewprohibited: 'Registrar lock: the registry will reject renewal requests.',
  clienthold: 'Registrar-requested hold: the domain is removed from the zone (will not resolve).',
  servertransferprohibited: 'Registry lock: transfers are prohibited by the registry itself.',
  serverupdateprohibited: 'Registry lock: updates are prohibited by the registry itself.',
  serverdeleteprohibited: 'Registry lock: deletion is prohibited by the registry itself.',
  serverrenewprohibited: 'Registry lock: renewal is prohibited by the registry itself.',
  serverhold: 'Registry-requested hold: removed from the zone (will not resolve).',
  addperiod: 'Grace period just after initial registration (a delete here is usually refundable).',
  autorenewperiod: 'Grace period just after an automatic renewal.',
  renewperiod: 'Grace period just after an explicit renewal.',
  transferperiod: 'Grace period just after a transfer between registrars.',
  redemptionperiod: 'The domain was deleted and is recoverable only via restore; it no longer resolves.',
  pendingdelete: 'Past redemption — the domain is scheduled for release back to the public pool.',
  pendingtransfer: 'A transfer request is in progress.',
  pendingrenew: 'A renewal request is in progress.',
  pendingupdate: 'An update request is in progress.',
  pendingcreate: 'A create request is in progress.',
};

function explainStatus(code) {
  const key = String(code).toLowerCase();
  return EPP_STATUS[key] || null;
}

/* ------------------------------------------------------------------ *
 * 4. The orchestrated lookup: plan -> query -> parse -> follow referral.
 * ------------------------------------------------------------------ */

/**
 * Run a full WHOIS lookup. `resolver(server, query) -> Promise<string>|string`
 * is injected (Node = real TCP/43, browser = fixtures, tests = fakes), so this
 * function — and the entire referral policy — is network- and DOM-free.
 *
 * Returns { target, thin, chain:[{server,query}], records:[…], record, raw:{} }
 * where `record` is the final merged answer and `chain` is every hop made.
 */
async function lookup(target, resolver, opts = {}) {
  if (typeof resolver !== 'function') throw new ParseError('a resolver(server, query) function is required');
  const plan = planQuery(target);
  const maxHops = opts.maxHops || 3;

  const chain = [];
  const records = [];
  const raw = {};
  const seen = new Set();

  let server = plan.server;
  let query = plan.query;
  const t = plan.target;

  for (let hop = 0; hop < maxHops; hop++) {
    if (seen.has(server)) break;        // never loop back to a server we used
    seen.add(server);

    let text;
    try {
      text = await resolver(server, query);
    } catch (e) {
      // A failed FIRST hop is a real error (we have nothing). A failed referral
      // hop is not fatal — we already hold the registry's answer, so keep it
      // and stop, recording why the chain ended.
      if (hop === 0) throw e;
      record_referralError(chain, server, e);
      break;
    }
    if (typeof text !== 'string') throw new ParseError(`resolver for ${server} returned non-text`);
    chain.push({ server, query });
    raw[server] = text;
    const rec = parseWhois(text);
    rec.server = server;
    // The IANA root is a referral stub, never authoritative data: it answers an
    // IP query with the whole administering /8 block and a `refer:` to the RIR.
    // Keep its referral, but don't let its coarse fields shadow the RIR's.
    rec.referralOnly = server === IANA_SERVER;
    records.push(rec);

    // Follow a referral only when it points somewhere new. For thin TLDs we
    // specifically want the registrar's server; for IPs the IANA `refer:`.
    const next = rec.referral && rec.referral !== server && !seen.has(rec.referral) ? rec.referral : null;
    if (!next) break;
    server = next;
    query = formatQuery(server, t.value);
  }

  // Merge hops: later (registrar/RIR) answers overlay earlier (registry) ones
  // for any field they fill, while name servers and statuses are unioned. Each
  // merged field remembers which server it came from, in `provenance`.
  const record = mergeRecords(records);
  record.target = t;
  record.thin = plan.thin;

  return { target: t, thin: plan.thin, chain, records, record, raw };
}

function record_referralError(chain, server, err) {
  if (chain.length) chain[chain.length - 1].referralError = `could not reach ${server}: ${err.message}`;
}

const SCALAR_FIELDS = [
  'domainName', 'registrar', 'registrarWhoisServer', 'registrarUrl', 'registrarIanaId',
  'createdDate', 'updatedDate', 'expiryDate', 'registrant', 'registrantCountry', 'dnssec',
  'netRange', 'netName', 'cidr', 'organization', 'orgCountry',
];

function mergeRecords(records) {
  const out = {
    nameServers: [], statuses: [], provenance: {}, notFound: records.every((r) => r.notFound),
    redacted: records.some((r) => r.redacted),
  };
  for (const rec of records) {
    if (rec.referralOnly) continue; // stub hops contribute nothing but their referral
    for (const f of SCALAR_FIELDS) {
      if (rec[f] != null && rec[f] !== '' && out[f] == null) {
        out[f] = rec[f];
        out.provenance[f] = rec.server;
      }
    }
    for (const ns of rec.nameServers) if (!out.nameServers.includes(ns)) out.nameServers.push(ns);
    for (const st of rec.statuses) if (!out.statuses.includes(st)) out.statuses.push(st);
  }
  out.dates = {
    created: parseWhoisDate(out.createdDate),
    updated: parseWhoisDate(out.updatedDate),
    expiry: parseWhoisDate(out.expiryDate),
  };
  out.statusExplained = out.statuses.map((code) => ({ code, meaning: explainStatus(code) }));
  return out;
}

/* ------------------------------------------------------------------ */

const api = {
  ParseError,
  isIPv4, isIPv6,
  classifyTarget,
  IANA_SERVER, TLD_SERVERS, THIN_TLDS,
  formatQuery, planQuery,
  parseWhois, parseWhoisDate,
  EPP_STATUS, explainStatus, statusCode,
  mergeRecords, lookup,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Whois = api;
