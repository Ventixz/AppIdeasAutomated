/*
 * UI glue for the name RNN. Trains the network in short chunks on a timer so the
 * page stays responsive and you can watch the loss curve fall, then wires up the
 * prefix / creativity / count controls to sample new names.
 */
(function () {
  'use strict';

  var CORPUS = window.NAME_CORPUS;
  var TARGET_ITERS = 130;   // total training steps
  var CHUNK = 6;            // steps per animation frame
  var BATCH = 24;

  var el = function (id) { return document.getElementById(id); };
  var statusEl = el('train-status'), lossLabel = el('loss-label'), barFill = el('bar-fill');
  var chart = el('loss-chart'), ctx = chart.getContext('2d');
  var controls = el('controls'), resultsPanel = el('results-panel'), resultsEl = el('results');

  var net, lossHistory, iter, batchCursor;

  function makeBatch() {
    var b = [];
    for (var i = 0; i < BATCH; i++) {
      b.push(CORPUS[batchCursor % CORPUS.length]);
      batchCursor = (batchCursor * 31 + 17) % CORPUS.length;
    }
    return b;
  }

  function drawChart() {
    var W = chart.width, H = chart.height;
    ctx.clearRect(0, 0, W, H);
    if (lossHistory.length < 2) return;
    var max = Math.max.apply(null, lossHistory), min = Math.min.apply(null, lossHistory);
    var span = Math.max(max - min, 0.001);
    // grid baseline
    ctx.strokeStyle = 'rgba(124,156,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
    // loss line
    ctx.beginPath();
    ctx.strokeStyle = '#59e6c3';
    ctx.lineWidth = 2;
    for (var i = 0; i < lossHistory.length; i++) {
      var x = (i / (lossHistory.length - 1)) * W;
      var y = H - 6 - ((lossHistory[i] - min) / span) * (H - 12);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function trainChunk() {
    for (var i = 0; i < CHUNK && iter < TARGET_ITERS; i++) {
      var loss = net.step(makeBatch());
      lossHistory.push(loss);
      iter++;
    }
    var last = lossHistory[lossHistory.length - 1];
    lossLabel.textContent = 'loss ' + last.toFixed(3);
    barFill.style.width = Math.round((iter / TARGET_ITERS) * 100) + '%';
    statusEl.textContent = 'Learning the shape of names… ' + iter + ' / ' + TARGET_ITERS + ' steps';
    drawChart();

    if (iter < TARGET_ITERS) {
      requestAnimationFrame(trainChunk);
    } else {
      statusEl.textContent = '✓ Trained on ' + CORPUS.length + ' names — ' +
        'vocabulary of ' + net.vocab.length + ' characters.';
      controls.hidden = false;
      generate();
    }
  }

  function startTraining() {
    // A fresh seed each run so retraining actually gives a different network.
    var seed = ((iter || 0) + 1) * 2654435761 % 2147483647 || 12345;
    net = new window.NameRNN({ hidden: 24, lr: 0.02, seed: seed });
    net.train(CORPUS);
    lossHistory = []; iter = 0; batchCursor = 3;
    controls.hidden = true;
    resultsPanel.hidden = true;
    barFill.style.width = '0%';
    requestAnimationFrame(trainChunk);
  }

  function generate() {
    var prefix = el('prefix').value.replace(/[^a-zA-Z]/g, '').toLowerCase().slice(0, 3);
    var temp = parseFloat(el('temp').value);
    var count = Math.min(30, Math.max(1, parseInt(el('count').value, 10) || 10));

    // De-duplicate within a batch, with a few extra tries so we usually hit `count`.
    var seen = {}, out = [], tries = 0;
    while (out.length < count && tries < count * 8) {
      tries++;
      var name = net.sample(prefix, temp);
      if (name.length < 2) continue;
      if (seen[name]) continue;
      seen[name] = true;
      out.push(name);
    }

    resultsEl.innerHTML = '';
    out.forEach(function (name) {
      var li = document.createElement('li');
      li.textContent = name;
      li.addEventListener('click', function () { copyName(li, name); });
      resultsEl.appendChild(li);
    });
    resultsPanel.hidden = out.length === 0;
  }

  function copyName(li, name) {
    var display = name.charAt(0).toUpperCase() + name.slice(1);
    var done = function () {
      li.classList.add('copied');
      setTimeout(function () { li.classList.remove('copied'); }, 700);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(display).then(done, done);
    } else {
      done();
    }
  }

  // ---- wire up ----
  el('temp').addEventListener('input', function () {
    el('temp-val').textContent = parseFloat(this.value).toFixed(2);
  });
  el('generate').addEventListener('click', generate);
  el('retrain').addEventListener('click', startTraining);
  el('prefix').addEventListener('keydown', function (e) { if (e.key === 'Enter') generate(); });

  startTraining();
})();
