/*
 * script.js — the thin browser layer over complex-core.js. It reads the inputs,
 * asks the core to parse and compute, prints the result, and draws the Argand
 * diagram on a <canvas>. It does *no* complex arithmetic of its own — every
 * number on screen and every plotted point comes straight from ComplexCore, so
 * what you see is exactly what tests.js proves.
 */

'use strict';

(function (K) {
  var $ = function (id) { return document.getElementById(id); };
  var aEl = $('a'), bEl = $('b'), nEl = $('n'), opEl = $('op');
  var bField = $('b-field'), nField = $('n-field'), legendB = $('legend-b');
  var errEl = $('err'), valEl = $('result-value'), polarEl = $('polar');
  var canvas = $('plane'), ctx = canvas.getContext('2d');

  var BINARY = { add: 1, subtract: 1, multiply: 1, divide: 1 };
  var UNARY = { conjugate: 1, negate: 1, reciprocal: 1, square: 1, sqrt: 1, roots: 1 };

  // Keep the right inputs visible for the chosen operation.
  function syncFields() {
    var op = opEl.value;
    var isBinary = !!BINARY[op];
    bField.classList.toggle('hidden', !isBinary);
    nField.classList.toggle('hidden', op !== 'roots');
    legendB.style.display = isBinary ? '' : 'none';
  }

  function run() {
    errEl.textContent = '';
    var op = opEl.value;
    var a, b;
    try {
      a = K.parse(aEl.value);
    } catch (e) {
      return fail('Operand A: ' + e.message);
    }

    var out, drawB = null;
    try {
      if (BINARY[op]) {
        b = K.parse(bEl.value);
        drawB = b;
        out = K.compute(op, a, b);
      } else if (op === 'roots') {
        var n = parseInt(nEl.value, 10);
        if (!(n >= 1 && n <= 24)) throw new Error('n must be between 1 and 24');
        out = K.compute('roots', a, n);
      } else {
        out = K.compute(op, a);
      }
    } catch (e) {
      return fail(e.message);
    }

    // Result text + polar readout.
    valEl.textContent = out.resultStr;
    var p = out.polar;
    if (out.points.length > 1) {
      polarEl.innerHTML = '<strong>' + out.points.length + '</strong> roots, each with '
        + '|z| = <strong>' + fmt(p.r) + '</strong>';
    } else {
      polarEl.innerHTML = '|z| = <strong>' + fmt(p.r) + '</strong> &nbsp; · &nbsp; '
        + 'arg = <strong>' + fmt(p.theta) + '</strong> rad (<strong>' + fmt(p.degrees) + '°</strong>)';
    }

    draw(a, drawB, out.points);
  }

  function fail(msg) {
    errEl.textContent = msg;
    valEl.textContent = '—';
    polarEl.textContent = '';
    draw(null, null, []);
  }

  function fmt(x) {
    if (!isFinite(x)) return String(x);
    return (Math.round(x * 1e6) / 1e6).toString();
  }

  /* ---- the Argand diagram -------------------------------------------------- */

  function draw(a, b, points) {
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Collect every point to plot so we can auto-scale to fit them all.
    var pts = [];
    if (a) pts.push(a);
    if (b) pts.push(b);
    for (var i = 0; i < points.length; i++) pts.push(points[i]);

    var maxMag = 1;
    for (var j = 0; j < pts.length; j++) {
      maxMag = Math.max(maxMag, Math.abs(pts[j].re), Math.abs(pts[j].im));
    }
    // Round the extent up to something tidy and pad by ~20%.
    var extent = niceStep(maxMag * 1.2);
    var cx = W / 2, cy = H / 2;
    var scale = Math.min(W, H) / 2 / extent * 0.9;

    var toX = function (re) { return cx + re * scale; };
    var toY = function (im) { return cy - im * scale; };

    drawGrid(W, H, cx, cy, extent, scale);

    // Vectors from the origin, then dots on top.
    if (a) vector(toX(a.re), toY(a.im), cx, cy, css('--a'));
    if (b) vector(toX(b.re), toY(b.im), cx, cy, css('--b'));

    var rc = css('--r');
    // Unit circle for the root spread when there is more than one point.
    if (points.length > 1) {
      var r = K.abs(points[0]) * scale;
      ctx.strokeStyle = 'rgba(142,230,200,.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (var k = 0; k < points.length; k++) {
      var pt = points[k];
      if (points.length === 1) vector(toX(pt.re), toY(pt.im), cx, cy, rc);
      point(toX(pt.re), toY(pt.im), rc, points.length === 1 ? 6 : 5);
    }
    if (a) point(toX(a.re), toY(a.im), css('--a'), 6, 'A');
    if (b) point(toX(b.re), toY(b.im), css('--b'), 6, 'B');
  }

  function drawGrid(W, H, cx, cy, extent, scale) {
    var step = niceStep(extent / 4);
    ctx.lineWidth = 1;
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var v = -Math.ceil(extent / step) * step; v <= extent; v += step) {
      var x = cx + v * scale, y = cy - v * scale;
      var onAxis = Math.abs(v) < step / 2;
      ctx.strokeStyle = onAxis ? 'rgba(154,163,192,.55)' : 'rgba(42,48,80,.9)';
      // vertical grid line
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      // horizontal grid line
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();

      if (!onAxis) {
        ctx.fillStyle = 'rgba(154,163,192,.7)';
        ctx.fillText(trimNum(v), x, cy + 12);          // real axis ticks
        ctx.fillText(trimNum(v) + 'i', cx - 16, y);    // imag axis ticks
      }
    }
    // Axis labels.
    ctx.fillStyle = 'rgba(154,163,192,.9)';
    ctx.fillText('Re', W - 16, cy - 12);
    ctx.fillText('Im', cx + 16, 12);
  }

  function vector(x, y, cx, cy, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    // arrow head
    var ang = Math.atan2(y - cy, x - cx);
    var s = 8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - s * Math.cos(ang - 0.4), y - s * Math.sin(ang - 0.4));
    ctx.lineTo(x - s * Math.cos(ang + 0.4), y - s * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function point(x, y, color, r, label) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#0b0e1a';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (label) {
      ctx.fillStyle = color;
      ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 9, y - 9);
    }
  }

  // A "nice" round number >= x (1, 2, 5 × 10^k) so grid ticks read cleanly.
  function niceStep(x) {
    if (!(x > 0) || !isFinite(x)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var f = x / p;
    var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return n * p;
  }
  function trimNum(v) { return (Math.round(v * 1e6) / 1e6).toString(); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* ---- wiring -------------------------------------------------------------- */
  [aEl, bEl, nEl].forEach(function (el) { el.addEventListener('input', run); });
  opEl.addEventListener('change', function () { syncFields(); run(); });

  Array.prototype.forEach.call(document.querySelectorAll('.preset'), function (btn) {
    btn.addEventListener('click', function () {
      aEl.value = btn.getAttribute('data-a');
      opEl.value = btn.getAttribute('data-op');
      if (btn.getAttribute('data-b')) bEl.value = btn.getAttribute('data-b');
      if (btn.getAttribute('data-n')) nEl.value = btn.getAttribute('data-n');
      syncFields();
      run();
    });
  });

  syncFields();
  run();
})(window.ComplexCore);
