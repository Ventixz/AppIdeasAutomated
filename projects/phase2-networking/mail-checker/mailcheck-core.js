/*
 * mailcheck-core.js — the mail-checking engine, transport-agnostic and DOM-free.
 *
 * The task (karan/Projects, Networking): "Mail Checker — write a program that
 * will take a username and password and check POP3 / IMAP mail." The one line
 * hides the actual lesson, which is that POP3 and IMAP answer the question "do I
 * have mail?" in two *fundamentally different* ways:
 *
 *   POP3  is a download-and-forget model. The mailbox is a flat spool of
 *         messages waiting to be pulled. POP3 has NO concept of read vs. unread
 *         — `STAT` gives you a message count and a total size in octets, and
 *         that's the whole story. "Unseen" is a question POP3 literally cannot
 *         answer, so we return it as `null` (unknown), never a dishonest `0`.
 *
 *   IMAP  keeps messages on the server with per-message flags (\Seen, \Recent,
 *         \Answered…) across named folders. "New mail" means UNSEEN messages,
 *         and you ask with `STATUS` — which reports MESSAGES / UNSEEN / RECENT
 *         *without* opening the mailbox, so it doesn't clear the \Recent flags
 *         the way `SELECT` would.
 *
 * This core speaks both line protocols correctly and normalises the answer into
 * one MailboxStatus, while preserving what each protocol genuinely can and can't
 * tell you. It also carries the two framing tricks that define these protocols —
 * POP3's dot-stuffed multi-line responses and IMAP's byte-counted {literal}s —
 * because getting those right is the difference between a parser that works and
 * one that works until a message body happens to contain a `.` or a `)`.
 *
 * The engine never opens a socket itself. It is driven through a tiny
 * `Connection` abstraction — `writeLine`, `writeRaw`, `readLine`, `readExact`,
 * `close` — so the exact same client code runs against an in-memory simulated
 * server (the browser demo, and most tests) and against a real TCP/TLS socket
 * (`mailcheck-node.js`). Nothing here knows which.
 *
 * SECURITY: usernames and passwords are line-protocol data. An unescaped CR/LF
 * in a credential would inject a second command onto the wire, so every value
 * that reaches the socket is validated (POP3) or quoted (IMAP). Passwords are
 * never logged. And plaintext POP3/IMAP hand your password to anyone on the
 * path — real use means TLS (POP3S:995 / IMAPS:993), which is why the Node
 * binding speaks `tls` and the CLI defaults to it.
 */
'use strict';

const CRLF = '\r\n';

/* ------------------------------------------------------------------ *
 * Errors — a protocol botch vs. a flat-out auth rejection are different
 * things to a caller (one is "the server is weird", the other is "your
 * password is wrong"), so they get distinct classes.
 * ------------------------------------------------------------------ */
class ProtocolError extends Error {
  constructor(msg) { super(msg); this.name = 'ProtocolError'; }
}
class AuthError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthError'; }
}

/* ------------------------------------------------------------------ *
 * Credential hygiene — the single most important safety rule here.
 *
 * POP3 and IMAP are newline-delimited command protocols. If a username or
 * password is allowed to carry a raw CR, LF or NUL, an attacker (or a
 * copy-paste accident) can smuggle a second command onto the connection —
 * classic command injection. POP3 has no quoting at all, so the only safe
 * answer is to refuse such a value outright.
 * ------------------------------------------------------------------ */
function assertNoControl(value, what) {
  if (typeof value !== 'string') {
    throw new ProtocolError(`${what} must be a string`);
  }
  if (/[\r\n\0]/.test(value)) {
    throw new ProtocolError(
      `${what} must not contain CR, LF or NUL (line-protocol injection risk)`);
  }
  return value;
}

/*
 * IMAP *does* have a quoting rule: a "quoted string" wraps the value in double
 * quotes and backslash-escapes any `"` or `\`. CR/LF still can't appear in a
 * quoted string (they'd need a {literal}), so we reject those. This is how a
 * password containing spaces or quotes is sent safely.
 */
function imapQuote(value, what = 'argument') {
  assertNoControl(value, what);
  return '"' + value.replace(/[\\"]/g, (m) => '\\' + m) + '"';
}

/* ------------------------------------------------------------------ *
 * POP3 response parsing
 *
 * Every POP3 response opens with a status indicator: "+OK ..." for success,
 * "-ERR ..." for failure. That's the entire status vocabulary — there is no
 * third option — so anything else is a malformed server.
 * ------------------------------------------------------------------ */
function parsePop3Status(line) {
  if (typeof line !== 'string') {
    throw new ProtocolError('POP3: connection closed before a status line');
  }
  if (line.startsWith('+OK')) {
    return { ok: true, message: line.slice(3).trim(), raw: line };
  }
  if (line.startsWith('-ERR')) {
    return { ok: false, message: line.slice(4).trim(), raw: line };
  }
  throw new ProtocolError(`POP3: malformed status line: ${JSON.stringify(line)}`);
}

/* `STAT` replies "+OK <count> <sizeInOctets>". Parse the count and size. */
function parsePop3Stat(message) {
  const m = /^(\d+)\s+(\d+)\b/.exec(String(message).trim());
  if (!m) {
    throw new ProtocolError(`POP3: cannot parse STAT reply: ${JSON.stringify(message)}`);
  }
  return { count: Number(m[1]), size: Number(m[2]) };
}

/*
 * Dot-stuffing — POP3's multi-line framing. A multi-line response is terminated
 * by a line containing a single ".". To keep a message line that genuinely
 * starts with "." from being mistaken for that terminator, the server prefixes
 * it with an extra ".". The client must strip that extra dot back off. Miss this
 * and any message whose body has a line beginning with "." gets silently
 * corrupted (or truncated, if that line was just ".").
 */
function unstuffDot(line) {
  return line.startsWith('.') ? line.slice(1) : line;
}

/* ------------------------------------------------------------------ *
 * IMAP response parsing
 *
 * IMAP tags every command ("A1 LOGIN …") and the server's *completion* line
 * echoes the tag ("A1 OK …" / "A1 NO …" / "A1 BAD …"). Lines beginning "* " are
 * untagged status/data responses that arrive before the completion. Lines
 * beginning "+ " are continuation requests (for literals / AUTHENTICATE).
 * ------------------------------------------------------------------ */
function parseImapCompletion(line, tag) {
  const prefix = tag + ' ';
  if (!line.startsWith(prefix)) return null;
  const rest = line.slice(prefix.length);
  const m = /^(OK|NO|BAD)\b\s*(.*)$/i.exec(rest);
  if (!m) throw new ProtocolError(`IMAP: malformed completion: ${JSON.stringify(line)}`);
  return { status: m[1].toUpperCase(), text: m[2] };
}

/* Pull the "(MESSAGES 3 UNSEEN 1 RECENT 0)" item list out of a STATUS response
 * into a plain object { MESSAGES:3, UNSEEN:1, RECENT:0 }. */
function parseImapStatusItems(line) {
  const m = /\(([^)]*)\)/.exec(line);
  if (!m) return {};
  const toks = m[1].trim().split(/\s+/).filter(Boolean);
  const out = {};
  for (let i = 0; i + 1 < toks.length; i += 2) {
    out[toks[i].toUpperCase()] = Number(toks[i + 1]);
  }
  return out;
}

/* "* 12 EXISTS" → 12 (how many messages the SELECTed mailbox holds). */
function parseImapExists(line) {
  const m = /^\*\s+(\d+)\s+EXISTS\b/i.exec(line);
  return m ? Number(m[1]) : null;
}

/* The flag set from a FETCH line's "FLAGS (\Seen \Answered)". */
function parseImapFlags(line) {
  const m = /FLAGS\s*\(([^)]*)\)/i.exec(line);
  if (!m) return [];
  return m[1].trim().split(/\s+/).filter(Boolean);
}

/*
 * A minimal IMAP argument tokenizer for the *server* side of the simulation:
 * splits a command's argument tail into quoted strings and bare atoms, undoing
 * the backslash escaping. (The client always quotes, so this is all the mock
 * ever needs to read back a LOGIN / STATUS / SELECT argument list.)
 */
function parseImapArgs(rest) {
  const args = [];
  let i = 0;
  const s = String(rest);
  while (i < s.length) {
    while (i < s.length && s[i] === ' ') i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      i++;
      let out = '';
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; }
        else { out += s[i]; i++; }
      }
      i++; // closing quote
      args.push(out);
    } else if (s[i] === '(') {
      // keep a parenthesised group as one raw token, e.g. "(MESSAGES UNSEEN)"
      let depth = 0, out = '';
      while (i < s.length) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { depth--; out += s[i]; i++; if (depth === 0) break; continue; }
        out += s[i]; i++;
      }
      args.push(out);
    } else {
      let out = '';
      while (i < s.length && s[i] !== ' ') { out += s[i]; i++; }
      args.push(out);
    }
  }
  return args;
}

/* ------------------------------------------------------------------ *
 * The line/byte channel.
 *
 * A buffered half-duplex stream: bytes are `feed`-ed in, and readers pull either
 * the next CRLF-delimited *line* or an exact *byte count* (for IMAP literals)
 * off the front. Readers are served in order; a reader that outruns the data
 * waits until enough arrives, and resolves with `null` if the stream ends first.
 * One buffer serving both line reads and byte reads is exactly what a real IMAP
 * client needs, because a literal is announced on a line and then followed by a
 * precise number of raw bytes.
 * ------------------------------------------------------------------ */
function makeChannel() {
  let buf = '';
  let ended = false;
  const waiters = []; // { kind:'line'|'bytes', n?, resolve }

  function serve() {
    while (waiters.length) {
      const w = waiters[0];
      if (w.kind === 'line') {
        const idx = buf.indexOf(CRLF);
        if (idx >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          waiters.shift();
          w.resolve(line);
          continue;
        }
      } else { // bytes
        if (buf.length >= w.n) {
          const chunk = buf.slice(0, w.n);
          buf = buf.slice(w.n);
          waiters.shift();
          w.resolve(chunk);
          continue;
        }
      }
      if (ended) { waiters.shift(); w.resolve(null); continue; }
      break; // need more data
    }
  }

  return {
    feed(str) { buf += str; serve(); },
    end() { ended = true; serve(); },
    readLine() { return new Promise((resolve) => { waiters.push({ kind: 'line', resolve }); serve(); }); },
    readExact(n) { return new Promise((resolve) => { waiters.push({ kind: 'bytes', n, resolve }); serve(); }); },
  };
}

/* ------------------------------------------------------------------ *
 * An in-memory full-duplex pipe: two channels cross-wired so a client and a
 * server loop can talk as if over a socket. This is what lets the whole engine
 * — client *and* a protocol-speaking server — run in a browser with no network.
 * ------------------------------------------------------------------ */
function makePipe() {
  const toClient = makeChannel(); // server writes, client reads
  const toServer = makeChannel(); // client writes, server reads

  const connFor = (outCh, inCh) => ({
    writeLine(line) { outCh.feed(line + CRLF); },
    writeRaw(str) { outCh.feed(str); },
    readLine() { return inCh.readLine(); },
    readExact(n) { return inCh.readExact(n); },
    close() { outCh.end(); },
  });

  return {
    client: connFor(toServer, toClient),
    server: connFor(toClient, toServer),
  };
}

/* ================================================================== *
 * POP3 CLIENT
 * ================================================================== */

async function expectLine(conn, ctx) {
  const line = await conn.readLine();
  if (line === null) throw new ProtocolError(`${ctx}: connection closed unexpectedly`);
  return line;
}

/* Send one command and read its single status line. */
async function pop3Command(conn, command) {
  conn.writeLine(command);
  return parsePop3Status(await expectLine(conn, `POP3 ${command.split(' ')[0]}`));
}

/* Read a dot-terminated multi-line body, un-stuffing as we go. */
async function pop3ReadMultiline(conn) {
  const lines = [];
  for (;;) {
    const line = await expectLine(conn, 'POP3 multiline');
    if (line === '.') break;
    lines.push(unstuffDot(line));
  }
  return lines;
}

/*
 * The core task for POP3: authenticate, then STAT. Returns a normalised
 * MailboxStatus. `unseen`/`recent` are null because POP3 cannot know them.
 */
async function pop3Check(conn, opts) {
  const { user, pass } = opts;
  assertNoControl(user, 'username');
  assertNoControl(pass, 'password');

  const greet = parsePop3Status(await expectLine(conn, 'POP3 greeting'));
  if (!greet.ok) throw new ProtocolError(`POP3 server refused the connection: ${greet.message}`);

  const userResp = await pop3Command(conn, `USER ${user}`);
  if (!userResp.ok) throw new AuthError(`POP3 USER rejected: ${userResp.message}`);
  const passResp = await pop3Command(conn, `PASS ${pass}`);
  if (!passResp.ok) throw new AuthError(`POP3 authentication failed: ${passResp.message}`);

  const stat = await pop3Command(conn, 'STAT');
  if (!stat.ok) throw new ProtocolError(`POP3 STAT failed: ${stat.message}`);
  const { count, size } = parsePop3Stat(stat.message);

  return { protocol: 'pop3', mailbox: 'INBOX', total: count, sizeOctets: size, unseen: null, recent: null };
}

/*
 * A richer POP3 inspection for the demo: count + a preview of the top messages'
 * From/Subject/Date headers, pulled with `TOP n 0` (headers only, no body) so we
 * never download whole messages just to list them. Exercises the dot-stuffed
 * multi-line path for real.
 */
async function pop3Preview(conn, opts, limit = 10) {
  const { user, pass } = opts;
  assertNoControl(user, 'username');
  assertNoControl(pass, 'password');

  const greet = parsePop3Status(await expectLine(conn, 'POP3 greeting'));
  if (!greet.ok) throw new ProtocolError(`POP3 server refused the connection: ${greet.message}`);
  let r = await pop3Command(conn, `USER ${user}`);
  if (!r.ok) throw new AuthError(`POP3 USER rejected: ${r.message}`);
  r = await pop3Command(conn, `PASS ${pass}`);
  if (!r.ok) throw new AuthError(`POP3 authentication failed: ${r.message}`);

  const stat = await pop3Command(conn, 'STAT');
  if (!stat.ok) throw new ProtocolError(`POP3 STAT failed: ${stat.message}`);
  const { count, size } = parsePop3Stat(stat.message);

  // Per-message sizes from LIST.
  const listResp = await pop3Command(conn, 'LIST');
  if (!listResp.ok) throw new ProtocolError(`POP3 LIST failed: ${listResp.message}`);
  const sizes = {};
  for (const line of await pop3ReadMultiline(conn)) {
    const m = /^(\d+)\s+(\d+)/.exec(line);
    if (m) sizes[Number(m[1])] = Number(m[2]);
  }

  const messages = [];
  const n = Math.min(count, limit);
  for (let i = 1; i <= n; i++) {
    const top = await pop3Command(conn, `TOP ${i} 0`);
    if (!top.ok) continue;
    const headerLines = await pop3ReadMultiline(conn);
    messages.push({ seq: i, size: sizes[i] ?? null, seen: null, ...parseHeaderLines(headerLines) });
  }

  try { await pop3Command(conn, 'QUIT'); } catch (_) { /* best effort */ }

  return { protocol: 'pop3', mailbox: 'INBOX', total: count, sizeOctets: size, unseen: null, recent: null, messages };
}

/* ================================================================== *
 * IMAP CLIENT
 * ================================================================== */

function makeTagger(prefix = 'A') {
  let n = 0;
  return () => prefix + (++n);
}

/* Read untagged lines until the completion line for `tag` arrives. (Used for
 * commands with no literals in their response: LOGIN, STATUS, SELECT, LOGOUT.) */
async function readImapCompletion(conn, tag) {
  const untagged = [];
  for (;;) {
    const line = await expectLine(conn, `IMAP ${tag}`);
    const done = parseImapCompletion(line, tag);
    if (done) return { ...done, untagged };
    untagged.push(line);
  }
}

async function imapGreeting(conn) {
  const greet = await expectLine(conn, 'IMAP greeting');
  if (!/^\*\s+(OK|PREAUTH)\b/i.test(greet)) {
    throw new ProtocolError(`IMAP greeting was not OK: ${greet}`);
  }
  return greet;
}

async function imapLogin(conn, tagger, user, pass) {
  const tag = tagger();
  conn.writeLine(`${tag} LOGIN ${imapQuote(user, 'username')} ${imapQuote(pass, 'password')}`);
  const r = await readImapCompletion(conn, tag);
  if (r.status !== 'OK') throw new AuthError(`IMAP LOGIN failed: ${r.text}`);
  return r;
}

async function imapLogout(conn, tagger) {
  const tag = tagger();
  try {
    conn.writeLine(`${tag} LOGOUT`);
    await readImapCompletion(conn, tag);
  } catch (_) { /* best effort */ }
}

/*
 * The core task for IMAP: authenticate, then STATUS (which does NOT open the
 * mailbox, so it leaves \Recent flags untouched). Returns MESSAGES / UNSEEN /
 * RECENT, which is exactly the "do I have new mail?" answer POP3 can't give.
 */
async function imapCheck(conn, opts) {
  const { user, pass, mailbox = 'INBOX' } = opts;
  await imapGreeting(conn);
  const tagger = makeTagger();
  await imapLogin(conn, tagger, user, pass);

  const tag = tagger();
  conn.writeLine(`${tag} STATUS ${imapQuote(mailbox, 'mailbox')} (MESSAGES UNSEEN RECENT)`);
  const r = await readImapCompletion(conn, tag);
  if (r.status !== 'OK') throw new ProtocolError(`IMAP STATUS failed: ${r.text}`);
  const statusLine = r.untagged.find((l) => /^\*\s+STATUS\b/i.test(l));
  const items = statusLine ? parseImapStatusItems(statusLine) : {};

  await imapLogout(conn, tagger);

  return {
    protocol: 'imap',
    mailbox,
    total: items.MESSAGES ?? 0,
    unseen: items.UNSEEN ?? null,
    recent: items.RECENT ?? null,
    sizeOctets: null,
  };
}

/*
 * Read a FETCH response, resolving IMAP {literal}s the honest way. A FETCH line
 * that ends with "{N}" promises exactly N following bytes (which may contain
 * CRLFs, parens, anything), after which the response continues. We read the N
 * bytes with `readExact`, then read the line that closes the FETCH item. This is
 * the single most characteristic piece of IMAP parsing: you cannot treat the
 * wire as "lines" once a literal is in play — you must honour the byte count.
 */
async function readImapFetch(conn, tag) {
  const messages = [];
  for (;;) {
    const line = await expectLine(conn, `IMAP ${tag} FETCH`);
    const done = parseImapCompletion(line, tag);
    if (done) {
      if (done.status !== 'OK') throw new ProtocolError(`IMAP FETCH failed: ${done.text}`);
      return messages;
    }
    const m = /^\*\s+(\d+)\s+FETCH\b/i.exec(line);
    if (!m) continue; // EXISTS / RECENT / FLAGS / OK [...] — not our data
    const seq = Number(m[1]);
    const flags = parseImapFlags(line);
    const lit = /\{(\d+)\}\s*$/.exec(line);
    let headers = {};
    if (lit) {
      const body = await conn.readExact(Number(lit[1]));
      if (body === null) throw new ProtocolError('IMAP: connection closed inside a literal');
      await expectLine(conn, 'IMAP FETCH literal tail'); // the trailing ")" line
      headers = parseHeaderLines(String(body).split(CRLF));
    }
    messages.push({ seq, seen: flags.includes('\\Seen'), flags, ...headers });
  }
}

/* Richer IMAP inspection for the demo: STATUS counts + a per-message preview
 * (From/Subject/Date + \Seen) fetched with BODY.PEEK so reading the list does
 * not mark anything as seen. */
async function imapPreview(conn, opts, limit = 10) {
  const { user, pass, mailbox = 'INBOX' } = opts;
  await imapGreeting(conn);
  const tagger = makeTagger();
  await imapLogin(conn, tagger, user, pass);

  // STATUS first, for the headline counts.
  let tag = tagger();
  conn.writeLine(`${tag} STATUS ${imapQuote(mailbox, 'mailbox')} (MESSAGES UNSEEN RECENT)`);
  let r = await readImapCompletion(conn, tag);
  if (r.status !== 'OK') throw new ProtocolError(`IMAP STATUS failed: ${r.text}`);
  const items = parseImapStatusItems(r.untagged.find((l) => /^\*\s+STATUS\b/i.test(l)) || '');

  // SELECT to learn EXISTS, then FETCH the preview headers.
  tag = tagger();
  conn.writeLine(`${tag} SELECT ${imapQuote(mailbox, 'mailbox')}`);
  r = await readImapCompletion(conn, tag);
  if (r.status !== 'OK') throw new ProtocolError(`IMAP SELECT failed: ${r.text}`);
  const exists = r.untagged.map(parseImapExists).find((x) => x !== null) || 0;

  let messages = [];
  if (exists > 0) {
    const hi = Math.min(exists, limit);
    tag = tagger();
    conn.writeLine(`${tag} FETCH 1:${hi} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`);
    messages = await readImapFetch(conn, tag);
  }

  await imapLogout(conn, tagger);

  return {
    protocol: 'imap',
    mailbox,
    total: items.MESSAGES ?? exists,
    unseen: items.UNSEEN ?? null,
    recent: items.RECENT ?? null,
    sizeOctets: null,
    messages,
  };
}

/* ------------------------------------------------------------------ *
 * Shared header parsing — turn a block of "Name: value" lines into
 * { from, subject, date }. Unfolds continuation lines (leading whitespace).
 * ------------------------------------------------------------------ */
function parseHeaderLines(lines) {
  const headers = {};
  let lastKey = null;
  for (const raw of lines) {
    if (raw === '') { lastKey = null; continue; }
    if (/^\s/.test(raw) && lastKey) { headers[lastKey] += ' ' + raw.trim(); continue; }
    const m = /^([!-9;-~]+):\s?(.*)$/.exec(raw); // field name is printable, no colon
    if (m) { lastKey = m[1].toLowerCase(); headers[lastKey] = m[2]; }
  }
  return {
    from: headers.from || '',
    subject: headers.subject || '',
    date: headers.date || '',
  };
}

/* Unified entry point: "check" (counts only) for either protocol. */
async function checkMailbox(protocol, conn, opts) {
  if (protocol === 'pop3') return pop3Check(conn, opts);
  if (protocol === 'imap') return imapCheck(conn, opts);
  throw new ProtocolError(`unknown protocol: ${protocol}`);
}

/* ================================================================== *
 * SIMULATED SERVERS
 *
 * Correct, if minimal, POP3 and IMAP servers that speak the real wire protocol
 * against an in-memory mailbox. They are the *same* server loops the Node file
 * runs over a real TCP socket — only the Connection differs — so "it works in
 * the browser demo" and "it works over a real socket" are the same code path.
 * ================================================================== */

function headerBlock(msg) {
  return `From: ${msg.from}${CRLF}Subject: ${msg.subject}${CRLF}Date: ${msg.date}${CRLF}${CRLF}`;
}

async function servePop3(conn, mailbox) {
  const msgs = mailbox.messages || [];
  conn.writeLine('+OK POP3 mock server ready');
  let user = null;
  let authed = false;
  for (;;) {
    const line = await conn.readLine();
    if (line === null) return;
    const sp = line.indexOf(' ');
    const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
    const arg = sp < 0 ? '' : line.slice(sp + 1);

    if (cmd === 'CAPA') {
      conn.writeLine('+OK Capability list follows');
      conn.writeLine('USER'); conn.writeLine('TOP'); conn.writeLine('UIDL'); conn.writeLine('.');
      continue;
    }
    if (cmd === 'USER') { user = arg; conn.writeLine('+OK'); continue; }
    if (cmd === 'PASS') {
      if (user === mailbox.user && arg === mailbox.pass) { authed = true; conn.writeLine('+OK mailbox ready'); }
      else conn.writeLine('-ERR [AUTH] authentication failed');
      continue;
    }
    if (cmd === 'NOOP') { conn.writeLine('+OK'); continue; }
    if (cmd === 'QUIT') { conn.writeLine('+OK bye'); conn.close(); return; }
    if (!authed) { conn.writeLine('-ERR not authenticated'); continue; }

    if (cmd === 'STAT') {
      const size = msgs.reduce((a, m) => a + (m.size || 0), 0);
      conn.writeLine(`+OK ${msgs.length} ${size}`);
    } else if (cmd === 'LIST') {
      conn.writeLine(`+OK ${msgs.length} messages`);
      msgs.forEach((m, i) => conn.writeLine(`${i + 1} ${m.size || 0}`));
      conn.writeLine('.');
    } else if (cmd === 'UIDL') {
      conn.writeLine('+OK');
      msgs.forEach((m, i) => conn.writeLine(`${i + 1} ${m.uid || 'uid' + (i + 1)}`));
      conn.writeLine('.');
    } else if (cmd === 'TOP') {
      const n = parseInt(arg, 10);
      const m = msgs[n - 1];
      if (!m) { conn.writeLine('-ERR no such message'); continue; }
      conn.writeLine('+OK top of message follows');
      for (const l of headerBlock(m).split(CRLF)) {
        conn.writeLine(l.startsWith('.') ? '.' + l : l); // dot-stuff
      }
      conn.writeLine('.');
    } else {
      conn.writeLine('-ERR unknown command');
    }
  }
}

async function serveImap(conn, mailbox) {
  const msgs = mailbox.messages || [];
  conn.writeLine('* OK [CAPABILITY IMAP4rev1] mock server ready');
  let authed = false;
  for (;;) {
    const line = await conn.readLine();
    if (line === null) return;
    const m = /^(\S+)\s+(\S+)(?:\s+([\s\S]*))?$/.exec(line);
    if (!m) { conn.writeLine('* BAD could not parse command'); continue; }
    const tag = m[1];
    const cmd = m[2].toUpperCase();
    const rest = m[3] || '';

    if (cmd === 'CAPABILITY') {
      conn.writeLine('* CAPABILITY IMAP4rev1');
      conn.writeLine(`${tag} OK CAPABILITY completed`);
      continue;
    }
    if (cmd === 'LOGIN') {
      const args = parseImapArgs(rest);
      if (args.length >= 2 && args[0] === mailbox.user && args[1] === mailbox.pass) {
        authed = true; conn.writeLine(`${tag} OK LOGIN completed`);
      } else {
        conn.writeLine(`${tag} NO [AUTHENTICATIONFAILED] invalid credentials`);
      }
      continue;
    }
    if (cmd === 'LOGOUT') {
      conn.writeLine('* BYE logging out');
      conn.writeLine(`${tag} OK LOGOUT completed`);
      conn.close();
      return;
    }
    if (cmd === 'NOOP') { conn.writeLine(`${tag} OK NOOP completed`); continue; }
    if (!authed) { conn.writeLine(`${tag} NO not authenticated`); continue; }

    if (cmd === 'STATUS') {
      const args = parseImapArgs(rest);
      const name = args[0] || 'INBOX';
      const want = (args.find((a) => a.startsWith('(')) || '(MESSAGES UNSEEN RECENT)')
        .replace(/[()]/g, '').toUpperCase().split(/\s+/).filter(Boolean);
      const map = {
        MESSAGES: msgs.length,
        UNSEEN: msgs.filter((x) => !x.seen).length,
        RECENT: msgs.filter((x) => x.recent).length,
        UIDNEXT: msgs.length + 1,
        UIDVALIDITY: 1,
      };
      const parts = want.filter((k) => k in map).map((k) => `${k} ${map[k]}`);
      conn.writeLine(`* STATUS "${name}" (${parts.join(' ')})`);
      conn.writeLine(`${tag} OK STATUS completed`);
    } else if (cmd === 'SELECT') {
      const recent = msgs.filter((x) => x.recent).length;
      const unseenIdx = msgs.findIndex((x) => !x.seen) + 1;
      conn.writeLine(`* ${msgs.length} EXISTS`);
      conn.writeLine(`* ${recent} RECENT`);
      if (unseenIdx > 0) conn.writeLine(`* OK [UNSEEN ${unseenIdx}] first unseen`);
      conn.writeLine('* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)');
      conn.writeLine(`${tag} OK [READ-WRITE] SELECT completed`);
    } else if (cmd === 'FETCH') {
      const rng = /^(\d+):(\d+|\*)/.exec(rest) || /^(\d+)/.exec(rest);
      const lo = rng ? Number(rng[1]) : 1;
      const hiTok = rng && rng[2];
      const hi = !hiTok || hiTok === '*' ? msgs.length : Number(hiTok);
      for (let i = lo; i <= Math.min(hi, msgs.length); i++) {
        const msg = msgs[i - 1];
        const flags = [];
        if (msg.seen) flags.push('\\Seen');
        if (msg.recent) flags.push('\\Recent');
        const hdr = headerBlock(msg);
        conn.writeLine(`* ${i} FETCH (FLAGS (${flags.join(' ')}) BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${hdr.length}}`);
        conn.writeRaw(hdr);   // exactly hdr.length bytes — the literal
        conn.writeLine(')');
      }
      conn.writeLine(`${tag} OK FETCH completed`);
    } else {
      conn.writeLine(`${tag} BAD unknown command`);
    }
  }
}

/*
 * Wire a client up to one of the simulated servers over an in-memory pipe and
 * start the server loop. Returns the client `Connection`. Used by the browser
 * demo and the in-memory tests.
 */
function simulate(protocol, mailbox) {
  const { client, server } = makePipe();
  const serve = protocol === 'pop3' ? servePop3 : serveImap;
  // Run the server loop in the background; swallow its errors (a client that
  // closes mid-command is normal) so they don't become unhandled rejections.
  Promise.resolve().then(() => serve(server, mailbox)).catch(() => {});
  return client;
}

/* ------------------------------------------------------------------ */
const api = {
  CRLF,
  ProtocolError, AuthError,
  assertNoControl, imapQuote,
  parsePop3Status, parsePop3Stat, unstuffDot,
  parseImapCompletion, parseImapStatusItems, parseImapExists, parseImapFlags, parseImapArgs,
  parseHeaderLines,
  makeChannel, makePipe,
  pop3Check, pop3Preview,
  imapCheck, imapPreview,
  checkMailbox,
  servePop3, serveImap, simulate, headerBlock,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;          // Node / tests
}
if (typeof window !== 'undefined') {
  window.MailCheck = api;        // browser demo
}
