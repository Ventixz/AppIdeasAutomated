/*
 * gallery-core.js — the Image Gallery engine, as a set of classes with no
 * dependencies and no build step. The same file is loaded by the CLI
 * (gallery-node.js), the tests (tests.js) and the browser demo (script.js).
 *
 * The task (karan/Projects, Classes / OOP): "Create an image abstract class and
 * then a class that inherits from it for each image type," then a gallery that
 * holds and displays them.
 *
 * The design lives in three places, each of which is a thing a naive version
 * gets wrong:
 *
 *   1. ImageAsset is abstract and owns every invariant that is TRUE OF ALL
 *      IMAGES (identity, dimensions, tags, an exact transform pipeline). Each
 *      subclass declares only what genuinely DIFFERS between formats — a
 *      capability profile (alpha? animation? lossy? vector?) and a format-specific
 *      byte estimate. Nothing in the gallery ever switches on `instanceof` or a
 *      format string: it asks the object. Adding WebP tomorrow touches one class.
 *
 *   2. Transforms (crop / resize / scale / rotate / flip) compose EXACTLY and
 *      LAZILY. Effective dimensions are folded as exact rationals, so scaling a
 *      photo up by 3/2 and back down by 2/3 returns the original to the pixel,
 *      and four 90° rotations are the identity. No pixels are touched until you
 *      bake — the geometry is pure arithmetic.
 *
 *   3. Converting between formats is HONEST about capability loss. A transparent
 *      PNG saved as JPEG doesn't silently lose its alpha — the conversion reports
 *      "alpha flattened", "animation reduced to first frame", "vector rasterized"
 *      by comparing the two capability profiles. Loss is declared, never hidden.
 *
 * The Gallery itself keeps the images as the single source of truth and rebuilds
 * its by-tag / by-format indexes in lock-step, so a lookup can never name an
 * image the gallery no longer holds (tests.js proves it against a full rebuild).
 */
'use strict';

/* ================================================================== *
 * Errors — one typed error so callers can tell "you used it wrong"
 * from a genuine crash.
 * ================================================================== */

class GalleryError extends Error {
  constructor(message) { super(message); this.name = 'GalleryError'; }
}

/* ================================================================== *
 * Rational — exact fractions over BigInt. Used only for transform
 * geometry, so a chain of scales composes without float drift.
 * ================================================================== */

function gcdBig(a, b) {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

class Rational {
  constructor(num, den = 1n) {
    num = BigInt(num); den = BigInt(den);
    if (den === 0n) throw new GalleryError('rational with zero denominator');
    if (den < 0n) { num = -num; den = -den; }
    const g = gcdBig(num, den) || 1n;
    this.n = num / g;
    this.d = den / g;
  }

  static from(value) {
    if (value instanceof Rational) return value;
    if (typeof value === 'bigint') return new Rational(value, 1n);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new GalleryError(`not a finite number: ${value}`);
      if (Number.isInteger(value)) return new Rational(BigInt(value), 1n);
      // exact decimal: 1.5 -> 15/10
      const s = String(value);
      const [whole, frac = ''] = s.replace('-', '').split('.');
      const sign = s.startsWith('-') ? -1n : 1n;
      const den = 10n ** BigInt(frac.length);
      const num = BigInt(whole + frac);
      return new Rational(sign * num, den);
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (s.includes('/')) {
        const [n, d] = s.split('/');
        return new Rational(BigInt(n.trim()), BigInt(d.trim()));
      }
      return Rational.from(Number(s));
    }
    throw new GalleryError(`cannot read a rational from ${JSON.stringify(value)}`);
  }

  mul(other) { const o = Rational.from(other); return new Rational(this.n * o.n, this.d * o.d); }
  div(other) { const o = Rational.from(other); return new Rational(this.n * o.d, this.d * o.n); }

  equals(other) { const o = Rational.from(other); return this.n === o.n && this.d === o.d; }

  // Round half-up to the nearest integer — only ever called at the very edge,
  // when a real pixel count is needed for display or a byte estimate.
  toInteger() {
    const twice = (this.n * 2n) / this.d;
    const rounded = (twice + (twice < 0n ? -1n : 1n)) / 2n;
    return Number(rounded);
  }

  toNumber() { return Number(this.n) / Number(this.d); }
  isInteger() { return this.d === 1n; }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}

/* ================================================================== *
 * Transforms — a small algebra of operations on a (width, height)
 * box. Each op knows how to carry exact dimensions forward; none of
 * them touch pixels. A TransformPipeline is an ordered, immutable list.
 * ================================================================== */

const TRANSFORMS = {
  crop(dims, { width, height }) {
    const w = Rational.from(width), h = Rational.from(height);
    if (w.n <= 0n || h.n <= 0n) throw new GalleryError('crop size must be positive');
    // A crop can only ever make the image smaller or equal — it is a window.
    if (w.toNumber() > dims.w.toNumber() + 1e-9 || h.toNumber() > dims.h.toNumber() + 1e-9) {
      throw new GalleryError(
        `crop ${width}x${height} does not fit inside ${dims.w}x${dims.h}`);
    }
    return { w, h };
  },
  resize(dims, { width, height }) {
    const w = Rational.from(width), h = Rational.from(height);
    if (w.n <= 0n || h.n <= 0n) throw new GalleryError('resize size must be positive');
    return { w, h };
  },
  scale(dims, { factor }) {
    const f = Rational.from(factor);
    if (f.n <= 0n) throw new GalleryError('scale factor must be positive');
    return { w: dims.w.mul(f), h: dims.h.mul(f) };
  },
  rotate(dims, { quarterTurns }) {
    const k = ((quarterTurns % 4) + 4) % 4;
    return (k % 2 === 1) ? { w: dims.h, h: dims.w } : { w: dims.w, h: dims.h };
  },
  flipH(dims) { return { w: dims.w, h: dims.h }; },
  flipV(dims) { return { w: dims.w, h: dims.h }; },
};

class Transform {
  constructor(kind, args = {}) {
    if (!TRANSFORMS[kind]) throw new GalleryError(`unknown transform: ${kind}`);
    this.kind = kind;
    this.args = args;
    Object.freeze(this.args);
    Object.freeze(this);
  }
  applyTo(dims) { return TRANSFORMS[this.kind](dims, this.args); }
  describe() {
    switch (this.kind) {
      case 'crop':   return `crop to ${this.args.width}x${this.args.height}`;
      case 'resize': return `resize to ${this.args.width}x${this.args.height}`;
      case 'scale':  return `scale by ${Rational.from(this.args.factor)}`;
      case 'rotate': return `rotate ${(((this.args.quarterTurns % 4) + 4) % 4) * 90}°`;
      case 'flipH':  return 'flip horizontally';
      case 'flipV':  return 'flip vertically';
      default:       return this.kind;
    }
  }
}

class TransformPipeline {
  constructor(ops = []) { this.ops = Object.freeze(ops.slice()); }

  // Every builder returns a NEW pipeline — the pipeline is a value, never mutated.
  _with(op) { return new TransformPipeline([...this.ops, op]); }
  crop(width, height)   { return this._with(new Transform('crop', { width, height })); }
  resize(width, height) { return this._with(new Transform('resize', { width, height })); }
  scale(factor)         { return this._with(new Transform('scale', { factor })); }
  rotate(quarterTurns)  { return this._with(new Transform('rotate', { quarterTurns })); }
  flipH()               { return this._with(new Transform('flipH')); }
  flipV()               { return this._with(new Transform('flipV')); }

  isEmpty() { return this.ops.length === 0; }

  // Fold the whole pipeline over a starting (w, h), exactly.
  dimensionsFrom(width, height) {
    let dims = { w: Rational.from(width), h: Rational.from(height) };
    for (const op of this.ops) dims = op.applyTo(dims);
    return dims;
  }

  describe() { return this.ops.map((o) => o.describe()); }
}

/* ================================================================== *
 * ImageAsset — the ABSTRACT base. It holds everything true of every
 * image and refuses to be instantiated directly. Subclasses supply
 * only the two things that actually differ: a capability profile and
 * a byte estimate.
 * ================================================================== */

let _idCounter = 0;
function nextId(prefix) { return `${prefix}-${(++_idCounter).toString(36)}`; }

class ImageAsset {
  constructor({ id, title, width, height, createdAt, tags, frames } = {}) {
    if (new.target === ImageAsset) {
      throw new GalleryError('ImageAsset is abstract — construct a JpegImage, PngImage, GifImage or SvgImage');
    }
    if (!(width > 0) || !(height > 0)) {
      throw new GalleryError('an image needs a positive intrinsic width and height');
    }
    this.id = id || nextId('img');
    this.title = title || 'untitled';
    this.width = width;            // intrinsic pixel dimensions
    this.height = height;
    this.createdAt = createdAt ? new Date(createdAt) : new Date(0);
    this.tags = new Set(tags || []);
    this.frames = frames || 1;     // >1 only matters for animated formats
    this.transforms = new TransformPipeline();
  }

  /* --- the two abstract hooks every subclass MUST answer ------------ */

  // { alpha, animation, lossy, vector } — what this FORMAT can represent.
  get capabilities() {
    throw new GalleryError(`${this.constructor.name} must declare capabilities`);
  }
  get format() {
    throw new GalleryError(`${this.constructor.name} must declare a format`);
  }
  // Format-specific size estimate, in bytes, for the given effective pixel dims.
  estimateBytes(/* effWidth, effHeight */) {
    throw new GalleryError(`${this.constructor.name} must implement estimateBytes`);
  }

  /* --- behaviour shared by ALL images, written once, here ---------- */

  get isAnimated() { return this.capabilities.animation && this.frames > 1; }

  // Effective dimensions after the transform pipeline, as rounded pixels.
  get effectiveWidth()  { return this.transforms.dimensionsFrom(this.width, this.height).w.toInteger(); }
  get effectiveHeight() { return this.transforms.dimensionsFrom(this.width, this.height).h.toInteger(); }
  get dimensions() { return { width: this.effectiveWidth, height: this.effectiveHeight }; }
  get megapixels() { return (this.effectiveWidth * this.effectiveHeight) / 1e6; }
  get aspectRatio() { return this.effectiveWidth / this.effectiveHeight; }

  estimatedBytes() { return this.estimateBytes(this.effectiveWidth, this.effectiveHeight); }

  tag(...names) { for (const n of names) this.tags.add(String(n).toLowerCase()); return this; }
  untag(...names) { for (const n of names) this.tags.delete(String(n).toLowerCase()); return this; }
  hasTag(name) { return this.tags.has(String(name).toLowerCase()); }

  // Return a COPY with an extra transform — the original is left untouched,
  // which is what makes a gallery of shared assets safe to transform per-view.
  withTransform(fn) {
    const copy = this.clone();
    copy.transforms = fn(copy.transforms);
    if (!(copy.transforms instanceof TransformPipeline)) {
      throw new GalleryError('a transform builder must return a TransformPipeline');
    }
    // Force a dimension fold now so an illegal crop throws here, not later.
    copy.transforms.dimensionsFrom(copy.width, copy.height);
    return copy;
  }

  clone() {
    const copy = new this.constructor(this._ctorArgs());
    copy.id = this.id;
    copy.tags = new Set(this.tags);
    copy.transforms = this.transforms;
    return copy;
  }

  _ctorArgs() {
    return {
      id: this.id, title: this.title, width: this.width, height: this.height,
      createdAt: this.createdAt, tags: [...this.tags], frames: this.frames,
    };
  }

  /* --- conversion: honest about what a target format cannot keep ---- */

  // Returns { image, losses: [strings] }. `losses` is empty iff the target
  // format can represent everything this image actually uses.
  convertTo(FormatClass, { background = '#ffffff' } = {}) {
    if (typeof FormatClass !== 'function' || !(FormatClass.prototype instanceof ImageAsset)) {
      throw new GalleryError('convertTo needs an ImageAsset subclass');
    }
    const from = this.capabilities;
    const probe = Object.create(FormatClass.prototype);
    const to = probe.capabilities;
    const losses = [];

    if (from.alpha && !to.alpha) {
      losses.push(`alpha channel flattened against ${background}`);
    }
    if (this.isAnimated && !to.animation) {
      losses.push(`animation (${this.frames} frames) reduced to the first frame`);
    }
    if (from.vector && !to.vector) {
      losses.push(`vector art rasterized at ${this.effectiveWidth}x${this.effectiveHeight}`);
    }
    if (!from.lossy && to.lossy) {
      losses.push('re-encoded with lossy compression (generation loss)');
    }

    const image = new FormatClass({
      ...this._ctorArgs(),
      id: nextId('img'),
      title: this.title,
      frames: to.animation ? this.frames : 1,
    });
    image.tags = new Set(this.tags);
    image.transforms = this.transforms;
    return { image, losses };
  }

  describe() {
    const d = this.dimensions;
    const anim = this.isAnimated ? `, ${this.frames} frames` : '';
    return `${this.title} [${this.format.toUpperCase()}] ${d.width}x${d.height}${anim}`;
  }

  toJSON() {
    return {
      id: this.id, title: this.title, format: this.format,
      intrinsic: { width: this.width, height: this.height },
      effective: this.dimensions,
      frames: this.frames,
      tags: [...this.tags].sort(),
      createdAt: this.createdAt.toISOString(),
      transforms: this.transforms.describe(),
      estimatedBytes: this.estimatedBytes(),
    };
  }
}

/* ================================================================== *
 * Concrete formats. Each one is tiny — that is the whole point. The
 * byte model is a deliberate simplification (we are not re-encoding
 * real pixels), but it ranks formats the way the real world does:
 * JPEG small and lossy, PNG larger and lossless, GIF paletted, SVG
 * resolution-independent.
 * ================================================================== */

class JpegImage extends ImageAsset {
  get format() { return 'jpeg'; }
  get capabilities() { return { alpha: false, animation: false, lossy: true, vector: false }; }
  // ~ quality-dependent; a decent photo lands near 0.25 bytes/pixel.
  estimateBytes(w, h) { return Math.round(w * h * 0.25) + 512; }
}

class PngImage extends ImageAsset {
  get format() { return 'png'; }
  get capabilities() { return { alpha: true, animation: false, lossy: false, vector: false }; }
  // Lossless RGBA, modestly compressed: ~1.5 bytes/pixel.
  estimateBytes(w, h) { return Math.round(w * h * 1.5) + 1024; }
}

class GifImage extends ImageAsset {
  get format() { return 'gif'; }
  get capabilities() { return { alpha: true, animation: true, lossy: false, vector: false }; }
  // Paletted (<=256 colours): ~1 byte/pixel, times the frame count.
  estimateBytes(w, h) { return Math.round(w * h * 1.0 * this.frames) + 800; }
}

class SvgImage extends ImageAsset {
  constructor(args = {}) {
    super(args);
    // Vector size is the markup length, not the pixel count.
    this.sourceLength = args.sourceLength || 2048;
  }
  get format() { return 'svg'; }
  get capabilities() { return { alpha: true, animation: true, lossy: false, vector: true }; }
  // Resolution-independent: the byte cost does NOT grow with the pixel box.
  estimateBytes(/* w, h */) { return this.sourceLength; }
  _ctorArgs() { return { ...super._ctorArgs(), sourceLength: this.sourceLength }; }
}

const FORMATS = { jpeg: JpegImage, png: PngImage, gif: GifImage, svg: SvgImage };

function makeImage(format, args) {
  const Cls = FORMATS[String(format).toLowerCase()];
  if (!Cls) throw new GalleryError(`unknown format: ${format}`);
  return new Cls(args);
}

/* ================================================================== *
 * Gallery — holds images (the single source of truth) and keeps
 * derived indexes (by tag, by format) rebuilt in lock-step. Albums are
 * ordered named lists that reference images by id.
 * ================================================================== */

class Gallery {
  constructor(name = 'Gallery') {
    this.name = name;
    this._images = new Map();          // id -> ImageAsset  (SOURCE OF TRUTH)
    this._albums = new Map();          // album name -> ordered [id]
    this._byTag = new Map();           // tag -> Set(id)    (DERIVED)
    this._byFormat = new Map();        // format -> Set(id) (DERIVED)
  }

  /* --- mutation: every write re-derives the indexes ---------------- */

  add(image) {
    if (!(image instanceof ImageAsset)) throw new GalleryError('can only add an ImageAsset');
    if (this._images.has(image.id)) throw new GalleryError(`duplicate image id: ${image.id}`);
    this._images.set(image.id, image);
    this._reindex();
    return image;
  }

  remove(id) {
    const had = this._images.delete(id);
    if (had) {
      for (const ids of this._albums.values()) {
        const i = ids.indexOf(id);
        if (i !== -1) ids.splice(i, 1);
      }
      this._reindex();
    }
    return had;
  }

  get(id) { return this._images.get(id) || null; }
  all() { return [...this._images.values()]; }
  get size() { return this._images.size; }

  // Rebuild derived indexes from the images. Cheap, total, and the thing the
  // tests pin: the live indexes must always equal this fresh rebuild.
  _reindex() {
    this._byTag = new Map();
    this._byFormat = new Map();
    for (const img of this._images.values()) {
      for (const tag of img.tags) {
        if (!this._byTag.has(tag)) this._byTag.set(tag, new Set());
        this._byTag.get(tag).add(img.id);
      }
      if (!this._byFormat.has(img.format)) this._byFormat.set(img.format, new Set());
      this._byFormat.get(img.format).add(img.id);
    }
  }

  // Tag/untag go THROUGH the gallery so the index can never fall behind the
  // images. (Tagging an image object directly then calling reindex also works,
  // but this is the safe door.)
  tagImage(id, ...tags) {
    const img = this.get(id);
    if (!img) throw new GalleryError(`no image ${id}`);
    img.tag(...tags);
    this._reindex();
    return img;
  }
  untagImage(id, ...tags) {
    const img = this.get(id);
    if (!img) throw new GalleryError(`no image ${id}`);
    img.untag(...tags);
    this._reindex();
    return img;
  }

  /* --- albums: ordered, de-duplicated references by id ------------- */

  createAlbum(name) {
    if (this._albums.has(name)) throw new GalleryError(`album already exists: ${name}`);
    this._albums.set(name, []);
    return name;
  }
  addToAlbum(name, id) {
    if (!this._albums.has(name)) this.createAlbum(name);
    if (!this._images.has(id)) throw new GalleryError(`no image ${id}`);
    const ids = this._albums.get(name);
    if (!ids.includes(id)) ids.push(id);
    return this;
  }
  album(name) {
    const ids = this._albums.get(name);
    if (!ids) return [];
    return ids.map((id) => this._images.get(id)).filter(Boolean);
  }
  albumNames() { return [...this._albums.keys()]; }

  /* --- read: all served off the derived indexes -------------------- */

  tags() { return [...this._byTag.keys()].sort(); }
  formats() { return [...this._byFormat.keys()].sort(); }

  byTag(tag) {
    const ids = this._byTag.get(String(tag).toLowerCase());
    return ids ? [...ids].map((id) => this._images.get(id)) : [];
  }
  byFormat(format) {
    const ids = this._byFormat.get(String(format).toLowerCase());
    return ids ? [...ids].map((id) => this._images.get(id)) : [];
  }

  // AND across tags, optional format, optional title substring — served by
  // intersecting index hits, not by scanning every image.
  search({ tags = [], format = null, text = null } = {}) {
    let ids = null;
    for (const tag of tags) {
      const hit = this._byTag.get(String(tag).toLowerCase()) || new Set();
      ids = ids === null ? new Set(hit) : new Set([...ids].filter((x) => hit.has(x)));
    }
    if (format) {
      const hit = this._byFormat.get(String(format).toLowerCase()) || new Set();
      ids = ids === null ? new Set(hit) : new Set([...ids].filter((x) => hit.has(x)));
    }
    let result = ids === null ? this.all() : [...ids].map((id) => this._images.get(id));
    if (text) {
      const needle = String(text).toLowerCase();
      result = result.filter((img) => img.title.toLowerCase().includes(needle));
    }
    return result.sort((a, b) => a.title.localeCompare(b.title));
  }

  // Polymorphic sort keys — none of them switch on format.
  sortedBy(key = 'title') {
    const keys = {
      title: (a, b) => a.title.localeCompare(b.title),
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      largest: (a, b) => b.megapixels - a.megapixels,
      heaviest: (a, b) => b.estimatedBytes() - a.estimatedBytes(),
    };
    if (!keys[key]) throw new GalleryError(`unknown sort key: ${key}`);
    return this.all().sort(keys[key]);
  }

  totalBytes() { return this.all().reduce((sum, img) => sum + img.estimatedBytes(), 0); }

  stats() {
    const byFormat = {};
    for (const [fmt, ids] of this._byFormat) byFormat[fmt] = ids.size;
    return {
      name: this.name,
      count: this.size,
      byFormat,
      tags: this.tags().length,
      albums: this.albumNames().length,
      totalBytes: this.totalBytes(),
    };
  }

  toJSON() {
    return {
      name: this.name,
      images: this.all().map((i) => i.toJSON()),
      albums: Object.fromEntries([...this._albums]),
    };
  }
}

/* ================================================================== */

const coreApi = {
  GalleryError, Rational, Transform, TransformPipeline,
  ImageAsset, JpegImage, PngImage, GifImage, SvgImage,
  FORMATS, makeImage, Gallery,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.ImageGallery = coreApi;
