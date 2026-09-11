/*
 * script.js — a thin UI over calculator-core.js. All tokenising, parsing and
 * the exact BigInt arithmetic live in the core; this file only reads the input,
 * calls evaluate(), paints the result, and wires up the quick-key pad.
 */

'use strict';

(function () {
  var core = window.CalculatorCore;

  var form = document.getElementById('form');
  var exprEl = document.getElementById('expr');
  var errorEl = document.getElementById('error');
  var resultEl = document.getElementById('result');
  var valueEl = document.getElementById('value');
  var tagEl = document.getElementById('tag');
  var noteEl = document.getElementById('note');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    resultEl.hidden = true;
  }

  function evaluate() {
    var input = exprEl.value.trim();
    if (input === '') { errorEl.hidden = true; resultEl.hidden = true; return; }
    try {
      var r = core.evaluate(input);
      errorEl.hidden = true;
      valueEl.textContent = r.display;

      if (!r.exact) {
        tagEl.textContent = 'approximate';
        tagEl.className = 'tag approx';
        noteEl.textContent = 'Uses floating point (a scientific function or an ' +
          'irrational constant), so this is a rounded approximation.';
      } else if (r.terminates) {
        tagEl.textContent = 'exact';
        tagEl.className = 'tag exact';
        noteEl.textContent = r.denominator === '1'
          ? 'Exact integer.'
          : 'Exact — this fraction terminates in decimal.';
      } else {
        tagEl.textContent = 'exact';
        tagEl.className = 'tag exact';
        noteEl.textContent = 'Exact value is the fraction ' + r.fraction +
          ' — it never terminates in decimal (≈ ' + r.rounded + ').';
      }
      resultEl.hidden = false;
    } catch (err) {
      showError(err.message);
    }
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); evaluate(); });
  exprEl.addEventListener('input', evaluate);

  /* ---- Quick-key pad ---- */
  var KEYS = [
    '7', '8', '9', '/', '(', ')',
    '4', '5', '6', '*', '^', '%',
    '1', '2', '3', '-', 'pi', 'e',
    '0', '.', '=', '+', 'sqrt(', 'del',
  ];
  var FUNCS = { 'sqrt(': 1, 'pi': 1, 'e': 1 };

  var keysEl = document.getElementById('keys');
  KEYS.forEach(function (k) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = k === 'del' ? '⌫' : (k === '=' ? '=' : k);
    if (FUNCS[k]) b.className = 'fn';
    if (k === '=' || k === 'del') b.className = 'act';
    b.addEventListener('click', function () {
      if (k === '=') { evaluate(); exprEl.focus(); return; }
      if (k === 'del') { exprEl.value = exprEl.value.slice(0, -1); evaluate(); exprEl.focus(); return; }
      exprEl.value += k;
      evaluate();
      exprEl.focus();
    });
    keysEl.appendChild(b);
  });

  /* ---- Example chips ---- */
  var EXAMPLES = [
    '0.1 + 0.2', '1/3 * 3', '2^100', '(1+2)^10',
    'sqrt(2)', '2 * pi', '10 % 3', '355/113', '-2^2',
  ];
  var examplesEl = document.getElementById('examples');
  EXAMPLES.forEach(function (ex) {
    var li = document.createElement('li');
    li.textContent = ex;
    li.addEventListener('click', function () { exprEl.value = ex; evaluate(); exprEl.focus(); });
    examplesEl.appendChild(li);
  });
})();
