/* script.js — thin UI layer over pi-core.js. All maths lives in the core. */

'use strict';

(function () {
  var core = window.PiCore;

  var tabExpand = document.getElementById('tab-expand');
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

  var mode = 'expand'; // 'expand' | 'single'

  function setMode(next) {
    mode = next;
    var expand = mode === 'expand';
    tabExpand.classList.toggle('active', expand);
    tabSingle.classList.toggle('active', !expand);
    tabExpand.setAttribute('aria-selected', String(expand));
    tabSingle.setAttribute('aria-selected', String(!expand));
    if (expand) {
      label.textContent = 'Digits after the decimal point';
      input.min = '0';
      input.value = input.value === '' ? '100' : input.value;
      hint.textContent = '0 – 20000. Big values take a moment.';
    } else {
      label.textContent = 'Which digit? (1 = the “3”, 2 = first decimal, …)';
      input.min = '1';
      if (Number(input.value) < 1) input.value = '1';
      hint.textContent = '1-indexed. 1 gives 3, 2 gives 1, 3 gives 4, …';
    }
    hint.classList.remove('error');
  }

  tabExpand.addEventListener('click', function () { setMode('expand'); });
  tabSingle.addEventListener('click', function () { setMode('single'); });

  function fail(msg) {
    hint.textContent = msg;
    hint.classList.add('error');
    resultWrap.hidden = true;
  }

  function renderExpand(n) {
    var t0 = performance.now();
    var s = core.piString(n); // "3" or "3.xxxx"
    var ms = Math.round(performance.now() - t0);
    resultLabel.textContent = 'π to ' + n + (n === 1 ? ' digit' : ' digits') + ' after the decimal';
    if (n === 0) {
      out.innerHTML = '<span class="int">3</span>';
    } else {
      out.innerHTML =
        '<span class="int">3</span><span class="dot">.</span>' + s.slice(2);
    }
    out.classList.toggle('big', n > 400);
    meta.textContent = n + ' digits · ' + ms + ' ms';
    out.dataset.copy = s;
  }

  function renderSingle(n) {
    var t0 = performance.now();
    var d = core.nthDigit(n);
    var ms = Math.round(performance.now() - t0);
    var place = n === 1 ? 'the integer part' : 'decimal place ' + (n - 1);
    resultLabel.textContent = 'Digit #' + n + ' of π (' + place + ')';
    out.classList.remove('big');
    out.innerHTML = '<span class="int" style="font-size:2.4rem">' + d + '</span>';
    meta.textContent = ms + ' ms';
    out.dataset.copy = d;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hint.classList.remove('error');

    var raw = input.value.trim();
    if (raw === '' || !/^\d+$/.test(raw)) {
      return fail('Please enter a whole, non-negative number.');
    }
    var n = Number(raw);

    if (mode === 'expand') {
      if (n > 20000) return fail('Keep it at 20000 or fewer digits in the browser.');
      hint.textContent = '0 – 20000. Big values take a moment.';
      renderExpand(n);
    } else {
      if (n < 1) return fail('Digit positions are 1-indexed; try 1 or more.');
      if (n > 20001) return fail('Keep it at 20001 or lower in the browser.');
      hint.textContent = '1-indexed. 1 gives 3, 2 gives 1, 3 gives 4, …';
      renderSingle(n);
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

  // Compute something on first load so the page isn't empty.
  setMode('expand');
  form.dispatchEvent(new Event('submit'));
})();
