"use strict";

/*
 * Bit Masks — city timezone search.
 *
 * The whole point of this project is to answer "which cities are in GMT offset
 * N?" WITHOUT chains of if/switch or `city.gmtOffset === searchOffset`. Instead
 * every timezone from GMT +12 down to GMT -12 gets its own bit position inside
 * a single 25-bit mask, and matching is done with bitwise AND.
 *
 * Bit layout (position = offset + 12):
 *   GMT +12 -> bit 24 ... GMT 0 -> bit 12 ... GMT -12 -> bit 0
 */

// Map a GMT offset (-12..+12) to a single-bit mask.
function zoneBit(offset) {
  return 1 << (offset + 12);
}

// The 16 cities, spanning GMT +9 down to GMT -7 per the spec.
const CITIES = [
  { name: "Tokyo", gmt: 9 },
  { name: "Seoul", gmt: 9 },
  { name: "Beijing", gmt: 8 },
  { name: "Bangkok", gmt: 7 },
  { name: "Dhaka", gmt: 6 },
  { name: "Karachi", gmt: 5 },
  { name: "Dubai", gmt: 4 },
  { name: "Moscow", gmt: 3 },
  { name: "Cairo", gmt: 2 },
  { name: "Berlin", gmt: 1 },
  { name: "London", gmt: 0 },
  { name: "Praia", gmt: -1 },
  { name: "São Paulo", gmt: -3 },
  { name: "New York", gmt: -5 },
  { name: "Chicago", gmt: -6 },
  { name: "Denver", gmt: -7 },
];

// Precompute each city's timezone bit once.
CITIES.forEach((c) => {
  c.bit = zoneBit(c.gmt);
});

const els = {
  gmtInput: document.getElementById("gmt-input"),
  findBtn: document.getElementById("find-btn"),
  invert: document.getElementById("invert-toggle"),
  summary: document.getElementById("summary"),
  results: document.getElementById("results-list"),
  cityList: document.getElementById("city-list"),
  checkAll: document.getElementById("check-all"),
  uncheckAll: document.getElementById("uncheck-all"),
};

// Format a GMT offset like "+9", "0", "-7".
function fmtGmt(gmt) {
  return gmt > 0 ? `+${gmt}` : `${gmt}`;
}

// Render the 25-bit mask as a compact string of dots/ones, MSB (GMT +12) first.
function bitString(mask) {
  let s = "";
  for (let pos = 24; pos >= 0; pos--) {
    s += (mask >> pos) & 1 ? "1" : "·";
  }
  return s;
}

// Build the city rows, each with a checkbox (checked by default).
function renderCities() {
  els.cityList.innerHTML = "";
  CITIES.forEach((city, i) => {
    const li = document.createElement("li");
    li.className = "city";

    const label = document.createElement("label");
    label.className = "city__label";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.className = "city__box";
    box.dataset.index = String(i);

    const name = document.createElement("span");
    name.className = "city__name";
    name.textContent = city.name;

    const zone = document.createElement("span");
    zone.className = "city__zone";
    zone.textContent = `GMT ${fmtGmt(city.gmt)}`;

    const bits = document.createElement("code");
    bits.className = "city__bits";
    bits.textContent = bitString(city.bit);

    label.append(box, name, zone, bits);
    li.append(label);
    els.cityList.append(li);
  });
}

// Combine the checked cities' bits into one selection mask.
function selectionMask() {
  let mask = 0;
  els.cityList.querySelectorAll(".city__box").forEach((box) => {
    if (box.checked) {
      const city = CITIES[Number(box.dataset.index)];
      mask |= city.bit;
    }
  });
  return mask;
}

function runSearch() {
  const raw = parseInt(els.gmtInput.value, 10);
  if (Number.isNaN(raw) || raw < -12 || raw > 12) {
    els.summary.textContent = "Enter a GMT offset between -12 and +12.";
    els.results.innerHTML = "";
    return;
  }

  const searchMask = zoneBit(raw);
  const inverted = els.invert.checked;
  const selected = selectionMask();

  // Bitwise matching only — no offset equality checks anywhere below.
  const matches = CITIES.filter((city) => {
    const isSelected = (city.bit & selected) !== 0;
    if (!isSelected) return false;
    const inZone = (city.bit & searchMask) !== 0;
    return inverted ? !inZone : inZone;
  });

  els.results.innerHTML = "";
  matches.forEach((city) => {
    const li = document.createElement("li");
    li.className = "result";
    li.innerHTML = `<span class="result__name">${city.name}</span>
      <span class="result__zone">GMT ${fmtGmt(city.gmt)}</span>`;
    els.results.append(li);
  });

  const verb = inverted ? "outside" : "in";
  els.summary.textContent =
    matches.length === 0
      ? `No selected cities ${verb} GMT ${fmtGmt(raw)}.`
      : `${matches.length} ${matches.length === 1 ? "city" : "cities"} ${verb} GMT ${fmtGmt(raw)}.`;
}

function setAll(checked) {
  els.cityList
    .querySelectorAll(".city__box")
    .forEach((box) => (box.checked = checked));
}

els.findBtn.addEventListener("click", runSearch);
els.gmtInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});
els.checkAll.addEventListener("click", () => setAll(true));
els.uncheckAll.addEventListener("click", () => setAll(false));

renderCities();
runSearch();
