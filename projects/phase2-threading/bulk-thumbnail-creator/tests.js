/*
 * tests.js — dependency-free checks for the bulk-thumbnail engine, run under
 * Node:
 *   node projects/phase2-threading/bulk-thumbnail-creator/tests.js
 *
 * The centre of gravity is the pool's concurrency contract: bounded in-flight
 * work no matter the batch size, self-balancing pull scheduling, failure
 * isolation, and order-preserving settled results. The geometry and resampler
 * are checked too, because a thumbnail that's the wrong size or squashed is
 * still a bug even if the pool is perfect.
 *
 * Layers:
 *   1. The pool — concurrency cap, pull-balancing, failure isolation, order,
 *      abort, and that every item runs exactly once.
 *   2. Thumbnail geometry — contain / cover / stretch math.
 *   3. The resampler — size, averaging, a solid-colour invariant.
 */
'use strict';

const assert = require('assert');
const {
  fitDimensions, makeImage, resizeArea, makeThumbnail,
  runPool, summarize,
} = require('./pool-core.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  try { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { passed++; }, (e) => { failures.push([name, e]); }); passed++; }
  catch (e) { failures.push([name, e]); }
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  /* ---------------------------------------------------------------- *
   * 1. The pool
   * ---------------------------------------------------------------- */

  await check('every item runs exactly once, result order matches input', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen = new Array(50).fill(0);
    const results = await runPool(items, async (x) => { seen[x]++; return x * 2; }, { concurrency: 7 });
    assert.ok(seen.every((c) => c === 1), 'each item processed exactly once');
    assert.strictEqual(results.length, 50);
    results.forEach((r, i) => {
      assert.strictEqual(r.status, 'fulfilled');
      assert.strictEqual(r.value, i * 2, 'result stays in original index order');
      assert.strictEqual(r.index, i);
    });
  });

  await check('concurrency is capped at the pool size regardless of batch size', async () => {
    let live = 0, peak = 0;
    const items = Array.from({ length: 200 }, (_, i) => i);
    await runPool(items, async () => {
      live++; peak = Math.max(peak, live);
      await delay(1);
      live--;
    }, { concurrency: 4 });
    assert.ok(peak <= 4, `peak in-flight ${peak} must not exceed 4`);
    assert.ok(peak >= 2, `pool should actually run things in parallel (peak ${peak})`);
  });

  await check('pull-scheduling self-balances: a slow job does not starve the others', async () => {
    // item 0 is very slow; with a pool of 2, the other worker should chew
    // through the remaining 9 items instead of waiting on item 0.
    const order = [];
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runPool(items, async (x) => {
      await delay(x === 0 ? 40 : 2);
      order.push(x);
    }, { concurrency: 2 });
    assert.strictEqual(order[order.length - 1], 0, 'the slow item 0 should finish last');
    assert.strictEqual(order.length, 10);
  });

  await check('failure isolation: one throwing job does not abort the batch', async () => {
    const items = [0, 1, 2, 3, 4, 5];
    const results = await runPool(items, async (x) => {
      if (x === 2 || x === 4) throw new Error(`boom ${x}`);
      return x;
    }, { concurrency: 3 });
    const { ok, failed, total } = summarize(results);
    assert.strictEqual(total, 6);
    assert.strictEqual(ok, 4);
    assert.strictEqual(failed, 2);
    assert.strictEqual(results[2].status, 'rejected');
    assert.strictEqual(results[2].reason.message, 'boom 2');
    assert.strictEqual(results[5].status, 'fulfilled', 'items after a failure still run');
  });

  await check('contrast: Promise.all fan-out is fail-fast (the bug the pool avoids)', async () => {
    let rejected = false;
    try {
      await Promise.all([1, 2, 3].map(async (x) => { if (x === 2) throw new Error('x'); return x; }));
    } catch (_) { rejected = true; }
    assert.ok(rejected, 'Promise.all rejects whole batch on first failure — runPool does not');
  });

  await check('empty batch returns an empty result array', async () => {
    const results = await runPool([], async () => 1, { concurrency: 4 });
    assert.deepStrictEqual(results, []);
  });

  await check('concurrency larger than batch is clamped, not an error', async () => {
    const results = await runPool([1, 2], async (x) => x, { concurrency: 99 });
    assert.strictEqual(summarize(results).ok, 2);
  });

  await check('abort signal stops starting new items', async () => {
    const controller = { aborted: false };
    const started = [];
    const items = Array.from({ length: 20 }, (_, i) => i);
    const p = runPool(items, async (x) => { started.push(x); await delay(5); }, {
      concurrency: 2, signal: controller,
    });
    await delay(12);
    controller.aborted = true;
    await p;
    assert.ok(started.length < 20, `abort should prevent some items starting (started ${started.length})`);
  });

  /* ---------------------------------------------------------------- *
   * 2. Thumbnail geometry
   * ---------------------------------------------------------------- */

  check('contain preserves aspect ratio and fits inside the box', () => {
    const f = fitDimensions(1000, 500, 200, 200, 'contain'); // 2:1 into 200x200
    assert.strictEqual(f.w, 200);
    assert.strictEqual(f.h, 100);
    assert.strictEqual(f.sw, 1000); // whole source used
    assert.strictEqual(f.sh, 500);
  });

  check('contain of a tall image fits the height', () => {
    const f = fitDimensions(500, 1000, 200, 200, 'contain');
    assert.strictEqual(f.w, 100);
    assert.strictEqual(f.h, 200);
  });

  check('cover fills the whole box exactly and crops the source centre', () => {
    const f = fitDimensions(1000, 500, 200, 200, 'cover'); // 2:1 into square
    assert.strictEqual(f.w, 200);
    assert.strictEqual(f.h, 200);
    assert.strictEqual(f.sh, 500);      // full height kept
    assert.strictEqual(f.sw, 500);      // cropped to a square of the width
    assert.strictEqual(f.sx, 250);      // centred crop: (1000-500)/2
    assert.strictEqual(f.sy, 0);
  });

  check('stretch ignores aspect and uses the whole source', () => {
    const f = fitDimensions(1000, 500, 200, 200, 'stretch');
    assert.deepStrictEqual([f.w, f.h, f.sw, f.sh], [200, 200, 1000, 500]);
  });

  /* ---------------------------------------------------------------- *
   * 3. The resampler
   * ---------------------------------------------------------------- */

  function solid(w, h, r, g, b) {
    const img = makeImage(w, h, 3);
    for (let i = 0; i < w * h; i++) { img.data[i * 3] = r; img.data[i * 3 + 1] = g; img.data[i * 3 + 2] = b; }
    return img;
  }

  check('resizeArea produces the requested output dimensions', () => {
    const out = resizeArea(solid(100, 80, 10, 20, 30), 25, 20);
    assert.strictEqual(out.width, 25);
    assert.strictEqual(out.height, 20);
    assert.strictEqual(out.data.length, 25 * 20 * 3);
  });

  check('solid-colour invariant: downscaling a flat image keeps the exact colour', () => {
    const out = resizeArea(solid(200, 200, 77, 123, 200), 16, 16);
    for (let i = 0; i < out.width * out.height; i++) {
      assert.strictEqual(out.data[i * 3], 77);
      assert.strictEqual(out.data[i * 3 + 1], 123);
      assert.strictEqual(out.data[i * 3 + 2], 200);
    }
  });

  check('area averaging: a 2x2 half-black half-white image downscales to one grey pixel', () => {
    const img = makeImage(2, 1, 3);
    img.data.set([0, 0, 0,  254, 254, 254]); // one black, one white pixel side by side
    const out = resizeArea(img, 1, 1);
    // average of 0 and 254 = 127
    assert.strictEqual(out.data[0], 127);
    assert.strictEqual(out.data[1], 127);
    assert.strictEqual(out.data[2], 127);
  });

  check('makeThumbnail composes geometry + resample into the contain size', () => {
    const thumb = makeThumbnail(solid(400, 200, 5, 5, 5), 100, 100, 'contain');
    assert.strictEqual(thumb.width, 100);
    assert.strictEqual(thumb.height, 50);
  });

  check('makeThumbnail cover yields exactly the box size', () => {
    const thumb = makeThumbnail(solid(400, 200, 5, 5, 5), 100, 100, 'cover');
    assert.deepStrictEqual([thumb.width, thumb.height], [100, 100]);
  });

  /* ---------------------------------------------------------------- *
   * report
   * ---------------------------------------------------------------- */
  if (failures.length) {
    console.error(`\n✗ ${failures.length} check(s) failed:\n`);
    for (const [name, e] of failures) console.error(`  ✗ ${name}\n      ${e.message}`);
    process.exit(1);
  }
  console.log(`  ✓ all ${passed} checks passing`);
}

run();
