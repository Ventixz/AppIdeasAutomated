"use strict";

const form = document.getElementById("form");
const cityEl = document.getElementById("city");
const statusEl = document.getElementById("status");
const cardEl = document.getElementById("card");
const appEl = document.getElementById("app");

const placeEl = document.getElementById("place");
const localTimeEl = document.getElementById("local-time");
const dayNightEl = document.getElementById("daynight");
const iconEl = document.getElementById("icon");
const tempEl = document.getElementById("temp");
const conditionEl = document.getElementById("condition");
const feelsEl = document.getElementById("feels");
const humidityEl = document.getElementById("humidity");
const windEl = document.getElementById("wind");

const STORAGE_KEY = "weather-app:last-city";

// WMO weather interpretation codes → { text, day emoji, night emoji }.
// https://open-meteo.com/en/docs#weathervariables
const WEATHER = {
  0:  ["Clear sky", "☀️", "🌙"],
  1:  ["Mainly clear", "🌤️", "🌙"],
  2:  ["Partly cloudy", "⛅", "☁️"],
  3:  ["Overcast", "☁️", "☁️"],
  45: ["Fog", "🌫️", "🌫️"],
  48: ["Rime fog", "🌫️", "🌫️"],
  51: ["Light drizzle", "🌦️", "🌧️"],
  53: ["Drizzle", "🌦️", "🌧️"],
  55: ["Heavy drizzle", "🌧️", "🌧️"],
  56: ["Freezing drizzle", "🌧️", "🌧️"],
  57: ["Freezing drizzle", "🌧️", "🌧️"],
  61: ["Light rain", "🌦️", "🌧️"],
  63: ["Rain", "🌧️", "🌧️"],
  65: ["Heavy rain", "🌧️", "🌧️"],
  66: ["Freezing rain", "🌧️", "🌧️"],
  67: ["Freezing rain", "🌧️", "🌧️"],
  71: ["Light snow", "🌨️", "🌨️"],
  73: ["Snow", "🌨️", "🌨️"],
  75: ["Heavy snow", "❄️", "❄️"],
  77: ["Snow grains", "🌨️", "🌨️"],
  80: ["Rain showers", "🌦️", "🌧️"],
  81: ["Rain showers", "🌧️", "🌧️"],
  82: ["Violent rain showers", "⛈️", "⛈️"],
  85: ["Snow showers", "🌨️", "🌨️"],
  86: ["Snow showers", "❄️", "❄️"],
  95: ["Thunderstorm", "⛈️", "⛈️"],
  96: ["Thunderstorm w/ hail", "⛈️", "⛈️"],
  99: ["Thunderstorm w/ hail", "⛈️", "⛈️"],
};

function setStatus(message, kind) {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Network error (" + res.status + ")");
  return res.json();
}

// City name → { name, country, latitude, longitude } via Open-Meteo geocoding.
async function geocode(city) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" +
    encodeURIComponent(city);
  const data = await getJSON(url);
  if (!data.results || data.results.length === 0) return null;
  return data.results[0];
}

// Coordinates → current-weather object from Open-Meteo forecast.
async function getWeather(lat, lon) {
  const url =
    "https://api.open-meteo.com/v1/forecast?timezone=auto" +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature," +
    "weather_code,wind_speed_10m,is_day" +
    "&latitude=" + lat + "&longitude=" + lon;
  return getJSON(url);
}

function formatLocalTime(isoString) {
  // Open-Meteo returns local time as "2026-07-09T14:00". Reformat for display
  // without letting the browser reinterpret it in the user's own zone.
  const t = isoString.split("T")[1] || "";
  return t ? "Local time " + t : "";
}

function render(place, weather) {
  const c = weather.current;
  const code = c.weather_code;
  const isDay = c.is_day === 1;
  const [text, dayIcon, nightIcon] = WEATHER[code] || ["Unknown", "🌡️", "🌡️"];

  const country = place.country ? ", " + place.country : "";
  placeEl.textContent = place.name + country;
  localTimeEl.textContent = formatLocalTime(c.time);

  iconEl.textContent = isDay ? dayIcon : nightIcon;
  tempEl.textContent = Math.round(c.temperature_2m);
  conditionEl.textContent = text;
  feelsEl.textContent = Math.round(c.apparent_temperature);
  humidityEl.textContent = Math.round(c.relative_humidity_2m);
  windEl.textContent = Math.round(c.wind_speed_10m);

  dayNightEl.textContent = isDay ? "☀ Day" : "☾ Night";
  dayNightEl.className = "daynight " + (isDay ? "day" : "night");
  document.body.classList.toggle("is-night", !isDay);

  cardEl.hidden = false;
}

async function lookup(city, { save } = { save: true }) {
  const name = city.trim();
  if (!name) {
    setStatus("Please enter a city name.", "err");
    return;
  }

  setStatus("Searching for " + name + "…", "loading");
  cardEl.hidden = true;

  try {
    const place = await geocode(name);
    if (!place) {
      setStatus('No city found for "' + name + '". Check the spelling?', "err");
      return;
    }
    const weather = await getWeather(place.latitude, place.longitude);
    render(place, weather);
    setStatus("");
    if (save) localStorage.setItem(STORAGE_KEY, name);
  } catch (err) {
    setStatus("Could not load weather: " + err.message, "err");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  lookup(cityEl.value);
});

// Bonus: on load, restore the last searched city and refresh its weather.
const last = localStorage.getItem(STORAGE_KEY);
if (last) {
  cityEl.value = last;
  lookup(last, { save: false });
}
