#!/usr/bin/env node
/*
 * whois-node.js — binds the engine to real TCP/43 sockets.
 *
 * The browser demo feeds whois-core's lookup() a fixture resolver; here we feed
 * it a resolver that speaks the actual WHOIS wire protocol (RFC 3912): open a
 * TCP connection to port 43, send "<query>\r\n", read everything until the
 * server closes, done. The referral-following, parsing and merging are all the
 * SAME engine code the browser and tests use — only the resolver changes.
 *
 * Usage:
 *   node whois-node.js example.com google.com 8.8.8.8      # live, over TCP/43
 *   node whois-node.js example.com --json                  # machine-readable
 *   node whois-node.js example.com --offline               # bundled snapshots
 *   printf 'a.com\nb.org\n' | node whois-node.js            # batch from stdin
 *   node whois-node.js example.com --timeout 8000          # per-hop timeout ms
 */

'use strict';

const net = require('net');
const core = require('./whois-core');
const { fixtureResolver } = require('./whois-fixtures');

const WHOIS_PORT = 43;

// The real network resolver: one TCP/43 round-trip per hop.
function makeSocketResolver(timeoutMs) {
  return (server, query) => new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: server, port: WHOIS_PORT });
    let buf = '';
    const done = (err) => {
      sock.destroy();
      if (err) reject(err); else resolve(buf);
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => sock.write(query + '\r\n'));
    sock.on('data', (chunk) => { buf += chunk.toString('utf8'); });
    sock.on('end', () => done());
    sock.on('close', () => done());
    sock.on('timeout', () => done(new Error(`timeout after ${timeoutMs}ms querying ${server}`)));
    sock.on('error', (e) => done(new Error(`${server}: ${e.message}`)));
  });
}

function parseArgs(argv) {
  const opts = { json: false, offline: false, timeout: 10000, targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--timeout') opts.timeout = parseInt(argv[++i], 10) || 10000;
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.targets.push(a);
  }
  return opts;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

function printHuman(result) {
  const r = result.record;
  const t = result.target;
  const label = t.kind === 'domain' ? 'Domain' : 'IP';
  console.log(`\n=== ${label}: ${t.value} ===`);
  console.log(`  query chain : ${result.chain.map((h) => h.server).join('  ->  ') || '(none)'}`);
  console.log(`  model       : ${result.thin ? 'thin registry (followed referral to registrar)' : 'thick / direct'}`);
  if (r.notFound) { console.log('  result      : NO MATCH — the name is not registered.'); return; }

  const line = (k, v) => { if (v != null && v !== '') console.log(`  ${k.padEnd(12)}: ${v}`); };
  line('registrar', r.registrar);
  line('registrant', r.registrant);
  line('organization', r.organization);
  line('netrange', r.netRange);
  line('cidr', r.cidr);
  line('created', r.dates.created || r.createdDate);
  line('updated', r.dates.updated || r.updatedDate);
  line('expires', r.dates.expiry || r.expiryDate);
  if (r.nameServers.length) console.log(`  nameservers : ${r.nameServers.join(', ')}`);
  if (r.registrantCountry || r.orgCountry) line('country', r.registrantCountry || r.orgCountry);
  line('dnssec', r.dnssec);
  if (r.redacted) console.log('  privacy     : contact data REDACTED (GDPR / privacy service)');
  if (r.statusExplained.length) {
    console.log('  status      :');
    for (const s of r.statusExplained) {
      console.log(`    - ${s.code}${s.meaning ? `\n        ${s.meaning}` : ''}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node whois-node.js <domain|ip> [more…] [--json] [--offline] [--timeout ms]');
    return;
  }
  let targets = opts.targets.slice();
  if (!targets.length) {
    const stdin = await readStdin();
    targets = stdin.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (!targets.length) {
    console.error('No targets. Pass a domain or IP, or pipe them on stdin. (-h for help)');
    process.exitCode = 1;
    return;
  }

  const resolver = opts.offline ? fixtureResolver : makeSocketResolver(opts.timeout);
  const out = [];
  for (const target of targets) {
    try {
      const result = await core.lookup(target, resolver);
      if (opts.json) {
        const r = result.record;
        out.push({
          target: result.target.value,
          kind: result.target.kind,
          thin: result.thin,
          chain: result.chain.map((h) => h.server),
          notFound: r.notFound,
          registrar: r.registrar || null,
          registrant: r.registrant || null,
          organization: r.organization || null,
          netRange: r.netRange || null,
          cidr: r.cidr || null,
          dates: r.dates,
          nameServers: r.nameServers,
          statuses: r.statusExplained,
          redacted: r.redacted,
          country: r.registrantCountry || r.orgCountry || null,
          dnssec: r.dnssec || null,
        });
      } else {
        printHuman(result);
      }
    } catch (e) {
      if (opts.json) out.push({ target, error: e.message });
      else console.error(`\n=== ${target} ===\n  error: ${e.message}`);
    }
  }
  if (opts.json) console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main();
module.exports = { makeSocketResolver };
