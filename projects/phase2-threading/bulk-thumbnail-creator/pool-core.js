/*
 * pool-core.js — the bulk-thumbnail engine, transport-agnostic and DOM-free.
 * It knows nothing about the filesystem, canvases, PPM files or timers. It does
 * two things: resize a raw pixel buffer into a thumbnail, and run a *batch* of
 * such jobs through a bounded pool of concurrent workers.
 *
 * This is the Threading category, so the heart of the file is the pool, not the
 * resize. The task — "generate thumbnails from a batch of image files" — sounds
 * embarrassingly parallel, and that is exactly the trap. The naive "threaded"
 * version is one line:
 *
 *     const thumbs = await Promise.all(files.map(makeThumbnail));
 *
 * It looks concurrent and it is — catastrophically so. `.map` launches EVERY
 * job at once. Ten thousand files means ten thousand decode buffers alive at
 * the same instant, ten thousand open file descriptors, and a scheduler
 * thrashing between far more work items than the machine has cores. Throughput
 * doesn't rise with that fan-out, it collapses, and often the process dies on
 * "too many open files" or out-of-memory long before the batch finishes. And
 * because `Promise.all` is fail-fast, the first corrupt image rejects the whole
 * batch and throws away every thumbnail that already succeeded.
 *
 * The fix is the thread-pool pattern: a FIXED number of workers pull jobs from
 * a shared queue. Concurrency is capped at that number no matter how big the
 * batch is, so resource use is bounded and stable; work self-balances because a
 * worker that draws a slow job simply pulls its next one later; and each job is
 * isolated, so one bad file is recorded as a failure and the batch rolls on.
 * That is the one idea `runPool` is built to teach.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Small guards. A bad argument should fail loudly here, not silently
 * produce a garbage thumbnail or a wedged pool.
 * ------------------------------------------------------------------ */
function reqUint(n, name) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new TypeError(`${name} must be a non-negative integer, got ${n}`);
  }
  return n;
}
function reqPosInt(n, name) {
  reqUint(n, name);
  if (n < 1) throw new RangeError(`${name} must be >= 1, got ${n}`);
  return n;
}
function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

/* ================================================================== *
 * Part 1 — thumbnail geometry (pure math, no pixels touched)
 *
 * Given a source size and a target box, what rectangle of the source maps to
 * what rectangle of the output? Three honest answers, and getting them right is
 * most of what separates a thumbnail that looks correct from one that's
 * squashed or clipped wrong.
 * ================================================================== */

/**
 * fitDimensions(srcW, srcH, boxW, boxH, mode)
 *   mode 'contain' — scale to fit entirely inside the box, preserving aspect
 *                    ratio (letterbox). Output may be smaller than the box in
 *                    one dimension; the whole source is used.
 *   mode 'cover'   — scale to fill the box, preserving aspect ratio, cropping
 *                    the overflow. Output is exactly the box; a centred region
 *                    of the source is used.
 *   mode 'stretch' — output is exactly the box, aspect ratio ignored.
 *
 * Returns { w, h, sx, sy, sw, sh }: the output size (w,h) and the source
 * crop rectangle (sx,sy,sw,sh) that should be resampled into it.
 */
function fitDimensions(srcW, srcH, boxW, boxH, mode = 'contain') {
  reqPosInt(srcW, 'srcW'); reqPosInt(srcH, 'srcH');
  reqPosInt(boxW, 'boxW'); reqPosInt(boxH, 'boxH');

  if (mode === 'stretch') {
    return { w: boxW, h: boxH, sx: 0, sy: 0, sw: srcW, sh: srcH };
  }
  if (mode === 'cover') {
    // scale so the source covers the box, then crop the centre.
    const scale = Math.max(boxW / srcW, boxH / srcH);
    // the source rectangle that, scaled by `scale`, equals the box exactly:
    const sw = clamp(Math.round(boxW / scale), 1, srcW);
    const sh = clamp(Math.round(boxH / scale), 1, srcH);
    const sx = Math.floor((srcW - sw) / 2);
    const sy = Math.floor((srcH - sh) / 2);
    return { w: boxW, h: boxH, sx, sy, sw, sh };
  }
  // default: contain
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  return { w, h, sx: 0, sy: 0, sw: srcW, sh: srcH };
}

/* ================================================================== *
 * Part 2 — the resampler (the real per-job CPU work)
 *
 * An image here is a plain { width, height, channels, data } where `data` is a
 * flat Uint8ClampedArray of width*height*channels bytes (channels 3 = RGB,
 * 4 = RGBA). This is deliberately the same shape the browser's
 * ImageData/getImageData gives you and the same shape a PPM parse produces, so
 * the identical code runs in the browser demo and under Node.
 *
 * resizeArea does an area-weighted box downscale: each destination pixel is the
 * coverage-weighted average of the source pixels its footprint overlaps. That
 * is the correct way to shrink an image — it uses every source pixel, so it
 * doesn't alias/sparkle the way nearest-neighbour does. (For the upscale case,
 * where a dst pixel maps to less than one source pixel, it degrades gracefully
 * to sampling that pixel.)
 * ================================================================== */

function makeImage(width, height, channels = 3) {
  reqPosInt(width, 'width'); reqPosInt(height, 'height');
  if (channels !== 3 && channels !== 4) throw new RangeError('channels must be 3 or 4');
  return { width, height, channels, data: new Uint8ClampedArray(width * height * channels) };
}

/**
 * resizeArea(src, dstW, dstH, crop?) — area-weighted resample of the source
 * (optionally only the crop rectangle {sx,sy,sw,sh}) into a new dstW×dstH image.
 */
function resizeArea(src, dstW, dstH, crop) {
  reqPosInt(dstW, 'dstW'); reqPosInt(dstH, 'dstH');
  const ch = src.channels;
  const sx0 = crop ? crop.sx : 0;
  const sy0 = crop ? crop.sy : 0;
  const sw = crop ? crop.sw : src.width;
  const sh = crop ? crop.sh : src.height;
  const out = makeImage(dstW, dstH, ch);
  const S = src.data, D = out.data, sStride = src.width * ch;

  const scaleX = sw / dstW;
  const scaleY = sh / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    // source y-span [fy0, fy1) in source pixel coordinates
    const fy0 = sy0 + dy * scaleY;
    const fy1 = fy0 + scaleY;
    const iy0 = Math.floor(fy0);
    const iy1 = Math.max(iy0 + 1, Math.ceil(fy1));
    for (let dx = 0; dx < dstW; dx++) {
      const fx0 = sx0 + dx * scaleX;
      const fx1 = fx0 + scaleX;
      const ix0 = Math.floor(fx0);
      const ix1 = Math.max(ix0 + 1, Math.ceil(fx1));

      let acc0 = 0, acc1 = 0, acc2 = 0, acc3 = 0, wsum = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        if (sy < 0 || sy >= src.height) continue;
        // vertical coverage of this source row within [fy0,fy1)
        const wy = Math.min(sy + 1, fy1) - Math.max(sy, fy0);
        if (wy <= 0) continue;
        const rowBase = sy * sStride;
        for (let sx = ix0; sx < ix1; sx++) {
          if (sx < 0 || sx >= src.width) continue;
          const wx = Math.min(sx + 1, fx1) - Math.max(sx, fx0);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const p = rowBase + sx * ch;
          acc0 += S[p] * wgt;
          acc1 += S[p + 1] * wgt;
          acc2 += S[p + 2] * wgt;
          if (ch === 4) acc3 += S[p + 3] * wgt;
          wsum += wgt;
        }
      }
      const d = (dy * dstW + dx) * ch;
      if (wsum > 0) {
        D[d] = acc0 / wsum;
        D[d + 1] = acc1 / wsum;
        D[d + 2] = acc2 / wsum;
        if (ch === 4) D[d + 3] = acc3 / wsum;
      } else if (ch === 4) {
        D[d + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * makeThumbnail(src, boxW, boxH, mode) — the full per-job unit: compute the fit
 * geometry, then resample. This is what one pool worker runs once per image.
 */
function makeThumbnail(src, boxW, boxH, mode = 'contain') {
  const fit = fitDimensions(src.width, src.height, boxW, boxH, mode);
  return resizeArea(src, fit.w, fit.h, { sx: fit.sx, sy: fit.sy, sw: fit.sw, sh: fit.sh });
}

/* ================================================================== *
 * Part 3 — the bounded worker pool (the threading lesson)
 * ================================================================== */

/**
 * runPool(items, worker, opts) — run `worker(item, index, workerId)` over every
 * item using at most `concurrency` workers at a time. Workers pull the next
 * index from a shared cursor, so the batch size and the worker count are fully
 * decoupled: a million items still only ever has `concurrency` jobs in flight.
 *
 * Failure isolation: a job that throws (or rejects) does NOT abort the batch.
 * Every item ends up as a settled record, in ORIGINAL order:
 *     { status: 'fulfilled', value, index, workerId }
 *     { status: 'rejected',  reason, index, workerId }
 * (the same shape as Promise.allSettled, plus which worker ran it).
 *
 * opts:
 *   concurrency  number of workers (default 4; clamped to [1, items.length]).
 *   onProgress   called after each item with { done, total, index, workerId, result }.
 *   signal       an AbortSignal; once aborted, no further items are started.
 */
async function runPool(items, worker, opts = {}) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (typeof worker !== 'function') throw new TypeError('worker must be a function');
  const { onProgress, signal } = opts;
  const n = items.length;
  const results = new Array(n);
  if (n === 0) return results;

  const want = opts.concurrency == null ? 4 : reqPosInt(opts.concurrency, 'concurrency');
  const width = Math.min(want, n);

  // The shared queue is just a cursor into `items`. `cursor++` reads and
  // increments in a single uninterruptible step on JS's one event loop, so no
  // two workers ever draw the same index — the single-threaded runtime gives us
  // for free the atomic "take next job" that a real multithreaded pool would
  // need a lock or an atomic fetch-add to guarantee. That is precisely WHY the
  // pull/queue pattern is the robust one: the shared mutable state is a single
  // tiny counter, not the result set.
  let cursor = 0;
  let done = 0;

  async function runWorker(workerId) {
    while (true) {
      if (signal && signal.aborted) return;
      const i = cursor++;
      if (i >= n) return;
      let result;
      try {
        const value = await worker(items[i], i, workerId);
        result = { status: 'fulfilled', value, index: i, workerId };
      } catch (reason) {
        result = { status: 'rejected', reason, index: i, workerId };
      }
      results[i] = result;
      done++;
      if (onProgress) {
        try { onProgress({ done, total: n, index: i, workerId, result }); }
        catch (_) { /* a broken progress callback must not break the batch */ }
      }
    }
  }

  // Each worker loops to completion and never rejects (per-item errors are
  // caught above), so Promise.all here resolves only when the whole batch is
  // drained — it cannot fail-fast the way `Promise.all(items.map(...))` does.
  const crew = [];
  for (let w = 0; w < width; w++) crew.push(runWorker(w));
  await Promise.all(crew);
  return results;
}

/** summarize(results) — fold a runPool result array into counts. */
function summarize(results) {
  let ok = 0, failed = 0;
  for (const r of results) {
    if (!r) continue;
    if (r.status === 'fulfilled') ok++; else failed++;
  }
  return { ok, failed, total: results.length };
}

/* ------------------------------------------------------------------ *
 * Module export — works under Node (require) and the browser (global).
 * ------------------------------------------------------------------ */
const coreApi = {
  fitDimensions,
  makeImage,
  resizeArea,
  makeThumbnail,
  runPool,
  summarize,
  // internal, exposed for the tests
  _reqUint: reqUint,
  _reqPosInt: reqPosInt,
  _clamp: clamp,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.PoolCore = coreApi;
