/* script.js — thin browser glue over csv-core.js. All the real work (parsing,
 * type detection, sorting, serializing) lives in the engine; this file only
 * wires the DOM to it. */
(function () {
  'use strict';
  var C = window.CSVCore;

  var $ = function (id) { return document.getElementById(id); };
  var input = $('input'),
      delimiterSel = $('delimiter'),
      hasHeader = $('has-header'),
      parseStatus = $('parse-status'),
      keysBox = $('keys'),
      resultSection = $('result-section'),
      output = $('output'),
      table = $('table');

  var currentHeader = [];

  function delimiter() { return delimiterSel.value; }

  // Re-parse the textarea so the sort-key dropdowns always reflect the columns
  // that are actually present.
  function refreshColumns() {
    var text = input.value;
    if (!text.trim()) {
      currentHeader = [];
      parseStatus.textContent = '';
      parseStatus.className = 'status';
      renderKeys();
      return;
    }
    try {
      var table = C.parseTable(text, { delimiter: delimiter(), hasHeader: hasHeader.checked });
      currentHeader = table.header;
      parseStatus.textContent = table.rows.length + ' row' + (table.rows.length === 1 ? '' : 's') +
        ', ' + currentHeader.length + ' column' + (currentHeader.length === 1 ? '' : 's') + ' parsed.';
      parseStatus.className = 'status ok';
    } catch (e) {
      currentHeader = [];
      parseStatus.textContent = 'Could not parse: ' + e.message;
      parseStatus.className = 'status err';
    }
    renderKeys();
  }

  // --- sort keys UI -------------------------------------------------------
  function keyRow(selectedCol) {
    var row = document.createElement('div');
    row.className = 'keyrow';

    var idx = document.createElement('span');
    idx.className = 'idx';
    row.appendChild(idx);

    var colSel = document.createElement('select');
    colSel.className = 'col';
    currentHeader.forEach(function (h) {
      var o = document.createElement('option');
      o.value = h; o.textContent = h;
      if (h === selectedCol) o.selected = true;
      colSel.appendChild(o);
    });
    row.appendChild(colSel);

    var typeSel = document.createElement('select');
    typeSel.className = 'type';
    [['auto', 'auto-detect'], ['string', 'text'], ['number', 'number'], ['date', 'date']]
      .forEach(function (pair) {
        var o = document.createElement('option');
        o.value = pair[0]; o.textContent = pair[1];
        typeSel.appendChild(o);
      });
    row.appendChild(typeSel);

    var dirSel = document.createElement('select');
    dirSel.className = 'dir';
    [['asc', 'ascending ↑'], ['desc', 'descending ↓']].forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[0]; o.textContent = pair[1];
      dirSel.appendChild(o);
    });
    row.appendChild(dirSel);

    var rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×'; rm.title = 'Remove key';
    rm.onclick = function () { row.remove(); renumber(); };
    row.appendChild(rm);

    return row;
  }

  function renumber() {
    var rows = keysBox.querySelectorAll('.keyrow');
    rows.forEach(function (r, i) {
      r.querySelector('.idx').textContent = (i + 1) + '.';
    });
  }

  function renderKeys() {
    // Preserve existing selections where columns still exist.
    var existing = [].map.call(keysBox.querySelectorAll('.keyrow'), function (r) {
      return {
        column: r.querySelector('.col').value,
        type: r.querySelector('.type').value,
        direction: r.querySelector('.dir').value
      };
    });
    keysBox.innerHTML = '';
    if (currentHeader.length === 0) {
      var note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Load some data to choose columns.';
      keysBox.appendChild(note);
      return;
    }
    var toRender = existing.length ? existing : [{ column: currentHeader[0], type: 'auto', direction: 'asc' }];
    toRender.forEach(function (k) {
      if (currentHeader.indexOf(k.column) === -1) k.column = currentHeader[0];
      var row = keyRow(k.column);
      row.querySelector('.type').value = k.type || 'auto';
      row.querySelector('.dir').value = k.direction || 'asc';
      keysBox.appendChild(row);
    });
    renumber();
  }

  function collectKeys() {
    return [].map.call(keysBox.querySelectorAll('.keyrow'), function (r) {
      var type = r.querySelector('.type').value;
      return {
        column: r.querySelector('.col').value,
        direction: r.querySelector('.dir').value,
        type: type === 'auto' ? undefined : type
      };
    });
  }

  // --- sort + render ------------------------------------------------------
  function doSort() {
    if (currentHeader.length === 0) { refreshColumns(); return; }
    var keys = collectKeys();
    var result;
    try {
      result = C.sortCSVText(input.value, keys, {
        delimiter: delimiter(), hasHeader: hasHeader.checked
      });
    } catch (e) {
      parseStatus.textContent = 'Sort failed: ' + e.message;
      parseStatus.className = 'status err';
      return;
    }
    output.value = result.text;
    renderTable(result.header, result.rows, result.types);
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderTable(header, rows, types) {
    var typeByCol = {};
    (types || []).forEach(function (t) { typeByCol[t.column] = t.type; });
    // Also detect display type for columns that weren't sort keys.
    header.forEach(function (h) {
      if (!typeByCol[h]) typeByCol[h] = C.detectType(rows.map(function (r) { return r[h]; }));
    });

    var thead = '<thead><tr>' + header.map(function (h) {
      return '<th>' + esc(h) + '<span class="th-type">' + typeByCol[h] + '</span></th>';
    }).join('') + '</tr></thead>';

    var MAX = 200; // keep the DOM sane on huge files
    var shown = rows.slice(0, MAX);
    var body = '<tbody>' + shown.map(function (row) {
      return '<tr>' + header.map(function (h) {
        var cls = typeByCol[h] === 'number' ? ' class="num"' : '';
        return '<td' + cls + '>' + esc(row[h]) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';

    table.innerHTML = thead + body;
    if (rows.length > MAX) {
      parseStatus.textContent = 'Sorted ' + rows.length + ' rows (showing first ' + MAX + '). Full result in the download.';
      parseStatus.className = 'status ok';
    } else {
      parseStatus.textContent = 'Sorted ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + '.';
      parseStatus.className = 'status ok';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- file + download ----------------------------------------------------
  function download() {
    var blob = new Blob([output.value], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sorted.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // --- wiring -------------------------------------------------------------
  $('file').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { input.value = reader.result; refreshColumns(); };
    reader.readAsText(f);
  });

  $('load-sample').addEventListener('click', function () {
    fetch('sample-data.csv')
      .then(function (r) { return r.text(); })
      .then(function (t) { input.value = t; delimiterSel.value = ','; hasHeader.checked = true; refreshColumns(); })
      .catch(function () {
        // If fetch is blocked (file://), fall back to an inline copy.
        input.value = INLINE_SAMPLE; refreshColumns();
      });
  });

  input.addEventListener('input', refreshColumns);
  delimiterSel.addEventListener('change', refreshColumns);
  hasHeader.addEventListener('change', refreshColumns);
  $('add-key').addEventListener('click', function () {
    if (currentHeader.length === 0) return;
    keysBox.appendChild(keyRow(currentHeader[0]));
    renumber();
  });
  $('sort').addEventListener('click', doSort);
  $('download').addEventListener('click', download);
  $('copy').addEventListener('click', function () {
    output.select();
    try { document.execCommand('copy'); } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText(output.value).catch(function () {});
  });

  var INLINE_SAMPLE = [
    'name,department,salary,hired,city',
    '"Smith, John",Engineering,98000,2021-03-15,Oslo',
    'Anna Lindqvist,Engineering,105000,2019-11-02,Oslo',
    'Bob Chen,Sales,72000,2022-07-20,Rome',
    '"O\'Hara, Mary",Sales,81000,2020-01-30,Rome',
    'Carlos Ruiz,Engineering,98000,2023-05-11,Berlin'
  ].join('\n');

  renderKeys();
})();
