// Stopwatch App — start, stop, resume, reset, plus laps (bonus).
// Timing is derived from Date.now() deltas rather than by counting ticks, so
// the elapsed value stays accurate even if the browser throttles the interval.

const timeEl = document.getElementById("time");
const startStopBtn = document.getElementById("startStop");
const lapBtn = document.getElementById("lap");
const resetBtn = document.getElementById("reset");
const lapsEl = document.getElementById("laps");

let running = false;
let elapsed = 0; // total milliseconds accumulated across all runs
let startTime = 0; // Date.now() when the current run segment began
let tickId = null;
let laps = []; // absolute elapsed time (ms) at each lap press

// mm:ss.cc — minutes, seconds, hundredths.
function format(ms) {
  const totalHundredths = Math.floor(ms / 10);
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
}

function currentElapsed() {
  return running ? elapsed + (Date.now() - startTime) : elapsed;
}

function render() {
  timeEl.textContent = format(currentElapsed());
}

function start() {
  running = true;
  startTime = Date.now();
  tickId = setInterval(render, 33); // ~30fps is smooth enough for hundredths
  startStopBtn.textContent = "Stop";
  startStopBtn.classList.add("running");
  lapBtn.disabled = false;
  resetBtn.disabled = false;
}

function stop() {
  running = false;
  elapsed += Date.now() - startTime;
  clearInterval(tickId);
  tickId = null;
  startStopBtn.textContent = "Start";
  startStopBtn.classList.remove("running");
  lapBtn.disabled = true; // no lap while stopped; reset stays available
  render();
}

function reset() {
  clearInterval(tickId);
  tickId = null;
  running = false;
  elapsed = 0;
  laps = [];
  startStopBtn.textContent = "Start";
  startStopBtn.classList.remove("running");
  lapBtn.disabled = true;
  resetBtn.disabled = true;
  lapsEl.innerHTML = "";
  render();
}

function addLap() {
  laps.push(currentElapsed());
  renderLaps();
}

// Each row shows the split (time since the previous lap). The fastest and
// slowest splits are highlighted once there are at least two laps.
function renderLaps() {
  const splits = laps.map((t, i) => t - (laps[i - 1] || 0));
  let bestIdx = -1;
  let worstIdx = -1;
  if (splits.length > 1) {
    bestIdx = splits.indexOf(Math.min(...splits));
    worstIdx = splits.indexOf(Math.max(...splits));
  }

  lapsEl.innerHTML = laps
    .map((total, i) => {
      let cls = "";
      if (i === bestIdx) cls = "best";
      else if (i === worstIdx) cls = "worst";
      return `<li class="${cls}">
        <span class="lap-index">Lap ${i + 1}</span>
        <span class="lap-time">${format(splits[i])}</span>
        <span class="lap-time">${format(total)}</span>
      </li>`;
    })
    .join("");
}

startStopBtn.addEventListener("click", () => (running ? stop() : start()));
lapBtn.addEventListener("click", addLap);
resetBtn.addEventListener("click", reset);

// Spacebar toggles start/stop for quick timing.
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    running ? stop() : start();
  }
});

render();
