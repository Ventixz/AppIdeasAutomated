/* script.js — thin UI layer over fib-core.js. All maths lives in the core. */

'use strict';

(function () {
  var core = window.FibCore;

  var tabCount = document.getElementById('tab-count');
  var tabUpto = document.getElementById('tab-upto');
  var tabSingle = document.getElementById('tab-single');
  var label = document.getElementById('label');
  var input = document.getElementById('n');
  var hint = document.getElementById('hint');
  var form = document.getElementById('form');
  var resultWrap = document.getElementById('resultWrap');
  var resultLabel = document.getElementById('resultLabel');
  var out = document.getElementById('out');
  var meta = document.getElementById('meta');
  var copyBtn = document.getElementById('copy');

  var mode = 'count'; // 'count' | 'upto' | 'single'

  // Caps chosen so the tab never locks up. 'count' and 'single' index terms;
  // 'upto' compares against a value, so it takes an arbitrarily large integer.
  var TERM_CAP = 20000;

  function setActive(active) {
    [tabCount, tabUpto, tabSingle].forEach(function (t) {
      var on = t === active;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
  }

  function setMode(next) {
    mode = next;
    if (mode === 'count') {
      setActive(tabCount);
      label.textContent = 'How many terms?';
      input.min = '1';
      if (Number(input.value) < 1) input.value = '20';
      hint.textContent = '1 – ' + TERM_CAP + ' terms. Big values take a moment.';
    } else if (mode === 'upto') {
      setActive(tabUpto);
      label.textContent = 'Largest value to include';
      input.min = '0';
      if (input.value === '' || Number(input.value) < 0) input.value = '1000';
      hint.textContent = 'Every Fibonacci number ≤ this value. Any whole number ≥ 0.';
    } else {
      setActive(tabSingle);
      label.textContent = 'Which term? (0 = the first “0”, 1 → 1, 10 → 55, …)';
      input.min = '0';
      if (input.value === '' || Number(input.value) < 0) input.value = '100';
      hint.textContent = '0-indexed. F(0)=0, F(1)=1, F(10)=55. Up to F(' + TERM_CAP + ').';
    }
    hint.classList.remove('error');
  }

  tabCount.addEventListener('click', function () { setMode('count'); });
  tabUpto.addEventListener('click', function () { setMode('upto'); });
  tabSingle.addEventListener('click', function () { setMode('single'); });

  function fail(msg) {
    hint.textContent = msg;
    hint.classList.add('error');
    resultWrap.hidden = true;
  }

  // Render a list of BigInt as "F0 = 0, F1 = 1, …" style rows, joined for copy.
  function renderList(list, startIndex) {
    var parts = [];
    var copyParts = [];
    for (var i = 0; i < list.length; i++) {
      var idx = startIndex + i;
      var val = list[i].toString();
      parts.push('<span class="idx">F' + idx + '</span> ' + val);
      copyParts.push(val);
    }
    out.innerHTML = parts.join('<span class="sep">, </span>');
    out.classList.toggle('big', list.length > 200);
    out.dataset.copy = copyParts.join(', ');
  }

  function renderCount(n) {
    var t0 = performance.now();
    var seq = core.fibSequence(n);
    var ms = Math.round(performance.now() - t0);
    resultLabel.textContent = 'The first ' + n + (n === 1 ? ' term' : ' terms') + ' of the sequence';
    renderList(seq, 0);
    meta.textContent = n + (n === 1 ? ' term' : ' terms') + ' · ' + ms + ' ms';
  }

  function renderUpTo(maxBig) {
    var t0 = performance.now();
    var seq = core.fibUpTo(maxBig);
    var ms = Math.round(performance.now() - t0);
    resultLabel.textContent = 'Fibonacci numbers ≤ ' + maxBig.toString();
    renderList(seq, 0);
    meta.textContent = seq.length + (seq.length === 1 ? ' term' : ' terms') + ' · ' + ms + ' ms';
  }

  function renderSingle(n) {
    var t0 = performance.now();
    var v = core.fibAt(n);
    var ms = Math.round(performance.now() - t0);
    resultLabel.textContent = 'F(' + n + '), the ' + ordinal(n) + ' Fibonacci number (0-indexed)';
    var s = v.toString();
    out.classList.toggle('big', s.length > 200);
    out.innerHTML = '<span class="int">' + s + '</span>';
    meta.textContent = s.length + (s.length === 1 ? ' digit' : ' digits') + ' · ' + ms + ' ms';
    out.dataset.copy = s;
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hint.classList.remove('error');

    var raw = input.value.trim();
    if (raw === '' || !/^\d+$/.test(raw)) {
      return fail('Please enter a whole, non-negative number.');
    }

    if (mode === 'count') {
      var n = Number(raw);
      if (n < 1) return fail('Enter 1 or more terms.');
      if (n > TERM_CAP) return fail('Keep it at ' + TERM_CAP + ' terms or fewer in the browser.');
      hint.textContent = '1 – ' + TERM_CAP + ' terms. Big values take a moment.';
      renderCount(n);
    } else if (mode === 'upto') {
      // Value mode: use BigInt so the bound itself can be astronomically large.
      var maxBig = BigInt(raw);
      hint.textContent = 'Every Fibonacci number ≤ this value. Any whole number ≥ 0.';
      renderUpTo(maxBig);
    } else {
      var m = Number(raw);
      if (m > TERM_CAP) return fail('Keep it at F(' + TERM_CAP + ') or lower in the browser.');
      hint.textContent = '0-indexed. F(0)=0, F(1)=1, F(10)=55. Up to F(' + TERM_CAP + ').';
      renderSingle(m);
    }
    resultWrap.hidden = false;
  });

  copyBtn.addEventListener('click', function () {
    var text = out.dataset.copy || '';
    if (!text) return;
    navigator.clipboard && navigator.clipboard.writeText(text).then(function () {
      var old = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = old; }, 1200);
    });
  });

  // Generate something on first load so the page isn't empty.
  setMode('count');
  form.dispatchEvent(new Event('submit'));
})();
