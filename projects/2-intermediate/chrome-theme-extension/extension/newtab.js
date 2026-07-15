// Themed new-tab page. The chosen palette lives in chrome.storage.local so it
// persists across tabs and sessions. A small tray lets the user switch themes.

const PALETTES = [
  { name: "Midnight", ntp: "#0f172a", text: "#f8fafc", accent: "#6366f1" },
  { name: "Blue/Orange", ntp: "#08324a", text: "#ffe8cc", accent: "#ff9e2c" },
  { name: "High contrast", ntp: "#000000", text: "#ffffff", accent: "#ffd500" },
  { name: "Deuteranopia", ntp: "#141d2b", text: "#e6f2ff", accent: "#3b82f6" },
  { name: "Nord", ntp: "#242933", text: "#eceff4", accent: "#88c0d0" },
  { name: "Rose", ntp: "#2b1522", text: "#ffe6f2", accent: "#f472b6" },
  { name: "Forest", ntp: "#10231a", text: "#e7f5ec", accent: "#34d399" },
  { name: "Paper", ntp: "#f5f5f4", text: "#1c1917", accent: "#0ea5e9" },
];

const root = document.documentElement;

function paint(p) {
  root.style.setProperty("--ntp", p.ntp);
  root.style.setProperty("--text", p.text);
  root.style.setProperty("--accent", p.accent);
}

// Load saved theme (default: Midnight).
chrome.storage.local.get({ theme: PALETTES[0] }, (s) => paint(s.theme));

// Build the palette tray.
const tray = document.getElementById("tray");
PALETTES.forEach((p) => {
  const b = document.createElement("button");
  b.style.background = p.accent;
  b.title = p.name;
  b.addEventListener("click", () => {
    paint(p);
    chrome.storage.local.set({ theme: p });
    tray.hidden = true;
  });
  tray.appendChild(b);
});

document.getElementById("palette-btn").addEventListener("click", () => {
  tray.hidden = !tray.hidden;
});

// Clock + greeting.
function tick() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("clock").textContent = `${hh}:${mm}`;
  const h = now.getHours();
  const part =
    h < 6 ? "Still up?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("greet").textContent = part;
}
tick();
setInterval(tick, 1000 * 20);
