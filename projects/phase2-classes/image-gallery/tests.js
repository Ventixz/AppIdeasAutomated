#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the Image Gallery engine. Run:
 *   node tests.js
 *
 * The Classes category is about design, so these tests lean on what the design
 * is supposed to GUARANTEE, not on surface features:
 *
 *   - ImageAsset is genuinely abstract and each subclass answers the abstract
 *     hooks (capabilities, format, estimateBytes) — polymorphism, not branching.
 *   - Transforms compose EXACTLY: scale up then down is a round trip to the
 *     pixel, four 90° rotations are the identity, and an illegal crop is refused.
 *   - Conversion is HONEST: it declares exactly the capabilities the target
 *     format cannot keep (alpha, animation, vector, lossless) and nothing it can.
 *   - The Gallery's by-tag / by-format indexes are DERIVED and always equal a
 *     fresh rebuild, across add, remove and retag.
 */
'use strict';

const core = require('./gallery-core');
const {
  GalleryError, Rational, TransformPipeline,
  ImageAsset, JpegImage, PngImage, GifImage, SvgImage, Gallery,
} = core;
const fixtures = require('./gallery-fixtures');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throwsErr(fn, msg) {
  try { fn(); fail++; console.error('  FAIL (no throw):', msg); }
  catch (e) { ok(e instanceof GalleryError, `${msg} — threw ${e.name}: ${e.message}`); }
}

/* --- abstraction: the base class refuses to be instantiated --------- */
throwsErr(() => new ImageAsset({ width: 10, height: 10 }), 'ImageAsset is abstract — cannot be constructed directly');
ok(new JpegImage({ width: 10, height: 10 }) instanceof ImageAsset, 'JpegImage is an ImageAsset');
throwsErr(() => new JpegImage({ width: 0, height: 10 }), 'an image needs positive dimensions');

/* --- polymorphism: each format answers the abstract hooks ----------- */
const samples = [
  new JpegImage({ width: 100, height: 100 }),
  new PngImage({ width: 100, height: 100 }),
  new GifImage({ width: 100, height: 100, frames: 10 }),
  new SvgImage({ width: 100, height: 100, sourceLength: 1500 }),
];
for (const img of samples) {
  ok(typeof img.format === 'string', `${img.constructor.name} reports a format`);
  ok(img.capabilities && typeof img.capabilities.alpha === 'boolean',
    `${img.constructor.name} declares a capability profile`);
  ok(img.estimatedBytes() > 0, `${img.constructor.name} estimates a positive byte size`);
}
eq(new JpegImage({ width: 100, height: 100 }).capabilities.alpha, false, 'JPEG has no alpha');
eq(new PngImage({ width: 100, height: 100 }).capabilities.lossy, false, 'PNG is lossless');
eq(new GifImage({ width: 100, height: 100, frames: 5 }).isAnimated, true, 'a multi-frame GIF is animated');
eq(new GifImage({ width: 100, height: 100, frames: 1 }).isAnimated, false, 'a single-frame GIF is not animated');
eq(new SvgImage({ width: 100, height: 100 }).capabilities.vector, true, 'SVG is vector');

// SVG byte cost is resolution-independent; a raster's grows with the pixel box.
const svg = new SvgImage({ width: 100, height: 100, sourceLength: 1500 });
const svgBig = svg.withTransform((t) => t.scale(10));
eq(svg.estimatedBytes(), svgBig.estimatedBytes(), 'SVG bytes do not grow when scaled up');
const png = new PngImage({ width: 100, height: 100 });
ok(png.withTransform((t) => t.scale(10)).estimatedBytes() > png.estimatedBytes(),
  'PNG bytes DO grow when scaled up');

/* --- transforms compose exactly ------------------------------------- */
const base = new JpegImage({ width: 4000, height: 3000 });

// scale up by 3/2 then back down by 2/3 is a pixel-exact round trip.
const roundTrip = base.withTransform((t) => t.scale('3/2').scale('2/3'));
eq(roundTrip.effectiveWidth, 4000, 'scale 3/2 then 2/3 returns the original width exactly');
eq(roundTrip.effectiveHeight, 3000, 'scale 3/2 then 2/3 returns the original height exactly');

// A single 3/2 scale is exact mid-pipeline.
const half = base.withTransform((t) => t.scale('1/2'));
eq(half.effectiveWidth, 2000, 'scale 1/2 halves the width');
eq(half.effectiveHeight, 1500, 'scale 1/2 halves the height');

// Four quarter turns is the identity; one swaps the sides.
const spun = base.withTransform((t) => t.rotate(1).rotate(1).rotate(1).rotate(1));
eq(spun.effectiveWidth, 4000, 'four 90° rotations restore the width');
eq(spun.effectiveHeight, 3000, 'four 90° rotations restore the height');
const once = base.withTransform((t) => t.rotate(1));
eq(once.effectiveWidth, 3000, 'one 90° rotation swaps width and height (w)');
eq(once.effectiveHeight, 4000, 'one 90° rotation swaps width and height (h)');

// Crop is a window: it must fit. An oversized crop is refused.
const cropped = base.withTransform((t) => t.crop(1000, 800));
eq(cropped.effectiveWidth, 1000, 'crop sets the new width');
eq(cropped.effectiveHeight, 800, 'crop sets the new height');
throwsErr(() => base.withTransform((t) => t.crop(5000, 800)), 'a crop bigger than the image is refused');
// After scaling to 2000x1500, a 1800-wide crop is fine but a 2500-wide one is not.
throwsErr(() => base.withTransform((t) => t.scale('1/2').crop(2500, 100)),
  'a crop is checked against the CURRENT (post-scale) dimensions');
ok(base.withTransform((t) => t.scale('1/2').crop(1800, 100)) instanceof ImageAsset,
  'a crop that fits the post-scale dimensions is allowed');

// Transforming returns a COPY — the original is untouched (safe shared assets).
const g0 = new JpegImage({ id: 'x', width: 100, height: 100 });
const g1 = g0.withTransform((t) => t.scale(2));
eq(g0.effectiveWidth, 100, 'the original image is not mutated by withTransform');
eq(g1.effectiveWidth, 200, 'the returned copy carries the transform');

/* --- conversion is honest about capability loss --------------------- */
const logo = new PngImage({ width: 512, height: 512, tags: ['brand'] });   // alpha, lossless
const asJpeg = logo.convertTo(JpegImage);
ok(asJpeg.losses.some((l) => /alpha/.test(l)), 'PNG→JPEG reports the alpha channel is flattened');
ok(asJpeg.losses.some((l) => /lossy/.test(l)), 'PNG→JPEG reports lossy re-encoding');
eq(asJpeg.image.format, 'jpeg', 'the converted image is a JPEG');
ok(asJpeg.image.hasTag('brand'), 'conversion carries the tags over');

const spinner = new GifImage({ width: 64, height: 64, frames: 24 });        // animated
const spinnerPng = spinner.convertTo(PngImage);
ok(spinnerPng.losses.some((l) => /animation/.test(l)), 'animated GIF→PNG reports the animation is dropped');
eq(spinnerPng.image.frames, 1, 'the converted still image has a single frame');

const chart = new SvgImage({ width: 800, height: 600 });                    // vector
const chartPng = chart.convertTo(PngImage);
ok(chartPng.losses.some((l) => /rasteriz/.test(l)), 'SVG→PNG reports the vector art is rasterized');

// A lossless, opaque, still raster into PNG loses nothing.
const photo = new JpegImage({ width: 100, height: 100 });
const photoPng = photo.convertTo(PngImage);
eq(photoPng.losses.length, 0, 'JPEG→PNG (opaque still) is a lossless conversion with no reported loss');

/* --- the gallery's derived indexes stay in lock-step ---------------- */
// Equality of the live index with a fresh rebuild, checked as a helper so we
// can assert it after every kind of mutation.
function indexMatchesRebuild(g) {
  const liveTag = JSON.stringify(serializeIndex(g._byTag));
  const liveFmt = JSON.stringify(serializeIndex(g._byFormat));
  g._reindex();
  return liveTag === JSON.stringify(serializeIndex(g._byTag))
    && liveFmt === JSON.stringify(serializeIndex(g._byFormat));
}
function serializeIndex(map) {
  return [...map.keys()].sort().map((k) => [k, [...map.get(k)].sort()]);
}

const gallery = fixtures.buildGallery(core);
ok(indexMatchesRebuild(gallery), 'after building, indexes equal a fresh rebuild');
eq(gallery.size, 6, 'the sample gallery has six images');

// by-tag / by-format are served off the index and are correct.
eq(gallery.byTag('ui').length, 3, 'three images carry #ui');
eq(gallery.byFormat('png').length, 2, 'two PNGs in the gallery');
eq(gallery.search({ tags: ['brand', 'ui'] }).length, 2, 'two images have BOTH #brand and #ui (logo and icon)');
ok(gallery.search({ tags: ['brand', 'ui'] }).every((i) => i.hasTag('brand') && i.hasTag('ui')),
  'every brand+ui hit really carries both tags');
eq(gallery.search({ tags: ['brand'], format: 'svg' }).length, 1, 'adding format=svg narrows #brand to the chart');
eq(gallery.search({ tags: ['brand'], format: 'svg' })[0].id, 'img-chart', 'that brand+svg hit is the chart');

// Remove an image: indexes must not keep dangling references.
gallery.remove('img-logo');
eq(gallery.size, 5, 'removing an image shrinks the gallery');
ok(indexMatchesRebuild(gallery), 'after remove, indexes still equal a fresh rebuild');
ok(!gallery.byFormat('png').some((i) => i.id === 'img-logo'), 'the removed image is gone from the format index');
ok(!gallery.album('Marketing').some((i) => i.id === 'img-logo'), 'the removed image is gone from its album too');

// Retag through the gallery keeps the index current.
gallery.tagImage('img-portrait', 'brand');
ok(gallery.byTag('brand').some((i) => i.id === 'img-portrait'), 'tagging through the gallery updates the index');
ok(indexMatchesRebuild(gallery), 'after retag, indexes still equal a fresh rebuild');

// Duplicate ids are refused.
throwsErr(() => gallery.add(new JpegImage({ id: 'img-portrait', width: 10, height: 10 })),
  'adding a duplicate id is refused');

/* --- sorting is polymorphic (no format switches) -------------------- */
const bySize = gallery.sortedBy('largest');
ok(bySize[0].megapixels >= bySize[bySize.length - 1].megapixels, 'sort by largest is descending by megapixels');
const heaviest = gallery.sortedBy('heaviest');
ok(heaviest[0].estimatedBytes() >= heaviest[heaviest.length - 1].estimatedBytes(),
  'sort by heaviest is descending by estimated bytes');
throwsErr(() => gallery.sortedBy('nope'), 'an unknown sort key is refused');

/* --- Rational sanity ------------------------------------------------ */
eq(Rational.from('3/2').mul('2/3').toString(), '1', '3/2 × 2/3 is exactly 1');
eq(Rational.from(1.5).toString(), '3/2', '1.5 parses to the exact fraction 3/2');
eq(new TransformPipeline().crop(10, 10).ops.length, 1, 'a pipeline records its ops');
eq(new TransformPipeline().isEmpty(), true, 'a fresh pipeline is empty');

/* -------------------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
