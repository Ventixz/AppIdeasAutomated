// Color Cycle — drift a swatch through RGB space one increment at a time.

const swatch = document.getElementById("swatch");
const readout = document.getElementById("readout");
const warning = document.getElementById("warning");
const toggle = document.getElementById("toggle");
const controls = document.getElementById("controls");
const formatSel = document.getElementById("format");
const intervalInput = document.getElementById("interval");

const channels = {
  r: { hex: document.getElementById("start-r"), incr: document.getElementById("incr-r") },
  g: { hex: document.getElementById("start-g"), incr: document.getElementById("incr-g") },
  b: { hex: document.getElementById("start-b"), incr: document.getElementById("incr-b") },
};

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

let timer = null;
let current = { r: 0, g: 0, b: 0 }; // live values, 0–255

// --- Validation -------------------------------------------------------------

function validate() {
  let ok = true;
  for (const key of ["r", "g", "b"]) {
    const field = channels[key].hex;
    const valid = HEX_PAIR.test(field.value.trim());
    field.classList.toggle("invalid", !valid);
    if (!valid) ok = false;
  }
  warning.hidden = ok;
  return ok;
}

// --- Color formatting -------------------------------------------------------

function clampByte(n) {
  // wrap into 0–255 so cycling never sticks at the edges
  return ((Math.round(n) % 256) + 256) % 256;
}

function toHex(n) {
  return clampByte(n).toString(16).padStart(2, "0").toUpperCase();
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function describe({ r, g, b }) {
  switch (formatSel.value) {
    case "hex":
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    case "hsl": {
      const [h, s, l] = rgbToHsl(clampByte(r), clampByte(g), clampByte(b));
      return `hsl(${h}, ${s}%, ${l}%)`;
    }
    default:
      return `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
  }
}

function render() {
  const css = `rgb(${clampByte(current.r)}, ${clampByte(current.g)}, ${clampByte(current.b)})`;
  swatch.style.backgroundColor = css;
  readout.textContent = describe(current);
}

// --- Cycle control ----------------------------------------------------------

function step() {
  for (const key of ["r", "g", "b"]) {
    const inc = Number(channels[key].incr.value) || 0;
    current[key] = clampByte(current[key] + inc);
  }
  render();
}

function start() {
  if (!validate()) return;

  for (const key of ["r", "g", "b"]) {
    current[key] = parseInt(channels[key].hex.value, 16);
  }
  render();

  const ms = Math.max(50, Number(intervalInput.value) || 250);
  timer = setInterval(step, ms);

  toggle.textContent = "Stop";
  toggle.classList.add("running");
  controls.classList.add("running");
  setInputsDisabled(true);
}

function stop() {
  clearInterval(timer);
  timer = null;
  toggle.textContent = "Start";
  toggle.classList.remove("running");
  controls.classList.remove("running");
  setInputsDisabled(false);
}

function setInputsDisabled(disabled) {
  // Channel + interval/format inputs are only editable while stopped.
  for (const key of ["r", "g", "b"]) {
    channels[key].hex.disabled = disabled;
    channels[key].incr.disabled = disabled;
  }
  intervalInput.disabled = disabled;
  formatSel.disabled = disabled;
}

// --- Wiring -----------------------------------------------------------------

toggle.addEventListener("click", () => (timer ? stop() : start()));

for (const key of ["r", "g", "b"]) {
  channels[key].hex.addEventListener("input", validate);
}

// Re-render the readout if the format changes while stopped.
formatSel.addEventListener("change", render);

// Initial paint.
validate();
render();
