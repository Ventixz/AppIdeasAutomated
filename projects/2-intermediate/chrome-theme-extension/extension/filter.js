// Night-light content script — injected on every page at document_start.
// Overlays a warm, low-opacity wash that cuts perceived blue light. The overlay
// is driven by settings the popup writes into chrome.storage.local, and by the
// time of day when "auto" is enabled.

const EVENING_START = 19; // 7 PM
const MORNING_END = 6; //   6 AM
const DEFAULTS = { forced: false, auto: true, strength: 0.4 };

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
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      background: "#ff8c1a",
      mixBlendMode: "multiply",
      opacity: "0",
      transition: "opacity .4s ease",
    });
    // documentElement exists at document_start even before <body>.
    document.documentElement.appendChild(el);
  }
  return el;
}

function apply() {
  chrome.storage.local.get(DEFAULTS, (s) => {
    const on = s.forced || (s.auto && isEvening());
    ensureOverlay().style.opacity = on ? String(s.strength) : "0";
  });
}

apply();
setInterval(apply, 60 * 1000); // re-check each minute so auto flips at 19:00
chrome.storage.onChanged.addListener(apply); // react instantly to popup toggles
