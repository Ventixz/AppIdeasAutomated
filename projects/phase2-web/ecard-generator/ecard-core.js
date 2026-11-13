'use strict';
/*
 * ecard-core.js — the dependency-free heart of the E-Card Generator.
 *
 * An e-card is only useful if you can *send* it, so the centre of gravity here
 * is not the drawing — it is turning a card into a short, URL-safe token and
 * back again, losslessly, including emoji and other non-ASCII text. That one
 * requirement drags in the three things this module is actually built around:
 *
 *   1. A correct UTF-8 + base64url codec written by hand, because the browser's
 *      `btoa` throws on any character above U+00FF (so it cannot encode "🎂" or
 *      even "é"), and because URLs forbid the `+`, `/` and `=` that standard
 *      base64 produces. (Trap 1.)
 *   2. Word wrapping that fits a message into a fixed card area, hard-breaks a
 *      word too long for a single line, and truncates with an ellipsis instead
 *      of overflowing. (Trap 2.)
 *   3. HTML escaping, because the message is user text and it is rendered into
 *      the live preview. (Trap 3.)
 *
 * The module runs identically under Node (for `tests.js`) and in the browser
 * (where `script.js` consumes it). No DOM, no `window`, no dependencies.
 */

// ---------------------------------------------------------------------------
// Occasion + font registries
// ---------------------------------------------------------------------------

// Each occasion carries a sensible default heading, a decorative emoji, and a
// two-stop gradient + text colour. The UI offers these as presets; the user can
// override any field afterwards.
const OCCASIONS = {
  birthday:    { label: 'Birthday',     emoji: '🎂', heading: 'Happy Birthday!',      bg1: '#ff9a9e', bg2: '#fecfef', text: '#4a1d3f' },
  thankyou:    { label: 'Thank You',    emoji: '💐', heading: 'Thank You',            bg1: '#a8edea', bg2: '#fed6e3', text: '#1d4a47' },
  congrats:    { label: 'Congratulations', emoji: '🎉', heading: 'Congratulations!',  bg1: '#f6d365', bg2: '#fda085', text: '#4a2e14' },
  getwell:     { label: 'Get Well',     emoji: '🌿', heading: 'Get Well Soon',        bg1: '#d4fc79', bg2: '#96e6a1', text: '#18401f' },
  holiday:     { label: 'Holiday',      emoji: '❄️', heading: 'Happy Holidays',       bg1: '#accbee', bg2: '#e7f0fd', text: '#1b3a5c' },
  love:        { label: 'Love',         emoji: '❤️', heading: 'Thinking of You',      bg1: '#ff758c', bg2: '#ff7eb3', text: '#5c1026' },
  blank:       { label: 'Blank',        emoji: '✉️', heading: 'Hello',                bg1: '#e0c3fc', bg2: '#8ec5fc', text: '#2a1a4a' },
};

const FONTS = {
  sans:   { label: 'Sans',     stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  serif:  { label: 'Serif',    stack: "Georgia, 'Times New Roman', serif" },
  mono:   { label: 'Mono',     stack: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace" },
  script: { label: 'Handwriting', stack: "'Segoe Script', 'Brush Script MT', cursive" },
};

// Field length caps. A card is a postcard, not an essay — bounding the lengths
// keeps the token short and the layout predictable.
const LIMITS = { heading: 48, message: 300, signature: 48, emoji: 8 };

const DEFAULT_OCCASION = 'birthday';

// ---------------------------------------------------------------------------
// Trap 3 — HTML escaping
// ---------------------------------------------------------------------------

function escapeHtml(input) {
  return String(input == null ? '' : input).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ---------------------------------------------------------------------------
// Trap 1 — UTF-8 + base64url, by hand
// ---------------------------------------------------------------------------

// Encode a JS string (UTF-16 internally) into an array of UTF-8 byte values.
// Uses code points, so astral characters (emoji) are handled as single units
// rather than broken across their surrogate pair.
function utf8Encode(str) {
  const bytes = [];
  for (const ch of String(str)) {
    let code = ch.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function utf8Decode(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    let code;
    if (b < 0x80) {
      code = b;
    } else if (b < 0xe0) {
      code = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    } else if (b < 0xf0) {
      code = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else {
      code = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12)
           | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

// base64url alphabet: standard base64 with '+'/'/' swapped for '-'/'_' and no
// '=' padding, so the result is safe to drop straight into a URL.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REV = (() => { const m = {}; for (let i = 0; i < B64.length; i++) m[B64[i]] = i; return m; })();

function bytesToBase64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 0x0f) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 0x3f];
  }
  return out;
}

function base64urlToBytes(str) {
  const s = String(str);
  for (const ch of s) {
    if (!(ch in B64_REV)) throw new Error('invalid base64url character: ' + ch);
  }
  const bytes = [];
  for (let i = 0; i < s.length; i += 4) {
    const c0 = B64_REV[s[i]];
    const c1 = s[i + 1] !== undefined ? B64_REV[s[i + 1]] : undefined;
    const c2 = s[i + 2] !== undefined ? B64_REV[s[i + 2]] : undefined;
    const c3 = s[i + 3] !== undefined ? B64_REV[s[i + 3]] : undefined;
    if (c1 === undefined) {
      // A single leftover character cannot form a byte — malformed input.
      throw new Error('truncated base64url input');
    }
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined) bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (c3 !== undefined) bytes.push(((c2 & 0x03) << 6) | c3);
  }
  return bytes;
}

// Convenience: string <-> base64url in one hop.
function encodeB64url(str) { return bytesToBase64url(utf8Encode(str)); }
function decodeB64url(token) { return utf8Decode(base64urlToBytes(token)); }

// ---------------------------------------------------------------------------
// Card model: normalise, validate, (de)serialise
// ---------------------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isHexColor(v) { return typeof v === 'string' && HEX_RE.test(v.trim()); }

// Produce a complete, bounded card from partial/untrusted input. Missing fields
// fall back to the chosen occasion's defaults; over-long text is truncated;
// invalid colours are replaced. The result is always safe to render and encode.
function clampCard(input) {
  const src = input && typeof input === 'object' ? input : {};
  const occKey = src.occasion in OCCASIONS ? src.occasion : DEFAULT_OCCASION;
  const occ = OCCASIONS[occKey];

  const pick = (val, fallback, limit) => {
    const s = (val == null ? '' : String(val));
    const chosen = s.trim() === '' ? fallback : s;
    return cap(chosen, limit);
  };

  return {
    occasion: occKey,
    heading: pick(src.heading, occ.heading, LIMITS.heading),
    message: cap(src.message == null ? '' : String(src.message), LIMITS.message),
    signature: cap(src.signature == null ? '' : String(src.signature), LIMITS.signature),
    emoji: pick(src.emoji, occ.emoji, LIMITS.emoji),
    font: src.font in FONTS ? src.font : 'sans',
    bg1: isHexColor(src.bg1) ? src.bg1.trim() : occ.bg1,
    bg2: isHexColor(src.bg2) ? src.bg2.trim() : occ.bg2,
    text: isHexColor(src.text) ? src.text.trim() : occ.text,
  };
}

// Cap by code points (not UTF-16 units), so truncation never splits an emoji
// into a lone surrogate.
function cap(str, limit) {
  const chars = Array.from(String(str));
  return chars.length <= limit ? String(str) : chars.slice(0, limit).join('');
}

// Report problems without mutating. Used by the UI to show gentle warnings; a
// card can still be rendered even when `valid` is false (clampCard will fix it).
function validateCard(input) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};
  if (!src.message || String(src.message).trim() === '') {
    errors.push('A card needs a message.');
  }
  if (src.message && Array.from(String(src.message)).length > LIMITS.message) {
    errors.push(`Message is too long (max ${LIMITS.message} characters).`);
  }
  for (const key of ['bg1', 'bg2', 'text']) {
    if (src[key] != null && String(src[key]).trim() !== '' && !isHexColor(src[key])) {
      errors.push(`"${key}" is not a valid hex colour.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// Compact, versioned token. We serialise a positional array (not an object) so
// the JSON is short, then UTF-8 + base64url it, then prefix a one-char version
// so the format can evolve without silently misreading old links.
const TOKEN_VERSION = '1';
const FIELD_ORDER = ['occasion', 'heading', 'message', 'signature', 'emoji', 'font', 'bg1', 'bg2', 'text'];

function encodeCard(card) {
  const c = clampCard(card);
  const arr = FIELD_ORDER.map((k) => c[k]);
  return TOKEN_VERSION + encodeB64url(JSON.stringify(arr));
}

function decodeCard(token) {
  if (typeof token !== 'string' || token.length < 2) {
    throw new Error('empty or malformed token');
  }
  const version = token[0];
  if (version !== TOKEN_VERSION) {
    throw new Error('unsupported token version: ' + version);
  }
  const json = decodeB64url(token.slice(1));
  let arr;
  try { arr = JSON.parse(json); } catch (e) { throw new Error('token payload is not valid JSON'); }
  if (!Array.isArray(arr)) throw new Error('token payload is not an array');
  const obj = {};
  FIELD_ORDER.forEach((k, i) => { obj[k] = arr[i]; });
  return clampCard(obj);
}

// Build/parse a shareable link. The card lives in the URL *fragment* (after #),
// which is never sent to a server, so the card text stays on the recipient's
// machine.
function buildShareUrl(baseUrl, card) {
  const base = String(baseUrl || '').split('#')[0];
  return base + '#card=' + encodeCard(card);
}

function parseShareUrl(url) {
  const hash = String(url || '').split('#')[1] || '';
  const m = /(?:^|&)card=([^&]+)/.exec(hash);
  if (!m) return null;
  try { return decodeCard(m[1]); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Trap 2 — word wrapping
// ---------------------------------------------------------------------------

// Greedy word wrap. Splits on whitespace, packs words onto lines up to
// `maxCharsPerLine`, hard-breaks any single word longer than a line, and — if
// the result would exceed `maxLines` — stops and marks the last kept line with
// an ellipsis. Returns { lines, truncated }. Pure string math so it is testable
// without a canvas; the browser renderer uses it for the live preview, and a
// canvas-measured variant for the exported PNG.
function wrapText(text, maxCharsPerLine, maxLines) {
  const max = Math.max(1, maxCharsPerLine | 0);
  const cap = maxLines == null ? Infinity : Math.max(1, maxLines | 0);
  const lines = [];
  const paragraphs = String(text == null ? '' : text).split(/\r?\n/);

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) { lines.push(''); continue; }
    let line = '';
    for (let word of words) {
      // Hard-break a word that cannot fit on any line.
      while (Array.from(word).length > max) {
        const head = Array.from(word).slice(0, max).join('');
        const tail = Array.from(word).slice(max).join('');
        if (line) { lines.push(line); line = ''; }
        lines.push(head);
        word = tail;
      }
      if (line === '') {
        line = word;
      } else if (Array.from(line + ' ' + word).length <= max) {
        line += ' ' + word;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line !== '') lines.push(line);
  }

  if (lines.length <= cap) return { lines, truncated: false };

  const kept = lines.slice(0, cap);
  let last = kept[kept.length - 1];
  const lastChars = Array.from(last);
  if (lastChars.length >= max) {
    last = lastChars.slice(0, Math.max(0, max - 1)).join('') + '…';
  } else {
    last = last.replace(/\s+$/, '') + '…';
  }
  kept[kept.length - 1] = last;
  return { lines: kept, truncated: true };
}

// ---------------------------------------------------------------------------
// Exports (Node) / global (browser)
// ---------------------------------------------------------------------------

const API = {
  OCCASIONS, FONTS, LIMITS, DEFAULT_OCCASION, TOKEN_VERSION, FIELD_ORDER,
  escapeHtml,
  utf8Encode, utf8Decode, bytesToBase64url, base64urlToBytes, encodeB64url, decodeB64url,
  isHexColor, clampCard, cap, validateCard,
  encodeCard, decodeCard, buildShareUrl, parseShareUrl,
  wrapText,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else if (typeof window !== 'undefined') {
  window.ECardCore = API;
}
