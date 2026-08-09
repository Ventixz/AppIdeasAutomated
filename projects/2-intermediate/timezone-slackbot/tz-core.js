// tz-core.js
// Pure, DOM-free logic for the Timezone Slackbot.
//
// Everything here is deterministic: the "current moment" is always passed in as
// a UTC millisecond value (nowUtcMs) rather than read from the clock, so the same
// inputs always produce the same table. That makes the whole module unit-testable
// without a browser, a network, or a real Slack workspace.

// A small team directory. Each member maps to a fixed UTC offset (in minutes)
// and the abbreviation for their zone. Real Slack would read this from each
// user's profile; offline we hard-code a representative roster.
//
// NOTE (simplification): offsets are fixed and do NOT follow daylight saving.
// The spec's world spans UTC-12..UTC+14, and this roster stays inside it.
const DIRECTORY = {
  alice:   { display: 'Alice',   abbr: 'PST', offsetMinutes: -8 * 60 },
  bob:     { display: 'Bob',     abbr: 'EST', offsetMinutes: -5 * 60 },
  carlos:  { display: 'Carlos',  abbr: 'BRT', offsetMinutes: -3 * 60 },
  diana:   { display: 'Diana',   abbr: 'GMT', offsetMinutes: 0 },
  emeka:   { display: 'Emeka',   abbr: 'WAT', offsetMinutes: 1 * 60 },
  farah:   { display: 'Farah',   abbr: 'EET', offsetMinutes: 2 * 60 },
  grace:   { display: 'Grace',   abbr: 'IST', offsetMinutes: 5 * 60 + 30 },
  hiroshi: { display: 'Hiroshi', abbr: 'JST', offsetMinutes: 9 * 60 },
  isla:    { display: 'Isla',    abbr: 'AEST', offsetMinutes: 10 * 60 },
  keahi:   { display: 'Keahi',   abbr: 'NZDT', offsetMinutes: 13 * 60 },
};

// Two-digit zero pad for a non-negative integer.
function pad2(n) {
  return String(n).padStart(2, '0');
}

// Format a signed minute offset as "UTC+HH:MM" / "UTC-HH:MM".
function formatOffset(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

// Local wall-clock time for a given UTC instant + offset, as { hh, mm, dayShift }.
// dayShift is -1 / 0 / +1: whether the local calendar day is behind, same, or
// ahead of the UTC day. Computed with pure modular arithmetic — no Date object,
// so it is immune to the host machine's own timezone.
function localTime(nowUtcMs, offsetMinutes) {
  const utcTotalMinutes = Math.floor(nowUtcMs / 60000);
  const localTotalMinutes = utcTotalMinutes + offsetMinutes;

  const dayOf = (m) => Math.floor(m / 1440);
  const dayShift = dayOf(localTotalMinutes) - dayOf(utcTotalMinutes);

  const minutesOfDay = ((localTotalMinutes % 1440) + 1440) % 1440;
  return {
    hh: Math.floor(minutesOfDay / 60),
    mm: minutesOfDay % 60,
    dayShift,
  };
}

// Render a localTime() result as "HH:MM" plus an optional day marker
// ("(+1d)" / "(-1d)") when the member's calendar day differs from UTC's.
function formatLocalTime(nowUtcMs, offsetMinutes) {
  const t = localTime(nowUtcMs, offsetMinutes);
  const base = `${pad2(t.hh)}:${pad2(t.mm)}`;
  if (t.dayShift > 0) return `${base} (+1d)`;
  if (t.dayShift < 0) return `${base} (-1d)`;
  return base;
}

// Look a member up case-insensitively, tolerating a leading "@".
// Returns the directory entry or null when unknown.
function lookupUser(directory, rawName) {
  if (typeof rawName !== 'string') return null;
  const key = rawName.trim().replace(/^@/, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(directory, key) ? directory[key] : null;
}

// Parse a raw Slack message into { command, args } or null if it is not a
// recognised slash command. "/tz alice @Bob" -> { command: 'tz', args: ['alice','@Bob'] }.
function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return { command: parts[0].toLowerCase(), args: parts.slice(1) };
}

// Build the timezone table for a list of names at a given instant.
// Returns { rows, unknown } where each row carries everything a renderer needs,
// including `stripe` (0/1) so the view can alternate row colours (user story #2).
function buildTable(directory, names, nowUtcMs) {
  const rows = [];
  const unknown = [];
  let visible = 0;
  for (const rawName of names) {
    const entry = lookupUser(directory, rawName);
    if (!entry) {
      unknown.push(rawName.replace(/^@/, ''));
      continue;
    }
    rows.push({
      name: entry.display,
      abbr: entry.abbr,
      offset: formatOffset(entry.offsetMinutes),
      localTime: formatLocalTime(nowUtcMs, entry.offsetMinutes),
      offsetMinutes: entry.offsetMinutes,
      stripe: visible % 2,
    });
    visible += 1;
  }
  return { rows, unknown };
}

// Top-level handler: parse a message and, if it is a valid `/tz` command with at
// least one name, return a table result. Otherwise return an error descriptor.
function handleMessage(directory, text, nowUtcMs) {
  const parsed = parseCommand(text);
  if (!parsed || parsed.command !== 'tz') {
    return { ok: false, error: 'unknown-command' };
  }
  if (parsed.args.length === 0) {
    return { ok: false, error: 'no-users' };
  }
  const { rows, unknown } = buildTable(directory, parsed.args, nowUtcMs);
  return { ok: true, rows, unknown };
}

const api = {
  DIRECTORY,
  pad2,
  formatOffset,
  localTime,
  formatLocalTime,
  lookupUser,
  parseCommand,
  buildTable,
  handleMessage,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.TZCore = api;
}
