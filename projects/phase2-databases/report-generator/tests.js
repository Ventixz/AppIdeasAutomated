'use strict';
/*
 * tests.js — checks for report-core.js. No dependencies: `node tests.js`.
 *
 * The PDF is graded by an INDEPENDENT reader (parsePdf), and, when the tools are
 * installed, cross-checked against qpdf / pdftotext — a separate implementation.
 */

const R = require('./report-core.js');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log('  FAIL: ' + name); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name + '  (got ' + g + ', want ' + w + ')', g === w);
}
function approx(name, got, want, eps) {
  ok(name + '  (got ' + got + ', want ' + want + ')', Math.abs(got - want) <= (eps || 1e-9));
}
function section(t) { console.log('\n== ' + t + ' =='); }

// ---------------------------------------------------------------------------
section('Aggregation — SQL NULL semantics');
// ---------------------------------------------------------------------------
{
  const rows = [{ x: 10 }, { x: null }, { x: 20 }, { x: 30 }];
  eq('sum ignores NULL', R.aggregate(rows, 'x', 'sum'), 60);
  approx('avg divides by non-null count (60/3)', R.aggregate(rows, 'x', 'avg'), 20);
  eq('min ignores NULL', R.aggregate(rows, 'x', 'min'), 10);
  eq('max ignores NULL', R.aggregate(rows, 'x', 'max'), 30);
  eq('count(col) skips NULL', R.aggregate(rows, 'x', 'count'), 3);
  eq('count(*) counts rows', R.AGG.count(rows, null), 4);

  const allNull = [{ x: null }, { x: null }];
  eq('sum of all-NULL is NULL', R.aggregate(allNull, 'x', 'sum'), null);
  eq('avg of all-NULL is NULL', R.aggregate(allNull, 'x', 'avg'), null);
  eq('min of all-NULL is NULL', R.aggregate(allNull, 'x', 'min'), null);
  eq('count(col) of all-NULL is 0', R.aggregate(allNull, 'x', 'count'), 0);
  eq('count(*) of all-NULL rows is 2', R.AGG.count(allNull, null), 2);

  eq('sum of empty is NULL', R.aggregate([], 'x', 'sum'), null);
  eq('count of empty is 0', R.aggregate([], 'x', 'count'), 0);

  const dups = [{ c: 'a' }, { c: 'b' }, { c: 'a' }, { c: null }];
  eq('countDistinct ignores NULL and dups', R.AGG.countDistinct(dups, 'c'), 2);

  // avg must NOT round inputs: avg(1,2) = 1.5
  approx('avg is exact, not integer-rounded', R.aggregate([{ x: 1 }, { x: 2 }], 'x', 'avg'), 1.5);
}

// ---------------------------------------------------------------------------
section('Grand total is NOT the sum/avg of the subtotals');
// ---------------------------------------------------------------------------
{
  // Two groups: A=[2,4] avg 3, B=[6] avg 6. Average of group-avgs = 4.5,
  // but the true overall avg = (2+4+6)/3 = 4. SUM rolls up; AVG does not.
  const data = [
    { g: 'A', v: 2 }, { g: 'A', v: 4 }, { g: 'B', v: 6 },
  ];
  const rep = R.buildReport(data, {
    title: 't',
    columns: [{ key: 'g', label: 'G', type: 'text' }, { key: 'v', label: 'V', type: 'number', agg: 'avg' }],
    groupBy: ['g'],
  });
  const groupAvgs = rep.root.children.map((c) => c.subtotals[1]);
  eq('group avgs are [3, 6]', groupAvgs, [3, 6]);
  const avgOfAvgs = (groupAvgs[0] + groupAvgs[1]) / 2;
  approx('naive avg-of-subtotals would be 4.5', avgOfAvgs, 4.5);
  approx('grand avg is the true 4.0, computed from all rows', rep.grandTotals[1], 4);
  ok('and the two differ (the whole point)', rep.grandTotals[1] !== avgOfAvgs);

  // SUM, by contrast, does roll up.
  const repSum = R.buildReport(data, {
    title: 't',
    columns: [{ key: 'g', label: 'G', type: 'text' }, { key: 'v', label: 'V', type: 'number', agg: 'sum' }],
    groupBy: ['g'],
  });
  const subSum = repSum.root.children.reduce((a, c) => a + c.subtotals[1], 0);
  eq('sum of subtotals equals grand sum (12)', subSum, repSum.grandTotals[1]);
  eq('grand sum is 12', repSum.grandTotals[1], 12);
}

// ---------------------------------------------------------------------------
section('buildReport on the sample data');
// ---------------------------------------------------------------------------
{
  const data = R.SAMPLE_DATA;
  // independent reference totals
  let refUnits = 0, refRev = 0, refCount = 0;
  for (const r of data) {
    if (!R.isNull(r.units)) refUnits += r.units;
    if (!R.isNull(r.revenue)) refRev += r.revenue;
    refCount++;
  }
  const rep = R.buildReport(data, R.SAMPLE_SPECS.byRegion);
  eq('rowCount is 24', rep.rowCount, 24);
  const unitsCol = rep.columns.findIndex((c) => c.key === 'units');
  const revCol = rep.columns.findIndex((c) => c.key === 'revenue');
  approx('grand total units matches reference', rep.grandTotals[unitsCol], refUnits);
  approx('grand total revenue matches reference', rep.grandTotals[revCol], refRev);

  // subtotals roll up to the grand total for SUM columns
  const subUnits = rep.root.children.reduce((a, c) => a + c.subtotals[unitsCol], 0);
  approx('region subtotals of units roll up', subUnits, refUnits);

  // groups are the four regions, in sorted order
  eq('four region groups', rep.root.children.length, 4);
  eq('regions sorted', rep.root.children.map((c) => c.value), ['East', 'North', 'South', 'West']);

  // multi-level grouping
  const rep2 = R.buildReport(data, R.SAMPLE_SPECS.byRegionRep);
  const north = rep2.root.children.find((c) => c.value === 'North');
  ok('North has nested rep groups', north.children.length >= 2);
  // the NULL rep becomes a "(none)" group, sorted last within North
  const repVals = north.children.map((c) => c.value);
  eq('null rep is a group (value null)', repVals[repVals.length - 1], null);
}

// ---------------------------------------------------------------------------
section('Flatten + subtotal placement');
// ---------------------------------------------------------------------------
{
  const rep = R.buildReport(R.SAMPLE_DATA, R.SAMPLE_SPECS.byRegion);
  const flat = R.flattenReport(rep);
  const kinds = flat.map((l) => l.kind);
  ok('starts with a group header', kinds[0] === 'groupHeader');
  ok('ends with the grand total', kinds[kinds.length - 1] === 'grandTotal');
  eq('one group header per region', kinds.filter((k) => k === 'groupHeader').length, 4);
  eq('one subtotal per region', kinds.filter((k) => k === 'subtotal').length, 4);
  eq('one grand total', kinds.filter((k) => k === 'grandTotal').length, 1);
  eq('data lines == row count', kinds.filter((k) => k === 'data').length, rep.rowCount);

  // every data line carries its enclosing group header as an ancestor
  const everyDataHasAncestor = flat.filter((l) => l.kind === 'data')
    .every((l) => l.ancestors.length >= 1 && l.ancestors[0].kind === 'groupHeader');
  ok('data lines carry a group-header ancestor', everyDataHasAncestor);

  // subtotal label lands in the first NON-aggregated column (Rep)
  const firstSub = flat.find((l) => l.kind === 'subtotal');
  ok('subtotal label in first text column', /^Subtotal — /.test(firstSub.cells[0]));
  const unitsCol = rep.columns.findIndex((c) => c.key === 'units');
  ok('subtotal shows a value in the units column', firstSub.cells[unitsCol] !== '');
}

// ---------------------------------------------------------------------------
section('Pagination — repeated headers, no orphans');
// ---------------------------------------------------------------------------
{
  const rep = R.buildReport(R.SAMPLE_DATA, R.SAMPLE_SPECS.byRegionRep);
  const flat = R.flattenReport(rep);
  const perPage = 8;
  const pages = R.paginate(rep, { rowsPerPage: perPage, lines: flat });
  ok('splits into multiple pages', pages.length > 1);

  // invariant 1: dropping continued lines reproduces the flat stream exactly
  const rebuilt = [];
  for (const pg of pages) for (const l of pg) if (!l.continued) rebuilt.push(l);
  eq('non-continued lines reproduce flat length', rebuilt.length, flat.length);
  ok('non-continued lines are the same objects in order',
    rebuilt.every((l, i) => l === flat[i]));

  // invariant 2: no page exceeds perPage *content* lines (continued headers are extra)
  const contentOk = pages.every((pg) => pg.filter((l) => !l.continued).length <= perPage);
  ok('no page exceeds perPage content lines', contentOk);

  // invariant 3: on every page, each data/subtotal line is preceded on that page
  // by a group header (original or continued) for its group.
  let orphan = false;
  for (const pg of pages) {
    const seenGroups = new Set();
    for (const l of pg) {
      if (l.kind === 'groupHeader') seenGroups.add(l.label);
      if (l.kind === 'data' || l.kind === 'subtotal') {
        const anc = l.ancestors.map((a) => a.label);
        if (anc.length && !anc.some((a) => seenGroups.has(a))) orphan = true;
      }
    }
  }
  ok('no data/subtotal is orphaned from its header', !orphan);

  // a group split across a page break is re-announced with "(continued)"
  const anyContinued = pages.some((pg) => pg.some((l) => l.continued));
  ok('a split group is re-announced as continued', anyContinued);
}

// ---------------------------------------------------------------------------
section('Formatting');
// ---------------------------------------------------------------------------
{
  eq('thousands in integers', R.formatNumber(1234567), '1,234,567');
  eq('two-decimal number', R.formatNumber(1234.5, 2), '1,234.50');
  eq('currency', R.formatCurrency(1234.5), '$1,234.50');
  eq('negative currency', R.formatCurrency(-99.9), '-$99.90');
  eq('currency zero', R.formatCurrency(0), '$0.00');
  eq('null cell -> em dash for display', R.formatCell(null, 'number', '—'), '—');
  eq('null cell -> blank for csv', R.formatCell(null, 'number', ''), '');
  eq('integer number cell no decimals', R.formatCell(10, 'number', '—'), '10');
  eq('float number cell gets decimals', R.formatCell(10.5, 'number', '—'), '10.50');
}

// ---------------------------------------------------------------------------
section('CSV — escaping and structure');
// ---------------------------------------------------------------------------
{
  eq('plain field', R.csvField('abc'), 'abc');
  eq('comma field quoted', R.csvField('a,b'), '"a,b"');
  eq('quote doubled', R.csvField('a"b'), '"a""b"');
  eq('newline field quoted', R.csvField('a\nb'), '"a\nb"');

  const rep = R.buildReport(R.SAMPLE_DATA, R.SAMPLE_SPECS.byRegion);
  const csv = R.renderCsv(rep);
  const lines = csv.split('\r\n').filter(Boolean);
  ok('CSV header present', lines[0].startsWith('Rep,Category,Product'));
  ok('CSV has group header rows', lines.some((l) => l.startsWith('# Region: ')));
  ok('CSV has a NULL rendered as empty (consecutive commas)', csv.includes(',,'));
  // a NULL units data row should NOT print — for units
  ok('uses CRLF line endings', csv.includes('\r\n'));
}

// ---------------------------------------------------------------------------
section('HTML — structure and escaping');
// ---------------------------------------------------------------------------
{
  const rep = R.buildReport(R.SAMPLE_DATA, R.SAMPLE_SPECS.byRegion);
  const html = R.renderHtml(rep);
  ok('is a full document', html.startsWith('<!doctype html>'));
  ok('has a report table', html.includes('<table class="report">'));
  ok('has group header rows', html.includes('class="grp'));
  ok('has a grand total row', html.includes('class="grand"'));
  ok('numbers right-aligned class', html.includes('class="num"'));

  // escaping: a nasty value must not break out
  const evil = R.buildReport([{ g: 'A', name: '<script>x</script>', v: 1 }], {
    title: 'Evil & <bad>',
    columns: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'v', label: 'V', type: 'number', agg: 'sum' }],
    groupBy: ['g'],
  });
  const eh = R.renderHtml(evil);
  ok('script tag escaped in data', !eh.includes('<script>x</script>') && eh.includes('&lt;script&gt;'));
  ok('title escaped', eh.includes('Evil &amp; &lt;bad&gt;'));
  const frag = R.renderHtml(evil, { fragment: true });
  ok('fragment mode returns just the table', frag.startsWith('<table') && !frag.includes('<!doctype'));
}

// ---------------------------------------------------------------------------
section('Helvetica AFM string widths');
// ---------------------------------------------------------------------------
{
  // widths are per-1000; at 1000pt a glyph's width in points equals its AFM value
  approx('space width (Helvetica 278)', R.stringWidth(' ', 1000, false), 278);
  approx('"0" width 556', R.stringWidth('0', 1000, false), 556);
  approx('"W" width 944', R.stringWidth('W', 1000, false), 944);
  approx('"i" width 222', R.stringWidth('i', 1000, false), 222);
  approx('bold "W" width 944', R.stringWidth('W', 1000, true), 944);
  approx('bold "!" width 333 (differs from regular 278)', R.stringWidth('!', 1000, true), 333);
  // "$1,234.50" width: 556+556+278+556+556+556+278+556+556 = 4448
  approx('currency string width', R.stringWidth('$1,234.50', 1000, false), 4448);
  ok('scales with font size', Math.abs(R.stringWidth('ABC', 20, false) - R.stringWidth('ABC', 10, false) * 2) < 1e-9);
  ok('unknown glyph falls back to "?" width', R.stringWidth('—', 1000, false) === R.stringWidth('?', 1000, false));
}

// ---------------------------------------------------------------------------
section('PDF — graded by an independent reader (parsePdf)');
// ---------------------------------------------------------------------------
let pdfBytes = null;
{
  const rep = R.buildReport(R.SAMPLE_DATA, R.SAMPLE_SPECS.byRegionRep);
  pdfBytes = R.renderPdf(rep);
  ok('renderPdf returns a Uint8Array', pdfBytes instanceof Uint8Array);
  ok('starts with %PDF-1.', String.fromCharCode(pdfBytes[0], pdfBytes[1], pdfBytes[2], pdfBytes[3], pdfBytes[4]) === '%PDF-');

  const info = R.parsePdf(pdfBytes);
  ok('header version parsed', /^1\.\d/.test(info.version));
  ok('has at least one page', info.pageCount >= 1);
  ok('every xref offset lands on its object (no throw above)', info.objCount > 0);
  eq('object count = 4 + 2*pages', info.objCount, 4 + 2 * info.pageCount);
  eq('trailer /Size = objCount + 1 (free obj 0)', info.size, info.objCount + 1);
  eq('/Root is object 1', info.root, 1);
  ok('every stream /Length is byte-exact', info.streamLenOk === true);

  // force a multi-page document and re-check the xref stays exact
  const big = [];
  for (let i = 0; i < 200; i++) big.push({ region: 'R' + (i % 5), rep: 'Rep' + (i % 7), units: i, unitPrice: 1, revenue: i });
  const repBig = R.buildReport(big, {
    title: 'Big', columns: R.SAMPLE_COLUMNS, groupBy: ['region', 'rep'],
  });
  const bigPdf = R.renderPdf(repBig);
  const bigInfo = R.parsePdf(bigPdf);
  ok('multi-page PDF has many pages', bigInfo.pageCount > 2);
  ok('multi-page xref still exact (no throw)', bigInfo.objCount === 4 + 2 * bigInfo.pageCount);
  ok('multi-page stream lengths exact', bigInfo.streamLenOk);

  // corruption guard: shift one digit of object 1's xref offset; parsePdf must
  // reject it, because the offset no longer lands on "1 0 obj".
  let caught = false;
  try {
    const bad = Uint8Array.from(bigPdf);
    const s = (() => { let t = ''; for (let i = 0; i < bad.length; i++) t += String.fromCharCode(bad[i]); return t; })();
    const xo = bigInfo.xrefOffset;
    const afterKw = s.indexOf('\n', xo) + 1;     // past 'xref'
    const afterHdr = s.indexOf('\n', afterKw) + 1; // past the '0 N' subsection header
    const obj1Entry = afterHdr + 20;             // skip the 20-byte free entry
    bad[obj1Entry] = bad[obj1Entry] === 0x39 ? 0x30 : bad[obj1Entry] + 1; // bump a digit
    R.parsePdf(bad);
  } catch (e) { caught = true; }
  ok('parsePdf rejects a corrupted xref offset', caught);
}

// ---------------------------------------------------------------------------
section('PDF cross-check vs external tools (if installed)');
// ---------------------------------------------------------------------------
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cp = require('child_process');
  const tmp = path.join(os.tmpdir(), 'report-gen-test-' + process.pid + '.pdf');
  try {
    fs.writeFileSync(tmp, Buffer.from(pdfBytes));
    const have = (cmd) => { try { cp.execSync('command -v ' + cmd, { stdio: 'ignore' }); return true; } catch (e) { return false; } };

    if (have('qpdf')) {
      let okCheck = true;
      try { cp.execSync('qpdf --check ' + tmp, { stdio: 'ignore' }); } catch (e) { okCheck = false; }
      ok('qpdf --check accepts the file', okCheck);
    } else {
      console.log('  (qpdf not installed — skipping)');
    }

    if (have('pdftotext')) {
      const txt = cp.execSync('pdftotext ' + tmp + ' -', { encoding: 'utf8' });
      ok('pdftotext recovers the title', txt.includes('Sales by Region'));
      ok('pdftotext recovers a region label', /North|South|East|West/.test(txt));
      ok('pdftotext recovers "Grand total"', txt.includes('Grand total'));
    } else {
      console.log('  (pdftotext not installed — skipping)');
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
section('renderText smoke');
// ---------------------------------------------------------------------------
{
  const rep = R.buildReport(R.SAMPLE_DATA, R.SAMPLE_SPECS.byCategory);
  const txt = R.renderText(rep);
  ok('text report has title', txt.includes('Sales by Category'));
  ok('text report has a grand total', txt.includes('Grand total'));
  ok('text report groups by category', /Hardware|Software/.test(txt));
}

// ---------------------------------------------------------------------------
console.log('\n----------------------------------------');
console.log(pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
if (fail) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
else console.log('All checks passed.');
