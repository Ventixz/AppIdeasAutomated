/*
 * script.js — the thin UI layer over happy-core.js. It reads the inputs, calls
 * the core, and paints the result. It does NO happy-number logic of its own:
 * every verdict, trajectory, cycle and colour comes from the tested, DOM-free
 * core, so what you see is exactly what the suite in tests.js proves.
 */

'use strict';

(function () {
  var H = window.HappyCore;

  var nInput = document.getElementById('n');
  var baseSel = document.getElementById('base');
  var powerSel = document.getElementById('power');
  var errEl = document.getElementById('err');
  var verdictEl = document.getElementById('verdict');
  var chainWrap = document.getElementById('chainWrap');
  var chainEl = document.getElementById('chain');
  var cycleNote = document.getElementById('cycleNote');
  var plot = document.getElementById('plot');

  function group(str) { return String(str).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // Truncate a very long term for display, keeping it identifiable.
  function shortTerm(t) {
    var s = String(t);
    if (s.length <= 24) return s;
    return s.slice(0, 12) + '…' + s.slice(-8) + ' (' + s.length + ' digits)';
  }

  function opts() {
    return { base: parseInt(baseSel.value, 10), power: parseInt(powerSel.value, 10) };
  }

  /* ---- classify + render the main verdict --------------------------------- */
  function run() {
    errEl.textContent = '';
    var raw = nInput.value.trim();
    if (raw === '') { verdictEl.hidden = true; chainWrap.hidden = true; return; }

    var res;
    try {
      res = H.classify(raw, opts());
    } catch (e) {
      verdictEl.hidden = true;
      chainWrap.hidden = true;
      errEl.textContent = e.message;
      return;
    }

    var o = opts();
    verdictEl.hidden = false;
    chainWrap.hidden = false;

    // verdict badge + metadata
    var badgeClass = res.happy ? 'happy' : 'sad';
    var badgeText = res.happy ? 'HAPPY' : 'UNHAPPY';
    var meta = '';
    if (res.happy) {
      meta = 'reaches <strong>1</strong> in <strong>' + res.height +
             '</strong> step' + (res.height === 1 ? '' : 's');
    } else {
      meta = 'falls into a cycle of length <strong>' + res.cycle.length + '</strong>, never reaching 1';
    }

    // happy-prime badge only meaningful for the standard base-10/power-2 game
    var extra = '';
    if (o.base === 10 && o.power === 2 && res.happy) {
      var isPrimeInput = false;
      try { isPrimeInput = /^[0-9]+$/.test(res.input) && H.isPrime(parseInt(res.input, 10)); } catch (e2) {}
      if (isPrimeInput) extra = '<span class="tag">happy prime</span>';
    }

    verdictEl.innerHTML =
      '<span class="badge ' + badgeClass + '">' + badgeText + '</span>' +
      '<span class="meta">' + meta + extra + '</span>';

    renderChain(res, o);
    drawPlot(res, o);
  }

  /* ---- the trajectory as a chain of chips --------------------------------- */
  function renderChain(res, o) {
    var traj = res.trajectory;
    var cycleStart = -1;
    if (!res.happy) {
      // find where the repeated (closing) value first appeared
      var last = traj[traj.length - 1];
      cycleStart = traj.indexOf(last);
    }

    var html = '';
    for (var i = 0; i < traj.length; i++) {
      if (i > 0) html += '<span class="arrow">→</span>';
      var cls = 'step';
      if (i === 0) cls += ' start';
      if (res.happy && i === traj.length - 1) cls += ' one';
      if (!res.happy && cycleStart >= 0 && i >= cycleStart) cls += ' cycle';
      html += '<span class="' + cls + '">' + shortTerm(traj[i]) + '</span>';
    }
    chainEl.innerHTML = html;

    if (!res.happy) {
      cycleNote.hidden = false;
      cycleNote.innerHTML = 'Cycle: <strong>' +
        res.cycle.map(function (x) { return group(x); }).join(' → ') +
        ' → …</strong>';
    } else {
      cycleNote.hidden = true;
    }
  }

  /* ---- a plot of the sequence value at each step -------------------------- */
  function drawPlot(res, o) {
    var ctx = plot.getContext('2d');
    var W = plot.width, Hh = plot.height;
    ctx.clearRect(0, 0, W, Hh);

    // Numeric values only (a prestepped giant first term is not plottable).
    var vals = res.trajectory.filter(function (x) { return typeof x === 'number'; });
    if (vals.length < 2) {
      ctx.fillStyle = '#9aa3c0';
      ctx.font = '14px sans-serif';
      ctx.fillText('Sequence too short to plot.', 16, 24);
      return;
    }

    var pad = 34;
    var maxV = Math.max.apply(null, vals);
    var minV = 0;
    var n = vals.length;

    function px(i) { return pad + (W - 2 * pad) * (i / (n - 1)); }
    function py(v) { return Hh - pad - (Hh - 2 * pad) * ((v - minV) / (maxV - minV || 1)); }

    // gridlines
    ctx.strokeStyle = '#2a3050';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, py(0)); ctx.lineTo(W - pad, py(0));
    ctx.stroke();

    // the "1" line for happy targets
    if (res.happy) {
      ctx.strokeStyle = 'rgba(142,230,200,.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad, py(1)); ctx.lineTo(W - pad, py(1));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // the polyline
    ctx.strokeStyle = res.happy ? '#8ee6c8' : '#f5a06e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var x = px(i), y = py(vals[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // points
    for (var j = 0; j < n; j++) {
      ctx.fillStyle = (res.happy && vals[j] === 1) ? '#8ee6c8' : (res.happy ? '#6ea8fe' : '#f5a06e');
      ctx.beginPath();
      ctx.arc(px(j), py(vals[j]), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // axis labels
    ctx.fillStyle = '#9aa3c0';
    ctx.font = '11px sans-serif';
    ctx.fillText('step 0', pad - 6, Hh - pad + 16);
    ctx.fillText('step ' + (n - 1), W - pad - 34, Hh - pad + 16);
    ctx.fillText(String(maxV), 4, py(maxV) + 4);
  }

  /* ---- the explorer grid -------------------------------------------------- */
  var limitEl = document.getElementById('limit');
  var gridEl = document.getElementById('grid');
  var explorerStat = document.getElementById('explorerStat');

  function renderExplorer() {
    var limit = Math.max(10, Math.min(5000, parseInt(limitEl.value, 10) || 200));
    var o = opts();
    var happy;
    try { happy = H.memoClassifier(o.base, o.power); }
    catch (e) { return; }

    var html = '', happyCount = 0, primeHappy = 0;
    for (var n = 1; n <= limit; n++) {
      var h = happy(n);
      var cls = 'cell';
      if (h) {
        happyCount++;
        var p = (o.base === 10 && o.power === 2) && H.isPrime(n);
        if (p) { primeHappy++; cls += ' hp'; } else { cls += ' h'; }
      }
      html += '<div class="' + cls + '" data-n="' + n + '" title="' + n + '">' + n + '</div>';
    }
    gridEl.innerHTML = html;

    var pct = (100 * happyCount / limit).toFixed(1);
    explorerStat.innerHTML = '<strong>' + happyCount + '</strong> of ' + limit +
      ' numbers are happy (' + pct + '%)' +
      ((o.base === 10 && o.power === 2)
        ? ', of which <strong>' + primeHappy + '</strong> are happy primes' : '') + '.';
  }

  /* ---- nth happy lookup --------------------------------------------------- */
  var nthEl = document.getElementById('nth');
  var nthOut = document.getElementById('nthOut');
  function renderNth() {
    var k = parseInt(nthEl.value, 10);
    if (!k || k < 1) { nthOut.textContent = ''; return; }
    if (k > 100000) { nthOut.textContent = 'Pick k ≤ 100000.'; return; }
    try {
      var v = H.nthHappy(k, opts());
      nthOut.innerHTML = 'The <strong>' + group(k) + (ordinal(k)) +
        '</strong> happy number is <strong>' + group(v) + '</strong>.';
    } catch (e) { nthOut.textContent = e.message; }
  }
  function ordinal(k) {
    var s = k % 100;
    if (s >= 11 && s <= 13) return 'th';
    switch (k % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'; }
  }

  /* ---- wiring ------------------------------------------------------------- */
  nInput.addEventListener('input', run);
  baseSel.addEventListener('change', function () { run(); renderExplorer(); renderNth(); });
  powerSel.addEventListener('change', function () { run(); renderExplorer(); renderNth(); });
  limitEl.addEventListener('input', renderExplorer);
  nthEl.addEventListener('input', renderNth);

  document.querySelector('.presets').addEventListener('click', function (e) {
    var b = e.target.closest('.preset');
    if (!b) return;
    if (b.getAttribute('data-big')) {
      // 2^1000 as a decimal string — far past a safe integer
      var exp = parseInt(b.getAttribute('data-big'), 10);
      var v = 1n; for (var i = 0; i < exp; i++) v *= 2n;
      baseSel.value = '10'; powerSel.value = '2';
      nInput.value = v.toString();
    } else {
      nInput.value = b.getAttribute('data-n');
    }
    run();
  });

  gridEl.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (!cell) return;
    nInput.value = cell.getAttribute('data-n');
    run();
    document.getElementById('n').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // first paint
  run();
  renderExplorer();
  renderNth();
})();
