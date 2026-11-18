/*
 * csv-core.js — the engine behind the Sort Excel/CSV File Utility.
 *
 * Source 2 (karan/Projects) · Files category.
 * Task: "Takes a CSV file ... sorts the rows, and writes a new, sorted file."
 *
 * No dependencies. Runs in Node (require) and the browser (window.CSVCore).
 * The three hard jobs live here so they can be tested without a browser:
 *   1. parseCSV     — RFC-4180-aware parsing (quotes, embedded commas/newlines)
 *   2. sortRows     — type-aware, stable, multi-key sorting
 *   3. serializeCSV — lossless round-trip (re-quotes only what must be quoted)
 */
(function (root) {
  'use strict';

  /* ----------------------------------------------------------------------
   * 1. PARSING
   *
   * A CSV field is almost never "split on commas". The RFC 4180 rules that
   * actually bite:
   *   - a field wrapped in "double quotes" may contain commas,
   *   - ...and newlines (so a single record can span several text lines),
   *   - ...and literal double quotes, written as "" (two in a row).
   * A naive split corrupts every one of those. This is a character-level
   * state machine instead: it is either inside a quoted field or not, and
   * that decides what a comma / newline / quote means.
   * -------------------------------------------------------------------- */
  function parseCSV(text, options) {
    options = options || {};
    var delimiter = options.delimiter || ',';
    if (delimiter.length !== 1) {
      throw new Error('delimiter must be a single character');
    }

    // A leading BOM (Excel loves to add one) is not data — strip it.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    var rows = [];
    var field = '';
    var record = [];
    var inQuotes = false;
    var sawAnyChar = false; // so a trailing newline doesn't invent a blank row
    var i = 0;
    var n = text.length;

    function endField() {
      record.push(field);
      field = '';
    }
    function endRecord() {
      endField();
      rows.push(record);
      record = [];
      sawAnyChar = false; // a bare record separator alone must not flush a row
    }

    while (i < n) {
      var ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { // an escaped quote: "" -> "
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false; // closing quote
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }

      // --- not inside quotes ---
      if (ch === '"') {
        inQuotes = true;
        sawAnyChar = true;
        i++;
        continue;
      }
      if (ch === delimiter) {
        sawAnyChar = true;
        endField();
        i++;
        continue;
      }
      if (ch === '\r') { // CRLF or lone CR both end the record
        endRecord();
        if (text[i + 1] === '\n') i++;
        i++;
        continue;
      }
      if (ch === '\n') {
        endRecord();
        i++;
        continue;
      }
      field += ch;
      sawAnyChar = true;
      i++;
    }

    // Flush whatever is buffered. If the file ends right after a record
    // separator, `sawAnyChar` is false and there is nothing real to flush —
    // this is what stops a trailing newline from producing a phantom row.
    if (field !== '' || record.length > 0 || sawAnyChar) {
      endRecord();
    }

    return rows;
  }

  /* Parse into a header + array-of-objects shape, which is what the sorter and
   * the UI want to work with. Ragged rows are normalized to the header width so
   * downstream code never reads `undefined`. */
  function parseTable(text, options) {
    options = options || {};
    var rows = parseCSV(text, options);
    if (rows.length === 0) return { header: [], rows: [] };

    var hasHeader = options.hasHeader !== false; // default true
    var header, dataRows;

    if (hasHeader) {
      header = rows[0];
      dataRows = rows.slice(1);
    } else {
      // Synthesize column names: Column 1, Column 2, ...
      var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      header = [];
      for (var c = 0; c < width; c++) header.push('Column ' + (c + 1));
      dataRows = rows;
    }

    var objects = dataRows.map(function (r) {
      var obj = {};
      for (var j = 0; j < header.length; j++) {
        obj[header[j]] = j < r.length ? r[j] : '';
      }
      return obj;
    });

    return { header: header, rows: objects, hasHeader: hasHeader };
  }

  /* ----------------------------------------------------------------------
   * 2. TYPE DETECTION + COMPARISON
   *
   * "Sort the file" is meaningless until you decide what a value *is*. The
   * string "10" sorts BEFORE "9" alphabetically, which is wrong for a column
   * of quantities and right for a column of SKUs. So a column's type is
   * inferred from its values, and a value is compared as that type.
   * -------------------------------------------------------------------- */

  // A number, but not things that merely contain digits. Allows a leading
  // sign, thousands separators, a decimal part, and scientific notation.
  var NUMBER_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][-+]?\d+)?$/;

  function parseNumber(s) {
    if (typeof s !== 'string') return NaN;
    var t = s.trim();
    if (t === '' || !NUMBER_RE.test(t)) return NaN;
    return Number(t.replace(/,/g, ''));
  }

  // ISO-ish dates (YYYY-MM-DD, optional time) and common US/EU slashed dates.
  // Deliberately conservative: a loose Date.parse treats "1" or "May" as dates.
  var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
  var SLASH_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

  function parseDate(s) {
    if (typeof s !== 'string') return NaN;
    var t = s.trim();
    if (ISO_DATE_RE.test(t)) {
      var ms = Date.parse(t.replace(' ', 'T'));
      return isNaN(ms) ? NaN : ms;
    }
    if (SLASH_DATE_RE.test(t)) {
      var parts = t.split('/');
      // Interpret as M/D/Y (US), the dominant convention in these files.
      var d = new Date(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
      return isNaN(d.getTime()) ? NaN : d.getTime();
    }
    return NaN;
  }

  // Look at every non-empty value in a column. The column is `number` only if
  // *all* of them parse as numbers; `date` only if all parse as dates; else
  // `string`. One stray label collapses the whole column to string — which is
  // the safe choice, because a mixed column sorted numerically is nonsense.
  function detectType(values) {
    var sawValue = false;
    var allNumber = true;
    var allDate = true;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v == null || String(v).trim() === '') continue; // blanks don't vote
      sawValue = true;
      if (isNaN(parseNumber(v))) allNumber = false;
      if (isNaN(parseDate(v))) allDate = false;
      if (!allNumber && !allDate) break;
    }
    if (!sawValue) return 'string';
    if (allNumber) return 'number';
    if (allDate) return 'date';
    return 'string';
  }

  /* Build a comparator for a single sort key. Blanks always sort to the end
   * regardless of direction (a missing value is not "smaller than zero"), and
   * ties return 0 so the caller's stable sort can fall through to the next key. */
  function makeComparator(type, direction) {
    var dir = direction === 'desc' ? -1 : 1;

    function rank(a, b) {
      var ea = a == null || String(a).trim() === '';
      var eb = b == null || String(b).trim() === '';
      if (ea && eb) return 0;
      if (ea) return 1;  // empty a goes after
      if (eb) return -1; // empty b goes after
      return null;       // both present: let the typed comparison decide
    }

    if (type === 'number') {
      return function (a, b) {
        var r = rank(a, b); if (r !== null) return r;
        var na = parseNumber(a), nb = parseNumber(b);
        // A value that looked numeric for detection but not here (shouldn't
        // happen) degrades to string rather than producing NaN noise.
        if (isNaN(na) || isNaN(nb)) return dir * String(a).localeCompare(String(b));
        return na < nb ? -dir : na > nb ? dir : 0;
      };
    }
    if (type === 'date') {
      return function (a, b) {
        var r = rank(a, b); if (r !== null) return r;
        var da = parseDate(a), db = parseDate(b);
        if (isNaN(da) || isNaN(db)) return dir * String(a).localeCompare(String(b));
        return da < db ? -dir : da > db ? dir : 0;
      };
    }
    // string: locale-aware, case-insensitive, with numeric runs handled so
    // "item2" < "item10". This is the sort a human expects from text.
    var collator = (typeof Intl !== 'undefined' && Intl.Collator)
      ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
      : null;
    return function (a, b) {
      var r = rank(a, b); if (r !== null) return r;
      var sa = String(a), sb = String(b);
      var c = collator ? collator.compare(sa, sb) : sa.localeCompare(sb);
      return dir * c;
    };
  }

  /* ----------------------------------------------------------------------
   * 3. SORTING
   *
   * Multi-key, type-aware, and STABLE. Stability matters more than it looks:
   * when you sort by "city" and two rows share a city, they must keep their
   * original order — that is what lets a user sort by name, then by city, and
   * get "by city, then name within each city" for free. Not every JS engine's
   * Array.sort was historically stable, so we decorate with the original index
   * and use it as the final tie-breaker ourselves.
   * -------------------------------------------------------------------- */
  function sortRows(rows, keys, header) {
    if (!keys || keys.length === 0) return rows.slice();

    // Infer each key's type once, up front, from the actual column data —
    // unless the caller pinned a type explicitly.
    var comparators = keys.map(function (key) {
      var type = key.type;
      if (!type) {
        var col = rows.map(function (r) { return r[key.column]; });
        type = detectType(col);
      }
      return { column: key.column, cmp: makeComparator(type, key.direction), type: type };
    });

    var decorated = rows.map(function (row, idx) { return { row: row, idx: idx }; });

    decorated.sort(function (x, y) {
      for (var k = 0; k < comparators.length; k++) {
        var c = comparators[k];
        var res = c.cmp(x.row[c.column], y.row[c.column]);
        if (res !== 0) return res;
      }
      return x.idx - y.idx; // stable: original order breaks remaining ties
    });

    var out = decorated.map(function (d) { return d.row; });
    out._types = comparators.map(function (c) { return { column: c.column, type: c.type }; });
    return out;
  }

  /* ----------------------------------------------------------------------
   * 4. SERIALIZING
   *
   * The inverse of parse. A field MUST be quoted when it contains the
   * delimiter, a double quote, or a newline — and quoting means wrapping in
   * quotes and doubling any interior quote. Quote nothing else, so a file that
   * didn't need quotes round-trips to something a human still recognizes.
   * -------------------------------------------------------------------- */
  function quoteField(value, delimiter) {
    var s = value == null ? '' : String(value);
    if (s.indexOf('"') !== -1 ||
        s.indexOf(delimiter) !== -1 ||
        s.indexOf('\n') !== -1 ||
        s.indexOf('\r') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function serializeCSV(header, rows, options) {
    options = options || {};
    var delimiter = options.delimiter || ',';
    var newline = options.newline || '\n';
    var includeHeader = options.includeHeader !== false && header && header.length > 0;

    var lines = [];
    if (includeHeader) {
      lines.push(header.map(function (h) { return quoteField(h, delimiter); }).join(delimiter));
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var cells;
      if (Array.isArray(row)) {
        cells = row;
      } else {
        // object row: emit in header order so columns stay aligned
        cells = header.map(function (h) { return row[h]; });
      }
      lines.push(cells.map(function (c) { return quoteField(c, delimiter); }).join(delimiter));
    }
    return lines.join(newline);
  }

  /* Convenience: the whole pipeline in one call. Text in, sorted text out. */
  function sortCSVText(text, keys, options) {
    options = options || {};
    var table = parseTable(text, options);
    var sorted = sortRows(table.rows, keys, table.header);
    var out = serializeCSV(table.header, sorted, {
      delimiter: options.delimiter || ',',
      newline: options.newline || '\n',
      includeHeader: table.hasHeader !== false
    });
    return { text: out, header: table.header, rows: sorted, types: sorted._types || [] };
  }

  var api = {
    parseCSV: parseCSV,
    parseTable: parseTable,
    detectType: detectType,
    parseNumber: parseNumber,
    parseDate: parseDate,
    makeComparator: makeComparator,
    sortRows: sortRows,
    quoteField: quoteField,
    serializeCSV: serializeCSV,
    sortCSVText: sortCSVText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CSVCore = api;
  }
})(typeof window !== 'undefined' ? window : this);
