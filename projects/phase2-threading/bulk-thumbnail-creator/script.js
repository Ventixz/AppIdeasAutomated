/*
 * script.js — the browser demo. It synthesises a batch of images on canvases,
 * runs them through the SAME runPool + makeThumbnail from pool-core.js that the
 * Node adapter uses, and visualises the one thing the Threading category is
 * about: a fixed crew of workers pulling from a shared queue keeps in-flight
 * work bounded and self-balancing, and isolates failures, no matter the batch.
 *
 * No framework, no build step. If the core failed to load we say so plainly.
 */
'use strict';

(function () {
  if (window.__noCore || !window.PoolCore) {
    document.body.innerHTML =
      '<main style="padding:40px;font:16px system-ui;color:#e8ecf6;background:#0f1420">' +
      '<h1>Could not load pool-core.js</h1><p>Open this file over a local server ' +
      '(<code>python3 -m http.server</code>) or straight from disk so the browser ' +
      'can load the sibling <code>pool-core.js</code>.</p></main>';
    return;
  }

  const { makeThumbnail, runPool, summarize } = window.PoolCore;
  const $ = (id) => document.getElementById(id);

  const el = {
    tiles: $('tiles'), batch: $('batch'), batchOut: $('batchOut'),
    pool: $('pool'), poolOut: $('poolOut'), size: $('size'), sizeOut: $('sizeOut'),
    mode: $('mode'), start: $('start'), fanout: $('fanout'), chaos: $('chaos'),
    bar: $('overallBar').firstElementChild, text: $('overallText'),
    lanes: $('lanes'), peakNote: $('peakNote'),
    resultPanel: $('resultPanel'), resultCount: $('resultCount'), thumbs: $('thumbs'),
  };

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const SRC_DIM = 420; // source images are 420x420 so a resize is real work

  /* ---- summary tiles ---- */
  const tileDefs = [
    ['done', 'processed'], ['ok', 'succeeded', 'ok'],
    ['failed', 'failed', 'err'], ['peak', 'peak in-flight', 'accent'],
    ['rate', 'images / sec', 'accent'],
  ];
  function buildTiles() {
    el.tiles.innerHTML = '';
    for (const [key, lbl, cls] of tileDefs) {
      const t = document.createElement('div');
      t.className = 'tile';
      t.innerHTML = `<div class="num ${cls || ''}" id="t_${key}">0</div><div class="lbl">${lbl}</div>`;
      el.tiles.appendChild(t);
    }
  }
  const setTile = (k, v) => { const n = $(`t_${k}`); if (n) n.textContent = v; };

  /* ---- synthesise a source image on an offscreen canvas, return engine image ---- */
  function makeSource(seed) {
    const c = document.createElement('canvas');
    c.width = c.height = SRC_DIM;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, SRC_DIM, SRC_DIM);
    g.addColorStop(0, `hsl(${(seed * 47) % 360} 80% 55%)`);
    g.addColorStop(1, `hsl(${(seed * 47 + 140) % 360} 80% 40%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, SRC_DIM, SRC_DIM);
    // high-frequency detail + a shape, so area-averaging has something to do
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < 40; i++) {
      const x = (seed * 31 + i * 53) % SRC_DIM, y = (seed * 17 + i * 71) % SRC_DIM;
      ctx.fillRect(x, y, 6, 6);
    }
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    ctx.arc(SRC_DIM * 0.5, SRC_DIM * 0.5, SRC_DIM * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05231f';
    ctx.font = 'bold 54px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(seed), SRC_DIM * 0.5, SRC_DIM * 0.5);
    const id = ctx.getImageData(0, 0, SRC_DIM, SRC_DIM);
    return { width: SRC_DIM, height: SRC_DIM, channels: 4, data: id.data };
  }

  /* ---- draw an engine image (RGBA) into a small canvas cell ---- */
  function cellFor(img) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    cell.appendChild(c);
    return cell;
  }
  function badCell() {
    const cell = document.createElement('div');
    cell.className = 'cell bad'; cell.textContent = '✗';
    return cell;
  }

  /* ---- lane view ---- */
  let lanes = [];
  function buildLanes(n) {
    el.lanes.innerHTML = ''; lanes = [];
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'lane';
      row.innerHTML = `<div class="tag">worker ${i}</div><div class="slot" id="lane_${i}">idle<span class="cnt">0 done</span></div>`;
      el.lanes.appendChild(row);
      lanes.push({ done: 0 });
    }
  }
  function laneBusy(i, jobLabel, fail) {
    const s = $(`lane_${i}`); if (!s) return;
    s.className = 'slot ' + (fail ? 'fail' : 'busy');
    s.innerHTML = `<span class="jid">${jobLabel}</span><span class="cnt">${lanes[i].done} done</span>`;
  }
  function laneIdle(i) {
    const s = $(`lane_${i}`); if (!s) return;
    s.className = 'slot';
    s.innerHTML = `idle<span class="cnt">${lanes[i].done} done</span>`;
  }

  /* ---- the batch run ---- */
  let running = false;

  async function run({ fanoutCompare = false } = {}) {
    if (running) return;
    running = true;
    el.start.disabled = el.fanout.disabled = true;

    const batchN = +el.batch.value;
    const poolN = +el.pool.value;
    const size = +el.size.value;
    const mode = el.mode.value;
    const chaos = el.chaos.checked;

    buildTiles();
    buildLanes(poolN);
    el.thumbs.innerHTML = '';
    el.resultPanel.hidden = true;
    el.bar.style.width = '0%';

    // build the batch of jobs (some marked "corrupt" if chaos is on)
    const items = [];
    for (let i = 0; i < batchN; i++) {
      const corrupt = chaos && (i % 8 === 3);
      items.push({ seed: i + 1, corrupt });
    }

    let live = 0, peak = 0;
    const t0 = performance.now();

    // one job = simulate a decode (async I/O-ish wait), then do the REAL resize.
    async function job(item, index, workerId) {
      live++; peak = Math.max(peak, live);
      laneBusy(workerId, `#${item.seed}`, false);
      // simulated variable "read + decode" latency so lanes visibly fill/drain
      await delay(40 + (item.seed * 37) % 110);
      if (item.corrupt) { live--; throw new Error('decode failed'); }
      const src = makeSource(item.seed);
      const thumb = makeThumbnail(src, size, size, mode); // real CPU work
      live--;
      lanes[workerId].done++;
      return { seed: item.seed, thumb };
    }

    const results = await runPool(items, job, {
      concurrency: poolN,
      onProgress: ({ done, total, workerId, result }) => {
        const frac = done / total;
        el.bar.style.width = (frac * 100).toFixed(1) + '%';
        const secs = (performance.now() - t0) / 1000;
        setTile('done', `${done}/${total}`);
        setTile('peak', peak);
        setTile('rate', (done / secs).toFixed(1));
        el.text.textContent = `${done}/${total} processed · pool of ${poolN} · peak in-flight ${peak}`;
        laneBusy(workerId, result.status === 'rejected' ? `#${items[result.index].seed} ✗` : `#${items[result.index].seed} ✓`, result.status === 'rejected');
        setTimeout(() => laneIdle(workerId), 90);
      },
    });

    const secs = (performance.now() - t0) / 1000;
    const { ok, failed } = summarize(results);
    setTile('ok', ok); setTile('failed', failed); setTile('peak', peak);
    setTile('rate', (ok / secs).toFixed(1)); setTile('done', `${batchN}/${batchN}`);
    el.bar.style.width = '100%';
    el.text.textContent = `Done in ${secs.toFixed(2)}s — ${ok} ok, ${failed} failed. Peak in-flight ${peak} (pool was ${poolN}).`;
    el.peakNote.textContent = peak <= poolN
      ? `✓ In-flight work never exceeded the pool size (${peak} ≤ ${poolN}), even across ${batchN} jobs.`
      : '';

    // render thumbnails in original order
    el.resultPanel.hidden = false;
    el.resultCount.textContent = `(${ok} of ${batchN}${failed ? `, ${failed} failed` : ''})`;
    for (const r of results) {
      el.thumbs.appendChild(r && r.status === 'fulfilled' ? cellFor(r.value.thumb) : badCell());
    }

    if (fanoutCompare) {
      // run the SAME batch with no bound (Promise.all fan-out) to show the peak.
      let flive = 0, fpeak = 0;
      await Promise.allSettled(items.map(async (item) => {
        flive++; fpeak = Math.max(fpeak, flive);
        await delay(40 + (item.seed * 37) % 110);
        if (!item.corrupt) makeThumbnail(makeSource(item.seed), size, size, mode);
        flive--;
      }));
      el.peakNote.textContent =
        `Bounded pool: peak ${peak} in flight. Unbounded Promise.all fan-out of the ` +
        `same ${batchN}: peak ${fpeak} in flight — all ${batchN} at once. At scale that ` +
        `is what exhausts memory and file handles; the pool's peak stays at ${poolN}.`;
    }

    el.start.disabled = el.fanout.disabled = false;
    running = false;
  }

  /* ---- wiring ---- */
  el.batch.addEventListener('input', () => { el.batchOut.textContent = `${el.batch.value} images`; });
  el.pool.addEventListener('input', () => { el.poolOut.textContent = `${el.pool.value} workers`; });
  el.size.addEventListener('input', () => { el.sizeOut.textContent = `${el.size.value} px`; });
  el.start.addEventListener('click', () => run());
  el.fanout.addEventListener('click', () => run({ fanoutCompare: true }));

  buildTiles();
  buildLanes(+el.pool.value);
})();
