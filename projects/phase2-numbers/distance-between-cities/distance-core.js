/*
 * distance-core.js — the DOM-free, I/O-free brain of Distance Between Two Cities.
 *
 * The task ("calculate the distance between two cities, in a unit of the user's
 * choosing") looks like a lookup problem, but the part that has to be *correct*
 * is geometry on a globe: the shortest path between two points on Earth is a
 * great-circle arc, not the straight line you'd draw on a flat map, and the
 * naive Pythagoras over (lat, lon) is wrong everywhere except tiny distances
 * near the equator. None of the real work needs the DOM, the network, or a map
 * tile — it is trigonometry over two coordinate pairs. So all of it lives here:
 *
 *   - haversine()   — great-circle distance on a sphere (stable for all pairs)
 *   - vincenty()    — distance on the WGS-84 ellipsoid (Earth is not a sphere;
 *                     this is accurate to ~0.5 mm but can fail near antipodes)
 *   - initialBearing / finalBearing / midpoint / destinationPoint
 *   - convert()     — km into mi / nmi / m / ft / yd via *exact* factors
 *   - parseCoordinate() / formatCoordinate() — decimal and DMS, with hemispheres
 *   - a small offline city gazetteer + lookupCity(), so the whole thing runs
 *     with no network and no API key
 *
 * "This program may require finding coordinates for the cities like latitude and
 * longitude" (karan/Projects). We bundle the coordinates for a set of well-known
 * cities rather than hit a geocoding service, keeping the project dependency-free
 * and its behaviour fully testable.
 *
 * Every function takes plain numbers/strings and returns plain values, so the
 * suite can check known distances, symmetry, the triangle inequality and
 * round-trips without a browser. The file runs unchanged in the browser (it
 * attaches to `window.DistanceCore`) and under Node (`module.exports`).
 */

'use strict';

/* Earth model constants. */
var R_KM = 6371.0088;            // IUGG mean radius, kilometres (haversine sphere)
var WGS84_A = 6378137.0;         // semi-major axis, metres
var WGS84_F = 1 / 298.257223563; // flattening
var WGS84_B = WGS84_A * (1 - WGS84_F); // semi-minor axis, metres

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

/* ---------- validation ------------------------------------------------- */

function checkLat(lat) {
  if (typeof lat !== 'number' || !isFinite(lat)) throw new Error('latitude must be a finite number');
  if (lat < -90 || lat > 90) throw new Error('latitude must be between -90 and 90');
  return lat;
}

function checkLon(lon) {
  if (typeof lon !== 'number' || !isFinite(lon)) throw new Error('longitude must be a finite number');
  if (lon < -180 || lon > 180) throw new Error('longitude must be between -180 and 180');
  return lon;
}

/* ---------- great-circle distance (haversine) -------------------------- */

/*
 * haversine(lat1, lon1, lat2, lon2) -> kilometres.
 *
 * The great-circle distance on a sphere of radius R_KM. Numerically stable for
 * every pair including antipodes (unlike the spherical law of cosines, which
 * loses all precision for nearby points). This is the workhorse.
 */
function haversine(lat1, lon1, lat2, lon2) {
  checkLat(lat1); checkLon(lon1); checkLat(lat2); checkLon(lon2);
  var phi1 = toRad(lat1), phi2 = toRad(lat2);
  var dPhi = toRad(lat2 - lat1);
  var dLam = toRad(lon2 - lon1);
  var a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) * Math.sin(dLam / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_KM * c;
}

/* ---------- ellipsoidal distance (Vincenty inverse) -------------------- */

/*
 * vincenty(lat1, lon1, lat2, lon2) -> kilometres, or null if it fails to
 * converge (which happens for near-antipodal points — a documented limitation
 * of the inverse method). Earth is an oblate spheroid, so this is more accurate
 * than the spherical haversine (sub-millimetre on well-conditioned pairs), and
 * it is the reason `distance()` below prefers it when it converges.
 */
function vincenty(lat1, lon1, lat2, lon2) {
  checkLat(lat1); checkLon(lon1); checkLat(lat2); checkLon(lon2);
  if (lat1 === lat2 && lon1 === lon2) return 0;

  var a = WGS84_A, b = WGS84_B, f = WGS84_F;
  var L = toRad(lon2 - lon1);
  var U1 = Math.atan((1 - f) * Math.tan(toRad(lat1)));
  var U2 = Math.atan((1 - f) * Math.tan(toRad(lat2)));
  var sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  var sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  var lambda = L, lambdaPrev;
  var iter = 0;
  var sinSigma, cosSigma, sigma, cosSqAlpha, cos2SigmaM, sinLambda, cosLambda;

  do {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) * (cosU2 * sinLambda) +
      (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) *
      (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
    );
    if (sinSigma === 0) return 0; // coincident points
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    var sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha : 0; // equatorial line
    var C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    lambdaPrev = lambda;
    lambda = L + (1 - C) * f * sinAlpha *
      (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaPrev) > 1e-12 && ++iter < 1000);

  if (iter >= 1000) return null; // failed to converge (near-antipodal)

  var uSq = cosSqAlpha * (a * a - b * b) / (b * b);
  var A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  var B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  var deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (
    cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
    B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  var s = b * A * (sigma - deltaSigma); // metres
  return s / 1000;
}

/*
 * distance(lat1, lon1, lat2, lon2, method) -> kilometres.
 *
 * method: 'haversine' (sphere), 'vincenty' (ellipsoid), or 'auto' (default) —
 * use Vincenty when it converges, otherwise fall back to haversine so the
 * function always returns a number.
 */
function distance(lat1, lon1, lat2, lon2, method) {
  method = method || 'auto';
  if (method === 'haversine') return haversine(lat1, lon1, lat2, lon2);
  if (method === 'vincenty') {
    var v = vincenty(lat1, lon1, lat2, lon2);
    if (v === null) throw new Error('Vincenty did not converge (points are near-antipodal); try haversine');
    return v;
  }
  // auto
  var vv = vincenty(lat1, lon1, lat2, lon2);
  return vv === null ? haversine(lat1, lon1, lat2, lon2) : vv;
}

/* ---------- bearings, midpoint, projection ----------------------------- */

/* Compass bearing (degrees, 0 = north, clockwise) of the initial heading. */
function initialBearing(lat1, lon1, lat2, lon2) {
  checkLat(lat1); checkLon(lon1); checkLat(lat2); checkLon(lon2);
  var phi1 = toRad(lat1), phi2 = toRad(lat2);
  var dLam = toRad(lon2 - lon1);
  var y = Math.sin(dLam) * Math.cos(phi2);
  var x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/* The bearing you arrive on: the reverse initial bearing, flipped 180°. */
function finalBearing(lat1, lon1, lat2, lon2) {
  return (initialBearing(lat2, lon2, lat1, lon1) + 180) % 360;
}

/* Half-way point along the great circle between two coordinates. */
function midpoint(lat1, lon1, lat2, lon2) {
  checkLat(lat1); checkLon(lon1); checkLat(lat2); checkLon(lon2);
  var phi1 = toRad(lat1), phi2 = toRad(lat2);
  var lam1 = toRad(lon1);
  var dLam = toRad(lon2 - lon1);
  var bx = Math.cos(phi2) * Math.cos(dLam);
  var by = Math.cos(phi2) * Math.sin(dLam);
  var phi3 = Math.atan2(Math.sin(phi1) + Math.sin(phi2),
    Math.sqrt((Math.cos(phi1) + bx) * (Math.cos(phi1) + bx) + by * by));
  var lam3 = lam1 + Math.atan2(by, Math.cos(phi1) + bx);
  return { lat: toDeg(phi3), lon: ((toDeg(lam3) + 540) % 360) - 180 };
}

/*
 * destinationPoint(lat, lon, bearingDeg, distKm) -> { lat, lon }.
 *
 * Where you end up starting from (lat, lon), travelling `distKm` along the
 * great circle on the given initial bearing. The exact inverse relationship
 * with haversine/initialBearing is what the property tests round-trip against.
 */
function destinationPoint(lat, lon, bearingDeg, distKm) {
  checkLat(lat); checkLon(lon);
  var delta = distKm / R_KM; // angular distance
  var theta = toRad(bearingDeg);
  var phi1 = toRad(lat), lam1 = toRad(lon);
  var phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  var lam2 = lam1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: toDeg(phi2), lon: ((toDeg(lam2) + 540) % 360) - 180 };
}

/* 16-point compass label for a bearing, e.g. 200° -> "SSW". */
var COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compassPoint(bearingDeg) {
  var b = ((bearingDeg % 360) + 360) % 360;
  return COMPASS_16[Math.round(b / 22.5) % 16];
}

/* ---------- unit conversion ------------------------------------------- */

/*
 * Metres per unit — every factor is *exact* by international definition, so a
 * round trip (km -> mi -> km) returns the original value to floating-point
 * precision rather than drifting on an approximate constant.
 */
var METRES_PER_UNIT = {
  km:  1000,
  m:   1,
  mi:  1609.344,      // international mile, exactly
  nmi: 1852,          // nautical mile, exactly
  ft:  0.3048,        // international foot, exactly
  yd:  0.9144         // international yard, exactly
};

var UNIT_LABELS = {
  km:  'kilometres',
  m:   'metres',
  mi:  'miles',
  nmi: 'nautical miles',
  ft:  'feet',
  yd:  'yards'
};

/* convert(valueKm, unit) -> value in `unit`. */
function convert(valueKm, unit) {
  if (!Object.prototype.hasOwnProperty.call(METRES_PER_UNIT, unit)) {
    throw new Error('unknown unit: ' + unit);
  }
  return valueKm * 1000 / METRES_PER_UNIT[unit];
}

/* convertBetween(value, fromUnit, toUnit) -> value in toUnit. */
function convertBetween(value, fromUnit, toUnit) {
  if (!Object.prototype.hasOwnProperty.call(METRES_PER_UNIT, fromUnit)) throw new Error('unknown unit: ' + fromUnit);
  if (!Object.prototype.hasOwnProperty.call(METRES_PER_UNIT, toUnit)) throw new Error('unknown unit: ' + toUnit);
  return value * METRES_PER_UNIT[fromUnit] / METRES_PER_UNIT[toUnit];
}

/* ---------- coordinate parsing ---------------------------------------- */

/*
 * parseCoordinate("40.7128, -74.0060")             -> { lat, lon }
 * parseCoordinate("40.7128 N, 74.0060 W")          -> { lat, lon }
 * parseCoordinate("40°42'46\"N 74°00'21\"W")       -> { lat, lon }
 *
 * Accepts a single pair "lat, lon" in decimal degrees (optionally signed and/or
 * with hemisphere letters) or in degrees-minutes-seconds. Throws a plain-English
 * error on anything it can't read, or on out-of-range values.
 */
function parseCoordinate(str) {
  if (typeof str !== 'string') throw new Error('coordinate must be a string');
  var s = str.trim();
  if (!s) throw new Error('empty coordinate');

  // Try DMS first (contains ° ' " or the letters d m s next to numbers).
  if (/[°'"′″]/.test(s)) {
    var parts = splitPair(s);
    return validatePair(parseDMS(parts[0], 'lat'), parseDMS(parts[1], 'lon'));
  }

  // Decimal degrees, optionally with hemisphere letters.
  var pair = splitPair(s);
  return validatePair(parseDecimal(pair[0], 'lat'), parseDecimal(pair[1], 'lon'));
}

/* Split "a, b" or "a b" into two halves; requires exactly two components. */
function splitPair(s) {
  var byComma = s.split(',');
  if (byComma.length === 2) return [byComma[0].trim(), byComma[1].trim()];
  // Fall back to splitting on whitespace between the two hemisphere/degree groups.
  var m = s.match(/^(.*?[NSns°'"′″\d])\s+([\-+]?\d.*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  throw new Error('expected two values "lat, lon", got: ' + s);
}

function parseDecimal(token, kind) {
  var t = token.trim();
  var hemi = null;
  var hm = t.match(/([NSEWnsew])\s*$/) || t.match(/^\s*([NSEWnsew])/);
  if (hm) { hemi = hm[1].toUpperCase(); t = t.replace(/[NSEWnsew]/g, '').trim(); }
  var val = Number(t);
  if (isNaN(val)) throw new Error('cannot read ' + kind + ' from: ' + token);
  if (hemi === 'S' || hemi === 'W') val = -Math.abs(val);
  if (hemi === 'N' || hemi === 'E') val = Math.abs(val);
  return val;
}

function parseDMS(token, kind) {
  var t = token.trim();
  var hemi = null;
  var hm = t.match(/([NSEWnsew])\s*$/);
  if (hm) { hemi = hm[1].toUpperCase(); t = t.slice(0, hm.index).trim(); }
  var nums = t.match(/[\-+]?\d+(\.\d+)?/g);
  if (!nums || nums.length === 0) throw new Error('cannot read ' + kind + ' from: ' + token);
  var deg = Math.abs(parseFloat(nums[0]));
  var min = nums.length > 1 ? parseFloat(nums[1]) : 0;
  var sec = nums.length > 2 ? parseFloat(nums[2]) : 0;
  var sign = parseFloat(nums[0]) < 0 ? -1 : 1;
  var val = sign * (deg + min / 60 + sec / 3600);
  if (hemi === 'S' || hemi === 'W') val = -Math.abs(val);
  if (hemi === 'N' || hemi === 'E') val = Math.abs(val);
  return val;
}

function validatePair(lat, lon) {
  checkLat(lat); checkLon(lon);
  return { lat: lat, lon: lon };
}

/* ---------- coordinate formatting ------------------------------------- */

/* formatDecimal(lat, lon, dp=4) -> "40.7128, -74.0060". */
function formatDecimal(lat, lon, dp) {
  dp = dp == null ? 4 : dp;
  return lat.toFixed(dp) + ', ' + lon.toFixed(dp);
}

/* One axis to DMS, e.g. dmsComponent(-74.00583, 'lon') -> "74°00'21\"W". */
function dmsComponent(value, kind) {
  var hemi = value < 0 ? (kind === 'lat' ? 'S' : 'W') : (kind === 'lat' ? 'N' : 'E');
  var abs = Math.abs(value);
  var deg = Math.floor(abs);
  var minFloat = (abs - deg) * 60;
  var min = Math.floor(minFloat);
  var sec = Math.round((minFloat - min) * 60);
  if (sec === 60) { sec = 0; min += 1; }
  if (min === 60) { min = 0; deg += 1; }
  return deg + '°' + pad2(min) + "'" + pad2(sec) + '"' + hemi;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* formatDMS(lat, lon) -> "40°42'46\"N, 74°00'21\"W". */
function formatDMS(lat, lon) {
  return dmsComponent(lat, 'lat') + ', ' + dmsComponent(lon, 'lon');
}

/* ---------- offline city gazetteer ------------------------------------ */

/*
 * A compact, hand-checked set of well-known cities with their coordinates, so
 * the app needs no geocoding API. Each entry: name, country, lat, lon. Add more
 * freely — lookupCity() matches on a normalised name and on "City, Country".
 */
var CITIES = [
  { name: 'New York', country: 'USA', lat: 40.7128, lon: -74.0060 },
  { name: 'Los Angeles', country: 'USA', lat: 34.0522, lon: -118.2437 },
  { name: 'Chicago', country: 'USA', lat: 41.8781, lon: -87.6298 },
  { name: 'Houston', country: 'USA', lat: 29.7604, lon: -95.3698 },
  { name: 'San Francisco', country: 'USA', lat: 37.7749, lon: -122.4194 },
  { name: 'Toronto', country: 'Canada', lat: 43.6532, lon: -79.3832 },
  { name: 'Vancouver', country: 'Canada', lat: 49.2827, lon: -123.1207 },
  { name: 'Mexico City', country: 'Mexico', lat: 19.4326, lon: -99.1332 },
  { name: 'London', country: 'UK', lat: 51.5074, lon: -0.1278 },
  { name: 'Paris', country: 'France', lat: 48.8566, lon: 2.3522 },
  { name: 'Berlin', country: 'Germany', lat: 52.5200, lon: 13.4050 },
  { name: 'Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038 },
  { name: 'Rome', country: 'Italy', lat: 41.9028, lon: 12.4964 },
  { name: 'Amsterdam', country: 'Netherlands', lat: 52.3676, lon: 4.9041 },
  { name: 'Moscow', country: 'Russia', lat: 55.7558, lon: 37.6173 },
  { name: 'Istanbul', country: 'Turkey', lat: 41.0082, lon: 28.9784 },
  { name: 'Cairo', country: 'Egypt', lat: 30.0444, lon: 31.2357 },
  { name: 'Lagos', country: 'Nigeria', lat: 6.5244, lon: 3.3792 },
  { name: 'Nairobi', country: 'Kenya', lat: -1.2921, lon: 36.8219 },
  { name: 'Cape Town', country: 'South Africa', lat: -33.9249, lon: 18.4241 },
  { name: 'Johannesburg', country: 'South Africa', lat: -26.2041, lon: 28.0473 },
  { name: 'Dubai', country: 'UAE', lat: 25.2048, lon: 55.2708 },
  { name: 'Mumbai', country: 'India', lat: 19.0760, lon: 72.8777 },
  { name: 'Delhi', country: 'India', lat: 28.7041, lon: 77.1025 },
  { name: 'Bangkok', country: 'Thailand', lat: 13.7563, lon: 100.5018 },
  { name: 'Singapore', country: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Hong Kong', country: 'China', lat: 22.3193, lon: 114.1694 },
  { name: 'Beijing', country: 'China', lat: 39.9042, lon: 116.4074 },
  { name: 'Shanghai', country: 'China', lat: 31.2304, lon: 121.4737 },
  { name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503 },
  { name: 'Seoul', country: 'South Korea', lat: 37.5665, lon: 126.9780 },
  { name: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093 },
  { name: 'Melbourne', country: 'Australia', lat: -37.8136, lon: 144.9631 },
  { name: 'Auckland', country: 'New Zealand', lat: -36.8509, lon: 174.7645 },
  { name: 'Sao Paulo', country: 'Brazil', lat: -23.5505, lon: -46.6333 },
  { name: 'Rio de Janeiro', country: 'Brazil', lat: -22.9068, lon: -43.1729 },
  { name: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lon: -58.3816 },
  { name: 'Lima', country: 'Peru', lat: -12.0464, lon: -77.0428 },
  { name: 'Bogota', country: 'Colombia', lat: 4.7110, lon: -74.0721 },
  { name: 'Santiago', country: 'Chile', lat: -33.4489, lon: -70.6693 }
];

/* Common aliases mapped to a canonical gazetteer name. */
var CITY_ALIASES = {
  'nyc': 'new york',
  'new york city': 'new york',
  'la': 'los angeles',
  'sf': 'san francisco',
  'cdmx': 'mexico city',
  'rio': 'rio de janeiro'
};

/* Normalise a name for matching: lowercase, strip accents and punctuation. */
function normalizeName(s) {
  var t = String(s).toLowerCase();
  if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return t.replace(/[.'`]/g, '').replace(/\s+/g, ' ').trim();
}

/*
 * lookupCity("Tokyo") / lookupCity("Paris, France") / lookupCity("NYC")
 *   -> { name, country, lat, lon }  (a copy), or null if unknown.
 *
 * Matches on the normalised city name, on "City, Country", and on a small set
 * of aliases. The country part disambiguates when two entries share a name.
 */
function lookupCity(query) {
  if (typeof query !== 'string') return null;
  var raw = query.trim();
  if (!raw) return null;

  var cityPart = raw, countryPart = null;
  var comma = raw.indexOf(',');
  if (comma >= 0) {
    cityPart = raw.slice(0, comma);
    countryPart = normalizeName(raw.slice(comma + 1));
  }
  var key = normalizeName(cityPart);
  if (CITY_ALIASES[key]) key = CITY_ALIASES[key];

  var matches = [];
  for (var i = 0; i < CITIES.length; i++) {
    if (normalizeName(CITIES[i].name) === key) matches.push(CITIES[i]);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1 || !countryPart) return copyCity(matches[0]);
  for (var j = 0; j < matches.length; j++) {
    if (normalizeName(matches[j].country) === countryPart) return copyCity(matches[j]);
  }
  return copyCity(matches[0]);
}

function copyCity(c) { return { name: c.name, country: c.country, lat: c.lat, lon: c.lon }; }

/* Names for a datalist / autocomplete, "City, Country", alphabetically. */
function cityNames() {
  return CITIES.map(function (c) { return c.name + ', ' + c.country; })
               .sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
}

/* ---------- top-level: distance between two cities --------------------- */

/*
 * distanceBetweenCities("New York", "London", "km", "auto")
 *   -> { from, to, km, distance, unit, unitLabel, bearing, compass }
 *
 * Looks up both cities in the offline gazetteer, computes the distance and the
 * initial bearing, and converts into the requested unit. Throws a clear error
 * naming whichever city could not be found.
 */
function distanceBetweenCities(nameA, nameB, unit, method) {
  unit = unit || 'km';
  var a = lookupCity(nameA);
  if (!a) throw new Error('unknown city: "' + nameA + '"');
  var b = lookupCity(nameB);
  if (!b) throw new Error('unknown city: "' + nameB + '"');
  var km = distance(a.lat, a.lon, b.lat, b.lon, method);
  var bearing = initialBearing(a.lat, a.lon, b.lat, b.lon);
  return {
    from: a,
    to: b,
    km: km,
    distance: convert(km, unit),
    unit: unit,
    unitLabel: UNIT_LABELS[unit] || unit,
    bearing: bearing,
    compass: compassPoint(bearing)
  };
}

/* ---------- exports --------------------------------------------------- */

var DistanceCore = {
  R_KM: R_KM,
  WGS84_A: WGS84_A,
  WGS84_B: WGS84_B,
  WGS84_F: WGS84_F,
  toRad: toRad,
  toDeg: toDeg,
  haversine: haversine,
  vincenty: vincenty,
  distance: distance,
  initialBearing: initialBearing,
  finalBearing: finalBearing,
  midpoint: midpoint,
  destinationPoint: destinationPoint,
  compassPoint: compassPoint,
  COMPASS_16: COMPASS_16,
  METRES_PER_UNIT: METRES_PER_UNIT,
  UNIT_LABELS: UNIT_LABELS,
  convert: convert,
  convertBetween: convertBetween,
  parseCoordinate: parseCoordinate,
  formatDecimal: formatDecimal,
  formatDMS: formatDMS,
  dmsComponent: dmsComponent,
  CITIES: CITIES,
  lookupCity: lookupCity,
  cityNames: cityNames,
  normalizeName: normalizeName,
  distanceBetweenCities: distanceBetweenCities
};

if (typeof module !== 'undefined' && module.exports) { module.exports = DistanceCore; }
if (typeof window !== 'undefined') { window.DistanceCore = DistanceCore; }
