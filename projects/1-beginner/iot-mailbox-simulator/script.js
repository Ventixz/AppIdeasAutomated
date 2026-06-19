"use strict";

// --- IOTMailbox -----------------------------------------------------------
// A faithful port of the IOTMailbox class described in the app-ideas spec.
// It "monitors" a physical mailbox by sampling a light sensor on a fixed
// interval. A bright reading means the door is open (mail being delivered);
// a dark reading means it is closed. Each sample is handed back to the caller
// through the callback passed to startMonitoring — the callback-driven state
// communication is the whole point of the exercise.
class IOTMailbox {
  constructor(signalInterval = 500) {
    this.signalInterval = signalInterval;
    this.intervalID = null;
    this.lastLightLevel = 0;
    // Light level above this threshold is treated as "door open".
    this.lightThreshold = 0.5;
  }

  // Begin sampling. `callback` receives the current light level on each tick.
  startMonitoring(callback) {
    this.intervalID = setInterval(() => {
      this.lastLightLevel = Math.random();
      callback(this.lastLightLevel);
    }, this.signalInterval);
  }

  // Stop sampling and clear the timer so no further callbacks fire.
  stopMonitoring() {
    if (this.intervalID) {
      clearInterval(this.intervalID);
      this.intervalID = null;
    }
  }

  // True when the most recent reading indicates an open door.
  get isOpen() {
    return this.lastLightLevel > this.lightThreshold;
  }
}

// --- DOM references -------------------------------------------------------
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const resetBtn = document.getElementById("reset-btn");
const clearLogBtn = document.getElementById("clear-log-btn");
const intervalInput = document.getElementById("interval");

const mailboxEl = document.getElementById("mailbox");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

// --- State ----------------------------------------------------------------
let mailbox = null;
let monitoring = false;
let wasOpen = false; // tracks edge transitions so we only notify on change

// --- Audible alert (bonus) ------------------------------------------------
// A short beep synthesised with the Web Audio API — no asset files needed.
function playAlert() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    /* audio is best-effort; ignore failures */
  }
}

// --- Logging --------------------------------------------------------------
function log(message, kind = "info") {
  const li = document.createElement("li");
  li.className = `log__entry log__entry--${kind}`;
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `<span class="log__time">${time}</span> ${message}`;
  logEl.appendChild(li);
  logEl.scrollTop = logEl.scrollHeight;
}

// --- Notification panel ---------------------------------------------------
function setStatus(message, open) {
  statusEl.textContent = message;
  mailboxEl.textContent = open ? "📬" : "📪";
  mailboxEl.classList.toggle("mailbox--open", open);
  mailboxEl.classList.toggle("mailbox--closed", !open);
}

// --- The callback ---------------------------------------------------------
// Called by IOTMailbox on every sample. It logs the reading and reacts to
// door open/close transitions: notify + beep on open, note when it stays open.
function onLightLevel(level) {
  const open = level > mailbox.lightThreshold;
  const pct = (level * 100).toFixed(0);
  log(`Light callback — level ${pct}% → door ${open ? "OPEN" : "closed"}.`,
    open ? "open" : "info");

  if (open && !wasOpen) {
    setStatus("📬 Mail just arrived — the door opened!", true);
    log("Notification: the mailbox door opened.", "open");
    playAlert();
  } else if (open && wasOpen) {
    // Bonus: warn if the door is still hanging open.
    setStatus("⚠️ The mailbox door is still open.", true);
  } else if (!open && wasOpen) {
    setStatus("Door closed — waiting for the next delivery.", false);
    log("Notification: the mailbox door closed.", "info");
  }

  wasOpen = open;
}

// --- Controls -------------------------------------------------------------
function startMonitoring() {
  if (monitoring) return;

  const interval = Math.max(200, Number(intervalInput.value) || 1000);
  mailbox = new IOTMailbox(interval);
  monitoring = true;
  wasOpen = false;

  mailbox.startMonitoring(onLightLevel);
  log(`Monitoring started (sampling every ${interval} ms).`, "system");
  setStatus("Monitoring… watching for deliveries.", false);

  startBtn.disabled = true;
  stopBtn.disabled = false;
  intervalInput.disabled = true;
}

function stopMonitoring() {
  if (!monitoring) return;

  mailbox.stopMonitoring();
  monitoring = false;
  log("Monitoring stopped.", "system");
  setStatus("Idle — monitoring is stopped.", false);

  startBtn.disabled = false;
  stopBtn.disabled = true;
  intervalInput.disabled = false;
}

function reset() {
  if (monitoring) stopMonitoring();
  wasOpen = false;
  logEl.innerHTML = "";
  setStatus("Idle — monitoring is stopped.", false);
  intervalInput.value = 1000;
  log("Simulator reset.", "system");
}

// --- Wire it up -----------------------------------------------------------
startBtn.addEventListener("click", startMonitoring);
stopBtn.addEventListener("click", stopMonitoring);
resetBtn.addEventListener("click", reset);
clearLogBtn.addEventListener("click", () => { logEl.innerHTML = ""; });
