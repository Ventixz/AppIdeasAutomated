/*
 * script.js — the thin DOM layer over tax-core.js. All the arithmetic lives in
 * the core; this file only reads inputs, calls the core, and paints results. It
 * never does tax maths of its own (no float multiply), so what you see on screen
 * is exactly what the tested core computes.
 */

'use strict';

(function () {
  var T = window.TaxCore;

  /* Illustrative example rates (basis points). Deliberately labelled as
   * examples: they are the kind of numbers you meet, not a live rate table. */
  var RATE_PRESETS = [
    { label: 'No tax', bps: 0n },
    { label: 'Reduced (5%)', bps: 500n },
    { label: 'US example (8.25%)', bps: 825n },
    { label: 'GST (10%)', bps: 1000n },
    { label: 'VAT (20%)', bps: 2000n }
  ];

  /* Illustrative progressive schedules. Thresholds and taxable income are in
   * cents. These are simplified teaching schedules, not any real jurisdiction. */
  var SCHEDULES = {
    'flat15': {
      name: 'Flat 15%',
      brackets: [{ upTo: null, bps: 1500n }]
    },
    'simple3': {
      name: 'Simple 3-band (0 / 10 / 20%)',
      brackets: [
        { upTo: 1000000n, bps: 0n },     // $0–$10,000: 0%
        { upTo: 4000000n, bps: 1000n },  // $10,000–$40,000: 10%
        { upTo: null,     bps: 2000n }   // above $40,000: 20%
      ]
    },
    'progressive5': {
      name: 'Progressive 5-band',
      brackets: [
        { upTo: 1100000n, bps: 0n },     // $0–$11,000: 0%
        { upTo: 4500000n, bps: 1200n },  // to $45,000: 12%
        { upTo: 9500000n, bps: 2200n },  // to $95,000: 22%
        { upTo: 18000000n, bps: 3200n }, // to $180,000: 32%
        { upTo: null,      bps: 3700n }  // above $180,000: 37%
      ]
    }
  };

  function $(id) { return document.getElementById(id); }
  function money(cents) { return '<span class="cur">$</span>' + T.formatMoney(cents); }

  /* ---- mode + direction state --------------------------------------------- */
  var mode = 'sales';
  var direction = 'add';

  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab'); if (!b) return;
    mode = b.dataset.mode;
    Array.prototype.forEach.call($('tabs').children, function (t) {
      t.classList.toggle('active', t === b);
    });
    $('mode-sales').classList.toggle('hidden', mode !== 'sales');
    $('mode-income').classList.toggle('hidden', mode !== 'income');
  });

  $('direction').addEventListener('click', function (e) {
    var b = e.target.closest('.dir'); if (!b) return;
    direction = b.dataset.dir;
    Array.prototype.forEach.call($('direction').children, function (t) {
      t.classList.toggle('active', t === b);
    });
    $('amountLabel').textContent = direction === 'add'
      ? 'Price (before tax)' : 'Total (tax included)';
    renderSales();
  });

  /* ---- sales tax ---------------------------------------------------------- */
  RATE_PRESETS.forEach(function (p) {
    var li = document.createElement('li');
    li.innerHTML = p.label + '<span class="r">' + T.formatPercent(p.bps) + '%</span>';
    li.addEventListener('click', function () {
      $('rate').value = T.formatPercent(p.bps);
      renderSales();
    });
    $('ratePresets').appendChild(li);
  });

  function renderSales() {
    var out = $('salesResults');
    var err = $('salesErr');
    err.textContent = '';
    var amountStr = $('amount').value.trim();
    var rateStr = $('rate').value.trim();
    if (amountStr === '' || rateStr === '') {
      out.className = 'results empty';
      out.textContent = 'Enter an amount and a tax rate.';
      return;
    }
    var cents, bps;
    try { cents = T.parseMoney(amountStr); } catch (ex) { fail(err, out, 'Amount: ' + ex.message); return; }
    try { bps = T.parseRatePercent(rateStr); } catch (ex) { fail(err, out, 'Rate: ' + ex.message); return; }

    var res = direction === 'add' ? T.addTax(cents, bps) : T.removeTax(cents, bps);
    out.className = 'results';
    var baseLabel = direction === 'add' ? 'Price (before tax)' : 'Base (before tax)';
    out.innerHTML =
      row(baseLabel, money(res.base)) +
      row('Tax @ ' + T.formatPercent(bps) + '%', money(res.tax)) +
      rowTotal(direction === 'add' ? 'Total to pay' : 'Total (as entered)', money(res.total));
  }

  function row(k, v) { return '<div class="line"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
  function rowTotal(k, v) { return '<div class="line total"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
  function fail(err, out, msg) { out.className = 'results empty'; out.textContent = ''; err.textContent = msg; }

  $('amount').addEventListener('input', renderSales);
  $('rate').addEventListener('input', renderSales);

  /* ---- income tax --------------------------------------------------------- */
  Object.keys(SCHEDULES).forEach(function (key) {
    var opt = document.createElement('option');
    opt.value = key; opt.textContent = SCHEDULES[key].name;
    $('schedule').appendChild(opt);
  });
  $('schedule').value = 'simple3';

  function renderIncome() {
    var out = $('incomeResults');
    var err = $('incomeErr');
    var table = $('bracketTable');
    err.textContent = '';
    var incomeStr = $('income').value.trim();
    if (incomeStr === '') {
      out.className = 'results empty';
      out.textContent = 'Enter a taxable income.';
      table.classList.add('hidden');
      return;
    }
    var income;
    try { income = T.parseMoney(incomeStr); }
    catch (ex) { out.className = 'results empty'; out.textContent = ''; table.classList.add('hidden'); err.textContent = 'Income: ' + ex.message; return; }

    var sched = SCHEDULES[$('schedule').value];
    var res = T.progressiveTax(income, sched.brackets);

    out.className = 'results';
    out.innerHTML =
      row('Taxable income', money(res.income)) +
      row('Total tax', money(res.tax)) +
      rowTotal('Take-home (net)', money(res.net)) +
      '<div class="rates">' +
        '<div class="pill"><div class="lbl">Marginal rate</div><div class="num">' + T.formatPercent(res.marginalBps) + '%</div></div>' +
        '<div class="pill effective"><div class="lbl">Effective rate</div><div class="num">' + T.formatPercent(res.effectiveBps) + '%</div></div>' +
      '</div>';

    // per-bracket table
    var body = $('bracketBody');
    body.innerHTML = '';
    res.perBracket.forEach(function (b, i) {
      var isTop = b.to === null;
      var band = isTop
        ? '$' + T.formatMoney(b.from) + ' +'
        : '$' + T.formatMoney(b.from) + ' – $' + T.formatMoney(b.to);
      var used = b.taxable > 0n;
      var tr = document.createElement('tr');
      tr.className = (used ? 'used' : 'unused') + (b.bps === res.marginalBps && used ? ' top' : '');
      var rateCell = (b.bps === res.marginalBps && used)
        ? '<span class="marginal">' + T.formatPercent(b.bps) + '%</span>'
        : T.formatPercent(b.bps) + '%';
      tr.innerHTML =
        '<td>' + band + '</td>' +
        '<td>' + rateCell + '</td>' +
        '<td>$' + T.formatMoney(b.taxable) + '</td>' +
        '<td>$' + T.formatMoney(b.tax) + '</td>';
      body.appendChild(tr);
    });
    table.classList.remove('hidden');
  }

  $('income').addEventListener('input', renderIncome);
  $('schedule').addEventListener('change', renderIncome);

  /* ---- initial paint ------------------------------------------------------ */
  renderSales();
  renderIncome();
})();
