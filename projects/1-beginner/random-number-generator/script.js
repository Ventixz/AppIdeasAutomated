const form = document.getElementById("form");
const minInput = document.getElementById("min");
const maxInput = document.getElementById("max");
const decimalsInput = document.getElementById("decimals");
const placesWrap = document.querySelector(".places");
const placesInput = document.getElementById("places");
const numberEl = document.getElementById("number");
const resultEl = document.getElementById("result");
const errorEl = document.getElementById("error");

// The "Places" field is only meaningful when decimals are allowed.
function syncPlacesState() {
  placesWrap.dataset.enabled = String(decimalsInput.checked);
}
decimalsInput.addEventListener("change", syncPlacesState);
syncPlacesState();

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
}

function generate() {
  clearError();

  const min = parseFloat(minInput.value);
  const max = parseFloat(maxInput.value);

  // Empty or non-numeric input parses to NaN — negatives are perfectly valid.
  if (Number.isNaN(min) || Number.isNaN(max)) {
    showError("Enter a number for both minimum and maximum.");
    return;
  }
  if (min > max) {
    showError("Minimum can't be larger than maximum.");
    return;
  }

  let value;
  if (decimalsInput.checked) {
    const places = clampPlaces(parseInt(placesInput.value, 10));
    // Round to the requested precision, then re-parse to drop trailing zeros.
    value = parseFloat((Math.random() * (max - min) + min).toFixed(places));
  } else {
    // Inclusive of both ends. Math.floor keeps whole-number ranges honest even
    // when the user typed decimals into the min/max fields.
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (lo > hi) {
      showError("No whole number lives in that range — try allowing decimals.");
      return;
    }
    value = Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  render(value);
}

function clampPlaces(places) {
  if (Number.isNaN(places) || places < 0) return 0;
  return Math.min(places, 10);
}

function render(value) {
  numberEl.textContent = value.toLocaleString(undefined, {
    maximumFractionDigits: 10,
  });
  resultEl.classList.remove("pop");
  // Force reflow so the animation restarts on every generate.
  void resultEl.offsetWidth;
  resultEl.classList.add("pop");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  generate();
});
