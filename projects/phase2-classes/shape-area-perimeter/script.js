/*
 * script.js — the browser front end. It does NO geometry of its own: every
 * area, perimeter, exactness verdict and total comes from the same classes in
 * shape-core.js that the CLI and the tests use. This file only reads the DOM,
 * calls the objects, and paints — including a small SVG sketch per shape whose
 * proportions follow the shape's real dimensions (the picture is decorative,
 * the numbers are the engine's).
 */
'use strict';

(function () {
const core = window.ShapeCore;
const { SHAPE_REGISTRY, makeShape, ShapeError, ShapeCollection } = core;

const $ = (id) => document.getElementById(id);
const collection = new ShapeCollection();

/* ---- controls: build the shape picker + its argument fields -------- */

function buildPicker() {
  const sel = $('shapeKind');
  for (const name of Object.keys(SHAPE_REGISTRY)) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  }
  sel.addEventListener('change', buildArgFields);
  buildArgFields();
}

function buildArgFields() {
  const kind = $('shapeKind').value;
  const { args } = SHAPE_REGISTRY[kind];
  const defaults = {
    radius: 7, width: 8, height: 3, side: 6, legA: 3, legB: 4,
    a: 13, b: 14, c: 15, diagonalP: 6, diagonalQ: 8, sides: 5,
    sideLength: 4, semiMajor: 5, semiMinor: 3,
  };
  const box = $('argFields');
  box.innerHTML = '';
  for (const name of args) {
    const lab = document.createElement('label');
    lab.textContent = name;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.dataset.arg = name;
    inp.value = defaults[name] != null ? defaults[name] : '';
    lab.appendChild(inp);
    box.appendChild(lab);
  }
}

function readArgs() {
  return [...$('argFields').querySelectorAll('input')].map((i) => i.value.trim());
}

/* ---- decorative SVG sketch, proportioned from the shape ------------ */

function sketch(shape) {
  const W = 72, H = 56, pad = 7;
  const d = shape.dims;
  const num = (r) => r.toNumber();
  const stroke = '#6ea8fe', fill = 'rgba(110,168,254,0.16)';
  const wrap = (body) => `<svg class="sketch" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${body}</svg>`;

  // fit a box of logical w×h into the drawable area, centered
  function fit(w, h) {
    const availW = W - 2 * pad, availH = H - 2 * pad;
    const s = Math.min(availW / w, availH / h);
    const dw = w * s, dh = h * s;
    return { s, x: (W - dw) / 2, y: (H - dh) / 2, dw, dh };
  }

  switch (shape.kind) {
    case 'Circle': {
      const r = Math.min(W, H) / 2 - pad;
      return wrap(`<circle cx="${W / 2}" cy="${H / 2}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
    }
    case 'Ellipse': {
      const f = fit(num(d.semiMajor) * 2, num(d.semiMinor) * 2);
      return wrap(`<ellipse cx="${W / 2}" cy="${H / 2}" rx="${f.dw / 2}" ry="${f.dh / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
    }
    case 'Rectangle': case 'Square': {
      const f = fit(num(d.width), num(d.height));
      return wrap(`<rect x="${f.x}" y="${f.y}" width="${f.dw}" height="${f.dh}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
    }
    case 'RightTriangle': {
      const f = fit(num(d.legA), num(d.legB));
      const x0 = f.x, y1 = f.y + f.dh;
      return wrap(`<polygon points="${x0},${y1} ${x0 + f.dw},${y1} ${x0},${f.y}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`);
    }
    case 'EquilateralTriangle': {
      const f = fit(2, Math.sqrt(3));
      const x0 = f.x, y1 = f.y + f.dh;
      return wrap(`<polygon points="${x0},${y1} ${x0 + f.dw},${y1} ${x0 + f.dw / 2},${f.y}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`);
    }
    case 'Triangle': {
      // place by law of cosines so the sketch really reflects a,b,c
      const a = num(d.a), b = num(d.b), c = num(d.c);
      const Ax = 0, Ay = 0, Bx = c, By = 0;
      const cosA = (b * b + c * c - a * a) / (2 * b * c);
      const Cx = b * Math.max(-1, Math.min(1, cosA));
      const Cy = -b * Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const xs = [Ax, Bx, Cx], ys = [Ay, By, Cy];
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const f = fit(maxX - minX || 1, maxY - minY || 1);
      const px = (x) => f.x + (x - minX) * f.s, py = (y) => f.y + (y - minY) * f.s;
      return wrap(`<polygon points="${px(Ax)},${py(Ay)} ${px(Bx)},${py(By)} ${px(Cx)},${py(Cy)}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`);
    }
    case 'Rhombus': {
      const f = fit(num(d.diagonalP), num(d.diagonalQ));
      const cx = W / 2, cy = H / 2;
      return wrap(`<polygon points="${cx - f.dw / 2},${cy} ${cx},${cy - f.dh / 2} ${cx + f.dw / 2},${cy} ${cx},${cy + f.dh / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`);
    }
    case 'RegularPolygon': {
      const n = shape.sides, r = Math.min(W, H) / 2 - pad;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
        pts.push(`${(W / 2 + r * Math.cos(ang)).toFixed(1)},${(H / 2 + r * Math.sin(ang)).toFixed(1)}`);
      }
      return wrap(`<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`);
    }
    default:
      return wrap('');
  }
}

/* ---- quantity rendering -------------------------------------------- */

function qCell(q) {
  if (q.exact) {
    return `<span class="mono exact-val">${escapeHtml(q.toString())}</span>` +
      (/^[-\d/]+$/.test(q.toString()) ? '' : ` <span class="approx mono">≈ ${q.toNumber().toFixed(4)}</span>`);
  }
  return `<span class="mono approx">≈ ${q.toNumber().toFixed(4)}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function exactBadge(ok) {
  return ok
    ? '<span class="badge exact">exact</span>'
    : '<span class="badge inexact">approx</span>';
}

/* ---- single compute ------------------------------------------------ */

function doCompute() {
  const out = $('computeOut');
  let shape;
  try {
    shape = makeShape($('shapeKind').value, readArgs());
  } catch (e) {
    if (e instanceof ShapeError) { out.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`; return null; }
    throw e;
  }
  out.innerHTML = `
    <div class="card">
      ${sketch(shape)}
      <div class="meta">
        <h3>${escapeHtml(shape.describe())}</h3>
        <div>area &nbsp;= ${qCell(shape.area())}</div>
        <div>perimeter = ${qCell(shape.perimeter())}</div>
        <div style="margin-top:6px">${exactBadge(shape.isExact())}</div>
      </div>
    </div>`;
  return shape;
}

/* ---- the collection table + tiles ---------------------------------- */

function renderTable() {
  const rows = $('shapeRows');
  rows.innerHTML = '';
  const empty = collection.size === 0;
  $('emptyNote').hidden = !empty;
  $('shapeTable').style.display = empty ? 'none' : '';

  collection.shapes.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.describe())}</td>
      <td>${sketch(s)}</td>
      <td class="mono">${qCell(s.area())}</td>
      <td class="mono">${qCell(s.perimeter())}</td>
      <td>${exactBadge(s.isExact())}</td>`;
    rows.appendChild(tr);
  });

  const foot = $('shapeFoot');
  if (empty) { foot.innerHTML = ''; }
  else {
    const ta = collection.totalArea(), tp = collection.totalPerimeter();
    foot.innerHTML = `<tr>
      <td>Total (${collection.size})</td><td></td>
      <td class="mono">${qCell(ta)}</td>
      <td class="mono">${qCell(tp)}</td>
      <td>${exactBadge(ta.exact && tp.exact)}</td></tr>`;
  }
  renderTiles();
}

function renderTiles() {
  const largest = collection.largestByArea();
  const tiles = [
    { num: collection.size, lbl: 'shapes' },
    { num: collection.exactOnes().length, lbl: 'exact figures' },
    { num: collection.approximateOnes().length, lbl: 'approximated' },
    { num: largest ? largest.kind : '—', lbl: 'largest by area' },
  ];
  $('tiles').innerHTML = tiles.map((t) =>
    `<div class="tile"><div class="num">${escapeHtml(String(t.num))}</div><div class="lbl">${t.lbl}</div></div>`).join('');
}

/* ---- wire up ------------------------------------------------------- */

function loadSample() {
  collection.shapes.length = 0;
  for (const s of window.ShapeFixtures.sampleCollection().shapes) collection.add(s);
  renderTable();
}

buildPicker();
$('computeBtn').addEventListener('click', doCompute);
$('addBtn').addEventListener('click', () => { const s = doCompute(); if (s) { collection.add(s); renderTable(); } });
$('sampleBtn').addEventListener('click', loadSample);
$('clearBtn').addEventListener('click', () => { collection.shapes.length = 0; renderTable(); });

doCompute();
loadSample();
})();
