// Key Value — show how the browser encodes each keystroke via KeyboardEvent.

const keyValueEl = document.getElementById("keyValue");
const keyCodeEl = document.getElementById("keyCode");
const fields = document.querySelectorAll(".field");
const soundToggle = document.getElementById("soundToggle");

const modifiers = {
  altKey: document.getElementById("mod-alt"),
  ctrlKey: document.getElementById("mod-ctrl"),
  metaKey: document.getElementById("mod-meta"),
  shiftKey: document.getElementById("mod-shift"),
};

// Lazily create one AudioContext; browsers require a user gesture to start it,
// and the first keypress counts as that gesture.
let audioCtx = null;

function playTone() {
  if (!soundToggle.checked) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch {
    // Web Audio unavailable — ignore, the rest of the app still works.
  }
}

function describeValue(event) {
  // event.key is " " for the spacebar and a printable string for most keys.
  if (event.key === " ") return "Space";
  return event.key;
}

document.addEventListener("keydown", (event) => {
  // Don't hijack the sound checkbox's own keyboard interaction.
  if (event.target === soundToggle && (event.key === " " || event.key === "Enter")) return;

  event.preventDefault();

  keyValueEl.textContent = describeValue(event);
  keyCodeEl.textContent = event.code || event.keyCode;

  for (const [prop, el] of Object.entries(modifiers)) {
    const on = event[prop];
    el.classList.toggle("active", on);
    el.querySelector(".state").textContent = on ? "True" : "False";
  }

  // Bonus: flash the readout background on each press.
  fields.forEach((f) => {
    f.classList.remove("flash");
    // Force reflow so the class can re-trigger the transition on rapid presses.
    void f.offsetWidth;
    f.classList.add("flash");
  });

  playTone();
});

// Clear the flash and reset modifier indicators when keys are released.
document.addEventListener("keyup", (event) => {
  fields.forEach((f) => f.classList.remove("flash"));
  for (const [prop, el] of Object.entries(modifiers)) {
    if (!event[prop]) {
      el.classList.remove("active");
      el.querySelector(".state").textContent = "False";
    }
  }
});

// Keep focus on the panel so keystrokes are always captured.
const panel = document.querySelector(".panel");
panel.focus();
