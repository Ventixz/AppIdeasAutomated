/*
 * script.js — the thin UI layer over factorial-core.js. It reads the input,
 * calls the core, and paints the result. It does NO factorial arithmetic of its
 * own: every number on screen comes from the tested, DOM-free core, so what you
 * see is exactly what the suite in tests.js proves.
 */

'use strict';

(function () {
  var F = window.FactorialCore;

  /* ---- tab switching ------------------------------------------------------ */
  var tabs = document.getElementById('tabs');
  tabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    var mode = btn.getAttribute('data-mode');
    [].forEach.call(tabs.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t === btn);
    });
    document.getElementById('mode-compute').classList.toggle('hidden', mode !== 'compute');
    document.getElementById('mode-inverse').classList.toggle('hidden', mode !== 'inverse');
  });

  /* ---- helpers ------------------------------------------------------------ */
  // Group a decimal string in threes for readability: "3628800" -> "3,628,800".
  function group(str) { return str.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function pill(cls, label, num) {
    return '<div class="pill ' + cls + '"><div class="lbl">' + label +
           '</div><div class="num">' + num + '</div></div>';
  }

  /* ---- COMPUTE ------------------------------------------------------------ */
  var nInput = document.getElementById('n');
  var facts = document.getElementById('facts');
  var valueWrap = document.getElementById('valueWrap');
  var valueEl = document.getElementById('value');
  var methodsEl = document.getElementById('methods');
  var computeErr = document.getElementById('computeErr');
  var copyBtn = document.getElementById('copyBtn');

  // Cap the printed value: above this the number has too many digits to render
  // usefully in a box, but the *facts* (digits, zeros) are still cheap and shown.
  var PRINT_LIMIT = 12000;   // ~beyond this the full number is many pages long

  function clearCompute() {
    facts.innerHTML = '';
    valueWrap.classList.add('hidden');
    methodsEl.classList.add('hidden');
    methodsEl.textContent = '';
    computeErr.textContent = '';
  }

  function compute() {
    var raw = nInput.value.trim();
    clearCompute();
    if (raw === '') return;

    var n;
    try { n = F.parseCount(raw); }
    catch (e) { computeErr.textContent = e.message; return; }

    // Even the O(n) log-sum walk hangs the tab for absurd n, so cap the input.
    var MAX_N = 1000000;
    if (n > MAX_N) {
      computeErr.textContent = 'keep n ≤ ' + group(String(MAX_N)) +
        ' here — above that even the digit count takes too long in a browser tab';
      return;
    }

    // Guard the genuinely huge: the log-sum facts stay cheap forever, but the
    // BigInt itself gets slow/enormous, so above a ceiling we compute only the
    // facts and say so, rather than freezing the tab.
    var FACT_ONLY = 200000;
    var digits, zeros;
    try {
      digits = F.digitCount(n);
      zeros = F.trailingZeros(n);
    } catch (e) { computeErr.textContent = e.message; return; }

    facts.innerHTML =
      pill('digits', 'Digits', group(String(digits))) +
      pill('zeros', 'Trailing zeros', group(String(zeros)));

    if (n > FACT_ONLY) {
      methodsEl.classList.remove('hidden');
      methodsEl.innerHTML = 'The digit count and trailing zeros above are computed ' +
        'without building the number (a sum of logs, and Legendre’s formula). ' +
        'The full <strong>' + group(String(digits)) + '-digit</strong> value of ' +
        group(String(n)) + '! is too large to render here.';
      return;
    }

    // Time the fast method so the "product tree" claim is visible, not just asserted.
    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var value = F.factorialFast(n);
    var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var str = value.toString();

    if (n <= PRINT_LIMIT) {
      valueEl.textContent = str;
      valueWrap.classList.remove('hidden');
      valueEl.dataset.full = str;
    }

    methodsEl.classList.remove('hidden');
    var ms = (t1 - t0);
    var timeStr = ms < 1 ? '<1 ms' : (ms < 10 ? ms.toFixed(1) + ' ms' : Math.round(ms) + ' ms');
    methodsEl.innerHTML = 'Computed by the <strong>product-tree</strong> method in ' +
      timeStr + '. The loop and the recursion give the identical value; recursion ' +
      'is capped at n = ' + group(String(F.RECURSION_LIMIT)) +
      ' so it can’t overflow the call stack.' +
      (n > PRINT_LIMIT ? ' (The ' + group(String(str.length)) +
        '-digit value is too long to show, but the facts above are exact.)' : '');
  }

  nInput.addEventListener('input', compute);

  copyBtn.addEventListener('click', function () {
    var full = valueEl.dataset.full || valueEl.textContent;
    if (!full) return;
    var done = function () {
      copyBtn.textContent = 'copied';
      copyBtn.classList.add('done');
      setTimeout(function () { copyBtn.textContent = 'copy'; copyBtn.classList.remove('done'); }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(done, function () {});
    } else {
      var r = document.createRange(); r.selectNode(valueEl);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      try { document.execCommand('copy'); done(); } catch (e) {}
      sel.removeAllRanges();
    }
  });

  // Preset chips.
  var presets = document.getElementById('presets');
  [0, 5, 10, 20, 50, 100, 1000].forEach(function (v) {
    var li = document.createElement('li');
    li.textContent = v + '!';
    li.addEventListener('click', function () { nInput.value = v; compute(); nInput.focus(); });
    presets.appendChild(li);
  });

  /* ---- INVERSE ------------------------------------------------------------ */
  var invInput = document.getElementById('inv');
  var inverseResults = document.getElementById('inverseResults');
  var inverseErr = document.getElementById('inverseErr');

  function inverse() {
    var raw = invInput.value.trim();
    inverseResults.innerHTML = '';
    inverseErr.textContent = '';
    if (raw === '') return;

    if (!/^[\d,\s_]+$/.test(raw)) {
      inverseErr.textContent = 'enter a whole non-negative number';
      return;
    }
    var n = F.inverseFactorial(raw);
    var clean = raw.replace(/[,\s_]/g, '');
    if (n === null) {
      inverseResults.innerHTML =
        '<div class="line total"><span class="k">' + group(clean) +
        '</span><span class="v no">not a factorial</span></div>';
    } else {
      inverseResults.innerHTML =
        '<div class="line"><span class="k">value</span><span class="v">' + group(clean) + '</span></div>' +
        '<div class="line total"><span class="k">it is a factorial</span><span class="v">' +
        n + '!</span></div>';
    }
  }
  invInput.addEventListener('input', inverse);

  // Start with an inviting example.
  nInput.value = '100';
  compute();
})();
