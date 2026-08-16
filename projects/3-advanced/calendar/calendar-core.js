// calendar-core.js — the presentation-free calendar engine.
//
// Every rule of the calendar lives here as a pure, DOM-free module: event
// creation/validation, editing, deleting, dragging events between dates,
// building the month grid, (de)serialising to storage, and deciding which
// reminders are due. It knows nothing about the DOM, clicks or localStorage.
//
// Two presentation layers drive this same engine — the browser (index.html /
// script.js) and the test suite (tests.js). Anything non-deterministic (the
// clock, id generation) is *injected*, so tests replay exactly.

'use strict';

// --- Date helpers --------------------------------------------------------
//
// Dates are stored as 'YYYY-MM-DD' keys and times as 'HH:MM' (24h). Timestamps
// are computed with Date.UTC over the wall-clock components, so the engine is
// timezone-independent and deterministic: the browser feeds it a matching
// "wall-clock-as-UTC" now (see wallClockNow), and tests build now with Date.UTC.

const MS_PER_MINUTE = 60 * 1000;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Build a 'YYYY-MM-DD' key from a (year, month=1-12, day) triple.
function dateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// Parse 'YYYY-MM-DD' into { year, month (1-12), day }. Throws on malformed input.
function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
  if (!m) throw new Error(`Invalid date key: ${key}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw new Error(`Invalid month in ${key}`);
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) throw new Error(`Invalid day in ${key}`);
  return { year, month, day };
}

// Is this a real 'YYYY-MM-DD' calendar date? (never throws)
function isValidDateKey(key) {
  try {
    parseDateKey(key);
    return true;
  } catch (_e) {
    return false;
  }
}

// Is this a valid 'HH:MM' 24h time? Empty string is allowed (all-day event).
function isValidTime(time) {
  if (time === '' || time == null) return true;
  const m = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

function daysInMonth(year, month) {
  // month is 1-12. Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Weekday index (0=Sun..6=Sat) for a date key.
function weekdayOf(key) {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// Step a (year, month) pointer by whole months, wrapping the year.
function addMonths(year, month, delta) {
  const zero = (year * 12) + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// The month grid: whole weeks (Sunday-first) covering `month`, including the
// trailing days of the previous month and the leading days of the next so every
// row has 7 cells. Returns an array of week-arrays of cell objects:
//   { key, year, month, day, inMonth }
// `todayKey` (optional) marks the current day so a UI can highlight it.
function monthGrid(year, month, todayKey) {
  const first = dateKey(year, month, 1);
  const leading = weekdayOf(first); // how many cells before the 1st
  const total = daysInMonth(year, month);

  const cells = [];
  // Trailing days of the previous month.
  if (leading > 0) {
    const prev = addMonths(year, month, -1);
    const prevDim = daysInMonth(prev.year, prev.month);
    for (let i = leading - 1; i >= 0; i -= 1) {
      const day = prevDim - i;
      cells.push(cell(prev.year, prev.month, day, false, todayKey));
    }
  }
  // The month itself.
  for (let day = 1; day <= total; day += 1) {
    cells.push(cell(year, month, day, true, todayKey));
  }
  // Leading days of the next month to fill the final week.
  const next = addMonths(year, month, 1);
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push(cell(next.year, next.month, nextDay, false, todayKey));
    nextDay += 1;
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function cell(year, month, day, inMonth, todayKey) {
  const key = dateKey(year, month, day);
  return { key, year, month, day, inMonth, isToday: key === todayKey };
}

// --- Events --------------------------------------------------------------
//
// An event is a plain object:
//   { id, title, date:'YYYY-MM-DD', time:'HH:MM'|'', description,
//     reminderMinutes: number|null, remindedAt: number|null, color }
// Everything here is immutable: mutating helpers return a *new* events array.

const DEFAULT_COLOR = '#4f7cff';
const REMINDER_CHOICES = [null, 0, 5, 10, 15, 30, 60, 120, 1440];

// Validate raw event input. Returns { valid, errors } — errors is a map of
// field -> message. Never throws.
function validateEvent(input) {
  const errors = {};
  const title = (input && input.title != null) ? String(input.title).trim() : '';
  if (!title) errors.title = 'Title is required.';
  else if (title.length > 120) errors.title = 'Title must be 120 characters or fewer.';

  if (!input || !isValidDateKey(input.date)) errors.date = 'A valid date is required.';
  if (!isValidTime(input && input.time)) errors.time = 'Time must be HH:MM (24-hour).';

  const rm = input ? input.reminderMinutes : null;
  if (rm != null && !(Number.isInteger(rm) && rm >= 0)) {
    errors.reminderMinutes = 'Reminder must be a whole number of minutes.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// Build a normalised event from raw input. Throws if invalid — callers that
// take user input should run validateEvent first. `idGen` is injected.
function createEvent(input, { idGen } = {}) {
  const { valid, errors } = validateEvent(input);
  if (!valid) {
    const err = new Error(`Invalid event: ${Object.values(errors).join(' ')}`);
    err.errors = errors;
    throw err;
  }
  return {
    id: input.id || (idGen ? idGen() : fallbackId()),
    title: String(input.title).trim(),
    date: input.date,
    time: input.time ? String(input.time) : '',
    description: input.description ? String(input.description).trim() : '',
    reminderMinutes: input.reminderMinutes != null ? input.reminderMinutes : null,
    remindedAt: input.remindedAt != null ? input.remindedAt : null,
    color: input.color || DEFAULT_COLOR,
  };
}

let _seq = 0;
function fallbackId() {
  _seq += 1;
  return `evt-${_seq}`;
}

function addEvent(events, input, deps) {
  return events.concat([createEvent(input, deps)]);
}

// Patch an existing event by id. The patched event is re-validated. Editing a
// field that affects the reminder time clears remindedAt so it can fire again.
function updateEvent(events, id, patch) {
  return events.map((e) => {
    if (e.id !== id) return e;
    const merged = { ...e, ...patch, id: e.id };
    const { valid, errors } = validateEvent(merged);
    if (!valid) {
      const err = new Error(`Invalid event: ${Object.values(errors).join(' ')}`);
      err.errors = errors;
      throw err;
    }
    const rescheduled = ('date' in patch) || ('time' in patch) || ('reminderMinutes' in patch);
    return {
      ...merged,
      title: String(merged.title).trim(),
      description: merged.description ? String(merged.description).trim() : '',
      time: merged.time ? String(merged.time) : '',
      remindedAt: rescheduled ? null : merged.remindedAt,
    };
  });
}

function deleteEvent(events, id) {
  return events.filter((e) => e.id !== id);
}

// Drag-and-drop: move an event to a different date. No-op if the date is
// unchanged; throws on an invalid target date. Rescheduling clears remindedAt.
function moveEvent(events, id, newDateKey) {
  if (!isValidDateKey(newDateKey)) throw new Error(`Invalid target date: ${newDateKey}`);
  return events.map((e) => {
    if (e.id !== id || e.date === newDateKey) return e;
    return { ...e, date: newDateKey, remindedAt: null };
  });
}

// --- Querying ------------------------------------------------------------

// Chronological sort key within a day: timed events (earliest first) before
// all-day events, then by title for a stable order.
function compareEvents(a, b) {
  const at = a.time || '99:99';
  const bt = b.time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return a.title.localeCompare(b.title);
}

function eventsForDate(events, key) {
  return events.filter((e) => e.date === key).sort(compareEvents);
}

// Group all events by date key: { 'YYYY-MM-DD': [event, ...] }, each sorted.
function eventsByDate(events) {
  const map = {};
  for (const e of events) {
    (map[e.date] || (map[e.date] = [])).push(e);
  }
  for (const key of Object.keys(map)) map[key].sort(compareEvents);
  return map;
}

// --- Reminders -----------------------------------------------------------

// The start timestamp of an event, as wall-clock-UTC ms (see the date-helpers
// note). All-day events start at 00:00.
function eventStartMs(event) {
  const { year, month, day } = parseDateKey(event.date);
  let h = 0;
  let min = 0;
  if (event.time) {
    const [hh, mm] = event.time.split(':');
    h = Number(hh);
    min = Number(mm);
  }
  return Date.UTC(year, month - 1, day, h, min);
}

// When an event's reminder should first fire (ms), or null if it has no reminder.
function reminderFireMs(event) {
  if (event.reminderMinutes == null) return null;
  return eventStartMs(event) - (event.reminderMinutes * MS_PER_MINUTE);
}

// Reminders that are due at `nowMs`: have a reminder set, its fire time has
// passed, and it hasn't already been marked reminded. Sorted by fire time.
function dueReminders(events, nowMs) {
  return events
    .filter((e) => {
      const fire = reminderFireMs(e);
      return fire != null && e.remindedAt == null && nowMs >= fire;
    })
    .sort((a, b) => reminderFireMs(a) - reminderFireMs(b));
}

function markReminded(events, id, nowMs) {
  return events.map((e) => (e.id === id ? { ...e, remindedAt: nowMs } : e));
}

// A browser-side "now" that matches eventStartMs's wall-clock-UTC convention.
function wallClockNow(date) {
  return Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(),
  );
}

// --- Storage -------------------------------------------------------------

const STORAGE_VERSION = 1;

function serialize(events) {
  return JSON.stringify({ version: STORAGE_VERSION, events });
}

// Parse stored JSON back into a clean events array. Tolerant of corruption:
// bad JSON, a non-array payload, or individual malformed events are dropped
// rather than throwing, so a damaged store never wipes the whole calendar.
function deserialize(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.events) ? parsed.events : []);
  const clean = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (!validateEvent(item).valid) continue;
    try {
      clean.push(createEvent(item));
    } catch (_e) {
      // Skip anything that still can't be normalised.
    }
  }
  return clean;
}

// --- Exports -------------------------------------------------------------

const api = {
  // constants
  MONTH_NAMES,
  WEEKDAY_NAMES,
  REMINDER_CHOICES,
  DEFAULT_COLOR,
  // dates
  pad2,
  dateKey,
  parseDateKey,
  isValidDateKey,
  isValidTime,
  daysInMonth,
  weekdayOf,
  addMonths,
  monthLabel,
  monthGrid,
  // events
  validateEvent,
  createEvent,
  addEvent,
  updateEvent,
  deleteEvent,
  moveEvent,
  compareEvents,
  eventsForDate,
  eventsByDate,
  // reminders
  eventStartMs,
  reminderFireMs,
  dueReminders,
  markReminded,
  wallClockNow,
  // storage
  serialize,
  deserialize,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.CalendarCore = api;
}
