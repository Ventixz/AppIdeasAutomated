/*
 * tests.js — dependency-free checks for the mail checker, run under Node:
 *   node projects/phase2-networking/mail-checker/tests.js
 *
 * Five layers:
 *   1. Pure parsers — POP3 status/STAT/dot-stuffing, IMAP completion/STATUS/
 *      EXISTS/FLAGS/arg tokenizing, RFC822 header parsing.
 *   2. Credential safety — CR/LF/NUL injection is refused; IMAP quoting escapes.
 *   3. In-memory end-to-end — the real client against the real (simulated)
 *      POP3 and IMAP server loops over an in-memory pipe: correct counts, the
 *      POP3-can't-know-unseen contract, IMAP unseen/recent, auth failures, and
 *      the dot-stuffed / {literal} multi-line preview paths.
 *   4. The channel — line reads and exact-byte reads interleave correctly, which
 *      is what makes IMAP literals parseable.
 *   5. Real TCP sockets — start loopback mock servers and check them over actual
 *      `net` connections, proving the same code path works on a real socket.
 */
'use strict';

const assert = require('assert');
const core = require('./mailcheck-core.js');
const { checkMail, startMockServer, connect } = require('./mailcheck-node.js');

const {
  parsePop3Status, parsePop3Stat, unstuffDot,
  parseImapCompletion, parseImapStatusItems, parseImapExists, parseImapFlags, parseImapArgs,
  parseHeaderLines, imapQuote, assertNoControl,
  pop3Check, pop3Preview, imapCheck, imapPreview,
  simulate, makeChannel, ProtocolError, AuthError,
} = core;

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push([name, e]); }
}
const asyncChecks = [];
function acheck(name, fn) { asyncChecks.push([name, fn]); }

/* A couple of mailboxes used throughout. */
const POP_BOX = {
  user: 'alice', pass: 'hunter2',
  messages: [
    { uid: 'a1', size: 480, from: 'bank@example.com', subject: 'Your statement', date: 'Mon, 20 Oct 2026 09:00:00 +0000' },
    { uid: 'a2', size: 1200, from: 'news@example.org', subject: '. leading dot test', date: 'Tue, 21 Oct 2026 08:00:00 +0000' },
    { uid: 'a3', size: 300, from: 'ci@example.net', subject: 'Build passed', date: 'Tue, 21 Oct 2026 10:00:00 +0000' },
  ],
};
const IMAP_BOX = {
  user: 'alice', pass: 'p@ss "word"', // spaces and quotes: exercises IMAP quoting
  messages: [
    { from: 'bank@example.com', subject: 'Your statement', date: 'Mon, 20 Oct 2026 09:00:00 +0000', seen: true, recent: false },
    { from: 'news@example.org', subject: 'Weekly digest', date: 'Tue, 21 Oct 2026 08:00:00 +0000', seen: false, recent: true },
    { from: 'ci@example.net', subject: 'Build passed', date: 'Tue, 21 Oct 2026 10:00:00 +0000', seen: false, recent: true },
  ],
};

/* ---------------------------------------------------------------- *
 * 1. Pure parsers
 * ---------------------------------------------------------------- */
check('POP3 +OK parses', () => {
  const r = parsePop3Status('+OK 2 320');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.message, '2 320');
});
check('POP3 -ERR parses', () => {
  const r = parsePop3Status('-ERR nope');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.message, 'nope');
});
check('POP3 malformed status throws', () => {
  assert.throws(() => parsePop3Status('garbage'), ProtocolError);
});
check('POP3 STAT count+size', () => {
  assert.deepStrictEqual(parsePop3Stat('3 1980'), { count: 3, size: 1980 });
});
check('POP3 STAT with trailing junk still parses count+size', () => {
  assert.deepStrictEqual(parsePop3Stat('3 1980 extra'), { count: 3, size: 1980 });
});
check('POP3 STAT unparseable throws', () => {
  assert.throws(() => parsePop3Stat('nope'), ProtocolError);
});
check('dot-unstuffing removes exactly one leading dot', () => {
  assert.strictEqual(unstuffDot('..hidden'), '.hidden');
  assert.strictEqual(unstuffDot('.X'), 'X');
  assert.strictEqual(unstuffDot('plain'), 'plain');
});
check('IMAP completion matches its tag only', () => {
  assert.strictEqual(parseImapCompletion('* 3 EXISTS', 'A2'), null);
  assert.deepStrictEqual(parseImapCompletion('A2 OK done', 'A2'), { status: 'OK', text: 'done' });
  assert.strictEqual(parseImapCompletion('A3 OK done', 'A2'), null);
});
check('IMAP NO/BAD completions parse', () => {
  assert.strictEqual(parseImapCompletion('A1 NO bad login', 'A1').status, 'NO');
  assert.strictEqual(parseImapCompletion('A1 BAD syntax', 'A1').status, 'BAD');
});
check('IMAP STATUS items parse to a map', () => {
  assert.deepStrictEqual(
    parseImapStatusItems('* STATUS "INBOX" (MESSAGES 3 UNSEEN 1 RECENT 2)'),
    { MESSAGES: 3, UNSEEN: 1, RECENT: 2 });
});
check('IMAP EXISTS parses', () => {
  assert.strictEqual(parseImapExists('* 12 EXISTS'), 12);
  assert.strictEqual(parseImapExists('* 0 RECENT'), null);
});
check('IMAP FLAGS parse', () => {
  assert.deepStrictEqual(parseImapFlags('* 1 FETCH (FLAGS (\\Seen \\Answered) UID 7)'),
    ['\\Seen', '\\Answered']);
  assert.deepStrictEqual(parseImapFlags('* 1 FETCH (FLAGS ())'), []);
});
check('IMAP arg tokenizer handles quotes, escapes and paren groups', () => {
  assert.deepStrictEqual(parseImapArgs('"INBOX" (MESSAGES UNSEEN)'),
    ['INBOX', '(MESSAGES UNSEEN)']);
  assert.deepStrictEqual(parseImapArgs('"p@ss \\"word\\"" "user"'),
    ['p@ss "word"', 'user']);
});
check('RFC822 header parsing (with folding)', () => {
  const h = parseHeaderLines(['From: a@b.com', 'Subject: hello', ' world', 'Date: today', '']);
  assert.strictEqual(h.from, 'a@b.com');
  assert.strictEqual(h.subject, 'hello world'); // folded continuation unfolded
  assert.strictEqual(h.date, 'today');
});

/* ---------------------------------------------------------------- *
 * 2. Credential safety
 * ---------------------------------------------------------------- */
check('CRLF in a credential is refused (POP3 injection guard)', () => {
  assert.throws(() => assertNoControl('alice\r\nDELE 1', 'username'), ProtocolError);
  assert.throws(() => assertNoControl('pw\nQUIT', 'password'), ProtocolError);
  assert.throws(() => assertNoControl('pw\0', 'password'), ProtocolError);
});
check('clean credential passes through', () => {
  assert.strictEqual(assertNoControl('alice', 'username'), 'alice');
});
check('IMAP quoting wraps and escapes', () => {
  assert.strictEqual(imapQuote('simple'), '"simple"');
  assert.strictEqual(imapQuote('p@ss "word"'), '"p@ss \\"word\\""');
  assert.strictEqual(imapQuote('back\\slash'), '"back\\\\slash"');
});
check('IMAP quoting still refuses CR/LF', () => {
  assert.throws(() => imapQuote('a\r\nb'), ProtocolError);
});

/* ---------------------------------------------------------------- *
 * 3. In-memory end-to-end (client vs. simulated servers)
 * ---------------------------------------------------------------- */
acheck('POP3 check: correct count & size, unseen is null (unknowable)', async () => {
  const s = await pop3Check(simulate('pop3', POP_BOX), { user: 'alice', pass: 'hunter2' });
  assert.strictEqual(s.protocol, 'pop3');
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.sizeOctets, 480 + 1200 + 300);
  assert.strictEqual(s.unseen, null, 'POP3 must report unseen as null, not 0');
  assert.strictEqual(s.recent, null);
});
acheck('POP3 wrong password → AuthError', async () => {
  await assert.rejects(
    pop3Check(simulate('pop3', POP_BOX), { user: 'alice', pass: 'wrong' }),
    AuthError);
});
acheck('POP3 preview: headers via TOP, dot-stuffed line survives intact', async () => {
  const s = await pop3Preview(simulate('pop3', POP_BOX), { user: 'alice', pass: 'hunter2' });
  assert.strictEqual(s.messages.length, 3);
  assert.strictEqual(s.messages[0].subject, 'Your statement');
  // message 2's subject begins with ".", which must survive dot-stuffing
  assert.strictEqual(s.messages[1].subject, '. leading dot test');
  assert.strictEqual(s.messages[0].size, 480);
});
acheck('IMAP check: STATUS counts, with proper quoting of a tricky password', async () => {
  const s = await imapCheck(simulate('imap', IMAP_BOX), { user: 'alice', pass: 'p@ss "word"' });
  assert.strictEqual(s.protocol, 'imap');
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.unseen, 2);  // two messages not \Seen
  assert.strictEqual(s.recent, 2);
});
acheck('IMAP wrong password → AuthError', async () => {
  await assert.rejects(
    imapCheck(simulate('imap', IMAP_BOX), { user: 'alice', pass: 'nope' }),
    AuthError);
});
acheck('IMAP preview: FETCH {literal} bodies parse into per-message headers', async () => {
  const s = await imapPreview(simulate('imap', IMAP_BOX), { user: 'alice', pass: 'p@ss "word"' });
  assert.strictEqual(s.messages.length, 3);
  assert.strictEqual(s.messages[0].subject, 'Your statement');
  assert.strictEqual(s.messages[0].seen, true);
  assert.strictEqual(s.messages[1].seen, false);
  assert.strictEqual(s.messages[1].from, 'news@example.org');
});
acheck('IMAP empty mailbox: zero messages, no FETCH crash', async () => {
  const s = await imapPreview(simulate('imap', { user: 'u', pass: 'p', messages: [] }), { user: 'u', pass: 'p' });
  assert.strictEqual(s.total, 0);
  assert.deepStrictEqual(s.messages, []);
});

/* ---------------------------------------------------------------- *
 * 4. The channel — lines and exact-byte reads interleave
 * ---------------------------------------------------------------- */
acheck('channel: a literal announced on a line, then exact bytes, then a line', async () => {
  const ch = makeChannel();
  // feed in pieces to prove buffering across chunk boundaries works
  ch.feed('* 1 FETCH (BODY[] {5}\r\nHel');
  const line = await ch.readLine();
  assert.strictEqual(line, '* 1 FETCH (BODY[] {5}');
  const p = ch.readExact(5);
  ch.feed('lo)\r\n');
  const body = await p;
  assert.strictEqual(body, 'Hello');
  assert.strictEqual(await ch.readLine(), ')');
});
acheck('channel: reader waiting past end-of-stream resolves null', async () => {
  const ch = makeChannel();
  const p = ch.readLine();
  ch.end();
  assert.strictEqual(await p, null);
});

/* ---------------------------------------------------------------- *
 * 5. Real TCP sockets (loopback mock servers)
 * ---------------------------------------------------------------- */
acheck('real TCP POP3: connect over a socket and get the right count', async () => {
  const srv = await startMockServer('pop3', POP_BOX);
  try {
    const s = await checkMail('pop3', { host: '127.0.0.1', port: srv.port, tls: false, user: 'alice', pass: 'hunter2' });
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.sizeOctets, 1980);
    assert.strictEqual(s.unseen, null);
  } finally { await srv.close(); }
});
acheck('real TCP IMAP: STATUS counts come back over a socket', async () => {
  const srv = await startMockServer('imap', IMAP_BOX);
  try {
    const s = await checkMail('imap', { host: '127.0.0.1', port: srv.port, tls: false, user: 'alice', pass: 'p@ss "word"' });
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.unseen, 2);
    assert.strictEqual(s.recent, 2);
  } finally { await srv.close(); }
});
acheck('real TCP IMAP preview: {literal} FETCH over a real socket', async () => {
  const srv = await startMockServer('imap', IMAP_BOX);
  try {
    const s = await checkMail('imap', { host: '127.0.0.1', port: srv.port, tls: false, user: 'alice', pass: 'p@ss "word"', preview: true });
    assert.strictEqual(s.messages.length, 3);
    assert.strictEqual(s.messages[2].subject, 'Build passed');
  } finally { await srv.close(); }
});
acheck('real TCP POP3 wrong password → AuthError over a socket', async () => {
  const srv = await startMockServer('pop3', POP_BOX);
  try {
    await assert.rejects(
      checkMail('pop3', { host: '127.0.0.1', port: srv.port, tls: false, user: 'alice', pass: 'bad' }),
      AuthError);
  } finally { await srv.close(); }
});

/* ---------------------------------------------------------------- *
 * Runner
 * ---------------------------------------------------------------- */
(async () => {
  for (const [name, fn] of asyncChecks) {
    try { await fn(); passed++; }
    catch (e) { failures.push([name, e]); }
  }
  const total = passed + failures.length;
  if (failures.length === 0) {
    console.log(`\n  ✅ all ${total} checks passed\n`);
  } else {
    console.log(`\n  ❌ ${failures.length} of ${total} checks failed:\n`);
    for (const [name, e] of failures) {
      console.log(`   • ${name}\n     ${e && e.message ? e.message : e}`);
    }
    process.exit(1);
  }
})();
