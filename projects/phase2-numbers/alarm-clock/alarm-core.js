/*
 * alarm-core.js — the DOM-free, I/O-free brain of the Alarm Clock.
 *
 * The whole point of an alarm clock is *scheduling*: given the wall clock, work
 * out the next instant an alarm should ring, and — every time you look at the
 * clock — decide which alarms have crossed their ring time since you last
 * looked. That logic has nothing to do with the DOM, with audio, or with the
 * real `Date.now()`; it is pure arithmetic over timestamps. So it lives here,
 * with every "now" passed in as an argument, which is exactly what lets the
 * test suite fast-forward through days, weeks and DST without waiting.
 *
 * The file runs unchanged in the browser (it attaches to `window.AlarmCore`)
 * and under Node (it fills in `module.exports`).
 */

'use strict';

var SECONDS_PER_DAY = 86400;
var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------- time-of-day parsing ---------------------------------------- */

/*
 * parseTimeOfDay("07:30") -> 27000  (seconds since local midnight, 0..86399)
 *
 * Accepts 24-hour "HH:MM" / "HH:MM:SS" and 12-hour "h:mm am"/"h:mm:ss pm"
 * (with or without a space, case-insensitive). Throws a plain Error with a
 * human-readable message on anything it can't make sense of, so the UI can
 * show it verbatim.
 */
function parseTimeOfDay(str) {
  if (typeof str !== 'string') { throw new Error('Enter a time like 07:30.'); }
  var s = str.trim().toLowerCase();
  if (s === '') { throw new Error('Enter a time like 07:30.'); }

  var meridiem = null;
  var m = s.match(/\s*(am|pm)\s*$/);
  if (m) { meridiem = m[1]; s = s.slice(0, m.index).trim(); }

  var parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error('Time must look like HH:MM (optionally :SS).');
  }
  for (var i = 0; i < parts.length; i++) {
    if (!/^\d{1,2}$/.test(parts[i])) {
      throw new Error('Time must look like HH:MM (optionally :SS).');
    }
  }

  var hh = parseInt(parts[0], 10);
  var mm = parseInt(parts[1], 10);
  var ss = parts.length === 3 ? parseInt(parts[2], 10) : 0;

  if (mm > 59) { throw new Error('Minutes must be 00–59.'); }
  if (ss > 59) { throw new Error('Seconds must be 00–59.'); }

  if (meridiem) {
    if (hh < 1 || hh > 12) { throw new Error('A 12-hour time needs an hour 1–12.'); }
    if (hh === 12) { hh = 0; }
    if (meridiem === 'pm') { hh += 12; }
  } else if (hh > 23) {
    throw new Error('Hours must be 00–23 (or use am/pm).');
  }

  return hh * 3600 + mm * 60 + ss;
}

/* formatTimeOfDay(27000) -> "07:30"; with {hour12:true} -> "7:30 AM". */
function formatTimeOfDay(secondsOfDay, opts) {
  opts = opts || {};
  var sod = ((Math.round(secondsOfDay) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  var hh = Math.floor(sod / 3600);
  var mm = Math.floor((sod % 3600) / 60);
  var ss = sod % 60;
  var showSecs = opts.seconds || ss !== 0;

  if (opts.hour12) {
    var mer = hh < 12 ? 'AM' : 'PM';
    var h12 = hh % 12; if (h12 === 0) { h12 = 12; }
    return h12 + ':' + pad2(mm) + (showSecs ? ':' + pad2(ss) : '') + ' ' + mer;
  }
  return pad2(hh) + ':' + pad2(mm) + (showSecs ? ':' + pad2(ss) : '');
}

/* ---------- duration parsing (for countdown timers) ------------------- */

/*
 * parseDuration turns a spoken-ish duration into a whole number of seconds:
 *   "90"        -> 90     (a bare number is seconds)
 *   "5m"        -> 300
 *   "1h30m"     -> 5400
 *   "1h 30m 15s"-> 5415
 *   "1:30"      -> 90     (mm:ss)
 *   "1:30:00"   -> 5400   (hh:mm:ss)
 * Zero and negatives are rejected — a timer needs to count *down* something.
 */
function parseDuration(str) {
  if (typeof str !== 'string') { throw new Error('Enter a duration like 5m or 1:30.'); }
  var s = str.trim().toLowerCase();
  if (s === '') { throw new Error('Enter a duration like 5m or 1:30.'); }

  var total;
  if (s.indexOf(':') !== -1) {
    var parts = s.split(':');
    if (parts.length < 2 || parts.length > 3) { throw new Error('Use mm:ss or hh:mm:ss.'); }
    for (var i = 0; i < parts.length; i++) {
      if (!/^\d+$/.test(parts[i])) { throw new Error('Use mm:ss or hh:mm:ss.'); }
    }
    var nums = parts.map(function (p) { return parseInt(p, 10); });
    if (nums.length === 2) { total = nums[0] * 60 + nums[1]; }
    else { total = nums[0] * 3600 + nums[1] * 60 + nums[2]; }
  } else if (/^\d+$/.test(s)) {
    total = parseInt(s, 10);
  } else {
    // token form: 1h 30m 15s (units required, order free but each at most once)
    var re = /(\d+)\s*(h|m|s)/g;
    var seen = {}, match, consumed = 0;
    total = 0;
    while ((match = re.exec(s)) !== null) {
      var unit = match[2];
      if (seen[unit]) { throw new Error('Repeated unit "' + unit + '" in duration.'); }
      seen[unit] = true;
      var mult = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
      total += parseInt(match[1], 10) * mult;
      consumed += match[0].length;
    }
    if (total === 0 || consumed !== s.replace(/\s+/g, '').length) {
      throw new Error('Duration must look like 5m, 1h30m, or 90.');
    }
  }

  if (total <= 0) { throw new Error('Duration must be greater than zero.'); }
  return total;
}

/* formatDuration(5415) -> "1h 30m 15s"; formatDuration(90) -> "1m 30s". */
function formatDuration(seconds) {
  var s = Math.max(0, Math.floor(seconds));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  var out = [];
  if (h) { out.push(h + 'h'); }
  if (m) { out.push(m + 'm'); }
  if (sec || out.length === 0) { out.push(sec + 's'); }
  return out.join(' ');
}

/* Clock-style "HH:MM:SS" left-padded — handy for a live countdown display. */
function formatClock(seconds) {
  var s = Math.max(0, Math.floor(seconds));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return (h ? pad2(h) + ':' : '') + pad2(m) + ':' + pad2(sec);
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* ---------- next-occurrence scheduling -------------------------------- */

/*
 * nextAlarmOccurrence(alarm, nowMs) -> ms timestamp of the next ring, strictly
 * after `nowMs`, or null if the alarm can never ring again.
 *
 * `alarm.at` is seconds-of-day. `alarm.days` is an array of weekday numbers
 * (0=Sun..6=Sat): empty/absent means a one-shot "the very next time that
 * clock-time comes round"; non-empty means it repeats on those weekdays.
 * Everything is computed in *local* time via the Date constructor, so a
 * "07:30" alarm means 07:30 on the wall clock regardless of DST.
 */
function nextAlarmOccurrence(alarm, nowMs) {
  var repeats = alarm.days && alarm.days.length > 0;
  // A one-shot needs at most tomorrow; a weekly alarm needs at most 7 days out.
  var horizon = repeats ? 8 : 2;
  for (var offset = 0; offset < horizon; offset++) {
    var d = new Date(nowMs);
    d.setDate(d.getDate() + offset);
    var fire = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    fire.setSeconds(alarm.at); // rolls hours/minutes correctly
    var fireMs = fire.getTime();
    if (fireMs <= nowMs) { continue; }          // already in the past (today)
    if (repeats && alarm.days.indexOf(fire.getDay()) === -1) { continue; }
    return fireMs;
  }
  return null;
}

/* ---------- the clock ------------------------------------------------- */

/*
 * AlarmClock holds a set of alarms and countdown timers and, on each `tick`,
 * reports which of them have rung since the previous tick. It keeps no wall
 * clock of its own — the caller passes `nowMs` in — which is what makes the
 * whole thing deterministic and testable.
 */
function AlarmClock() {
  this.items = [];        // alarms and timers, in insertion order
  this.lastTickMs = null; // wall-clock ms of the previous tick
  this._seq = 0;
}

AlarmClock.prototype._id = function () {
  this._seq += 1;
  return 'a' + this._seq;
};

/* Add a clock-time alarm. days: array of 0..6, or [] for a one-shot. */
AlarmClock.prototype.addAlarm = function (at, days, label) {
  if (typeof at !== 'number' || at < 0 || at >= SECONDS_PER_DAY) {
    throw new Error('Alarm time is out of range.');
  }
  var clean = normalizeDays(days);
  var item = {
    id: this._id(),
    kind: 'alarm',
    at: Math.floor(at),
    days: clean,
    label: label || '',
    enabled: true,
    snoozeUntil: null
  };
  this.items.push(item);
  return item;
};

/* Add a countdown timer that fires `durationSec` after it is started. */
AlarmClock.prototype.addTimer = function (durationSec, startedAtMs, label) {
  if (typeof durationSec !== 'number' || durationSec <= 0) {
    throw new Error('Timer duration must be greater than zero.');
  }
  var item = {
    id: this._id(),
    kind: 'timer',
    duration: Math.floor(durationSec),
    startedAt: startedAtMs,
    label: label || '',
    enabled: true,
    fired: false,
    snoozeUntil: null
  };
  this.items.push(item);
  return item;
};

AlarmClock.prototype.get = function (id) {
  for (var i = 0; i < this.items.length; i++) {
    if (this.items[i].id === id) { return this.items[i]; }
  }
  return null;
};

AlarmClock.prototype.remove = function (id) {
  var before = this.items.length;
  this.items = this.items.filter(function (it) { return it.id !== id; });
  return this.items.length !== before;
};

AlarmClock.prototype.setEnabled = function (id, on) {
  var it = this.get(id);
  if (!it) { return false; }
  it.enabled = !!on;
  if (!on) { it.snoozeUntil = null; }
  return true;
};

/*
 * snooze(id, nowMs, minutes): schedule a one-off extra ring `minutes` from
 * `nowMs`. Works for alarms and timers alike — the snooze is tracked
 * separately from the item's normal schedule, so a repeating alarm still
 * keeps its future occurrences.
 */
AlarmClock.prototype.snooze = function (id, nowMs, minutes) {
  var it = this.get(id);
  if (!it) { return false; }
  var mins = (typeof minutes === 'number' && minutes > 0) ? minutes : 9;
  it.snoozeUntil = nowMs + Math.round(mins * 60000);
  return true;
};

/*
 * nextRingMs(item, nowMs): the soonest future ms this item will ring, taking a
 * pending snooze into account, or null if it never will again.
 */
AlarmClock.prototype.nextRingMs = function (item, nowMs) {
  if (!item.enabled) { return null; }
  var candidates = [];
  if (item.snoozeUntil != null && item.snoozeUntil > nowMs) {
    candidates.push(item.snoozeUntil);
  }
  if (item.kind === 'alarm') {
    var occ = nextAlarmOccurrence(item, nowMs);
    if (occ != null) { candidates.push(occ); }
  } else if (item.kind === 'timer' && !item.fired) {
    var end = item.startedAt + item.duration * 1000;
    if (end > nowMs) { candidates.push(end); }
  }
  if (candidates.length === 0) { return null; }
  return Math.min.apply(null, candidates);
};

/*
 * tick(nowMs) -> array of { id, item, at, snoozed } for every ring whose
 * moment falls in (lastTickMs, nowMs]. Half-open at the bottom so the same
 * instant is never reported twice across consecutive ticks. Firing a one-shot
 * alarm disables it; firing a timer marks it done; a fulfilled snooze clears.
 */
AlarmClock.prototype.tick = function (nowMs) {
  var last = this.lastTickMs == null ? nowMs : this.lastTickMs;
  var fired = [];

  for (var i = 0; i < this.items.length; i++) {
    var it = this.items[i];
    if (!it.enabled) { continue; }

    // Snooze rings are checked for every kind.
    if (it.snoozeUntil != null && it.snoozeUntil > last && it.snoozeUntil <= nowMs) {
      fired.push({ id: it.id, item: it, at: it.snoozeUntil, snoozed: true });
      it.snoozeUntil = null;
    }

    if (it.kind === 'timer') {
      if (!it.fired) {
        var end = it.startedAt + it.duration * 1000;
        if (end > last && end <= nowMs) {
          fired.push({ id: it.id, item: it, at: end, snoozed: false });
          it.fired = true;
        }
      }
    } else if (it.kind === 'alarm') {
      // Walk every occurrence in (last, nowMs] — normally one, but a long gap
      // between ticks (a sleeping tab) can hide several.
      var t = last, guard = 0;
      while (guard++ < 400) {
        var occ = nextAlarmOccurrence(it, t); // strictly after t
        if (occ == null || occ > nowMs) { break; }
        fired.push({ id: it.id, item: it, at: occ, snoozed: false });
        if (!(it.days && it.days.length)) { it.enabled = false; break; } // one-shot
        t = occ;
      }
    }
  }

  this.lastTickMs = nowMs;
  fired.sort(function (a, b) { return a.at - b.at; });
  return fired;
};

/* ---------- helpers --------------------------------------------------- */

/* Normalise a days array: integers 0..6, de-duplicated, sorted, validated. */
function normalizeDays(days) {
  if (days == null) { return []; }
  if (!Array.isArray(days)) { throw new Error('Days must be an array of 0–6.'); }
  var set = {};
  for (var i = 0; i < days.length; i++) {
    var d = days[i];
    if (typeof d !== 'number' || d < 0 || d > 6 || d !== Math.floor(d)) {
      throw new Error('Each day must be an integer 0–6 (0=Sun).');
    }
    set[d] = true;
  }
  return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
}

/* Human label for a days array: "Every day", "Weekdays", "Once", "Mon, Wed"… */
function describeDays(days) {
  var d = normalizeDays(days);
  if (d.length === 0) { return 'Once'; }
  if (d.length === 7) { return 'Every day'; }
  if (sameSet(d, [1, 2, 3, 4, 5])) { return 'Weekdays'; }
  if (sameSet(d, [0, 6])) { return 'Weekends'; }
  return d.map(function (n) { return DAY_NAMES[n]; }).join(', ');
}

function sameSet(a, b) {
  if (a.length !== b.length) { return false; }
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
  return true;
}

/* ---------- exports --------------------------------------------------- */

var AlarmCore = {
  SECONDS_PER_DAY: SECONDS_PER_DAY,
  DAY_NAMES: DAY_NAMES,
  parseTimeOfDay: parseTimeOfDay,
  formatTimeOfDay: formatTimeOfDay,
  parseDuration: parseDuration,
  formatDuration: formatDuration,
  formatClock: formatClock,
  nextAlarmOccurrence: nextAlarmOccurrence,
  normalizeDays: normalizeDays,
  describeDays: describeDays,
  AlarmClock: AlarmClock
};

if (typeof module !== 'undefined' && module.exports) { module.exports = AlarmCore; }
if (typeof window !== 'undefined') { window.AlarmCore = AlarmCore; }
