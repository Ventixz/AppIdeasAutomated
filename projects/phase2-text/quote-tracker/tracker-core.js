/*
 * tracker-core.js — the engine for Quote Tracker.
 *
 * "Gather and store quotes (and their attributions)." The easy version is an
 * array you push strings onto. This core is the four things that make a store
 * of quotes actually usable, each written DOM-free so it runs in Node and the
 * browser and can be proved as a law, not demonstrated on a happy path:
 *
 *   1. parseAttribution / formatAttribution — split a pasted
 *      `“quote” — Author` into its two halves (and put them back), across the
 *      straight/curly quote marks and the five dash conventions real pastes use.
 *   2. quoteKey — a canonical identity for a quote so the SAME saying pasted
 *      twice (different whitespace, case, or quote glyphs) is stored once.
 *   3. Store — add / edit / remove with stable ids, insertion order, and a
 *      live tag index with counts; plus tokenised search over text+author+tags.
 *   4. pickForDay — a seeded, fair "quote of the day" rotation: over any run of
 *      `count` days every quote shows exactly once before any repeats.
 *   5. toJSON / fromJSON — an exact serialisation round-trip.
 *
 * No dependencies, no DOM, no network.
 */
"use strict";

/* ------------------------------------------------------------------ *
 * Unicode-safe text normalisation
 * ------------------------------------------------------------------ */

// The quote glyphs we treat as "wrapping" a quotation, as [open, close] pairs
// plus the symmetric ones. Used only to peel a matched pair off the ends.
var WRAP_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"], // “ ”
  ["‘", "’"], // ‘ ’
  ["«", "»"], // « »
  ["‹", "›"]  // ‹ ›
];

// Peel one matched pair of wrapping quote marks off a trimmed string, if the
// first and last characters form such a pair. Only one layer; leaves the inside
// untouched (a quote that merely *contains* quote marks is not unwrapped).
function stripWrappingQuotes(s) {
  var t = s.trim();
  if (t.length < 2) return t;
  var first = t[0], last = t[t.length - 1];
  for (var i = 0; i < WRAP_PAIRS.length; i++) {
    if (first === WRAP_PAIRS[i][0] && last === WRAP_PAIRS[i][1]) {
      return t.slice(1, -1).trim();
    }
  }
  return t;
}

// Canonical form of a quotation for identity: NFC so a combining mark and its
// precomposed form agree, wrapping quotes removed, inner whitespace collapsed,
// trimmed, and lowercased. Two inputs with the same canon are "the same quote".
function canon(s) {
  s = String(s == null ? "" : s);
  if (s.normalize) s = s.normalize("NFC");
  s = stripWrappingQuotes(s);
  s = s.replace(/\s+/g, " ").trim();
  return s.toLowerCase();
}

// Identity key for a (text, author) pair. Author is part of identity: the same
// words attributed to two different people are two different quotes.
function quoteKey(text, author) {
  return canon(text) + "\u0000" + canon(author);
}

// Fold diacritics for diacritic-insensitive search ("Brontë" matches "bronte").
function fold(s) {
  s = String(s == null ? "" : s);
  if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s.toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Attribution: parse a pasted quotation into { text, author }
 * ------------------------------------------------------------------ */

// The separators a human puts between a quote and its author, longest first so
// " -- " is tried before " - ". Each requires surrounding space so a hyphen
// inside a word ("well-being", "self-made") is never mistaken for a separator.
var SEP_RE = /\s+(?:—|–|--|-)\s+/g; // — – -- -   (em, en, double, single)

// Split a raw paste into { text, author }. The author is the tail after the
// LAST attribution separator; if there is none, the whole thing is the text and
// author is "". Both halves are unwrapped of surrounding quote marks and
// trimmed. A leading "— Author" (no text) yields empty text.
function parseAttribution(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return { text: "", author: "" };

  // A leading dash ("— Author", no preceding text) attributes without a quote.
  var lead = /^(?:—|–|--|-)\s+/;
  if (lead.test(s)) {
    return { text: "", author: stripWrappingQuotes(s.replace(lead, "").trim()) };
  }

  // Find the last separator match.
  SEP_RE.lastIndex = 0;
  var m, last = null;
  while ((m = SEP_RE.exec(s)) !== null) {
    last = m;
    if (m.index === SEP_RE.lastIndex) SEP_RE.lastIndex++; // guard zero-width
  }

  var text, author;
  if (last) {
    text = s.slice(0, last.index);
    author = s.slice(last.index + last[0].length);
  } else {
    text = s;
    author = "";
  }
  return {
    text: stripWrappingQuotes(text.trim()),
    author: stripWrappingQuotes(author.trim())
  };
}

// The inverse: render a { text, author } back to the canonical display form,
// `“text” — author`, or just `“text”` when there is no author.
function formatAttribution(q) {
  var text = String(q && q.text != null ? q.text : "").trim();
  var author = String(q && q.author != null ? q.author : "").trim();
  var quoted = "“" + text + "”";
  return author ? quoted + " — " + author : quoted;
}

/* ------------------------------------------------------------------ *
 * A small seeded PRNG and a fair rotation
 * ------------------------------------------------------------------ */

// mulberry32: a tiny, fast, well-distributed 32-bit PRNG. Deterministic given
// its seed, so "quote of the day" is stable and reproducible.
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seeded permutation of [0 .. n-1] via Fisher–Yates driven by mulberry32.
function seededOrder(n, seed) {
  var order = [];
  for (var i = 0; i < n; i++) order.push(i);
  var rnd = mulberry32(seed);
  for (var j = n - 1; j > 0; j--) {
    var k = Math.floor(rnd() * (j + 1));
    var tmp = order[j]; order[j] = order[k]; order[k] = tmp;
  }
  return order;
}

var BASE_SEED = 0x51A17E; // "SLATE"-ish constant; any fixed value works.

// Which quote to show on a given day index. The days are chopped into cycles of
// length n; each cycle is an independent seeded permutation, so WITHIN a cycle
// every quote appears exactly once (no repeat until all are seen), and the
// permutation differs cycle to cycle so the order is not a fixed loop.
function orderForDay(n, dayIndex) {
  if (n <= 0) return null;
  var cycle = Math.floor(dayIndex / n);
  var pos = ((dayIndex % n) + n) % n;
  return seededOrder(n, (BASE_SEED ^ cycle) >>> 0)[pos];
}

/* ------------------------------------------------------------------ *
 * The Store
 * ------------------------------------------------------------------ */

function normTags(tags) {
  if (!tags) return [];
  var out = [], seen = {};
  for (var i = 0; i < tags.length; i++) {
    var t = String(tags[i]).replace(/\s+/g, " ").trim().toLowerCase();
    if (t && !seen[t]) { seen[t] = 1; out.push(t); }
  }
  out.sort();
  return out;
}

function Store(quotes) {
  this._items = [];       // in insertion order: { id, text, author, tags[] }
  this._byKey = {};       // quoteKey -> item, for dedup
  this._seq = 0;
  if (quotes) for (var i = 0; i < quotes.length; i++) this.add(quotes[i]);
}

// Add a quote. Returns { added, item }. If a quote with the same identity key
// already exists, nothing is stored and added is false (the existing item is
// returned) — the dedup guarantee.
Store.prototype.add = function (q) {
  var text = String(q && q.text != null ? q.text : "").trim();
  var author = String(q && q.author != null ? q.author : "").trim();
  var tags = normTags(q && q.tags);
  var key = quoteKey(text, author);
  if (!canon(text)) return { added: false, item: null }; // empty quote: refused
  if (this._byKey[key]) return { added: false, item: this._byKey[key] };
  var item = { id: ++this._seq, text: text, author: author, tags: tags };
  this._items.push(item);
  this._byKey[key] = item;
  return { added: true, item: item };
};

// Add by pasting a raw "quote — author" string. Tags optional.
Store.prototype.addRaw = function (raw, tags) {
  var p = parseAttribution(raw);
  return this.add({ text: p.text, author: p.author, tags: tags });
};

Store.prototype.get = function (id) {
  for (var i = 0; i < this._items.length; i++)
    if (this._items[i].id === id) return this._items[i];
  return null;
};

// Edit a quote in place. Returns { ok, reason? }. Refuses if the edit would
// collide with a DIFFERENT existing quote's identity (same text+author).
Store.prototype.edit = function (id, fields) {
  var item = this.get(id);
  if (!item) return { ok: false, reason: "not-found" };
  var text = fields.text != null ? String(fields.text).trim() : item.text;
  var author = fields.author != null ? String(fields.author).trim() : item.author;
  var tags = fields.tags != null ? normTags(fields.tags) : item.tags;
  if (!canon(text)) return { ok: false, reason: "empty" };
  var newKey = quoteKey(text, author);
  var owner = this._byKey[newKey];
  if (owner && owner.id !== id) return { ok: false, reason: "duplicate" };
  var oldKey = quoteKey(item.text, item.author);
  delete this._byKey[oldKey];
  item.text = text; item.author = author; item.tags = tags;
  this._byKey[newKey] = item;
  return { ok: true, item: item };
};

Store.prototype.remove = function (id) {
  for (var i = 0; i < this._items.length; i++) {
    if (this._items[i].id === id) {
      var item = this._items[i];
      this._items.splice(i, 1);
      delete this._byKey[quoteKey(item.text, item.author)];
      return true;
    }
  }
  return false;
};

Store.prototype.list = function () { return this._items.slice(); };
Store.prototype.count = function () { return this._items.length; };

// Tag index: every tag with how many quotes carry it, sorted by tag name.
Store.prototype.tagCounts = function () {
  var counts = {};
  for (var i = 0; i < this._items.length; i++) {
    var tags = this._items[i].tags;
    for (var j = 0; j < tags.length; j++)
      counts[tags[j]] = (counts[tags[j]] || 0) + 1;
  }
  return Object.keys(counts).sort().map(function (t) {
    return { tag: t, count: counts[t] };
  });
};

// Tokenised search. Every whitespace-separated token in the query must appear
// (diacritic- and case-insensitively) somewhere in text+author+tags — an AND of
// substring tokens. A tag filter (array) further restricts to quotes carrying
// ALL of the given tags. Empty query + no tags returns everything, in order.
Store.prototype.search = function (query, tagFilter) {
  var tokens = fold(query || "").split(/\s+/).filter(Boolean);
  var want = normTags(tagFilter);
  return this._items.filter(function (item) {
    for (var t = 0; t < want.length; t++)
      if (item.tags.indexOf(want[t]) === -1) return false;
    if (!tokens.length) return true;
    var hay = fold(item.text + " " + item.author + " " + item.tags.join(" "));
    for (var i = 0; i < tokens.length; i++)
      if (hay.indexOf(tokens[i]) === -1) return false;
    return true;
  });
};

// The quote to feature on day `dayIndex` (an integer, e.g. days-since-epoch).
Store.prototype.quoteOfDay = function (dayIndex) {
  var n = this._items.length;
  if (!n) return null;
  return this._items[orderForDay(n, dayIndex)];
};

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

// Export to a plain object (stable field order) — JSON.stringify-ready.
Store.prototype.toObject = function () {
  return {
    version: 1,
    quotes: this._items.map(function (it) {
      return { text: it.text, author: it.author, tags: it.tags.slice() };
    })
  };
};

Store.prototype.toJSON = function () {
  return JSON.stringify(this.toObject(), null, 2);
};

// Import. Accepts the object/string produced by toObject/toJSON, and also a
// bare array of quotes. Dedup still applies, so importing a file twice is a
// no-op the second time. Returns a fresh Store.
function fromObject(obj) {
  var quotes;
  if (typeof obj === "string") obj = JSON.parse(obj);
  if (Array.isArray(obj)) quotes = obj;
  else if (obj && Array.isArray(obj.quotes)) quotes = obj.quotes;
  else quotes = [];
  return new Store(quotes);
}

/* ------------------------------------------------------------------ */

var API = {
  stripWrappingQuotes: stripWrappingQuotes,
  canon: canon,
  fold: fold,
  quoteKey: quoteKey,
  parseAttribution: parseAttribution,
  formatAttribution: formatAttribution,
  mulberry32: mulberry32,
  seededOrder: seededOrder,
  orderForDay: orderForDay,
  Store: Store,
  fromObject: fromObject
};

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof window !== "undefined") window.QuoteCore = API;
