#!/usr/bin/env node
'use strict';
/*
 * cli.js — generate a report from the command line.
 *
 *   node cli.js --list
 *       List the available reports.
 *
 *   node cli.js sales-by-category
 *       Render a report as an aligned text table (the default).
 *
 *   node cli.js sales-by-region --format html --out report.html
 *       Render to another format and write it to a file.
 *
 *   node cli.js top-customers --limit 3 --format md
 *   node cli.js daily-activity --date 2024-03-15
 *       Reports that take parameters.
 *
 * Formats: text (default), html, csv, md, json.
 * With no report named, prints the list and usage.
 */

const RC = require('./report-core.js');

function parseArgs(argv) {
  const opts = { format: 'text', out: null, params: {} };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list' || a === '-l') opts.list = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--format' || a === '-f') opts.format = argv[++i];
    else if (a === '--out' || a === '-o') opts.out = argv[++i];
    else if (a === '--limit') opts.params.limit = argv[++i];
    else if (a === '--date') opts.params.date = argv[++i];
    else if (a.startsWith('--')) { // generic --key value passthrough
      const key = a.slice(2);
      const val = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      opts.params[key] = val;
    } else rest.push(a);
  }
  opts.report = rest[0];
  return opts;
}

function printList() {
  console.log('Available reports:\n');
  for (const r of RC.listReports()) {
    console.log('  ' + r.id.padEnd(20) + r.title);
    console.log('  ' + ' '.repeat(20) + r.describe + '\n');
  }
}

function usage() {
  console.log('Report Generator — build a report from the sample database.\n');
  console.log('Usage:');
  console.log('  node cli.js <report> [--format text|html|csv|md|json] [--out FILE]');
  console.log('  node cli.js <report> [--limit N] [--date YYYY-MM-DD]');
  console.log('  node cli.js --list\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || (!opts.report && !opts.list)) { usage(); printList(); return; }
  if (opts.list) { printList(); return; }

  let output;
  try {
    const model = RC.buildReport(opts.report, RC.sampleDatabase(), opts.params);
    output = RC.render(model, opts.format);
  } catch (e) {
    console.error('Error: ' + e.message);
    process.exit(1);
  }

  if (opts.out) {
    require('fs').writeFileSync(opts.out, output + (opts.format === 'text' ? '\n' : ''));
    console.error('Wrote ' + opts.out + ' (' + opts.format + ')');
  } else {
    console.log(output);
  }
}

main();
