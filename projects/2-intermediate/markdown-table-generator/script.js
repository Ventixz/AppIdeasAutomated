/*
 * Markdown Table Generator
 * app-ideas / 2-Intermediate / Markdown-Table-Generator
 *
 * The state is a plain model:
 *   data  : string[rows][cols]   — cell text
 *   align : ('left'|'center'|'right'|null)[cols]  — per-column alignment
 *
 * Everything (the editable HTML grid, the markdown string, the HTML preview)
 * is rendered from that model, so the model is the single source of truth.
 * The markdown serializer (`toMarkdown`) is DOM-free and is the real project.
 */

/* ------------------------------------------------------------------ model - */

const ALIGN_CYCLE = { left: '⇤', center: '↔', right: '⇥' };

let data = [];        // data[r][c] = string
let align = [];       // align[c]  = 'left' | 'center' | 'right' | null
let active = { r: 0, c: 0 };

function makeTable(rows, cols, fill) {
  data = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (fill ? fill(r, c) : '')));
  align = Array.from({ length: cols }, () => null);
  active = { r: 0, c: 0 };
}

const rowCount = () => data.length;
const colCount = () => (data[0] ? data[0].length : 0);

function clampActive() {
  active.r = Math.max(0, Math.min(active.r, rowCount() - 1));
  active.c = Math.max(0, Math.min(active.c, colCount() - 1));
}

/* -------------------------------------------------- structural operations - */

function insertRow(at) {
  at = Math.max(0, Math.min(at, rowCount()));
  data.splice(at, 0, Array.from({ length: colCount() }, () => ''));
}

function deleteRow(at) {
  if (rowCount() <= 1) return;          // always keep a header row
  data.splice(at, 1);
}

function insertCol(at) {
  at = Math.max(0, Math.min(at, colCount()));
  data.forEach((row) => row.splice(at, 0, ''));
  align.splice(at, 0, null);
}

function deleteCol(at) {
  if (colCount() <= 1) return;
  data.forEach((row) => row.splice(at, 1));
  align.splice(at, 1);
}

/* -------------------------------------------------------------- alignment - */

// Alignment in markdown is a per-column property (encoded in the separator
// row). "Cell" and "row" scopes therefore apply to every column the cell/row
// touches — for a cell that's just its own column; for a row, all columns.
function setAlign(value, scope) {
  clampActive();
  if (scope === 'column' || scope === 'cell') {
    align[active.c] = value;
  } else if (scope === 'row' || scope === 'table') {
    for (let c = 0; c < colCount(); c++) align[c] = value;
  }
}

/* ---------------------------------------------------- markdown serializer - */

// Escape a pipe so cell text can't break out of its column.
function escapeCell(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function separatorCell(a, width) {
  const dash = '-'.repeat(Math.max(1, width - (a === 'center' ? 2 : a ? 1 : 0)));
  if (a === 'center') return ':' + dash + ':';
  if (a === 'left')   return ':' + dash;
  if (a === 'right')  return dash + ':';
  return '-'.repeat(Math.max(3, width));
}

function toMarkdown() {
  if (!rowCount() || !colCount()) return '';
  const cells = data.map((row) => row.map(escapeCell));

  // Column widths so the raw markdown itself lines up nicely.
  const widths = [];
  for (let c = 0; c < colCount(); c++) {
    let w = 3;
    for (let r = 0; r < rowCount(); r++) w = Math.max(w, cells[r][c].length);
    widths[c] = w;
  }

  const pad = (text, c) => {
    const a = align[c];
    const space = widths[c] - text.length;
    if (a === 'right') return ' '.repeat(space) + text;
    if (a === 'center') {
      const left = Math.floor(space / 2);
      return ' '.repeat(left) + text + ' '.repeat(space - left);
    }
    return text + ' '.repeat(space);       // left / default
  };

  const line = (arr) => '| ' + arr.join(' | ') + ' |';
  const header = line(cells[0].map((t, c) => pad(t, c)));
  const sep = line(align.map((a, c) => separatorCell(a, widths[c])));
  const body = cells.slice(1).map((row) => line(row.map((t, c) => pad(t, c))));

  return [header, sep, ...body].join('\n');
}

/*  ====== App wiring (DOM) below — the Node sanity check slices here ====== */

/* ------------------------------------------------------ DOM: editable grid - */

const grid = document.querySelector('#grid tbody');
const output = document.getElementById('output');
const preview = document.getElementById('preview');
const dimNote = document.getElementById('dimNote');
const activeNote = document.getElementById('activeNote');

function renderGrid() {
  clampActive();
  grid.innerHTML = '';
  for (let r = 0; r < rowCount(); r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < colCount(); c++) {
      const cell = document.createElement(r === 0 ? 'th' : 'td');
      cell.contentEditable = 'true';
      cell.spellcheck = false;
      cell.textContent = data[r][c];
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (align[c]) cell.style.textAlign = align[c];
      if (r === active.r && c === active.c) cell.classList.add('active');
      tr.appendChild(cell);
    }
    grid.appendChild(tr);
  }
  dimNote.textContent = `${rowCount()} × ${colCount()}`;
}

// Read the editable cells back into the model (used before any op / on input).
function syncFromGrid() {
  grid.querySelectorAll('[data-r]').forEach((el) => {
    data[+el.dataset.r][+el.dataset.c] = el.textContent;
  });
}

function renderOutput() {
  const md = toMarkdown();
  output.value = md;
  preview.innerHTML = markdownTableToHtml(md);
}

function refresh() {
  renderGrid();
  renderOutput();
}

/* A tiny renderer just for the preview — parses our own markdown table back
   into a real HTML table (with alignment), plus bold, italic and inline code. */
function markdownTableToHtml(md) {
  const rows = md.split('\n').filter((l) => l.trim());
  if (rows.length < 2) return '<p class="empty">Nothing to preview.</p>';

  const splitRow = (l) =>
    l.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
      .split(/(?<!\\)\|/).map((s) => s.trim().replace(/\\\|/g, '|').replace(/\\\\/g, '\\'));

  const aligns = splitRow(rows[1]).map((s) => {
    const l = s.startsWith(':'), r = s.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return '';
  });

  const inline = (t) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  const th = splitRow(rows[0])
    .map((t, c) => `<th${aligns[c] ? ` style="text-align:${aligns[c]}"` : ''}>${inline(t)}</th>`)
    .join('');
  const body = rows.slice(2).map((line) =>
    '<tr>' + splitRow(line)
      .map((t, c) => `<td${aligns[c] ? ` style="text-align:${aligns[c]}"` : ''}>${inline(t)}</td>`)
      .join('') + '</tr>').join('');

  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

/* --------------------------------------------------------------- wiring - */

grid.addEventListener('input', (e) => {
  const el = e.target.closest('[data-r]');
  if (!el) return;
  data[+el.dataset.r][+el.dataset.c] = el.textContent;
  renderOutput();                        // live markdown, no full grid rerender
});

grid.addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-r]');
  if (!el) return;
  active = { r: +el.dataset.r, c: +el.dataset.c };
  grid.querySelectorAll('.active').forEach((n) => n.classList.remove('active'));
  el.classList.add('active');
  activeNote.textContent =
    `Active cell: row ${active.r + 1}, column ${active.c + 1}` +
    (active.r === 0 ? ' (header)' : '');
});

document.querySelector('.toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  syncFromGrid();
  const act = btn.dataset.act;

  if (act === 'row-above') { insertRow(active.r); active.r++; }
  else if (act === 'row-below') insertRow(active.r + 1);
  else if (act === 'col-left') { insertCol(active.c); active.c++; }
  else if (act === 'col-right') insertCol(active.c + 1);
  else if (act === 'del-row') deleteRow(active.r);
  else if (act === 'del-col') deleteCol(active.c);
  else if (act.startsWith('align-')) {
    const scope = document.getElementById('alignScope').value;
    setAlign(act.slice('align-'.length), scope);
  }
  refresh();
});

document.getElementById('buildBtn').addEventListener('click', () => {
  const rows = clampInt(document.getElementById('rowInput').value, 1, 50, 3);
  const cols = clampInt(document.getElementById('colInput').value, 1, 20, 3);
  makeTable(rows, cols, (r, c) => (r === 0 ? `Header ${c + 1}` : ''));
  refresh();
});

document.getElementById('sampleBtn').addEventListener('click', () => {
  makeTable(0, 0);
  data = [
    ['Language', 'Released', 'Typed'],
    ['JavaScript', '1995', 'dynamic'],
    ['Rust', '2010', 'static'],
    ['Python', '1991', 'dynamic'],
  ];
  align = [null, 'center', 'right'];
  active = { r: 0, c: 0 };
  document.getElementById('rowInput').value = rowCount();
  document.getElementById('colInput').value = colCount();
  refresh();
});

document.getElementById('copyBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const text = output.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    output.removeAttribute('readonly');
    output.select();
    document.execCommand('copy');
    output.setAttribute('readonly', '');
  }
  const old = btn.textContent;
  btn.textContent = '✓ Copied';
  setTimeout(() => (btn.textContent = old), 1200);
});

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ------------------------------------------------------------- start-up - */

makeTable(3, 3, (r, c) => (r === 0 ? `Header ${c + 1}` : ''));
refresh();
