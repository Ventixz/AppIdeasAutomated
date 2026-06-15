"use strict";

/**
 * First DB App — a minimal tour of IndexedDB.
 *
 * Three operations drive everything: load a fixed set of customers, query them
 * back, and clear the store. Each step opens a transaction, narrates itself in
 * the log panel, and leaves the data on disk so a reload picks up where you
 * left off. IndexedDB is asynchronous and event-based, so every helper is
 * wrapped in a Promise to keep the control flow readable.
 *
 * Note: browser databases live in the (insecure) client, so only ever store
 * non-sensitive data here — the sample customers below are entirely made up.
 */

const DB_NAME = "first-db-app";
const DB_VERSION = 1;
const STORE = "customers";

// Bonus: the model carries date-of-last-order and total-annual-sales fields.
const SAMPLE_CUSTOMERS = [
  { id: 1, name: "Ada Lovelace", city: "London", lastOrder: "2026-05-31", annualSales: 18400 },
  { id: 2, name: "Grace Hopper", city: "New York", lastOrder: "2026-06-02", annualSales: 23950 },
  { id: 3, name: "Alan Turing", city: "Manchester", lastOrder: "2026-04-18", annualSales: 9120 },
  { id: 4, name: "Katherine Johnson", city: "Hampton", lastOrder: "2026-06-10", annualSales: 31200 },
  { id: 5, name: "Linus Torvalds", city: "Portland", lastOrder: "2026-05-09", annualSales: 14760 },
];

const els = {
  load: document.getElementById("load"),
  query: document.getElementById("query"),
  clear: document.getElementById("clear"),
  notice: document.getElementById("notice"),
  results: document.getElementById("results"),
  count: document.getElementById("count"),
  log: document.getElementById("log"),
  logClear: document.getElementById("log-clear"),
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/* ---------------------------------------------------------------- UI helpers */

function notify(message, kind = "") {
  els.notice.className = "notice" + (kind ? " " + kind : "");
  els.notice.innerHTML = message;
}

function log(message, kind = "") {
  const li = document.createElement("li");
  if (kind) li.className = kind;
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date().toLocaleTimeString();
  li.append(time, document.createTextNode(message));
  els.log.append(li);
  els.log.scrollTop = els.log.scrollHeight;
}

/**
 * Reflect application state in the buttons. Load is always available (it
 * re-seeds); Query and Clear only make sense once the store holds rows.
 */
function setButtons({ hasRows, busy }) {
  els.load.disabled = busy;
  els.query.disabled = busy || !hasRows;
  els.clear.disabled = busy || !hasRows;
}

function renderResults(rows) {
  els.results.innerHTML = "";

  if (rows.length === 0) {
    els.count.hidden = true;
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Query returned no rows — the store is empty.";
    els.results.append(p);
    return;
  }

  els.count.hidden = false;
  els.count.textContent = String(rows.length);

  for (const c of rows) {
    const row = document.createElement("div");
    row.className = "customer";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = `#${c.id} — ${c.name}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML =
      `<span>📍 ${c.city}</span>` +
      `<span>🗓 Last order: ${c.lastOrder}</span>` +
      `<span>💰 Annual sales: ${money.format(c.annualSales)}</span>`;

    row.append(name, meta);
    els.results.append(row);
  }
}

/* ------------------------------------------------------------- IndexedDB I/O */

/** Open (and on first run, create) the database. Resolves with the connection. */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
        log(`Created object store "${STORE}".`, "ok");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Write every sample customer inside one read-write transaction. */
function loadDB() {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        SAMPLE_CUSTOMERS.forEach((c) => store.put(c));
        tx.oncomplete = () => { db.close(); resolve(SAMPLE_CUSTOMERS.length); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      })
  );
}

/**
 * queryAllRows — read every record from the store via a cursor and collect
 * them into an array. Using a cursor (rather than getAll) shows the row-by-row
 * iteration model that larger queries are built on.
 */
function queryAllRows() {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const rows = [];
        const tx = db.transaction(STORE, "readonly");
        const cursorRequest = tx.objectStore(STORE).openCursor();

        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            rows.push(cursor.value);
            cursor.continue();
          }
        };
        tx.oncomplete = () => { db.close(); resolve(rows); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      })
  );
}

/** Remove every record from the store. */
function clearDB() {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      })
  );
}

/** Cheap "is there anything in the store?" check used to set button states. */
function countRows() {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).count();
        request.onsuccess = () => { db.close(); resolve(request.result); };
        request.onerror = () => { db.close(); reject(request.error); };
      })
  );
}

/* ----------------------------------------------------------- Event handlers */

async function onLoad() {
  setButtons({ hasRows: false, busy: true });
  log("Load DB — starting…");
  try {
    const n = await loadDB();
    log(`Wrote ${n} customer records.`, "ok");
    log("Load DB — done.", "ok");
    notify(`Loaded <strong>${n}</strong> customers. Now try <strong>Query DB</strong>.`, "ok");
    setButtons({ hasRows: true, busy: false });
  } catch (err) {
    handleError("Load DB", err);
  }
}

async function onQuery() {
  setButtons({ hasRows: true, busy: true });
  log("Query DB — starting…");
  try {
    const rows = await queryAllRows();
    renderResults(rows);
    if (rows.length === 0) {
      log("Query returned 0 rows.", "warn");
      notify("Query returned no rows. Click <strong>Load DB</strong> to seed data.", "warn");
    } else {
      log(`Query returned ${rows.length} rows.`, "ok");
      notify(`Showing <strong>${rows.length}</strong> customers from the store.`, "ok");
    }
    log("Query DB — done.", "ok");
    setButtons({ hasRows: rows.length > 0, busy: false });
  } catch (err) {
    handleError("Query DB", err);
  }
}

async function onClear() {
  setButtons({ hasRows: true, busy: true });
  log("Clear DB — starting…");
  try {
    await clearDB();
    renderResults([]);
    log("Cleared all records.", "ok");
    log("Clear DB — done.", "ok");
    notify("Database cleared. Click <strong>Load DB</strong> to start over.", "warn");
    setButtons({ hasRows: false, busy: false });
  } catch (err) {
    handleError("Clear DB", err);
  }
}

async function handleError(op, err) {
  console.error(err);
  log(`${op} failed: ${err && err.message ? err.message : err}`, "error");
  notify(`<strong>${op} failed.</strong> See the log for details.`, "error");
  // Re-derive button state from the database after a failure.
  try {
    const n = await countRows();
    setButtons({ hasRows: n > 0, busy: false });
  } catch {
    setButtons({ hasRows: false, busy: false });
  }
}

/* ------------------------------------------------------------------ Wire up */

els.load.addEventListener("click", onLoad);
els.query.addEventListener("click", onQuery);
els.clear.addEventListener("click", onClear);
els.logClear.addEventListener("click", () => { els.log.innerHTML = ""; });

// On startup, inspect what's already persisted and set the controls to match.
(async function init() {
  if (!("indexedDB" in window)) {
    notify("This browser does not support IndexedDB.", "error");
    setButtons({ hasRows: false, busy: true });
    return;
  }
  log("App ready.");
  try {
    const n = await countRows();
    if (n > 0) {
      log(`Found ${n} existing records from a previous session.`, "ok");
      notify(`Found <strong>${n}</strong> persisted customers. Try <strong>Query DB</strong>.`, "ok");
    }
    setButtons({ hasRows: n > 0, busy: false });
  } catch (err) {
    handleError("Startup", err);
  }
})();
