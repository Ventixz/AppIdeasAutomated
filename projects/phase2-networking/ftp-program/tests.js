/*
 * tests.js — dependency-free checks for the FTP implementation, run under
 * Node:   node projects/phase2-networking/ftp-program/tests.js
 *
 * Three layers:
 *   1. Pure protocol units — reply parsing (single + multi-line), PASV/PORT
 *      address encoding, the in-memory filesystem and its path safety.
 *   2. A full session over the in-memory wire (client core <-> server core,
 *      no sockets): login, navigation, LIST, STOR, RETR, SIZE, DELE, QUIT.
 *   3. A real-socket integration test: the same cores over genuine 127.0.0.1
 *      TCP, proving the engine works on an actual connection.
 */
'use strict';

const assert = require('assert');
const {
  ReplyParser,
  classifyLine,
  parsePasvReply,
  formatPasvReply,
  formatPortCommand,
  parsePortCommand,
  FtpClient,
  MemoryFileSystem,
  MemoryFtpServer,
  formatListLine,
} = require('./ftp-core.js');
const { startServer, connectClient } = require('./ftp-node.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; })
    .catch((e) => { failures.push([name, e]); });
}
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

// Pull all complete replies a parser currently holds.
function drainReplies(p) {
  const out = [];
  while (p._ready.length) out.push(p._ready.shift());
  return out;
}

async function main() {
  /* ---- 1. reply parsing -------------------------------------------- */

  await check('single-line reply parses code + text', () => {
    const p = new ReplyParser();
    p.push('220 Service ready\r\n');
    eq(drainReplies(p), [{ code: 220, text: 'Service ready', lines: ['Service ready'] }]);
  });

  await check('reply split across two chunks reassembles', () => {
    const p = new ReplyParser();
    p.push('331 Password');
    p.push(' required\r\n');
    eq(drainReplies(p)[0].code, 331);
  });

  await check('bare \\n (no \\r) is tolerated', () => {
    const p = new ReplyParser();
    p.push('200 OK\n');
    eq(drainReplies(p)[0].text, 'OK');
  });

  await check('multi-line reply collects to the NNN<space> terminator', () => {
    const p = new ReplyParser();
    p.push('230-Welcome, user.\r\n230-Quota: 2GB\r\n230 Logged in.\r\n');
    const r = drainReplies(p);
    eq(r.length, 1);
    eq(r[0].code, 230);
    eq(r[0].lines, ['Welcome, user.', 'Quota: 2GB', 'Logged in.']);
  });

  await check('a mid-reply line that looks like "NNN-" is not a terminator', () => {
    const p = new ReplyParser();
    // 211-...  200-... (different code, dash) ... 211 End
    p.push('211-Features:\r\n 200-weird line\r\n211 End\r\n');
    const r = drainReplies(p);
    eq(r.length, 1);
    eq(r[0].code, 211);
    eq(r[0].lines.length, 3);
  });

  await check('two replies back to back are split', () => {
    const p = new ReplyParser();
    p.push('150 Opening\r\n226 Done\r\n');
    const r = drainReplies(p);
    eq(r.map((x) => x.code), [150, 226]);
  });

  await check('classifyLine distinguishes opener, multiline, continuation', () => {
    eq(classifyLine('220 hi'), { code: 220, dash: false });
    eq(classifyLine('230-hi'), { code: 230, dash: true });
    eq(classifyLine(' continuation'), null);
    eq(classifyLine('hello'), null);
  });

  /* ---- 2. PASV / PORT encoding ------------------------------------- */

  await check('parsePasvReply computes host and port = p1*256+p2', () => {
    eq(parsePasvReply('227 Entering Passive Mode (127,0,0,1,195,80)'),
       { host: '127.0.0.1', port: 195 * 256 + 80 });
  });

  await check('parsePasvReply tolerates spaces after commas', () => {
    eq(parsePasvReply('227 PASV ok (10, 0, 0, 5, 4, 1)'),
       { host: '10.0.0.5', port: 4 * 256 + 1 });
  });

  await check('parsePasvReply rejects an out-of-range byte', () => {
    assert.throws(() => parsePasvReply('227 (127,0,0,1,999,0)'));
  });

  await check('parsePasvReply rejects a reply with no tuple', () => {
    assert.throws(() => parsePasvReply('227 nothing here'));
  });

  await check('formatPasvReply round-trips with parsePasvReply', () => {
    for (const port of [20, 21, 1024, 49920, 65535]) {
      const text = '227 x ' + formatPasvReply('192.168.1.2', port);
      eq(parsePasvReply(text), { host: '192.168.1.2', port });
    }
  });

  await check('formatPortCommand / parsePortCommand round-trip', () => {
    eq(parsePortCommand(formatPortCommand('127.0.0.1', 50000)),
       { host: '127.0.0.1', port: 50000 });
  });

  await check('port 0 and 65535 encode at the boundaries', () => {
    eq(formatPasvReply('0.0.0.0', 0), '(0,0,0,0,0,0)');
    eq(formatPasvReply('255.255.255.255', 65535), '(255,255,255,255,255,255)');
  });

  await check('formatPasvReply rejects a bad host or port', () => {
    assert.throws(() => formatPasvReply('1.2.3', 20));
    assert.throws(() => formatPasvReply('1.2.3.4', 70000));
  });

  /* ---- 3. the in-memory filesystem --------------------------------- */

  await check('normalize collapses ., .., // and trailing slash', () => {
    eq(MemoryFileSystem.normalize('/a/./b/../c/'), '/a/c');
    eq(MemoryFileSystem.normalize('a//b'), '/a/b');
    eq(MemoryFileSystem.normalize('/'), '/');
  });

  await check('.. can never escape the root', () => {
    eq(MemoryFileSystem.normalize('/../../etc/passwd'), '/etc/passwd');
    const fs = new MemoryFileSystem({ a: {} });
    eq(fs.resolve('/a', '../../..'), '/');
  });

  await check('read/write/list/mkdir/remove behave', () => {
    const fs = new MemoryFileSystem({ pub: { 'a.txt': 'AAA' } });
    eq(fs.read('/pub/a.txt'), 'AAA');
    fs.write('/pub/b.txt', 'BB');
    eq(fs.list('/pub').map((e) => e.name), ['a.txt', 'b.txt']);
    fs.mkdir('/pub/sub');
    assert(fs.isDir('/pub/sub'));
    fs.remove('/pub/b.txt');
    assert(!fs.exists('/pub/b.txt'));
  });

  await check('filesystem guards: no overwrite dir as file, no rm non-empty', () => {
    const fs = new MemoryFileSystem({ d: { 'x': 'y' } });
    assert.throws(() => fs.write('/d', 'oops'));      // d is a directory
    assert.throws(() => fs.remove('/d', { dir: true })); // not empty
    assert.throws(() => fs.read('/missing'));
    assert.throws(() => fs.mkdir('/d'));              // already exists
  });

  await check('formatListLine marks directories vs files', () => {
    assert(formatListLine({ name: 'dir', isDir: true, size: 0 }).startsWith('d'));
    assert(formatListLine({ name: 'f', isDir: false, size: 3 }).startsWith('-'));
    assert(formatListLine({ name: 'f', isDir: false, size: 3 }).endsWith(' f'));
  });

  /* ---- 4. full session over the in-memory wire --------------------- */

  function memClient() {
    const fs = new MemoryFileSystem({
      pub: { 'readme.txt': 'hello\nworld\n', docs: { 'note.md': '# note' } },
    });
    const server = new MemoryFtpServer(fs, { users: { anonymous: '', user: 'pass' } });
    const client = new FtpClient(server.clientTransport());
    return { fs, server, client };
  }

  await check('greeting then anonymous login (230, no password)', async () => {
    const { client } = memClient();
    const g = await client.readGreeting();
    eq(g.code, 220);
    const l = await client.login('anonymous', '');
    eq(l.code, 230);
  });

  await check('login with a password: USER->331, PASS->230', async () => {
    const { client } = memClient();
    await client.readGreeting();
    const l = await client.login('user', 'pass');
    eq(l.code, 230);
  });

  await check('wrong password is rejected (530)', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await assert.rejects(() => client.login('user', 'nope'), /530/);
  });

  await check('commands before login are refused (530)', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await assert.rejects(() => client.pwd(), /530/);
  });

  await check('PWD / CWD / CDUP navigate correctly', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    eq(await client.pwd(), '/');
    await client.cwd('pub');
    eq(await client.pwd(), '/pub');
    await client.cwd('docs');
    eq(await client.pwd(), '/pub/docs');
    await client.cdup();
    eq(await client.pwd(), '/pub');
  });

  await check('CWD into a non-directory fails (550)', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    await assert.rejects(() => client.cwd('pub/readme.txt'), /550/);
  });

  await check('LIST returns a directory listing over a data connection', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    await client.cwd('pub');
    const lines = await client.list();
    eq(lines.length, 2); // docs (dir) + readme.txt
    assert(lines.some((l) => l.endsWith(' readme.txt')));
    assert(lines.some((l) => l.startsWith('d') && l.endsWith(' docs')));
  });

  await check('NLST returns bare names', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    await client.cwd('pub');
    eq((await client.nlst()).sort(), ['docs', 'readme.txt']);
  });

  await check('RETR downloads a file exactly', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    eq(await client.retr('pub/readme.txt'), 'hello\nworld\n');
  });

  await check('RETR of a missing file fails (550)', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    await assert.rejects(() => client.retr('pub/nope.txt'), /550/);
  });

  await check('STOR uploads, then RETR reads it back (round-trip)', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    await client.cwd('pub');
    const payload = 'line one\nline two\nünïcödé ✓\n';
    await client.stor('upload.txt', payload);
    eq(await client.retr('upload.txt'), payload);
  });

  await check('SIZE reports byte length; DELE removes', async () => {
    const { client, fs } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    eq(await client.size('pub/readme.txt'), 'hello\nworld\n'.length);
    await client.dele('pub/readme.txt');
    assert(!fs.isFile('/pub/readme.txt'));
  });

  await check('MKD then CWD into the new directory', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    await client.mkd('/pub/fresh');
    await client.cwd('/pub/fresh');
    eq(await client.pwd(), '/pub/fresh');
  });

  await check('an unknown command returns 502, session survives', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    const r = await client.command('FLY to the moon');
    eq(r.code, 502);
    eq((await client.command('NOOP')).code, 200); // still alive
  });

  await check('SYST and NOOP work before and after login', async () => {
    const { client } = memClient();
    await client.readGreeting();
    eq((await client.system()).code, 215);
    await client.login('anonymous', '');
    eq((await client.noop()).code, 200);
  });

  await check('QUIT replies 221 and closes the control channel', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    eq((await client.quit()).code, 221);
  });

  await check('two sequential transfers reuse one control connection', async () => {
    const { client } = memClient();
    await client.readGreeting();
    await client.login('anonymous', '');
    await client.cwd('pub');
    await client.stor('a.txt', 'AAA');
    await client.stor('b.txt', 'BBBB');
    eq(await client.size('a.txt'), 3);
    eq(await client.size('b.txt'), 4);
    eq((await client.nlst()).sort(), ['a.txt', 'b.txt', 'docs', 'readme.txt']);
  });

  /* ---- 5. real-socket loopback integration ------------------------- */

  await check('full session over real 127.0.0.1 TCP sockets', async () => {
    const fs = new MemoryFileSystem({ pub: { 'hello.txt': 'over real TCP\n' } });
    const srv = await startServer(fs, { users: { anonymous: '' } });
    try {
      const client = await connectClient(srv.port);
      const g = await client.readGreeting();
      eq(g.code, 220);
      await client.login('anonymous', '');
      await client.cwd('pub');
      const listing = await client.list();
      assert(listing.some((l) => l.endsWith(' hello.txt')));
      eq(await client.retr('hello.txt'), 'over real TCP\n');
      await client.stor('round.txt', 'trip\n');
      eq(await client.retr('round.txt'), 'trip\n');
      eq((await client.quit()).code, 221);
    } finally {
      srv.close();
    }
  });

  await check('real server advertises a PASV port a real socket can dial', async () => {
    const srv = await startServer(new MemoryFileSystem({ 'x.txt': 'y' }), { users: { ftp: '' } });
    try {
      const client = await connectClient(srv.port);
      await client.readGreeting();
      await client.login('ftp', '');
      const r = await client.command('PASV');
      eq(r.code, 227);
      const { host, port } = parsePasvReply(r.text);
      eq(host, '127.0.0.1');
      assert(port > 0 && port < 65536);
      // Dial it and let the queued LIST drain so we don't leak a listener.
      const data = await client.t.openData(host, port);
      const body = new Promise((res) => { let s = ''; data.onData((c) => s += c); data.onClose(() => res(s)); });
      await client.command('LIST');
      await body;
      await client._reply();
      await client.quit();
    } finally {
      srv.close();
    }
  });

  /* ---- report ------------------------------------------------------ */

  if (failures.length === 0) {
    console.log(`All ${passed} tests passed.`);
  } else {
    console.log(`${passed} passed, ${failures.length} FAILED:`);
    for (const [name, e] of failures) console.log(`  ✗ ${name}\n    ${e && e.message}`);
    process.exitCode = 1;
  }
}

main();
