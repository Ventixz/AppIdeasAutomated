// exoplanet-core.js — the presentation-free engine for the NASA Exoplanet Query app.
//
// It knows nothing about the DOM or the network. You hand it the raw CSV text a
// NASA Exoplanet Archive export produces (or the bundled sample snapshot) and it
// parses it into normalized planet records, derives the four queriable dropdown
// option lists, runs a multi-select query (OR within a field, AND across
// fields), validates that at least one value was chosen, sorts the result set
// ascending/descending on any column, and builds the NASA "Confirmed Planet
// Overview" hyperlink for a host. The same code runs in the browser (loaded as a
// plain script) and in Node (for the test suite).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  else root.ExoplanetCore = api;                                          // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The four fields the spec exposes as query dropdowns. `key` is the CSV /
  // record column, `label` is what the UI shows, `numeric` drives sorting and
  // option ordering.
  const QUERY_FIELDS = [
    { key: 'disc_year', label: 'Year of Discovery', numeric: true },
    { key: 'discoverymethod', label: 'Discovery Method', numeric: false },
    { key: 'hostname', label: 'Host Name', numeric: false },
    { key: 'disc_facility', label: 'Discovery Facility', numeric: false },
  ];
  const QUERY_KEYS = QUERY_FIELDS.map((f) => f.key);

  // ---------------------------------------------------------------------------
  // CSV parsing.
  //
  // NASA Exoplanet Archive CSV exports carry a block of `#`-prefixed comment
  // lines, then a header row, then data. Fields may be quoted (a name like
  // "PSR B1257+12 c" is safe, but facilities like "W. M. Keck Observatory" and
  // any embedded comma need quoting). This is a small, correct RFC-4180-ish
  // reader: it honours quotes, doubled `""` escapes, and CRLF, and skips comment
  // and blank lines that sit *outside* a quoted field.
  // ---------------------------------------------------------------------------
  function parseCSV(text) {
    const rows = [];
    let field = '';
    let record = [];
    let inQuotes = false;
    let started = false; // any char seen on the current physical line yet?
    let lineIsComment = false;
    const s = String(text == null ? '' : text);

    function endField() {
      record.push(field);
      field = '';
    }
    function endRecord() {
      endField();
      // Drop a record that is a single empty field (a blank line).
      if (!(record.length === 1 && record[0] === '')) rows.push(record);
      record = [];
      started = false;
      lineIsComment = false;
    }

    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 1; }
          else inQuotes = false;
        } else {
          field += c;
        }
        continue;
      }
      // Not in quotes.
      if (!started && (c === '#')) { lineIsComment = true; started = true; continue; }
      if (lineIsComment) {
        if (c === '\n') { lineIsComment = false; started = false; }
        continue;
      }
      if (c === '"') { started = true; inQuotes = true; continue; }
      if (c === ',') { started = true; endField(); continue; }
      if (c === '\r') { continue; }
      if (c === '\n') { if (started) endRecord(); continue; }
      started = true;
      field += c;
    }
    // Flush a trailing record with no final newline.
    if (started || field !== '' || record.length) endRecord();
    return rows;
  }

  // Turn parsed CSV rows into an array of column-keyed objects using the first
  // row as the header. Extra columns beyond the header are ignored; missing ones
  // read as ''.
  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const header = rows[0].map((h) => String(h).trim());
    const out = [];
    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i];
      const obj = {};
      for (let c = 0; c < header.length; c += 1) obj[header[c]] = r[c] == null ? '' : r[c];
      out.push(obj);
    }
    return out;
  }

  function parseRecords(csvText) {
    return rowsToObjects(parseCSV(csvText));
  }

  // ---------------------------------------------------------------------------
  // Normalization. Coerce a loose CSV object into the small stable shape the
  // rest of the engine and the UI rely on, rejecting rows that can't identify a
  // planet or host. `disc_year` becomes a real number (or null).
  // ---------------------------------------------------------------------------
  function toYear(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!/^-?\d{1,4}$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const pl_name = String(raw.pl_name == null ? '' : raw.pl_name).trim();
    const hostname = String(raw.hostname == null ? '' : raw.hostname).trim();
    if (!pl_name || !hostname) return null;
    return {
      pl_name,
      hostname,
      disc_year: toYear(raw.disc_year),
      discoverymethod: String(raw.discoverymethod == null ? '' : raw.discoverymethod).trim(),
      disc_facility: String(raw.disc_facility == null ? '' : raw.disc_facility).trim(),
    };
  }

  function normalizeRecords(rawList) {
    if (!Array.isArray(rawList)) return [];
    const out = [];
    for (const raw of rawList) {
      const rec = normalizeRecord(raw);
      if (rec) out.push(rec);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // The dataset: normalized rows plus the unique, sorted option list for each
  // query field (blank values are dropped so a dropdown never offers "").
  // ---------------------------------------------------------------------------
  function fieldOptions(rows, field) {
    const seen = new Set();
    for (const row of rows) {
      const v = row[field.key];
      if (v === '' || v == null) continue;
      seen.add(v);
    }
    const arr = Array.from(seen);
    if (field.numeric) arr.sort((a, b) => Number(a) - Number(b));
    else arr.sort((a, b) => String(a).localeCompare(String(b)));
    return arr;
  }

  function buildDataset(csvOrRecords) {
    const raw = typeof csvOrRecords === 'string' ? parseRecords(csvOrRecords) : csvOrRecords;
    const rows = normalizeRecords(raw);
    const options = {};
    for (const field of QUERY_FIELDS) options[field.key] = fieldOptions(rows, field);
    return { rows, options };
  }

  // ---------------------------------------------------------------------------
  // Querying. A query is `{ disc_year:[...], discoverymethod:[...], ... }` where
  // each entry is the list of selected values for that field. Empty (or absent)
  // means "don't filter on this field". A row matches when, for every field that
  // has selections, the row's value is one of them (OR within a field), and all
  // constrained fields match (AND across fields).
  // ---------------------------------------------------------------------------
  function selectedValues(query, key) {
    if (!query) return [];
    const v = query[key];
    if (v == null) return [];
    const arr = Array.isArray(v) ? v : [v];
    // disc_year comparisons are done as strings so "2011" (dropdown) matches the
    // numeric 2011 on the row; everything else is already a string.
    return arr.map((x) => String(x)).filter((x) => x !== '');
  }

  function hasSelection(query) {
    return QUERY_KEYS.some((k) => selectedValues(query, k).length > 0);
  }

  function matchesRow(row, query) {
    for (const key of QUERY_KEYS) {
      const sel = selectedValues(query, key);
      if (!sel.length) continue;
      const val = row[key] == null ? '' : String(row[key]);
      if (!sel.includes(val)) return false;
    }
    return true;
  }

  // Run a query against a dataset (or a plain rows array). Throws when nothing is
  // selected — the spec requires an error rather than dumping all 4,000+ rows.
  function search(datasetOrRows, query) {
    const rows = Array.isArray(datasetOrRows) ? datasetOrRows : (datasetOrRows && datasetOrRows.rows) || [];
    if (!hasSelection(query)) {
      const err = new Error('Select at least one value to search.');
      err.code = 'NO_SELECTION';
      throw err;
    }
    return rows.filter((row) => matchesRow(row, query));
  }

  // ---------------------------------------------------------------------------
  // Sorting. Stable sort on any query column, ascending or descending. Numeric
  // for disc_year; locale string compare otherwise. Blank/null always sorts to
  // the end regardless of direction, so empty cells never crowd the top.
  // ---------------------------------------------------------------------------
  function fieldByKey(key) {
    return QUERY_FIELDS.find((f) => f.key === key) || null;
  }

  function sortRows(rows, key, direction) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const field = fieldByKey(key);
    if (!field) return list;
    const dir = direction === 'desc' ? -1 : 1;
    const numeric = field.numeric;
    const decorated = list.map((row, i) => ({ row, i }));
    decorated.sort((a, b) => {
      const av = a.row[key];
      const bv = b.row[key];
      const aEmpty = av === '' || av == null;
      const bEmpty = bv === '' || bv == null;
      if (aEmpty && bEmpty) return a.i - b.i;
      if (aEmpty) return 1;  // blanks last, both directions
      if (bEmpty) return -1;
      let cmp;
      if (numeric) cmp = Number(av) - Number(bv);
      else cmp = String(av).localeCompare(String(bv));
      if (cmp !== 0) return cmp * dir;
      return a.i - b.i; // stable tie-break on original order
    });
    return decorated.map((d) => d.row);
  }

  // ---------------------------------------------------------------------------
  // The bonus hyperlink: a host's NASA Exoplanet Archive "Confirmed Planet
  // Overview" page. The archive keys the overview page on the host name.
  // ---------------------------------------------------------------------------
  const OVERVIEW_BASE = 'https://exoplanetarchive.ipac.caltech.edu/overview/';

  function overviewUrl(hostname) {
    const h = String(hostname == null ? '' : hostname).trim();
    if (!h) return '';
    return OVERVIEW_BASE + encodeURIComponent(h);
  }

  return {
    QUERY_FIELDS,
    QUERY_KEYS,
    parseCSV,
    rowsToObjects,
    parseRecords,
    normalizeRecord,
    normalizeRecords,
    toYear,
    buildDataset,
    fieldOptions,
    selectedValues,
    hasSelection,
    matchesRow,
    search,
    sortRows,
    fieldByKey,
    overviewUrl,
    OVERVIEW_BASE,
  };
});
