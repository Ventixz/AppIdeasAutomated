/*
 * script.js — a thin form over converter-core.js. All parsing, the BigInt
 * arithmetic and the exact/rounded decision live in the core; this file only
 * reads inputs, calls the core, and paints the output.
 */

'use strict';

(function () {
  var core = window.ConverterCore;

  var form = document.getElementById('form');
  var valueEl = document.getElementById('value');
  var fracBitsEl = document.getElementById('fracbits');
  var precisionField = document.getElementById('precision-field');
  var inputLabel = document.getElementById('input-label');
  var errorEl = document.getElementById('error');
  var resultEl = document.getElementById('result');
  var fromLabel = document.getElementById('from-label');
  var fromValue = document.getElementById('from-value');
  var toValue = document.getElementById('to-value');
  var noteEl = document.getElementById('note');
  var roundtripEl = document.getElementById('roundtrip');

  function direction() {
    return form.querySelector('input[name="dir"]:checked').value;
  }

  function syncLabels() {
    var d2b = direction() === 'd2b';
    inputLabel.textContent = d2b ? 'Decimal number' : 'Binary number';
    valueEl.placeholder = d2b ? '13.25' : '1101.01';
    precisionField.hidden = !d2b;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    resultEl.hidden = true;
  }

  function convert() {
    errorEl.hidden = true;
    var input = valueEl.value.trim();
    if (input === '') { resultEl.hidden = true; return; }

    try {
      if (direction() === 'd2b') {
        var bits = Math.max(0, Math.min(4096, Number(fracBitsEl.value) || 0));
        var r = core.roundTripDec(input, bits);
        fromLabel.textContent = 'decimal';
        fromValue.textContent = input;
        toValue.textContent = r.binary;
        noteEl.textContent = r.exact
          ? 'Exact — the binary fraction terminates.'
          : 'Rounded to ' + bits + ' fraction bits — this decimal fraction has no ' +
            'finite binary form (like 0.1).';
        roundtripEl.textContent = r.exact
          ? 'Round-trip back to decimal: ' + r.backToDec + ' ✓'
          : 'That binary, read back as decimal, is ' + r.backToDec + '.';
      } else {
        var dec = core.binToDec(input);
        fromLabel.textContent = 'binary';
        fromValue.textContent = input;
        toValue.textContent = dec;
        noteEl.textContent = 'Exact — every binary fraction terminates in decimal.';
        roundtripEl.textContent = 'Round-trip back to binary: ' +
          core.decToBin(dec, 4096).binary + ' ✓';
      }
      resultEl.hidden = false;
    } catch (err) {
      showError(err.message);
    }
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); convert(); });
  form.querySelectorAll('input[name="dir"]').forEach(function (r) {
    r.addEventListener('change', function () { syncLabels(); convert(); });
  });
  valueEl.addEventListener('input', convert);
  fracBitsEl.addEventListener('input', convert);

  syncLabels();
})();
