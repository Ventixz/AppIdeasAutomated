#!/usr/bin/env node
'use strict';
/*
 * weather-node.js — the real I/O layer for "Fetch Current Weather".
 *
 * It runs the two-step pipeline the core describes: geocode a place name to
 * coordinates (names are ambiguous, so a plain name picks the best-populated
 * match and --list shows the alternatives), then fetch the current conditions
 * for those coordinates and print them. All the arithmetic — WMO decoding, the
 * compass, the apparent-temperature model selection — lives in weather-core.js;
 * this file only adds the network, the clock and the argv parsing.
 *
 * Data source: Open-Meteo (open-meteo.com) — free, no API key required.
 * Zero dependencies: Node 18+ global fetch only.
 *
 *   node weather-node.js "Paris"                 # best match, current weather
 *   node weather-node.js "Springfield" --list    # show candidates, don't fetch
 *   node weather-node.js "Tokyo" --imperial      # degF + mph
 *   node weather-node.js --lat 64.14 --lon -21.9 # skip geocoding, use coords
 *   node weather-node.js "Berlin" --json         # machine-readable
 *   node weather-node.js --demo                  # offline: canned data, no network
 */
const C = require('./weather-core.js');

// ---- tiny argv parser (no dependencies) -----------------------------------
function parseArgs(argv) {
  const o = { _: [], system: 'metric' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') o.list = true;
    else if (a === '--json') o.json = true;
    else if (a === '--demo') o.demo = true;
    else if (a === '--imperial') o.system = 'imperial';
    else if (a === '--metric') o.system = 'metric';
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--lat') o.lat = Number(argv[++i]);
    else if (a === '--lon') o.lon = Number(argv[++i]);
    else if (a === '--count') o.count = Number(argv[++i]);
    else o._.push(a);
  }
  return o;
}

const HELP = `Fetch Current Weather — current conditions for a place (Open-Meteo, no API key)

  node weather-node.js <place> [options]
  node weather-node.js --lat <deg> --lon <deg> [options]

Options:
  --list        list geocoding candidates for <place> and stop (don't fetch)
  --imperial    report in degF and mph (default: degC and km/h)
  --json        print the parsed observation as JSON
  --count <n>   number of geocoding candidates to consider (default 5)
  --demo        print a canned observation with no network access
  -h, --help    this help

Examples:
  node weather-node.js "Paris"
  node weather-node.js "Springfield" --list
  node weather-node.js --lat 35.68 --lon 139.69 --imperial
  node weather-node.js "Reykjavik" --json`;

// ---- a timeout-wrapped fetch that returns parsed JSON ---------------------
async function getJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'accept': 'application/json', 'user-agent': 'fetch-current-weather (automated Claude Code routine)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---- pretty printer -------------------------------------------------------
function printObservation(obs, place, system) {
  const f = C.formatObservation(obs, system);
  const where = place || `${obs.coordinates.latitude}, ${obs.coordinates.longitude}`;
  const feelsNote = f.feelsLikeModel === 'none'
    ? '(same as air temp)'
    : `(${f.feelsLikeModel})`;
  const lines = [
    ``,
    `  ${f.icon}  ${where}`,
    `  ${'-'.repeat(Math.max(10, where.length + 4))}`,
    `  Conditions   ${f.conditions}`,
    `  Temperature  ${f.temperature}${f.tempUnit}`,
    `  Feels like   ${f.feelsLike}${f.tempUnit} ${feelsNote}`,
    `  Humidity     ${f.humidity == null ? 'n/a' : f.humidity + '%'}`,
    `  Wind         ${f.wind} ${f.windUnit}${f.windFrom ? ' from ' + f.windFrom : ''}`,
  ];
  if (obs.pressureHPa != null) lines.push(`  Pressure     ${Math.round(obs.pressureHPa)} hPa`);
  if (obs.precipitationMm != null) lines.push(`  Precip       ${obs.precipitationMm} mm`);
  if (obs.time) lines.push(`  Observed     ${obs.time}${obs.timezone ? ' (' + obs.timezone + ')' : ''}`);
  lines.push('');
  console.log(lines.join('\n'));
}

// A canned payload so --demo (and a blocked network) still shows the whole
// pipeline's output. Cold + windy, so the wind-chill model kicks in.
const DEMO_FORECAST = {
  latitude: 64.1466, longitude: -21.9426, elevation: 61, timezone: 'Atlantic/Reykjavik',
  current: {
    time: '2026-11-11T12:00', is_day: 1, temperature_2m: -2.0,
    relative_humidity_2m: 81, apparent_temperature: -9.1, weather_code: 73,
    wind_speed_10m: 38, wind_direction_10m: 350, precipitation: 0.4,
    surface_pressure: 998.0,
  },
};

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || (o._.length === 0 && o.lat == null && !o.demo)) {
    console.log(HELP);
    process.exit(o.help ? 0 : 1);
  }

  if (o.demo) {
    console.log('  [--demo] canned observation, no network used:');
    const obs = C.parseForecastResponse(DEMO_FORECAST);
    printObservation(obs, 'Reykjavik, Iceland', o.system);
    return;
  }

  try {
    let lat = o.lat, lon = o.lon, place = null;

    // Step 1 — geocode, unless explicit coordinates were given.
    if (lat == null || lon == null) {
      const query = o._.join(' ').trim();
      const gurl = C.buildGeocodeUrl(query, { count: o.count || 5 });
      const cands = C.parseGeocodeResponse(await getJson(gurl));
      if (cands.length === 0) {
        console.error(`No place found matching "${query}".`);
        process.exit(2);
      }
      if (o.list) {
        console.log(`\nCandidates for "${query}":`);
        cands.forEach((c, i) =>
          console.log(`  ${i + 1}. ${c.label}  (${c.latitude}, ${c.longitude})` +
            (c.population ? `  pop ${c.population.toLocaleString()}` : '')));
        console.log('');
        return;
      }
      // Pick the most-populated candidate as "the" match — the usual intent of
      // a bare place name — while --list exposes the rest.
      const best = cands.slice().sort((a, b) => (b.population || 0) - (a.population || 0))[0];
      lat = best.latitude; lon = best.longitude; place = best.label;
    }

    // Step 2 — fetch current conditions for the coordinates.
    const furl = C.buildForecastUrl(lat, lon);
    const obs = C.parseForecastResponse(await getJson(furl));

    if (o.json) {
      console.log(JSON.stringify({ place, ...obs, formatted: C.formatObservation(obs, o.system) }, null, 2));
    } else {
      printObservation(obs, place, o.system);
    }
  } catch (err) {
    console.error('\nCould not fetch weather: ' + err.message);
    if (/fetch failed|abort|ENOTFOUND|EAI_AGAIN|network|getaddrinfo/i.test(err.message)) {
      console.error('Open-Meteo may be unreachable on this network. ' +
                    'Try `node weather-node.js --demo` to see the pipeline offline.');
    }
    process.exit(1);
  }
}

main();
