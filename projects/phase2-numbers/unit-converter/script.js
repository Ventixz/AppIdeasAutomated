/*
 * script.js — a thin UI over converter-core.js. All conversion logic lives in
 * the core; this only wires up the DOM: it fills the category/unit menus,
 * re-converts on every change, swaps units, and exposes an editable table of
 * offline currency rates.
 */
'use strict';

(function () {
  var core = window.ConverterCore;
  var CATS = core.CATEGORIES;

  var elCat = document.getElementById('category');
  var elVal = document.getElementById('value');
  var elFrom = document.getElementById('from');
  var elTo = document.getElementById('to');
  var elResult = document.getElementById('result');
  var elTag = document.getElementById('tag');
  var elNote = document.getElementById('note');
  var elError = document.getElementById('error');
  var elSwap = document.getElementById('swap');
  var elRates = document.getElementById('rates');
  var elRateGrid = document.getElementById('rate-grid');
  var elRatesNote = document.getElementById('rates-note');
  var elExamples = document.getElementById('examples');

  // Fill the category menu.
  Object.keys(CATS).forEach(function (key) {
    var o = document.createElement('option');
    o.value = key; o.textContent = CATS[key].label;
    elCat.appendChild(o);
  });

  function fillUnits(catKey) {
    var cat = CATS[catKey];
    [elFrom, elTo].forEach(function (sel) {
      sel.innerHTML = '';
      Object.keys(cat.units).forEach(function (u) {
        var o = document.createElement('option');
        o.value = u; o.textContent = cat.units[u].label;
        sel.appendChild(o);
      });
    });
    // Default to two different units where possible.
    var keys = Object.keys(cat.units);
    elFrom.value = keys[0];
    elTo.value = keys[1] || keys[0];
  }

  function setTag(cls, text) {
    elTag.hidden = false;
    elTag.className = 'tag ' + cls;
    elTag.textContent = text;
  }

  function convertNow() {
    var catKey = elCat.value;
    elError.hidden = true;
    try {
      var r = core.convert(catKey, elFrom.value, elTo.value, elVal.value);
      elResult.textContent = r.display;
      if (r.exactValue === false) {
        setTag('approx', 'approximate');
      } else if (r.exactDisplay) {
        setTag('exact', 'exact');
      } else {
        setTag('rounded', 'rounded for display');
      }
      elNote.textContent = r.note || (r.exactDisplay
        ? 'Exact — the value terminates as a finite decimal.'
        : 'The exact value repeats or is very long, so it is rounded here.');
    } catch (e) {
      elResult.textContent = '—';
      elTag.hidden = true;
      elNote.textContent = '';
      elError.hidden = false;
      elError.textContent = e.message;
    }
  }

  function buildRatesEditor() {
    var cat = CATS.currency;
    elRatesNote.textContent =
      'Snapshot as of ' + core.RATE_DATE + '. These are not live — edit any ' +
      'cell to use your own rate. USD is the base (1.000000).';
    elRateGrid.innerHTML = '';
    Object.keys(cat.units).forEach(function (u) {
      var cell = document.createElement('div');
      cell.className = 'rate-cell';
      var label = document.createElement('label');
      label.textContent = cat.units[u].label;
      var input = document.createElement('input');
      input.value = core.formatRational(cat.units[u].factor).display;
      input.disabled = (u === 'USD');
      input.setAttribute('inputmode', 'decimal');
      input.addEventListener('input', function () {
        try { core.setRate(u, input.value); input.style.borderColor = ''; convertNow(); }
        catch (e) { input.style.borderColor = 'var(--danger)'; }
      });
      cell.appendChild(label);
      cell.appendChild(input);
      elRateGrid.appendChild(cell);
    });
  }

  // A few illustrative one-tap examples per category.
  var EXAMPLES = [
    { cat: 'temperature', from: 'C', to: 'F', v: '100', text: '100 °C → °F' },
    { cat: 'temperature', from: 'C', to: 'F', v: '-40', text: '-40 °C → °F' },
    { cat: 'length', from: 'mi', to: 'km', v: '26.2', text: '26.2 mi → km' },
    { cat: 'length', from: 'in', to: 'cm', v: '1', text: '1 in → cm' },
    { cat: 'mass', from: 'lb', to: 'kg', v: '150', text: '150 lb → kg' },
    { cat: 'volume', from: 'gal', to: 'L', v: '1', text: '1 gal → L' },
    { cat: 'speed', from: 'km/h', to: 'm/s', v: '3.6', text: '3.6 km/h → m/s' },
    { cat: 'digital', from: 'GiB', to: 'GB', v: '1', text: '1 GiB → GB' },
    { cat: 'currency', from: 'EUR', to: 'USD', v: '100', text: '100 EUR → USD' }
  ];

  EXAMPLES.forEach(function (ex) {
    var li = document.createElement('li');
    li.textContent = ex.text;
    li.addEventListener('click', function () {
      elCat.value = ex.cat;
      onCategoryChange();
      elFrom.value = ex.from;
      elTo.value = ex.to;
      elVal.value = ex.v;
      convertNow();
    });
    elExamples.appendChild(li);
  });

  function onCategoryChange() {
    fillUnits(elCat.value);
    elRates.hidden = (elCat.value !== 'currency');
    convertNow();
  }

  elCat.addEventListener('change', onCategoryChange);
  elFrom.addEventListener('change', convertNow);
  elTo.addEventListener('change', convertNow);
  elVal.addEventListener('input', convertNow);
  elSwap.addEventListener('click', function () {
    var f = elFrom.value; elFrom.value = elTo.value; elTo.value = f;
    convertNow();
  });

  // Boot.
  buildRatesEditor();
  onCategoryChange();
})();
