/*
 * script.js — the thin browser layer over distance-core.js.
 *
 * All the geometry lives in the core; this file only reads the two inputs
 * (a gazetteer city name, "City, Country", or a raw "lat, lon" coordinate),
 * calls the core, prints the distance / bearing / midpoint, and draws the two
 * points and the great-circle path on a simple equirectangular SVG.
 */

'use strict';

(function () {
  var C = window.DistanceCore;

  var fromEl = document.getElementById('from');
  var toEl = document.getElementById('to');
  var unitEl = document.getElementById('unit');
  var methodEl = document.getElementById('method');
  var resultEl = document.getElementById('result');
  var detailEl = document.getElementById('detail');
  var errorEl = document.getElementById('error');
  var swapEl = document.getElementById('swap');
  var datalist = document.getElementById('cities');
  var examplesEl = document.getElementById('examples');
  var mapEl = document.getElementById('map');

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MAP_W = 720, MAP_H = 360;

  /* Populate the city autocomplete. */
  C.cityNames().forEach(function (n) {
    var opt = document.createElement('option');
    opt.value = n;
    datalist.appendChild(opt);
  });

  /*
   * Resolve one input to { lat, lon, label }. First try the gazetteer, then
   * fall back to parsing a raw coordinate. Throws with a clear message if
   * neither works.
   */
  function resolve(text, which) {
    var raw = (text || '').trim();
    if (!raw) throw new Error('Enter a ' + which + ' city or coordinate.');
    var city = C.lookupCity(raw);
    if (city) return { lat: city.lat, lon: city.lon, label: city.name + ', ' + city.country };
    // Looks like a coordinate? Let the core parse it (and report its own error).
    if (/[\d]/.test(raw) && /[,\s]/.test(raw)) {
      var p = C.parseCoordinate(raw);
      return { lat: p.lat, lon: p.lon, label: C.formatDecimal(p.lat, p.lon, 4) };
    }
    throw new Error('Unknown city "' + raw + '". Try one from the list, or type "lat, lon".');
  }

  function fmtNumber(n) {
    // Group thousands, keep up to 2 decimals, drop trailing zeros.
    var s = n.toFixed(2).replace(/\.?0+$/, '');
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function compute() {
    errorEl.hidden = true;
    var a, b;
    try {
      a = resolve(fromEl.value, 'from');
      b = resolve(toEl.value, 'to');
    } catch (e) {
      resultEl.textContent = '—';
      detailEl.textContent = '';
      clearMap();
      errorEl.textContent = e.message;
      errorEl.hidden = false;
      return;
    }

    var unit = unitEl.value;
    var method = methodEl.value;
    var km;
    try {
      km = C.distance(a.lat, a.lon, b.lat, b.lon, method);
    } catch (e) {
      // Vincenty can refuse near-antipodal points; explain and fall back.
      km = C.haversine(a.lat, a.lon, b.lat, b.lon);
      errorEl.textContent = e.message + ' — showing the haversine (sphere) result instead.';
      errorEl.hidden = false;
    }

    var value = C.convert(km, unit);
    var bearing = C.initialBearing(a.lat, a.lon, b.lat, b.lon);
    var compass = C.compassPoint(bearing);
    var unitShort = unit;

    resultEl.innerHTML = fmtNumber(value) + ' <span class="unit">' + unitShort + '</span>';

    var otherUnit = unit === 'km' ? 'mi' : 'km';
    detailEl.innerHTML =
      '<strong>' + a.label + '</strong> → <strong>' + b.label + '</strong>' +
      '<span class="sep">·</span>' +
      'also ' + fmtNumber(C.convert(km, otherUnit)) + ' ' + otherUnit +
      '<span class="sep">·</span>' +
      'bearing ' + bearing.toFixed(1) + '° (' + compass + ')' +
      '<span class="sep">·</span>' +
      'midpoint ' + midpointLabel(a, b);

    drawMap(a, b);
  }

  function midpointLabel(a, b) {
    var m = C.midpoint(a.lat, a.lon, b.lat, b.lon);
    return C.formatDMS(m.lat, m.lon);
  }

  /* ---------- the map --------------------------------------------------- */

  function project(lat, lon) {
    return {
      x: (lon + 180) / 360 * MAP_W,
      y: (90 - lat) / 180 * MAP_H
    };
  }

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    return node;
  }

  function clearMap() { while (mapEl.firstChild) mapEl.removeChild(mapEl.firstChild); }

  function drawGrid() {
    // Latitude/longitude graticule.
    for (var lon = -180; lon <= 180; lon += 30) {
      var p = project(0, lon);
      mapEl.appendChild(el('line', { x1: p.x, y1: 0, x2: p.x, y2: MAP_H, stroke: '#1c2340', 'stroke-width': 1 }));
    }
    for (var lat = -60; lat <= 60; lat += 30) {
      var q = project(lat, 0);
      mapEl.appendChild(el('line', { x1: 0, y1: q.y, x2: MAP_W, y2: q.y, stroke: '#1c2340', 'stroke-width': 1 }));
    }
    // Equator and prime meridian, a touch brighter.
    var eq = project(0, 0);
    mapEl.appendChild(el('line', { x1: 0, y1: eq.y, x2: MAP_W, y2: eq.y, stroke: '#2a3050', 'stroke-width': 1 }));
    mapEl.appendChild(el('line', { x1: eq.x, y1: 0, x2: eq.x, y2: MAP_H, stroke: '#2a3050', 'stroke-width': 1 }));
  }

  function drawMap(a, b) {
    clearMap();
    drawGrid();

    // Sample the great-circle path and draw it as a polyline, splitting when it
    // wraps across the antimeridian so it doesn't streak across the whole map.
    var total = C.haversine(a.lat, a.lon, b.lat, b.lon);
    var bearing = C.initialBearing(a.lat, a.lon, b.lat, b.lon);
    var steps = 96;
    var segs = [[]], prevX = null;
    for (var i = 0; i <= steps; i++) {
      var d = total * i / steps;
      var pt = d === 0 ? { lat: a.lat, lon: a.lon } : C.destinationPoint(a.lat, a.lon, bearing, d);
      var xy = project(pt.lat, pt.lon);
      if (prevX !== null && Math.abs(xy.x - prevX) > MAP_W / 2) segs.push([]); // wrapped
      segs[segs.length - 1].push(xy.x.toFixed(1) + ',' + xy.y.toFixed(1));
      prevX = xy.x;
    }
    segs.forEach(function (pts) {
      if (pts.length < 2) return;
      mapEl.appendChild(el('polyline', {
        points: pts.join(' '), fill: 'none', stroke: '#6ea8fe', 'stroke-width': 2, 'stroke-linecap': 'round'
      }));
    });

    // The two endpoints.
    plot(a, '#8ee6c8', a.label);
    plot(b, '#ff9e6e', b.label);
  }

  function plot(pt, color, label) {
    var xy = project(pt.lat, pt.lon);
    mapEl.appendChild(el('circle', { cx: xy.x, cy: xy.y, r: 5, fill: color, stroke: '#0b0e1c', 'stroke-width': 1.5 }));
    var t = el('text', {
      x: xy.x + (xy.x > MAP_W - 90 ? -8 : 8),
      y: xy.y - 8,
      fill: color, 'font-size': 12,
      'text-anchor': xy.x > MAP_W - 90 ? 'end' : 'start',
      'font-family': 'ui-monospace, Menlo, Consolas, monospace'
    });
    t.textContent = label;
    mapEl.appendChild(t);
  }

  /* ---------- examples & wiring ---------------------------------------- */

  var EXAMPLES = [
    ['New York', 'London'],
    ['Paris', 'Tokyo'],
    ['Sydney', 'Los Angeles'],
    ['Cairo', 'Cape Town'],
    ['Singapore', 'San Francisco'],
    ['Moscow', 'Rio de Janeiro']
  ];
  EXAMPLES.forEach(function (pair) {
    var li = document.createElement('li');
    li.textContent = pair[0] + ' → ' + pair[1];
    li.addEventListener('click', function () {
      fromEl.value = pair[0];
      toEl.value = pair[1];
      compute();
    });
    examplesEl.appendChild(li);
  });

  swapEl.addEventListener('click', function () {
    var t = fromEl.value; fromEl.value = toEl.value; toEl.value = t;
    compute();
  });

  [fromEl, toEl].forEach(function (e) { e.addEventListener('input', compute); });
  [unitEl, methodEl].forEach(function (e) { e.addEventListener('change', compute); });

  compute();
})();
