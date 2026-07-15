/* Chrome Theme Extension — browser customizer.
 *
 * Runs entirely in the page: design a palette, preview it on a mock browser,
 * play with the night-light blue-light filter, then export a real installable
 * Chrome theme manifest plus the night-light content script.
 */

// ── Palettes ────────────────────────────────────────────────────────────────
// `safe: true` palettes avoid red/green ambiguity and lean on blue/orange and
// luminance contrast, which read reliably for the common forms of color
// blindness (deuteranopia, protanopia).
const PALETTES = [
  {
    name: "Midnight (default)",
    frame: "#1f2937", toolbar: "#111827", ntp: "#0f172a",
    text: "#e5e7eb", accent: "#6366f1", ntptext: "#f8fafc",
  },
  {
    name: "Paper (light)",
    frame: "#e2e8f0", toolbar: "#f8fafc", ntp: "#ffffff",
    text: "#1e293b", accent: "#0ea5e9", ntptext: "#0f172a",
  },
  {
    name: "Blue / Orange", safe: true,
    frame: "#0b3d5c", toolbar: "#0e4d73", ntp: "#08324a",
    text: "#ffd9a8", accent: "#ff9e2c", ntptext: "#ffe8cc",
  },
  {
    name: "High contrast", safe: true,
    frame: "#000000", toolbar: "#000000", ntp: "#000000",
    text: "#ffffff", accent: "#ffd500", ntptext: "#ffffff",
  },
  {
    name: "Deuteranopia calm", safe: true,
    frame: "#1a2332", toolbar: "#22304a", ntp: "#141d2b",
    text: "#cfe8ff", accent: "#3b82f6", ntptext: "#e6f2ff",
  },
  {
    name: "Nord night",
    frame: "#2e3440", toolbar: "#3b4252", ntp: "#242933",
    text: "#d8dee9", accent: "#88c0d0", ntptext: "#eceff4",
  },
  {
    name: "Rose dusk",
    frame: "#3f1f33", toolbar: "#52243f", ntp: "#2b1522",
    text: "#ffd9ec", accent: "#f472b6", ntptext: "#ffe6f2",
  },
];

// ── Element handles ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const inputs = {
  frame: $("c-frame"), toolbar: $("c-toolbar"), ntp: $("c-ntp"),
  text: $("c-text"), accent: $("c-accent"), ntptext: $("c-ntptext"),
};
const browser = $("browser");
const nightlight = $("nightlight");
const nlOn = $("nl-on");
const nlAuto = $("nl-auto");
const nlStrength = $("nl-strength");
const nlStrengthOut = $("nl-strength-out");
const nlStatus = $("nl-status");
const themeName = $("theme-name");

// ── Live theme preview ───────────────────────────────────────────────────────
const VAR_MAP = {
  frame: "--t-frame", toolbar: "--t-toolbar", ntp: "--t-ntp",
  text: "--t-text", accent: "--t-accent", ntptext: "--t-ntptext",
};

function applyTheme() {
  for (const key of Object.keys(inputs)) {
    browser.style.setProperty(VAR_MAP[key], inputs[key].value);
  }
}

Object.values(inputs).forEach((inp) => {
  inp.addEventListener("input", () => {
    presetSelect.value = ""; // editing a color means we're off-preset now
    applyTheme();
  });
});

// ── Preset dropdown ──────────────────────────────────────────────────────────
const presetSelect = $("preset");
PALETTES.forEach((p, i) => {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = p.safe ? `${p.name}  ·  color-safe` : p.name;
  presetSelect.appendChild(opt);
});

function loadPalette(p) {
  inputs.frame.value = p.frame;
  inputs.toolbar.value = p.toolbar;
  inputs.ntp.value = p.ntp;
  inputs.text.value = p.text;
  inputs.accent.value = p.accent;
  inputs.ntptext.value = p.ntptext;
  applyTheme();
}

presetSelect.addEventListener("change", () => {
  const idx = presetSelect.value;
  if (idx === "") return;
  loadPalette(PALETTES[Number(idx)]);
});

$("randomize").addEventListener("click", () => {
  const rand = () =>
    "#" + Math.floor((Math.random() * 0.6 + 0.05) * 0xffffff).toString(16).padStart(6, "0");
  const light = () =>
    "#" + Math.floor((Math.random() * 0.2 + 0.8) * 0xffffff).toString(16).padStart(6, "0");
  inputs.frame.value = rand();
  inputs.toolbar.value = rand();
  inputs.ntp.value = rand();
  inputs.text.value = light();
  inputs.ntptext.value = light();
  inputs.accent.value =
    "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  presetSelect.value = "";
  applyTheme();
});

// ── Night-light logic ────────────────────────────────────────────────────────
// The same decision the extension's background service worker makes: on if the
// user forced it, or if auto is enabled and the local time is in evening hours.
const EVENING_START = 19; // 7 PM
const MORNING_END = 6; //   6 AM

function isEvening(hour) {
  return hour >= EVENING_START || hour < MORNING_END;
}

function nightLightActive(hour) {
  if (nlOn.checked) return true;
  return nlAuto.checked && isEvening(hour);
}

function renderNightLight() {
  const now = new Date();
  const hour = now.getHours();
  const active = nightLightActive(hour);
  const strength = Number(nlStrength.value) / 100;
  nightlight.style.opacity = active ? String(strength) : "0";
  nlStrengthOut.textContent = nlStrength.value + "%";

  if (active) {
    const why = nlOn.checked ? "manual override on" : "auto — it's evening";
    nlStatus.textContent = `🌙 Night light ON (${why}).`;
  } else if (nlAuto.checked) {
    nlStatus.textContent = `☀️ Night light off — auto will switch on at ${EVENING_START}:00.`;
  } else {
    nlStatus.textContent = "☀️ Night light off.";
  }
}

[nlOn, nlAuto, nlStrength].forEach((el) =>
  el.addEventListener("input", renderNightLight)
);

// ── Live clock on the mock new-tab page ──────────────────────────────────────
function tick() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  $("ntp-clock").textContent = `${hh}:${mm}`;
  renderNightLight(); // re-evaluate auto mode as the hour rolls over
}
tick();
setInterval(tick, 1000 * 30);

// ── Export: generate a real Chrome theme + the night-light script ────────────
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildManifest() {
  const c = inputs;
  return {
    manifest_version: 3,
    name: (themeName.value.trim() || "My Theme") + " (color theme)",
    version: "1.0.0",
    description: "A personal Chrome color theme generated by the app-ideas customizer.",
    theme: {
      colors: {
        frame: hexToRgb(c.frame.value),
        toolbar: hexToRgb(c.toolbar.value),
        ntp_background: hexToRgb(c.ntp.value),
        ntp_text: hexToRgb(c.ntptext.value),
        tab_text: hexToRgb(c.text.value),
        tab_background_text: hexToRgb(c.text.value),
        bookmark_text: hexToRgb(c.text.value),
        button_background: hexToRgb(c.accent.value),
      },
      properties: {
        ntp_logo_alternate: 1,
      },
    },
  };
}

function buildFilterJs() {
  const strength = (Number(nlStrength.value) / 100).toFixed(2);
  return `// Night-light content script — injected on every page.
// Overlays a warm, low-opacity wash that cuts blue light after sunset.
// Generated by the app-ideas Chrome Theme customizer.

const EVENING_START = ${EVENING_START};   // 7 PM
const MORNING_END   = ${MORNING_END};    // 6 AM
const STRENGTH      = ${strength}; // 0..0.8

function isEvening() {
  const h = new Date().getHours();
  return h >= EVENING_START || h < MORNING_END;
}

function ensureOverlay() {
  let el = document.getElementById("__nightlight_overlay__");
  if (!el) {
    el = document.createElement("div");
    el.id = "__nightlight_overlay__";
    Object.assign(el.style, {
      position: "fixed", inset: "0", zIndex: "2147483647",
      pointerEvents: "none", background: "#ff8c1a",
      mixBlendMode: "multiply", opacity: "0",
      transition: "opacity .4s ease",
    });
    document.documentElement.appendChild(el);
  }
  return el;
}

function apply() {
  // popup writes { forced, auto, strength } into chrome.storage.local
  chrome.storage.local.get(["forced", "auto", "strength"], (s) => {
    const on = s.forced || ((s.auto ?? true) && isEvening());
    const strength = s.strength ?? STRENGTH;
    ensureOverlay().style.opacity = on ? String(strength) : "0";
  });
}

apply();
setInterval(apply, 60 * 1000);           // re-check each minute
chrome.storage.onChanged.addListener(apply); // react to popup toggles
`;
}

// Files that the tabbed viewer + downloader work from.
let generated = { manifest: "", filter: "" };
let currentFile = "manifest";

function download(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showFile(file) {
  currentFile = file;
  $("code").textContent = generated[file];
  document.querySelectorAll(".tabs__btn").forEach((b) =>
    b.classList.toggle("tabs__btn--active", b.dataset.file === file)
  );
}

$("export").addEventListener("click", () => {
  generated.manifest = JSON.stringify(buildManifest(), null, 2);
  generated.filter = buildFilterJs();

  $("export-out").hidden = false;
  showFile(currentFile);
  $("export-out").scrollIntoView({ behavior: "smooth" });

  download("manifest.json", generated.manifest);
  download("filter.js", generated.filter);
});

document.querySelectorAll(".tabs__btn").forEach((btn) =>
  btn.addEventListener("click", () => showFile(btn.dataset.file))
);

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(generated[currentFile]);
    const done = $("copy-done");
    done.hidden = false;
    setTimeout(() => (done.hidden = true), 1500);
  } catch {
    /* clipboard blocked (e.g. file://) — the code is on screen to copy by hand */
  }
});

// ── Boot ─────────────────────────────────────────────────────────────────────
loadPalette(PALETTES[0]);
renderNightLight();
