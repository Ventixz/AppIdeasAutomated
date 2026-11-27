#!/usr/bin/env node
'use strict';
/*
 * cli.js — produce a report from the command line, same engine as the browser.
 *
 *   node cli.js --demo
 *   node cli.js --dataset sales --group region,category \
 *               --sum amountCents --sum units --avg amountCents --detail product,rep,units,amountCents
 *   node cli.js --dataset sales --crosstab region/category --sum amountCents
 *   node cli.js --csv mydata.csv --money amount --group region --sum amount --format csv
 *
 * Flags:
 *   --dataset sales|tickets      built-in table (default: sales)
 *   --csv <path>                 load a CSV instead (first row = header)
 *   --money a,b                  (CSV) treat these columns as money (stored as cents)
 *   --group a,b                  group levels, outer->inner
 *   --sum/--avg/--min/--max col  add an aggregate (repeatable)
 *   --count                      add COUNT(*)
 *   --detail a,b,c               show detail rows with these columns
 *   --where "col op value"       filter (repeatable); op: = != > >= < <= contains
 *   --crosstab rowDim/colDim     pivot instead of a banded report
 *   --format text|csv|md|html    output format (default: text)
 */

const path = require('path');
const fs = require('fs');
const R = require('./report-core.js');
const { DATASETS } = require('./data.js');

function parseArgs(argv) {
  const out = { _: [], sum: [], avg: [], min: [], max: [], where: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') out.demo = true;
    else if (a === '--count') out.count = true;
    else if (a === '--dataset') out.dataset = argv[++i];
    else if (a === '--csv') out.csv = argv[++i];
    else if (a === '--money') out.money = argv[++i];
    else if (a === '--group') out.group = argv[++i];
    else if (a === '--detail') out.detail = argv[++i];
    else if (a === '--sum') out.sum.push(argv[++i]);
    else if (a === '--avg') out.avg.push(argv[++i]);
    else if (a === '--min') out.min.push(argv[++i]);
    else if (a === '--max') out.max.push(argv[++i]);
    else if (a === '--where') out.where.push(argv[++i]);
    else if (a === '--crosstab') out.crosstab = argv[++i];
    else if (a === '--format') out.format = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else out._.push(a);
  }
  return out;
}

// Minimal CSV reader (quoted fields, doubled quotes, CRLF tolerant).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

function loadCsv(file, moneyCols) {
  const text = fs.readFileSync(file, 'utf8');
  const grid = parseCsv(text);
  if (!grid.length) throw new Error('empty CSV');
  const header = grid[0];
  const moneySet = new Set((moneyCols || '').split(',').map((s) => s.trim()).filter(Boolean));
  // infer types from the body
  const types = header.map((name) => {
    if (moneySet.has(name)) return 'money';
    let numeric = true, seen = false;
    for (let r = 1; r < grid.length; r++) {
      const v = grid[r][header.indexOf(name)];
      if (v === '' || v === undefined) continue;
      seen = true;
      if (!/^-?\d+(\.\d+)?$/.test(v)) { numeric = false; break; }
    }
    return seen && numeric ? 'number' : 'string';
  });
  const columns = header.map((name, i) => ({ name, label: name, type: types[i] }));
  const rows = [];
  for (let r = 1; r < grid.length; r++) {
    const o = {};
    header.forEach((name, i) => {
      let v = grid[r][i];
      if (v === '' || v === undefined) { o[name] = null; return; }
      if (types[i] === 'money') o[name] = Math.round(parseFloat(v) * 100);
      else if (types[i] === 'number') o[name] = parseFloat(v);
      else o[name] = v;
    });
    rows.push(o);
  }
  return { name: path.basename(file), columns, rows };
}

function colType(data, name) { const c = data.columns.find((c) => c.name === name); return c ? c.type : 'string'; }
function colLabel(data, name) { const c = data.columns.find((c) => c.name === name); return c ? (c.label || c.name) : name; }
function aggType(data, col) { const t = colType(data, col); return t === 'money' ? 'money' : t === 'int' ? 'int' : 'number'; }

function buildAggsFromArgs(data, args) {
  const aggs = [];
  if (args.count) aggs.push({ id: 'count', fn: 'count', label: 'Count', type: 'int' });
  for (const col of args.sum) aggs.push({ id: 'sum_' + col, fn: 'sum', col, label: 'Σ ' + colLabel(data, col), type: aggType(data, col) });
  for (const col of args.avg) aggs.push({ id: 'avg_' + col, fn: 'avg', col, label: 'Avg ' + colLabel(data, col), type: aggType(data, col), decimals: colType(data, col) === 'int' ? 1 : 2 });
  for (const col of args.min) aggs.push({ id: 'min_' + col, fn: 'min', col, label: 'Min ' + colLabel(data, col), type: aggType(data, col) });
  for (const col of args.max) aggs.push({ id: 'max_' + col, fn: 'max', col, label: 'Max ' + colLabel(data, col), type: aggType(data, col) });
  if (!aggs.length) aggs.push({ id: 'count', fn: 'count', label: 'Count', type: 'int' });
  return aggs;
}

function parseWhere(clauses) {
  return clauses.map((s) => {
    const m = s.match(/^(\S+)\s+(=|!=|>=|<=|>|<|contains|in)\s+(.*)$/);
    if (!m) throw new Error('bad --where (use "col op value"): ' + s);
    let [, col, op, value] = m;
    if (op === 'in') value = value.split(',').map((v) => v.trim());
    else if (/^-?\d+(\.\d+)?$/.test(value)) value = parseFloat(value);
    return { col, op, value };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log([
      'report-generator — produce a banded report or crosstab from records.',
      '',
      '  node cli.js --demo',
      '  node cli.js --dataset sales --group region,category --sum amountCents --sum units \\',
      '              --avg amountCents --detail product,rep,units,amountCents',
      '  node cli.js --dataset sales --crosstab region/category --sum amountCents',
      '  node cli.js --csv data.csv --money amount --group region --sum amount --format csv',
      '',
      'Datasets: sales, tickets.  Formats: text (default), csv, md, html.',
      'Aggregates: --sum/--avg/--min/--max <col> (repeatable), --count.',
      'Filter: --where "col op value"  (op: = != > >= < <= contains in).',
    ].join('\n'));
    return;
  }

  if (args.demo) {
    const data = DATASETS.sales;
    const rep = R.buildReport(data, {
      title: 'Sales by Region and Category — Q1 2026',
      subtitle: 'Report Generator demo · figures in USD',
      groups: ['region', 'category'],
      detail: ['product', 'rep', 'units', 'amountCents'],
      aggregates: [
        { id: 'units', fn: 'sum', col: 'units', label: 'Units', type: 'int' },
        { id: 'amt', fn: 'sum', col: 'amountCents', label: 'Amount', type: 'money' },
        { id: 'avg', fn: 'avg', col: 'amountCents', label: 'Avg sale', type: 'money' },
      ],
    });
    console.log(R.renderText(rep));
    console.log('\n');
    const ct = R.crosstab(data, { rowDim: 'region', colDim: 'category', fn: 'sum', col: 'amountCents', type: 'money' });
    console.log('Crosstab — Amount by Region × Category');
    console.log(R.renderCrosstabText(ct));
    return;
  }

  const data = args.csv ? loadCsv(args.csv, args.money) : (DATASETS[args.dataset || 'sales'] || DATASETS.sales);
  const where = parseWhere(args.where);
  const format = args.format || 'text';

  if (args.crosstab) {
    const [rowDim, colDim] = args.crosstab.split('/');
    if (!rowDim || !colDim) throw new Error('--crosstab needs "rowDim/colDim"');
    const col = args.sum[0] || args.avg[0];
    const fn = args.avg.length ? 'avg' : args.sum.length ? 'sum' : 'count';
    const ct = R.crosstab(data, { rowDim, colDim, fn, col, type: col ? aggType(data, col) : 'int', where });
    console.log(format === 'html' ? R.renderCrosstabHtml(ct) : R.renderCrosstabText(ct));
    return;
  }

  const groups = (args.group || '').split(',').map((s) => s.trim()).filter(Boolean);
  const detail = args.detail ? args.detail.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const rep = R.buildReport(data, {
    title: args.title || (data.name + ' report'),
    groups, detail, where,
    aggregates: buildAggsFromArgs(data, args),
  });

  if (format === 'csv') console.log(R.renderCsv(rep));
  else if (format === 'md') console.log(R.renderMarkdown(rep));
  else if (format === 'html') console.log(R.renderHtml(rep));
  else console.log(R.renderText(rep));
}

try { main(); } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
