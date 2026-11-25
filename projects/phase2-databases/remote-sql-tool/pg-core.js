'use strict';
/*
 * pg-core.js — the PostgreSQL v3 wire protocol, hand-written.
 * =========================================================================
 * Remote SQL Tool (karan/Projects, Databases 2/7). The task: "a utility that
 * can execute queries on remote servers from your local computer across the
 * Internet" — host, user, password in; rows out. The *remote* part is the whole
 * point, and "remote" means a wire protocol: you don't call a function on the
 * database, you exchange framed bytes with it over a socket.
 *
 * So this file speaks PostgreSQL's frontend/backend protocol, version 3.0, from
 * the bytes up. No `pg`, no `pg-protocol`, no `libpq`. Even the crypto the
 * handshake needs — MD5, SHA-256, HMAC, PBKDF2 — is hand-written here, so the
 * SCRAM-SHA-256 login is real, not stubbed.
 *
 * Three things are genuinely hard, and each has tests that pin it:
 *
 *   TRAP 1 — framing. Every message is [1 type byte][Int32 length][payload],
 *   where the length COUNTS ITSELF (the 4 bytes) but NOT the type byte. Except
 *   the very first message (StartupMessage) has NO type byte at all. A reader
 *   that always eats a type byte desyncs immediately; one that forgets the
 *   length includes itself reads 4 bytes into the next message. And TCP hands
 *   you arbitrary chunks, so the reader must buffer partial messages and only
 *   yield whole ones.
 *
 *   TRAP 2 — authentication is a real protocol, not a password compare.
 *   MD5 auth salts a double-MD5 so the salt makes every login's bytes
 *   different. SCRAM-SHA-256 (RFC 5802 / RFC 7677) is a four-step challenge:
 *   PBKDF2 the password with the server's salt+iterations, derive a proof, and
 *   — the part people skip — VERIFY the server's signature back, which is what
 *   stops a man in the middle. We check the server's nonce extends ours and the
 *   final signature matches, and the test pins the whole exchange to the RFC's
 *   worked example.
 *
 *   TRAP 3 — a row is not a row of strings. A DataRow gives raw bytes per
 *   column, and a column length of -1 means SQL NULL, which is NOT the empty
 *   string (length 0). You only know a column is an integer because the
 *   RowDescription that came first carried its type OID. Decode by OID, keep
 *   NULL distinct, or every nullable column lies to you.
 *
 * Exports a transport-agnostic client state machine (PgClient) and an in-memory
 * server that speaks the same protocol (PgServer) so the browser demo and the
 * Node tests can do a real handshake with no network. The CLI points the same
 * client at a real TCP socket.
 */

/* ======================================================================== *
 *  Byte helpers (browser + Node; no Buffer in the core)
 * ======================================================================== */

const _enc = new TextEncoder();
const _dec = new TextDecoder('utf-8', { fatal: false });
function enc(str) { return _enc.encode(str); }
function dec(bytes) { return _dec.decode(bytes); }

function concatBytes(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

// Base64 by hand (don't rely on btoa/atob — those are Latin1-only in Node).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += (i + 1 < bytes.length) ? B64[(n >> 6) & 63] : '=';
    out += (i + 2 < bytes.length) ? B64[n & 63] : '=';
  }
  return out;
}
function b64decode(str) {
  const out = [];
  let buffer = 0, bits = 0;
  for (const ch of str) {
    const val = B64.indexOf(ch);
    if (val < 0) continue; // skip '=' and whitespace
    buffer = (buffer << 6) | val; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
  }
  return Uint8Array.from(out);
}

/* ======================================================================== *
 *  Crypto, hand-written (so the handshake is honest)
 * ======================================================================== */

function ror(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
function rol(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(data) {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const ml = data.length * 8;
  const total = Math.ceil((data.length + 1 + 8) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(data, 0);
  msg[data.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 4, ml >>> 0, false);
  dv.setUint32(total - 8, Math.floor(ml / 0x100000000), false);
  const w = new Uint32Array(64);
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = ror(w[t - 15], 7) ^ ror(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = ror(w[t - 2], 17) ^ ror(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((h, i) => odv.setUint32(i * 4, h >>> 0, false));
  return out;
}

function hmacSha256(key, msg) {
  const block = 64;
  if (key.length > block) key = sha256(key);
  const k = new Uint8Array(block);
  k.set(key);
  const ipad = new Uint8Array(block), opad = new Uint8Array(block);
  for (let i = 0; i < block; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  const inner = sha256(concatBytes([ipad, msg]));
  return sha256(concatBytes([opad, inner]));
}

// PBKDF2-HMAC-SHA256. dkLen is typically 32 (one block) for SCRAM-SHA-256.
function pbkdf2Sha256(password, salt, iters, dkLen) {
  const hLen = 32;
  const blocks = Math.ceil(dkLen / hLen);
  const out = new Uint8Array(blocks * hLen);
  for (let i = 1; i <= blocks; i++) {
    const idx = new Uint8Array(4);
    new DataView(idx.buffer).setUint32(0, i, false);
    let u = hmacSha256(password, concatBytes([salt, idx]));
    const t = u.slice();
    for (let j = 1; j < iters; j++) {
      u = hmacSha256(password, u);
      for (let k = 0; k < hLen; k++) t[k] ^= u[k];
    }
    out.set(t, (i - 1) * hLen);
  }
  return out.slice(0, dkLen);
}

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = (() => {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  return K;
})();

function md5(data) {
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const ml = data.length * 8;
  const total = Math.ceil((data.length + 1 + 8) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(data, 0);
  msg[data.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, ml >>> 0, true);          // MD5 length is little-endian
  dv.setUint32(total - 4, Math.floor(ml / 0x100000000) >>> 0, true);
  for (let off = 0; off < total; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rol(F, MD5_S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  return out;
}

/* ======================================================================== *
 *  Errors
 * ======================================================================== */

class PgError extends Error {
  constructor(message, fields) {
    super(message);
    this.name = 'PgError';
    this.fields = fields || null;      // raw ErrorResponse fields when from the server
    if (fields && fields.C) this.code = fields.C; // SQLSTATE
  }
}

/* ======================================================================== *
 *  Writer / Reader for the framed wire
 * ======================================================================== */

class ByteWriter {
  constructor() { this.chunks = []; this._len = 0; }
  u8(n) { this.chunks.push(Uint8Array.of(n & 0xff)); this._len += 1; return this; }
  i16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, n, false); this.chunks.push(b); this._len += 2; return this; }
  i32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, false); this.chunks.push(b); this._len += 4; return this; }
  bytes(u8) { this.chunks.push(u8); this._len += u8.length; return this; }
  str(s) { return this.bytes(enc(s)); }
  cstr(s) { this.str(s); return this.u8(0); }        // null-terminated string
  build() { return concatBytes(this.chunks); }
}

// Frame a payload: optional 1-byte type, then Int32 length (counting itself),
// then the payload. type === null is the typeless StartupMessage.
function frame(type, payload) {
  const w = new ByteWriter();
  if (type !== null) w.u8(type.charCodeAt(0));
  w.i32(payload.length + 4);
  w.bytes(payload);
  return w.build();
}

// Reads a byte stream (fed in arbitrary chunks) and yields whole messages.
class MessageReader {
  constructor({ startup = false } = {}) {
    this.buf = new Uint8Array(0);
    this.expectStartup = startup;      // true only on a server, before the first message
  }
  push(bytes) { this.buf = this.buf.length ? concatBytes([this.buf, bytes]) : bytes; }
  next() {
    if (this.expectStartup) {
      if (this.buf.length < 4) return null;
      const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const len = dv.getInt32(0, false);
      if (this.buf.length < len) return null;        // length counts itself; no type byte
      const body = this.buf.slice(4, len);
      this.buf = this.buf.slice(len);
      this.expectStartup = false;
      return { type: null, body };
    }
    if (this.buf.length < 5) return null;             // need type + length first
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const type = String.fromCharCode(this.buf[0]);
    const len = dv.getInt32(1, false);               // length counts itself, excludes type
    if (this.buf.length < 1 + len) return null;       // partial — wait for more
    const body = this.buf.slice(5, 1 + len);
    this.buf = this.buf.slice(1 + len);
    return { type, body };
  }
}

// Parse the inside of one message payload.
class Reader {
  constructor(bytes) { this.b = bytes; this.p = 0; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u8() { return this.b[this.p++]; }
  i16() { const v = this.dv.getInt16(this.p, false); this.p += 2; return v; }
  i32() { const v = this.dv.getInt32(this.p, false); this.p += 4; return v; }
  bytes(n) { const v = this.b.slice(this.p, this.p + n); this.p += n; return v; }
  cstr() { const s = this.p; while (this.p < this.b.length && this.b[this.p] !== 0) this.p++; const v = dec(this.b.slice(s, this.p)); this.p++; return v; }
  rest() { const v = this.b.slice(this.p); this.p = this.b.length; return v; }
  remaining() { return this.b.length - this.p; }
}

/* ======================================================================== *
 *  Frontend (client → server) messages
 * ======================================================================== */

const PROTOCOL_VERSION = 196608; // 3 << 16 | 0

function startupMessage(params) {
  const w = new ByteWriter();
  w.i32(PROTOCOL_VERSION);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    w.cstr(k).cstr(String(v));
  }
  w.u8(0); // terminating null
  return frame(null, w.build());
}
function passwordMessage(str) { return frame('p', new ByteWriter().cstr(str).build()); }
function saslInitialResponse(mechanism, initial) {
  const ib = enc(initial);
  const w = new ByteWriter().cstr(mechanism).i32(ib.length).bytes(ib);
  return frame('p', w.build());
}
function saslResponse(str) { return frame('p', enc(str)); }
function queryMessage(sql) { return frame('Q', new ByteWriter().cstr(sql).build()); }
function terminateMessage() { return frame('X', new Uint8Array(0)); }

/* ======================================================================== *
 *  Backend (server → client) message parsing
 * ======================================================================== */

function parseBackend(type, body) {
  const r = new Reader(body);
  switch (type) {
    case 'R': {
      const code = r.i32();
      const m = { name: 'authentication', code };
      if (code === 5) m.salt = r.bytes(4);                                   // MD5 salt
      else if (code === 10) { m.mechanisms = []; let s; while ((s = r.cstr()) !== '') m.mechanisms.push(s); } // SASL
      else if (code === 11) m.data = dec(r.rest());                           // SASLContinue (server-first)
      else if (code === 12) m.data = dec(r.rest());                           // SASLFinal (v=...)
      return m;
    }
    case 'S': return { name: 'parameterStatus', key: r.cstr(), value: r.cstr() };
    case 'K': return { name: 'backendKeyData', pid: r.i32(), secret: r.i32() };
    case 'Z': return { name: 'readyForQuery', status: String.fromCharCode(r.u8()) };
    case 'T': {
      const n = r.i16(); const fields = [];
      for (let i = 0; i < n; i++) {
        fields.push({
          name: r.cstr(), tableOid: r.i32(), column: r.i16(),
          typeOid: r.i32(), typeSize: r.i16(), typeMod: r.i32(), format: r.i16(),
        });
      }
      return { name: 'rowDescription', fields };
    }
    case 'D': {
      const n = r.i16(); const columns = [];
      for (let i = 0; i < n; i++) { const len = r.i32(); columns.push(len === -1 ? null : r.bytes(len)); }
      return { name: 'dataRow', columns };
    }
    case 'C': return { name: 'commandComplete', tag: r.cstr() };
    case 'E': case 'N': {
      const fields = {}; let f;
      while ((f = r.u8()) !== 0 && f !== undefined) fields[String.fromCharCode(f)] = r.cstr();
      return { name: type === 'E' ? 'errorResponse' : 'noticeResponse', fields };
    }
    case 'I': return { name: 'emptyQueryResponse' };
    case 'n': return { name: 'noData' };
    case 'A': return { name: 'notificationResponse', pid: r.i32(), channel: r.cstr(), payload: r.cstr() };
    default: return { name: 'unknown', type, body };
  }
}

/* ======================================================================== *
 *  Type decoding — a DataRow is bytes; only the OID says what they mean
 * ======================================================================== */

const TYPE_NAMES = {
  16: 'bool', 17: 'bytea', 18: 'char', 19: 'name', 20: 'int8', 21: 'int2',
  23: 'int4', 25: 'text', 26: 'oid', 114: 'json', 700: 'float4', 701: 'float8',
  1042: 'bpchar', 1043: 'varchar', 1082: 'date', 1114: 'timestamp',
  1184: 'timestamptz', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb',
};
function typeName(oid) { return TYPE_NAMES[oid] || ('oid:' + oid); }

function decodeValue(oid, bytes) {
  if (bytes === null) return null;                 // SQL NULL — never confuse with ''
  const s = dec(bytes);
  switch (oid) {
    case 16: return s === 't';
    case 21: case 23: case 26: return parseInt(s, 10);
    case 20: {                                      // int8 may exceed Number's safe range
      const n = BigInt(s);
      return (n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(n) : s;
    }
    case 700: case 701: return Number(s);
    default: return s;                              // text, varchar, dates, numeric, json: keep as string
  }
}

/* ======================================================================== *
 *  SCRAM-SHA-256 (RFC 5802 / RFC 7677) — the real one, both sides
 * ======================================================================== */

function parseScramAttrs(str) {
  const out = {};
  for (const part of str.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}
// SASLprep is RFC 4013; a faithful implementation needs the full stringprep
// tables. We pass UTF-8 through (correct for the common ASCII case) and escape
// only the SCRAM-reserved characters in the username's n= attribute.
function saslName(user) { return user.replace(/=/g, '=3D').replace(/,/g, '=2C'); }

function buildScramClient(user, password, clientNonce) {
  const gs2 = 'n,,';
  const clientFirstBare = `n=${saslName(user)},r=${clientNonce}`;
  const clientFirst = gs2 + clientFirstBare;
  return {
    mechanism: 'SCRAM-SHA-256',
    gs2, clientFirstBare, clientFirst, clientNonce,
    // Given the server-first string, produce client-final and what we expect back.
    final(serverFirst) {
      const a = parseScramAttrs(serverFirst);
      if (!a.r || !a.s || !a.i) throw new PgError('SCRAM: malformed server-first message');
      const serverNonce = a.r;
      if (!serverNonce.startsWith(clientNonce)) {
        throw new PgError('SCRAM: server nonce does not extend the client nonce (possible MITM)');
      }
      const salt = b64decode(a.s);
      const iters = parseInt(a.i, 10);
      const saltedPassword = pbkdf2Sha256(enc(password), salt, iters, 32);
      const clientKey = hmacSha256(saltedPassword, enc('Client Key'));
      const storedKey = sha256(clientKey);
      const channelBinding = 'c=' + b64encode(enc(gs2));         // "c=biws"
      const clientFinalNoProof = `${channelBinding},r=${serverNonce}`;
      const authMessage = `${clientFirstBare},${serverFirst},${clientFinalNoProof}`;
      const clientSignature = hmacSha256(storedKey, enc(authMessage));
      const clientProof = xorBytes(clientKey, clientSignature);
      const serverKey = hmacSha256(saltedPassword, enc('Server Key'));
      const serverSignature = hmacSha256(serverKey, enc(authMessage));
      return {
        clientFinal: `${clientFinalNoProof},p=${b64encode(clientProof)}`,
        expectedServerSignature: b64encode(serverSignature),
      };
    },
  };
}

// Server side of SCRAM: verify a client proof and sign back. Used by PgServer.
function scramServerVerify(password, clientFirstBare, serverFirst, clientFinal) {
  const sa = parseScramAttrs(serverFirst);
  const salt = b64decode(sa.s);
  const iters = parseInt(sa.i, 10);
  const fa = parseScramAttrs(clientFinal);
  if (!fa.p || !fa.r) throw new PgError('SCRAM: malformed client-final message');
  if (fa.r !== sa.r) throw new PgError('SCRAM: nonce mismatch in client-final');
  const clientFinalNoProof = clientFinal.slice(0, clientFinal.lastIndexOf(',p='));
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalNoProof}`;
  const saltedPassword = pbkdf2Sha256(enc(password), salt, iters, 32);
  const clientKey = hmacSha256(saltedPassword, enc('Client Key'));
  const storedKey = sha256(clientKey);
  const clientSignature = hmacSha256(storedKey, enc(authMessage));
  const recoveredClientKey = xorBytes(b64decode(fa.p), clientSignature);
  const recoveredStoredKey = sha256(recoveredClientKey);
  const ok = toHex(recoveredStoredKey) === toHex(storedKey);
  const serverKey = hmacSha256(saltedPassword, enc('Server Key'));
  const serverSignature = hmacSha256(serverKey, enc(authMessage));
  return { ok, serverFinal: 'v=' + b64encode(serverSignature) };
}

// MD5 auth: "md5" + md5( md5(password + user) as-hex-bytes + salt ).
function md5AuthResponse(user, password, salt) {
  const inner = toHex(md5(concatBytes([enc(password), enc(user)])));
  const outer = toHex(md5(concatBytes([enc(inner), salt])));
  return 'md5' + outer;
}

/* ======================================================================== *
 *  Nonce source (injectable for deterministic tests)
 * ======================================================================== */

function defaultNonce(len = 18) {
  const bytes = new Uint8Array(len);
  const g = (typeof globalThis !== 'undefined') ? globalThis : {};
  if (g.crypto && g.crypto.getRandomValues) g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  // printable, SCRAM-safe (no comma); base64url-ish
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

/* ======================================================================== *
 *  PgClient — the connection state machine (transport-agnostic)
 * ======================================================================== */

class PgClient {
  constructor(opts = {}) {
    this.opts = opts;
    this.user = opts.user || 'postgres';
    this.password = opts.password || '';
    this.database = opts.database || this.user;
    this.applicationName = opts.application_name || 'remote-sql-tool';
    this._nonce = opts.nonce || defaultNonce;      // () => string, or a fixed string
    this.onTrace = opts.onTrace || null;

    this.reader = new MessageReader();
    this.transport = null;
    this.state = 'idle';                            // idle|startup|auth|ready|busy|closed
    this.parameters = {};
    this.backendKey = null;
    this.txStatus = null;
    this.authMethod = null;                         // what the server asked for
    this.notices = [];
    this.trace = [];

    this._scram = null;
    this._connect = null;                           // {resolve,reject}
    this._current = null;                           // in-flight query
    this._queue = [];
  }

  attach(transport) { this.transport = transport; return this; }

  _logTrace(dir, label, bytes) {
    const e = { dir, label, len: bytes.length, bytes, seq: this.trace.length };
    this.trace.push(e);
    if (this.onTrace) try { this.onTrace(e); } catch (_) { /* trace must never break the protocol */ }
  }
  _send(bytes, label) {
    this._logTrace('C→S', label, bytes);
    this.transport.write(bytes);
  }

  connect() {
    if (!this.transport) throw new PgError('PgClient: attach a transport before connect()');
    return new Promise((resolve, reject) => {
      this._connect = { resolve, reject };
      this.state = 'startup';
      this._send(startupMessage({
        user: this.user, database: this.database, application_name: this.applicationName,
      }), 'StartupMessage');
    });
  }

  query(sql) {
    return new Promise((resolve, reject) => {
      this._queue.push({ sql, resolve, reject });
      this._drain();
    });
  }

  end() {
    if (this.state === 'closed') return;
    try { this._send(terminateMessage(), 'Terminate'); } catch (_) { /* socket may be gone */ }
    this.state = 'closed';
  }

  _drain() {
    if (this._current || this.state !== 'ready' || this._queue.length === 0) return;
    const job = this._queue.shift();
    this._current = {
      sql: job.sql, resolve: job.resolve, reject: job.reject,
      fields: null, rows: [], results: [], error: null, commandTag: null,
    };
    this.state = 'busy';
    this._send(queryMessage(job.sql), 'Query');
  }

  // Feed incoming bytes from the transport.
  push(bytes) {
    this.reader.push(bytes);
    let msg;
    while ((msg = this.reader.next()) !== null) {
      const parsed = parseBackend(msg.type, msg.body);
      this._logTrace('S→C', backendLabel(parsed), msg.body);
      try {
        this._handle(parsed);
      } catch (err) {
        this._fail(err);
      }
    }
  }

  _fail(err) {
    if (this._connect) { const c = this._connect; this._connect = null; this.state = 'closed'; c.reject(err); return; }
    if (this._current) { const q = this._current; this._current = null; this.state = 'ready'; q.reject(err); return; }
    throw err;
  }

  _handle(m) {
    switch (m.name) {
      case 'authentication': return this._handleAuth(m);
      case 'parameterStatus': this.parameters[m.key] = m.value; return;
      case 'backendKeyData': this.backendKey = { pid: m.pid, secret: m.secret }; return;
      case 'readyForQuery': return this._handleReady(m);
      case 'rowDescription':
        if (this._current) this._current.fields = m.fields.map(f => ({ name: f.name, typeOid: f.typeOid, dataType: typeName(f.typeOid) }));
        if (this._current) this._current._oids = m.fields.map(f => f.typeOid);
        return;
      case 'dataRow': {
        if (!this._current) return;
        const oids = this._current._oids || [];
        const names = (this._current.fields || []).map(f => f.name);
        const row = {};
        const arr = [];
        for (let i = 0; i < m.columns.length; i++) {
          const v = decodeValue(oids[i], m.columns[i]);
          arr.push(v);
          row[names[i] != null ? names[i] : i] = v;
        }
        row[Symbol.for('array')] = arr;
        this._current.rows.push(row);
        return;
      }
      case 'commandComplete':
        if (this._current) {
          this._current.results.push({
            command: m.tag, fields: this._current.fields || [], rows: this._current.rows,
          });
          this._current.commandTag = m.tag;
          this._current.fields = null; this._current.rows = []; this._current._oids = null;
        }
        return;
      case 'emptyQueryResponse':
        if (this._current) this._current.results.push({ command: '', fields: [], rows: [] });
        return;
      case 'errorResponse': {
        const err = new PgError(m.fields.M || 'server error', m.fields);
        if (this._current) this._current.error = err;
        else if (this._connect) { const c = this._connect; this._connect = null; this.state = 'closed'; c.reject(err); }
        return;
      }
      case 'noticeResponse':
        this.notices.push(m.fields);
        if (this.opts.onNotice) this.opts.onNotice(m.fields);
        return;
      case 'notificationResponse':
        if (this.opts.onNotification) this.opts.onNotification(m);
        return;
      default:
        return; // unknown messages are ignored (forward-compatible)
    }
  }

  _handleAuth(m) {
    switch (m.code) {
      case 0: this.authMethod = this.authMethod || 'trust'; return;        // AuthenticationOk
      case 3: this.authMethod = 'cleartext'; this._send(passwordMessage(this.password), 'PasswordMessage(cleartext)'); return;
      case 5: this.authMethod = 'md5'; this._send(passwordMessage(md5AuthResponse(this.user, this.password, m.salt)), 'PasswordMessage(md5)'); return;
      case 10: {                                                            // SASL
        if (!m.mechanisms.includes('SCRAM-SHA-256')) {
          throw new PgError('SASL: server offered ' + m.mechanisms.join(', ') + ' but only SCRAM-SHA-256 is supported');
        }
        this.authMethod = 'scram-sha-256';
        const nonce = typeof this._nonce === 'function' ? this._nonce() : this._nonce;
        this._scram = buildScramClient(this.user, this.password, nonce);
        this._send(saslInitialResponse(this._scram.mechanism, this._scram.clientFirst), 'SASLInitialResponse');
        return;
      }
      case 11: {                                                           // SASLContinue
        const r = this._scram.final(m.data);
        this._scram._expected = r.expectedServerSignature;
        this._send(saslResponse(r.clientFinal), 'SASLResponse');
        return;
      }
      case 12: {                                                           // SASLFinal
        const a = parseScramAttrs(m.data);
        if (a.e) throw new PgError('SCRAM authentication failed: ' + a.e);
        if (a.v !== this._scram._expected) {
          throw new PgError('SCRAM: server signature mismatch — cannot trust this server');
        }
        this._scram = null;
        return;
      }
      default:
        throw new PgError('Unsupported authentication request (code ' + m.code + ')');
    }
  }

  _handleReady(m) {
    this.txStatus = m.status;
    if (this._connect) {
      const c = this._connect; this._connect = null;
      this.state = 'ready';
      c.resolve(this);
      this._drain();
      return;
    }
    if (this._current) {
      const q = this._current; this._current = null;
      this.state = 'ready';
      if (q.error) q.reject(q.error);
      else {
        const last = q.results[q.results.length - 1] || { command: q.commandTag || '', fields: [], rows: [] };
        q.resolve({
          results: q.results,
          command: last.command,
          fields: last.fields,
          rows: last.rows,
          rowCount: last.rows.length,
        });
      }
      this._drain();
      return;
    }
    this.state = 'ready';
  }
}

function backendLabel(parsed) {
  if (parsed.name === 'authentication') {
    const names = { 0: 'AuthenticationOk', 3: 'AuthCleartextPassword', 5: 'AuthMD5Password', 10: 'AuthSASL', 11: 'AuthSASLContinue', 12: 'AuthSASLFinal' };
    return names[parsed.code] || ('Authentication(' + parsed.code + ')');
  }
  const map = {
    parameterStatus: 'ParameterStatus', backendKeyData: 'BackendKeyData', readyForQuery: 'ReadyForQuery',
    rowDescription: 'RowDescription', dataRow: 'DataRow', commandComplete: 'CommandComplete',
    errorResponse: 'ErrorResponse', noticeResponse: 'NoticeResponse', emptyQueryResponse: 'EmptyQueryResponse',
    notificationResponse: 'NotificationResponse', noData: 'NoData',
  };
  return map[parsed.name] || parsed.name;
}

/* ======================================================================== *
 *  PgServer — an in-memory backend that speaks the same protocol.
 *  Not a stand-in for the protocol (that's real); a stand-in for a *remote
 *  host*, so the browser demo and the tests can do a genuine handshake with no
 *  network. The query engine is deliberately small — the protocol is the point.
 * ======================================================================== */

const DEFAULT_DATASET = () => ({
  employees: {
    columns: [
      { name: 'id', oid: 23 }, { name: 'name', oid: 25 }, { name: 'department', oid: 25 },
      { name: 'salary', oid: 23 }, { name: 'active', oid: 16 }, { name: 'manager_id', oid: 23 },
    ],
    rows: [
      [1, 'Ada Lovelace', 'Engineering', 142000, true, null],
      [2, 'Alan Turing', 'Engineering', 155000, true, 1],
      [3, 'Grace Hopper', 'Engineering', 138000, true, 1],
      [4, 'Katherine Johnson', 'Research', 149000, true, null],
      [5, 'Edsger Dijkstra', 'Research', 133000, false, 4],
      [6, 'Barbara Liskov', 'Engineering', 161000, true, 1],
      [7, 'Donald Knuth', 'Research', 158000, true, 4],
      [8, 'Margaret Hamilton', 'Operations', 127000, true, null],
      [9, 'Dennis Ritchie', 'Engineering', 144000, false, 1],
      [10, 'Radia Perlman', 'Operations', 131000, true, 8],
    ],
  },
  departments: {
    columns: [{ name: 'name', oid: 25 }, { name: 'floor', oid: 23 }, { name: 'budget', oid: 23 }],
    rows: [
      ['Engineering', 3, 2400000],
      ['Research', 4, 1800000],
      ['Operations', 1, 900000],
    ],
  },
});

class PgServer {
  constructor(opts = {}) {
    this.authMethod = opts.authMethod || 'scram-sha-256';   // trust|cleartext|md5|scram-sha-256
    this.users = opts.users || { postgres: 'postgres' };     // user -> password
    this.database = opts.database || 'appdb';
    this.serverVersion = opts.serverVersion || '16.2 (remote-sql-tool mock)';
    this.dataset = opts.dataset || DEFAULT_DATASET();
    this.nonce = opts.nonce || defaultNonce;
    this.scramSalt = opts.scramSalt || null;                 // fixed salt for tests
    this.scramIterations = opts.scramIterations || 4096;
    this.transport = null;
    this.reader = new MessageReader({ startup: true });
    this.state = 'startup';                                   // startup|auth|ready|closed
    this.startupParams = {};
    this._scram = null;
    this._pendingUser = null;
  }

  attach(transport) { this.transport = transport; return this; }
  _send(bytes) { this.transport.write(bytes); }

  push(bytes) {
    this.reader.push(bytes);
    let msg;
    while ((msg = this.reader.next()) !== null) this._handle(msg);
  }

  _error(code, message) {
    const w = new ByteWriter();
    w.u8('S'.charCodeAt(0)).cstr('ERROR');
    w.u8('V'.charCodeAt(0)).cstr('ERROR');
    w.u8('C'.charCodeAt(0)).cstr(code);
    w.u8('M'.charCodeAt(0)).cstr(message);
    w.u8(0);
    this._send(frame('E', w.build()));
  }

  _authOk() {
    this._send(frame('R', new ByteWriter().i32(0).build()));               // AuthenticationOk
    const ps = (k, v) => this._send(frame('S', new ByteWriter().cstr(k).cstr(v).build()));
    ps('server_version', this.serverVersion);
    ps('client_encoding', 'UTF8');
    ps('DateStyle', 'ISO, MDY');
    ps('server_encoding', 'UTF8');
    ps('application_name', this.startupParams.application_name || '');
    this._send(frame('K', new ByteWriter().i32(12345).i32(67890).build())); // BackendKeyData
    this._ready();
    this.state = 'ready';
  }

  _ready() { this._send(frame('Z', new ByteWriter().u8('I'.charCodeAt(0)).build())); }

  _handle(msg) {
    if (this.state === 'startup' && msg.type === null) {
      const r = new Reader(msg.body);
      const version = r.i32();
      if (version === 80877103) { // SSLRequest — we don't do TLS in the mock; say no ('N')
        this._send(Uint8Array.of('N'.charCodeAt(0)));
        this.reader.expectStartup = true; // the real startup follows
        return;
      }
      let key;
      while ((key = r.cstr()) !== '') this.startupParams[key] = r.cstr();
      this._pendingUser = this.startupParams.user;
      this._beginAuth();
      return;
    }
    if (this.state === 'auth') { this._handleAuthMessage(msg); return; }
    if (this.state === 'ready') {
      if (msg.type === 'Q') { this._handleQuery(new Reader(msg.body).cstr()); return; }
      if (msg.type === 'X') { this.state = 'closed'; return; }
      return;
    }
  }

  _beginAuth() {
    const user = this._pendingUser;
    if (!(user in this.users) && this.authMethod !== 'trust') {
      // Postgres reports this at auth time; keep it realistic.
      this._error('28000', `role "${user}" does not exist`);
      this.state = 'closed';
      return;
    }
    this.state = 'auth';
    switch (this.authMethod) {
      case 'trust': this._authOk(); return;
      case 'cleartext': this._send(frame('R', new ByteWriter().i32(3).build())); return;
      case 'md5':
        this._md5Salt = this.nonceBytes(4);
        this._send(frame('R', new ByteWriter().i32(5).bytes(this._md5Salt).build()));
        return;
      case 'scram-sha-256': {
        const w = new ByteWriter().i32(10).cstr('SCRAM-SHA-256').u8(0);
        this._send(frame('R', w.build()));
        return;
      }
      default: this._error('0A000', 'unsupported auth method'); this.state = 'closed';
    }
  }

  nonceBytes(n) {
    const b = new Uint8Array(n);
    const g = (typeof globalThis !== 'undefined') ? globalThis : {};
    if (g.crypto && g.crypto.getRandomValues) g.crypto.getRandomValues(b);
    else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }

  _handleAuthMessage(msg) {
    if (msg.type !== 'p') { this._error('08P01', 'expected password message'); this.state = 'closed'; return; }
    const user = this._pendingUser;
    const expected = this.users[user];
    if (this.authMethod === 'cleartext') {
      const given = new Reader(msg.body).cstr();
      return this._finishPassword(given === expected);
    }
    if (this.authMethod === 'md5') {
      const given = new Reader(msg.body).cstr();
      const want = 'md5' + toHex(md5(concatBytes([enc(toHex(md5(concatBytes([enc(expected), enc(user)])))), this._md5Salt])));
      return this._finishPassword(given === want);
    }
    if (this.authMethod === 'scram-sha-256') return this._handleScram(msg);
  }

  _finishPassword(ok) {
    if (ok) this._authOk();
    else { this._error('28P01', `password authentication failed for user "${this._pendingUser}"`); this.state = 'closed'; }
  }

  _handleScram(msg) {
    const r = new Reader(msg.body);
    if (!this._scram) {
      // SASLInitialResponse: mechanism, Int32 len, initial
      const mechanism = r.cstr();
      const len = r.i32();
      const initial = dec(r.bytes(len));
      if (mechanism !== 'SCRAM-SHA-256') { this._error('28000', 'unsupported SASL mechanism'); this.state = 'closed'; return; }
      // initial = "n,,n=<user>,r=<cnonce>"
      const bare = initial.slice(initial.indexOf('n=', 3)); // after the gs2 header "n,,"
      const a = parseScramAttrs(bare);
      const clientNonce = a.r;
      const serverNonce = clientNonce + (typeof this.nonce === 'function' ? this.nonce() : this.nonce);
      const salt = this.scramSalt || this.nonceBytes(16);
      const serverFirst = `r=${serverNonce},s=${b64encode(salt)},i=${this.scramIterations}`;
      this._scram = { clientFirstBare: bare, serverFirst, salt };
      this._send(frame('R', new ByteWriter().i32(11).str(serverFirst).build()));
      return;
    }
    // SASLResponse: client-final
    const clientFinal = dec(msg.body);
    const expected = this.users[this._pendingUser];
    let res;
    try {
      res = scramServerVerify(expected, this._scram.clientFirstBare, this._scram.serverFirst, clientFinal);
    } catch (e) {
      this._error('28P01', 'SCRAM: ' + e.message); this.state = 'closed'; return;
    }
    if (!res.ok) { this._error('28P01', `password authentication failed for user "${this._pendingUser}"`); this.state = 'closed'; return; }
    this._send(frame('R', new ByteWriter().i32(12).str(res.serverFinal).build())); // SASLFinal
    this._scram = null;
    this._authOk();
  }

  _handleQuery(sql) {
    let result;
    try {
      result = this.execute(sql);
    } catch (e) {
      const code = e instanceof QueryError ? e.code : '42601';
      this._error(code, e.message);
      this._ready();
      return;
    }
    if (result.notice) {
      const w = new ByteWriter().u8('S'.charCodeAt(0)).cstr('NOTICE').u8('M'.charCodeAt(0)).cstr(result.notice).u8(0);
      this._send(frame('N', w.build()));
    }
    if (result.empty) { this._send(frame('I', new Uint8Array(0))); this._ready(); return; }
    // RowDescription
    const td = new ByteWriter().i16(result.columns.length);
    for (const c of result.columns) {
      td.cstr(c.name).i32(0).i16(0).i32(c.oid).i16(typeSizeOf(c.oid)).i32(-1).i16(0);
    }
    this._send(frame('T', td.build()));
    // DataRows
    for (const row of result.rows) {
      const dw = new ByteWriter().i16(row.length);
      for (const v of row) {
        if (v === null || v === undefined) dw.i32(-1);
        else { const b = enc(encodeValue(v)); dw.i32(b.length).bytes(b); }
      }
      this._send(frame('D', dw.build()));
    }
    this._send(frame('C', new ByteWriter().cstr(result.tag).build()));
    this._ready();
  }

  // The deliberately-small query engine.
  execute(sql) {
    return runMiniSql(sql, this.dataset, { database: this.database, user: this._pendingUser, version: this.serverVersion });
  }
}

function typeSizeOf(oid) { return ({ 16: 1, 23: 4, 21: 2, 20: 8, 700: 4, 701: 8 })[oid] || -1; }
function encodeValue(v) {
  if (v === true) return 't';
  if (v === false) return 'f';
  return String(v);
}

/* ======================================================================== *
 *  A small SQL engine for the mock backend. Scope on purpose: SELECT with
 *  WHERE (AND of comparisons), ORDER BY, LIMIT, COUNT(*), and a few scalar
 *  functions. Yesterday's project was the full SQL engine; today the protocol
 *  is the star, so this stays small but real.
 * ======================================================================== */

class QueryError extends Error { constructor(code, message) { super(message); this.code = code; } }

function runMiniSql(sql, dataset, ctx) {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed === '') return { empty: true, tag: '' };

  // Scalar one-liners people try first.
  const scalar = tryScalar(trimmed, ctx);
  if (scalar) return scalar;

  const m = /^select\s+(.+?)\s+from\s+([a-z_][a-z0-9_]*)\s*(.*)$/is.exec(trimmed);
  if (!m) {
    if (/^(insert|update|delete|create|drop|alter)\b/i.test(trimmed)) {
      throw new QueryError('25006', 'this read-only demo backend accepts SELECT statements only');
    }
    throw new QueryError('42601', 'syntax error: expected SELECT ... FROM <table>');
  }
  const selectList = m[1].trim();
  const tableName = m[2].toLowerCase();
  const tail = m[3].trim();
  const table = dataset[tableName];
  if (!table) throw new QueryError('42P01', `relation "${tableName}" does not exist`);

  // WHERE / ORDER BY / LIMIT
  let where = null, orderBy = null, orderDesc = false, limit = null;
  let rest = tail;
  const limitM = /\blimit\s+(\d+)\s*$/i.exec(rest);
  if (limitM) { limit = parseInt(limitM[1], 10); rest = rest.slice(0, limitM.index).trim(); }
  const orderM = /\border\s+by\s+([a-z_][a-z0-9_]*)\s*(asc|desc)?\s*$/i.exec(rest);
  if (orderM) { orderBy = orderM[1].toLowerCase(); orderDesc = /desc/i.test(orderM[2] || ''); rest = rest.slice(0, orderM.index).trim(); }
  const whereM = /^where\s+(.+)$/is.exec(rest);
  if (whereM) where = parseWhere(whereM[1], table);
  else if (rest !== '') throw new QueryError('42601', `syntax error near "${rest}"`);

  const colIndex = {};
  table.columns.forEach((c, i) => { colIndex[c.name] = i; });

  // Filter
  let rows = table.rows.filter(r => (where ? where(r, colIndex) : true));

  // Order
  if (orderBy) {
    if (!(orderBy in colIndex)) throw new QueryError('42703', `column "${orderBy}" does not exist`);
    const idx = colIndex[orderBy];
    rows = rows.slice().sort((a, b) => cmp(a[idx], b[idx]) * (orderDesc ? -1 : 1));
  }

  // Projection
  const isCount = /^count\s*\(\s*\*\s*\)$/i.test(selectList);
  if (isCount) {
    const n = limit != null ? Math.min(limit, rows.length) : rows.length;
    return { columns: [{ name: 'count', oid: 20 }], rows: [[n]], tag: 'SELECT 1' };
  }

  if (limit != null) rows = rows.slice(0, limit);

  let outCols;
  if (selectList === '*') outCols = table.columns.map((c, i) => ({ col: c, idx: i }));
  else {
    outCols = selectList.split(',').map(s => {
      const name = s.trim().toLowerCase();
      if (!(name in colIndex)) throw new QueryError('42703', `column "${name}" does not exist`);
      return { col: table.columns[colIndex[name]], idx: colIndex[name] };
    });
  }
  const columns = outCols.map(o => ({ name: o.col.name, oid: o.col.oid }));
  const outRows = rows.map(r => outCols.map(o => r[o.idx]));
  return { columns, rows: outRows, tag: `SELECT ${outRows.length}` };
}

function tryScalar(sql, ctx) {
  const s = sql.toLowerCase();
  if (s === 'select version()') return { columns: [{ name: 'version', oid: 25 }], rows: [[`PostgreSQL ${ctx.version}`]], tag: 'SELECT 1' };
  if (s === 'select current_user' || s === 'select user') return { columns: [{ name: 'current_user', oid: 25 }], rows: [[ctx.user]], tag: 'SELECT 1' };
  if (s === 'select current_database()') return { columns: [{ name: 'current_database', oid: 25 }], rows: [[ctx.database]], tag: 'SELECT 1' };
  if (s === 'select now()') return { columns: [{ name: 'now', oid: 1184 }], rows: [[new Date().toISOString().replace('T', ' ').replace('Z', '+00')]], tag: 'SELECT 1' };
  const lit = /^select\s+(-?\d+)\s*$/i.exec(sql);
  if (lit) return { columns: [{ name: '?column?', oid: 23 }], rows: [[parseInt(lit[1], 10)]], tag: 'SELECT 1' };
  return null;
}

function parseWhere(expr, table) {
  const colIndexNames = table.columns.map(c => c.name);
  const clauses = expr.split(/\s+and\s+/i).map(c => parseComparison(c.trim(), colIndexNames));
  return (row, colIndex) => clauses.every(cl => cl(row, colIndex));
}

function parseComparison(c, colNames) {
  // IS NULL / IS NOT NULL first (NULL never compares equal, so it needs its own test)
  const nullM = /^([a-z_][a-z0-9_]*)\s+is\s+(not\s+)?null$/is.exec(c);
  if (nullM) {
    const col = nullM[1].toLowerCase();
    if (!colNames.includes(col)) throw new QueryError('42703', `column "${col}" does not exist`);
    const wantNotNull = !!nullM[2];
    return (row, colIndex) => (row[colIndex[col]] === null) !== wantNotNull;
  }
  const m = /^([a-z_][a-z0-9_]*)\s*(>=|<=|<>|!=|=|>|<)\s*(.+)$/is.exec(c);
  if (!m) throw new QueryError('42601', `syntax error in WHERE near "${c}"`);
  const col = m[1].toLowerCase();
  if (!colNames.includes(col)) throw new QueryError('42703', `column "${col}" does not exist`);
  const op = m[2];
  const lit = parseLiteral(m[3].trim());
  return (row, colIndex) => {
    const v = row[colIndex[col]];
    const d = cmp(v, lit);
    switch (op) {
      case '=': return d === 0;
      case '<>': case '!=': return d !== 0;
      case '>': return d > 0;
      case '<': return d < 0;
      case '>=': return d >= 0;
      case '<=': return d <= 0;
    }
  };
}

function parseLiteral(s) {
  if (/^'.*'$/s.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (/^(true|false)$/i.test(s)) return /true/i.test(s);
  if (/^null$/i.test(s)) return null;
  throw new QueryError('42601', `unrecognized literal "${s}"`);
}

function cmp(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/* ======================================================================== *
 *  Loopback wiring helper — connect a client and a server with no network.
 *  Delivery is deferred so neither side re-enters the other mid-message.
 * ======================================================================== */

function connectLoopback(client, server, schedule) {
  const run = schedule || (typeof queueMicrotask === 'function' ? queueMicrotask : (fn => setTimeout(fn, 0)));
  client.attach({ write: (bytes) => run(() => { if (server.state !== 'closed') server.push(bytes); }) });
  server.attach({ write: (bytes) => run(() => { if (client.state !== 'closed') client.push(bytes); }) });
}

// Synchronous pump for tests: client/server write into outboxes; we shuttle
// bytes back and forth until nothing is in flight. No reentrancy, deterministic.
function makeSyncPair(client, server) {
  const toServer = [], toClient = [];
  client.attach({ write: (b) => toServer.push(b) });
  server.attach({ write: (b) => toClient.push(b) });
  const pump = () => {
    let guard = 0;
    while ((toServer.length || toClient.length) && guard++ < 100000) {
      while (toServer.length) server.push(toServer.shift());
      while (toClient.length) client.push(toClient.shift());
    }
  };
  return pump;
}

/* ======================================================================== *
 *  Exports
 * ======================================================================== */

const API = {
  // crypto / bytes (exported for the tests that pin them)
  sha256, md5, hmacSha256, pbkdf2Sha256, toHex, enc, dec, concatBytes, xorBytes,
  b64encode, b64decode,
  // protocol codec
  startupMessage, passwordMessage, saslInitialResponse, saslResponse, queryMessage,
  terminateMessage, parseBackend, decodeValue, typeName, TYPE_NAMES,
  MessageReader, ByteWriter, Reader, frame,
  // auth
  buildScramClient, scramServerVerify, md5AuthResponse, parseScramAttrs, defaultNonce,
  // state machines
  PgClient, PgServer, PgError, QueryError, runMiniSql, DEFAULT_DATASET,
  // wiring
  connectLoopback, makeSyncPair,
  PROTOCOL_VERSION,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.PgCore = API;
