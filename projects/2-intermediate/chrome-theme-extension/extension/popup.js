// Popup: read/write the night-light settings in chrome.storage.local. The
// content script and this popup share that state, so a toggle here updates
// every open tab immediately via chrome.storage.onChanged.

const DEFAULTS = { forced: false, auto: true, strength: 0.4 };
const forced = document.getElementById("forced");
const auto = document.getElementById("auto");
const strength = document.getElementById("strength");
const strengthOut = document.getElementById("strength-out");
const state = document.getElementById("state");

const EVENING_START = 19;
const MORNING_END = 6;
const isEvening = () => {
  const h = new Date().getHours();
  return h >= EVENING_START || h < MORNING_END;
};

function renderState() {
  const on = forced.checked || (auto.checked && isEvening());
  if (on) {
    state.textContent = forced.checked
      ? "Active — forced on."
      : "Active — evening auto.";
  } else if (auto.checked) {
    state.textContent = `Idle — auto turns on at ${EVENING_START}:00.`;
  } else {
    state.textContent = "Idle.";
  }
}

function save() {
  chrome.storage.local.set({
    forced: forced.checked,
    auto: auto.checked,
    strength: Number(strength.value) / 100,
  });
  strengthOut.textContent = strength.value + "%";
  renderState();
}

// Load current settings into the controls.
chrome.storage.local.get(DEFAULTS, (s) => {
  forced.checked = s.forced;
  auto.checked = s.auto;
  strength.value = String(Math.round(s.strength * 100));
  strengthOut.textContent = strength.value + "%";
  renderState();
});

[forced, auto].forEach((el) => el.addEventListener("change", save));
strength.addEventListener("input", save);
