// script.js — the browser client for the NASA Exoplanet Query app.
//
// It owns the DOM and nothing else: every rule (CSV parsing, option lists,
// multi-select querying, validation, sorting, the NASA overview link) lives in
// the DOM-free ExoplanetCore engine. This file just wires the engine to the
// dropdowns, the Search/Clear buttons, and the sortable results table. Every
// value that comes from the data is written with textContent, never innerHTML.

(function () {
  'use strict';

  const Core = window.ExoplanetCore;
  const Sample = window.ExoplanetSample;

  const dataset = Core.buildDataset(Sample.CSV);

  // The results table shows the planet name (row identity) plus the four
  // queriable columns — the spec's "only queriable fields", with the planet name
  // as the row label so identical-query rows stay distinguishable.
  const COLUMNS = [
    { key: 'pl_name', label: 'Planet', sortable: false },
    ...Core.QUERY_FIELDS.map((f) => ({ key: f.key, label: f.label, sortable: true })),
  ];

  // ----- element refs --------------------------------------------------------
  const dropdownsEl = document.getElementById('dropdowns');
  const searchBtn = document.getElementById('search-btn');
  const clearBtn = document.getElementById('clear-btn');
  const errorEl = document.getElementById('error');
  const selectionCountEl = document.getElementById('selection-count');
  const headRowEl = document.getElementById('results-head-row');
  const bodyEl = document.getElementById('results-body');
  const resultCountEl = document.getElementById('result-count');
  const emptyEl = document.getElementById('empty-state');

  // ----- state ---------------------------------------------------------------
  let lastResults = [];   // the rows from the most recent successful search
  let sortKey = null;     // which column is sorted
  let sortDir = 'asc';

  // ----- build the dropdowns -------------------------------------------------
  Core.QUERY_FIELDS.forEach((field) => {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = `sel-${field.key}`;

    const select = document.createElement('select');
    select.multiple = true;
    select.size = 6;
    select.id = `sel-${field.key}`;
    select.dataset.key = field.key;

    dataset.options[field.key].forEach((value) => {
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = String(value);
      select.appendChild(opt);
    });

    select.addEventListener('change', updateSelectionCount);
    wrap.appendChild(label);
    wrap.appendChild(select);
    dropdownsEl.appendChild(wrap);
  });

  const selects = Array.from(dropdownsEl.querySelectorAll('select'));

  function currentQuery() {
    const q = {};
    selects.forEach((sel) => {
      q[sel.dataset.key] = Array.from(sel.selectedOptions).map((o) => o.value);
    });
    return q;
  }

  function updateSelectionCount() {
    const n = selects.reduce((sum, sel) => sum + sel.selectedOptions.length, 0);
    selectionCountEl.textContent = n ? `${n} value${n === 1 ? '' : 's'} selected` : '';
    if (!errorEl.hidden && Core.hasSelection(currentQuery())) hideError();
  }

  // ----- build the table header (with sort arrows) ---------------------------
  function buildHeader() {
    headRowEl.textContent = '';
    const tr = document.createElement('tr');
    COLUMNS.forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.sortable) {
        th.classList.add('sortable');
        th.setAttribute('role', 'button');
        th.tabIndex = 0;
        const arrows = document.createElement('span');
        arrows.className = 'arrows';
        const up = document.createElement('span');
        up.className = 'up'; up.textContent = '▲';
        const down = document.createElement('span');
        down.className = 'down'; down.textContent = '▼';
        arrows.appendChild(up);
        arrows.appendChild(down);
        th.appendChild(arrows);
        if (col.key === sortKey) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        const onSort = () => toggleSort(col.key);
        th.addEventListener('click', onSort);
        th.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(); }
        });
      }
      tr.appendChild(th);
    });
    headRowEl.appendChild(tr);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    renderRows(Core.sortRows(lastResults, sortKey, sortDir));
    buildHeader();
  }

  // ----- render the result rows ----------------------------------------------
  function renderRows(rows) {
    bodyEl.textContent = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      COLUMNS.forEach((col) => {
        const td = document.createElement('td');
        if (col.key === 'hostname') {
          // Bonus: host name links to NASA's Confirmed Planet Overview page,
          // in a new tab.
          const a = document.createElement('a');
          a.className = 'host-link';
          a.href = Core.overviewUrl(row.hostname);
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = row.hostname;
          td.appendChild(a);
        } else if (col.key === 'disc_year') {
          td.className = 'year';
          td.textContent = row.disc_year == null ? '—' : String(row.disc_year);
        } else {
          const v = row[col.key];
          td.textContent = v === '' || v == null ? '—' : String(v);
        }
        tr.appendChild(td);
      });
      bodyEl.appendChild(tr);
    });
  }

  function showResults(rows) {
    lastResults = rows;
    emptyEl.classList.add('hidden');
    resultCountEl.textContent = rows.length
      ? `${rows.length} planet${rows.length === 1 ? '' : 's'} found`
      : 'No planets match that query';
    const view = sortKey ? Core.sortRows(rows, sortKey, sortDir) : rows;
    renderRows(view);
    buildHeader();
  }

  // ----- errors --------------------------------------------------------------
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  // ----- actions -------------------------------------------------------------
  function doSearch() {
    try {
      const rows = Core.search(dataset, currentQuery());
      hideError();
      showResults(rows);
    } catch (e) {
      // The spec: display an error message when searching with nothing selected.
      showError(e && e.message ? e.message : 'Something went wrong.');
    }
  }

  function doClear() {
    selects.forEach((sel) => {
      Array.from(sel.options).forEach((o) => { o.selected = false; });
    });
    hideError();
    updateSelectionCount();
    lastResults = [];
    sortKey = null;
    sortDir = 'asc';
    bodyEl.textContent = '';
    headRowEl.textContent = '';
    resultCountEl.textContent = '';
    emptyEl.classList.remove('hidden');
  }

  searchBtn.addEventListener('click', doSearch);
  clearBtn.addEventListener('click', doClear);

  // Start with an empty table and a fresh header hidden behind the empty state.
  updateSelectionCount();
})();
