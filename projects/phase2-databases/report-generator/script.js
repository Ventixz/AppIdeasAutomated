'use strict';
/* script.js — the browser UI. Everything runs client-side against report-core.js. */

(function () {
  var RC = window.ReportCore;
  var db = RC.sampleDatabase();

  var els = {
    report: document.getElementById('report'),
    format: document.getElementById('format'),
    limit: document.getElementById('limit'),
    date: document.getElementById('date'),
    fieldLimit: document.getElementById('field-limit'),
    fieldDate: document.getElementById('field-date'),
    describe: document.getElementById('describe'),
    tableView: document.getElementById('table-view'),
    sourceView: document.getElementById('source-view'),
    outputTitle: document.getElementById('output-title'),
    chartWrap: document.getElementById('chart-wrap'),
    chart: document.getElementById('chart'),
    download: document.getElementById('download'),
  };

  // Populate the report dropdown.
  RC.listReports().forEach(function (r) {
    var o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.title;
    els.report.appendChild(o);
  });

  // Populate the date dropdown with the distinct order dates in the sample DB.
  var dates = Array.from(new Set(db.orders.map(function (o) { return o.date; }))).sort();
  dates.forEach(function (d) {
    var o = document.createElement('option');
    o.value = d; o.textContent = d;
    els.date.appendChild(o);
  });
  els.date.value = RC.defaultBusyDate(db);

  function currentParams() {
    return { limit: els.limit.value, date: els.date.value };
  }

  function syncParamVisibility() {
    var id = els.report.value;
    els.fieldLimit.hidden = id !== 'top-customers';
    els.fieldDate.hidden = id !== 'daily-activity';
  }

  function render() {
    syncParamVisibility();
    var id = els.report.value;
    var def = RC.REPORTS[id];
    els.describe.textContent = def ? def.describe : '';

    var model = RC.buildReport(id, db, currentParams());
    els.outputTitle.textContent = model.title + (model.subtitle ? ' — ' + model.subtitle : '');

    var fmt = els.format.value;
    if (fmt === 'table') {
      els.tableView.hidden = false;
      els.sourceView.hidden = true;
      els.tableView.innerHTML = RC.renderHTML(model, { noCaption: true }); // table fragment
    } else {
      els.tableView.hidden = true;
      els.sourceView.hidden = false;
      els.sourceView.textContent = RC.render(model, fmt);
    }

    drawChart(model);
  }

  function drawChart(model) {
    if (!model.chart) { els.chartWrap.hidden = true; els.chart.innerHTML = ''; return; }
    var labelKey = model.chart.label, valueKey = model.chart.value;
    var data = model.rows
      .filter(function (r) { return (r.level || 'detail') === 'detail'; })
      .map(function (r) {
        return { label: String(r.cells[labelKey]), value: RC.num(r.cells[valueKey]) };
      })
      .filter(function (d) { return isFinite(d.value); });

    if (!data.length) { els.chartWrap.hidden = true; return; }
    els.chartWrap.hidden = false;

    var max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var rowH = 30, gap = 8, labelW = 120, valueW = 90;
    var chartW = 640, barArea = chartW - labelW - valueW - 10;
    var h = data.length * (rowH + gap) + gap;

    var svg = ['<svg viewBox="0 0 ' + chartW + ' ' + h + '" role="img" aria-label="bar chart">'];
    data.forEach(function (d, i) {
      var y = gap + i * (rowH + gap);
      var w = Math.max(2, (d.value / max) * barArea);
      svg.push('<text class="bar-label" x="0" y="' + (y + rowH * 0.65) + '">' + esc(trunc(d.label, 16)) + '</text>');
      svg.push('<rect class="bar" x="' + labelW + '" y="' + y + '" width="' + w.toFixed(1) +
        '" height="' + rowH + '" rx="3"></rect>');
      svg.push('<text class="bar-value" x="' + (labelW + w + 6) + '" y="' + (y + rowH * 0.65) + '">' +
        esc(RC.formatValue(d.value, 'currency')) + '</text>');
    });
    svg.push('</svg>');
    els.chart.innerHTML = svg.join('');
  }

  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function doDownload() {
    var id = els.report.value;
    var model = RC.buildReport(id, db, currentParams());
    var fmt = els.format.value === 'table' ? 'html' : els.format.value;
    var ext = { html: 'html', text: 'txt', csv: 'csv', md: 'md', json: 'json' }[fmt];
    var mime = { html: 'text/html', text: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json' }[fmt];
    var content = RC.render(model, fmt);
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = id + '.' + ext;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  els.report.addEventListener('change', render);
  els.format.addEventListener('change', render);
  els.limit.addEventListener('input', render);
  els.date.addEventListener('change', render);
  els.download.addEventListener('click', doDownload);

  render();
})();
