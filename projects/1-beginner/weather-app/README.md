# Weather App

Type a city, press Enter, and see its current weather — temperature, condition,
day/night status, and a matching icon — with the details (feels-like, humidity,
wind) below.

Source idea: [app-ideas / Weather App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Weather-App.md)

## Features

- **City search** — enter a city name and submit (Enter or the button) to update
  the display with live weather.
- **Current conditions** — temperature, a WMO-code condition label, feels-like,
  humidity, and wind speed.
- **Day / night** — a badge and a matching icon (☀️ vs 🌙), plus the whole page
  shifts to a darker palette at night.
- **Helpful errors** — an empty box or an unknown city shows a clear message
  instead of failing silently.
- **Remembers your city** *(bonus)* — the last successful search is saved to
  `localStorage`, so reopening the page automatically refreshes that city's
  weather.

## A note on the API

The original spec suggests AccuWeather, which requires an API key. Since these
projects are dependency-free static pages with no server to hide a secret in,
this build uses [**Open-Meteo**](https://open-meteo.com) instead — a free,
key-less, CORS-friendly weather API. Two calls do the work:

1. **Geocoding** — city name → latitude/longitude
   (`geocoding-api.open-meteo.com/v1/search`).
2. **Forecast** — coordinates → current weather, including a WMO `weather_code`
   and an `is_day` flag (`api.open-meteo.com/v1/forecast`).

The numeric `weather_code` is mapped to a human label and a day/night emoji in
a small lookup table in `script.js`.

## Run it

Open `index.html` in any browser — no build step, no dependencies. An internet
connection is needed for the API calls.
