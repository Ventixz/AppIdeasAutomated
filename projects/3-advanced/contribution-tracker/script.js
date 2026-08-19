// script.js — the browser layer for the Contribution Tracker.
//
// It wires the DOM to the pure engine in contrib-core.js: routing between the
// Dashboard / Transactions / About views, the entry form, the sortable ledger,
// the delete-confirm dialog, hand-drawn SVG charts, and persistence.
//
// Persistence note: the spec says transactions must NOT live in localStorage.
// So the ledger is stored in an IndexedDB database ("database" persistence),
// with JSON/CSV file export as the "files" path. Only the theme and the last
// sort choice — non-sensitive UI preferences — use localStorage.

/* global ContribCore */
(function () {
  'use strict';
  const C = ContribCore;

  // --- State --------------------------------------------------------------
  let transactions = [];     // the ledger, as core records
  let editingId = null;      // id being modified, or null when adding
  let sort = { key: 'date', dir: 'desc' };
  let pendingDeleteId = null;

  const $ = (sel) => document.querySelector(sel);
  const el = (id) => document.getElementById(id);

  // --- IndexedDB persistence ---------------------------------------------
  const DB_NAME = 'contribution-tracker';
  const STORE = 'transactions';
  let db = null;
  let memoryOnly = false; // fallback if IndexedDB is unavailable (e.g. file:// in some browsers)

  function openDB() {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) { memoryOnly = true; return resolve(null); }
      let req;
      try {
        req = window.indexedDB.open(DB_NAME, 1);
      } catch (e) {
        memoryOnly = true;
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => { memoryOnly = true; resolve(null); };
    });
  }

  function loadAll() {
    return new Promise((resolve) => {
      if (!db) return resolve([]);
      let rows = [];
      try {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = () => { rows = req.result || []; };
        tx.oncomplete = () => resolve(sanitize(rows));
        tx.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  // Persist the whole ledger by clearing and rewriting — the dataset is small
  // and this keeps the store an exact mirror of `transactions`.
  function persist() {
    if (!db) return; // memoryOnly: nothing to do
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      for (const t of transactions) store.put(t);
    } catch (e) {
      /* ignore write failures; UI already has the data in memory */
    }
  }

  // Defensive: only keep rows that still look like valid records, so a
  // corrupted database recovers to a clean ledger instead of throwing.
  function sanitize(rows) {
    const out = [];
    for (const r of rows) {
      if (
        r && typeof r.id === 'string' &&
        typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
        typeof r.payee === 'string' &&
        Number.isFinite(r.cents) && r.cents > 0
      ) {
        out.push({ id: r.id, date: r.date, payee: r.payee, cents: Math.round(r.cents), memo: String(r.memo || '') });
      }
    }
    return out;
  }

  // --- Routing ------------------------------------------------------------
  const ROUTES = ['dashboard', 'transactions', 'about'];

  function route() {
    const hash = (location.hash || '#dashboard').replace('#', '');
    const name = ROUTES.includes(hash) ? hash : 'dashboard';
    for (const r of ROUTES) {
      el('view-' + r).hidden = r !== name;
    }
    for (const a of document.querySelectorAll('.menu a')) {
      a.classList.toggle('active', a.dataset.route === name);
    }
    closeMenu();
    if (name === 'dashboard') renderDashboard();
    window.scrollTo(0, 0);
  }

  // --- Menu + theme -------------------------------------------------------
  function toggleMenu() {
    const menu = el('menu');
    const open = menu.hidden;
    menu.hidden = !open;
    el('hamburger').setAttribute('aria-expanded', String(open));
  }
  function closeMenu() {
    el('menu').hidden = true;
    el('hamburger').setAttribute('aria-expanded', 'false');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ct-theme', theme); } catch (e) { /* ignore */ }
  }
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('ct-theme'); } catch (e) { /* ignore */ }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  }

  // --- Toast --------------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // --- Entry form ---------------------------------------------------------
  function readForm() {
    return {
      date: el('in-date').value,
      payee: el('in-payee').value,
      amount: el('in-amount').value,
      memo: el('in-memo').value,
    };
  }
  function clearForm() {
    el('in-date').value = '';
    el('in-payee').value = '';
    el('in-amount').value = '';
    el('in-memo').value = '';
    editingId = null;
    el('btn-add').textContent = 'Add';
    hideErrors();
    for (const tr of document.querySelectorAll('.ledger tbody tr.editing')) tr.classList.remove('editing');
  }
  function showErrors(list) {
    const box = el('entry-errors');
    box.innerHTML = '';
    const ul = document.createElement('ul');
    ul.style.margin = '0';
    ul.style.paddingLeft = '1.1rem';
    for (const msg of list) {
      const li = document.createElement('li');
      li.textContent = msg;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    box.hidden = false;
  }
  function hideErrors() { el('entry-errors').hidden = true; }

  function submitEntry(ev) {
    ev.preventDefault();
    const fields = readForm();
    try {
      if (editingId) {
        transactions = C.updateTransaction(transactions, editingId, fields);
        toast('Transaction updated.');
      } else {
        transactions = C.addTransaction(transactions, fields);
        toast('Transaction added.');
      }
      persist();
      clearForm();
      renderLedger();
      refreshYearOptions();
    } catch (e) {
      if (e.errors) showErrors(e.errors);
      else showErrors([e.message]);
    }
  }

  function startEdit(id) {
    const t = transactions.find((x) => x.id === id);
    if (!t) return;
    el('in-date').value = t.date;
    el('in-payee').value = t.payee;
    el('in-amount').value = C.centsToInput(t.cents);
    el('in-memo').value = t.memo;
    editingId = id;
    el('btn-add').textContent = 'Modify';
    hideErrors();
    renderLedger();
    if (location.hash.replace('#', '') !== 'transactions') location.hash = '#transactions';
    el('in-amount').focus();
  }

  // --- Delete confirmation dialog ----------------------------------------
  function askDelete(id) {
    const t = transactions.find((x) => x.id === id);
    if (!t) return;
    pendingDeleteId = id;
    el('confirm-body').textContent =
      `${t.payee} — ${C.formatMoney(t.cents)} on ${t.date}. This cannot be undone.`;
    el('confirm-backdrop').hidden = false;
    el('confirm-cancel').focus();
  }
  function closeDialog() { el('confirm-backdrop').hidden = true; pendingDeleteId = null; }
  function confirmDelete() {
    if (!pendingDeleteId) return closeDialog();
    try {
      transactions = C.deleteTransaction(transactions, pendingDeleteId);
      if (editingId === pendingDeleteId) clearForm();
      persist();
      renderLedger();
      refreshYearOptions();
      toast('Transaction deleted.');
    } catch (e) {
      toast(e.message);
    }
    closeDialog();
  }

  // --- Ledger rendering ---------------------------------------------------
  function renderLedger() {
    const body = el('ledger-body');
    body.innerHTML = '';
    const rows = C.sortTransactions(transactions, sort.key, sort.dir);

    el('ledger-empty').hidden = rows.length !== 0;
    el('ledger-count').textContent =
      rows.length === 0 ? '' :
      `${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${C.formatMoney(C.sumCents(transactions.map((t) => t.cents)))} total`;

    for (const t of rows) {
      const tr = document.createElement('tr');
      if (t.id === editingId) tr.classList.add('editing');

      tr.appendChild(td(t.date));
      tr.appendChild(td(t.payee));
      const amt = td(C.formatMoney(t.cents)); amt.className = 'num'; tr.appendChild(amt);
      const memo = td(t.memo); memo.className = 'memo-cell'; memo.title = t.memo; tr.appendChild(memo);

      const actions = document.createElement('td');
      actions.className = 'actions-col';
      actions.appendChild(rowButton('Modify', 'mod', () => startEdit(t.id)));
      actions.appendChild(rowButton('Delete', 'del', () => askDelete(t.id)));
      tr.appendChild(actions);

      body.appendChild(tr);
    }
    updateSortArrows();
  }
  function td(text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }
  function rowButton(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  function updateSortArrows() {
    for (const th of document.querySelectorAll('.ledger th.sortable')) {
      const arrow = th.querySelector('.arrow');
      arrow.textContent = th.dataset.key === sort.key ? (sort.dir === 'asc' ? '▲' : '▼') : '';
    }
  }
  function onSortClick(key) {
    if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    else { sort.key = key; sort.dir = key === 'amount' || key === 'date' ? 'desc' : 'asc'; }
    try { localStorage.setItem('ct-sort', JSON.stringify(sort)); } catch (e) { /* ignore */ }
    renderLedger();
  }

  // --- Export / import ----------------------------------------------------
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJSON() {
    if (!transactions.length) return toast('Nothing to export yet.');
    download('contributions.json', C.toJSON(transactions), 'application/json');
  }
  function exportCSV() {
    if (!transactions.length) return toast('Nothing to export yet.');
    download('contributions.csv', C.toCSV(transactions), 'text/csv');
  }
  function importJSON(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = C.fromJSON(String(reader.result));
        transactions = imported;
        editingId = null;
        persist();
        renderLedger();
        refreshYearOptions();
        clearForm();
        toast(`Imported ${imported.length} transaction${imported.length === 1 ? '' : 's'}.`);
      } catch (e) {
        toast(e.message);
      }
    };
    reader.readAsText(file);
    ev.target.value = ''; // allow re-importing the same file
  }

  // --- Dashboard ----------------------------------------------------------
  function yearsWithData() {
    return C.yearlyTotals(transactions).map((y) => y.year);
  }
  function refreshYearOptions() {
    const sel = el('focus-year');
    const years = yearsWithData();
    const prev = sel.value;
    sel.innerHTML = '';
    for (const y of years.slice().reverse()) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      sel.appendChild(opt);
    }
    if (years.length) {
      sel.value = years.map(String).includes(prev) ? prev : String(years[years.length - 1]);
    }
    if (!el('view-dashboard').hidden) renderDashboard();
  }

  function renderDashboard() {
    const hasData = transactions.length > 0;
    el('dash-empty').hidden = hasData;
    el('dash-cards').hidden = !hasData;
    el('dash-charts').hidden = !hasData;
    if (!hasData) return;

    const focus = Number(el('focus-year').value) || yearsWithData().slice(-1)[0];
    const s = C.summarize(transactions, focus);

    // Cards
    const yearTotal = s.yearly.find((y) => y.year === focus);
    el('card-year-total').textContent = C.formatMoney(yearTotal ? yearTotal.cents : 0);

    const yoyForFocus = s.yoy.find((y) => y.year === focus);
    const yoyCard = el('card-yoy');
    yoyCard.classList.remove('up', 'down');
    if (yoyForFocus && yoyForFocus.pct !== null) {
      const up = yoyForFocus.deltaCents >= 0;
      yoyCard.classList.add(up ? 'up' : 'down');
      const pct = Math.abs(yoyForFocus.pct).toFixed(1);
      yoyCard.textContent = `${up ? '▲' : '▼'} ${pct}% (${up ? '+' : '-'}${C.formatMoney(Math.abs(yoyForFocus.deltaCents))})`;
    } else {
      yoyCard.textContent = '— (no prior year)';
    }

    el('card-avg-tx').textContent = C.formatMoney(s.averages.perTxCents);
    el('card-avg-month').textContent = C.formatMoney(s.averages.perMonthCents);

    el('chart-month-year').textContent = `(${focus})`;
    drawMonthlyChart(s.monthly);
    drawYearlyChart(s.yoy);
  }

  // Build an SVG element/child with attributes set.
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    const node = document.createElementNS(SVGNS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    return node;
  }

  // Monthly bar chart: 12 bars, one per month of the focus year.
  function drawMonthlyChart(monthly) {
    const host = el('chart-monthly');
    host.innerHTML = '';
    const W = 640, H = 240, padL = 44, padR = 12, padT = 14, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const max = Math.max(1, ...monthly);
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Contributions by month' });

    // gridlines + y labels (4 steps)
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      root.appendChild(svg('line', { class: 'grid-line', x1: padL, y1: y, x2: W - padR, y2: y }));
      const val = max * (1 - i / 4);
      root.appendChild(svg('text', { class: 'axis-label', x: padL - 6, y: y + 3, 'text-anchor': 'end' }, shortMoney(val)));
    }

    const bw = plotW / 12;
    for (let m = 0; m < 12; m++) {
      const h = (monthly[m] / max) * plotH;
      const x = padL + m * bw + bw * 0.15;
      const y = padT + plotH - h;
      const w = bw * 0.7;
      const bar = svg('rect', { class: 'bar', x, y, width: w, height: Math.max(0, h), rx: 3 });
      const title = svg('title', {}, `${C.MONTHS[m]}: ${C.formatMoney(monthly[m])}`);
      bar.appendChild(title);
      root.appendChild(bar);
      root.appendChild(svg('text', { class: 'axis-label', x: x + w / 2, y: H - 8, 'text-anchor': 'middle' }, C.MONTHS[m]));
    }
    host.appendChild(root);
  }

  // Yearly bar chart, colored by year-over-year direction.
  function drawYearlyChart(yoy) {
    const host = el('chart-yearly');
    host.innerHTML = '';
    if (!yoy.length) return;
    const W = 640, H = 240, padL = 44, padR = 12, padT = 14, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const max = Math.max(1, ...yoy.map((y) => y.cents));
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Total by year' });

    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      root.appendChild(svg('line', { class: 'grid-line', x1: padL, y1: y, x2: W - padR, y2: y }));
      const val = max * (1 - i / 4);
      root.appendChild(svg('text', { class: 'axis-label', x: padL - 6, y: y + 3, 'text-anchor': 'end' }, shortMoney(val)));
    }

    const n = yoy.length;
    const slot = plotW / n;
    const bw = Math.min(slot * 0.6, 70);
    yoy.forEach((y, i) => {
      const h = (y.cents / max) * plotH;
      const cx = padL + slot * i + slot / 2;
      const x = cx - bw / 2;
      const top = padT + plotH - h;
      let cls = 'bar';
      if (y.pct !== null) cls += y.deltaCents >= 0 ? ' bar-up' : ' bar-down';
      const bar = svg('rect', { class: cls, x, y: top, width: bw, height: Math.max(0, h), rx: 3 });
      const label = y.pct === null ? 'first year' : `${y.deltaCents >= 0 ? '+' : '-'}${Math.abs(y.pct).toFixed(1)}% YoY`;
      bar.appendChild(svg('title', {}, `${y.year}: ${C.formatMoney(y.cents)} (${label})`));
      root.appendChild(bar);
      root.appendChild(svg('text', { class: 'bar-value', x: cx, y: top - 5, 'text-anchor': 'middle' }, shortMoney(y.cents)));
      root.appendChild(svg('text', { class: 'axis-label', x: cx, y: H - 8, 'text-anchor': 'middle' }, String(y.year)));
    });
    host.appendChild(root);
  }

  // Compact money for axis ticks: $1.2k, $3.4M.
  function shortMoney(cents) {
    const dollars = cents / 100;
    if (dollars >= 1e6) return '$' + (dollars / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (dollars >= 1e3) return '$' + (dollars / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(dollars);
  }

  // --- Wiring -------------------------------------------------------------
  function bind() {
    el('hamburger').addEventListener('click', toggleMenu);
    el('theme-toggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
      if (!el('view-dashboard').hidden) renderDashboard();
    });
    document.addEventListener('click', (e) => {
      // close the menu when clicking outside it
      if (!el('menu').hidden && !e.target.closest('.menu') && !e.target.closest('.hamburger')) closeMenu();
    });
    window.addEventListener('hashchange', route);

    el('entry-form').addEventListener('submit', submitEntry);
    el('btn-clear').addEventListener('click', clearForm);

    for (const th of document.querySelectorAll('.ledger th.sortable')) {
      th.addEventListener('click', () => onSortClick(th.dataset.key));
    }

    el('btn-export-csv').addEventListener('click', exportCSV);
    el('btn-export-json').addEventListener('click', exportJSON);
    el('import-json').addEventListener('change', importJSON);
    el('btn-print').addEventListener('click', () => window.print());

    el('confirm-cancel').addEventListener('click', closeDialog);
    el('confirm-ok').addEventListener('click', confirmDelete);
    el('confirm-backdrop').addEventListener('click', (e) => {
      if (e.target === el('confirm-backdrop')) closeDialog();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDialog(); closeMenu(); }
    });

    el('focus-year').addEventListener('change', renderDashboard);
  }

  function restoreSort() {
    try {
      const raw = localStorage.getItem('ct-sort');
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.key && s.dir) sort = s;
      }
    } catch (e) { /* ignore */ }
  }

  // --- Boot ---------------------------------------------------------------
  async function boot() {
    initTheme();
    restoreSort();
    bind();
    await openDB();
    transactions = await loadAll();
    // Prefill the date field with today for convenience (a UI nicety, not stored).
    try { el('in-date').valueAsDate = new Date(); } catch (e) { /* ignore */ }
    renderLedger();
    refreshYearOptions();
    route();
    if (memoryOnly) toast('Storage unavailable — data will not persist this session.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
