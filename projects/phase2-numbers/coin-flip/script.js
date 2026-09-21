/*
 * script.js — the thin UI layer over coin-core.js. It reads the inputs, calls
 * the core's `simulate`, and paints the result. It does NO simulation logic of
 * its own: every count, streak and proportion comes from the tested, DOM-free
 * core, so what you see is exactly what the suite in tests.js proves.
 */

'use strict';

(function () {
  var C = window.CoinCore;

  var nInput = document.getElementById('n');
  var seedInput = document.getElementById('seed');
  var pInput = document.getElementById('p');
  var errEl = document.getElementById('err');

  var resultCard = document.getElementById('resultCard');
  var statsCard = document.getElementById('statsCard');
  var lolnCard = document.getElementById('lolnCard');

  var headsEl = document.getElementById('heads');
  var tailsEl = document.getElementById('tails');
  var headsPctEl = document.getElementById('headsPct');
  var tailsPctEl = document.getElementById('tailsPct');
  var barEl = document.getElementById('bar');
  var summaryEl = document.getElementById('summary');

  var lHeadEl = document.getElementById('lHead');
  var lTailEl = document.getElementById('lTail');
  var runsEl = document.getElementById('runs');
  var expHeadsEl = document.getElementById('expHeads');
  var zEl = document.getElementById('z');
  var statNoteEl = document.getElementById('statNote');
  var convEl = document.getElementById('conv');

  function commas(x) { return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct(x) { return (x * 100).toFixed(2) + '%'; }

  // Parse the flip count, tolerating commas and underscores in what the user types.
  function parseCount(raw) {
    var s = String(raw).trim().replace(/[,_\s]/g, '');
    if (!/^\d+$/.test(s)) throw new Error('The number of flips must be a whole number.');
    return parseInt(s, 10);
  }

  function run() {
    errEl.textContent = '';
    var n, p, seedRaw;
    try {
      n = parseCount(nInput.value);
      var pRaw = String(pInput.value).trim();
      p = pRaw === '' ? 0.5 : Number(pRaw);
      seedRaw = String(seedInput.value).trim();
      var res = C.simulate({ n: n, seed: seedRaw === '' ? 0 : seedRaw, pHeads: p });
      paint(res);
    } catch (e) {
      resultCard.hidden = true; statsCard.hidden = true; lolnCard.hidden = true;
      errEl.textContent = e.message;
    }
  }

  function paint(r) {
    resultCard.hidden = false; statsCard.hidden = false; lolnCard.hidden = false;

    headsEl.textContent = commas(r.heads);
    tailsEl.textContent = commas(r.tails);
    headsPctEl.textContent = pct(r.heads / r.flips);
    tailsPctEl.textContent = pct(r.tails / r.flips);
    barEl.style.width = (r.heads / r.flips * 100) + '%';

    var lead = r.heads === r.tails ? 'a dead heat'
      : (r.heads > r.tails ? 'heads' : 'tails') + ' by ' + commas(Math.abs(r.heads - r.tails));
    summaryEl.innerHTML = commas(r.flips) + ' flips at P(heads) = <strong>' + r.pHeads +
      '</strong> (seed <strong>' + escapeHtml(String(r.seed)) + '</strong>) — <strong>' +
      lead + '</strong>.';

    lHeadEl.textContent = r.longestHeadRun + ' in a row';
    lTailEl.textContent = r.longestTailRun + ' in a row';
    runsEl.textContent = commas(r.runs) + ' runs (switches of face)';
    expHeadsEl.textContent = r.stats.expectedHeads.toFixed(1) + ' ± ' + r.stats.standardDeviation.toFixed(1);

    var z = r.stats.z;
    var verdict = Math.abs(z) < 2 ? 'an ordinary run'
      : (Math.abs(z) < 3 ? 'a mildly unusual run' : 'a rare run');
    zEl.textContent = (z >= 0 ? '+' : '') + z.toFixed(2) + ' SD — ' + verdict;

    statNoteEl.innerHTML = 'Theory expects the longest heads streak to be around <strong>' +
      Math.round(r.stats.expectedLongestHeadRun) + '</strong> and the longest tails streak around <strong>' +
      Math.round(r.stats.expectedLongestTailRun) + '</strong>. The z-score is how many standard ' +
      'deviations this run’s head count sits from the expected ' + r.stats.expectedHeads.toFixed(0) +
      '; anything under about 2 is unremarkable.';

    // Convergence rows: each proportion bar, with a marker at p.
    convEl.innerHTML = '';
    r.samples.forEach(function (s) {
      var li = document.createElement('li');
      var flips = document.createElement('span'); flips.className = 'flips'; flips.textContent = commas(s.flips);
      var prop = document.createElement('span'); prop.className = 'prop'; prop.textContent = s.proportion.toFixed(4);
      var track = document.createElement('span'); track.className = 'track';
      var fill = document.createElement('span'); fill.className = 'fill'; fill.style.width = (s.proportion * 100) + '%';
      var mid = document.createElement('span'); mid.className = 'mid'; mid.style.left = (r.pHeads * 100) + '%';
      track.appendChild(fill); track.appendChild(mid);
      li.appendChild(flips); li.appendChild(prop); li.appendChild(track);
      convEl.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  document.getElementById('run').addEventListener('click', run);
  document.getElementById('reseed').addEventListener('click', function () {
    seedInput.value = String(Math.floor(Math.random() * 1e9));
    run();
  });

  // Enter in any input re-runs.
  [nInput, seedInput, pInput].forEach(function (el) {
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
  });

  // Preset buttons fill the fields and run.
  Array.prototype.forEach.call(document.querySelectorAll('.preset'), function (b) {
    b.addEventListener('click', function () {
      nInput.value = b.getAttribute('data-n');
      seedInput.value = b.getAttribute('data-seed');
      pInput.value = b.getAttribute('data-p');
      run();
    });
  });

  // First paint.
  run();
})();
