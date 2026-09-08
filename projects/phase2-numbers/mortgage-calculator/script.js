/* script.js — thin UI over mortgage-core.js. All arithmetic lives in the core. */

'use strict';

(function () {
  var core = window.MortgageCore;

  var form = document.getElementById('form');
  var hint = document.getElementById('hint');
  var resultWrap = document.getElementById('resultWrap');
  var paymentEl = document.getElementById('payment');
  var payoffEl = document.getElementById('payoff');
  var rows = document.getElementById('rows');
  var schedRows = document.getElementById('schedRows');
  var schedSummary = document.getElementById('schedSummary');
  var chips = document.querySelectorAll('.chip');

  var fields = ['principal', 'annualRate', 'years', 'paymentsPerYear', 'extraPayment'];
  var el = {};
  fields.forEach(function (id) { el[id] = document.getElementById(id); });

  var EXAMPLES = {
    classic: { principal: '100000', annualRate: '6', years: '30', paymentsPerYear: '12', extraPayment: '' },
    starter: { principal: '300000', annualRate: '6.5', years: '30', paymentsPerYear: '12', extraPayment: '' },
    extra:   { principal: '300000', annualRate: '6.5', years: '30', paymentsPerYear: '12', extraPayment: '300' },
    zero:    { principal: '12000', annualRate: '0', years: '1', paymentsPerYear: '12', extraPayment: '' }
  };

  var PERIOD_NAME = { 12: 'months', 26: 'payments', 4: 'quarters', 1: 'years' };

  function fail(msg) {
    hint.textContent = msg;
    hint.classList.add('error');
    resultWrap.hidden = true;
  }

  function money(f) { return '$' + f.toFixed(2); }

  function row(label, value, strong) {
    var tr = document.createElement('tr');
    if (strong) tr.className = 'strong';
    var td1 = document.createElement('td'); td1.textContent = label;
    var td2 = document.createElement('td'); td2.className = 'num'; td2.textContent = value;
    tr.appendChild(td1); tr.appendChild(td2);
    return tr;
  }

  function run() {
    hint.classList.remove('error');
    hint.textContent = '';

    var input = {
      principal: el.principal.value,
      annualRate: el.annualRate.value.trim() || '0',
      years: el.years.value,
      paymentsPerYear: parseInt(el.paymentsPerYear.value, 10),
      extraPayment: el.extraPayment.value.trim() || '0'
    };

    var r;
    try { r = core.amortize(input); }
    catch (e) { return fail(e.message); }

    paymentEl.textContent = money(r.scheduledPayment)
      + (r.extraPayment.isPos() ? ' + ' + money(r.extraPayment) : '');

    var unit = PERIOD_NAME[Number(r.paymentsPerYear)] || 'payments';
    var n = Number(r.nActual);
    var payoffText = n + ' ' + unit;
    if (Number(r.paymentsPerYear) === 12) {
      var yrs = Math.floor(n / 12), mos = n % 12;
      payoffText = (yrs ? yrs + ' yr ' : '') + (mos ? mos + ' mo' : '') || n + ' months';
      payoffText = payoffText.trim();
    }
    payoffEl.textContent = payoffText;

    rows.innerHTML = '';
    rows.appendChild(row('Loan amount', money(r.principal)));
    rows.appendChild(row('Scheduled payment', money(r.scheduledPayment)));
    if (r.extraPayment.isPos()) {
      rows.appendChild(row('Extra principal each payment', money(r.extraPayment)));
      var saved = r.nScheduled - r.nActual;
      if (saved > 0n) rows.appendChild(row('Payments saved vs. schedule', saved.toString()));
    }
    rows.appendChild(row('Number of payments', r.nActual.toString()
      + (r.nActual !== r.nScheduled ? ' (of ' + r.nScheduled.toString() + ' scheduled)' : '')));
    rows.appendChild(row('Final payment (absorbs rounding)', money(r.schedule[r.schedule.length - 1].payment)));
    rows.appendChild(row('Total interest', money(r.totalInterest)));
    rows.appendChild(row('Total paid', money(r.totalPaid), true));

    // Amortization schedule.
    schedRows.innerHTML = '';
    schedSummary.textContent = '(' + r.schedule.length + ' rows)';
    var frag = document.createDocumentFragment();
    r.schedule.forEach(function (p) {
      var tr = document.createElement('tr');
      [p.period.toString(), money(p.payment), money(p.interest), money(p.principal), money(p.balance)]
        .forEach(function (v) {
          var td = document.createElement('td');
          td.textContent = v;
          tr.appendChild(td);
        });
      frag.appendChild(tr);
    });
    schedRows.appendChild(frag);

    resultWrap.hidden = false;
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); run(); });

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var ex = EXAMPLES[chip.dataset.ex];
      if (!ex) return;
      fields.forEach(function (id) { if (ex[id] !== undefined) el[id].value = ex[id]; });
      run();
    });
  });

  // Calculate the default loan on load so the page isn't empty.
  run();
})();
