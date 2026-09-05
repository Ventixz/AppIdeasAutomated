/* script.js — thin UI layer over factor-core.js. All maths lives in the core. */

'use strict';

(function () {
  var core = window.FactorCore;

  var form = document.getElementById('form');
  var input = document.getElementById('n');
  var hint = document.getElementById('hint');
  var resultWrap = document.getElementById('resultWrap');
  var resultLabel = document.getElementById('resultLabel');
  var out = document.getElementById('out');
  var meta = document.getElementById('meta');
  var expanded = document.getElementById('expanded');
  var copyBtn = document.getElementById('copy');
  var chips = document.querySelectorAll('.chip');

  function fail(msg) {
    hint.textContent = msg;
    hint.classList.add('error');
    resultWrap.hidden = true;
  }

  // Render [[p, e], ...] as coloured "2² · 3 · 5" with superscript exponents.
  function renderPairs(pairs, n) {
    if (!pairs.length) {
      // Only n === 1 reaches here.
      out.classList.remove('big');
      out.innerHTML = '<span class="prime-flag">1 has no prime factors</span>';
      out.dataset.copy = '1';
      expanded.textContent = '';
      return;
    }
    var parts = [];
    var totalFactors = 0n;
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i][0];
      var e = pairs[i][1];
      totalFactors += e;
      var piece = '<span class="prime">' + p.toString() + '</span>';
      if (e !== 1n) piece += '<span class="exp">' + e.toString() + '</span>';
      parts.push(piece);
    }
    out.innerHTML = parts.join('<span class="op">·</span>');
    out.classList.toggle('big', n.toString().length > 24);

    // Flag primes explicitly — a single factor with exponent 1 means n is prime.
    if (pairs.length === 1 && pairs[0][1] === 1n) {
      out.innerHTML += ' <span class="prime-flag">(prime)</span>';
    }

    out.dataset.copy = core.formatFactorization(pairs);

    // A plain-text expansion line, e.g. "= 2 × 2 × 3" (with count), useful when
    // you want the flat list of factors rather than exponent form.
    var flat = [];
    for (var j = 0; j < pairs.length; j++) {
      for (var k = 0n; k < pairs[j][1]; k++) flat.push(pairs[j][0].toString());
    }
    if (flat.length > 1) {
      expanded.textContent = '= ' + flat.join(' × ')
        + '   (' + totalFactors.toString() + ' prime factors with multiplicity)';
    } else {
      expanded.textContent = '';
    }
  }

  function run(raw) {
    hint.classList.remove('error');
    raw = raw.trim().replace(/[,_\s]/g, ''); // tolerate 1,000,000 and 1_000_000
    if (raw === '' || !/^\d+$/.test(raw)) {
      return fail('Please enter a whole, non-negative number (digits only).');
    }
    var n = BigInt(raw);
    if (n < 1n) return fail('Enter an integer of 1 or more.');

    var t0 = performance.now();
    var pairs;
    try {
      pairs = core.factorize(n);
    } catch (err) {
      return fail(String(err.message || err));
    }
    var ms = Math.round(performance.now() - t0);

    resultLabel.textContent = n.toString() + ' =';
    renderPairs(pairs, n);

    var distinct = pairs.length;
    meta.textContent = distinct + (distinct === 1 ? ' distinct prime' : ' distinct primes')
      + ' · ' + ms + ' ms';
    hint.textContent = 'Any integer ≥ 1. Big semiprimes are the slow case.';
    resultWrap.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    run(input.value);
  });

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      input.value = chip.dataset.n;
      run(chip.dataset.n);
    });
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

  // Factor the default value on load so the page isn't empty.
  run(input.value);
})();
