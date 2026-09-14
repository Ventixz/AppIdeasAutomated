/*
 * tests.js — dependency-free suite for distance-core.js. Run with:
 *   node projects/phase2-numbers/distance-between-cities/tests.js
 *
 * The core is pure geometry over coordinate pairs, so the suite can check it
 * without a browser or a network: known great-circle distances (with a
 * tolerance), the exact unit-conversion factors and their round-trips,
 * coordinate parsing in decimal / hemisphere / DMS forms, the offline city
 * gazetteer, bearings and the compass, and a batch of property sweeps —
 * symmetry, the triangle inequality, and the destinationPoint <-> distance
 * inverse relationship.
 */

'use strict';

var core = require('./distance-core.js');

var passed = 0, failed = 0;

function eq(name, got, want) {
  if (got === want) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }
}

function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}

function near(name, got, want, tol) {
  if (typeof got === 'number' && isFinite(got) && Math.abs(got - want) <= tol) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + ' (got ' + got + ', want ' + want + ' +/- ' + tol + ')'); }
}

function throws(name, fn) {
  try { fn(); failed++; console.error('  FAIL: ' + name + ' (expected throw)'); }
  catch (e) { passed++; }
}

/* Well-known coordinates used throughout. */
var NY  = { lat: 40.7128,  lon: -74.0060 };
var LON = { lat: 51.5074,  lon: -0.1278 };
var PAR = { lat: 48.8566,  lon: 2.3522 };
var TOK = { lat: 35.6762,  lon: 139.6503 };
var LA  = { lat: 34.0522,  lon: -118.2437 };
var SYD = { lat: -33.8688, lon: 151.2093 };

function hav(a, b) { return core.haversine(a.lat, a.lon, b.lat, b.lon); }

/* ---------- known great-circle distances (haversine) ------------------ */

near('NY -> London ~5570 km', hav(NY, LON), 5570, 15);
near('Paris -> Tokyo ~9712 km', hav(PAR, TOK), 9712, 20);
near('NY -> LA ~3936 km', hav(NY, LA), 3936, 15);
near('London -> Paris ~344 km', hav(LON, PAR), 344, 5);
near('same point is 0', hav(NY, NY), 0, 1e-9);

/* Cardinal reference distances on the sphere. */
near('1 degree of latitude ~111.19 km', core.haversine(0, 0, 1, 0), 111.19, 0.02);
near('quarter of the equator ~10008 km', core.haversine(0, 0, 0, 90), 10007.6, 1);
near('antipodal ~ pi*R', core.haversine(0, 0, 0, 180), Math.PI * core.R_KM, 1);
near('pole to pole ~ pi*R/... (half meridian)', core.haversine(-90, 0, 90, 0), Math.PI * core.R_KM, 1);

/* ---------- vincenty (ellipsoidal) ------------------------------------ */

near('vincenty same point is 0', core.vincenty(NY.lat, NY.lon, NY.lat, NY.lon), 0, 1e-9);
(function () {
  var v = core.vincenty(NY.lat, NY.lon, LON.lat, LON.lon);
  var h = hav(NY, LON);
  ok('vincenty NY-London converges', v !== null);
  // Ellipsoid vs sphere agree to well under 1%.
  ok('vincenty within 0.6% of haversine', Math.abs(v - h) / h < 0.006);
})();
ok('vincenty returns null for antipodal (non-convergence)', core.vincenty(0, 0, 0, 180) === null);
(function () {
  // distance() in 'auto' mode must still return a number for antipodal points.
  var d = core.distance(0, 0, 0, 180, 'auto');
  near('auto falls back to haversine when vincenty fails', d, Math.PI * core.R_KM, 1);
})();
throws('distance(vincenty) throws on non-convergence', function () {
  core.distance(0, 0, 0, 180, 'vincenty');
});

/* ---------- symmetry -------------------------------------------------- */

(function () {
  var pairs = [[NY, LON], [PAR, TOK], [LA, SYD], [NY, SYD]];
  var allSym = true;
  for (var i = 0; i < pairs.length; i++) {
    var a = pairs[i][0], b = pairs[i][1];
    if (Math.abs(hav(a, b) - hav(b, a)) > 1e-9) allSym = false;
  }
  ok('haversine is symmetric d(a,b)==d(b,a)', allSym);
})();

/* ---------- unit conversion ------------------------------------------- */

eq('convert 0 km', core.convert(0, 'mi'), 0);
near('100 km -> 62.137 mi', core.convert(100, 'mi'), 62.137119, 1e-5);
near('100 km -> 53.996 nmi', core.convert(100, 'nmi'), 53.995680, 1e-5);
near('1 km -> 1000 m', core.convert(1, 'm'), 1000, 1e-9);
near('1 km -> 3280.84 ft', core.convert(1, 'ft'), 3280.8399, 1e-3);
near('1 mile is exactly 1609.344 m', core.convertBetween(1, 'mi', 'm'), 1609.344, 1e-9);
near('1 nautical mile is exactly 1852 m', core.convertBetween(1, 'nmi', 'm'), 1852, 1e-9);
throws('convert unknown unit throws', function () { core.convert(1, 'furlong'); });

// Round-trips: km -> unit -> km returns the original to fp precision.
(function () {
  var units = ['mi', 'nmi', 'm', 'ft', 'yd'];
  var allRt = true;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var back = core.convertBetween(core.convert(1234.5, u), u, 'km');
    if (Math.abs(back - 1234.5) > 1e-9) allRt = false;
  }
  ok('km -> unit -> km round-trips for every unit', allRt);
})();

/* ---------- bearings and compass -------------------------------------- */

near('due north bearing = 0', core.initialBearing(0, 0, 10, 0), 0, 1e-9);
near('due east bearing = 90', core.initialBearing(0, 0, 0, 10), 90, 1e-9);
near('due south bearing = 180', core.initialBearing(10, 0, 0, 0), 180, 1e-9);
near('due west bearing = 270', core.initialBearing(0, 10, 0, 0), 270, 1e-9);
ok('bearing always in [0,360)', (function () {
  var b = core.initialBearing(NY.lat, NY.lon, TOK.lat, TOK.lon);
  return b >= 0 && b < 360;
})());

eq('compass 0 -> N', core.compassPoint(0), 'N');
eq('compass 90 -> E', core.compassPoint(90), 'E');
eq('compass 180 -> S', core.compassPoint(180), 'S');
eq('compass 200 -> SSW', core.compassPoint(200), 'SSW');
eq('compass 359 wraps to N', core.compassPoint(359), 'N');
eq('compass handles negative', core.compassPoint(-90), 'W');

/* ---------- midpoint -------------------------------------------------- */

(function () {
  var m = core.midpoint(NY.lat, NY.lon, LON.lat, LON.lon);
  var dA = core.haversine(NY.lat, NY.lon, m.lat, m.lon);
  var dB = core.haversine(m.lat, m.lon, LON.lat, LON.lon);
  near('midpoint is equidistant from both ends', dA, dB, 1e-6);
  near('two half-legs sum to the whole', dA + dB, hav(NY, LON), 1e-6);
})();

/* ---------- coordinate parsing ---------------------------------------- */

(function () {
  var p = core.parseCoordinate('40.7128, -74.0060');
  near('decimal lat', p.lat, 40.7128, 1e-9);
  near('decimal lon', p.lon, -74.0060, 1e-9);
})();
(function () {
  var p = core.parseCoordinate('40.7128 N, 74.0060 W');
  near('hemisphere N lat', p.lat, 40.7128, 1e-9);
  near('hemisphere W lon', p.lon, -74.0060, 1e-9);
})();
(function () {
  var p = core.parseCoordinate('33.8688 S, 151.2093 E');
  near('southern hemisphere is negative', p.lat, -33.8688, 1e-9);
  near('eastern hemisphere is positive', p.lon, 151.2093, 1e-9);
})();
(function () {
  var p = core.parseCoordinate("40°42'46\"N 74°00'21\"W");
  near('DMS lat', p.lat, 40 + 42 / 60 + 46 / 3600, 1e-6);
  near('DMS lon', p.lon, -(74 + 0 / 60 + 21 / 3600), 1e-6);
})();
throws('parse rejects a single value', function () { core.parseCoordinate('40.7128'); });
throws('parse rejects out-of-range latitude', function () { core.parseCoordinate('120, 40'); });
throws('parse rejects out-of-range longitude', function () { core.parseCoordinate('40, 200'); });
throws('parse rejects gibberish', function () { core.parseCoordinate('over there, somewhere'); });
throws('checkLat rejects NaN via parse', function () { core.parseCoordinate('abc, 10'); });

/* Formatting + round-trip. */
(function () {
  eq('formatDecimal', core.formatDecimal(40.7128, -74.0060, 4), '40.7128, -74.0060');
  var dms = core.formatDMS(40.7128, -74.0060);
  ok('formatDMS shape', /N/.test(dms) && /W/.test(dms));
  var back = core.parseCoordinate(dms);
  near('DMS format -> parse round-trips lat', back.lat, 40.7128, 1e-3);
  near('DMS format -> parse round-trips lon', back.lon, -74.0060, 1e-3);
})();

/* ---------- city gazetteer -------------------------------------------- */

(function () {
  var t = core.lookupCity('Tokyo');
  ok('lookup Tokyo found', !!t);
  near('Tokyo lat', t.lat, 35.6762, 1e-4);
})();
eq('lookup is case-insensitive', core.lookupCity('LONDON').name, 'London');
eq('alias NYC -> New York', core.lookupCity('NYC').name, 'New York');
eq('alias LA -> Los Angeles', core.lookupCity('la').name, 'Los Angeles');
eq('City, Country form', core.lookupCity('Paris, France').name, 'Paris');
ok('unknown city returns null', core.lookupCity('Atlantis') === null);
ok('empty query returns null', core.lookupCity('   ') === null);
ok('cityNames lists every city', core.cityNames().length === core.CITIES.length);

(function () {
  var r = core.distanceBetweenCities('New York', 'London', 'km', 'haversine');
  near('NY-London via cities matches haversine of coords', r.km, hav(NY, LON), 1);
  ok('result carries a bearing', r.bearing >= 0 && r.bearing < 360);
  ok('result carries a compass label', typeof r.compass === 'string' && r.compass.length > 0);
  // Default (auto) uses the ellipsoid, so it differs slightly from the sphere.
  var auto = core.distanceBetweenCities('New York', 'London', 'km');
  near('NY-London default (ellipsoid) close to sphere', auto.km, hav(NY, LON), 30);
})();
(function () {
  var mi = core.distanceBetweenCities('New York', 'London', 'mi', 'haversine');
  near('NY-London in miles', mi.distance, core.convert(hav(NY, LON), 'mi'), 1);
  eq('unit label', mi.unitLabel, 'miles');
})();
throws('unknown from-city throws', function () { core.distanceBetweenCities('Nowhere', 'London'); });
throws('unknown to-city throws', function () { core.distanceBetweenCities('London', 'Nowhere'); });

/* Every gazetteer entry has valid, in-range coordinates. */
(function () {
  var allValid = true;
  for (var i = 0; i < core.CITIES.length; i++) {
    var c = core.CITIES[i];
    if (!(c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180)) allValid = false;
    if (!c.name || !c.country) allValid = false;
  }
  ok('every city has valid coordinates and labels', allValid);
})();

/* ---------- property sweeps ------------------------------------------- */

/* A small deterministic PRNG so the sweeps are reproducible. */
function makeRng(seed) {
  var s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function randPoint(rng) {
  return { lat: rng() * 180 - 90, lon: rng() * 360 - 180 };
}

// (1) Distance is always symmetric and non-negative, over 500 random pairs.
(function () {
  var rng = makeRng(12345);
  var symOk = true, nonNeg = true;
  for (var i = 0; i < 500; i++) {
    var a = randPoint(rng), b = randPoint(rng);
    var dab = core.haversine(a.lat, a.lon, b.lat, b.lon);
    var dba = core.haversine(b.lat, b.lon, a.lat, a.lon);
    if (Math.abs(dab - dba) > 1e-6) symOk = false;
    if (!(dab >= 0)) nonNeg = false;
  }
  ok('sweep: haversine symmetric over 500 pairs', symOk);
  ok('sweep: haversine non-negative over 500 pairs', nonNeg);
})();

// (2) No distance exceeds half the Earth's circumference (the antipodal max).
(function () {
  var rng = makeRng(999);
  var maxKm = Math.PI * core.R_KM + 1e-6;
  var withinMax = true;
  for (var i = 0; i < 500; i++) {
    var a = randPoint(rng), b = randPoint(rng);
    if (core.haversine(a.lat, a.lon, b.lat, b.lon) > maxKm) withinMax = false;
  }
  ok('sweep: no distance exceeds pi*R', withinMax);
})();

// (3) Triangle inequality: d(a,c) <= d(a,b) + d(b,c), over 400 random triples.
(function () {
  var rng = makeRng(2718);
  var holds = true;
  for (var i = 0; i < 400; i++) {
    var a = randPoint(rng), b = randPoint(rng), c = randPoint(rng);
    var ac = core.haversine(a.lat, a.lon, c.lat, c.lon);
    var ab = core.haversine(a.lat, a.lon, b.lat, b.lon);
    var bc = core.haversine(b.lat, b.lon, c.lat, c.lon);
    if (ac > ab + bc + 1e-6) holds = false;
  }
  ok('sweep: triangle inequality holds over 400 triples', holds);
})();

// (4) destinationPoint <-> distance inverse: travel d on bearing t from P, and
//     the measured distance back to P is d again, over 300 random cases.
(function () {
  var rng = makeRng(31415);
  var inverseOk = true;
  for (var i = 0; i < 300; i++) {
    var p = randPoint(rng);
    var bearing = rng() * 360;
    var d = rng() * 5000 + 1; // 1..5001 km, short enough to stay well-conditioned
    var q = core.destinationPoint(p.lat, p.lon, bearing, d);
    var back = core.haversine(p.lat, p.lon, q.lat, q.lon);
    if (Math.abs(back - d) > 1e-3) inverseOk = false;
  }
  ok('sweep: destinationPoint round-trips its distance', inverseOk);
})();

// (5) destinationPoint also round-trips the *bearing* you set out on.
(function () {
  var rng = makeRng(27182);
  var bearingOk = true;
  for (var i = 0; i < 300; i++) {
    var p = { lat: rng() * 140 - 70, lon: rng() * 360 - 180 }; // avoid poles
    var bearing = rng() * 360;
    var d = rng() * 3000 + 100;
    var q = core.destinationPoint(p.lat, p.lon, bearing, d);
    var measured = core.initialBearing(p.lat, p.lon, q.lat, q.lon);
    var diff = Math.abs(((measured - bearing + 540) % 360) - 180);
    if (diff > 1e-3) bearingOk = false;
  }
  ok('sweep: destinationPoint round-trips its bearing', bearingOk);
})();

// (6) 'auto' distance always returns a finite number for random pairs, even
//     the near-antipodal ones where Vincenty bails out.
(function () {
  var rng = makeRng(4242);
  var allFinite = true;
  for (var i = 0; i < 300; i++) {
    var a = randPoint(rng), b = randPoint(rng);
    var d = core.distance(a.lat, a.lon, b.lat, b.lon, 'auto');
    if (!(typeof d === 'number' && isFinite(d) && d >= 0)) allFinite = false;
  }
  ok('sweep: auto distance is always finite and non-negative', allFinite);
})();

/* ---------- report ---------------------------------------------------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
