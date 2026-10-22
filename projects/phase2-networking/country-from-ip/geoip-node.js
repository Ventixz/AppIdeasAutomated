/*
 * geoip-node.js — binds the transport- and storage-agnostic engine in
 * geoip-core.js to the real world under Node: it reads country databases off
 * disk (a CSV of ranges, or a genuine RIR "delegated-extended" statistics
 * file), reads IPs from argv or stdin, and prints the answer. No third-party
 * packages — just `fs`.
 *
 * The engine does the parsing, special-use classification and range search;
 * this file only supplies it with data and I/O, which is exactly the seam the
 * tests exercise (the same lookup runs against the built-in snapshot, a CSV,
 * and a parsed RIR file, and must agree).
 */
'use strict';

const fs = require('fs');
const core = require('./geoip-core.js');

/**
 * Build a RangeTable from a CSV file of `start_ip,end_ip,cc` lines (inclusive
 * ranges; a header line and `#` comments are skipped). This is the simplest
 * portable database format — one line per interval.
 * @param {string} path
 * @returns {core.RangeTable}
 */
function loadCsv(path) {
  const text = fs.readFileSync(path, 'utf8');
  const ranges = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line[0] === '#') continue;
    const [startStr, endStr, cc] = line.split(',').map((s) => s.trim());
    if (!startStr || !endStr || !cc) continue;
    if (!/^[A-Za-z]{2}$/.test(cc)) continue; // skip malformed rows
    // A header row ("start_ip,end_ip,cc") has a 2-letter cc too, so lean on the
    // parser: if the start/end aren't real IPs, it's not a data row — skip it.
    let a, b;
    try { a = core.parseIP(startStr); b = core.parseIP(endStr); }
    catch (_) { continue; }
    ranges.push({ start: a.mapped, end: b.mapped, cc: cc.toUpperCase() });
  }
  return new core.RangeTable(ranges);
}

/**
 * Build a RangeTable from a real RIR delegated-extended statistics file
 * (e.g. the files published by ARIN/RIPE/APNIC/LACNIC/AFRINIC).
 * @param {string} path
 * @returns {core.RangeTable}
 */
function loadRir(path) {
  const text = fs.readFileSync(path, 'utf8');
  return new core.RangeTable(core.parseRirDelegated(text));
}

/**
 * Pick the table to use from CLI flags: --csv <file>, --rir <file>, or the
 * built-in demo snapshot.
 * @param {Map<string,string>} opts
 * @returns {{table:core.RangeTable, source:string}}
 */
function chooseTable(opts) {
  if (opts.has('--csv')) return { table: loadCsv(opts.get('--csv')), source: `CSV ${opts.get('--csv')}` };
  if (opts.has('--rir')) return { table: loadRir(opts.get('--rir')), source: `RIR ${opts.get('--rir')}` };
  return { table: core.demoTable(), source: 'built-in demo snapshot' };
}

/**
 * Format one lookup result as a single human line.
 * @param {object} r  a result from core.lookup
 */
function formatLine(r) {
  const head = `${r.input}  (IPv${r.version} ${r.canonical})`;
  if (r.kind === 'special') return `${head}  →  no registered country — ${r.special}`;
  if (r.cc === null) return `${head}  →  not in database (unknown)`;
  const name = r.country ? ` ${r.country}` : '';
  const range = r.range ? `  [${r.range.start} – ${r.range.end}]` : '';
  return `${head}  →  ${r.flag} ${r.cc}${name}${range}`;
}

module.exports = { loadCsv, loadRir, chooseTable, formatLine };

/* ------------------------------------------------------------------ *
 * CLI
 *   node geoip-node.js <ip> [<ip> ...] [--csv file] [--rir file] [--json]
 *   echo "8.8.8.8\n2606:4700::1" | node geoip-node.js [--csv file]
 *
 * With no IP arguments it reads them one-per-line from stdin, so it batches:
 *   node geoip-node.js --rir delegated-apnic-extended-latest < ips.txt
 * ------------------------------------------------------------------ */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = new Map();
  const ips = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv' || a === '--rir') { opts.set(a, argv[++i]); }
    else if (a === '--json') { opts.set(a, true); }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}`); process.exit(2); }
    else ips.push(a);
  }

  let table, source;
  try { ({ table, source } = chooseTable(opts)); }
  catch (e) { console.error(`failed to load database: ${e.message}`); process.exit(1); }

  const run = (list) => {
    const results = [];
    for (const ip of list) {
      try { results.push(core.lookup(ip, table)); }
      catch (e) { results.push({ input: ip, error: e.message }); }
    }
    if (opts.has('--json')) {
      // BigInt isn't JSON-serialisable; the result objects are already strings.
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.error(`# database: ${source} (${table.size} ranges)\n`);
      for (const r of results) {
        if (r.error) console.log(`${r.input}  →  invalid: ${r.error}`);
        else console.log(formatLine(r));
      }
    }
  };

  if (ips.length > 0) {
    run(ips);
  } else {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => run(buf.split('\n').map((s) => s.trim()).filter(Boolean)));
  }
}
