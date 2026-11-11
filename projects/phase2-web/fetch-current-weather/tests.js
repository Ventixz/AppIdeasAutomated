'use strict';
/*
 * tests.js — dependency-free checks for weather-core.js.
 *
 * Anchored on checkable facts, not made-up numbers: exact unit relationships,
 * the WMO code table, published wind-chill / heat-index reference values, and a
 * full two-step geocode -> forecast round-trip through canned API payloads so
 * the URL building and the response parsing are verified the way the client
 * uses them. Run: `node tests.js`.
 */
const C = require('./weather-core.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
// approximate-equal for floating-point results
function near(name, got, want, tol) {
  const good = Math.abs(got - want) <= tol;
  if (!good) console.log(`      got ${got}, wanted ${want} +/- ${tol}`);
  ok(name, good);
}

console.log('\nUnit conversions (exact relationships)');
ok('0 degC = 32 degF', C.cToF(0) === 32);
ok('100 degC = 212 degF', C.cToF(100) === 212);
ok('-40 is the same in both scales', C.cToF(-40) === -40);
near('fToC is the inverse of cToF', C.fToC(C.cToF(21)), 21, 1e-9);
near('1 mile = 1.609344 km exactly', C.mphToKmh(1), 1.609344, 1e-12);
near('km/h -> mph round-trips', C.kmhToMph(C.mphToKmh(50)), 50, 1e-9);
near('100 km/h = 27.777... m/s', C.kmhToMs(100), 27.77777778, 1e-6);
near('1 knot = 1.852 km/h', C.kmhToKnots(1.852), 1, 1e-9);
near('25.4 mm = 1 inch', C.mmToInch(25.4), 1, 1e-12);

console.log('\nWind compass (meteorological "from" direction)');
ok('0 deg -> N', C.windCompass(0) === 'N');
ok('90 deg -> E', C.windCompass(90) === 'E');
ok('180 deg -> S', C.windCompass(180) === 'S');
ok('270 deg -> W', C.windCompass(270) === 'W');
ok('45 deg -> NE', C.windCompass(45) === 'NE');
ok('358 deg wraps back to N', C.windCompass(358) === 'N');
ok('negative degrees normalise (-90 -> W)', C.windCompass(-90) === 'W');
ok('overflow normalises (450 -> E)', C.windCompass(450) === 'E');
ok('null direction -> null', C.windCompass(null) === null);

console.log('\nWMO weather-code dictionary');
ok('code 0 is "Clear sky"', C.describeWeatherCode(0).label === 'Clear sky');
ok('code 61 is slight rain', C.describeWeatherCode(61).label === 'Slight rain');
ok('code 95 groups as "storm"', C.describeWeatherCode(95).group === 'storm');
ok('code 71 groups as "snow"', C.describeWeatherCode(71).group === 'snow');
ok('a known code reports known:true', C.describeWeatherCode(3).known === true);
ok('an unknown code degrades, not throws', C.describeWeatherCode(1234).known === false);
ok('unknown code keeps its number', C.describeWeatherCode(1234).code === 1234);

console.log('\nWind chill (Environment Canada formula + table values)');
// Published Environment Canada table: -5 degC, 30 km/h -> -13.
near('-5 degC @ 30 km/h ~ -13', C.windChillC(-5, 30), -13, 0.5);
// 0 degC, 50 km/h: 13.12 + 0 - 11.37*50^0.16 + 0  ~ -8.14
near('0 degC @ 50 km/h ~ -8.1', C.windChillC(0, 50), -8.14, 0.1);
ok('warm day: wind chill is undefined (returns null)', C.windChillC(15, 40) === null);
ok('dead calm: wind chill is undefined (<= 4.8 km/h)', C.windChillC(-5, 3) === null);

console.log('\nHeat index (NWS Rothfusz regression + reference value)');
// NWS reference: 90 degF, 70% RH -> ~105 degF (chart), ~106 by the raw formula.
near('90 degF @ 70% RH ~ 105 degF', C.heatIndexF(90, 70), 105.5, 1.5);
ok('cool day: heat index is undefined (< 80 degF)', C.heatIndexF(70, 80) === null);

console.log('\nApparent-temperature dispatcher picks the right model');
let a = C.apparentTemperatureC(-5, 30, 60);
ok('cold + windy -> wind-chill model', a.model === 'wind-chill');
near('   and matches windChillC', a.value, C.windChillC(-5, 30), 1e-9);
a = C.apparentTemperatureC(35, 5, 70);       // 35 degC = 95 degF, hot + humid
ok('hot + humid -> heat-index model', a.model === 'heat-index');
ok('   and apparent temp is hotter than air', a.value > 35);
a = C.apparentTemperatureC(20, 10, 50);      // mild: neither domain applies
ok('mild -> no model, apparent == air temp', a.model === 'none' && a.value === 20);
a = C.apparentTemperatureC(5, 2, 50);         // cold but nearly calm -> neither
ok('cold but calm -> no model (wind too low)', a.model === 'none');

console.log('\nGeocode URL building + response parsing (pipeline step 1)');
const gurl = C.buildGeocodeUrl('Paris', { count: 3 });
ok('geocode URL hits the search endpoint', gurl.startsWith(C.GEOCODE_BASE));
ok('geocode URL encodes the name', gurl.includes('name=Paris'));
ok('geocode URL carries the count', gurl.includes('count=3'));
let threw = false;
try { C.buildGeocodeUrl('   '); } catch (e) { threw = true; }
ok('blank place name is rejected', threw);

const cannedGeo = {
  results: [
    { name: 'Paris', latitude: 48.85341, longitude: 2.3488, country: 'France',
      country_code: 'FR', admin1: 'Ile-de-France', timezone: 'Europe/Paris',
      population: 2138551 },
    { name: 'Paris', latitude: 33.6609, longitude: -95.5555, country: 'United States',
      country_code: 'US', admin1: 'Texas', timezone: 'America/Chicago' },
  ],
};
const cands = C.parseGeocodeResponse(cannedGeo);
ok('both Paris candidates are returned', cands.length === 2);
ok('candidates are disambiguated by admin1/country',
   cands[0].label === 'Paris, Ile-de-France, FR' &&
   cands[1].label === 'Paris, Texas, US');
ok('empty geocode result -> empty list (no throw)',
   C.parseGeocodeResponse({}).length === 0);

console.log('\nForecast URL building + coordinate rounding (cache key)');
threw = false;
try { C.buildForecastUrl(200, 0); } catch (e) { threw = true; }
ok('out-of-range latitude is rejected', threw);
const furl = C.buildForecastUrl(48.85341, 2.34878);
ok('forecast URL rounds coords to 4 dp (lat)', furl.includes('latitude=48.8534'));
ok('forecast URL requests weather_code', furl.includes('weather_code'));
ok('two near-identical coords share a cache key',
   C.makeCacheKey(48.856600, 2.352200) === C.makeCacheKey(48.856589, 2.352241));
ok('distinct coords get distinct keys',
   C.makeCacheKey(48.85, 2.35) !== C.makeCacheKey(40.71, -74.0));

console.log('\nForecast parsing (pipeline step 2) + full round-trip');
const cannedForecast = {
  latitude: 48.85, longitude: 2.35, elevation: 42, timezone: 'Europe/Paris',
  current: {
    time: '2026-11-11T12:00', is_day: 1, temperature_2m: -3.0,
    relative_humidity_2m: 72, apparent_temperature: -8.4, weather_code: 71,
    wind_speed_10m: 25, wind_direction_10m: 315, precipitation: 0.2,
    surface_pressure: 1012.3,
  },
};
const obs = C.parseForecastResponse(cannedForecast);
ok('parsed conditions come from the WMO code', obs.weather.label === 'Slight snow fall');
ok('air temperature is carried through', obs.temperatureC === -3.0);
ok('wind direction 315 -> NW', obs.windCompass === 'NW');
ok('cold + 25 km/h wind triggers wind-chill model', obs.apparentModel === 'wind-chill');
ok('our apparent temp is below the air temp', obs.apparentC < obs.temperatureC);
near('our apparent temp tracks the provider\'s to ~2 degC',
   obs.apparentC, obs.providerApparentC, 2.0);

ok('an { error } payload throws a readable error', (() => {
  try { C.parseForecastResponse({ error: true, reason: 'No data' }); return false; }
  catch (e) { return /No data/.test(e.message); }
})());
ok('a payload with no "current" block throws', (() => {
  try { C.parseForecastResponse({ latitude: 1 }); return false; }
  catch (e) { return true; }
})());

console.log('\nformatObservation renders both unit systems without a refetch');
const m = C.formatObservation(obs, 'metric');
const i = C.formatObservation(obs, 'imperial');
ok('metric uses degC', m.tempUnit === '°C' && m.windUnit === 'km/h');
ok('imperial uses degF', i.tempUnit === '°F' && i.windUnit === 'mph');
near('the two systems describe the same temperature',
   C.fToC(i.temperature), m.temperature, 0.2);
ok('both carry the "feels like" model', m.feelsLikeModel === 'wind-chill');

console.log('\n' + (fail === 0
  ? `✓ all ${pass} checks passing`
  : `✗ ${fail} failed, ${pass} passed`));
process.exit(fail === 0 ? 0 : 1);
