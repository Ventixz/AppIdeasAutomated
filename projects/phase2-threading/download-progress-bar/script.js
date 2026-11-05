/*
 * script.js — the browser demo. It simulates N concurrent download workers,
 * each advancing in its own irregular bursts, and drives the DOM-free
 * ProgressAggregator from progress-core.js. With "chaos mode" on, every update
 * is randomly dropped, duplicated or reordered on its way to the aggregator —
 * and the overall bar still reaches exactly 100%, because each worker reports
 * an absolute position rather than a delta. No logic lives here that isn't
 * about painting pixels and faking a flaky network.
 */
'use strict';

(function () {
  const Core = window.ProgressCore;
  const $ = (id) => document.getElementById(id);
  if (!Core) { document.body.innerHTML = '<p style="color:#f66;padding:2rem">Could not load progress-core.js</p>'; return; }
  const { ProgressAggregator, formatBytes, formatRate, formatDuration } = Core;

  const PART_SIZES = [3_200_000, 2_100_000, 2_800_000, 1_900_000]; // bytes per worker
  const TICK_MS = 80;

  let agg, workers, running, chaos, rafId, tickTimer;

  function fresh() {
    agg = new ProgressAggregator({ halfLifeSec: 1.5 });
    workers = PART_SIZES.map((size, i) => {
      agg.addWorker(i, size);
      return { id: i, size, sent: 0 };   // `sent` = this worker's true position
    });
    running = false;
  }

  /* ---- deliver an update, maybe badly, through a "network" ---- */
  function deliver(id, pos) {
    if (!chaos) { agg.report(id, pos); return; }
    const roll = Math.random();
    if (roll < 0.15) {                     // DROP: never arrives
      log(`drop   worker ${id} → ${formatBytes(pos)}`);
      return;
    }
    if (roll < 0.30) {                     // DUPLICATE: arrives twice
      log(`dup×2  worker ${id} → ${formatBytes(pos)}`);
      agg.report(id, pos); agg.report(id, pos);
      return;
    }
    if (roll < 0.50) {                     // REORDER: arrives late, after newer ones
      log(`delay  worker ${id} → ${formatBytes(pos)} (reordered)`);
      setTimeout(() => agg.report(id, pos), TICK_MS * (1 + Math.floor(Math.random() * 4)));
      return;
    }
    agg.report(id, pos);
  }

  function tick() {
    let anyLeft = false;
    for (const w of workers) {
      if (w.sent < w.size) {
        const burst = Math.floor(Math.random() * (w.size / 18));
        w.sent = Math.min(w.size, w.sent + burst);
        if (w.sent >= w.size) {
          // end-of-stream: the final absolute position is authoritative and
          // always delivered — like a stream's 'end' event, it is not subject
          // to loss. Intermediate updates above still get the full chaos.
          agg.report(w.id, w.sent);
          if (chaos) log(`end    worker ${w.id} → ${formatBytes(w.sent)} (reliable)`);
        } else {
          deliver(w.id, w.sent);
          anyLeft = true;
        }
      }
    }
    if (!anyLeft) stop();
  }

  function start() {
    if (running) return;
    fresh();
    buildWorkerRows();
    running = true;
    tickTimer = setInterval(tick, TICK_MS);
    draw();
  }

  function stop() {
    running = false;
    clearInterval(tickTimer);
  }

  /* ---- rendering (runs every animation frame while the page is open) ---- */

  function barFill(el, fraction) {
    const span = el.querySelector('span');
    if (fraction == null) {
      el.classList.add('indeterminate');
      span.style.width = '35%';
    } else {
      el.classList.remove('indeterminate');
      span.style.width = (fraction * 100).toFixed(1) + '%';
    }
  }

  function draw() {
    const snap = agg.snapshot();

    barFill($('overallBar'), snap.fraction);
    const pct = snap.fraction == null ? '?' : Math.floor(snap.fraction * 100);
    $('overallText').textContent =
      `${pct}%  ·  ${formatBytes(snap.done)} / ${snap.total == null ? '?' : formatBytes(snap.total)}` +
      `  ·  ${formatRate(snap.bytesPerSec)}  ·  ` +
      (snap.finished ? `done in ${formatDuration(snap.elapsedSec)}` : `ETA ${formatDuration(snap.etaSec)}`);

    renderTiles(snap);

    for (const w of workers) {
      const row = $('w' + w.id);
      if (!row) continue;
      const frac = w.sent / w.size;
      barFill(row.querySelector('.bar'), frac);
      row.querySelector('.pos').textContent =
        `${formatBytes(w.sent)} / ${formatBytes(w.size)}`;
    }

    rafId = requestAnimationFrame(draw);
  }

  function renderTiles(snap) {
    const tiles = [
      ['Workers', snap.workers],
      ['Downloaded', formatBytes(snap.done)],
      ['Rate', formatRate(snap.bytesPerSec)],
      [snap.finished ? 'Elapsed' : 'ETA',
        snap.finished ? formatDuration(snap.elapsedSec) : formatDuration(snap.etaSec)],
    ];
    $('tiles').innerHTML = tiles.map(([lbl, num]) =>
      `<div class="tile"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join('');
  }

  function buildWorkerRows() {
    $('workers').innerHTML = workers.map((w) =>
      `<div class="wrow" id="w${w.id}">
         <div class="wname">part ${w.id + 1}</div>
         <div class="bar"><span></span></div>
         <div class="pos muted small">0 B / ${formatBytes(w.size)}</div>
       </div>`).join('');
  }

  let logLines = [];
  function log(line) {
    logLines.unshift(line);
    logLines = logLines.slice(0, 40);
    $('chaosLog').textContent = logLines.join('\n');
  }

  /* ---- wire up controls ---- */
  $('start').addEventListener('click', start);
  $('reset').addEventListener('click', () => {
    stop(); fresh(); buildWorkerRows(); logLines = []; $('chaosLog').textContent = '';
  });
  $('chaos').addEventListener('change', (e) => {
    chaos = e.target.checked;
    $('chaosPanel').hidden = !chaos;
  });

  // initial idle state
  fresh();
  buildWorkerRows();
  draw();
})();
