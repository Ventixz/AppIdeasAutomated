/* script.js — thin UI layer over nextprime-core.js. All maths lives in the core. */

'use strict';

(function () {
  var core = window.NextPrimeCore;

  var form = document.getElementById('form');
  var input = document.getElementById('n');
  var hint = document.getElementById('hint');
  var resultWrap = document.getElementById('resultWrap');
  var resultLabel = document.getElementById('resultLabel');
  var out = document.getElementById('out');
  var meta = document.getElementById('meta');
  var context = document.getElementById('context');
  var copyBtn = document.getElementById('copy');
  var chips = document.querySelectorAll('.chip');

  function fail(msg) {
    hint.textContent = msg;
    hint.classList.add('error');
    resultWrap.hidden = true;
  }

  function run(raw) {
    hint.classList.remove('error');
    raw = raw.trim().replace(/[,_\s]/g, '');           // tolerate 1,000,000 and 1_000_000
    if (raw === '' || !/^-?\d+$/.test(raw)) {
      return fail('Please enter a whole number (digits only, an optional leading −).');
    }
    var n = BigInt(raw);

    var t0 = performance.now();
    var q = core.nextPrime(n);
    var ms = Math.round(performance.now() - t0);

    resultLabel.textContent = 'Next prime after ' + n.toString() + ':';
    out.textContent = q.toString();
    out.classList.toggle('big', q.toString().length > 26);
    out.dataset.copy = q.toString();

    // Context line: the gap from the input, and the prime just below, so the
    // answer sits in a visible interval of primes rather than floating alone.
    var gap = q - (n > 0n ? n : 0n);
    var prev = core.prevPrime(q);
    var pieces = [];
    if (n >= 2n) {
      pieces.push('gap of <span class="gap">+' + gap.toString() + '</span> from ' + n.toString());
    }
    if (prev !== null) {
      pieces.push('previous prime is ' + prev.toString()
        + ' (an interval of ' + (q - prev).toString() + ')');
    }
    context.innerHTML = pieces.join('&nbsp; · &nbsp;');

    meta.textContent = q.toString().length + ' digits · ' + ms + ' ms';
    hint.textContent = 'The smallest prime strictly greater than what you type.';
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

  // Answer the default value on load so the page isn't empty.
  run(input.value);
})();
