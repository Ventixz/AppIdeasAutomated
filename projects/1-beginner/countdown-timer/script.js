// Countdown Timer — builtin Date math only, no libraries.
// State is a list of events; each is { id, name, target (ms epoch), fired }.

const STORAGE_KEY = "countdown-timer.events";

const form = document.getElementById("controls");
const nameInput = document.getElementById("name");
const dateInput = document.getElementById("date");
const timeInput = document.getElementById("time");
const warning = document.getElementById("warning");
const list = document.getElementById("events");
const empty = document.getElementById("empty");

// JS Dates lose precision past ±8.64e15 ms from the epoch (~±271,821 years).
const MAX_TIME = 8.64e15;

let events = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    /* storage may be unavailable (private mode) — run without persistence */
  }
}

function showWarning(message, field) {
  warning.textContent = message;
  warning.hidden = false;
  [dateInput, timeInput, nameInput].forEach((el) => el.classList.remove("invalid"));
  if (field) field.classList.add("invalid");
}

function clearWarning() {
  warning.hidden = true;
  [dateInput, timeInput, nameInput].forEach((el) => el.classList.remove("invalid"));
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearWarning();

  const name = nameInput.value.trim();
  if (!name) return showWarning("Please enter an event name.", nameInput);
  if (!dateInput.value) return showWarning("Please choose a date.", dateInput);

  // Default to midnight local time when no time is given.
  const time = timeInput.value || "00:00";
  const target = new Date(`${dateInput.value}T${time}`);
  if (Number.isNaN(target.getTime())) {
    return showWarning("That date or time isn't valid.", dateInput);
  }
  if (Math.abs(target.getTime()) > MAX_TIME) {
    return showWarning("That date is too far away to count down to.", dateInput);
  }

  events.push({
    id: Date.now() + Math.random(),
    name,
    target: target.getTime(),
    fired: target.getTime() <= Date.now(),
  });
  save();
  render();
  form.reset();
  nameInput.focus();
});

list.addEventListener("click", (e) => {
  const btn = e.target.closest(".remove");
  if (!btn) return;
  const id = btn.dataset.id;
  events = events.filter((ev) => String(ev.id) !== id);
  save();
  render();
});

// Break a positive millisecond span into whole d/h/m/s using builtin math.
function breakdown(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

const pad = (n) => String(n).padStart(2, "0");

function unit(value, tag) {
  return `<div class="unit"><span class="value">${pad(value)}</span><span class="tag">${tag}</span></div>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Build the DOM once; tick() only updates the numbers afterwards.
function render() {
  empty.hidden = events.length > 0;
  list.innerHTML = events
    .map((ev) => {
      const when = new Date(ev.target).toLocaleString();
      return `
        <li class="event" data-id="${ev.id}">
          <div class="event-head">
            <div>
              <div class="event-name">${escapeHtml(ev.name)}</div>
              <div class="event-target">${when}</div>
            </div>
            <button class="remove" data-id="${ev.id}" aria-label="Remove">&times;</button>
          </div>
          <div class="clock">
            ${unit(0, "days")}${unit(0, "hours")}${unit(0, "mins")}${unit(0, "secs")}
          </div>
          <p class="fired" hidden>🎉 It's time!</p>
        </li>`;
    })
    .join("");
  tick();
}

function tick() {
  const now = Date.now();
  for (const ev of events) {
    const li = list.querySelector(`.event[data-id="${ev.id}"]`);
    if (!li) continue;

    const remaining = ev.target - now;
    const values = li.querySelectorAll(".unit .value");
    const firedMsg = li.querySelector(".fired");

    if (remaining <= 0) {
      values.forEach((v) => (v.textContent = "00"));
      li.classList.add("done");
      firedMsg.hidden = false;
      // Alert once, the first time the countdown reaches zero.
      if (!ev.fired) {
        ev.fired = true;
        save();
        window.alert(`⏰ "${ev.name}" has arrived!`);
      }
      continue;
    }

    const { days, hours, minutes, seconds } = breakdown(remaining);
    values[0].textContent = pad(days);
    values[1].textContent = pad(hours);
    values[2].textContent = pad(minutes);
    values[3].textContent = pad(seconds);
    li.classList.remove("done");
    firedMsg.hidden = true;
  }
}

render();
setInterval(tick, 1000);
