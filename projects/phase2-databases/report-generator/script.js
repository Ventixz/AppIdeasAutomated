'use strict';
/* script.js — wires the controls to report-core.js and renders live previews. */

(function () {
  var R = window.ReportCore;
  var DATA = R.SAMPLE_DATA;
  var COLUMNS = R.SAMPLE_COLUMNS.map(function (c) { return Object.assign({}, c); });
  // Columns you can group by — the dimensions in the data (not all are shown as
  // display columns; e.g. you group by Region without listing it as a column).
  var GROUP_KEYS = ['region', 'rep', 'category', 'product'];
  function labelOf(key) {
    var c = colByKey(key);
    return c ? c.label : R.keyLabel(key);
  }

  // ---- state ----------------------------------------------------------------
  var state = {
    title: 'Sales Report',
    // groupBy is an ordered list of column keys; shown/aggregates tracked per column
    group: ['region'],
    shown: {},        // key -> bool
    aggs: {},         // key -> 'sum'|'avg'|... | ''
    sortKey: 'date',
    sortDir: 'asc',
  };
  COLUMNS.forEach(function (c) { state.shown[c.key] = true; state.aggs[c.key] = c.agg || ''; });

  // ---- DOM refs -------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var groupList = $('groupList');
  var colBody = $('colBody');
  var sortKey = $('sortKey');

  // ---- build the group-by list (checkbox + drag to reorder) ------------------
  function groupOrderedKeys() {
    // keys currently in group order first, then the rest (so toggling on appends)
    var rest = GROUP_KEYS.filter(function (k) { return state.group.indexOf(k) === -1; });
    return state.group.concat(rest);
  }

  function renderGroupList() {
    groupList.innerHTML = '';
    groupOrderedKeys().forEach(function (key) {
      var on = state.group.indexOf(key) !== -1;
      var chip = document.createElement('div');
      chip.className = 'chip' + (on ? ' active' : '');
      chip.draggable = on;
      chip.dataset.key = key;
      chip.innerHTML =
        '<span class="grip">' + (on ? '⠿' : '') + '</span>' +
        '<label class="name"><input type="checkbox"' + (on ? ' checked' : '') + '> ' +
        R.escapeHtml(labelOf(key)) + '</label>';
      chip.querySelector('input').addEventListener('change', function (e) {
        if (e.target.checked) { if (state.group.indexOf(key) === -1) state.group.push(key); }
        else { state.group = state.group.filter(function (k) { return k !== key; }); }
        renderAll();
      });
      addDrag(chip);
      groupList.appendChild(chip);
    });
  }

  var dragKey = null;
  function addDrag(chip) {
    chip.addEventListener('dragstart', function () { dragKey = chip.dataset.key; chip.classList.add('dragging'); });
    chip.addEventListener('dragend', function () { chip.classList.remove('dragging'); dragKey = null; });
    chip.addEventListener('dragover', function (e) {
      e.preventDefault();
      var target = chip.dataset.key;
      if (!dragKey || dragKey === target) return;
      if (state.group.indexOf(target) === -1) return; // only reorder within active
      var from = state.group.indexOf(dragKey);
      var to = state.group.indexOf(target);
      if (from === -1) return;
      state.group.splice(from, 1);
      state.group.splice(to, 0, dragKey);
      renderGroupList();
      schedule();
    });
  }

  function colByKey(k) { for (var i = 0; i < COLUMNS.length; i++) if (COLUMNS[i].key === k) return COLUMNS[i]; return null; }

  // ---- column config table --------------------------------------------------
  function renderColBody() {
    colBody.innerHTML = '';
    COLUMNS.forEach(function (col) {
      var tr = document.createElement('tr');
      var numeric = R.isNumeric(col.type);
      var opts = ['', 'sum', 'avg', 'min', 'max', 'count'].map(function (o) {
        return '<option value="' + o + '"' + (state.aggs[col.key] === o ? ' selected' : '') + '>' +
          (o === '' ? '—' : o) + '</option>';
      }).join('');
      tr.innerHTML =
        '<td><input type="checkbox" class="show"' + (state.shown[col.key] ? ' checked' : '') + '></td>' +
        '<td>' + R.escapeHtml(col.label) + '</td>' +
        '<td>' + col.type + '</td>' +
        '<td>' + (numeric ? '<select class="agg">' + opts + '</select>' : '<span style="color:var(--muted)">—</span>') + '</td>';
      tr.querySelector('.show').addEventListener('change', function (e) { state.shown[col.key] = e.target.checked; renderAll(); });
      var aggSel = tr.querySelector('.agg');
      if (aggSel) aggSel.addEventListener('change', function (e) { state.aggs[col.key] = e.target.value; schedule(); });
      colBody.appendChild(tr);
    });
  }

  function renderSortKey() {
    sortKey.innerHTML = COLUMNS.map(function (c) {
      return '<option value="' + c.key + '"' + (state.sortKey === c.key ? ' selected' : '') + '>' + R.escapeHtml(c.label) + '</option>';
    }).join('');
  }

  // ---- build the spec + report ---------------------------------------------
  function currentSpec() {
    var cols = COLUMNS.filter(function (c) { return state.shown[c.key]; }).map(function (c) {
      var o = { key: c.key, label: c.label, type: c.type };
      if (state.aggs[c.key]) o.agg = state.aggs[c.key];
      return o;
    });
    return {
      title: state.title || 'Report',
      generatedAt: new Date().toISOString().slice(0, 10),
      columns: cols,
      groupBy: state.group.slice(),
      sortBy: [{ key: state.sortKey, dir: state.sortDir }],
    };
  }

  function currentReport() { return R.buildReport(DATA, currentSpec()); }

  // ---- render all previews --------------------------------------------------
  var activeTab = 'report';

  function renderPreviews() {
    var report = currentReport();
    $('tab-report').innerHTML = R.renderHtml(report, { fragment: true });
    $('tab-text').textContent = R.renderText(report);
    $('tab-csv').textContent = R.renderCsv(report);
    renderPdfInspector(report);
  }

  function renderPdfInspector(report) {
    var bytes = R.renderPdf(report);
    var info = R.parsePdf(bytes); // grade our own bytes with the independent reader
    var el = $('tab-pdf');
    el.innerHTML =
      '<div class="pdfmeta">' +
        cell('Version', 'PDF ' + info.version) +
        cell('Bytes', bytes.length.toLocaleString()) +
        cell('Pages', info.pageCount) +
        cell('Objects', info.objCount) +
        cell('xref offset', info.xrefOffset) +
        cell('/Length exact', info.streamLenOk ? 'yes' : 'NO', info.streamLenOk) +
      '</div>' +
      '<p class="note">Every object below was located by walking <code>startxref → xref → N&nbsp;0&nbsp;obj</code>' +
      ' with an independent parser. If one byte offset were wrong, this validation would throw and a real reader' +
      ' would call the file damaged.</p>' +
      '<p class="note">The download button produces these exact bytes. poppler (<code>pdfinfo</code>/<code>pdftotext</code>),' +
      ' a completely separate implementation, reads them too.</p>';
  }

  function cell(k, v, ok) {
    return '<div class="cell"><div class="k">' + k + '</div><div class="v' + (ok ? ' ok' : '') + '">' + v + '</div></div>';
  }

  // debounce heavy re-render
  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(renderPreviews, 60); }
  function renderAll() { renderGroupList(); renderPreviews(); }

  // ---- downloads ------------------------------------------------------------
  function download(filename, data, mime) {
    var blob = new Blob([data], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }
  function slug() { return (state.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'; }

  $('dlPdf').addEventListener('click', function () {
    download(slug() + '.pdf', R.renderPdf(currentReport()), 'application/pdf');
  });
  $('dlCsv').addEventListener('click', function () {
    download(slug() + '.csv', R.renderCsv(currentReport()), 'text/csv');
  });
  $('dlHtml').addEventListener('click', function () {
    download(slug() + '.html', R.renderHtml(currentReport()), 'text/html');
  });

  // ---- tabs -----------------------------------------------------------------
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () {
      activeTab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.classList.toggle('active', x === b); });
      ['report', 'text', 'csv', 'pdf'].forEach(function (t) {
        $('tab-' + t).classList.toggle('active', t === activeTab);
      });
    });
  });

  // ---- inputs ---------------------------------------------------------------
  $('title').addEventListener('input', function (e) { state.title = e.target.value; schedule(); });
  $('sortKey').addEventListener('change', function (e) { state.sortKey = e.target.value; schedule(); });
  $('sortDir').addEventListener('change', function (e) { state.sortDir = e.target.value; schedule(); });

  // ---- go -------------------------------------------------------------------
  renderColBody();
  renderSortKey();
  renderAll();
})();
