#!/usr/bin/env node
'use strict';
/*
 * cli.js — generate a report from the command line.
 *
 *   node cli.js                                  # text report, sample data, grouped by region
 *   node cli.js --group region,rep --format html > report.html
 *   node cli.js --preset byCategory --format csv
 *   node cli.js --format pdf --out report.pdf
 *   node cli.js --data orders.json --group region --sum revenue --format pdf --out r.pdf
 *
 * Flags:
 *   --preset <byRegion|byRegionRep|byCategory>   a ready-made spec on the sample data
 *   --data <file.json>                           array of row objects (else sample data)
 *   --group <col[,col...]>                        group-by columns, outer -> inner
 *   --sum/--avg/--min/--max/--count <col>         make a column aggregate (repeatable)
 *   --sort <col[:desc]>                           sort within the leaf group
 *   --title <text>                               report title
 *   --format <text|csv|html|pdf>                 output format (default: text)
 *   --out <file>                                 write to file (else stdout; required for pdf)
 */

const fs = require('fs');
const R = require('./report-core.js');

function parseArgs(argv) {
  const a = { aggs: {} };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    switch (t) {
      case '--preset': a.preset = next(); break;
      case '--data': a.data = next(); break;
      case '--group': a.group = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--sort': a.sort = next(); break;
      case '--title': a.title = next(); break;
      case '--format': a.format = next(); break;
      case '--out': a.out = next(); break;
      case '--sum': a.aggs[next()] = 'sum'; break;
      case '--avg': a.aggs[next()] = 'avg'; break;
      case '--min': a.aggs[next()] = 'min'; break;
      case '--max': a.aggs[next()] = 'max'; break;
      case '--count': a.aggs[next()] = 'count'; break;
      case '-h': case '--help': a.help = true; break;
      default: console.error('unknown flag: ' + t); process.exit(2);
    }
  }
  return a;
}

function inferType(key, rows) {
  for (const r of rows) {
    const v = r[key];
    if (R.isNull(v)) continue;
    if (typeof v === 'number') return /price|cost|revenue|amount|total|\$/i.test(key) ? 'currency' : 'number';
    if (/date|day|time/i.test(key) || /^\d{4}-\d\d-\d\d/.test(String(v))) return 'date';
    return 'text';
  }
  return 'text';
}

function buildColumns(rows, aggs) {
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return keys.map((k) => {
    const col = { key: k, label: R.keyLabel(k), type: inferType(k, rows) };
    if (aggs[k]) col.agg = aggs[k];
    return col;
  });
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 24).join('\n').replace(/\*\/?/g, ''));
    return;
  }

  let spec;
  if (a.preset) {
    spec = R.SAMPLE_SPECS[a.preset];
    if (!spec) { console.error('unknown preset: ' + a.preset + ' (have: ' + Object.keys(R.SAMPLE_SPECS).join(', ') + ')'); process.exit(2); }
    spec = Object.assign({}, spec);
  }

  let data;
  if (a.data) {
    const raw = JSON.parse(fs.readFileSync(a.data, 'utf8'));
    if (!Array.isArray(raw)) { console.error('--data must be a JSON array of row objects'); process.exit(2); }
    data = raw;
  } else {
    data = R.SAMPLE_DATA;
  }

  if (!spec) {
    const cols = buildColumns(data, a.aggs);
    spec = {
      title: a.title || 'Report',
      columns: cols,
      groupBy: a.group || (data === R.SAMPLE_DATA ? ['region'] : []),
      sortBy: a.sort ? [{ key: a.sort.split(':')[0], dir: a.sort.split(':')[1] || 'asc' }] : [],
    };
    // default aggregates for the sample data when none given
    if (data === R.SAMPLE_DATA && Object.keys(a.aggs).length === 0) {
      for (const c of spec.columns) if (c.key === 'units' || c.key === 'revenue') c.agg = 'sum';
    }
  } else {
    if (a.group) spec.groupBy = a.group;
    if (a.title) spec.title = a.title;
    if (a.sort) spec.sortBy = [{ key: a.sort.split(':')[0], dir: a.sort.split(':')[1] || 'asc' }];
  }
  if (!spec.generatedAt) spec.generatedAt = new Date().toISOString().slice(0, 10);

  const report = R.buildReport(data, spec);
  const fmt = a.format || 'text';

  if (fmt === 'pdf') {
    const bytes = R.renderPdf(report);
    if (!a.out) { console.error('--out <file> is required for --format pdf'); process.exit(2); }
    fs.writeFileSync(a.out, Buffer.from(bytes));
    console.error('wrote ' + a.out + ' (' + bytes.length + ' bytes, ' + report.rowCount + ' rows)');
    return;
  }

  let text;
  if (fmt === 'csv') text = R.renderCsv(report);
  else if (fmt === 'html') text = R.renderHtml(report);
  else if (fmt === 'text') text = R.renderText(report);
  else { console.error('unknown format: ' + fmt); process.exit(2); }

  if (a.out) { fs.writeFileSync(a.out, text); console.error('wrote ' + a.out); }
  else process.stdout.write(text);
}

main();
