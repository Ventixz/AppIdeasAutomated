/*
 * script.js — the thin UI layer over names-core.js. It reads the inputs, calls
 * the core, and paints the result. It does NO naming logic of its own: every
 * word comes from the tested, DOM-free core, so what you see is exactly what the
 * suite in tests.js proves.
 */

'use strict';

(function () {
  var N = window.NamesCore;

  var nInput = document.getElementById('n');
  var errEl = document.getElementById('err');
  var outEl = document.getElementById('out');
  var extraEl = document.getElementById('extra');

  var mCardinal = document.getElementById('mCardinal');
  var mOrdinal = document.getElementById('mOrdinal');
  var mPhrase = document.getElementById('mPhrase');
  var mMoney = document.getElementById('mMoney');
  var modeNote = document.getElementById('modeNote');

  // Group a decimal string with thousands commas for the "digits" readout.
  function group(str) {
    var s = String(str), neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var dot = s.indexOf('.');
    var intp = dot < 0 ? s : s.slice(0, dot);
    var frac = dot < 0 ? '' : s.slice(dot);
    intp = intp.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + intp + frac;
  }

  function setMode(el, value) {
    if (value === null) { el.textContent = '—'; el.classList.add('dim'); }
    else { el.textContent = value; el.classList.remove('dim'); }
  }

  function run() {
    var raw = nInput.value.trim();
    errEl.textContent = '';
    if (raw === '') {
      outEl.textContent = ''; extraEl.textContent = '';
      setMode(mCardinal, null); setMode(mOrdinal, null);
      setMode(mPhrase, null); setMode(mMoney, null);
      modeNote.textContent = '';
      return;
    }

    // The primary readout uses numberPhrase, which accepts sign + decimals.
    var phrase;
    try {
      phrase = N.numberPhrase(raw);
    } catch (e) {
      outEl.textContent = ''; extraEl.textContent = '';
      setMode(mCardinal, null); setMode(mOrdinal, null);
      setMode(mPhrase, null); setMode(mMoney, null);
      modeNote.textContent = '';
      errEl.textContent = e.message;
      return;
    }

    outEl.textContent = capitalize(phrase);

    // digit count / grouping helper line
    var digitsOnly = raw.replace(/[^\d]/g, '');
    extraEl.innerHTML = group(raw) +
      ' &mdash; <strong>' + digitsOnly.length + '</strong> digit' +
      (digitsOnly.length === 1 ? '' : 's') + '.';

    setMode(mPhrase, capitalize(phrase));

    // Cardinal / ordinal only apply to whole numbers.
    var isInteger = /^[+-]?\d+$/.test(raw.replace(/[,_\s]/g, ''));
    if (isInteger) {
      try { setMode(mCardinal, capitalize(N.cardinal(raw))); }
      catch (e2) { setMode(mCardinal, null); }
      try { setMode(mOrdinal, capitalize(N.ordinal(raw))); }
      catch (e3) { setMode(mOrdinal, null); }
      modeNote.textContent = '';
    } else {
      setMode(mCardinal, null);
      setMode(mOrdinal, null);
      modeNote.textContent = 'Cardinal and ordinal apply to whole numbers; the decimal is read digit by digit above.';
    }

    // Money always works (rounds to cents).
    try { setMode(mMoney, capitalize(N.currency(raw))); }
    catch (e4) { setMode(mMoney, null); }
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ---- the reverse: words -> number --------------------------------------- */
  var wordsInput = document.getElementById('words');
  var wordsErr = document.getElementById('wordsErr');
  var wordsOut = document.getElementById('wordsOut');

  function runWords() {
    var raw = wordsInput.value.trim();
    wordsErr.textContent = '';
    if (raw === '') { wordsOut.textContent = ''; return; }
    try {
      var v = N.parse(raw);
      wordsOut.textContent = group(v.toString());
    } catch (e) {
      wordsOut.textContent = '';
      wordsErr.textContent = e.message;
    }
  }

  /* ---- wiring ------------------------------------------------------------- */
  nInput.addEventListener('input', run);
  wordsInput.addEventListener('input', runWords);

  document.querySelector('.presets').addEventListener('click', function (e) {
    var b = e.target.closest('.preset');
    if (!b) return;
    if (b.getAttribute('data-big')) {
      var exp = parseInt(b.getAttribute('data-big'), 10);
      var v = 1n; for (var i = 0; i < exp; i++) v *= 10n;
      nInput.value = v.toString();
    } else {
      nInput.value = b.getAttribute('data-n');
    }
    run();
  });

  // first paint
  run();
  runWords();
})();
