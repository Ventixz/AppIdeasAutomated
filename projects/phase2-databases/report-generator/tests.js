'use strict';
/*
 * tests.js — headless checks for the Report Generator.
 *   node tests.js
 *
 * Grouped so a failure tells you which layer broke:
 *   1. Aggregators (sum/count/countDistinct/avg/min/max).
 *   2. groupAggregate — plain GROUP BY.
 *   3. groupRollup — control-break order, subtotal placement, and the
 *      "don't average the averages / don't double-count distincts" traps.
 *   4. pivot — column discovery, stable order, zero-fill, reconciliation.
 *   5. withRunningTotal.
 *   6. formatValue — the single source of truth for how figures read.
 *   7. Renderers — text alignment, CSV quoting, Markdown, HTML escaping, JSON.
 *   8. The built-in reports against the sample database (pinned totals + invariants).
 */

const R = require('./report-core.js');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) {
  if (cond) passed++;
  else { failed++; fails.push(name); console.error('  ✗ ' + name); }
}
function eq(name, a, b) { ok(name + ` (got ${JSON.stringify(a)})`, a === b); }
function approx(name, a, b) { ok(name + ` (got ${a})`, Math.abs(a - b) < 1e-9); }
function throws(name, fn) {
  try { fn(); failed++; fails.push(name); console.error('  ✗ ' + name + ' (did not throw)'); }
  catch (e) { passed++; }
}
const section = (s) => console.log('\n' + s);

function runAgg(spec, rows) {
  let acc = spec.init();
  for (const r of rows) acc = spec.step(acc, r);
  return spec.result(acc);
}

/* ---- 1. aggregators ------------------------------------------------------- */
section('Aggregators');
const sample = [{ v: 10, id: 1 }, { v: 20, id: 2 }, { v: 30, id: 1 }];
eq('sum', runAgg(R.Agg.sum('v'), sample), 60);
eq('count', runAgg(R.Agg.count(), sample), 3);
eq('countDistinct dedupes', runAgg(R.Agg.countDistinct('id'), sample), 2);
approx('avg', runAgg(R.Agg.avg('v'), sample), 20);
eq('min', runAgg(R.Agg.min('v'), sample), 10);
eq('max', runAgg(R.Agg.max('v'), sample), 30);
eq('sum of empty is 0', runAgg(R.Agg.sum('v'), []), 0);
eq('avg of empty is 0', runAgg(R.Agg.avg('v'), []), 0);
eq('sum coerces strings', runAgg(R.Agg.sum('v'), [{ v: '2.5' }, { v: '2.5' }]), 5);
eq('num() tolerates junk', R.num('not a number'), 0);

/* ---- 2. groupAggregate ---------------------------------------------------- */
section('groupAggregate (GROUP BY)');
const g = R.groupAggregate(
  [{ c: 'A', q: 1 }, { c: 'B', q: 2 }, { c: 'A', q: 4 }],
  ['c'], { q: R.Agg.sum('q'), n: R.Agg.count() });
eq('two groups', g.length, 2);
const A = g.find((x) => x.group.c === 'A');
eq('group A sum', A.values.q, 5);
eq('group A count', A.values.n, 2);
eq('empty groupBy => one total group', R.groupAggregate(sample, [], { v: R.Agg.sum('v') }).length, 1);
eq('empty groupBy total value', R.groupAggregate(sample, [], { v: R.Agg.sum('v') })[0].values.v, 60);

/* ---- 3. groupRollup ------------------------------------------------------- */
section('groupRollup (control-break subtotals)');
const rollSrc = [
  { region: 'N', cat: 'HW', rev: 100 },
  { region: 'N', cat: 'SW', rev: 50 },
  { region: 'S', cat: 'HW', rev: 70 },
];
const roll = R.groupRollup(rollSrc, ['region', 'cat'],
  { rev: R.Agg.sum('rev') }, { grandTotal: true });

// Expected reading order:
//  N/HW, N/SW, [Subtotal N], S/HW, [Subtotal S], [Grand]
eq('rollup row count', roll.length, 6);
eq('row0 detail N/HW', roll[0].cells.region + '/' + roll[0].cells.cat, 'N/HW');
eq('row1 detail N/SW', roll[1].cells.region + '/' + roll[1].cells.cat, 'N/SW');
eq('row2 is subtotal', roll[2].level, 'subtotal');
eq('subtotal N comes after its details', roll[2].cells.region, 'N');
eq('subtotal N value', roll[2].cells.rev, 150);
eq('subtotal N blanks finer field', roll[2].cells.cat, null);
eq('row3 detail S/HW', roll[3].cells.region + '/' + roll[3].cells.cat, 'S/HW');
eq('row4 subtotal S', roll[4].cells.region, 'S');
eq('subtotal S value', roll[4].cells.rev, 70);
eq('last row is grand', roll[5].level, 'grand');
eq('grand total value', roll[5].cells.rev, 220);
eq('subtotals reconcile to grand',
  roll[2].cells.rev + roll[4].cells.rev, roll[5].cells.rev);

// The averaging trap: avg at the grand level must be over the raw rows,
// not the average of the two subgroup averages.
const avgSrc = [
  { g: 'x', v: 10 }, { g: 'x', v: 20 }, // subgroup avg 15
  { g: 'y', v: 30 },                    // subgroup avg 30
];
const avgRoll = R.groupRollup(avgSrc, ['g'], { a: R.Agg.avg('v') }, { grandTotal: true });
const grandAvg = avgRoll[avgRoll.length - 1];
approx('grand avg is 20 (raw), not 22.5 (avg of avgs)', grandAvg.cells.a, 20);

// The distinct-count trap: the same id in two subgroups counts once overall.
const dSrc = [
  { g: 'x', id: 1 }, { g: 'x', id: 2 },
  { g: 'y', id: 1 },
];
const dRoll = R.groupRollup(dSrc, ['g'], { d: R.Agg.countDistinct('id') }, { grandTotal: true });
eq('grand distinct dedupes across groups (2, not 3)', dRoll[dRoll.length - 1].cells.d, 2);

// Single-level rollup: detail rows + grand, no subtotal rows.
const flat = R.groupRollup(rollSrc, ['region'], { rev: R.Agg.sum('rev') }, { grandTotal: true });
eq('single-level: 2 details + grand', flat.length, 3);
eq('single-level: no subtotal rows', flat.filter((r) => r.level === 'subtotal').length, 0);

/* ---- 4. pivot ------------------------------------------------------------- */
section('pivot (crosstab)');
const pivSrc = [
  { cat: 'HW', mon: '2024-02', rev: 20 },
  { cat: 'HW', mon: '2024-01', rev: 10 },
  { cat: 'SW', mon: '2024-02', rev: 5 },
];
const piv = R.pivot(pivSrc, { row: 'cat', col: 'mon', measure: R.Agg.sum('rev') });
eq('columns discovered', piv.colValues.length, 2);
eq('columns sorted', piv.colValues.join(','), '2024-01,2024-02');
eq('row count', piv.rows.length, 2);
const hwRow = piv.rows.find((r) => r.row === 'HW');
eq('cell present', hwRow.cells['2024-01'], 10);
const swRow = piv.rows.find((r) => r.row === 'SW');
eq('missing cell is 0, not blank', swRow.cells['2024-01'], 0);
eq('row total', hwRow.total, 30);
eq('col total', piv.colTotals['2024-02'], 25);
eq('grand reconciles rows', piv.rows.reduce((s, r) => s + r.total, 0), piv.grand);
eq('grand reconciles cols',
  piv.colValues.reduce((s, c) => s + piv.colTotals[c], 0), piv.grand);
eq('grand value', piv.grand, 35);

/* ---- 5. running total ----------------------------------------------------- */
section('withRunningTotal');
const rtRows = [
  { level: 'detail', cells: { v: 10 } },
  { level: 'detail', cells: { v: 5 } },
  { level: 'grand', cells: { v: 15 } },
];
R.withRunningTotal(rtRows, 'v', 'cum');
eq('running total step 1', rtRows[0].cells.cum, 10);
eq('running total step 2', rtRows[1].cells.cum, 15);
eq('running total skips non-detail rows', rtRows[2].cells.cum, null);

/* ---- 6. formatValue ------------------------------------------------------- */
section('formatValue (single source of truth)');
eq('currency', R.formatValue(1234.5, 'currency'), '$1,234.50');
eq('currency rounds', R.formatValue(2.567, 'currency'), '$2.57');
eq('int groups thousands', R.formatValue(1234567, 'int'), '1,234,567');
eq('int rounds', R.formatValue(2.6, 'int'), '3');
eq('number keeps 2dp', R.formatValue(1000, 'number'), '1,000.00');
eq('percent', R.formatValue(0.1234, 'percent'), '12.3%');
eq('negative currency', R.formatValue(-1500, 'currency'), '$-1,500.00');
eq('null is blank', R.formatValue(null, 'currency'), '');
eq('empty string is blank', R.formatValue('', 'int'), '');
eq('text passthrough', R.formatValue('Hello', 'text'), 'Hello');

/* ---- 7. renderers --------------------------------------------------------- */
section('Renderers');
const model = {
  title: 'T', subtitle: 'sub',
  columns: [
    { key: 'name', label: 'Name', align: 'left', format: 'text' },
    { key: 'rev', label: 'Revenue', align: 'right', format: 'currency' },
  ],
  rows: [
    { level: 'detail', cells: { name: 'Widget', rev: 95 } },
    { level: 'grand', cells: { name: 'Total', rev: 95, __label: 'Total' } },
  ],
};

const txt = R.renderText(model);
ok('text has title', txt.indexOf('T') === 0);
ok('text right-aligns currency (padded)', /\$95\.00/.test(txt));
ok('text has a rule before grand', txt.indexOf('----') !== -1 || txt.indexOf('====') !== -1);
// alignment: every body line should be the same visual width
const bodyLines = txt.split('\n').filter((l) => /Widget|Total/.test(l));
eq('text columns aligned (equal width)', bodyLines[0].length, bodyLines[1].length);

const csv = R.renderCSV(model);
eq('csv header', csv.split('\r\n')[0], 'Name,Revenue');
ok('csv uses CRLF', csv.indexOf('\r\n') !== -1);
const csvQ = R.renderCSV({
  columns: [{ key: 'a', label: 'A', format: 'text' }],
  rows: [{ level: 'detail', cells: { a: 'x, "y"' } }],
});
ok('csv quotes comma + doubles quotes', csvQ.indexOf('"x, ""y"""') !== -1);

const md = R.renderMarkdown(model);
ok('md has header separator', md.indexOf('---') !== -1);
ok('md right-align marker', md.indexOf('---:') !== -1);
ok('md bolds grand row', md.indexOf('**$95.00**') !== -1);

const html = R.renderHTML(model);
ok('html has table', html.indexOf('<table') !== -1);
ok('html marks grand row', html.indexOf('row-grand') !== -1);
const htmlEsc = R.renderHTML({
  columns: [{ key: 'a', label: 'A', format: 'text' }],
  rows: [{ level: 'detail', cells: { a: '<script>&"' } }],
});
ok('html escapes <, &, "', htmlEsc.indexOf('&lt;script&gt;&amp;&quot;') !== -1);
ok('html full document has doctype', R.render(model, 'html').indexOf('<!doctype html>') === 0);

const json = JSON.parse(R.renderJSON(model));
eq('json row count', json.rows.length, 2);
eq('json strips internal __ keys', json.rows[1].cells.__label, undefined);
eq('json keeps real cells', json.rows[1].cells.rev, 95);

throws('unknown format throws', () => R.render(model, 'pdf'));

/* ---- 8. built-in reports against the sample DB ---------------------------- */
section('Built-in reports (sample database)');
const db = R.sampleDatabase();

// Pinned invariants computed by hand from the sample data:
//   total revenue = 7850.00, total units = 302, distinct orders = 12
const TOTAL_REV = 7850, TOTAL_UNITS = 302, TOTAL_ORDERS = 12;

const cat = R.buildReport('sales-by-category', db);
const catGrand = cat.rows.find((r) => r.level === 'grand');
approx('category report grand revenue', catGrand.cells.revenue, TOTAL_REV);
eq('category report grand units', catGrand.cells.units, TOTAL_UNITS);
eq('category report grand orders', catGrand.cells.orders, TOTAL_ORDERS);
const catDetails = cat.rows.filter((r) => r.level === 'detail');
approx('category details sum to grand',
  catDetails.reduce((s, r) => s + r.cells.revenue, 0), TOTAL_REV);

const reg = R.buildReport('sales-by-region', db);
const regSubtotals = reg.rows.filter((r) => r.level === 'subtotal');
ok('region report has region subtotals', regSubtotals.length === 3); // N, S, W
approx('region subtotals reconcile to grand',
  regSubtotals.reduce((s, r) => s + r.cells.revenue, 0), TOTAL_REV);
// every detail row inside a region precedes that region's subtotal
const firstSubIdx = reg.rows.findIndex((r) => r.level === 'subtotal');
eq('first region subtotal follows details', reg.rows[firstSubIdx - 1].level, 'detail');

const top = R.buildReport('top-customers', db, { limit: 3 });
eq('top-customers respects limit', top.rows.length, 3);
ok('top-customers sorted desc',
  top.rows[0].cells.revenue >= top.rows[1].cells.revenue &&
  top.rows[1].cells.revenue >= top.rows[2].cells.revenue);
eq('top-customers ranks numbered', top.rows[0].cells.rank, 1);

const pivotReport = R.buildReport('category-by-month', db);
const pivGrand = pivotReport.rows.find((r) => r.level === 'grand');
approx('pivot report grand reconciles to total revenue', pivGrand.cells.__total, TOTAL_REV);

const daily = R.buildReport('daily-activity', db, { date: '2024-03-15' });
// 2024-03-15 has orders 9, 10, 11 (three orders, three customers)
const ordersRow = daily.rows.find((r) => r.cells.metric === 'Orders placed');
eq('daily-activity counts the day\'s orders', ordersRow.cells.value, '3');
const custRow = daily.rows.find((r) => r.cells.metric === 'Distinct customers');
eq('daily-activity counts distinct customers', custRow.cells.value, '3');

const emptyDay = R.buildReport('daily-activity', db, { date: '2024-12-25' });
eq('daily-activity empty day: 0 orders',
  emptyDay.rows.find((r) => r.cells.metric === 'Orders placed').cells.value, '0');

throws('unknown report throws', () => R.buildReport('nope', db));

// every report renders in every format without throwing
section('Every report × every format renders');
for (const r of R.listReports()) {
  for (const fmt of ['text', 'html', 'csv', 'md', 'json']) {
    const m = R.buildReport(r.id, db, { limit: 5, date: '2024-03-15' });
    let out = '';
    try { out = R.render(m, fmt); } catch (e) { /* caught below */ }
    ok(`${r.id} → ${fmt} renders non-empty`, typeof out === 'string' && out.length > 0);
  }
}

/* ---- summary -------------------------------------------------------------- */
console.log('\n' + '='.repeat(48));
if (failed === 0) {
  console.log(`All ${passed} checks passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED:`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
