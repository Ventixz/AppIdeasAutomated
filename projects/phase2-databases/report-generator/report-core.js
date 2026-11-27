'use strict';
/*
 * report-core.js — a banded / control-break report generator.
 *
 * The task (karan/Projects, Databases): "Use a database system to produce a
 * report. Create tables that hold records. Then enter records, and then produce
 * a report from the records using some complex query (e.g. SQL). Format the
 * report nicely."
 *
 * A flat SQL result grid is NOT a report. A report groups sorted records, breaks
 * into bands, and prints a subtotal every time a group changes and a grand total
 * at the end — structure that lives OUTSIDE relational algebra, which is exactly
 * why report writers (RPG, Crystal, Jasper, SSRS) exist on top of the database.
 * This file is that layer, hand-written with no dependencies, running in Node and
 * the browser.
 *
 * Three things here are genuinely hard; see README.md:
 *   1. a control break CASCADES (an outer break forces every inner break) and
 *      footers unwind innermost-first while headers nest outermost-first — and
 *      the rows MUST be sorted by the full group key or a group silently splits.
 *   2. aggregates and NULL: AVG of nothing is NULL (not 0, not NaN); SUM skips
 *      NULLs; money is integer cents so the grand total reconciles to the cent;
 *      AVG is weighted (sum/count), never the mean of the group means.
 *   3. a crosstab's column axis is the sorted UNION of every distinct value, an
 *      empty cell (null) is not a zero cell, and row/column/grand totals must all
 *      reconcile — then the monospace output is aligned so it reads as a report.
 */

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatNumber(n, decimals = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  let [intPart, frac] = fixed.split('.');
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + intPart + (frac ? '.' + frac : '');
}

function formatMoney(cents, opts = {}) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '';
  const symbol = opts.symbol !== undefined ? opts.symbol : '$';
  const decimals = opts.decimals !== undefined ? opts.decimals : 2;
  const rounded = Math.round(cents); // avg of cents can be fractional
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  const dollars = formatNumber(whole, 0);
  const frac = decimals > 0 ? '.' + String(rem).padStart(2, '0') : '';
  return (neg ? '-' : '') + symbol + dollars + frac;
}

// Format a single value according to a column/aggregate type descriptor.
function formatValue(value, type, opts = {}) {
  if (value === null || value === undefined) return opts.nullText !== undefined ? opts.nullText : '';
  switch (type) {
    case 'money': return formatMoney(value, opts);
    case 'int': return formatNumber(value, 0);
    case 'number': return formatNumber(value, opts.decimals !== undefined ? opts.decimals : 2);
    case 'percent': return formatNumber(value, opts.decimals !== undefined ? opts.decimals : 1) + '%';
    case 'date': return String(value);
    default: return String(value);
  }
}

function isRightAligned(type) {
  return type === 'money' || type === 'int' || type === 'number' || type === 'percent';
}

function padLeft(s, w) { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }
function padRight(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }
function truncate(s, w) {
  s = String(s);
  if (w <= 0) return '';
  return s.length <= w ? s : (w <= 1 ? s.slice(0, w) : s.slice(0, w - 1) + '…');
}

// ---------------------------------------------------------------------------
// Aggregation — the SQL-faithful core
// ---------------------------------------------------------------------------

function isNullish(v) { return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)); }

function compareValues(a, b) {
  // nulls sort last
  const an = isNullish(a), bn = isNullish(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a), bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/*
 * aggregate(rows, fn, col)
 *   count         -> COUNT(*) : number of rows (col ignored)
 *   count,col     -> COUNT(col): rows where col is NOT NULL
 *   countDistinct -> distinct non-null values of col
 *   sum/avg/min/max over the NON-NULL values of col
 *
 * SQL semantics on the empty/all-null set:
 *   count -> 0, countDistinct -> 0, but sum/avg/min/max -> NULL (never NaN, never 0).
 */
function aggregate(rows, fn, col) {
  if (fn === 'count' && (col === undefined || col === null)) return rows.length;
  const vals = [];
  for (const r of rows) {
    const v = r[col];
    if (!isNullish(v)) vals.push(v);
  }
  switch (fn) {
    case 'count': return vals.length;              // COUNT(col) = non-null count
    case 'countDistinct': return new Set(vals).size;
    case 'sum': {
      if (vals.length === 0) return null;          // SUM(empty) = NULL
      let s = 0;
      for (const v of vals) s += v;
      return s;
    }
    case 'avg': {
      if (vals.length === 0) return null;          // AVG(empty) = NULL, not 0/0
      let s = 0;
      for (const v of vals) s += v;
      return s / vals.length;                      // weighted by definition (sum/count)
    }
    case 'min': {
      if (vals.length === 0) return null;
      let m = vals[0];
      for (const v of vals) if (compareValues(v, m) < 0) m = v;
      return m;
    }
    case 'max': {
      if (vals.length === 0) return null;
      let m = vals[0];
      for (const v of vals) if (compareValues(v, m) > 0) m = v;
      return m;
    }
    default: throw new Error('unknown aggregate: ' + fn);
  }
}

function computeAggs(rows, aggSpecs) {
  const out = {};
  for (const a of aggSpecs) out[a.id] = aggregate(rows, a.fn, a.col);
  return out;
}

// ---------------------------------------------------------------------------
// Group resolution (plain column, or a derived key like month(date))
// ---------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function resolveGroup(g) {
  if (typeof g === 'string') {
    return {
      id: g,
      label: g,
      getKey: (row) => (isNullish(row[g]) ? '\u0000__NULL__' : String(row[g])),
      getDisplay: (row) => (isNullish(row[g]) ? '(none)' : String(row[g])),
      getSort: (row) => row[g],
    };
  }
  // derived: { col, key: 'month'|'year'|'date'|'first', label }
  const col = g.col;
  const kind = g.key || 'date';
  const label = g.label || col;
  function derive(row) {
    const v = row[col];
    if (isNullish(v)) return { k: '\u0000__NULL__', d: '(none)', s: null };
    const s = String(v);
    if (kind === 'year') return { k: s.slice(0, 4), d: s.slice(0, 4), s: s.slice(0, 4) };
    if (kind === 'month') {
      const ym = s.slice(0, 7);
      const mi = parseInt(s.slice(5, 7), 10) - 1;
      const name = (mi >= 0 && mi < 12) ? MONTHS[mi] + ' ' + s.slice(0, 4) : ym;
      return { k: ym, d: name, s: ym };
    }
    if (kind === 'first') {
      const c = s.charAt(0).toUpperCase();
      return { k: c, d: c, s: c };
    }
    return { k: s, d: s, s: s };
  }
  return {
    id: label,
    label,
    getKey: (row) => derive(row).k,
    getDisplay: (row) => derive(row).d,
    getSort: (row) => derive(row).s,
  };
}

// ---------------------------------------------------------------------------
// Sorting & filtering
// ---------------------------------------------------------------------------

function stableSort(arr, cmp) {
  return arr
    .map((v, i) => [v, i])
    .sort((a, b) => cmp(a[0], b[0]) || (a[1] - b[1]))
    .map((p) => p[0]);
}

function makeWherePredicate(where) {
  if (!where || where.length === 0) return () => true;
  const clauses = where.map((c) => {
    const { col, op } = c;
    let val = c.value;
    switch (op) {
      case '=': return (r) => r[col] === val;
      case '!=': return (r) => r[col] !== val;
      case '>': return (r) => !isNullish(r[col]) && r[col] > val;
      case '>=': return (r) => !isNullish(r[col]) && r[col] >= val;
      case '<': return (r) => !isNullish(r[col]) && r[col] < val;
      case '<=': return (r) => !isNullish(r[col]) && r[col] <= val;
      case 'in': {
        const set = new Set(Array.isArray(val) ? val : [val]);
        return (r) => set.has(r[col]);
      }
      case 'contains': {
        const needle = String(val).toLowerCase();
        return (r) => !isNullish(r[col]) && String(r[col]).toLowerCase().includes(needle);
      }
      default: throw new Error('unknown where op: ' + op);
    }
  });
  return (r) => clauses.every((f) => f(r));
}

// ---------------------------------------------------------------------------
// buildReport — the control-break engine
// ---------------------------------------------------------------------------

/*
 * spec = {
 *   groups: ['region', {col:'date', key:'month'}, ...],  // outer -> inner
 *   aggregates: [{ id, fn, col, label, type, decimals }],
 *   detail: ['product', 'units', 'amountCents'] | null,  // null = summary only
 *   sort: [{ col, dir }],          // detail ordering within the finest group
 *   where: [{ col, op, value }] | predicate fn,
 *   having: { level, test(aggs) },  // drop groups (at `level`) failing the test
 *   title, subtitle
 * }
 */
function buildReport(data, spec) {
  const groups = (spec.groups || []).map(resolveGroup);
  const aggs = spec.aggregates || [];
  const colDefs = indexColumns(data.columns);
  // Prefer the table's friendly column label for a plain-column group.
  for (const grp of groups) {
    if (colDefs[grp.id] && colDefs[grp.id].label) grp.label = colDefs[grp.id].label;
  }

  let rows = data.rows.slice();

  // WHERE
  const pred = typeof spec.where === 'function' ? spec.where : makeWherePredicate(spec.where);
  rows = rows.filter(pred);

  // HAVING — drop whole groups (at the given level) whose aggregates fail.
  if (spec.having && groups.length) {
    const level = Math.min(spec.having.level != null ? spec.having.level : groups.length - 1, groups.length - 1);
    const buckets = new Map();
    for (const r of rows) {
      const key = groups.slice(0, level + 1).map((g) => g.getKey(r)).join('\u0001');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
    const keep = new Set();
    for (const [key, grows] of buckets) {
      if (spec.having.test(computeAggs(grows, aggs))) keep.add(key);
    }
    rows = rows.filter((r) => keep.has(groups.slice(0, level + 1).map((g) => g.getKey(r)).join('\u0001')));
  }

  // SORT: by every group key (outer->inner), then the requested detail order.
  // Without this a group can appear in two bands and the report silently lies.
  const sortCmp = (a, b) => {
    for (const g of groups) {
      const c = compareValues(g.getSort(a), g.getSort(b));
      if (c) return c;
    }
    for (const s of (spec.sort || [])) {
      let c = compareValues(a[s.col], b[s.col]);
      if (s.dir === 'desc') c = -c;
      if (c) return c;
    }
    return 0;
  };
  rows = stableSort(rows, sortCmp);

  const lines = [];
  const acc = groups.map(() => []); // rows accumulated per currently-open level
  const curDisplay = new Array(groups.length).fill(null);
  let prevKeys = null;

  function emitFooter(level) {
    const grows = acc[level];
    lines.push({
      kind: 'groupFooter',
      level,
      group: groups[level].label,
      display: curDisplay[level],
      count: grows.length,
      aggregates: computeAggs(grows, aggs),
    });
    acc[level] = [];
  }

  for (const row of rows) {
    const keys = groups.map((g) => g.getKey(row));
    // find the first level that differs from the currently open groups
    let brk = 0;
    if (prevKeys) {
      while (brk < groups.length && prevKeys[brk] === keys[brk]) brk++;
      // close open footers from the deepest level down to the break (inner first)
      for (let l = groups.length - 1; l >= brk; l--) emitFooter(l);
    }
    // open headers from the break outward->inward (outer first)
    for (let l = brk; l < groups.length; l++) {
      curDisplay[l] = groups[l].getDisplay(row);
      lines.push({ kind: 'groupHeader', level: l, group: groups[l].label, display: curDisplay[l] });
    }
    if (spec.detail) lines.push({ kind: 'detail', row });
    for (let l = 0; l < groups.length; l++) acc[l].push(row);
    prevKeys = keys;
  }
  // close everything still open
  if (prevKeys) for (let l = groups.length - 1; l >= 0; l--) emitFooter(l);

  return {
    title: spec.title || 'Report',
    subtitle: spec.subtitle || null,
    groups: groups.map((g) => g.label),
    aggregates: aggs,
    detail: spec.detail || null,
    columns: colDefs,
    lines,
    grandTotals: computeAggs(rows, aggs),
    rowCount: rows.length,
  };
}

function indexColumns(columns) {
  const byName = {};
  for (const c of (columns || [])) byName[c.name] = c;
  return byName;
}

function colType(report, name) {
  const c = report.columns[name];
  return c ? c.type : 'string';
}
function colLabel(report, name) {
  const c = report.columns[name];
  return c ? (c.label || c.name) : name;
}
function fmtDetail(report, name, value) {
  const c = report.columns[name] || { type: 'string' };
  return formatValue(value, c.type, c);
}
function fmtAgg(agg, value) {
  return formatValue(value, agg.type || 'number', agg);
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderText(report, opts = {}) {
  const out = [];
  const indentUnit = '  ';
  out.push(report.title);
  if (report.subtitle) out.push(report.subtitle);
  out.push('='.repeat(Math.max(report.title.length, report.subtitle ? report.subtitle.length : 0, 40)));

  // Precompute detail column widths (header + every detail value).
  let detailCols = report.detail || [];
  const widths = {};
  for (const name of detailCols) widths[name] = colLabel(report, name).length;
  for (const line of report.lines) {
    if (line.kind === 'detail') {
      for (const name of detailCols) {
        const s = fmtDetail(report, name, line.row[name]);
        if (s.length > widths[name]) widths[name] = s.length;
      }
    }
  }

  const detailIndent = indentUnit.repeat(report.groups.length);
  function detailHeaderLine() {
    const parts = detailCols.map((name) => {
      const label = colLabel(report, name);
      return isRightAligned(colType(report, name)) ? padLeft(label, widths[name]) : padRight(label, widths[name]);
    });
    return detailIndent + parts.join('  ');
  }

  let detailHeaderPending = false;
  for (const line of report.lines) {
    if (line.kind === 'groupHeader') {
      out.push(indentUnit.repeat(line.level) + line.group + ': ' + line.display);
      if (detailCols.length && line.level === report.groups.length - 1) detailHeaderPending = true;
    } else if (line.kind === 'detail') {
      if (detailHeaderPending) { out.push(detailHeaderLine()); detailHeaderPending = false; }
      const parts = detailCols.map((name) => {
        const s = fmtDetail(report, name, line.row[name]);
        return isRightAligned(colType(report, name)) ? padLeft(s, widths[name]) : padRight(s, widths[name]);
      });
      out.push(detailIndent + parts.join('  '));
    } else if (line.kind === 'groupFooter') {
      const aggText = report.aggregates
        .map((a) => a.label + ' ' + fmtAgg(a, line.aggregates[a.id]))
        .join('   ');
      out.push(indentUnit.repeat(line.level) + 'Total ' + line.display +
        ' (' + line.count + (line.count === 1 ? ' record' : ' records') + ')' +
        (aggText ? '   ' + aggText : ''));
      detailHeaderPending = false;
    }
  }

  out.push('-'.repeat(40));
  const grand = report.aggregates
    .map((a) => a.label + ' ' + fmtAgg(a, report.grandTotals[a.id]))
    .join('   ');
  out.push('GRAND TOTAL (' + report.rowCount +
    (report.rowCount === 1 ? ' record' : ' records') + ')' + (grand ? '   ' + grand : ''));
  return out.join('\n');
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// CSV = the re-importable detail table, with each group column prepended, plus a
// trailing subtotal/grand-total section (marked in a leading column) so the
// report's numbers survive the export too.
function renderCsv(report) {
  const rows = [];
  const detailCols = report.detail || [];
  const header = ['_band', ...report.groups, ...detailCols, ...report.aggregates.map((a) => a.label)];
  rows.push(header.map(csvCell).join(','));

  const openVals = {}; // current group display per level
  for (const line of report.lines) {
    if (line.kind === 'groupHeader') {
      openVals[line.level] = line.display;
    } else if (line.kind === 'detail') {
      const g = report.groups.map((_, i) => openVals[i] != null ? openVals[i] : '');
      const d = detailCols.map((name) => rawCsvValue(report, name, line.row[name]));
      const a = report.aggregates.map(() => '');
      rows.push(['detail', ...g, ...d, ...a].map(csvCell).join(','));
    } else if (line.kind === 'groupFooter') {
      const g = report.groups.map((_, i) => i < line.level ? (openVals[i] != null ? openVals[i] : '') : (i === line.level ? line.display : ''));
      const d = detailCols.map(() => '');
      const a = report.aggregates.map((ag) => rawAggValue(ag, line.aggregates[ag.id]));
      rows.push(['subtotal', ...g, ...d, ...a].map(csvCell).join(','));
    }
  }
  const g = report.groups.map(() => '');
  const d = detailCols.map(() => '');
  const a = report.aggregates.map((ag) => rawAggValue(ag, report.grandTotals[ag.id]));
  rows.push(['total', ...g, ...d, ...a].map(csvCell).join(','));
  return rows.join('\n');
}

function rawCsvValue(report, name, value) {
  if (isNullish(value)) return '';
  const c = report.columns[name] || { type: 'string' };
  if (c.type === 'money') return (value / 100).toFixed(2);
  return value;
}
function rawAggValue(agg, value) {
  if (isNullish(value)) return '';
  if (agg.type === 'money') return (value / 100).toFixed(2);
  return value;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHtml(report) {
  const detailCols = report.detail || [];
  const parts = [];
  parts.push('<div class="report">');
  parts.push('<h2 class="report-title">' + escapeHtml(report.title) + '</h2>');
  if (report.subtitle) parts.push('<p class="report-subtitle">' + escapeHtml(report.subtitle) + '</p>');

  let detailOpen = false;
  let lastDetailLevel = report.groups.length - 1;
  function closeDetail() { if (detailOpen) { parts.push('</tbody></table>'); detailOpen = false; } }

  for (const line of report.lines) {
    if (line.kind === 'groupHeader') {
      closeDetail();
      parts.push('<div class="band band-l' + line.level + '"><span class="band-label">' +
        escapeHtml(line.group) + '</span> <span class="band-value">' + escapeHtml(line.display) + '</span></div>');
    } else if (line.kind === 'detail') {
      if (!detailOpen) {
        parts.push('<table class="detail band-l' + (lastDetailLevel + 1) + '"><thead><tr>' +
          detailCols.map((n) => '<th class="' + (isRightAligned(colType(report, n)) ? 'num' : 'txt') + '">' +
            escapeHtml(colLabel(report, n)) + '</th>').join('') + '</tr></thead><tbody>');
        detailOpen = true;
      }
      parts.push('<tr>' + detailCols.map((n) => {
        const right = isRightAligned(colType(report, n));
        return '<td class="' + (right ? 'num' : 'txt') + '">' + escapeHtml(fmtDetail(report, n, line.row[n])) + '</td>';
      }).join('') + '</tr>');
    } else if (line.kind === 'groupFooter') {
      closeDetail();
      const aggs = report.aggregates.map((a) =>
        '<span class="agg"><span class="agg-label">' + escapeHtml(a.label) + '</span> ' +
        escapeHtml(fmtAgg(a, line.aggregates[a.id])) + '</span>').join(' ');
      parts.push('<div class="footer footer-l' + line.level + '">Total ' + escapeHtml(line.display) +
        ' <span class="count">(' + line.count + ')</span> ' + aggs + '</div>');
    }
  }
  closeDetail();
  const grand = report.aggregates.map((a) =>
    '<span class="agg"><span class="agg-label">' + escapeHtml(a.label) + '</span> ' +
    escapeHtml(fmtAgg(a, report.grandTotals[a.id])) + '</span>').join(' ');
  parts.push('<div class="grand-total">GRAND TOTAL <span class="count">(' + report.rowCount + ')</span> ' + grand + '</div>');
  parts.push('</div>');
  return parts.join('\n');
}

function renderMarkdown(report) {
  const out = [];
  out.push('# ' + report.title);
  if (report.subtitle) out.push('', '_' + report.subtitle + '_');
  const detailCols = report.detail || [];
  for (const line of report.lines) {
    if (line.kind === 'groupHeader') {
      out.push('', '#'.repeat(Math.min(6, line.level + 2)) + ' ' + line.group + ': ' + line.display);
    } else if (line.kind === 'detail') {
      // handled as a table built lazily below — simplest: inline a bullet list
      const cells = detailCols.map((n) => colLabel(report, n) + ': ' + fmtDetail(report, n, line.row[n]));
      out.push('- ' + cells.join(', '));
    } else if (line.kind === 'groupFooter') {
      const aggs = report.aggregates.map((a) => '**' + a.label + '** ' + fmtAgg(a, line.aggregates[a.id])).join(' · ');
      out.push('', '> **Total ' + line.display + '** (' + line.count + ') — ' + aggs);
    }
  }
  const grand = report.aggregates.map((a) => '**' + a.label + '** ' + fmtAgg(a, report.grandTotals[a.id])).join(' · ');
  out.push('', '---', '', '**GRAND TOTAL** (' + report.rowCount + ') — ' + grand);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Crosstab / pivot
// ---------------------------------------------------------------------------

/*
 * crosstab(data, { rowDim, colDim, fn, col, type })
 *   rowDim/colDim: column names (or resolved group specs)
 *   fn/col: the aggregate per cell (e.g. sum of amountCents, or count(*))
 * Returns { rowKeys, colKeys, cell(r,c), rowTotals, colTotals, grandTotal }.
 * colKeys is the sorted UNION across ALL rows; a cell with no matching rows is
 * null (NOT 0); totals reconcile: sum(rowTotals) === sum(colTotals) === grand.
 */
function crosstab(data, spec) {
  const rowG = resolveGroup(spec.rowDim);
  const colG = resolveGroup(spec.colDim);
  const fn = spec.fn || 'count';
  const col = spec.col;
  // Prefer the table's friendly column labels for the axes.
  const colDefs = indexColumns(data.columns);
  if (colDefs[rowG.id] && colDefs[rowG.id].label) rowG.label = colDefs[rowG.id].label;
  if (colDefs[colG.id] && colDefs[colG.id].label) colG.label = colDefs[colG.id].label;

  let rows = data.rows.slice();
  const pred = typeof spec.where === 'function' ? spec.where : makeWherePredicate(spec.where);
  rows = rows.filter(pred);

  const buckets = new Map();      // "rowKey\u0001colKey" -> rows[]
  const rowKeyInfo = new Map();   // key -> {display, sort}
  const colKeyInfo = new Map();
  for (const r of rows) {
    const rk = rowG.getKey(r), ck = colG.getKey(r);
    if (!rowKeyInfo.has(rk)) rowKeyInfo.set(rk, { display: rowG.getDisplay(r), sort: rowG.getSort(r) });
    if (!colKeyInfo.has(ck)) colKeyInfo.set(ck, { display: colG.getDisplay(r), sort: colG.getSort(r) });
    const k = rk + '\u0001' + ck;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }

  const rowKeys = [...rowKeyInfo.keys()].sort((a, b) => compareValues(rowKeyInfo.get(a).sort, rowKeyInfo.get(b).sort));
  const colKeys = [...colKeyInfo.keys()].sort((a, b) => compareValues(colKeyInfo.get(a).sort, colKeyInfo.get(b).sort));

  const cells = {};
  for (const rk of rowKeys) {
    cells[rk] = {};
    for (const ck of colKeys) {
      const b = buckets.get(rk + '\u0001' + ck);
      cells[rk][ck] = b ? aggregate(b, fn, col) : null; // null, never a phantom 0
    }
  }

  // Totals computed from the raw rows (not by summing possibly-null cells), so
  // they stay correct for avg/count/min/max too.
  const rowTotals = {}, colTotals = {};
  for (const rk of rowKeys) rowTotals[rk] = aggregate(rows.filter((r) => rowG.getKey(r) === rk), fn, col);
  for (const ck of colKeys) colTotals[ck] = aggregate(rows.filter((r) => colG.getKey(r) === ck), fn, col);
  const grandTotal = aggregate(rows, fn, col);

  return {
    rowDim: rowG.label, colDim: colG.label,
    fn, col, type: spec.type || (fn === 'count' || fn === 'countDistinct' ? 'int' : 'number'),
    rowKeys, colKeys,
    rowKeyInfo, colKeyInfo,
    cells, rowTotals, colTotals, grandTotal,
    rowCount: rows.length,
  };
}

function crosstabValue(ct, value) {
  if (isNullish(value)) return '';
  return formatValue(value, ct.type, {});
}

function renderCrosstabText(ct, opts = {}) {
  const nullCell = opts.nullCell !== undefined ? opts.nullCell : '·';
  const rowHeader = ct.rowDim + ' \\ ' + ct.colDim;
  const colLabels = ct.colKeys.map((ck) => ct.colKeyInfo.get(ck).display);
  const rowLabels = ct.rowKeys.map((rk) => ct.rowKeyInfo.get(rk).display);

  // widths
  let w0 = rowHeader.length;
  for (const rl of rowLabels) w0 = Math.max(w0, rl.length);
  w0 = Math.max(w0, 'Total'.length);
  const colW = ct.colKeys.map((ck, i) => {
    let w = colLabels[i].length;
    for (const rk of ct.rowKeys) {
      const v = ct.cells[rk][ck];
      w = Math.max(w, (isNullish(v) ? nullCell : crosstabValue(ct, v)).length);
    }
    w = Math.max(w, crosstabValue(ct, ct.colTotals[ck]).length);
    return w;
  });
  let totW = 'Total'.length;
  for (const rk of ct.rowKeys) totW = Math.max(totW, crosstabValue(ct, ct.rowTotals[rk]).length);
  totW = Math.max(totW, crosstabValue(ct, ct.grandTotal).length);

  const out = [];
  out.push(padRight(rowHeader, w0) + ' | ' + colLabels.map((l, i) => padLeft(l, colW[i])).join('  ') + ' | ' + padLeft('Total', totW));
  out.push('-'.repeat(w0) + '-+-' + colW.map((w) => '-'.repeat(w)).join('--') + '-+-' + '-'.repeat(totW));
  ct.rowKeys.forEach((rk, ri) => {
    const cells = ct.colKeys.map((ck, ci) => {
      const v = ct.cells[rk][ck];
      return padLeft(isNullish(v) ? nullCell : crosstabValue(ct, v), colW[ci]);
    });
    out.push(padRight(rowLabels[ri], w0) + ' | ' + cells.join('  ') + ' | ' + padLeft(crosstabValue(ct, ct.rowTotals[rk]), totW));
  });
  out.push('-'.repeat(w0) + '-+-' + colW.map((w) => '-'.repeat(w)).join('--') + '-+-' + '-'.repeat(totW));
  out.push(padRight('Total', w0) + ' | ' +
    ct.colKeys.map((ck, ci) => padLeft(crosstabValue(ct, ct.colTotals[ck]), colW[ci])).join('  ') +
    ' | ' + padLeft(crosstabValue(ct, ct.grandTotal), totW));
  return out.join('\n');
}

function renderCrosstabHtml(ct, opts = {}) {
  const nullCell = opts.nullCell !== undefined ? opts.nullCell : '';
  const p = [];
  p.push('<table class="crosstab"><thead><tr><th class="corner">' +
    escapeHtml(ct.rowDim) + ' \\ ' + escapeHtml(ct.colDim) + '</th>');
  for (const ck of ct.colKeys) p.push('<th class="num">' + escapeHtml(ct.colKeyInfo.get(ck).display) + '</th>');
  p.push('<th class="num total">Total</th></tr></thead><tbody>');
  for (const rk of ct.rowKeys) {
    p.push('<tr><th class="rowhead">' + escapeHtml(ct.rowKeyInfo.get(rk).display) + '</th>');
    for (const ck of ct.colKeys) {
      const v = ct.cells[rk][ck];
      p.push('<td class="num' + (isNullish(v) ? ' empty' : '') + '">' + (isNullish(v) ? nullCell : escapeHtml(crosstabValue(ct, v))) + '</td>');
    }
    p.push('<td class="num total">' + escapeHtml(crosstabValue(ct, ct.rowTotals[rk])) + '</td></tr>');
  }
  p.push('<tr class="grandrow"><th class="rowhead">Total</th>');
  for (const ck of ct.colKeys) p.push('<td class="num total">' + escapeHtml(crosstabValue(ct, ct.colTotals[ck])) + '</td>');
  p.push('<td class="num grand">' + escapeHtml(crosstabValue(ct, ct.grandTotal)) + '</td></tr>');
  p.push('</tbody></table>');
  return p.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const API = {
  formatNumber, formatMoney, formatValue, isRightAligned,
  padLeft, padRight, truncate,
  isNullish, compareValues, aggregate, computeAggs,
  resolveGroup, stableSort, makeWherePredicate,
  buildReport, renderText, renderCsv, renderHtml, renderMarkdown,
  crosstab, renderCrosstabText, renderCrosstabHtml,
  MONTHS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.ReportCore = API;
