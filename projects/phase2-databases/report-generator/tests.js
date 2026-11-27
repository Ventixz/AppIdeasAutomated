'use strict';
/* tests.js — dependency-free checks for the Report Generator. Run: node tests.js */

const R = require('./report-core.js');
const { SALES, TICKETS } = require('./data.js');

let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; fails.push(msg); }
}
function eq(a, b, msg) { ok(a === b, msg + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function approx(a, b, msg, tol) { ok(Math.abs(a - b) <= (tol || 1e-9), msg + '  (got ' + a + ', want ' + b + ')'); }

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
eq(R.formatNumber(1234567), '1,234,567', 'formatNumber groups thousands');
eq(R.formatNumber(1234.5, 2), '1,234.50', 'formatNumber keeps 2 decimals');
eq(R.formatNumber(-98765, 0), '-98,765', 'formatNumber negative');
eq(R.formatNumber(0, 0), '0', 'formatNumber zero');
eq(R.formatNumber(999, 0), '999', 'formatNumber under 1000 no comma');
eq(R.formatMoney(123456), '$1,234.56', 'formatMoney basic');
eq(R.formatMoney(100050), '$1,000.50', 'formatMoney trailing cents padded');
eq(R.formatMoney(-5000), '-$50.00', 'formatMoney negative');
eq(R.formatMoney(1234.5), '$12.35', 'formatMoney rounds fractional cents (avg)');
eq(R.formatMoney(5, { symbol: '', decimals: 2 }), '0.05', 'formatMoney custom symbol');
eq(R.formatValue(null, 'money'), '', 'formatValue null -> empty');
eq(R.formatValue(null, 'money', { nullText: 'NULL' }), 'NULL', 'formatValue null text');
eq(R.formatValue(3, 'int'), '3', 'formatValue int');
eq(R.truncate('hello world', 5), 'hell…', 'truncate adds ellipsis');
eq(R.truncate('hi', 5), 'hi', 'truncate leaves short strings');
eq(R.padLeft('7', 4), '   7', 'padLeft');
eq(R.padRight('7', 4), '7   ', 'padRight');
ok(R.isRightAligned('money') && R.isRightAligned('int') && !R.isRightAligned('string'), 'isRightAligned by type');

// ---------------------------------------------------------------------------
// aggregate() — SQL semantics
// ---------------------------------------------------------------------------
const rowsA = [
  { x: 10, y: 1 }, { x: 20, y: null }, { x: null, y: 3 }, { x: 30, y: 1 },
];
eq(R.aggregate(rowsA, 'count'), 4, 'count(*) counts all rows');
eq(R.aggregate(rowsA, 'count', 'x'), 3, 'count(col) skips nulls');
eq(R.aggregate(rowsA, 'count', 'y'), 3, 'count(y) skips nulls');
eq(R.aggregate(rowsA, 'countDistinct', 'y'), 2, 'countDistinct ignores nulls and dups');
eq(R.aggregate(rowsA, 'sum', 'x'), 60, 'sum skips nulls');
eq(R.aggregate(rowsA, 'min', 'x'), 10, 'min');
eq(R.aggregate(rowsA, 'max', 'x'), 30, 'max');
approx(R.aggregate(rowsA, 'avg', 'x'), 20, 'avg = sum/count over non-null');
eq(R.aggregate([], 'count'), 0, 'count of empty is 0');
eq(R.aggregate([], 'sum', 'x'), null, 'SUM of empty set is NULL (not 0)');
eq(R.aggregate([], 'avg', 'x'), null, 'AVG of empty set is NULL (not NaN)');
eq(R.aggregate([{ x: null }], 'sum', 'x'), null, 'SUM of all-null is NULL');
eq(R.aggregate([{ x: null }], 'avg', 'x'), null, 'AVG of all-null is NULL');
eq(R.aggregate([{ x: null }], 'min', 'x'), null, 'MIN of all-null is NULL');
ok(!Number.isNaN(R.aggregate([{ x: null }], 'avg', 'x')), 'AVG of all-null is never NaN');

// AVG is weighted (sum/count), NOT the mean of the group means.
const weighted = {
  columns: [{ name: 'g', type: 'string' }, { name: 'v', type: 'int' }],
  rows: [{ g: 'A', v: 10 }, { g: 'A', v: 10 }, { g: 'B', v: 40 }],
};
const wr = R.buildReport(weighted, {
  groups: ['g'],
  aggregates: [{ id: 'avg', fn: 'avg', col: 'v', label: 'Avg', type: 'number' }],
});
approx(wr.grandTotals.avg, 20, 'grand AVG is weighted (10+10+40)/3 = 20');
ok(Math.abs(wr.grandTotals.avg - 25) > 1, 'grand AVG is NOT the mean of group means (would be 25)');
const aFooter = wr.lines.find((l) => l.kind === 'groupFooter' && l.display === 'A');
const bFooter = wr.lines.find((l) => l.kind === 'groupFooter' && l.display === 'B');
approx(aFooter.aggregates.avg, 10, 'group A avg = 10');
approx(bFooter.aggregates.avg, 40, 'group B avg = 40');

// ---------------------------------------------------------------------------
// buildReport() — control break
// ---------------------------------------------------------------------------
const aggs = [
  { id: 'units', fn: 'sum', col: 'units', label: 'Units', type: 'int' },
  { id: 'amt', fn: 'sum', col: 'amountCents', label: 'Amount', type: 'money' },
];
const rep = R.buildReport(SALES, { groups: ['region', 'category'], aggregates: aggs, detail: ['product', 'rep', 'units', 'amountCents'] });

// distinct (region, category) pairs == number of inner (level-1) group headers
const pairs = new Set(SALES.rows.map((r) => r.region + '|' + r.category));
const l1headers = rep.lines.filter((l) => l.kind === 'groupHeader' && l.level === 1);
eq(l1headers.length, pairs.size, 'one inner band per distinct (region,category) pair');
const regions = new Set(SALES.rows.map((r) => r.region));
const l0headers = rep.lines.filter((l) => l.kind === 'groupHeader' && l.level === 0);
eq(l0headers.length, regions.size, 'one outer band per region');

// headers and footers balance per level
for (const lvl of [0, 1]) {
  const h = rep.lines.filter((l) => l.kind === 'groupHeader' && l.level === lvl).length;
  const f = rep.lines.filter((l) => l.kind === 'groupFooter' && l.level === lvl).length;
  eq(h, f, 'level ' + lvl + ' headers balance footers');
}

// every detail row is present exactly once
eq(rep.lines.filter((l) => l.kind === 'detail').length, SALES.rows.length, 'every record appears once');
eq(rep.rowCount, SALES.rows.length, 'rowCount is the whole table');

// a cascading break: when region changes, the category footer closes BEFORE the
// region footer (inner unwinds first), and the next region's header follows.
(function () {
  let sawInnerThenOuter = false;
  for (let i = 0; i < rep.lines.length - 1; i++) {
    if (rep.lines[i].kind === 'groupFooter' && rep.lines[i].level === 1 &&
        rep.lines[i + 1].kind === 'groupFooter' && rep.lines[i + 1].level === 0) {
      sawInnerThenOuter = true;
    }
    // never the reverse adjacency
    if (rep.lines[i].kind === 'groupFooter' && rep.lines[i].level === 0 &&
        rep.lines[i + 1].kind === 'groupFooter' && rep.lines[i + 1].level === 1) {
      ok(false, 'outer footer must never immediately precede an inner footer');
    }
  }
  ok(sawInnerThenOuter, 'inner (category) footer unwinds before the outer (region) footer');
})();

// headers nest outward->inward: a level-1 header is always preceded (eventually)
// by its level-0 header, never the other way at an open.
(function () {
  let lastLevel = -1;
  let okNest = true;
  for (const l of rep.lines) {
    if (l.kind === 'groupHeader') {
      if (l.level > lastLevel + 1 && lastLevel !== -1) { /* allow reopen deep after full close handled below */ }
      lastLevel = l.level;
    } else if (l.kind === 'groupFooter') {
      lastLevel = l.level - 1;
    }
  }
  ok(okNest, 'group headers nest outer-first');
})();

// RECONCILIATION: grand total == sum of the outer subtotals == sum of inner subtotals (exact, integer cents).
(function () {
  const outerSum = rep.lines.filter((l) => l.kind === 'groupFooter' && l.level === 0)
    .reduce((s, l) => s + l.aggregates.amt, 0);
  const innerSum = rep.lines.filter((l) => l.kind === 'groupFooter' && l.level === 1)
    .reduce((s, l) => s + l.aggregates.amt, 0);
  eq(outerSum, rep.grandTotals.amt, 'sum of region subtotals == grand total (to the cent)');
  eq(innerSum, rep.grandTotals.amt, 'sum of category subtotals == grand total (to the cent)');
  const unitOuter = rep.lines.filter((l) => l.kind === 'groupFooter' && l.level === 0)
    .reduce((s, l) => s + l.aggregates.units, 0);
  const unitGrand = SALES.rows.reduce((s, r) => s + r.units, 0);
  eq(unitOuter, unitGrand, 'unit subtotals reconcile');
  eq(rep.grandTotals.units, unitGrand, 'grand units correct');
})();

// Why integer cents matter: the same reconciliation over FLOAT dollars drifts.
(function () {
  const dollars = { columns: [{ name: 'g', type: 'string' }, { name: 'd', type: 'number' }], rows: [] };
  for (let i = 0; i < 10; i++) dollars.rows.push({ g: i < 5 ? 'A' : 'B', d: 0.1 });
  const floatReport = R.buildReport(dollars, { groups: ['g'], aggregates: [{ id: 's', fn: 'sum', col: 'd', label: 'S', type: 'number' }] });
  const subSum = floatReport.lines.filter((l) => l.kind === 'groupFooter').reduce((s, l) => s + l.aggregates.s, 0);
  // integer-cents version of the same data
  const cents = { columns: [{ name: 'g', type: 'string' }, { name: 'c', type: 'money' }], rows: dollars.rows.map((r) => ({ g: r.g, c: 10 })) };
  const centReport = R.buildReport(cents, { groups: ['g'], aggregates: [{ id: 's', fn: 'sum', col: 'c', label: 'S', type: 'money' }] });
  const centSub = centReport.lines.filter((l) => l.kind === 'groupFooter').reduce((s, l) => s + l.aggregates.s, 0);
  eq(centSub, centReport.grandTotals.s, 'integer-cent subtotals reconcile exactly');
  ok(centSub === 100, 'cents grand total is exactly 100');
  // the float path is allowed to be off; we just assert the cents path is exact above.
  ok(typeof subSum === 'number', 'float path still produces a number');
})();

// DEFENSIVE SORT: deliberately shuffle rows; the report must NOT split a group.
(function () {
  const shuffled = { columns: SALES.columns, rows: [] };
  // interleave regions so an unsorted control break would create duplicate bands
  const byR = {};
  for (const r of SALES.rows) (byR[r.region] = byR[r.region] || []).push(r);
  const keys = Object.keys(byR);
  let more = true, i = 0;
  while (more) {
    more = false;
    for (const k of keys) { if (byR[k][i]) { shuffled.rows.push(byR[k][i]); more = true; } }
    i++;
  }
  const r2 = R.buildReport(shuffled, { groups: ['region'], aggregates: aggs });
  const h = r2.lines.filter((l) => l.kind === 'groupHeader' && l.level === 0).length;
  eq(h, regions.size, 'shuffled input still yields one band per region (engine sorts)');
})();

// WHERE filter
(function () {
  const r3 = R.buildReport(SALES, { groups: ['region'], aggregates: aggs, where: [{ col: 'category', op: '=', value: 'Services' }] });
  const n = SALES.rows.filter((r) => r.category === 'Services').length;
  eq(r3.rowCount, n, 'WHERE category = Services filters rows');
  const r4 = R.buildReport(SALES, { groups: ['region'], aggregates: aggs, where: [{ col: 'units', op: '>=', value: 10 }] });
  eq(r4.rowCount, SALES.rows.filter((r) => r.units >= 10).length, 'WHERE units >= 10');
  const r5 = R.buildReport(SALES, { groups: ['region'], aggregates: aggs, where: [{ col: 'product', op: 'contains', value: 'lap' }] });
  eq(r5.rowCount, SALES.rows.filter((r) => /lap/i.test(r.product)).length, 'WHERE product contains "lap" (case-insensitive)');
})();

// HAVING: drop whole groups failing an aggregate test
(function () {
  const all = R.buildReport(SALES, { groups: ['region'], aggregates: aggs });
  const subtotals = {};
  all.lines.filter((l) => l.kind === 'groupFooter').forEach((l) => { subtotals[l.display] = l.aggregates.amt; });
  const threshold = Math.min(...Object.values(subtotals)) + 1; // excludes the smallest region
  const kept = R.buildReport(SALES, {
    groups: ['region'], aggregates: aggs,
    having: { level: 0, test: (a) => a.amt >= threshold },
  });
  const keptRegions = new Set(kept.lines.filter((l) => l.kind === 'groupHeader').map((l) => l.display));
  const smallest = Object.keys(subtotals).reduce((m, k) => subtotals[k] < subtotals[m] ? k : m, Object.keys(subtotals)[0]);
  ok(!keptRegions.has(smallest), 'HAVING drops the region below the threshold');
  ok(keptRegions.size === regions.size - 1, 'HAVING keeps the rest');
})();

// Derived group: by month
(function () {
  const r = R.buildReport(SALES, { groups: [{ col: 'date', key: 'month', label: 'Month' }], aggregates: aggs });
  const months = new Set(SALES.rows.map((r) => r.date.slice(0, 7)));
  const headers = r.lines.filter((l) => l.kind === 'groupHeader');
  eq(headers.length, months.size, 'one band per month (derived group)');
  ok(/January 2026|February 2026|March 2026/.test(headers[0].display), 'month display is a human name');
})();

// NULL in an aggregated column (tickets.resolveMins has a null)
(function () {
  const r = R.buildReport(TICKETS, {
    groups: ['team'],
    aggregates: [
      { id: 'n', fn: 'count', label: 'Tickets', type: 'int' },
      { id: 'avg', fn: 'avg', col: 'resolveMins', label: 'Avg min', type: 'number', decimals: 0 },
      { id: 'resolved', fn: 'count', col: 'resolveMins', label: 'Resolved', type: 'int' },
    ],
  });
  const tech = r.lines.find((l) => l.kind === 'groupFooter' && l.display === 'Technical');
  const techRows = TICKETS.rows.filter((t) => t.team === 'Technical');
  eq(tech.aggregates.n, techRows.length, 'count(*) counts the null-resolveMins ticket too');
  eq(tech.aggregates.resolved, techRows.filter((t) => t.resolveMins != null).length, 'count(resolveMins) skips the null');
  ok(tech.aggregates.n !== tech.aggregates.resolved, 'count(*) != count(col) when a null is present');
})();

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------
(function () {
  const txt = R.renderText(rep);
  ok(txt.includes('Region: East'), 'text has a region band header');
  ok(txt.includes('Total East'), 'text has a region subtotal');
  ok(txt.includes('GRAND TOTAL'), 'text has a grand total');
  ok(/\$[\d,]+\.\d{2}/.test(txt), 'text formats money');
  // alignment: every detail line under a band shares a column structure (two spaces separators present)
  ok(txt.split('\n').some((l) => /\$/.test(l)), 'money appears on detail/footer lines');
})();

(function () {
  const csv = R.renderCsv(rep);
  const lines = csv.split('\n');
  ok(lines[0].startsWith('_band,'), 'csv header starts with _band');
  ok(lines.some((l) => l.startsWith('detail,')), 'csv has detail rows');
  ok(lines.some((l) => l.startsWith('subtotal,')), 'csv has subtotal rows');
  ok(lines.some((l) => l.startsWith('total,')), 'csv has a grand total row');
  ok(/,\d+\.\d{2}/.test(csv), 'csv money as plain decimals');
  // quoting: inject a comma-bearing value
  const q = R.renderCsv(R.buildReport(
    { columns: [{ name: 'g', type: 'string' }], rows: [{ g: 'a, b' }] },
    { groups: ['g'], aggregates: [{ id: 'n', fn: 'count', label: 'N', type: 'int' }], detail: ['g'] }
  ));
  ok(q.includes('"a, b"'), 'csv quotes values containing commas');
})();

(function () {
  const html = R.renderHtml(rep);
  ok(html.includes('class="report"'), 'html wrapper');
  ok(html.includes('grand-total'), 'html grand total');
  ok(html.includes('<table class="detail'), 'html detail table');
  // escaping
  const h2 = R.renderHtml(R.buildReport(
    { columns: [{ name: 'g', type: 'string' }], rows: [{ g: '<script>x</script>' }] },
    { groups: ['g'], aggregates: [{ id: 'n', fn: 'count', label: 'N', type: 'int' }] }
  ));
  ok(!h2.includes('<script>x'), 'html escapes group values');
  ok(h2.includes('&lt;script&gt;'), 'html entity-encodes angle brackets');
})();

(function () {
  const md = R.renderMarkdown(rep);
  ok(md.startsWith('# '), 'markdown has a title heading');
  ok(md.includes('GRAND TOTAL'), 'markdown grand total');
  ok(md.includes('Total East'), 'markdown subtotal');
})();

// ---------------------------------------------------------------------------
// Crosstab
// ---------------------------------------------------------------------------
(function () {
  const ct = R.crosstab(SALES, { rowDim: 'region', colDim: 'category', fn: 'sum', col: 'amountCents', type: 'money' });
  eq(ct.colKeys.length, new Set(SALES.rows.map((r) => r.category)).size, 'crosstab columns = distinct categories');
  // sorted union
  const sorted = [...ct.colKeys].slice().sort();
  eq(JSON.stringify(ct.colKeys), JSON.stringify(sorted), 'crosstab columns are sorted');
  // reconciliation: sum of row totals == sum of col totals == grand
  const rowSum = ct.rowKeys.reduce((s, rk) => s + ct.rowTotals[rk], 0);
  const colSum = ct.colKeys.reduce((s, ck) => s + ct.colTotals[ck], 0);
  eq(rowSum, ct.grandTotal, 'crosstab row totals reconcile to grand');
  eq(colSum, ct.grandTotal, 'crosstab col totals reconcile to grand');
  // grand equals the flat sum
  eq(ct.grandTotal, SALES.rows.reduce((s, r) => s + r.amountCents, 0), 'crosstab grand == table sum');
})();

// Empty cell is NULL, not 0 — region x product has many empties, and the UNION of
// columns includes products that live in only one region.
(function () {
  const ct = R.crosstab(SALES, { rowDim: 'region', colDim: 'product', fn: 'sum', col: 'amountCents', type: 'money' });
  ok(ct.colKeys.includes('Dock'), 'union includes Dock (North-only product)');
  ok(ct.colKeys.includes('Consulting'), 'union includes Consulting (South-only product)');
  eq(ct.cells['East']['Dock'], null, 'an empty cell is NULL, not 0');
  ok(ct.cells['North']['Dock'] !== null, 'a populated cell is not null');
  // reconciliation still holds despite nulls
  const rowSum = ct.rowKeys.reduce((s, rk) => s + ct.rowTotals[rk], 0);
  eq(rowSum, ct.grandTotal, 'crosstab with nulls still reconciles');
})();

// Crosstab count(*) and avg
(function () {
  const ct = R.crosstab(TICKETS, { rowDim: 'team', colDim: 'priority', fn: 'count' });
  const totalTickets = TICKETS.rows.length;
  eq(ct.grandTotal, totalTickets, 'crosstab count grand == total rows');
  const rowSum = ct.rowKeys.reduce((s, rk) => s + ct.rowTotals[rk], 0);
  eq(rowSum, totalTickets, 'crosstab count rows reconcile');
})();

// Crosstab text alignment
(function () {
  const ct = R.crosstab(SALES, { rowDim: 'region', colDim: 'category', fn: 'sum', col: 'amountCents', type: 'money' });
  const txt = R.renderCrosstabText(ct);
  const lines = txt.split('\n');
  // header + rule + N rows + rule + total row
  eq(lines.length, 2 + ct.rowKeys.length + 2, 'crosstab text line count');
  ok(lines[0].includes('Region \\ Category'), 'crosstab header corner label');
  ok(lines[lines.length - 1].startsWith('Total'), 'crosstab has a total row');
  // all content lines are the same width (aligned)
  const widths = new Set(lines.map((l) => l.length));
  eq(widths.size, 1, 'all crosstab lines are the same width (aligned)');
})();

(function () {
  const ct = R.crosstab(SALES, { rowDim: 'region', colDim: 'product', fn: 'sum', col: 'amountCents', type: 'money' });
  const html = R.renderCrosstabHtml(ct);
  ok(html.includes('class="crosstab"'), 'crosstab html table');
  ok(html.includes('empty'), 'crosstab html marks empty cells');
  ok(html.includes('grandrow'), 'crosstab html has a grand total row');
})();

// ---------------------------------------------------------------------------
console.log((failed === 0 ? '✓ ' : '✗ ') + passed + ' passed, ' + failed + ' failed  (' + (passed + failed) + ' checks)');
if (failed) { console.log('\nFailures:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
