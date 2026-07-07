"use strict";

const form = document.getElementById("form");
const tempInput = document.getElementById("temp");
const windInput = document.getElementById("wind");
const result = document.getElementById("result");
const status = document.getElementById("status");
const unitTemp = document.querySelectorAll(".u-temp");
const unitWind = document.querySelectorAll(".u-wind");

// Unit metadata drives the labels and the formula picked at calculation time.
const UNITS = {
  metric: { temp: "°C", wind: "km/h" },
  english: { temp: "°F", wind: "mph" },
};

// Tracks the last-calculated inputs so we can detect an unchanged re-submit
// (bonus #2) and only auto-update when something actually changed (bonus #3).
let lastCalc = null;

function currentUnits() {
  return document.querySelector('input[name="units"]:checked').value;
}

// National Weather Service wind-chill formulas.
//   English: T in °F, V in mph
//   Metric : T in °C, V in km/h
// Both are only physically meaningful for cold temperatures and non-trivial
// wind; outside that range the formula over-reports and we flag it.
function windChill(system, t, v) {
  const p = Math.pow(v, 0.16);
  if (system === "metric") {
    return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
  }
  return 35.74 + 0.6215 * t - 35.75 * p + 0.4275 * t * p;
}

function setStatus(message, kind) {
  status.textContent = message || "";
  status.classList.toggle("is-ok", kind === "ok");
  status.classList.toggle("is-warn", kind === "warn");
}

function showResult(text) {
  result.textContent = text;
}

function reset(message) {
  result.innerHTML = '<span class="placeholder">' + message + "</span>";
}

// Reads and validates the fields. Returns null (and sets a status message)
// when a required value is missing or non-numeric — user story #4.
function readInputs() {
  const tRaw = tempInput.value.trim();
  const vRaw = windInput.value.trim();

  if (tRaw === "" || vRaw === "") {
    setStatus("Please enter both a temperature and a wind speed.", "warn");
    return null;
  }
  const t = Number(tRaw);
  const v = Number(vRaw);
  if (!Number.isFinite(t) || !Number.isFinite(v)) {
    setStatus("Temperature and wind speed must be numbers.", "warn");
    return null;
  }
  if (v < 0) {
    setStatus("Wind speed can't be negative.", "warn");
    return null;
  }
  return { t, v };
}

// Core calculation shared by the button (user story #3) and the live-update
// handler (bonus #3). `interactive` is true only for an explicit Calculate,
// which is the only path that reports the "enter new data" nudge.
function calculate(interactive) {
  const values = readInputs();
  if (!values) {
    if (interactive) reset("Enter a temperature and wind speed, then press Calculate.");
    return;
  }

  const system = currentUnits();
  const { t, v } = values;
  const signature = system + ":" + t + ":" + v;

  // Bonus #2 — nudge when Calculate is pressed without changing anything.
  if (interactive && lastCalc === signature) {
    setStatus("No change since the last calculation — enter new values to recalculate.", "warn");
    return;
  }

  const wc = windChill(system, t, v);
  const u = UNITS[system];
  showResult(wc.toFixed(1) + " " + u.temp);
  lastCalc = signature;

  // Bonus #1 — wind chill should never meet or exceed the actual temperature.
  // When it does, the inputs are outside the formula's valid range.
  if (wc >= t) {
    setStatus(
      "Note: wind chill (" + wc.toFixed(1) + u.temp + ") is not below the actual " +
      "temperature. The formula only applies to cold, windy conditions.",
      "warn"
    );
  } else {
    const feels = (t - wc).toFixed(1);
    setStatus("Feels " + feels + u.temp + " colder than the actual temperature.", "ok");
  }
}

function syncUnitLabels() {
  const u = UNITS[currentUnits()];
  unitTemp.forEach((el) => (el.textContent = u.temp));
  unitWind.forEach((el) => (el.textContent = u.wind));
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  calculate(true);
});

// Bonus #3 — recalculate live as the user edits either value.
[tempInput, windInput].forEach((el) =>
  el.addEventListener("input", () => calculate(false))
);

// Changing the unit system relabels the fields and re-runs against whatever
// numbers are already entered so the result stays consistent with the labels.
document.querySelectorAll('input[name="units"]').forEach((el) =>
  el.addEventListener("change", () => {
    syncUnitLabels();
    lastCalc = null;
    calculate(false);
  })
);

syncUnitLabels();
