// Pomodoro Clock — a 25-minute work timer alternating with breaks.
// No libraries: the countdown is driven by setInterval and the end-of-session
// chime is synthesised with the Web Audio API, so there are no asset files.

const phaseEl = document.getElementById("phase");
const timeEl = document.getElementById("time");
const roundEl = document.getElementById("round");
const dial = document.getElementById("dial");

const startPauseBtn = document.getElementById("startPause");
const stopBtn = document.getElementById("stop");
const resetBtn = document.getElementById("reset");

const workInput = document.getElementById("workMin");
const shortInput = document.getElementById("shortMin");
const longInput = document.getElementById("longMin");

// Every 4th break is a long break.
const LONG_BREAK_EVERY = 4;

// Read a duration input, clamped to its min/max, falling back to its default.
function minutes(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Math.round(Number(input.value));
  if (!Number.isFinite(value)) return Number(input.defaultValue);
  return Math.min(max, Math.max(min, value));
}

const state = {
  phase: "work", // "work" | "short" | "long"
  remaining: minutes(workInput) * 60, // seconds left in this session
  running: false,
  completedWork: 0, // work sessions finished — picks short vs long break
  timer: null,
};

const pad = (n) => String(n).padStart(2, "0");

function format(seconds) {
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

function phaseLabel(phase) {
  return phase === "work" ? "Work" : phase === "long" ? "Long Break" : "Break";
}

// How long the given phase should last, in seconds, from current settings.
function durationFor(phase) {
  if (phase === "work") return minutes(workInput) * 60;
  if (phase === "long") return minutes(longInput) * 60;
  return minutes(shortInput) * 60;
}

function render() {
  phaseEl.textContent = phaseLabel(state.phase);
  timeEl.textContent = format(state.remaining);
  document.title = `${format(state.remaining)} · ${phaseLabel(state.phase)}`;

  const untilLong = LONG_BREAK_EVERY - (state.completedWork % LONG_BREAK_EVERY);
  roundEl.textContent =
    `Round ${state.completedWork + 1} · long break in ${untilLong}`;

  dial.dataset.phase = state.phase;
  startPauseBtn.textContent = state.running ? "Pause" : "Start";
}

function tick() {
  state.remaining -= 1;
  if (state.remaining <= 0) {
    chime();
    advance();
  }
  render();
}

// Move to the next session: work -> break -> work, with a long break every 4th.
function advance() {
  if (state.phase === "work") {
    state.completedWork += 1;
    const isLong = state.completedWork % LONG_BREAK_EVERY === 0;
    state.phase = isLong ? "long" : "short";
  } else {
    state.phase = "work";
  }
  state.remaining = durationFor(state.phase);
}

function start() {
  if (state.running) return;
  state.running = true;
  state.timer = setInterval(tick, 1000);
  render();
}

function pause() {
  state.running = false;
  clearInterval(state.timer);
  state.timer = null;
  render();
}

// Stop ends the current session and rewinds it to full, but keeps the round
// count so you stay where you were in the work/break cycle.
function stop() {
  pause();
  state.remaining = durationFor(state.phase);
  render();
}

// Reset returns everything to a fresh first work session.
function reset() {
  pause();
  state.phase = "work";
  state.completedWork = 0;
  state.remaining = durationFor("work");
  render();
}

startPauseBtn.addEventListener("click", () => {
  state.running ? pause() : start();
});
stopBtn.addEventListener("click", stop);
resetBtn.addEventListener("click", reset);

// If a duration changes while that session is idle at full length, reflect it
// immediately so the displayed time matches the new setting.
for (const input of [workInput, shortInput, longInput]) {
  input.addEventListener("change", () => {
    if (state.running) return;
    state.remaining = durationFor(state.phase);
    render();
  });
}

// --- End-of-session chime, synthesised so no audio file is needed. ----------
let audioCtx;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    // Three short ascending beeps.
    [880, 1100, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const at = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.18);
    });
  } catch {
    /* Web Audio unavailable — the timer still works silently. */
  }
}

render();
