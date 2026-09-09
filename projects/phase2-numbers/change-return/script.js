/*
 * script.js — a thin form-and-table over change-core.js. All arithmetic and
 * validation lives in the core; this file only reads inputs and paints output.
 */

'use strict';

(function () {
  var form = document.getElementById('form');
  var costEl = document.getElementById('cost');
  var tenderedEl = document.getElementById('tendered');
  var errorEl = document.getElementById('error');
  var resultEl = document.getElementById('result');
  var changeAmountEl = document.getElementById('change-amount');
  var tbody = document.querySelector('#breakdown tbody');
  var totalCountEl = document.getElementById('total-count');
  var totalValueEl = document.getElementById('total-value');
  var noteEl = document.getElementById('note');

  function selectedDenoms() {
    var v = form.querySelector('input[name="set"]:checked').value;
    return v === 'coins' ? window.US_COINS : window.US_FULL;
  }

  function pieceName(denom, count) {
    return count === 1 ? denom.singular : denom.plural;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    resultEl.hidden = true;
  }

  function render(res) {
    errorEl.hidden = true;
    changeAmountEl.textContent = res.changeStr;

    tbody.innerHTML = '';
    if (res.greedy.rows.length === 0) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" class="none">No change — exact payment.</td>';
      tbody.appendChild(tr);
    } else {
      res.greedy.rows.forEach(function (row) {
        var tr = document.createElement('tr');
        var name = document.createElement('td');
        name.textContent = pieceName(row.denom, row.count);
        var cnt = document.createElement('td');
        cnt.textContent = row.count;
        var val = document.createElement('td');
        val.textContent = window.formatCents(row.count * row.denom.cents);
        tr.appendChild(name); tr.appendChild(cnt); tr.appendChild(val);
        tbody.appendChild(tr);
      });
    }
    totalCountEl.textContent = res.greedy.count;
    totalValueEl.textContent = res.changeStr;

    // Honesty about the algorithm: greedy is minimal here because U.S.
    // currency is canonical. Say so — and if a system ever weren't, say that.
    if (res.greedy.count === 0) {
      noteEl.textContent = '';
    } else if (res.greedyIsOptimal) {
      noteEl.textContent = 'This is the fewest possible pieces — verified against a minimum-coin search.';
    } else {
      noteEl.textContent = 'Note: for this denomination set the greedy answer is NOT minimal; ' +
        res.optimal.count + ' pieces would suffice.';
    }

    resultEl.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    try {
      var res = window.makeChange(costEl.value, tenderedEl.value, selectedDenoms());
      render(res);
    } catch (err) {
      showError(err.message);
    }
  });

  // Re-run when the denomination set changes, if we already have valid inputs.
  form.querySelectorAll('input[name="set"]').forEach(function (r) {
    r.addEventListener('change', function () {
      if (!resultEl.hidden || !errorEl.hidden) {
        try {
          render(window.makeChange(costEl.value, tenderedEl.value, selectedDenoms()));
        } catch (err) { showError(err.message); }
      }
    });
  });
})();
