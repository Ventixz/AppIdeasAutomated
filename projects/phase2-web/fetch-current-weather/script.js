'use strict';
/* script.js — browser glue. All math is in window.WeatherCore; this file only
 * reads the DOM, calls fetch, and paints. When the network is blocked (common
 * in sandboxes) the search falls back to a canned observation so the pipeline's
 * output is still visible, and the sliders + WMO table need no network at all. */
(function () {
  const C = window.WeatherCore;
  const $ = (id) => document.getElementById(id);

  // ---------- 1. city search ----------
  const form = $('search-form'), placeEl = $('place'), statusEl = $('status');
  const candEl = $('candidates'), resultEl = $('result'), imperialEl = $('imperial');

  function system() { return imperialEl.checked ? 'imperial' : 'metric'; }

  async function getJson(url) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function setStatus(msg, isErr) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  function renderCandidates(cands) {
    candEl.hidden = false;
    candEl.innerHTML = '';
    cands.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'cand';
      b.innerHTML = `<b>${c.label}</b> &nbsp;<span class="pop">` +
        `${c.latitude.toFixed(2)}, ${c.longitude.toFixed(2)}` +
        (c.population ? ` &middot; pop ${c.population.toLocaleString()}` : '') + `</span>`;
      b.onclick = () => fetchForCoords(c.latitude, c.longitude, c.label);
      candEl.appendChild(b);
    });
  }

  let lastObs = null;  // remembered so the unit toggle can re-render without a refetch
  function renderObservation(obs, place) {
    lastObs = { obs, place };
    const f = C.formatObservation(obs, system());
    const feelsNote = f.feelsLikeModel === 'none' ? 'same as air' : f.feelsLikeModel;
    resultEl.hidden = false;
    resultEl.innerHTML =
      `<dl class="obs">
        <div class="big">
          <span class="glyph">${f.icon}</span>
          <div>
            <div class="temp">${f.temperature}${f.tempUnit}</div>
            <div class="place">${place || ''} &middot; ${f.conditions}</div>
          </div>
        </div>
        <dt>Feels like</dt><dd>${f.feelsLike}${f.tempUnit} <span class="pop">(${feelsNote})</span></dd>
        <dt>Humidity</dt><dd>${f.humidity == null ? 'n/a' : f.humidity + '%'}</dd>
        <dt>Wind</dt><dd>${f.wind} ${f.windUnit}${f.windFrom ? ' from ' + f.windFrom : ''}</dd>
        ${obs.pressureHPa != null ? `<dt>Pressure</dt><dd>${Math.round(obs.pressureHPa)} hPa</dd>` : ''}
        ${obs.precipitationMm != null ? `<dt>Precipitation</dt><dd>${obs.precipitationMm} mm</dd>` : ''}
        ${obs.time ? `<dt>Observed</dt><dd>${obs.time}${obs.timezone ? ' (' + obs.timezone + ')' : ''}</dd>` : ''}
      </dl>`;
  }

  // Canned fallback used when the forecast fetch is blocked.
  const DEMO = {
    latitude: 64.15, longitude: -21.94, elevation: 61, timezone: 'Atlantic/Reykjavik',
    current: { time: '(demo data)', is_day: 1, temperature_2m: -2.0,
      relative_humidity_2m: 81, apparent_temperature: -9.1, weather_code: 73,
      wind_speed_10m: 38, wind_direction_10m: 350, precipitation: 0.4, surface_pressure: 998.0 },
  };

  async function fetchForCoords(lat, lon, label) {
    candEl.hidden = true;
    setStatus('Fetching current conditions…');
    try {
      const obs = C.parseForecastResponse(await getJson(C.buildForecastUrl(lat, lon)));
      setStatus('');
      renderObservation(obs, label);
    } catch (err) {
      setStatus('Network blocked — showing canned demo data instead. (' + err.message + ')', true);
      renderObservation(C.parseForecastResponse(DEMO), 'Reykjavik, Iceland (demo)');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = placeEl.value.trim();
    if (!q) return;
    resultEl.hidden = true; candEl.hidden = true;
    setStatus('Geocoding “' + q + '”…');
    try {
      const cands = C.parseGeocodeResponse(await getJson(C.buildGeocodeUrl(q)));
      if (cands.length === 0) { setStatus('No place found matching that name.', true); return; }
      setStatus(cands.length + ' match' + (cands.length > 1 ? 'es' : '') + ' — pick one:');
      renderCandidates(cands);
    } catch (err) {
      setStatus('Geocoding blocked — showing canned demo data instead. (' + err.message + ')', true);
      renderObservation(C.parseForecastResponse(DEMO), 'Reykjavik, Iceland (demo)');
    }
  });

  imperialEl.addEventListener('change', () => {
    // Re-render the last observation in the new units, if one is shown.
    if (lastObs) renderObservation(lastObs.obs, lastObs.place);
  });

  // ---------- 2. feels-like sliders ----------
  const t = $('t'), w = $('w'), h = $('h');
  const tOut = $('t-out'), wOut = $('w-out'), hOut = $('h-out');
  const airVal = $('air-val'), feelsVal = $('feels-val'), feelsModel = $('feels-model'), feelsExplain = $('feels-explain');

  function updateFeels() {
    const tc = parseFloat(t.value), wk = parseFloat(w.value), rh = parseFloat(h.value);
    tOut.innerHTML = tc + ' &deg;C'; wOut.textContent = wk + ' km/h'; hOut.textContent = rh + ' %';
    airVal.innerHTML = tc.toFixed(1) + ' &deg;C';
    const a = C.apparentTemperatureC(tc, wk, rh);
    feelsVal.innerHTML = a.value.toFixed(1) + ' &deg;C';
    feelsModel.className = 'feels-model ' + a.model;
    const delta = a.value - tc;
    if (a.model === 'wind-chill') {
      feelsModel.textContent = 'wind chill';
      feelsExplain.innerHTML = `Below 10&nbsp;&deg;C with wind over 4.8&nbsp;km/h, the wind-chill ` +
        `formula applies: the wind makes it feel <b>${Math.abs(delta).toFixed(1)}&nbsp;&deg;C colder</b> than the air.`;
    } else if (a.model === 'heat-index') {
      feelsModel.textContent = 'heat index';
      feelsExplain.innerHTML = `At or above 27&nbsp;&deg;C (80&nbsp;&deg;F), humidity drives the heat index: ` +
        `it feels <b>${delta.toFixed(1)}&nbsp;&deg;C hotter</b> than the air because sweat can't evaporate.`;
    } else {
      feelsModel.textContent = 'raw air temp';
      feelsExplain.innerHTML = `Neither domain applies here &mdash; it's not cold-and-windy enough for ` +
        `wind chill nor hot enough for heat index &mdash; so the feels-like <em>is</em> the air temperature. ` +
        `Applying either formula here would be wrong.`;
    }
  }
  [t, w, h].forEach((el) => el.addEventListener('input', updateFeels));
  updateFeels();

  // ---------- 3. WMO grid ----------
  const grid = $('wmo-grid'), detail = $('wmo-detail');
  Object.keys(C.WMO).map(Number).sort((a, b) => a - b).forEach((code) => {
    const d = C.describeWeatherCode(code);
    const cell = document.createElement('div');
    cell.className = 'wmo-cell';
    cell.innerHTML = `<div class="wi">${d.icon}</div><div class="wc">${code}</div>`;
    cell.title = d.label;
    cell.onclick = () => {
      detail.hidden = false;
      detail.innerHTML = `<span class="wi">${d.icon}</span> <b>Code ${code}</b> &mdash; ${d.label} ` +
        `<span class="pop">(group: ${d.group})</span>`;
    };
    grid.appendChild(cell);
  });
})();
