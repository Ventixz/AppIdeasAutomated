'use strict';
/*
 * script.js — browser front end for the Remote SQL Tool.
 *
 * Browsers can't open raw TCP, so we wire the hand-written PgClient to an
 * in-page PgServer that speaks the same PostgreSQL v3 protocol. The handshake
 * (including SCRAM-SHA-256) is real; only the transport is a loopback instead of
 * a socket. Every message is mirrored into the protocol-trace panel.
 */

const P = window.PgCore;
const $ = (id) => document.getElementById(id);

let client = null;
let server = null;
let connected = false;

const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]);

// The in-page server has FIXED accounts, like a real server would — so typing a
// wrong password (or an unknown user) fails authentication for real, instead of
// the server silently learning whatever you typed.
const SERVER_ACCOUNTS = { secure: 'pencil', app: 'hunter2', postgres: 'postgres' };

const SAMPLES = [
  ['all engineers', "SELECT name, salary FROM employees WHERE department = 'Engineering' ORDER BY salary DESC"],
  ['active only', 'SELECT id, name, active FROM employees WHERE active = true ORDER BY id'],
  ['headcount', 'SELECT count(*) FROM employees'],
  ['departments', 'SELECT * FROM departments ORDER BY budget DESC'],
  ['top earner', 'SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 1'],
  ['server version', 'SELECT version()'],
  ['a NULL manager', 'SELECT id, name, manager_id FROM employees WHERE manager_id IS NULL'],
  ['missing table', 'SELECT * FROM customers'],
];

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + cls;
}

function addTrace(e) {
  const list = $('trace');
  const ph = list.querySelector('.placeholder');
  if (ph) ph.remove();
  const li = document.createElement('li');
  const dirClass = e.dir === 'C→S' ? 'cs' : 'sc';
  li.innerHTML =
    `<span class="dir ${dirClass}">${e.dir}</span>` +
    `<span class="label">${escapeHtml(e.label)}</span>` +
    `<span class="len">${e.len}B</span>` +
    `<span class="hex">${hexDump(e.bytes)}</span>`;
  li.addEventListener('click', () => li.classList.toggle('show-hex'));
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

function hexDump(bytes) {
  const max = 64;
  let out = '';
  for (let i = 0; i < Math.min(bytes.length, max); i++) out += bytes[i].toString(16).padStart(2, '0') + ' ';
  if (bytes.length > max) out += `… (+${bytes.length - max} bytes)`;
  return out.trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clearTrace() {
  $('trace').innerHTML = '<li class="placeholder">Messages appear here as they cross the wire.</li>';
}

async function connect() {
  disconnect(true);
  clearTrace();
  const authMethod = $('authMethod').value;
  const user = $('user').value.trim() || 'postgres';
  const password = $('password').value;
  const database = $('database').value.trim() || user;

  server = new P.PgServer({
    authMethod,
    users: SERVER_ACCOUNTS, // fixed, server-side — the client must prove it knows the password
    database,
  });
  client = new P.PgClient({
    user, password, database,
    application_name: 'remote-sql-tool/web',
    onTrace: addTrace,
  });
  P.connectLoopback(client, server);

  setStatus('connecting…', 'connecting');
  $('connectBtn').disabled = true;
  try {
    await client.connect();
    connected = true;
    setStatus(`connected · ${client.authMethod}`, 'on');
    $('disconnectBtn').disabled = false;
    $('runBtn').disabled = false;
    showMessage(`<span class="cmdtag">Connected to ${escapeHtml(database)} as ${escapeHtml(user)}</span>` +
      `<p class="hint">Authenticated with <strong>${escapeHtml(client.authMethod)}</strong>. Server reports ` +
      `<code>${escapeHtml(client.parameters.server_version || '?')}</code>. Now run a query.</p>`);
  } catch (err) {
    setStatus('auth failed', 'error');
    $('connectBtn').disabled = false;
    showError(err);
  }
}

function disconnect(silent) {
  if (client) { try { client.end(); } catch (_) {} }
  client = null; server = null; connected = false;
  $('connectBtn').disabled = false;
  $('disconnectBtn').disabled = true;
  $('runBtn').disabled = true;
  if (!silent) setStatus('offline', 'off');
}

async function runQuery() {
  if (!connected) return;
  const sql = $('sql').value.trim();
  if (!sql) return;
  $('runBtn').disabled = true;
  try {
    const result = await client.query(sql);
    renderResults(result);
  } catch (err) {
    showError(err);
  } finally {
    $('runBtn').disabled = !connected;
  }
}

function renderResults(result) {
  const container = $('result');
  container.innerHTML = '';
  for (const r of result.results) {
    const block = document.createElement('div');
    block.className = 'result-block';
    if (!r.fields || r.fields.length === 0) {
      block.innerHTML = `<div class="cmdtag">${escapeHtml(r.command || '(done)')}</div>`;
      container.appendChild(block);
      continue;
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    for (const f of r.fields) {
      const th = document.createElement('th');
      th.innerHTML = `${escapeHtml(f.name)}<span class="t">${escapeHtml(f.dataType)}</span>`;
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of r.rows) {
      const tr = document.createElement('tr');
      for (const f of r.fields) {
        const td = document.createElement('td');
        const v = row[f.name];
        if (v === null) { td.textContent = 'NULL'; td.className = 'null'; }
        else if (typeof v === 'boolean') { td.textContent = v ? 'true' : 'false'; td.className = v ? 'bool-true' : 'bool-false'; }
        else if (NUMERIC_OIDS.has(oidForField(f))) { td.textContent = String(v); td.className = 'num'; }
        else td.textContent = String(v);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    block.innerHTML = `<div class="cmdtag">${escapeHtml(r.command)}</div>`;
    block.appendChild(table);
    const rc = document.createElement('div');
    rc.className = 'rowcount';
    rc.textContent = `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}`;
    block.appendChild(rc);
    container.appendChild(block);
  }
  if (!container.children.length) showMessage('<p class="placeholder">No result sets.</p>');
}

// field.dataType is a name; map back to decide numeric alignment
function oidForField(f) {
  const byName = { bool: 16, int2: 21, int4: 23, int8: 20, oid: 26, float4: 700, float8: 701, numeric: 1700 };
  return byName[f.dataType] !== undefined ? byName[f.dataType] : -1;
}

function showError(err) {
  const code = err.code ? `<span class="code">[${escapeHtml(err.code)}]</span> ` : '';
  $('result').innerHTML = `<div class="errbox">${code}${escapeHtml(err.message)}</div>`;
}
function showMessage(html) { $('result').innerHTML = html; }

function buildChips() {
  const box = $('chips');
  for (const [label, sql] of SAMPLES) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      $('sql').value = sql;
      if (connected) runQuery();
    });
    box.appendChild(chip);
  }
}

// --- wire up ---
$('connectBtn').addEventListener('click', connect);
$('disconnectBtn').addEventListener('click', () => disconnect(false));
$('runBtn').addEventListener('click', runQuery);
$('sql').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
});
buildChips();
