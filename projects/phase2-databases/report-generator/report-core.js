'use strict';
/*
 * report-core.js — a dependency-free report writer.
 *
 * Takes the rows of a small relational database (customers, products, orders,
 * order_items) and turns them into reports: grouped sales summaries with
 * subtotals and a grand total, pivot/crosstab tables, top-N rankings, running
 * totals, and a day's activity digest. One report *model* is produced, then
 * rendered to text, HTML, CSV, Markdown or JSON — the same numbers, laid out
 * four ways.
 *
 * No dependencies. Runs in Node and in the browser (see the export shim at the
 * bottom).
 *
 * The three things that are actually hard live here:
 *   1. Control-break subtotals (groupRollup) — subtotal rows must land *after*
 *      the group they summarise, and every level is recomputed from the raw
 *      rows, because you cannot average the averages.
 *   2. Pivot (crosstab) — the columns are data; you don't know them until you
 *      have scanned every row, they must come out in a stable order, and the
 *      gaps are 0, not blank.
 *   3. formatValue lives in the model, not the renderer, so CSV and HTML can
 *      never disagree about what a number looks like.
 */

/* ========================================================================== *
 *  1. Aggregators — accumulator objects so every grouping level is exact.
 *     Each has { init(), step(acc,row), result(acc) }. Keeping sum and count
 *     separate (instead of a pre-divided average) is what lets a grand-total
 *     average be recomputed from raw rows rather than averaged from subgroups.
 * ========================================================================== */

const Agg = {
  sum(field) {
    return { init: () => 0, step: (a, r) => a + num(r[field]), result: (a) => a };
  },
  count() {
    return { init: () => 0, step: (a) => a + 1, result: (a) => a };
  },
  countDistinct(field) {
    return {
      init: () => new Set(),
      step: (a, r) => { a.add(r[field]); return a; },
      result: (a) => a.size,
    };
  },
  avg(field) {
    return {
      init: () => ({ s: 0, n: 0 }),
      step: (a, r) => { a.s += num(r[field]); a.n += 1; return a; },
      result: (a) => (a.n === 0 ? 0 : a.s / a.n),
    };
  },
  min(field) {
    return {
      init: () => ({ v: null }),
      step: (a, r) => { const x = num(r[field]); if (a.v === null || x < a.v) a.v = x; return a; },
      result: (a) => a.v,
    };
  },
  max(field) {
    return {
      init: () => ({ v: null }),
      step: (a, r) => { const x = num(r[field]); if (a.v === null || x > a.v) a.v = x; return a; },
      result: (a) => a.v,
    };
  },
};

function num(x) {
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : 0;
}

/* ========================================================================== *
 *  2. groupAggregate — a plain GROUP BY.
 *     measures: { outKey: aggregatorSpec }. Returns one object per group:
 *       { key: [v1, v2, ...], group: {field:val}, values: {outKey:number} }
 *     Groups keep first-seen order unless you sort them later.
 * ========================================================================== */

function groupAggregate(rows, groupBy, measures) {
  groupBy = groupBy || [];
  const order = [];
  const byKey = new Map();

  for (const row of rows) {
    const keyVals = groupBy.map((f) => row[f]);
    const k = JSON.stringify(keyVals);
    let bucket = byKey.get(k);
    if (!bucket) {
      bucket = { key: keyVals, accs: {} };
      for (const m of Object.keys(measures)) bucket.accs[m] = measures[m].init();
      byKey.set(k, bucket);
      order.push(k);
    }
    for (const m of Object.keys(measures)) {
      bucket.accs[m] = measures[m].step(bucket.accs[m], row);
    }
  }

  return order.map((k) => {
    const bucket = byKey.get(k);
    const group = {};
    groupBy.forEach((f, i) => { group[f] = bucket.key[i]; });
    const values = {};
    for (const m of Object.keys(measures)) values[m] = measures[m].result(bucket.accs[m]);
    return { key: bucket.key, group, values };
  });
}

/* ========================================================================== *
 *  3. groupRollup — the classic control-break report.
 *
 *  Given groupBy [A, B], emit, in reading order:
 *    (a,b) (a,b) ... [subtotal a] (a',b)(a',b) ... [subtotal a'] ... [GRAND]
 *
 *  The two traps this gets right:
 *   - A subtotal belongs *after* its detail rows, keyed to the break in the
 *     higher-order field — not bolted on at the end.
 *   - Each subtotal / grand row is aggregated from the raw rows for that prefix
 *     with fresh accumulators. We never add up the leaf results, because an
 *     average (or a distinct count) of subgroups is not the average of the
 *     whole. Sum happens to survive that mistake; avg and countDistinct do not.
 * ========================================================================== */

function groupRollup(rows, groupBy, measures, opts) {
  opts = opts || {};
  const leaves = groupAggregate(rows, groupBy, measures);

  // Sort leaves by their group key so breaks are contiguous. Comparator is
  // either caller-supplied (e.g. to order by a measure) or lexicographic on key.
  if (opts.sort) leaves.sort(opts.sort);
  else leaves.sort((x, y) => cmpKey(x.key, y.key));

  // Precompute every subtotal level and the grand total from the raw rows, so
  // the numbers are exact at every level. Index them by their prefix key.
  const subtotalIndex = [];
  for (let depth = groupBy.length - 1; depth >= 1; depth--) {
    const prefix = groupBy.slice(0, depth);
    const groups = groupAggregate(rows, prefix, measures);
    const idx = new Map();
    for (const g of groups) idx.set(JSON.stringify(g.key), g);
    subtotalIndex[depth] = { prefix, idx };
  }
  const grand = groupAggregate(rows, [], measures)[0] || { group: {}, values: zeroValues(measures) };

  const out = [];
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    out.push(detailRow(leaf, groupBy));

    const next = leaves[i + 1];
    // After the last row of the deepest-but-one break, emit subtotals from the
    // deepest break outward (so B's subtotal, if any, precedes A's).
    for (let depth = groupBy.length - 1; depth >= 1; depth--) {
      if (breaksAt(leaf.key, next && next.key, depth)) {
        const prefixKey = JSON.stringify(leaf.key.slice(0, depth));
        const sub = subtotalIndex[depth].idx.get(prefixKey);
        if (sub) out.push(subtotalRow(sub, groupBy, depth));
      }
    }
  }
  if (opts.grandTotal !== false && leaves.length) {
    out.push(grandRow(grand, groupBy));
  }
  return out;
}

function breaksAt(curKey, nextKey, depth) {
  // A break at `depth` means the first `depth` key fields differ from the next
  // row's (or there is no next row). depth counts the fields that must match to
  // *stay* in the group.
  if (!nextKey) return true;
  for (let i = 0; i < depth; i++) {
    if (!sameVal(curKey[i], nextKey[i])) return true;
  }
  return false;
}

function detailRow(leaf, groupBy) {
  const cells = {};
  groupBy.forEach((f, i) => { cells[f] = leaf.key[i]; });
  Object.assign(cells, leaf.values);
  return { level: 'detail', cells };
}

function subtotalRow(sub, groupBy, depth) {
  const cells = {};
  // Fill the broken group's own fields; blank the finer ones.
  groupBy.forEach((f, i) => {
    cells[f] = i < depth ? sub.group[f] : null;
  });
  Object.assign(cells, sub.values);
  // A label hint the renderers can use for the leading cell.
  cells.__label = 'Subtotal — ' + groupBy.slice(0, depth).map((f) => sub.group[f]).join(' / ');
  return { level: 'subtotal', depth, cells };
}

function grandRow(grand, groupBy) {
  const cells = {};
  groupBy.forEach((f) => { cells[f] = null; });
  Object.assign(cells, grand.values);
  cells.__label = 'Grand Total';
  return { level: 'grand', cells };
}

function zeroValues(measures) {
  const v = {};
  for (const m of Object.keys(measures)) v[m] = measures[m].result(measures[m].init());
  return v;
}

function cmpKey(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
function sameVal(a, b) { return a === b; }

/* ========================================================================== *
 *  4. pivot — a crosstab. Rows stay rows; one field's values fan out into
 *     columns. The column set is discovered from the data, sorted for a stable
 *     layout, and empty cells are filled with 0 (a real zero, not a blank).
 *     Adds a per-row total and a totals row that reconciles both ways.
 * ========================================================================== */

function pivot(rows, spec) {
  const rowField = spec.row;
  const colField = spec.col;
  const measure = spec.measure; // aggregator spec

  const colValues = Array.from(new Set(rows.map((r) => r[colField])));
  colValues.sort(defaultSort);
  const rowValues = Array.from(new Set(rows.map((r) => r[rowField])));
  rowValues.sort(defaultSort);

  // cell accumulators keyed by "row\u0000col"
  const cellAcc = new Map();
  const getAcc = (k) => { let a = cellAcc.get(k); if (a === undefined) { a = measure.init(); cellAcc.set(k, a); } return a; };
  for (const r of rows) {
    const k = r[rowField] + '\u0000' + r[colField];
    cellAcc.set(k, measure.step(getAcc(k), r));
  }

  const colTotals = {};
  colValues.forEach((c) => { colTotals[c] = 0; });
  let grand = 0;

  const matrix = rowValues.map((rv) => {
    const cells = {};
    let rowTotal = 0;
    colValues.forEach((cv) => {
      const k = rv + '\u0000' + cv;
      const v = cellAcc.has(k) ? measure.result(cellAcc.get(k)) : 0;
      cells[cv] = v;
      rowTotal += v;
      colTotals[cv] += v;
    });
    grand += rowTotal;
    return { row: rv, cells, total: rowTotal };
  });

  return { rowField, colField, colValues, rows: matrix, colTotals, grand };
}

function defaultSort(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/* ========================================================================== *
 *  5. running total — a post-process that walks a report model's rows and adds
 *     a cumulative column over one measure (detail rows only).
 * ========================================================================== */

function withRunningTotal(modelRows, measureKey, outKey) {
  let acc = 0;
  for (const r of modelRows) {
    if (r.level && r.level !== 'detail') { r.cells[outKey] = null; continue; }
    acc += num(r.cells[measureKey]);
    r.cells[outKey] = acc;
  }
  return modelRows;
}

/* ========================================================================== *
 *  6. formatValue — ONE place that decides how a value reads. Every renderer
 *     calls it, so the CSV and the HTML can never show a figure differently.
 * ========================================================================== */

function formatValue(value, fmt) {
  if (value === null || value === undefined || value === '') return '';
  switch (fmt) {
    case 'currency': return '$' + groupThousands(Number(value).toFixed(2));
    case 'int': return groupThousands(String(Math.round(num(value))));
    case 'number': return groupThousands(Number(value).toFixed(2));
    case 'percent': return (num(value) * 100).toFixed(1) + '%';
    case 'date': return String(value);
    default: return String(value);
  }
}

function groupThousands(s) {
  const neg = s[0] === '-';
  if (neg) s = s.slice(1);
  const dot = s.indexOf('.');
  let intPart = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot);
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + intPart + frac;
}

/* ========================================================================== *
 *  7. Renderers. A report model is:
 *     { title, subtitle?, columns: [{key,label,align,format}], rows:[{level,cells}] }
 *     Renderers only lay out; all number formatting goes through formatValue.
 * ========================================================================== */

function cellText(row, col) {
  if (col.key === '__first' && row.cells.__label !== undefined && row.level !== 'detail') {
    return row.cells.__label;
  }
  const raw = row.cells[col.key];
  return formatValue(raw, col.format);
}

function renderText(model) {
  const cols = model.columns;
  const header = cols.map((c) => c.label);
  const body = model.rows.map((row) => cols.map((c) => cellText(row, c)));

  const widths = cols.map((c, i) =>
    Math.max(displayWidth(header[i]), ...body.map((r) => displayWidth(r[i])), 0));

  const pad = (s, w, align) => {
    const gap = w - displayWidth(s);
    if (gap <= 0) return s;
    return align === 'right' ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
  };
  const line = (parts) => parts.map((s, i) => pad(s, widths[i], cols[i].align)).join('  ');
  const rule = (ch) => widths.map((w) => ch.repeat(w)).join('  ');

  const out = [];
  if (model.title) out.push(model.title);
  if (model.subtitle) out.push(model.subtitle);
  if (model.title || model.subtitle) out.push('');
  out.push(line(header));
  out.push(rule('='));
  model.rows.forEach((row, i) => {
    if (row.level === 'grand') out.push(rule('-'));
    out.push(line(body[i]));
  });
  return out.join('\n');
}

function displayWidth(s) { return String(s == null ? '' : s).length; }

function renderCSV(model) {
  const esc = (s) => {
    s = String(s == null ? '' : s);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [];
  lines.push(model.columns.map((c) => esc(c.label)).join(','));
  for (const row of model.rows) {
    lines.push(model.columns.map((c) => esc(cellText(row, c))).join(','));
  }
  return lines.join('\r\n');
}

function renderMarkdown(model) {
  const cols = model.columns;
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');
  const head = '| ' + cols.map((c) => esc(c.label)).join(' | ') + ' |';
  const sep = '| ' + cols.map((c) =>
    c.align === 'right' ? '---:' : c.align === 'center' ? ':--:' : '---').join(' | ') + ' |';
  const lines = [];
  if (model.title) lines.push('### ' + model.title, '');
  lines.push(head, sep);
  for (const row of model.rows) {
    const marked = row.level === 'grand' || row.level === 'subtotal';
    const cells = cols.map((c) => {
      const t = esc(cellText(row, c));
      return marked && t ? '**' + t + '**' : t;
    });
    lines.push('| ' + cells.join(' | ') + ' |');
  }
  return lines.join('\n');
}

function renderHTML(model, opts) {
  opts = opts || {};
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cols = model.columns;
  const thead = '<tr>' + cols.map((c) =>
    `<th class="align-${c.align || 'left'}">${esc(c.label)}</th>`).join('') + '</tr>';
  const rows = model.rows.map((row) => {
    const cls = row.level && row.level !== 'detail' ? ` class="row-${row.level}"` : '';
    const tds = cols.map((c) =>
      `<td class="align-${c.align || 'left'}">${esc(cellText(row, c))}</td>`).join('');
    return `<tr${cls}>${tds}</tr>`;
  }).join('\n');
  const caption = (model.title && !opts.noCaption) ? `<caption>${esc(model.title)}${model.subtitle ? ' — ' + esc(model.subtitle) : ''}</caption>` : '';
  const table = `<table class="report">${caption}<thead>${thead}</thead><tbody>\n${rows}\n</tbody></table>`;
  if (!opts.fullDocument) return table;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(model.title || 'Report')}</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#1a1a1a}
 table.report{border-collapse:collapse;min-width:420px}
 .report caption{font-weight:700;text-align:left;padding:.4rem 0;font-size:1.1rem}
 .report th,.report td{padding:.35rem .7rem;border-bottom:1px solid #ddd}
 .report thead th{border-bottom:2px solid #333;text-align:left}
 .align-right{text-align:right}.align-center{text-align:center}
 .row-subtotal{background:#f3f4f6;font-weight:600}
 .row-grand{background:#e5e7eb;font-weight:700;border-top:2px solid #333}
</style></head><body>${table}</body></html>`;
}

function renderJSON(model) {
  return JSON.stringify({
    title: model.title,
    subtitle: model.subtitle,
    columns: model.columns.map((c) => ({ key: c.key, label: c.label, format: c.format })),
    rows: model.rows.map((r) => ({ level: r.level || 'detail', cells: stripInternal(r.cells) })),
  }, null, 2);
}
function stripInternal(cells) {
  const out = {};
  for (const k of Object.keys(cells)) if (!k.startsWith('__')) out[k] = cells[k];
  return out;
}

const RENDERERS = {
  text: renderText, csv: renderCSV, md: renderMarkdown, markdown: renderMarkdown,
  html: (m) => renderHTML(m, { fullDocument: true }), htmltable: (m) => renderHTML(m),
  json: renderJSON,
};

function render(model, format) {
  const fn = RENDERERS[(format || 'text').toLowerCase()];
  if (!fn) throw new Error('unknown format: ' + format + ' (try text, html, csv, md, json)');
  return fn(model);
}

/* ========================================================================== *
 *  8. Sample database + the join into an order-line fact table.
 * ========================================================================== */

function sampleDatabase() {
  const customers = [
    { id: 1, name: 'Acme Corp', region: 'North' },
    { id: 2, name: 'Globex', region: 'North' },
    { id: 3, name: 'Initech', region: 'South' },
    { id: 4, name: 'Umbrella', region: 'South' },
    { id: 5, name: 'Hooli', region: 'West' },
    { id: 6, name: 'Soylent', region: 'West' },
  ];
  const products = [
    { id: 101, name: 'Widget', category: 'Hardware', price: 9.5 },
    { id: 102, name: 'Gadget', category: 'Hardware', price: 19.0 },
    { id: 103, name: 'Sprocket', category: 'Hardware', price: 4.25 },
    { id: 201, name: 'License', category: 'Software', price: 120.0 },
    { id: 202, name: 'Support Plan', category: 'Software', price: 60.0 },
    { id: 301, name: 'Onsite Day', category: 'Services', price: 800.0 },
    { id: 302, name: 'Training', category: 'Services', price: 350.0 },
  ];
  // orders across three months of 2024
  const orders = [
    { id: 1, customer_id: 1, date: '2024-01-05' },
    { id: 2, customer_id: 3, date: '2024-01-18' },
    { id: 3, customer_id: 5, date: '2024-01-29' },
    { id: 4, customer_id: 2, date: '2024-02-03' },
    { id: 5, customer_id: 4, date: '2024-02-14' },
    { id: 6, customer_id: 1, date: '2024-02-14' },
    { id: 7, customer_id: 6, date: '2024-02-27' },
    { id: 8, customer_id: 3, date: '2024-03-02' },
    { id: 9, customer_id: 5, date: '2024-03-15' },
    { id: 10, customer_id: 2, date: '2024-03-15' },
    { id: 11, customer_id: 4, date: '2024-03-15' },
    { id: 12, customer_id: 1, date: '2024-03-28' },
  ];
  const order_items = [
    { order_id: 1, product_id: 101, qty: 10 },
    { order_id: 1, product_id: 201, qty: 2 },
    { order_id: 2, product_id: 301, qty: 1 },
    { order_id: 2, product_id: 102, qty: 5 },
    { order_id: 3, product_id: 202, qty: 3 },
    { order_id: 3, product_id: 103, qty: 40 },
    { order_id: 4, product_id: 201, qty: 1 },
    { order_id: 4, product_id: 302, qty: 2 },
    { order_id: 5, product_id: 101, qty: 25 },
    { order_id: 5, product_id: 102, qty: 8 },
    { order_id: 6, product_id: 301, qty: 2 },
    { order_id: 7, product_id: 202, qty: 5 },
    { order_id: 7, product_id: 103, qty: 100 },
    { order_id: 8, product_id: 201, qty: 4 },
    { order_id: 9, product_id: 302, qty: 1 },
    { order_id: 9, product_id: 101, qty: 15 },
    { order_id: 10, product_id: 301, qty: 1 },
    { order_id: 11, product_id: 202, qty: 2 },
    { order_id: 11, product_id: 102, qty: 12 },
    { order_id: 12, product_id: 201, qty: 3 },
    { order_id: 12, product_id: 103, qty: 60 },
  ];
  return { customers, products, orders, order_items };
}

// Denormalise into one row per order line, with everything a report needs.
function orderLines(db) {
  const cust = index(db.customers, 'id');
  const prod = index(db.products, 'id');
  const ord = index(db.orders, 'id');
  return db.order_items.map((it) => {
    const o = ord[it.order_id];
    const p = prod[it.product_id];
    const c = cust[o.customer_id];
    const line_total = round2(it.qty * p.price);
    return {
      order_id: o.id,
      date: o.date,
      month: o.date.slice(0, 7),
      customer: c.name,
      region: c.region,
      product: p.name,
      category: p.category,
      unit_price: p.price,
      qty: it.qty,
      line_total,
    };
  });
}

function index(rows, key) {
  const m = {};
  for (const r of rows) m[r[key]] = r;
  return m;
}
function round2(x) { return Math.round(x * 100) / 100; }

/* ========================================================================== *
 *  9. Report definitions — each returns a report model from the database.
 * ========================================================================== */

const REPORTS = {
  'sales-by-category': {
    title: 'Sales by Category',
    describe: 'Units and revenue per product category, with a grand total.',
    build(db) {
      const lines = orderLines(db);
      const measures = {
        orders: Agg.countDistinct('order_id'),
        units: Agg.sum('qty'),
        revenue: Agg.sum('line_total'),
      };
      const rows = groupRollup(lines, ['category'], measures, { grandTotal: true });
      return {
        title: 'Sales by Category',
        subtitle: 'all time',
        columns: [
          { key: 'category', label: 'Category', align: 'left', format: 'text', first: true },
          { key: 'orders', label: 'Orders', align: 'right', format: 'int' },
          { key: 'units', label: 'Units', align: 'right', format: 'int' },
          { key: 'revenue', label: 'Revenue', align: 'right', format: 'currency' },
        ],
        rows: labelFirst(rows, 'category'),
        chart: { label: 'category', value: 'revenue' },
      };
    },
  },

  'sales-by-region': {
    title: 'Sales by Region and Category',
    describe: 'Two-level breakdown: category subtotals within each region, then a grand total.',
    build(db) {
      const lines = orderLines(db);
      const measures = {
        orders: Agg.countDistinct('order_id'),
        units: Agg.sum('qty'),
        revenue: Agg.sum('line_total'),
      };
      const rows = groupRollup(lines, ['region', 'category'], measures, { grandTotal: true });
      return {
        title: 'Sales by Region and Category',
        subtitle: 'all time',
        columns: [
          { key: 'region', label: 'Region', align: 'left', format: 'text', first: true },
          { key: 'category', label: 'Category', align: 'left', format: 'text' },
          { key: 'orders', label: 'Orders', align: 'right', format: 'int' },
          { key: 'units', label: 'Units', align: 'right', format: 'int' },
          { key: 'revenue', label: 'Revenue', align: 'right', format: 'currency' },
        ],
        rows,
      };
    },
  },

  'monthly-sales': {
    title: 'Monthly Sales',
    describe: 'Revenue per month with a running cumulative total.',
    build(db) {
      const lines = orderLines(db);
      const measures = {
        orders: Agg.countDistinct('order_id'),
        revenue: Agg.sum('line_total'),
      };
      let rows = groupRollup(lines, ['month'], measures, { grandTotal: true });
      rows = withRunningTotal(rows, 'revenue', 'cumulative');
      return {
        title: 'Monthly Sales',
        subtitle: 'with running total',
        columns: [
          { key: 'month', label: 'Month', align: 'left', format: 'text', first: true },
          { key: 'orders', label: 'Orders', align: 'right', format: 'int' },
          { key: 'revenue', label: 'Revenue', align: 'right', format: 'currency' },
          { key: 'cumulative', label: 'Cumulative', align: 'right', format: 'currency' },
        ],
        rows: labelFirst(rows, 'month'),
        chart: { label: 'month', value: 'revenue' },
      };
    },
  },

  'top-customers': {
    title: 'Top Customers',
    describe: 'Customers ranked by revenue (use --limit to cut the list).',
    build(db, params) {
      const limit = params && params.limit ? parseInt(params.limit, 10) : 5;
      const lines = orderLines(db);
      const measures = {
        orders: Agg.countDistinct('order_id'),
        revenue: Agg.sum('line_total'),
        avg_line: Agg.avg('line_total'),
      };
      let groups = groupAggregate(lines, ['customer'], measures);
      groups.sort((a, b) => b.values.revenue - a.values.revenue);
      groups = groups.slice(0, limit);
      const rows = groups.map((g, i) => ({
        level: 'detail',
        cells: {
          rank: i + 1,
          customer: g.group.customer,
          orders: g.values.orders,
          revenue: g.values.revenue,
          avg_line: g.values.avg_line,
        },
      }));
      return {
        title: 'Top Customers',
        subtitle: 'top ' + limit + ' by revenue',
        columns: [
          { key: 'rank', label: '#', align: 'right', format: 'int' },
          { key: 'customer', label: 'Customer', align: 'left', format: 'text' },
          { key: 'orders', label: 'Orders', align: 'right', format: 'int' },
          { key: 'revenue', label: 'Revenue', align: 'right', format: 'currency' },
          { key: 'avg_line', label: 'Avg Line', align: 'right', format: 'currency' },
        ],
        rows,
        chart: { label: 'customer', value: 'revenue' },
      };
    },
  },

  'category-by-month': {
    title: 'Category by Month (pivot)',
    describe: 'Crosstab of revenue: one row per category, one column per month.',
    build(db) {
      const lines = orderLines(db);
      const p = pivot(lines, { row: 'category', col: 'month', measure: Agg.sum('line_total') });
      const columns = [{ key: '__row', label: 'Category', align: 'left', format: 'text' }];
      for (const c of p.colValues) columns.push({ key: c, label: c, align: 'right', format: 'currency' });
      columns.push({ key: '__total', label: 'Total', align: 'right', format: 'currency' });

      const rows = p.rows.map((r) => {
        const cells = { __row: r.row, __total: r.total };
        for (const c of p.colValues) cells[c] = r.cells[c];
        return { level: 'detail', cells };
      });
      const totalCells = { __row: 'Total', __total: p.grand, __label: 'Total' };
      for (const c of p.colValues) totalCells[c] = p.colTotals[c];
      rows.push({ level: 'grand', cells: totalCells });

      return { title: 'Category by Month', subtitle: 'revenue pivot', columns, rows };
    },
  },

  'daily-activity': {
    title: 'Daily Activity Summary',
    describe: "A single day's activity: orders, customers, units, revenue, busiest category (--date YYYY-MM-DD).",
    build(db, params) {
      const date = (params && params.date) || defaultBusyDate(db);
      const lines = orderLines(db).filter((l) => l.date === date);
      const measures = {
        orders: Agg.countDistinct('order_id'),
        customers: Agg.countDistinct('customer'),
        units: Agg.sum('qty'),
        revenue: Agg.sum('line_total'),
      };
      const totals = (groupAggregate(lines, [], measures)[0] || { values: zeroValues(measures) }).values;

      // busiest category by revenue that day
      const cats = groupAggregate(lines, ['category'], { revenue: Agg.sum('line_total') })
        .sort((a, b) => b.values.revenue - a.values.revenue);
      const topCat = cats.length ? cats[0].group.category + ' (' + formatValue(cats[0].values.revenue, 'currency') + ')' : '—';

      const rows = [
        kv('Date', date),
        kv('Orders placed', formatValue(totals.orders, 'int')),
        kv('Distinct customers', formatValue(totals.customers, 'int')),
        kv('Units sold', formatValue(totals.units, 'int')),
        kv('Revenue', formatValue(totals.revenue, 'currency')),
        kv('Top category', topCat),
      ];
      return {
        title: 'Daily Activity Summary',
        subtitle: date,
        columns: [
          { key: 'metric', label: 'Metric', align: 'left', format: 'text' },
          { key: 'value', label: 'Value', align: 'right', format: 'text' },
        ],
        rows,
      };
    },
  },
};

function kv(metric, value) { return { level: 'detail', cells: { metric, value } }; }

// Give the first column an aggregated "Subtotal"/"Grand Total" label on break rows.
function labelFirst(rows, firstKey) {
  for (const r of rows) {
    if (r.level === 'grand') r.cells[firstKey] = r.cells.__label || 'Grand Total';
    else if (r.level === 'subtotal') r.cells[firstKey] = r.cells.__label || 'Subtotal';
  }
  return rows;
}

function defaultBusyDate(db) {
  // the date carrying the most orders (ties → latest), so the demo shows a full day
  const counts = {};
  for (const o of db.orders) counts[o.date] = (counts[o.date] || 0) + 1;
  let best = null;
  for (const d of Object.keys(counts)) {
    if (!best || counts[d] > counts[best] || (counts[d] === counts[best] && d > best)) best = d;
  }
  return best;
}

function listReports() {
  return Object.keys(REPORTS).map((k) => ({ id: k, title: REPORTS[k].title, describe: REPORTS[k].describe }));
}

function buildReport(id, db, params) {
  const def = REPORTS[id];
  if (!def) throw new Error('unknown report: ' + id + ' (try: ' + Object.keys(REPORTS).join(', ') + ')');
  return def.build(db || sampleDatabase(), params || {});
}

/* ========================================================================== *
 *  Exports (Node + browser)
 * ========================================================================== */

const API = {
  Agg, num, groupAggregate, groupRollup, pivot, withRunningTotal,
  formatValue, render, renderText, renderCSV, renderMarkdown, renderHTML, renderJSON,
  sampleDatabase, orderLines, REPORTS, listReports, buildReport, defaultBusyDate,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.ReportCore = API;
