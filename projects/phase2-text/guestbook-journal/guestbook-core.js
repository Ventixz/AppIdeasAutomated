/*
 * guestbook-core.js — the engine for Guestbook / Journal.
 *
 * "A place where people can add comments or journal entries." The easy version
 * is an array you push strings onto and drop on the page. This core is the four
 * things that turn that into a guestbook you could actually open to the public,
 * each written DOM-free so it runs in Node and the browser and can be proved as
 * a law, not demonstrated on a happy path:
 *
 *   1. escapeHtml / linkify — the whole point of a guestbook is that *other
 *      people* type into it, so their `<script>` must never become a tag and
 *      their bare `https://…` should become a safe link. Rendering untrusted
 *      text is the one thing a guestbook cannot get wrong.
 *   2. relativeTime — "just now", "5 minutes ago", "yesterday", "3 days ago",
 *      then a real date. Correct pluralisation, correct *calendar-day*
 *      boundaries (yesterday is the previous day, not "24h ago"), and never a
 *      time in the future. Monotonic: an older entry never reads as newer.
 *   3. Guestbook — the store with a moderation mode (open / moderated / closed,
 *      i.e. "allow or disallow comments"), stable (time, id) ordering so two
 *      posts in the same millisecond keep their order, a consecutive-duplicate
 *      flood guard, and search over name + body.
 *   4. groupByDay — the journal view: entries bucketed into Today / Yesterday /
 *      dated sections, newest first, every entry in exactly one group.
 *   5. toObject / fromObject — an exact serialisation round-trip.
 *
 * No dependencies, no DOM, no network.
 */
"use strict";

/* ------------------------------------------------------------------ *
 * 1. Safe rendering — escapeHtml + linkify
 * ------------------------------------------------------------------ */

var ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Turn text into HTML-safe text: the five characters that can end a text node
// or an attribute become entities. Everything a visitor types passes through
// here before it reaches the page.
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESCAPE_MAP[c]; });
}

// Bare URLs we are willing to turn into links. Stops at whitespace and at the
// HTML-significant characters < > " ' so a URL can never swallow following
// markup or quotes, and only http(s) schemes qualify (no javascript:, data:).
var URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
// Trailing punctuation that is almost always sentence punctuation, not URL.
var TRAILING = ".,!?;:\"')]}";

// Escape text AND turn bare http(s) URLs into anchors — in one pass, so the URL
// is escaped for both the href and the visible text and nothing between the
// URLs is left unescaped. The result is safe to assign to innerHTML: the only
// tags it ever contains are the <a> wrappers this function writes.
function linkify(raw) {
  var s = String(raw == null ? "" : raw);
  var out = "", last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) {
    var url = m[0], trail = "";
    // Peel trailing punctuation back out of the URL so "(see https://x.com)."
    // links "https://x.com" and leaves ")." as text.
    while (url.length && TRAILING.indexOf(url.charAt(url.length - 1)) !== -1) {
      trail = url.charAt(url.length - 1) + trail;
      url = url.slice(0, -1);
    }
    out += escapeHtml(s.slice(last, m.index));
    if (url.length) {
      var safe = escapeHtml(url);
      out += '<a href="' + safe + '" rel="nofollow noopener noreferrer" target="_blank">' + safe + "</a>";
    } else {
      // The whole match was punctuation (can't really happen with URL_RE, but
      // be safe) — emit it as escaped text.
      trail = escapeHtml(m[0]);
    }
    out += escapeHtml(trail);
    last = m.index + m[0].length;
  }
  out += escapeHtml(s.slice(last));
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. Human time — relativeTime + calendar helpers
 * ------------------------------------------------------------------ */

var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Midnight (local time) at the start of the day containing `ms`.
function startOfLocalDay(ms) {
  var d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Whole calendar days between the local day of `then` and of `now`
// (0 = same day, 1 = yesterday, …). Independent of the time within the day.
function dayDiff(then, now) {
  return Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / 86400000);
}

// "Jan 5" or, if the year differs from now's year, "Jan 5, 2023".
function formatDate(ms, now) {
  var d = new Date(ms);
  var s = MONTHS[d.getMonth()] + " " + d.getDate();
  if (d.getFullYear() !== new Date(now).getFullYear()) s += ", " + d.getFullYear();
  return s;
}

// A human, monotonic description of how long ago `then` was, relative to `now`.
// Monotonic means: for a fixed `now`, a more recent `then` never reads as older
// than a less recent one. Future timestamps are clamped to "just now".
function relativeTime(then, now) {
  now = (now == null ? Date.now() : now);
  if (then > now) then = now; // never "in the future"
  var sec = Math.floor((now - then) / 1000);
  if (sec < 45) return "just now";
  var min = Math.floor(sec / 60);
  if (min < 1) return "just now";
  if (min === 1) return "1 minute ago";
  if (min < 60) return min + " minutes ago";
  var days = dayDiff(then, now);
  if (days === 0) {
    var hr = Math.floor(min / 60);
    return hr === 1 ? "1 hour ago" : hr + " hours ago";
  }
  if (days === 1) return "yesterday";
  if (days < 7) return days + " days ago";
  if (days < 14) return "last week";
  if (days < 28) return Math.floor(days / 7) + " weeks ago";
  return "on " + formatDate(then, now);
}

/* ------------------------------------------------------------------ *
 * 3. The store — Guestbook with moderation
 * ------------------------------------------------------------------ */

var MODES = ["open", "moderated", "closed"];
var MAX_BODY = 2000;
var MAX_NAME = 80;

function cleanName(name) {
  var t = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
  return t.length > MAX_NAME ? t.slice(0, MAX_NAME).trim() : t;
}
function cleanBody(body) {
  // Collapse runs of blank lines, trim the ends; keep single newlines.
  var t = String(body == null ? "" : body).replace(/\r\n?/g, "\n");
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX_BODY ? t.slice(0, MAX_BODY).trim() : t;
}

// Sort newest-first with a stable tie-break on id, so two entries posted in the
// same millisecond keep their insertion order (higher id = posted later).
function byNewest(a, b) {
  if (a.at !== b.at) return b.at - a.at;
  return b.id - a.id;
}

function Guestbook(opts) {
  opts = opts || {};
  this.mode = MODES.indexOf(opts.mode) !== -1 ? opts.mode : "open";
  this._seq = opts.seq | 0;
  this._entries = [];
  var self = this;
  (opts.entries || []).forEach(function (e) { self._ingest(e); });
}

// Insert a fully-formed entry (used by fromObject). Keeps _seq ahead of every id.
Guestbook.prototype._ingest = function (e) {
  var id = e.id | 0;
  if (id > this._seq) this._seq = id;
  this._entries.push({
    id: id || (++this._seq),
    name: cleanName(e.name),
    body: cleanBody(e.body),
    at: typeof e.at === "number" ? e.at : Date.parse(e.at) || 0,
    status: e.status === "pending" ? "pending" : "visible"
  });
};

Guestbook.prototype.setMode = function (mode) {
  if (MODES.indexOf(mode) !== -1) this.mode = mode;
  return this.mode;
};

// Add an entry. Returns { ok, reason?, entry? }. The reasons are the honest
// failure modes of a real guestbook:
//   - "closed"    : the book is not accepting posts (mode === "closed")
//   - "empty"     : nothing but whitespace was typed
//   - "duplicate" : identical to the most recent post (double-submit / flood)
Guestbook.prototype.post = function (input) {
  input = input || {};
  if (this.mode === "closed") return { ok: false, reason: "closed" };
  var name = cleanName(input.name);
  var body = cleanBody(input.body);
  if (!body) return { ok: false, reason: "empty" };

  var latest = this._entries.length ? this._entries[this._entries.length - 1] : null;
  if (latest && latest.name === name && latest.body === body) {
    return { ok: false, reason: "duplicate" };
  }

  var entry = {
    id: ++this._seq,
    name: name,
    body: body,
    at: typeof input.at === "number" ? input.at : Date.now(),
    status: this.mode === "moderated" ? "pending" : "visible"
  };
  this._entries.push(entry);
  return { ok: true, entry: entry };
};

Guestbook.prototype._find = function (id) {
  for (var i = 0; i < this._entries.length; i++)
    if (this._entries[i].id === id) return i;
  return -1;
};

Guestbook.prototype.approve = function (id) {
  var i = this._find(id);
  if (i === -1) return false;
  this._entries[i].status = "visible";
  return true;
};

Guestbook.prototype.remove = function (id) {
  var i = this._find(id);
  if (i === -1) return false;
  this._entries.splice(i, 1);
  return true;
};

Guestbook.prototype.edit = function (id, patch) {
  var i = this._find(id);
  if (i === -1) return false;
  patch = patch || {};
  if ("name" in patch) this._entries[i].name = cleanName(patch.name);
  if ("body" in patch) {
    var body = cleanBody(patch.body);
    if (!body) return false;
    this._entries[i].body = body;
  }
  return true;
};

// All entries, newest first (a fresh sorted copy; the internal array is left
// in insertion order).
Guestbook.prototype.all = function () {
  return this._entries.slice().sort(byNewest);
};
Guestbook.prototype.visible = function () {
  return this.all().filter(function (e) { return e.status === "visible"; });
};
Guestbook.prototype.pending = function () {
  return this.all().filter(function (e) { return e.status === "pending"; });
};
Guestbook.prototype.count = function () { return this._entries.length; };

// Tokenised AND search over name + body, case-insensitive. Empty query = all
// visible entries. Only searches visible entries (pending posts aren't public).
Guestbook.prototype.search = function (query) {
  var tokens = String(query == null ? "" : query).toLowerCase().split(/\s+/).filter(Boolean);
  var list = this.visible();
  if (!tokens.length) return list;
  return list.filter(function (e) {
    var hay = (e.name + " " + e.body).toLowerCase();
    return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
  });
};

Guestbook.prototype.toObject = function () {
  return {
    version: 1,
    mode: this.mode,
    seq: this._seq,
    entries: this._entries.map(function (e) {
      return { id: e.id, name: e.name, body: e.body, at: e.at, status: e.status };
    })
  };
};
Guestbook.prototype.toJSON = function () { return JSON.stringify(this.toObject()); };

function fromObject(obj) {
  if (typeof obj === "string") obj = JSON.parse(obj);
  if (Array.isArray(obj)) obj = { entries: obj };
  obj = obj || {};
  return new Guestbook({ mode: obj.mode, seq: obj.seq, entries: obj.entries || [] });
}

/* ------------------------------------------------------------------ *
 * 4. The journal view — groupByDay
 * ------------------------------------------------------------------ */

// Bucket a newest-first list of entries into day groups, preserving order.
// Returns [{ key, label, items }], groups themselves newest-first. Every input
// entry appears in exactly one group, and concatenating the groups' items
// reproduces the input order exactly.
function groupByDay(entries, now) {
  now = (now == null ? Date.now() : now);
  var groups = [], index = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var key = startOfLocalDay(e.at);
    var g = index[key];
    if (!g) {
      var diff = dayDiff(e.at, now);
      var label = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : formatDate(e.at, now);
      g = { key: key, label: label, items: [] };
      index[key] = g;
      groups.push(g);
    }
    g.items.push(e);
  }
  return groups;
}

/* ------------------------------------------------------------------ */

var API = {
  escapeHtml: escapeHtml,
  linkify: linkify,
  startOfLocalDay: startOfLocalDay,
  dayDiff: dayDiff,
  formatDate: formatDate,
  relativeTime: relativeTime,
  groupByDay: groupByDay,
  Guestbook: Guestbook,
  fromObject: fromObject,
  MODES: MODES,
  MAX_BODY: MAX_BODY,
  MAX_NAME: MAX_NAME
};

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof window !== "undefined") window.GuestbookCore = API;
