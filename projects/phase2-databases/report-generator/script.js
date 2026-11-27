'use strict';
/* script.js — wire the controls to report-core.js and render into the page. */

(function () {
  const R = window.ReportCore;
  const DATASETS = window.ReportData.DATASETS;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  const FN_LABEL = { count: 'Count', sum: 'Σ', avg: 'Avg', min: 'Min', max: 'Max', countDistinct: 'Distinct' };

  const state = {
    datasetKey: 'sales',
    mode: 'report',
    groups: [],
    aggs: [],
    detail: [],
    filters: [],
    ct: { row: null, col: null, fn: 'count', measureCol: null },
  };

  function dataset() { return DATASETS[state.datasetKey]; }
  function colDef(name) { return dataset().columns.find((c) => c.name === name); }
  function aggType(name) { const t = colDef(name) ? colDef(name).type : 'string'; return t === 'money' ? 'money' : t === 'int' ? 'int' : 'number'; }
  function numericCols() { return dataset().columns.filter((c) => ['money', 'int', 'number'].includes(c.type)); }

  function defaults() {
    if (state.datasetKey === 'sales') {
      state.groups = ['region', 'category'];
      state.detail = ['product', 'rep', 'units', 'amountCents'];
      state.aggs = [
        { fn: 'sum', col: 'units' }, { fn: 'sum', col: 'amountCents' }, { fn: 'avg', col: 'amountCents' },
      ];
      state.ct = { row: 'region', col: 'category', fn: 'sum', measureCol: 'amountCents' };
    } else {
      state.groups = ['team', 'priority'];
      state.detail = ['agent', 'channel', 'resolveMins'];
      state.aggs = [{ fn: 'count' }, { fn: 'avg', col: 'resolveMins' }, { fn: 'sum', col: 'reopened' }];
      state.ct = { row: 'team', col: 'priority', fn: 'count', measureCol: null };
    }
    state.filters = [];
  }

  // ---- aggregate spec -> engine spec ----
  function aggSpecs() {
    return state.aggs.map((a, i) => {
      const label = a.fn === 'count'
        ? (a.col ? 'Count ' + colDef(a.col).label : 'Count')
        : (FN_LABEL[a.fn] + ' ' + (a.col ? colDef(a.col).label : ''));
      return {
        id: 'a' + i, fn: a.fn, col: a.col,
        label: label.trim(),
        type: a.col ? aggType(a.col) : 'int',
        decimals: a.col && colDef(a.col).type === 'int' && a.fn === 'avg' ? 1 : 2,
      };
    });
  }

  function whereSpec() {
    return state.filters.map((f) => {
      let value = f.value;
      if (f.op !== 'contains' && /^-?\d+(\.\d+)?$/.test(value)) value = parseFloat(value);
      // money columns are entered in dollars but stored as cents
      if (colDef(f.col) && colDef(f.col).type === 'money' && typeof value === 'number') value = Math.round(value * 100);
      return { col: f.col, op: f.op, value };
    });
  }

  // ---- rendering the controls ----
  function renderDatasetSelect() {
    const s = $('dataset');
    s.innerHTML = '';
    for (const k of Object.keys(DATASETS)) {
      const o = el('option'); o.value = k; o.textContent = DATASETS[k].name; s.appendChild(o);
    }
    s.value = state.datasetKey;
  }

  function renderGroupBuilder() {
    const box = $('groupBuilder'); box.innerHTML = '';
    for (const c of dataset().columns) {
      if (['money', 'int', 'number'].includes(c.type)) continue; // group by dimensions
      const idx = state.groups.indexOf(c.name);
      const chip = el('div', 'chip' + (idx >= 0 ? ' on' : ''));
      if (idx >= 0) chip.appendChild(el('span', 'ord', String(idx + 1)));
      chip.appendChild(el('span', null, c.label));
      chip.onclick = () => {
        const i = state.groups.indexOf(c.name);
        if (i >= 0) state.groups.splice(i, 1); else state.groups.push(c.name);
        renderGroupBuilder(); run();
      };
      box.appendChild(chip);
    }
  }

  function renderDetailBuilder() {
    const box = $('detailBuilder'); box.innerHTML = '';
    for (const c of dataset().columns) {
      const on = state.detail.includes(c.name);
      const chip = el('div', 'chip' + (on ? ' on' : ''), c.label);
      chip.onclick = () => {
        const i = state.detail.indexOf(c.name);
        if (i >= 0) state.detail.splice(i, 1); else state.detail.push(c.name);
        renderDetailBuilder(); run();
      };
      box.appendChild(chip);
    }
  }

  function renderAggBuilder() {
    const box = $('aggBuilder'); box.innerHTML = '';
    state.aggs.forEach((a, i) => {
      const rowEl = el('div', 'aggrow');
      const label = a.fn === 'count' && !a.col ? 'COUNT(*)'
        : (a.fn.toUpperCase() + '(' + (a.col ? colDef(a.col).label : '') + ')');
      rowEl.appendChild(el('span', 'label', label));
      const x = el('span', 'x', '×'); x.title = 'remove';
      x.onclick = () => { state.aggs.splice(i, 1); renderAggBuilder(); run(); };
      rowEl.appendChild(x);
      box.appendChild(rowEl);
    });
    // populate the "of" column select with numeric columns
    const sel = $('aggCol'); sel.innerHTML = '';
    for (const c of dataset().columns) { const o = el('option'); o.value = c.name; o.textContent = c.label; sel.appendChild(o); }
  }

  function renderFilterUI() {
    const sel = $('fCol'); sel.innerHTML = '';
    for (const c of dataset().columns) { const o = el('option'); o.value = c.name; o.textContent = c.label; sel.appendChild(o); }
    const box = $('filterChips'); box.innerHTML = '';
    state.filters.forEach((f, i) => {
      const chip = el('div', 'chip filter small', f.col + ' ' + f.op + ' ' + f.value);
      const x = el('span', 'x', '×');
      x.onclick = () => { state.filters.splice(i, 1); renderFilterUI(); run(); };
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  function renderCrosstabControls() {
    const dims = dataset().columns.filter((c) => !['money', 'int', 'number'].includes(c.type));
    const fill = (id, cols, val) => {
      const s = $(id); s.innerHTML = '';
      for (const c of cols) { const o = el('option'); o.value = c.name; o.textContent = c.label; s.appendChild(o); }
      if (val) s.value = val;
    };
    fill('ctRow', dims, state.ct.row || (dims[0] && dims[0].name));
    fill('ctCol', dims, state.ct.col || (dims[1] && dims[1].name));
    fill('ctMeasureCol', numericCols(), state.ct.measureCol);
    $('ctFn').value = state.ct.fn;
    $('ctMeasureCol').disabled = state.ct.fn === 'count';
  }

  // ---- run / render output ----
  let lastReport = null, lastCrosstab = null;

  function run() {
    const data = dataset();
    const out = $('reportOut');
    if (state.mode === 'crosstab') {
      const spec = {
        rowDim: state.ct.row, colDim: state.ct.col, fn: state.ct.fn,
        col: state.ct.fn === 'count' ? undefined : state.ct.measureCol,
        type: state.ct.fn === 'count' ? 'int' : (state.ct.measureCol ? aggType(state.ct.measureCol) : 'number'),
        where: whereSpec(),
      };
      try {
        const ct = R.crosstab(data, spec);
        lastCrosstab = ct; lastReport = null;
        out.innerHTML = R.renderCrosstabHtml(ct);
      } catch (e) { out.innerHTML = '<p class="status">' + e.message + '</p>'; }
      return;
    }
    const spec = {
      title: data.name + ' — ' + (state.groups.length ? 'by ' + state.groups.map((g) => colDef(g).label).join(', ') : 'summary'),
      subtitle: state.filters.length ? 'Filtered: ' + state.filters.map((f) => f.col + ' ' + f.op + ' ' + f.value).join(', ') : null,
      groups: state.groups.slice(),
      detail: state.detail.length ? state.detail.slice() : null,
      aggregates: aggSpecs(),
      where: whereSpec(),
    };
    try {
      const rep = R.buildReport(data, spec);
      lastReport = rep; lastCrosstab = null;
      out.innerHTML = R.renderHtml(rep);
    } catch (e) { out.innerHTML = '<p class="status">' + e.message + '</p>'; }
  }

  function flash(msg) { const s = $('status'); s.textContent = msg; setTimeout(() => { if (s.textContent === msg) s.textContent = ''; }, 2000); }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- events ----
  function bind() {
    $('dataset').onchange = (e) => { state.datasetKey = e.target.value; defaults(); renderAll(); };
    $('mode').onchange = (e) => {
      state.mode = e.target.value;
      $('reportControls').hidden = state.mode !== 'report';
      $('crosstabControls').hidden = state.mode !== 'crosstab';
      run();
    };
    $('addAgg').onclick = () => {
      const fn = $('aggFn').value;
      const col = fn === 'count' ? undefined : $('aggCol').value;
      state.aggs.push({ fn, col });
      renderAggBuilder(); run();
    };
    $('addFilter').onclick = () => {
      const col = $('fCol').value, op = $('fOp').value, value = $('fVal').value.trim();
      if (value === '') { flash('Enter a filter value'); return; }
      state.filters.push({ col, op, value }); $('fVal').value = '';
      renderFilterUI(); run();
    };
    $('fVal').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addFilter').click(); });
    ['ctRow', 'ctCol', 'ctFn', 'ctMeasureCol'].forEach((id) => {
      $(id).onchange = () => {
        state.ct.row = $('ctRow').value; state.ct.col = $('ctCol').value;
        state.ct.fn = $('ctFn').value; state.ct.measureCol = $('ctMeasureCol').value;
        $('ctMeasureCol').disabled = state.ct.fn === 'count';
        run();
      };
    });
    $('exportText').onclick = () => {
      const text = lastCrosstab ? R.renderCrosstabText(lastCrosstab) : (lastReport ? R.renderText(lastReport) : '');
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash('Copied report text')).catch(() => flash('Copy failed'));
      else flash('Clipboard unavailable');
    };
    $('exportCsv').onclick = () => {
      if (lastReport) download('report.csv', R.renderCsv(lastReport), 'text/csv');
      else flash('CSV export is for the banded report');
    };
    $('exportMd').onclick = () => {
      if (lastReport) download('report.md', R.renderMarkdown(lastReport), 'text/markdown');
      else flash('Markdown export is for the banded report');
    };
  }

  function renderAll() {
    renderDatasetSelect();
    renderGroupBuilder();
    renderDetailBuilder();
    renderAggBuilder();
    renderFilterUI();
    renderCrosstabControls();
    run();
  }

  defaults();
  bind();
  renderAll();
})();
