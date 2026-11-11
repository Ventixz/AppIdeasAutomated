'use strict';
/*
 * weather-core.js — the whole engine for "Fetch Current Weather", with no I/O.
 *
 * Nothing in this file touches the network, the clock, or the DOM. It is the
 * part worth testing: the two-step place -> coordinates -> forecast pipeline
 * expressed as pure URL builders and response parsers, the WMO weather-code
 * dictionary, the unit conversions, the wind-direction compass, and — the
 * reason "current weather" is not a one-liner — the apparent-temperature math
 * (wind chill when it's cold and windy, heat index when it's hot and humid),
 * each with the validity domain that decides whether it applies at all.
 *
 * It runs identically in Node and in the browser (see the UMD footer).
 */

// ---------------------------------------------------------------------------
// WMO weather interpretation codes (the code is a NUMBER on the wire, not text)
// ---------------------------------------------------------------------------
// Open-Meteo, like most modern forecast APIs, returns `weather_code`: a single
// integer from WMO code table 4677. "Current weather" for a human means a
// phrase ("light rain") and a glyph, not the integer 61 — so the first real
// job is this dictionary. Grouping each code into a coarse `group` is what lets
// a UI pick one icon without a 28-way switch.
const WMO = {
  0:  { group: 'clear',   label: 'Clear sky',                 icon: '☀️' },
  1:  { group: 'clear',   label: 'Mainly clear',              icon: '\u{1F324}️' },
  2:  { group: 'cloud',   label: 'Partly cloudy',             icon: '⛅' },
  3:  { group: 'cloud',   label: 'Overcast',                  icon: '☁️' },
  45: { group: 'fog',     label: 'Fog',                       icon: '\u{1F32B}️' },
  48: { group: 'fog',     label: 'Depositing rime fog',       icon: '\u{1F32B}️' },
  51: { group: 'drizzle', label: 'Light drizzle',             icon: '\u{1F327}️' },
  53: { group: 'drizzle', label: 'Moderate drizzle',          icon: '\u{1F327}️' },
  55: { group: 'drizzle', label: 'Dense drizzle',             icon: '\u{1F327}️' },
  56: { group: 'drizzle', label: 'Light freezing drizzle',    icon: '\u{1F328}️' },
  57: { group: 'drizzle', label: 'Dense freezing drizzle',    icon: '\u{1F328}️' },
  61: { group: 'rain',    label: 'Slight rain',               icon: '\u{1F327}️' },
  63: { group: 'rain',    label: 'Moderate rain',             icon: '\u{1F327}️' },
  65: { group: 'rain',    label: 'Heavy rain',                icon: '\u{1F327}️' },
  66: { group: 'rain',    label: 'Light freezing rain',       icon: '\u{1F328}️' },
  67: { group: 'rain',    label: 'Heavy freezing rain',       icon: '\u{1F328}️' },
  71: { group: 'snow',    label: 'Slight snow fall',          icon: '\u{1F328}️' },
  73: { group: 'snow',    label: 'Moderate snow fall',        icon: '\u{1F328}️' },
  75: { group: 'snow',    label: 'Heavy snow fall',           icon: '❄️' },
  77: { group: 'snow',    label: 'Snow grains',               icon: '❄️' },
  80: { group: 'rain',    label: 'Slight rain showers',       icon: '\u{1F326}️' },
  81: { group: 'rain',    label: 'Moderate rain showers',     icon: '\u{1F326}️' },
  82: { group: 'rain',    label: 'Violent rain showers',      icon: '⛈️' },
  85: { group: 'snow',    label: 'Slight snow showers',       icon: '\u{1F328}️' },
  86: { group: 'snow',    label: 'Heavy snow showers',        icon: '❄️' },
  95: { group: 'storm',   label: 'Thunderstorm',              icon: '⛈️' },
  96: { group: 'storm',   label: 'Thunderstorm, slight hail', icon: '⛈️' },
  99: { group: 'storm',   label: 'Thunderstorm, heavy hail',  icon: '⛈️' },
};

function describeWeatherCode(code) {
  const hit = WMO[code];
  if (hit) return { code, ...hit, known: true };
  // Unknown codes must degrade, not crash: a forecast provider can add a code
  // tomorrow, and a weather display that throws on it is worse than one that
  // says "unknown".
  return { code, group: 'unknown', label: 'Unknown conditions', icon: '❓', known: false };
}

// ---------------------------------------------------------------------------
// Unit conversions — kept exact and separate so the UI can toggle without a refetch
// ---------------------------------------------------------------------------
const cToF = (c) => (c * 9) / 5 + 32;
const fToC = (f) => ((f - 32) * 5) / 9;
const kmhToMph = (k) => k / 1.609344;       // 1 mile = 1.609344 km, exactly
const mphToKmh = (m) => m * 1.609344;
const kmhToMs = (k) => k / 3.6;             // km/h -> m/s
const kmhToKnots = (k) => k / 1.852;        // 1 knot = 1.852 km/h, exactly
const mmToInch = (mm) => mm / 25.4;

// Compass point from a meteorological wind direction in degrees. Convention:
// the direction the wind is coming FROM, 0 = N, 90 = E, clockwise. 16-point rose.
const COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                    'S','SSW','SW','WSW','W','WNW','NW','NNW'];
function windCompass(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  const d = ((deg % 360) + 360) % 360;      // normalise any sign / overflow
  const idx = Math.round(d / 22.5) % 16;    // 360/16 = 22.5 deg per point
  return COMPASS_16[idx];
}

// ---------------------------------------------------------------------------
// Apparent temperature — the number a person actually cares about
// ---------------------------------------------------------------------------
// A thermometer reports air temperature. It is NOT what the air feels like:
// wind strips the warm boundary layer off your skin (wind chill), and humidity
// stops sweat evaporating (heat index). "Current weather" that ignores this is
// reporting the wrong number. Each formula has a DOMAIN outside which it is not
// just inaccurate but meaningless — the central correctness trap here is
// applying one where it does not hold.

// Environment Canada / JAG-TI wind chill. T in degC, wind V in km/h (at 10 m).
// Valid only for T <= 10 degC and V > 4.8 km/h; outside that it is undefined.
function windChillC(tempC, windKmh) {
  if (!(tempC <= 10) || !(windKmh > 4.8)) return null;
  const v16 = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * v16 + 0.3965 * tempC * v16;
}

// NWS Rothfusz heat index. T in degF, RH in %. The regression is only meant for
// T >= 80 degF; below that it diverges, so we gate on it and return null.
function heatIndexF(tempF, rh) {
  if (!(tempF >= 80)) return null;
  const T = tempF, R = rh;
  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    0.00683783 * T * T -
    0.05481717 * R * R +
    0.00122874 * T * T * R +
    0.00085282 * T * R * R -
    0.00000199 * T * T * R * R;
  // NWS adjustments at the dry and the very-hot-humid corners.
  if (R < 13 && T >= 80 && T <= 112) {
    hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  } else if (R > 85 && T >= 80 && T <= 87) {
    hi += ((R - 85) / 10) * ((87 - T) / 5);
  }
  return hi;
}

// The dispatcher: given air temp (degC), wind (km/h) and RH (%), return the
// apparent temperature in degC and say WHICH model produced it. This is the
// piece that must not apply wind chill on a hot day or heat index on a cold one.
function apparentTemperatureC(tempC, windKmh, rh) {
  const wc = windChillC(tempC, windKmh);
  if (wc != null) return { value: wc, model: 'wind-chill' };
  if (rh != null) {
    const hi = heatIndexF(cToF(tempC), rh);
    if (hi != null) return { value: fToC(hi), model: 'heat-index' };
  }
  // Neither domain applies: the air temperature IS the apparent temperature.
  return { value: tempC, model: 'none' };
}

// ---------------------------------------------------------------------------
// Step 1 of the pipeline: there is no "weather for a place name" endpoint.
// You must geocode the name to coordinates first. Names are ambiguous
// ("Springfield"), so this returns a LIST of candidates for the caller to pick.
// ---------------------------------------------------------------------------
const GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';

function buildGeocodeUrl(place, { count = 5, language = 'en' } = {}) {
  const q = String(place == null ? '' : place).trim();
  if (!q) throw new Error('buildGeocodeUrl: a non-empty place name is required');
  const p = new URLSearchParams({
    name: q,
    count: String(count),
    language,
    format: 'json',
  });
  return `${GEOCODE_BASE}?${p.toString()}`;
}

function parseGeocodeResponse(json) {
  const results = (json && Array.isArray(json.results)) ? json.results : [];
  return results.map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country || null,
    countryCode: r.country_code || null,
    admin1: r.admin1 || null,             // state / province, disambiguates duplicates
    timezone: r.timezone || null,
    population: r.population ?? null,
    // A single human-readable label for a candidate: "Paris, Ile-de-France, FR".
    label: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
  }));
}

// ---------------------------------------------------------------------------
// Step 2: fetch the current conditions for those coordinates.
// ---------------------------------------------------------------------------
// Latitude/longitude are rounded before they go in the URL. This is not
// cosmetic: it is the cache key. Two clicks on the same city produce two
// floats that differ in the 9th decimal; rounded to 4 places (~11 m) they
// collapse to one key, so the cache actually hits. See makeCacheKey below.
function roundCoord(x, dp = 4) {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

function buildForecastUrl(lat, lon, opts = {}) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`buildForecastUrl: latitude out of range: ${lat}`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`buildForecastUrl: longitude out of range: ${lon}`);
  }
  const p = new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'is_day',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m',
      'precipitation',
      'surface_pressure',
    ].join(','),
    wind_speed_unit: 'kmh',
    temperature_unit: 'celsius',
    timezone: opts.timezone || 'auto',
  });
  return `${FORECAST_BASE}?${p.toString()}`;
}

// A stable cache key for a rounded coordinate. "48.8566,2.3522".
function makeCacheKey(lat, lon) {
  return `${roundCoord(lat)},${roundCoord(lon)}`;
}

// Normalise the raw forecast payload into one flat, unit-explicit object. The
// provider nests values under `current` and their units under `current_units`;
// a consumer should never have to know that shape. We also recompute the
// apparent temperature ourselves rather than only trusting the field, so the
// UI can show which model applies and the two can be compared.
function parseForecastResponse(json) {
  if (!json || typeof json !== 'object') {
    throw new Error('parseForecastResponse: empty response');
  }
  if (json.error) {
    // Open-Meteo signals failure with { error: true, reason: "..." }.
    throw new Error(`forecast API error: ${json.reason || 'unknown'}`);
  }
  const cur = json.current;
  if (!cur || typeof cur !== 'object') {
    throw new Error('parseForecastResponse: no "current" block in response');
  }
  const tempC = cur.temperature_2m;
  const windKmh = cur.wind_speed_10m;
  const rh = cur.relative_humidity_2m;
  const code = cur.weather_code;
  const apparent = apparentTemperatureC(tempC, windKmh, rh);

  return {
    time: cur.time || null,
    isDay: cur.is_day === 1 || cur.is_day === true,
    coordinates: {
      latitude: json.latitude,
      longitude: json.longitude,
      elevation: json.elevation ?? null,
    },
    timezone: json.timezone || null,
    weather: describeWeatherCode(code),
    temperatureC: tempC,
    humidity: rh,
    // Our own apparent temp + the model that produced it (null model === raw).
    apparentC: apparent.value,
    apparentModel: apparent.model,
    // The provider's own apparent_temperature, for comparison in tests/UI.
    providerApparentC: cur.apparent_temperature ?? null,
    windKmh,
    windDirectionDeg: cur.wind_direction_10m ?? null,
    windCompass: windCompass(cur.wind_direction_10m),
    precipitationMm: cur.precipitation ?? null,
    pressureHPa: cur.surface_pressure ?? null,
  };
}

// Convenience: render a parsed observation in a chosen unit system without a
// refetch. 'metric' = degC + km/h, 'imperial' = degF + mph.
function formatObservation(obs, system = 'metric') {
  const imperial = system === 'imperial';
  const t = imperial ? cToF(obs.temperatureC) : obs.temperatureC;
  const feels = imperial ? cToF(obs.apparentC) : obs.apparentC;
  const wind = imperial ? kmhToMph(obs.windKmh) : obs.windKmh;
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  return {
    conditions: obs.weather.label,
    icon: obs.weather.icon,
    temperature: r1(t),
    tempUnit: imperial ? '°F' : '°C',
    feelsLike: r1(feels),
    feelsLikeModel: obs.apparentModel,
    humidity: obs.humidity,
    wind: r1(wind),
    windUnit: imperial ? 'mph' : 'km/h',
    windFrom: obs.windCompass,
  };
}

const api = {
  WMO,
  describeWeatherCode,
  cToF, fToC, kmhToMph, mphToKmh, kmhToMs, kmhToKnots, mmToInch,
  windCompass,
  windChillC, heatIndexF, apparentTemperatureC,
  GEOCODE_BASE, FORECAST_BASE,
  buildGeocodeUrl, parseGeocodeResponse,
  roundCoord, buildForecastUrl, makeCacheKey, parseForecastResponse,
  formatObservation,
};

// UMD-ish export: CommonJS for Node/tests, global for the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.WeatherCore = api;
}
