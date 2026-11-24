/* script.js — wires the SQL engine (sql-core.js) to the page. */
'use strict';

(function () {
  const { Database, renderPlan, SqlError } = window.SQLCore;
  let db = new Database();

  const $ = (id) => document.getElementById(id);
  const sqlBox = $('sql');
  const msg = $('msg');

  // ---- a small, realistic sample database ----
  const SAMPLE = `
CREATE TABLE users (id INTEGER, name TEXT, city TEXT, age INTEGER);
CREATE TABLE orders (id INTEGER, user_id INTEGER, product TEXT, total REAL);
`;
  const CITIES = ['Berlin', 'Paris', 'Tokyo', 'Lagos', 'Lima', 'Oslo'];
  const PRODUCTS = ['Keyboard', 'Monitor', 'Cable', 'Webcam', 'Mouse', 'Desk'];

  function loadSample() {
    db = new Database();
    db.exec(SAMPLE);
    const N_USERS = 5000, N_ORDERS = 12000;
    const u = [];
    for (let i = 1; i <= N_USERS; i++) {
      u.push(`(${i}, 'User ${i}', '${CITIES[i % CITIES.length]}', ${18 + (i % 55)})`);
    }
    // insert in chunks to keep statements reasonable
    for (let i = 0; i < u.length; i += 1000) {
      db.exec(`INSERT INTO users (id,name,city,age) VALUES ${u.slice(i, i + 1000).join(',')}`);
    }
    const o = [];
    for (let i = 1; i <= N_ORDERS; i++) {
      o.push(`(${i}, ${1 + (i % N_USERS)}, '${PRODUCTS[i % PRODUCTS.length]}', ${(10 + (i % 90)) + 0.99})`);
    }
    for (let i = 0; i < o.length; i += 1000) {
      db.exec(`INSERT INTO orders (id,user_id,product,total) VALUES ${o.slice(i, i + 1000).join(',')}`);
    }
    sqlBox.value = "SELECT name, city, age\nFROM users\nWHERE city = 'Berlin'\nORDER BY age DESC\nLIMIT 10;";
    setMsg(`Loaded sample database: ${N_USERS.toLocaleString()} users, ${N_ORDERS.toLocaleString()} orders (no indexes yet).`, 'ok');
    renderSchema();
    clearResults();
  }

  function setMsg(text, cls) { msg.textContent = text; msg.className = 'msg' + (cls ? ' ' + cls : ''); }

  function clearResults() {
    $('results').innerHTML = '<p class="muted">Run a query to see results.</p>';
    $('result-count').textContent = '';
    $('stats').innerHTML = '';
    $('suggestions').innerHTML = '';
    $('plan').textContent = '';
  }

  // ---- run the current query ----
  function run() {
    const sql = sqlBox.value.trim().replace(/;\s*$/, '');
    if (!sql) { setMsg('Type a query first.', 'error'); return; }
    let res;
    const t0 = performance.now();
    try {
      res = db.run(sql);
    } catch (e) {
      if (e instanceof SqlError) setMsg(e.message, 'error');
      else setMsg('Error: ' + e.message, 'error');
      return;
    }
    const ms = performance.now() - t0;

    if (res.type !== 'select') {
      setMsg(describeDdl(res), 'ok');
      renderSchema();
      clearResults();
      return;
    }
    setMsg(`${res.rows.length.toLocaleString()} row(s) in ${ms.toFixed(1)} ms.`, 'ok');
    renderStats(res, ms);
    renderResults(res);
    renderSuggestions(res, sql);
    renderPlanTree(res.plan);
  }

  function describeDdl(res) {
    if (res.type === 'createTable') return `Table "${res.table}" created.`;
    if (res.type === 'createIndex') return `Index "${res.index}" created on ${res.table}(${res.column}).`;
    if (res.type === 'insert') return `Inserted ${res.rowCount} row(s) into ${res.table}.`;
    return 'OK.';
  }

  function renderStats(res, ms) {
    const ex = res.stats.rowsExamined, out = res.stats.rowsReturned;
    const ratio = out > 0 ? (ex / out) : ex;
    const hot = ex > out * 10 && ex > 100;
    $('stats').innerHTML =
      `<span>rows examined <b class="${hot ? 'hot' : ''}">${ex.toLocaleString()}</b></span>` +
      `<span>rows returned <b>${out.toLocaleString()}</b></span>` +
      `<span>examined / returned <b class="${hot ? 'hot' : ''}">${isFinite(ratio) ? ratio.toFixed(1) : '—'}×</b></span>` +
      `<span>time <b>${ms.toFixed(1)} ms</b></span>`;
  }

  function renderResults(res) {
    const el = $('results');
    if (res.rows.length === 0) { el.innerHTML = '<p class="muted">No rows.</p>'; $('result-count').textContent = ''; return; }
    const MAX = 200;
    const shown = res.rows.slice(0, MAX);
    let html = '<table class="grid"><thead><tr>' +
      res.columns.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
    for (const row of shown) {
      html += '<tr>' + row.map((v) =>
        v === null || v === undefined ? '<td class="null">NULL</td>' : `<td>${esc(v)}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
    $('result-count').textContent = res.rows.length > MAX
      ? `showing ${MAX} of ${res.rows.length.toLocaleString()}` : `${res.rows.length.toLocaleString()} row(s)`;
  }

  function renderSuggestions(res, sql) {
    const box = $('suggestions');
    if (!res.suggestions.length) {
      box.innerHTML = '<p class="no-suggestions">✓ No optimizations found — this query already uses the available indexes well.</p>';
      return;
    }
    const order = { high: 0, medium: 1, low: 2 };
    const sorted = res.suggestions.slice().sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
    box.innerHTML = '';
    for (const s of sorted) {
      const div = document.createElement('div');
      div.className = 'suggestion ' + (s.severity || 'low');
      let html = `<span class="sev">${s.severity || 'note'}</span><div>${esc(s.message)}</div>`;
      if (s.before !== undefined && s.after !== undefined) {
        html += `<div class="improve">≈ ${s.before.toLocaleString()} → ${s.after.toLocaleString()} rows examined`
          + (s.before > 0 ? ` (${Math.round((1 - s.after / s.before) * 100)}% fewer)` : '') + '</div>';
      }
      div.innerHTML = html;
      if (s.ddl) {
        const code = document.createElement('code');
        code.className = 'ddl'; code.textContent = s.ddl;
        div.appendChild(code);
        const btn = document.createElement('button');
        btn.className = 'apply'; btn.textContent = 'Apply & re-run';
        btn.onclick = () => { try { db.exec(s.ddl); } catch (e) { setMsg(e.message, 'error'); return; } run(); renderSchema(); };
        div.appendChild(btn);
      }
      box.appendChild(div);
    }
  }

  function renderPlanTree(plan) {
    const text = renderPlan(plan);
    // highlight op names and the (examined N, out N) tails
    const html = esc(text)
      .replace(/\(examined (\d+), out (\d+)\)/g, '(<span class="examined">examined $1</span>, out $2)')
      .replace(/^(\s*)([A-Za-z]+)/gm, (m, sp, op) => `${sp}<span class="op">${op}</span>`);
    $('plan').innerHTML = html;
  }

  function renderSchema() {
    const el = $('schema');
    if (db.tables.size === 0) { el.innerHTML = '<p class="muted">No tables yet.</p>'; return; }
    let html = '';
    for (const t of db.tables.values()) {
      const cols = t.columns.map((c) => `${c.name} <span class="muted">${c.type}</span>`).join(', ');
      const idx = [...t.indexes.values()].map((i) => i.column);
      html += `<div class="tbl"><h3>${esc(t.name)} <span class="muted">(${t.rows.length.toLocaleString()} rows)</span></h3>`
        + `<div class="cols">${cols}</div>`
        + (idx.length ? `<div class="cols idx">indexes: ${idx.map(esc).join(', ')}</div>` : '')
        + `</div>`;
    }
    el.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- events ----
  $('load-sample').onclick = loadSample;
  $('run').onclick = run;
  sqlBox.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });
  document.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => { sqlBox.value = c.dataset.q; run(); }));

  // boot
  loadSample();
})();
