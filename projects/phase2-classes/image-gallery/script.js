/*
 * script.js — the browser front end. It does NO gallery logic of its own:
 * every dimension, index lookup, sort, transform and conversion verdict comes
 * from the same classes in gallery-core.js that the CLI and the tests use.
 * This file only reads the DOM, calls the engine, and paints the result.
 *
 * There are no real image files in the repo, so each asset is drawn as a
 * generated SVG placeholder whose aspect ratio and orientation track the
 * engine's EFFECTIVE dimensions — the picture is decorative, the geometry is real.
 */
'use strict';

(function () {
const core = window.ImageGallery;
const { FORMATS, GalleryError } = core;

let gallery = window.GalleryFixtures.buildGallery(core);
let selectedId = null;

/* ---- deterministic placeholder art --------------------------------- */
// A stable hue per image id, so a given image always looks the same.
function hueFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function placeholderSVG(img, { inPreview = false } = {}) {
  const h = hueFor(img.id);
  const d = img.dimensions;
  // viewBox follows the effective aspect ratio so crops/rotations read visually.
  const vw = 200, vh = Math.max(40, Math.round(200 * (d.height / d.width)));
  const cap = img.capabilities;
  const checker = cap.alpha
    ? `<defs><pattern id="ck-${img.id}" width="16" height="16" patternUnits="userSpaceOnUse">
         <rect width="16" height="16" fill="#1b2230"/>
         <rect width="8" height="8" fill="#232c3d"/><rect x="8" y="8" width="8" height="8" fill="#232c3d"/>
       </pattern></defs><rect width="100%" height="100%" fill="url(#ck-${img.id})"/>`
    : '';
  const grad = `<defs><linearGradient id="g-${img.id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h} 70% 55%)"/>
      <stop offset="1" stop-color="hsl(${(h + 60) % 360} 70% 40%)"/>
    </linearGradient></defs>`;
  const shape = cap.vector
    ? `<circle cx="${vw / 2}" cy="${vh / 2}" r="${Math.min(vw, vh) * 0.3}" fill="url(#g-${img.id})"/>
       <rect x="12" y="12" width="${vw - 24}" height="${vh - 24}" fill="none" stroke="hsl(${h} 70% 60%)" stroke-dasharray="6 5" stroke-width="2"/>`
    : `<rect x="8" y="8" width="${vw - 16}" height="${vh - 16}" rx="6" fill="url(#g-${img.id})" ${cap.alpha ? 'opacity="0.9"' : ''}/>`;
  const label = inPreview
    ? `<text x="${vw / 2}" y="${vh / 2}" fill="#0a0e17" font-size="13" font-family="monospace" text-anchor="middle" dominant-baseline="middle">${img.format.toUpperCase()} ${d.width}×${d.height}</text>`
    : '';
  return `<svg viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    ${checker}${grad}${shape}${label}</svg>`;
}

// CSS transform so rotate/flip are visible without re-rasterizing anything.
function cssTransformFor(img) {
  let deg = 0, sx = 1, sy = 1;
  for (const op of img.transforms.ops) {
    if (op.kind === 'rotate') deg += (((op.args.quarterTurns % 4) + 4) % 4) * 90;
    if (op.kind === 'flipH') sx *= -1;
    if (op.kind === 'flipV') sy *= -1;
  }
  return `rotate(${deg}deg) scale(${sx}, ${sy})`;
}

/* ---- tiles --------------------------------------------------------- */
function renderTiles() {
  const s = gallery.stats();
  const fmt = Object.entries(s.byFormat).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(' · ') || '—';
  const tiles = [
    { num: s.count, lbl: 'images' },
    { num: s.tags, lbl: 'tags in use' },
    { num: s.albums, lbl: 'albums' },
    { num: fmtBytes(s.totalBytes), lbl: 'est. total size' },
    { num: fmt, lbl: 'by format', wide: true },
  ];
  document.getElementById('tiles').innerHTML = tiles.map((t) =>
    `<div class="tile"><div class="num" style="${t.wide ? 'font-size:16px' : ''}">${t.num}</div><div class="lbl">${t.lbl}</div></div>`
  ).join('');
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---- filters ------------------------------------------------------- */
function refillFilters() {
  const tagSel = document.getElementById('tagFilter');
  const fmtSel = document.getElementById('formatFilter');
  const albSel = document.getElementById('albumFilter');
  const keep = (sel) => sel.value;
  const tv = keep(tagSel), fv = keep(fmtSel), av = keep(albSel);
  tagSel.innerHTML = '<option value="">— all tags —</option>' +
    gallery.tags().map((t) => `<option ${t === tv ? 'selected' : ''}>${t}</option>`).join('');
  fmtSel.innerHTML = '<option value="">— all formats —</option>' +
    gallery.formats().map((f) => `<option ${f === fv ? 'selected' : ''}>${f}</option>`).join('');
  albSel.innerHTML = '<option value="">— whole gallery —</option>' +
    gallery.albumNames().map((a) => `<option ${a === av ? 'selected' : ''}>${a}</option>`).join('');
}

/* ---- grid ---------------------------------------------------------- */
function currentList() {
  const album = document.getElementById('albumFilter').value;
  const tag = document.getElementById('tagFilter').value;
  const format = document.getElementById('formatFilter').value;
  const text = document.getElementById('search').value.trim();
  const sortKey = document.getElementById('sortKey').value;

  let list = album ? gallery.album(album) : gallery.all();
  // Narrow the (possibly album-scoped) list with the engine's own predicates.
  if (tag) list = list.filter((i) => i.hasTag(tag));
  if (format) list = list.filter((i) => i.format === format);
  if (text) list = list.filter((i) => i.title.toLowerCase().includes(text.toLowerCase()));

  const cmp = {
    title: (a, b) => a.title.localeCompare(b.title),
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    largest: (a, b) => b.megapixels - a.megapixels,
    heaviest: (a, b) => b.estimatedBytes() - a.estimatedBytes(),
  }[sortKey];
  return list.sort(cmp);
}

function renderGrid() {
  const grid = document.getElementById('grid');
  const list = currentList();
  if (list.length === 0) { grid.innerHTML = '<div class="empty">No images match these filters.</div>'; return; }
  grid.innerHTML = list.map((img) => {
    const d = img.dimensions;
    const badge = img.isAnimated ? `<span class="badge anim">${img.frames}f ◷</span>` : '';
    const tags = [...img.tags].sort().map((t) => `<span class="chip">${t}</span>`).join('');
    return `<div class="card ${img.id === selectedId ? 'selected' : ''}" data-id="${img.id}">
      <div class="thumb"><span class="badge">${img.format.toUpperCase()}</span>${badge}
        <div style="width:100%;height:100%;transform:${cssTransformFor(img)}">${placeholderSVG(img)}</div></div>
      <div class="card-body">
        <p class="card-title">${img.title}</p>
        <p class="card-meta">${d.width} × ${d.height} · ${fmtBytes(img.estimatedBytes())}</p>
        <div class="tagrow">${tags}</div>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.card').forEach((el) =>
    el.addEventListener('click', () => select(el.dataset.id)));
}

/* ---- detail -------------------------------------------------------- */
function select(id) {
  selectedId = id;
  renderGrid();
  renderDetail();
}

function renderDetail() {
  const panel = document.getElementById('detailPanel');
  const img = gallery.get(selectedId);
  if (!img) { panel.hidden = true; return; }
  panel.hidden = false;
  document.getElementById('detailTitle').textContent = img.title;

  const prev = document.getElementById('preview');
  prev.innerHTML = `<div style="transform:${cssTransformFor(img)};max-width:100%">${placeholderSVG(img, { inPreview: true })}</div>`;

  const d = img.dimensions;
  const cap = img.capabilities;
  const caps = Object.entries(cap).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none';
  document.getElementById('detailMeta').innerHTML = `
    <dt>id</dt><dd>${img.id}</dd>
    <dt>format</dt><dd>${img.format.toUpperCase()}</dd>
    <dt>intrinsic</dt><dd>${img.width} × ${img.height}</dd>
    <dt>effective</dt><dd>${d.width} × ${d.height}</dd>
    <dt>megapixels</dt><dd>${img.megapixels.toFixed(2)}</dd>
    <dt>frames</dt><dd>${img.frames}${img.isAnimated ? ' (animated)' : ''}</dd>
    <dt>can hold</dt><dd>${caps}</dd>
    <dt>est. size</dt><dd>${fmtBytes(img.estimatedBytes())}</dd>
    <dt>tags</dt><dd>${[...img.tags].sort().join(', ') || '—'}</dd>`;

  const trail = img.transforms.describe();
  document.getElementById('xformTrail').textContent =
    trail.length ? `pipeline: ${trail.join(' → ')}` : 'no transforms applied';
  document.getElementById('convertResult').innerHTML = '';
}

/* ---- transforms: replace the asset in the gallery with a transformed copy */
function applyTransform(kind, arg) {
  const img = gallery.get(selectedId);
  if (!img) return;
  try {
    let next;
    if (kind === 'reset') {
      next = img.clone();
      next.transforms = new core.TransformPipeline();
    } else if (kind === 'crop') {
      const d = img.dimensions;
      next = img.withTransform((t) => t.crop(Math.round(d.width / 2), Math.round(d.height / 2)));
    } else if (kind === 'scale') {
      next = img.withTransform((t) => t.scale(arg));
    } else if (kind === 'rotate') {
      next = img.withTransform((t) => t.rotate(Number(arg)));
    } else if (kind === 'fliph') {
      next = img.withTransform((t) => t.flipH());
    } else if (kind === 'flipv') {
      next = img.withTransform((t) => t.flipV());
    }
    gallery.remove(img.id);
    gallery.add(next);
    selectedId = next.id;
    refresh();
  } catch (e) {
    if (e instanceof GalleryError) flashConvert(`<div class="line loss">⚠ ${e.message}</div>`);
    else throw e;
  }
}

function doConvert(fmt) {
  const img = gallery.get(selectedId);
  if (!img) return;
  const { image, losses } = img.convertTo(FORMATS[fmt]);
  const head = `<div class="line"><strong>${img.describe()}</strong> → <strong>${image.describe()}</strong></div>`;
  const body = losses.length
    ? losses.map((l) => `<div class="line loss">⚠ ${l}</div>`).join('')
    : '<div class="line clean">✓ lossless — the target keeps everything this image uses</div>';
  flashConvert(head + body);
}
function flashConvert(html) { document.getElementById('convertResult').innerHTML = html; }

/* ---- wire up ------------------------------------------------------- */
function refresh() { renderTiles(); refillFilters(); renderGrid(); renderDetail(); }

['tagFilter', 'formatFilter', 'albumFilter', 'sortKey'].forEach((id) =>
  document.getElementById(id).addEventListener('change', renderGrid));
document.getElementById('search').addEventListener('input', renderGrid);
document.getElementById('closeDetail').addEventListener('click', () => { selectedId = null; renderGrid(); renderDetail(); });

document.querySelectorAll('[data-x]').forEach((btn) =>
  btn.addEventListener('click', () => applyTransform(btn.dataset.x, btn.dataset.arg)));
document.querySelectorAll('[data-convert]').forEach((btn) =>
  btn.addEventListener('click', () => doConvert(btn.dataset.convert)));

refresh();
})();
