'use strict';
/*
 * report-core.js — a dependency-free reporting engine.
 *
 * Source 2 (karan/Projects) · Databases · "Report Generator".
 * Built by an automated Claude Code routine.
 *
 * Takes rows (as you'd get back from a database query), groups them, aggregates
 * them with SQL semantics, paginates the result, and renders it as plain text,
 * CSV, HTML, or a *real* PDF written from the bytes up (no PDF library). Runs in
 * Node and the browser from the same file.
 *
 * The three things that are actually hard live here:
 *   1. aggregation has SQL NULL semantics, and a grand total is NOT the total of
 *      the subtotals you printed (true for AVG/MIN/MAX).
 *   2. one layout model (flatten -> paginate) must drive every renderer, so the
 *      PDF repeats group/column headers and never orphans a subtotal.
 *   3. the PDF cross-reference table is absolute byte offsets that must be exact,
 *      and column alignment needs the *formatted* string width (Helvetica AFM).
 */

// ---------------------------------------------------------------------------
// 0. Tiny value helpers
// ---------------------------------------------------------------------------

function isNull(v) { return v === null || v === undefined; }

// ---------------------------------------------------------------------------
// 1. Aggregation — SQL semantics
// ---------------------------------------------------------------------------
//
// The whole point of SQL aggregates is how they treat NULL:
//   - SUM/MIN/MAX/AVG ignore NULL inputs entirely.
//   - AVG divides by the count of NON-NULL values, not by the row count.
//   - COUNT(*) counts rows; COUNT(col) counts non-null values of col.
//   - an aggregate over zero non-null inputs is NULL (except COUNT -> 0).
// Every aggregate reads the *raw* rows, so it is correct at any level and the
// grand total is computed from all rows, never by re-summing the subtotals.

const AGG = {
  sum(rows, key) {
    let s = 0, any = false;
    for (const r of rows) { const v = r[key]; if (!isNull(v)) { s += v; any = true; } }
    return any ? s : null;
  },
  avg(rows, key) {
    let s = 0, c = 0;
    for (const r of rows) { const v = r[key]; if (!isNull(v)) { s += v; c++; } }
    return c ? s / c : null;
  },
  min(rows, key) {
    let m = null;
    for (const r of rows) { const v = r[key]; if (!isNull(v)) m = (m === null ? v : Math.min(m, v)); }
    return m;
  },
  max(rows, key) {
    let m = null;
    for (const r of rows) { const v = r[key]; if (!isNull(v)) m = (m === null ? v : Math.max(m, v)); }
    return m;
  },
  // count(*) when key is null/omitted, else count(col)
  count(rows, key) {
    if (key == null) return rows.length;
    let c = 0; for (const r of rows) if (!isNull(r[key])) c++; return c;
  },
  countDistinct(rows, key) {
    const seen = new Set();
    for (const r of rows) { const v = r[key]; if (!isNull(v)) seen.add(v); }
    return seen.size;
  },
};

function aggregate(rows, key, fn) {
  const f = AGG[fn];
  if (!f) throw new Error('unknown aggregate: ' + fn);
  return f(rows, key);
}

// ---------------------------------------------------------------------------
// 2. Formatting
// ---------------------------------------------------------------------------

function groupThousands(intStr) {
  // intStr is the integer part (no sign). Insert commas every 3 from the right.
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumber(n, decimals) {
  if (isNull(n) || !isFinite(n)) return '';
  const neg = n < 0;
  let s = Math.abs(n).toFixed(decimals == null ? 0 : decimals);
  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot);
  return (neg ? '-' : '') + groupThousands(intPart) + frac;
}

function formatCurrency(n) {
  if (isNull(n) || !isFinite(n)) return '';
  const neg = n < 0;
  return (neg ? '-$' : '$') + formatNumber(Math.abs(n), 2);
}

// Format one cell value for display. `nullText` lets each renderer choose how a
// NULL looks (— for HTML/text, blank for CSV, - for PDF where the em dash isn't
// a single WinAnsi byte).
function formatCell(v, type, nullText) {
  if (isNull(v)) return nullText == null ? '' : nullText;
  switch (type) {
    case 'number': return formatNumber(v, Number.isInteger(v) ? 0 : 2);
    case 'currency': return formatCurrency(v);
    case 'date': return String(v);
    default: return String(v);
  }
}

function isNumeric(type) { return type === 'number' || type === 'currency'; }

// ---------------------------------------------------------------------------
// 3. The report model — grouping + subtotals + grand total
// ---------------------------------------------------------------------------
//
// spec = {
//   title, generatedAt,
//   columns: [{ key, label, type, agg? }],   // display columns, in order
//   groupBy: ['region', ...],                 // zero or more, outer -> inner
//   sortBy:  [{ key, dir }],                  // applied within the leaf group
//   filter:  row => bool,                     // optional
// }
// A column with `agg` participates in subtotal / grand-total rows.

function buildReport(data, spec) {
  const columns = spec.columns;
  const groupBy = spec.groupBy || [];
  const sortBy = spec.sortBy || [];

  let rows = data.slice();
  if (typeof spec.filter === 'function') rows = rows.filter(spec.filter);

  const cmp = makeComparator(groupBy, sortBy);
  rows.sort(cmp);

  const root = buildGroupNode(rows, groupBy, 0, columns, null, null);
  const grandTotals = aggRow(rows, columns);

  return {
    title: spec.title || 'Report',
    generatedAt: spec.generatedAt || null,
    columns,
    groupBy,
    root,
    grandTotals,
    rowCount: rows.length,
  };
}

function makeComparator(groupBy, sortBy) {
  const keys = [];
  for (const g of groupBy) keys.push({ key: g, dir: 'asc' });
  for (const s of sortBy) keys.push({ key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc' });
  return (a, b) => {
    for (const k of keys) {
      const c = cmpValues(a[k.key], b[k.key]) * (k.dir === 'desc' ? -1 : 1);
      if (c !== 0) return c;
    }
    return 0;
  };
}

// NULLs sort last (like most reporting defaults).
function cmpValues(a, b) {
  const an = isNull(a), bn = isNull(b);
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function buildGroupNode(rows, groupBy, depth, columns, key, value) {
  const node = { depth, key, value, rows, subtotals: aggRow(rows, columns) };
  if (depth >= groupBy.length) {
    node.leaf = true;
    node.dataRows = rows;
    node.children = null;
  } else {
    node.leaf = false;
    node.dataRows = null;
    const gk = groupBy[depth];
    const order = [];
    const buckets = new Map();
    for (const r of rows) {
      const gv = isNull(r[gk]) ? NULL_KEY : r[gk];
      if (!buckets.has(gv)) { buckets.set(gv, []); order.push(gv); }
      buckets.get(gv).push(r);
    }
    node.children = order.map((gv) =>
      buildGroupNode(buckets.get(gv), groupBy, depth + 1, columns, gk,
        gv === NULL_KEY ? null : gv));
  }
  return node;
}

const NULL_KEY = Symbol('null-group');

// Build the aggregate "cells" for a set of rows: one value per column (null for
// columns without an agg).
function aggRow(rows, columns) {
  return columns.map((c) => (c.agg ? aggregate(rows, c.key, c.agg) : null));
}

// ---------------------------------------------------------------------------
// 4. Flatten — turn the tree into an ordered list of layout lines
// ---------------------------------------------------------------------------
//
// Line kinds: 'groupHeader' | 'data' | 'subtotal' | 'grandTotal'.
// Each non-header line carries `ancestors`: the groupHeader lines enclosing it,
// so pagination can re-emit them (marked `continued`) at the top of a new page.

function flattenReport(report) {
  const lines = [];
  const stack = []; // active group header lines

  function walk(node) {
    if (node.key != null) {
      const hdr = {
        kind: 'groupHeader',
        depth: node.depth - 1,
        label: labelFor(node),
        groupKey: node.key,
        groupValue: node.value,
      };
      hdr.ancestors = stack.slice();
      lines.push(hdr);
      stack.push(hdr);
    }

    if (node.leaf) {
      for (const r of node.dataRows) {
        lines.push({
          kind: 'data',
          depth: node.depth,
          row: r,
          cells: report.columns.map((c) => formatCell(r[c.key], c.type, '—')),
          ancestors: stack.slice(),
        });
      }
    } else {
      for (const child of node.children) walk(child);
    }

    if (node.key != null) {
      const sub = {
        kind: 'subtotal',
        depth: node.depth - 1,
        label: 'Subtotal — ' + labelValue(node.value),
        cells: subtotalCells(report.columns, node.subtotals, 'Subtotal — ' + labelValue(node.value)),
        ancestors: stack.slice(),
      };
      lines.push(sub);
      stack.pop();
    }
  }

  // The root carries no key; walk its children (or its own leaf rows).
  walk(report.root);

  lines.push({
    kind: 'grandTotal',
    depth: -1,
    label: 'Grand total',
    cells: subtotalCells(report.columns, report.grandTotals, 'Grand total (' + report.rowCount + ' rows)'),
    ancestors: [],
  });

  return lines;
}

function labelValue(v) { return isNull(v) ? '(none)' : String(v); }

function labelFor(node) {
  return keyLabel(node.key) + ': ' + labelValue(node.value);
}

// camelCase / snake_case -> "Title Case": "unitPrice" -> "Unit Price".
function keyLabel(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// A subtotal / grand-total row: the label goes in the first non-aggregated
// column; aggregated columns show their value; everything else is blank.
function subtotalCells(columns, values, label) {
  const cells = [];
  let placedLabel = false;
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    if (c.agg) {
      cells.push(formatCell(values[i], c.type, ''));
    } else if (!placedLabel) {
      cells.push(label);
      placedLabel = true;
    } else {
      cells.push('');
    }
  }
  if (!placedLabel && cells.length) cells[0] = label; // all columns aggregated
  return cells;
}

// ---------------------------------------------------------------------------
// 5. Pagination — one model, repeated headers, no orphan subtotals
// ---------------------------------------------------------------------------
//
// Splits the flat line list into pages of at most `rowsPerPage` content lines.
// On every page after the first, any group that is still "open" at the page
// break has its header re-emitted (marked `continued`) so the reader always
// knows which group a row belongs to. A group header is never the last line on a
// page (orphan), and a subtotal never lands as the first line of a page without
// its header above it — both are achieved by re-emitting ancestors on carry-over.

function paginate(report, opts) {
  opts = opts || {};
  const perPage = Math.max(2, opts.rowsPerPage || 30);
  const flat = opts.lines || flattenReport(report);

  const pages = [];
  let cur = [];

  function startPageFor(line) {
    // continuation page: re-emit the enclosing group headers
    cur = [];
    for (const a of line.ancestors) {
      cur.push(Object.assign({}, a, { continued: true }));
    }
  }

  for (let i = 0; i < flat.length; i++) {
    const line = flat[i];

    if (cur.length >= perPage) {
      pages.push(cur);
      startPageFor(line);
    }

    // Orphan guard: a group header with no room for at least one following line
    // gets pushed to the next page (with its own ancestors re-emitted).
    if (line.kind === 'groupHeader' && cur.length >= perPage - 1 && pages.length >= 0) {
      if (cur.length > 0) {
        pages.push(cur);
        startPageFor(line);
      }
    }

    cur.push(line);
  }
  if (cur.length) pages.push(cur);
  return pages;
}

// ---------------------------------------------------------------------------
// 6. Renderers — text, CSV, HTML
// ---------------------------------------------------------------------------

function renderText(report, opts) {
  opts = opts || {};
  const cols = report.columns;
  const lines = flattenReport(report);

  // Column widths from header + every data/subtotal cell.
  const width = cols.map((c) => c.label.length);
  for (const ln of lines) {
    if (ln.cells) {
      for (let i = 0; i < cols.length; i++) width[i] = Math.max(width[i], ln.cells[i].length);
    }
  }

  const out = [];
  out.push(report.title);
  if (report.generatedAt) out.push('Generated: ' + report.generatedAt);
  out.push('');

  const pad = (s, w, right) => (right ? s.padStart(w) : s.padEnd(w));
  const sep = '  ';
  const headerRow = cols.map((c, i) => pad(c.label, width[i], isNumeric(c.type))).join(sep);
  out.push(headerRow);
  out.push('-'.repeat(headerRow.length));

  for (const ln of lines) {
    if (ln.kind === 'groupHeader') {
      out.push('');
      out.push('  '.repeat(Math.max(0, ln.depth)) + '▸ ' + ln.label);
    } else if (ln.kind === 'data') {
      out.push('  ' + cols.map((c, i) => pad(ln.cells[i], width[i], isNumeric(c.type))).join(sep));
    } else if (ln.kind === 'subtotal') {
      out.push('  ' + cols.map((c, i) => pad(ln.cells[i], width[i], isNumeric(c.type))).join(sep));
      out.push('');
    } else if (ln.kind === 'grandTotal') {
      out.push('='.repeat(headerRow.length));
      out.push('  ' + cols.map((c, i) => pad(ln.cells[i], width[i], isNumeric(c.type))).join(sep));
    }
  }
  return out.join('\n') + '\n';
}

function csvField(s) {
  s = String(s);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function renderCsv(report) {
  const cols = report.columns;
  const lines = flattenReport(report);
  const out = [];
  out.push(cols.map((c) => csvField(c.label)).join(','));
  for (const ln of lines) {
    if (ln.kind === 'groupHeader') {
      out.push(csvField('# ' + ln.label));
    } else if (ln.cells) {
      // CSV uses blank (not —) for null data cells.
      let cells;
      if (ln.kind === 'data') {
        cells = cols.map((c) => csvField(formatCell(ln.row[c.key], c.type, '')));
      } else {
        cells = ln.cells.map(csvField);
      }
      out.push(cells.join(','));
    }
  }
  return out.join('\r\n') + '\r\n';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function renderHtml(report, opts) {
  opts = opts || {};
  const cols = report.columns;
  const lines = flattenReport(report);
  const ncol = cols.length;

  const body = [];
  for (const ln of lines) {
    if (ln.kind === 'groupHeader') {
      body.push('<tr class="grp grp-' + Math.max(0, ln.depth) + '"><th colspan="' + ncol + '">'
        + escapeHtml(ln.label) + '</th></tr>');
    } else if (ln.kind === 'data') {
      body.push('<tr>' + cols.map((c) =>
        '<td class="' + (isNumeric(c.type) ? 'num' : 'txt') + '">'
        + escapeHtml(ln.cells[cols.indexOf(c)]) + '</td>').join('') + '</tr>');
    } else if (ln.kind === 'subtotal' || ln.kind === 'grandTotal') {
      const cls = ln.kind === 'grandTotal' ? 'grand' : 'sub';
      body.push('<tr class="' + cls + '">' + cols.map((c, i) =>
        '<td class="' + (isNumeric(c.type) ? 'num' : 'txt') + '">'
        + escapeHtml(ln.cells[i]) + '</td>').join('') + '</tr>');
    }
  }

  const head = '<tr>' + cols.map((c) =>
    '<th class="' + (isNumeric(c.type) ? 'num' : 'txt') + '">' + escapeHtml(c.label) + '</th>').join('') + '</tr>';

  const table = '<table class="report">\n<thead>' + head + '</thead>\n<tbody>\n'
    + body.join('\n') + '\n</tbody>\n</table>';

  if (opts.fragment) return table;

  const css = `
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1b2330;background:#fff}
  h1{font-size:20px;margin:0 0 4px}
  .meta{color:#6b7684;margin:0 0 16px;font-size:13px}
  table.report{border-collapse:collapse;width:100%;font-size:13px}
  table.report th,table.report td{padding:6px 10px;border-bottom:1px solid #e6e9ef;text-align:left}
  table.report thead th{border-bottom:2px solid #c2c8d2;background:#f6f8fb;position:sticky;top:0}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  tr.grp th{background:#eef3fb;color:#24324a;font-weight:600;border-bottom:1px solid #d6def0}
  tr.grp-1 th{background:#f3f6fc}
  tr.sub td{font-weight:600;background:#fbfcfe;border-top:1px solid #d6def0}
  tr.grand td{font-weight:700;background:#24324a;color:#fff;border-top:2px solid #111}
  `;
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(report.title)
    + '</title><style>' + css + '</style></head><body>\n<h1>' + escapeHtml(report.title) + '</h1>\n'
    + (report.generatedAt ? '<p class="meta">Generated: ' + escapeHtml(report.generatedAt) + '</p>\n' : '')
    + table + '\n</body></html>';
}

// ---------------------------------------------------------------------------
// 7. PDF — written from the bytes up (no library)
// ---------------------------------------------------------------------------
//
// Helvetica / Helvetica-Bold advance widths (per 1000 em) for codes 32..126 —
// the real Adobe AFM values. Nothing is embedded: these are two of the 14
// standard fonts every PDF reader already has, so we just reference them by name
// and measure with these widths to lay out columns.

function buildWidths(str) {
  const parts = str.trim().split(/\s+/).map(Number);
  const w = new Array(256).fill(0);
  for (let i = 0; i < parts.length; i++) w[32 + i] = parts[i];
  return w;
}

const HELV = buildWidths(
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 ' +
  '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 ' +
  '1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 ' +
  '667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 ' +
  '333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 ' +
  '556 556 333 500 278 556 500 722 500 500 500 334 260 334 584');

const HELV_BOLD = buildWidths(
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 ' +
  '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 ' +
  '975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 ' +
  '667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 ' +
  '333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 ' +
  '611 611 389 556 333 611 556 778 556 556 500 389 280 389 584');

// Width of `str` at `size`pt in Helvetica (bold or not).
function stringWidth(str, size, bold) {
  const W = bold ? HELV_BOLD : HELV;
  let units = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    units += (c >= 0 && c < 256 && W[c]) ? W[c] : W[63]; // fall back to '?'
  }
  return units * size / 1000;
}

function fmtNum(n) {
  // PDF numbers: up to 2 decimals, trailing zeros trimmed, no exponent.
  let s = n.toFixed(2);
  s = s.replace(/\.?0+$/, '');
  return s === '' || s === '-0' ? '0' : s;
}

// Latin-1 encode a string into a byte array, escaping PDF string specials and
// replacing any char that isn't a single WinAnsi byte with '?'.
function pdfString(s) {
  let out = '(';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c >= 32 && c < 256) out += ch;
    else out += '?';
  }
  return out + ')';
}

function renderPdf(report, opts) {
  opts = opts || {};
  const PW = 612, PH = 792;          // US Letter
  const M = 48;                      // margin
  const fs = opts.fontSize || 9;
  const headFs = fs + 1;
  const titleFs = 17;
  const rowH = fs + 7;
  const avail = PW - 2 * M;
  const top = PH - M;
  const footY = M - 6;
  const bodyBottom = M + 14;

  const cols = report.columns;
  const flat = flattenReport(report);

  // --- column layout: measure the *formatted* strings, then scale to fit ---
  const pad = 8;
  const natural = cols.map((c) => stringWidth(c.label, headFs, true) + pad);
  for (const ln of flat) {
    if (!ln.cells) continue;
    for (let i = 0; i < cols.length; i++) {
      natural[i] = Math.max(natural[i], stringWidth(ln.cells[i], fs, false) + pad);
    }
  }
  const total = natural.reduce((a, b) => a + b, 0);
  const scale = avail / total;
  const colW = natural.map((w) => w * scale);
  const colX = [];
  let x = M;
  for (let i = 0; i < cols.length; i++) { colX.push(x); x += colW[i]; }

  // --- capacity: how many content lines fit below the column header ---
  // page 1 also carries the title; reserve one extra line everywhere so the
  // paginator's uniform perPage is safe on page 1.
  const headerBlock = rowH * 2 + titleFs; // worst case (page 1)
  const perPage = Math.max(3, Math.floor((top - bodyBottom - headerBlock) / rowH));
  const pages = paginate(report, { rowsPerPage: perPage, lines: flat });

  // --- draw each page into a content stream ---
  const streams = pages.map((pageLines, pi) =>
    drawPage(pageLines, pi, pages.length, { report, cols, colX, colW, M, PW, PH, top,
      bodyBottom, footY, fs, headFs, titleFs, rowH, avail }));

  return assemblePdf(streams, PW, PH);
}

function drawPage(pageLines, pageIndex, pageCount, ctx) {
  const { report, cols, colX, colW, M, PW, top, footY, fs, headFs, titleFs, rowH, avail } = ctx;
  const ops = [];
  const pad = 4;

  const text = (tx, ty, s, size, bold) => {
    ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + fmtNum(size) + ' Tf '
      + '1 0 0 1 ' + fmtNum(tx) + ' ' + fmtNum(ty) + ' Tm ' + pdfString(s) + ' Tj ET');
  };
  const line = (x1, y1, x2, y2, w, gray) => {
    ops.push(fmtNum(gray == null ? 0 : gray) + ' G ' + fmtNum(w) + ' w '
      + fmtNum(x1) + ' ' + fmtNum(y1) + ' m ' + fmtNum(x2) + ' ' + fmtNum(y2) + ' l S');
  };
  // right-aligned cell within its column
  const cell = (i, y, s, bold) => {
    if (isNumeric(cols[i].type)) {
      const w = stringWidth(s, bold ? headFs : fs, bold);
      text(colX[i] + colW[i] - pad - w, y, s, bold ? headFs : fs, bold);
    } else {
      text(colX[i] + pad, y, s, bold ? headFs : fs, bold);
    }
  };

  let y = top;

  if (pageIndex === 0) {
    text(M, y - titleFs, report.title, titleFs, true);
    y -= titleFs + 6;
    if (report.generatedAt) {
      ops.push('0.4 G');
      text(M, y - fs, 'Generated: ' + report.generatedAt, fs, false);
      y -= fs + 8;
    } else {
      y -= 4;
    }
  }

  // column header, repeated on every page
  y -= rowH;
  for (let i = 0; i < cols.length; i++) cell(i, y + 4, cols[i].label, true);
  line(M, y, M + avail, y, 1, 0);
  y -= 4;

  for (const ln of pageLines) {
    y -= rowH;
    if (ln.kind === 'groupHeader') {
      const indent = Math.max(0, ln.depth) * 12;
      ops.push('0.15 G');
      text(colX[0] + pad + indent, y + 4, (ln.continued ? '▸ ' : '').replace('▸ ', '') + ln.label + (ln.continued ? '  (continued)' : ''), fs, true);
    } else if (ln.kind === 'data') {
      ops.push('0.1 G');
      for (let i = 0; i < cols.length; i++) cell(i, y + 4, ln.cells[i], false);
      line(M, y + 1, M + avail, y + 1, 0.4, 0.85);
    } else if (ln.kind === 'subtotal') {
      ops.push('0.1 G');
      line(M, y + rowH - 1, M + avail, y + rowH - 1, 0.6, 0.5);
      for (let i = 0; i < cols.length; i++) cell(i, y + 4, ln.cells[i], true);
    } else if (ln.kind === 'grandTotal') {
      ops.push('0 G');
      line(M, y + rowH - 1, M + avail, y + rowH - 1, 1, 0);
      for (let i = 0; i < cols.length; i++) cell(i, y + 4, ln.cells[i], true);
      line(M, y - 2, M + avail, y - 2, 1, 0);
    }
  }

  // footer
  ops.push('0.4 G');
  const footer = 'Page ' + (pageIndex + 1) + ' of ' + pageCount;
  const fw = stringWidth(footer, fs, false);
  text(PW - M - fw, footY, footer, fs, false);
  text(M, footY, report.title, fs, false);

  return ops.join('\n') + '\n';
}

// Assemble the object graph + xref table. Every object's byte offset is recorded
// as it is streamed; the xref must point at the exact "N 0 obj" bytes or a
// reader reports the file as damaged.
function assemblePdf(contentStreams, PW, PH) {
  const enc = (s) => {
    const a = [];
    for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff);
    return a;
  };

  const bytes = [];
  const offsets = [];                      // offsets[objNum] = byte offset
  const push = (s) => { for (const b of enc(s)) bytes.push(b); };

  push('%PDF-1.7\n');
  push('%\xe2\xe3\xcf\xd3\n');             // binary marker so tools treat it as binary

  // Object numbering:
  // 1 Catalog, 2 Pages, 3 Helvetica, 4 Helvetica-Bold,
  // then for each page: pageObj, contentObj (two per page).
  const nPages = contentStreams.length;
  const pageObjNums = [];
  const contentObjNums = [];
  for (let i = 0; i < nPages; i++) {
    pageObjNums.push(5 + i * 2);
    contentObjNums.push(6 + i * 2);
  }
  const totalObjs = 4 + nPages * 2;

  const startObj = (n) => { offsets[n] = bytes.length; push(n + ' 0 obj\n'); };
  const endObj = () => { push('endobj\n'); };

  // 1: Catalog
  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\n'); endObj();

  // 2: Pages
  startObj(2);
  push('<< /Type /Pages /Count ' + nPages + ' /Kids ['
    + pageObjNums.map((n) => n + ' 0 R').join(' ') + '] >>\n');
  endObj();

  // 3,4: fonts (standard, not embedded)
  startObj(3); push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n'); endObj();
  startObj(4); push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n'); endObj();

  // pages + content streams
  for (let i = 0; i < nPages; i++) {
    startObj(pageObjNums[i]);
    push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] '
      + '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> '
      + '/Contents ' + contentObjNums[i] + ' 0 R >>\n');
    endObj();

    const stream = contentStreams[i];
    const len = enc(stream).length;
    startObj(contentObjNums[i]);
    push('<< /Length ' + len + ' >>\nstream\n');
    push(stream);
    push('endstream\n');
    endObj();
  }

  // xref
  const xrefOffset = bytes.length;
  push('xref\n');
  push('0 ' + (totalObjs + 1) + '\n');
  push('0000000000 65535 f \n');
  for (let n = 1; n <= totalObjs; n++) {
    push(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
  }

  // trailer
  push('trailer\n');
  push('<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R >>\n');
  push('startxref\n');
  push(xrefOffset + '\n');
  push('%%EOF\n');

  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// 8. parsePdf — an independent reader, for grading in the tests
// ---------------------------------------------------------------------------
//
// Walks the file the way a real reader does: header, startxref -> xref table,
// then checks every in-use offset lands on its "N 0 obj", reads the page count
// from the Pages object, and checks each stream's /Length is byte-accurate.

function parsePdf(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);

  const header = s.slice(0, 8);
  if (!/^%PDF-1\.\d/.test(header)) throw new Error('bad header: ' + header);

  const sx = s.lastIndexOf('startxref');
  if (sx === -1) throw new Error('no startxref');
  const xrefOffset = parseInt(s.slice(sx + 9).trim().split(/\s/)[0], 10);
  if (s.slice(xrefOffset, xrefOffset + 4) !== 'xref') throw new Error('startxref does not point at xref');

  // parse the single subsection
  let p = xrefOffset + 4;
  while (s[p] === '\n' || s[p] === '\r') p++;
  const headerLineEnd = s.indexOf('\n', p);
  const [first, count] = s.slice(p, headerLineEnd).trim().split(/\s+/).map(Number);
  p = headerLineEnd + 1;

  const offsets = [];
  for (let i = 0; i < count; i++) {
    const entry = s.slice(p, p + 20);
    const off = parseInt(entry.slice(0, 10), 10);
    const type = entry[17];
    offsets.push({ off, type });
    p += 20;
  }

  // every in-use object (beyond the free object 0) must land on "N 0 obj"
  let objCount = 0;
  for (let n = first + 1; n < first + count; n++) {
    const e = offsets[n - first];
    if (e.type !== 'n') continue;
    const expect = n + ' 0 obj';
    const got = s.slice(e.off, e.off + expect.length);
    if (got !== expect) {
      throw new Error('xref entry ' + n + ' points to "' + got + '", expected "' + expect + '"');
    }
    objCount++;
  }

  // trailer /Size and /Root
  const trailerIdx = s.lastIndexOf('trailer');
  const trailer = s.slice(trailerIdx, sx);
  const sizeM = /\/Size\s+(\d+)/.exec(trailer);
  const rootM = /\/Root\s+(\d+)\s+0\s+R/.exec(trailer);
  if (!sizeM || Number(sizeM[1]) !== count) throw new Error('trailer /Size mismatch');
  if (!rootM) throw new Error('no /Root in trailer');

  // page count from the Pages object
  const pagesM = /\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/.exec(s);
  const pageCount = pagesM ? Number(pagesM[1]) : 0;

  // each stream's /Length must equal the real byte count between stream/endstream
  let streamLenOk = true;
  const re = /\/Length\s+(\d+)\s*>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const declared = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    const endIdx = s.indexOf('endstream', bodyStart);
    // the stream's own trailing newline is part of its /Length; "endstream"
    // follows immediately, so the byte span is exactly the declared length.
    const actual = endIdx - bodyStart;
    if (actual !== declared) streamLenOk = false;
  }

  return {
    version: header.slice(5),
    xrefOffset,
    objCount,
    size: Number(sizeM[1]),
    root: Number(rootM[1]),
    pageCount,
    streamLenOk,
  };
}

// ---------------------------------------------------------------------------
// 9. Sample data + a few ready-made report specs
// ---------------------------------------------------------------------------
//
// Stands in for "a table in a database". Two deliberate NULLs exercise the SQL
// semantics: one unassigned rep, one order whose unit count is unknown.

const RAW = [
  // region, rep,    category,   product,   units, unitPrice, date
  ['North', 'Alice', 'Hardware', 'Widget',    10,   2.50, '2026-01-05'],
  ['North', 'Alice', 'Hardware', 'Gadget',     4,   9.00, '2026-01-18'],
  ['North', 'Bob',   'Software', 'License',    2, 120.00, '2026-02-02'],
  ['North', 'Bob',   'Software', 'Support',    1, 300.00, '2026-02-20'],
  ['North', null,    'Hardware', 'Widget',     5,   2.50, '2026-03-01'],
  ['South', 'Carol', 'Hardware', 'Gizmo',      8,   5.00, '2026-01-11'],
  ['South', 'Carol', 'Software', 'License',    3, 120.00, '2026-02-14'],
  ['South', 'Dan',   'Hardware', 'Widget',    20,   2.50, '2026-03-09'],
  ['South', 'Dan',   'Hardware', 'Gadget',  null,   9.00, '2026-03-15'],
  ['South', 'Dan',   'Software', 'Support',    2, 300.00, '2026-03-22'],
  ['East',  'Eve',   'Software', 'License',    6, 120.00, '2026-01-25'],
  ['East',  'Eve',   'Hardware', 'Gizmo',     12,   5.00, '2026-02-08'],
  ['East',  'Frank', 'Hardware', 'Widget',     7,   2.50, '2026-02-17'],
  ['East',  'Frank', 'Software', 'Support',    1, 300.00, '2026-03-03'],
  ['West',  'Grace', 'Hardware', 'Gadget',     9,   9.00, '2026-01-30'],
  ['West',  'Grace', 'Software', 'License',    4, 120.00, '2026-02-21'],
  ['West',  'Heidi', 'Hardware', 'Gizmo',     15,   5.00, '2026-03-12'],
  ['West',  'Heidi', 'Hardware', 'Widget',    11,   2.50, '2026-03-28'],
  ['North', 'Alice', 'Software', 'License',    1, 120.00, '2026-04-02'],
  ['South', 'Carol', 'Hardware', 'Gizmo',      6,   5.00, '2026-04-05'],
  ['East',  'Eve',   'Hardware', 'Gadget',     3,   9.00, '2026-04-09'],
  ['West',  'Grace', 'Hardware', 'Widget',    25,   2.50, '2026-04-14'],
  ['North', 'Bob',   'Hardware', 'Gizmo',      2,   5.00, '2026-04-19'],
  ['South', 'Dan',   'Software', 'License',    5, 120.00, '2026-04-25'],
];

const SAMPLE_DATA = RAW.map((r) => ({
  region: r[0], rep: r[1], category: r[2], product: r[3],
  units: r[4], unitPrice: r[5], date: r[6],
  revenue: isNull(r[4]) ? null : r[4] * r[5],
}));

const SAMPLE_COLUMNS = [
  { key: 'rep', label: 'Rep', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'product', label: 'Product', type: 'text' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'units', label: 'Units', type: 'number', agg: 'sum' },
  { key: 'unitPrice', label: 'Unit Price', type: 'currency' },
  { key: 'revenue', label: 'Revenue', type: 'currency', agg: 'sum' },
];

const SAMPLE_SPECS = {
  byRegion: {
    title: 'Sales by Region',
    columns: SAMPLE_COLUMNS,
    groupBy: ['region'],
    sortBy: [{ key: 'date', dir: 'asc' }],
  },
  byRegionRep: {
    title: 'Sales by Region and Rep',
    columns: SAMPLE_COLUMNS,
    groupBy: ['region', 'rep'],
    sortBy: [{ key: 'date', dir: 'asc' }],
  },
  byCategory: {
    title: 'Sales by Category',
    columns: SAMPLE_COLUMNS,
    groupBy: ['category'],
    sortBy: [{ key: 'revenue', dir: 'desc' }],
  },
};

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

const API = {
  isNull, AGG, aggregate,
  formatNumber, formatCurrency, formatCell, isNumeric,
  buildReport, flattenReport, paginate,
  renderText, renderCsv, renderHtml, renderPdf,
  stringWidth, HELV, HELV_BOLD, parsePdf, csvField, escapeHtml, keyLabel,
  SAMPLE_DATA, SAMPLE_COLUMNS, SAMPLE_SPECS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.ReportCore = API;
if (typeof globalThis !== 'undefined') globalThis.ReportCore = API;
