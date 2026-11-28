'use strict';
/*
 * tests.js — headless checks for the Remote SQL Tool.
 *   node tests.js
 *
 * Grouped so a failure tells you which layer broke:
 *   1. Crypto primitives pinned to published vectors (SHA-256, MD5, HMAC, PBKDF2).
 *   2. Base64 round-trips.
 *   3. Wire framing (the length-counts-itself + no-type-byte-on-startup traps).
 *   4. SCRAM-SHA-256 pinned to the RFC 7677 worked example, both directions.
 *   5. MD5 auth response shape.
 *   6. Type decoding, with NULL vs empty-string kept distinct.
 *   7. Full handshakes against the in-memory server (trust/cleartext/md5/scram),
 *      plus wrong-password rejection and a tampered-server-signature rejection.
 *   8. The mini-SQL the mock backend answers with.
 */

const P = require('./pg-core.js');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; fails.push(name); console.error('  ✗ ' + name); }
}
function eq(name, a, b) { ok(name + ` (got ${JSON.stringify(a)})`, a === b); }
function throws(name, fn, re) {
  try { fn(); failed++; fails.push(name); console.error('  ✗ ' + name + ' (did not throw)'); }
  catch (e) { if (re && !re.test(e.message)) { failed++; fails.push(name); console.error('  ✗ ' + name + ' (wrong msg: ' + e.message + ')'); } else passed++; }
}
const section = (s) => console.log('\n' + s);

const { toHex, enc } = P;

/* ---- 1. crypto vectors ---------------------------------------------------- */
section('Crypto primitives (pinned to published vectors)');

eq('SHA-256("") vector', toHex(P.sha256(enc(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
eq('SHA-256("abc") vector', toHex(P.sha256(enc('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
eq('SHA-256(448-bit msg) vector',
  toHex(P.sha256(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
  '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
// long input exercises multi-block + padding
eq('SHA-256(1,000,000 "a") vector',
  toHex(P.sha256(enc('a'.repeat(1000000)))),
  'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');

eq('MD5("") vector', toHex(P.md5(enc(''))), 'd41d8cd98f00b204e9800998ecf8427e');
eq('MD5("abc") vector', toHex(P.md5(enc('abc'))), '900150983cd24fb0d6963f7d28e17f72');
eq('MD5("message digest") vector', toHex(P.md5(enc('message digest'))), 'f96b697d7cb7938d525a2f31aaf161d0');
eq('MD5(alphanumeric) vector',
  toHex(P.md5(enc('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'))),
  'd174ab98d277d9f5a5611c2c9f419d9f');

// HMAC-SHA256, RFC 4231 test case 2 (key "Jefe", data "what do ya want for nothing?")
eq('HMAC-SHA256 RFC4231 case 2',
  toHex(P.hmacSha256(enc('Jefe'), enc('what do ya want for nothing?'))),
  '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');

// PBKDF2-HMAC-SHA256, RFC 7914 §11 vector ("passwd","salt",1,64)
eq('PBKDF2-HMAC-SHA256 ("passwd",1 iter)',
  toHex(P.pbkdf2Sha256(enc('passwd'), enc('salt'), 1, 64)),
  '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783');

/* ---- 2. base64 ------------------------------------------------------------ */
section('Base64');
eq('b64encode("Man")', P.b64encode(enc('Man')), 'TWFu');
eq('b64encode("Ma")', P.b64encode(enc('Ma')), 'TWE=');
eq('b64encode("M")', P.b64encode(enc('M')), 'TQ==');
eq('b64 round-trip random-ish', toHex(P.b64decode(P.b64encode(Uint8Array.from([0, 1, 2, 250, 255, 128, 64])))), '000102faff8040');
eq('b64decode("W22ZaJ0SNY7soEsUEjb6gQ==") len', P.b64decode('W22ZaJ0SNY7soEsUEjb6gQ==').length, 16);

/* ---- 3. framing ----------------------------------------------------------- */
section('Wire framing');

// A typed message: length Int32 counts itself (4) + payload, excludes type byte.
(() => {
  const q = P.queryMessage('SELECT 1');
  eq('Query type byte is Q', String.fromCharCode(q[0]), 'Q');
  const len = (q[1] << 24) | (q[2] << 16) | (q[3] << 8) | q[4];
  // payload = "SELECT 1\0" = 9 bytes; length field = 9 + 4 = 13; total wire = 1 + 13 = 14
  eq('Query length counts itself not the type', len, 13);
  eq('Query total wire length', q.length, 14);
})();

// StartupMessage has NO type byte; first byte is the high byte of its length.
(() => {
  const su = P.startupMessage({ user: 'alice', database: 'appdb' });
  ok('Startup first byte is not a printable type (length hi byte = 0)', su[0] === 0);
  const r = new P.Reader(su.subarray(4)); // skip the length
  eq('Startup protocol version 3.0', r.i32(), P.PROTOCOL_VERSION);
})();

// Reader reassembles messages split across arbitrary chunks.
(() => {
  const a = P.queryMessage('SELECT 1');
  const b = P.queryMessage('SELECT 2');
  const stream = P.concatBytes([a, b]);
  const reader = new P.MessageReader();
  // feed it one byte at a time — the cruelest chunking
  const got = [];
  for (let i = 0; i < stream.length; i++) { reader.push(stream.subarray(i, i + 1)); let m; while ((m = reader.next())) got.push(m); }
  eq('byte-by-byte: two messages recovered', got.length, 2);
  eq('byte-by-byte: first is Q', got[0].type, 'Q');
  eq('byte-by-byte: first body is "SELECT 1\\0"', P.dec(got[0].body), 'SELECT 1\0');
  eq('byte-by-byte: second body is "SELECT 2\\0"', P.dec(got[1].body), 'SELECT 2\0');
})();

// A keyword-looking string inside a payload is never mistaken for a frame boundary.
(() => {
  const reader = new P.MessageReader();
  const msg = P.queryMessage("SELECT 'D' || 'T'"); // bytes 'D','T' are also message types
  reader.push(msg);
  const m = reader.next();
  eq('payload bytes that look like type codes stay in the body', P.dec(m.body), "SELECT 'D' || 'T'\0");
  eq('no phantom second message', reader.next(), null);
})();

/* ---- 4. SCRAM-SHA-256 pinned to RFC 7677 --------------------------------- */
section('SCRAM-SHA-256 (RFC 7677 worked example)');

(() => {
  const user = 'user', password = 'pencil';
  const clientNonce = 'rOprNGfwEbeRWgbNEkqO';
  const serverFirst = 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
  const scram = P.buildScramClient(user, password, clientNonce);
  eq('client-first-bare matches RFC', scram.clientFirstBare, 'n=user,r=rOprNGfwEbeRWgbNEkqO');
  eq('client-first (with gs2) matches RFC', scram.clientFirst, 'n,,n=user,r=rOprNGfwEbeRWgbNEkqO');
  const r = scram.final(serverFirst);
  eq('client-final matches RFC',
    r.clientFinal,
    'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=');
  eq('expected server signature matches RFC', r.expectedServerSignature, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
})();

// The server nonce MUST extend the client nonce — a MITM swapping it is caught.
throws('SCRAM rejects a server nonce that does not extend ours',
  () => P.buildScramClient('user', 'pencil', 'rOprNGfwEbeRWgbNEkqO')
    .final('r=DIFFERENTbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096'),
  /does not extend/);

// Server side recovers and verifies the same proof, and rejects a wrong password.
(() => {
  const clientFirstBare = 'n=user,r=rOprNGfwEbeRWgbNEkqO';
  const serverFirst = 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
  const clientFinal = 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=';
  const good = P.scramServerVerify('pencil', clientFirstBare, serverFirst, clientFinal);
  ok('server verifies the correct proof', good.ok);
  eq('server signs back the RFC value', good.serverFinal, 'v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  const bad = P.scramServerVerify('wrongpw', clientFirstBare, serverFirst, clientFinal);
  ok('server rejects a proof made with the wrong password', !bad.ok);
})();

/* ---- 5. MD5 auth response shape ------------------------------------------ */
section('MD5 auth response');
(() => {
  // md5 response = "md5" + md5( md5(password||user) hex bytes || salt )
  const salt = Uint8Array.from([0x01, 0x02, 0x03, 0x04]);
  const r = P.md5AuthResponse('bob', 's3cret', salt);
  ok('md5 auth response is "md5" + 32 hex', /^md5[0-9a-f]{32}$/.test(r));
  const inner = toHex(P.md5(P.concatBytes([enc('s3cret'), enc('bob')])));
  const expect = 'md5' + toHex(P.md5(P.concatBytes([enc(inner), salt])));
  eq('md5 auth response matches the spec formula', r, expect);
})();

/* ---- 6. type decoding ----------------------------------------------------- */
section('Type decoding (OID-driven; NULL ≠ empty string)');
eq('bool t', P.decodeValue(16, enc('t')), true);
eq('bool f', P.decodeValue(16, enc('f')), false);
eq('int4', P.decodeValue(23, enc('42')), 42);
eq('int2', P.decodeValue(21, enc('-7')), -7);
eq('float8', P.decodeValue(701, enc('3.5')), 3.5);
eq('text stays text', P.decodeValue(25, enc('hello')), 'hello');
ok('NULL decodes to null', P.decodeValue(23, null) === null);
eq('empty text stays empty string, not null', P.decodeValue(25, enc('')), '');
ok('empty string is not confused with NULL', P.decodeValue(25, enc('')) !== null);
(() => {
  const big = '9007199254740993'; // > Number.MAX_SAFE_INTEGER
  eq('int8 beyond safe range stays a string', P.decodeValue(20, enc(big)), big);
  eq('int8 within safe range becomes a number', P.decodeValue(20, enc('100')), 100);
})();

/* ---- 7. full handshakes against the in-memory server --------------------- */
section('Full handshake + query over the loopback wire');

async function runSession(serverOpts, clientOpts, sql) {
  const server = new P.PgServer(serverOpts);
  const client = new P.PgClient(clientOpts);
  const pump = P.makeSyncPair(client, server);
  let res = null, err = null;
  const cp = client.connect(); pump(); // connect queues startup, then shuttle bytes
  try { await cp; } catch (e) { return { client, server, res: null, err: e }; }
  if (sql) { const qp = client.query(sql); pump(); try { res = await qp; } catch (e) { err = e; } }
  return { client, server, res, err };
}

(async () => {
  // trust
  {
    const { client, res } = await runSession(
      { authMethod: 'trust' },
      { user: 'postgres', database: 'appdb' },
      'SELECT id, name FROM employees ORDER BY id LIMIT 3');
    eq('trust: negotiated auth method', client.authMethod, 'trust');
    eq('trust: connection ready', client.state, 'ready');
    eq('trust: server_version parameter received', !!client.parameters.server_version, true);
    eq('trust: three rows', res.rows.length, 3);
    eq('trust: first row name', res.rows[0].name, 'Ada Lovelace');
    eq('trust: command tag', res.command, 'SELECT 3');
  }

  // cleartext (right + wrong password)
  {
    const { client, res } = await runSession(
      { authMethod: 'cleartext', users: { app: 'hunter2' } },
      { user: 'app', password: 'hunter2' },
      'SELECT count(*) FROM employees');
    eq('cleartext: auth method', client.authMethod, 'cleartext');
    eq('cleartext: count(*) = 10', res.rows[0].count, 10);
  }
  {
    const { err } = await runSession(
      { authMethod: 'cleartext', users: { app: 'hunter2' } },
      { user: 'app', password: 'WRONG' }, null);
    ok('cleartext: wrong password is rejected', err && /password authentication failed/.test(err.message));
    ok('cleartext: rejection carries SQLSTATE 28P01', err && err.code === '28P01');
  }

  // md5 (right + wrong)
  {
    const { client, res } = await runSession(
      { authMethod: 'md5', users: { dba: 'letmein' } },
      { user: 'dba', password: 'letmein' },
      'SELECT name, salary FROM employees WHERE department = \'Research\' ORDER BY salary DESC');
    eq('md5: auth method', client.authMethod, 'md5');
    eq('md5: research rows', res.rows.length, 3);
    eq('md5: top earner in research', res.rows[0].name, 'Donald Knuth');
  }
  {
    const { err } = await runSession(
      { authMethod: 'md5', users: { dba: 'letmein' } },
      { user: 'dba', password: 'nope' }, null);
    ok('md5: wrong password is rejected', err && /password authentication failed/.test(err.message));
  }

  // scram-sha-256 (the real exchange, right + wrong)
  {
    const { client, res } = await runSession(
      { authMethod: 'scram-sha-256', users: { secure: 'pencil' } },
      { user: 'secure', password: 'pencil' },
      "SELECT name FROM employees WHERE active = true AND department = 'Operations' ORDER BY name");
    eq('scram: auth method', client.authMethod, 'scram-sha-256');
    eq('scram: operations+active rows', res.rows.length, 2);
    eq('scram: first name', res.rows[0].name, 'Margaret Hamilton');
  }
  {
    const { err } = await runSession(
      { authMethod: 'scram-sha-256', users: { secure: 'pencil' } },
      { user: 'secure', password: 'WRONG' }, null);
    ok('scram: wrong password is rejected', err && /password authentication failed/.test(err.message));
  }

  // scram: a server that returns a bad final signature must be rejected by the client
  {
    const server = new P.PgServer({ authMethod: 'scram-sha-256', users: { secure: 'pencil' } });
    // tamper: make the server sign with the wrong server key
    const origVerify = P.scramServerVerify;
    const client = new P.PgClient({ user: 'secure', password: 'pencil' });
    // monkey-patch the server instance's _handleScram final step via dataset-independent hook:
    const realHandle = server._handleScram.bind(server);
    server._handleScram = function (msg) {
      if (!this._scram) return realHandle(msg);
      // compute a correct exchange then corrupt the v=
      const r = new P.Reader(msg.body);
      const clientFinal = P.dec(msg.body);
      const res = origVerify('pencil', this._scram.clientFirstBare, this._scram.serverFirst, clientFinal);
      // send a corrupted server-final
      const corrupted = 'v=' + P.b64encode(Uint8Array.from([0, 0, 0, 0]));
      this._send(P.frame('R', new P.ByteWriter().i32(12).str(corrupted).build()));
      this._scram = null;
      this._authOk();
    };
    const pump = P.makeSyncPair(client, server);
    const cp = client.connect(); pump();
    let err = null;
    try { await cp; } catch (e) { err = e; }
    ok('scram: client rejects a server whose signature does not verify', err && /server signature mismatch/.test(err.message));
  }

  // nonexistent role
  {
    const { err } = await runSession(
      { authMethod: 'scram-sha-256', users: { secure: 'pencil' } },
      { user: 'ghost', password: 'x' }, null);
    ok('role that does not exist is reported', err && /role "ghost" does not exist/.test(err.message));
  }

  /* ---- 8. mini-SQL --------------------------------------------------------- */
  section('Mock backend mini-SQL');

  async function q(sql) {
    const { res, err } = await runSession({ authMethod: 'trust' }, { user: 'postgres' }, sql);
    if (err) throw err;
    return res;
  }

  eq('SELECT * returns all columns', (await q('SELECT * FROM departments')).fields.length, 3);
  eq('SELECT * returns all rows', (await q('SELECT * FROM departments')).rows.length, 3);
  eq('column projection order honoured', (await q('SELECT name, floor FROM departments LIMIT 1')).fields.map(f => f.name).join(','), 'name,floor');
  eq('WHERE numeric >', (await q('SELECT name FROM employees WHERE salary > 150000')).rows.length, 3);
  eq('WHERE string =', (await q("SELECT name FROM employees WHERE name = 'Ada Lovelace'")).rows[0].name, 'Ada Lovelace');
  eq('WHERE boolean = false', (await q('SELECT id FROM employees WHERE active = false')).rows.length, 2);
  eq('WHERE AND', (await q("SELECT id FROM employees WHERE department = 'Engineering' AND active = true")).rows.length, 4);
  eq('ORDER BY DESC + LIMIT', (await q('SELECT name FROM employees ORDER BY salary DESC LIMIT 1')).rows[0].name, 'Barbara Liskov');
  eq('COUNT(*)', (await q('SELECT count(*) FROM employees')).rows[0].count, 10);
  eq('COUNT(*) with WHERE', (await q("SELECT count(*) FROM employees WHERE department = 'Research'")).rows[0].count, 3);
  eq('WHERE col IS NULL', (await q('SELECT id FROM employees WHERE manager_id IS NULL')).rows.length, 3);
  eq('WHERE col IS NOT NULL', (await q('SELECT id FROM employees WHERE manager_id IS NOT NULL')).rows.length, 7);
  eq('a NULL column decodes to null (manager_id)', (await q('SELECT manager_id FROM employees WHERE id = 1')).rows[0].manager_id, null);
  eq('a non-NULL column of the same column is a number', (await q('SELECT manager_id FROM employees WHERE id = 2')).rows[0].manager_id, 1);
  eq('scalar SELECT version()', /^PostgreSQL/.test((await q('SELECT version()')).rows[0].version), true);
  eq('scalar SELECT 1', (await q('SELECT 1')).rows[0]['?column?'], 1);

  // errors surface as PgError with a SQLSTATE and the connection stays usable
  {
    const { res, err } = await runSession({ authMethod: 'trust' }, { user: 'postgres' }, 'SELECT * FROM nope');
    ok('unknown table → 42P01', err && err.code === '42P01');
  }
  {
    const { err } = await runSession({ authMethod: 'trust' }, { user: 'postgres' }, 'SELECT bogus FROM employees');
    ok('unknown column → 42703', err && err.code === '42703');
  }
  {
    const { err } = await runSession({ authMethod: 'trust' }, { user: 'postgres' }, 'DELETE FROM employees');
    ok('write statement refused by read-only demo backend', err && /SELECT statements only/.test(err.message));
  }
  // connection survives an error: run two queries on one connection, second after first errors
  {
    const server = new P.PgServer({ authMethod: 'trust' });
    const client = new P.PgClient({ user: 'postgres' });
    const pump = P.makeSyncPair(client, server);
    const cp = client.connect(); pump(); await cp;
    const q1 = client.query('SELECT * FROM nope'); pump();
    let e1 = null; try { await q1; } catch (e) { e1 = e; }
    const q2 = client.query('SELECT count(*) FROM employees'); pump();
    const r2 = await q2;
    ok('after an error the connection still answers the next query', e1 && r2.rows[0].count === 10);
  }

  // trace captures the full conversation
  {
    const trace = [];
    const server = new P.PgServer({ authMethod: 'scram-sha-256', users: { u: 'pencil' } });
    const client = new P.PgClient({ user: 'u', password: 'pencil', onTrace: e => trace.push(e) });
    const pump = P.makeSyncPair(client, server);
    const cp = client.connect(); pump(); await cp;
    const labels = trace.map(t => t.label);
    ok('trace shows StartupMessage', labels.includes('StartupMessage'));
    ok('trace shows SASLInitialResponse', labels.includes('SASLInitialResponse'));
    ok('trace shows AuthSASLContinue', labels.includes('AuthSASLContinue'));
    ok('trace shows AuthenticationOk', labels.includes('AuthenticationOk'));
    ok('trace shows ReadyForQuery', labels.includes('ReadyForQuery'));
  }

  /* ---- done ---------------------------------------------------------------- */
  console.log(`\n${'='.repeat(56)}`);
  if (failed === 0) console.log(`All ${passed} checks passed.`);
  else { console.log(`${passed} passed, ${failed} FAILED:`); fails.forEach(f => console.log('   - ' + f)); }
  console.log('='.repeat(56));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
