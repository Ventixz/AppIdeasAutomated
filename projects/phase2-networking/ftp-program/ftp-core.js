/*
 * ftp-core.js — a dependency-free, transport-agnostic implementation of the
 * client and server halves of the File Transfer Protocol (RFC 959), plus an
 * in-memory filesystem and an in-process "wire" that links the two without a
 * real socket.
 *
 * Nothing in this file imports `net`, touches the DOM, or opens a real
 * connection. Everything speaks over an abstract *channel* — an object with
 * `write(str)`, `onData(cb)`, `onClose(cb)` and `close()`. The browser page
 * and the fast unit tests wire client and server together with the in-memory
 * channels at the bottom of this file; the Node integration test (ftp-node.js)
 * binds the very same client and server cores to real 127.0.0.1 TCP sockets.
 *
 * The point of the project is the protocol, not a socket wrapper: FTP's
 * two-channel design (a persistent *control* connection carrying 3-digit reply
 * codes, and a throwaway *data* connection opened per transfer), the awkward
 * "reply, transfer, reply" dance around every RETR/STOR/LIST, multi-line
 * replies, and the passive-mode host/port handshake are all modelled honestly.
 */
'use strict';

const CRLF = '\r\n';

/* ------------------------------------------------------------------ *
 *  Reply parsing (server -> client, on the control channel)
 *
 *  A single-line reply is "220 Service ready\r\n".
 *  A multi-line reply opens with "NNN-..." and runs until a line that begins
 *  with the SAME three digits followed by a space: e.g.
 *      230-Welcome, user.
 *      230-Disk quota: 2GB
 *      230 Logged in.
 *  (RFC 959 §4.2.) Intermediate lines may themselves look like "NNN-..." or be
 *  anything at all, so the terminator test is specifically "NNN<space>".
 * ------------------------------------------------------------------ */

// Is `line` the first line of a reply, and if so is it multi-line? Returns
// { code, dash } or null when the line isn't a reply opener (a continuation).
function classifyLine(line) {
  const m = /^(\d{3})([ -])/.exec(line);
  if (!m) return null;
  return { code: Number(m[1]), dash: m[2] === '-' };
}

// A streaming parser: feed it raw text chunks, pull complete replies out.
class ReplyParser {
  constructor() {
    this._buf = '';
    this._lines = [];     // lines of the reply currently being assembled
    this._code = null;    // the opening code of a multi-line reply, or null
    this._ready = [];     // fully-parsed replies waiting to be read
  }

  // Accept a chunk of bytes from the wire and extract every complete line.
  push(chunk) {
    this._buf += chunk;
    let nl;
    // Tolerate bare "\n" as well as "\r\n" — real servers are sloppy.
    while ((nl = this._buf.indexOf('\n')) !== -1) {
      let line = this._buf.slice(0, nl);
      this._buf = this._buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this._consumeLine(line);
    }
  }

  _consumeLine(line) {
    if (this._code === null) {
      // We're between replies — this line must open one.
      const c = classifyLine(line);
      if (!c) {
        // Stray continuation with no opener; treat the whole line as a
        // malformed single reply rather than throwing.
        this._emit({ code: 0, text: line, lines: [line], malformed: true });
        return;
      }
      if (c.dash) {
        this._code = c.code;
        this._lines = [line.slice(4)];
      } else {
        this._emit({ code: c.code, text: line.slice(4), lines: [line.slice(4)] });
      }
      return;
    }
    // We're inside a multi-line reply. Does this line close it?
    const terminator = new RegExp('^' + this._code + ' ');
    if (terminator.test(line)) {
      this._lines.push(line.slice(4));
      const text = this._lines.join('\n');
      const reply = { code: this._code, text, lines: this._lines.slice() };
      this._code = null;
      this._lines = [];
      this._emit(reply);
    } else {
      // Continuation line. Strip a leading "NNN-" if present, else keep as-is.
      const c = classifyLine(line);
      this._lines.push(c && c.dash ? line.slice(4) : line);
    }
  }

  _emit(reply) {
    const w = this._waiter;
    if (w) { this._waiter = null; w(reply); }
    else this._ready.push(reply);
  }

  // Promise for the next complete reply.
  next() {
    if (this._ready.length) return Promise.resolve(this._ready.shift());
    return new Promise((resolve) => { this._waiter = resolve; });
  }
}

/* ------------------------------------------------------------------ *
 *  Passive-mode address encoding
 *
 *  A 227 reply carries the data address as six comma-separated bytes inside
 *  parentheses: the four octets of the IPv4 address then the port split into
 *  two bytes, high first:  port = p1 * 256 + p2.
 * ------------------------------------------------------------------ */

function parsePasvReply(text) {
  const m = /\((\d{1,3}(?:,\s*\d{1,3}){5})\)/.exec(text);
  if (!m) throw new Error('227 reply has no (h,h,h,h,p1,p2) tuple: ' + text);
  const n = m[1].split(',').map((x) => Number(x.trim()));
  if (n.some((x) => x < 0 || x > 255)) {
    throw new Error('byte out of range 0..255 in PASV tuple: ' + text);
  }
  const host = n.slice(0, 4).join('.');
  const port = n[4] * 256 + n[5];
  return { host, port };
}

function formatPasvReply(host, port) {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((x) => Number.isNaN(x) || x < 0 || x > 255)) {
    throw new Error('bad IPv4 host for PASV: ' + host);
  }
  if (port < 0 || port > 65535) throw new Error('port out of range: ' + port);
  const p1 = port >> 8, p2 = port & 0xff;
  return `(${octets.join(',')},${p1},${p2})`;
}

// Active-mode PORT command body: same six-byte encoding, no parentheses.
function formatPortCommand(host, port) {
  return formatPasvReply(host, port).slice(1, -1); // drop the ()
}

function parsePortCommand(arg) {
  const n = arg.split(',').map((x) => Number(x.trim()));
  if (n.length !== 6 || n.some((x) => Number.isNaN(x) || x < 0 || x > 255)) {
    throw new Error('bad PORT argument: ' + arg);
  }
  return { host: n.slice(0, 4).join('.'), port: n[4] * 256 + n[5] };
}

/* ------------------------------------------------------------------ *
 *  The FTP client
 *
 *  Drives a session over a `transport`:
 *     transport.control            -> a channel to the server's control port
 *     transport.openData(host,port)-> Promise<channel> for one data transfer
 *  `log(dir, text)` (optional) receives every control line for a UI trace,
 *  with dir === '>' for client->server and '<' for server->client.
 * ------------------------------------------------------------------ */

class FtpClient {
  constructor(transport, opts = {}) {
    this.t = transport;
    this.log = opts.log || (() => {});
    this.parser = new ReplyParser();
    this.type = 'A';            // ASCII until a TYPE command says otherwise
    this._closed = false;
    transport.control.onData((chunk) => {
      // Surface each reply line to the log as it arrives.
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line !== '') this.log('<', line);
      }
      this.parser.push(chunk);
    });
    transport.control.onClose(() => { this._closed = true; });
  }

  async _send(line) {
    // PASS is the one command whose argument we never echo verbatim.
    const shown = /^PASS /i.test(line) ? 'PASS ' + '*'.repeat(Math.max(0, line.length - 5)) : line;
    this.log('>', shown);
    this.t.control.write(line + CRLF);
  }

  _reply() { return this.parser.next(); }

  // Send a command and return the server's (final) reply.
  async command(line) {
    await this._send(line);
    return this._reply();
  }

  // Assert that a reply's code is one of `codes`, else throw with the text.
  _expect(reply, codes) {
    if (!codes.includes(reply.code)) {
      const e = new Error(`${reply.code} ${reply.text}`);
      e.reply = reply;
      e.expected = codes;
      throw e;
    }
    return reply;
  }

  // Read the opening greeting the server sends on connect.
  async readGreeting() {
    const r = await this._reply();
    return this._expect(r, [220]);
  }

  async login(user, pass) {
    const u = await this.command('USER ' + user);
    if (u.code === 230) return u;             // some servers need no password
    this._expect(u, [331, 332]);
    const p = await this.command('PASS ' + pass);
    return this._expect(p, [230]);
  }

  async pwd() {
    const r = await this.command('PWD');
    this._expect(r, [257]);
    // 257 "/path" is current directory.  Path is the quoted part; "" inside is
    // an escaped quote.
    const m = /"((?:[^"]|"")*)"/.exec(r.text);
    return m ? m[1].replace(/""/g, '"') : r.text;
  }

  async cwd(path) { return this._expect(await this.command('CWD ' + path), [250]); }
  async cdup()    { return this._expect(await this.command('CDUP'), [200, 250]); }
  async mkd(path) { return this._expect(await this.command('MKD ' + path), [257]); }
  async rmd(path) { return this._expect(await this.command('RMD ' + path), [250]); }
  async dele(path){ return this._expect(await this.command('DELE ' + path), [250]); }

  async setType(t) {
    const r = await this.command('TYPE ' + t);
    this._expect(r, [200]);
    this.type = t;
    return r;
  }

  // Open a passive data connection: PASV, parse the address, dial it.
  async _openPassive() {
    const r = await this.command('PASV');
    this._expect(r, [227]);
    const { host, port } = parsePasvReply(r.text);
    return this.t.openData(host, port);
  }

  // Collect everything a channel sends until it closes.
  _drain(channel) {
    return new Promise((resolve) => {
      let out = '';
      channel.onData((c) => { out += c; });
      channel.onClose(() => resolve(out));
    });
  }

  // LIST [path] — directory listing over a fresh data connection.
  async list(path) {
    const data = await this._openPassive();
    const body = this._drain(data);
    const pre = await this.command('LIST' + (path ? ' ' + path : ''));
    this._expect(pre, [125, 150]);
    const text = await body;                   // data channel drains & closes
    const done = await this._reply();          // the trailing 226/250
    this._expect(done, [226, 250]);
    return text.split(/\r?\n/).filter((l) => l !== '');
  }

  // NLST — bare-names listing (machine friendlier than LIST).
  async nlst(path) {
    const data = await this._openPassive();
    const body = this._drain(data);
    const pre = await this.command('NLST' + (path ? ' ' + path : ''));
    this._expect(pre, [125, 150]);
    const text = await body;
    this._expect(await this._reply(), [226, 250]);
    return text.split(/\r?\n/).filter((l) => l !== '');
  }

  // RETR path — download a file; resolves with its contents as a string.
  async retr(path) {
    const data = await this._openPassive();
    const body = this._drain(data);
    const pre = await this.command('RETR ' + path);
    this._expect(pre, [125, 150]);
    const text = await body;
    this._expect(await this._reply(), [226, 250]);
    return text;
  }

  // STOR path, contents — upload a file.
  async stor(path, contents) {
    const data = await this._openPassive();
    const pre = await this.command('STOR ' + path);
    this._expect(pre, [125, 150]);
    data.write(contents);
    data.close();
    const done = await this._reply();
    return this._expect(done, [226, 250]);
  }

  async size(path) {
    const r = await this.command('SIZE ' + path);
    this._expect(r, [213]);
    return Number(r.text.trim());
  }

  async system() { return this.command('SYST'); }
  async noop()   { return this._expect(await this.command('NOOP'), [200]); }

  async quit() {
    const r = await this.command('QUIT');
    this.t.control.close();
    return r;
  }
}

/* ------------------------------------------------------------------ *
 *  An in-memory filesystem the server operates on.
 *
 *  Directories are plain objects; files are strings. Paths are POSIX-style,
 *  always resolved to an absolute, normalised form so "..", ".", trailing
 *  slashes and doubled slashes can't escape the root or confuse listings.
 * ------------------------------------------------------------------ */

class MemoryFileSystem {
  constructor(tree) {
    this.root = tree || { 'pub': { 'readme.txt': 'hello from the in-memory FTP server\n' } };
  }

  static normalize(path) {
    const parts = [];
    for (const seg of String(path).split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { parts.pop(); continue; }
      parts.push(seg);
    }
    return '/' + parts.join('/');
  }

  // Resolve a possibly-relative path against `cwd` to an absolute one.
  resolve(cwd, path) {
    if (path.startsWith('/')) return MemoryFileSystem.normalize(path);
    return MemoryFileSystem.normalize(cwd + '/' + path);
  }

  _walk(abs) {
    if (abs === '/') return { parent: null, name: '', node: this.root };
    const parts = abs.slice(1).split('/');
    let node = this.root, parent = null, name = '';
    for (const p of parts) {
      if (typeof node !== 'object' || node === null) return null;
      if (!(p in node)) return { parent: node, name: p, node: undefined };
      parent = node; name = p; node = node[p];
    }
    return { parent, name, node };
  }

  isDir(abs)  { const w = this._walk(abs); return !!w && typeof w.node === 'object' && w.node !== null; }
  isFile(abs) { const w = this._walk(abs); return !!w && typeof w.node === 'string'; }
  exists(abs) { const w = this._walk(abs); return !!w && w.node !== undefined; }

  read(abs) {
    if (!this.isFile(abs)) throw new Error('no such file: ' + abs);
    return this._walk(abs).node;
  }

  write(abs, contents) {
    const w = this._walk(abs);
    if (!w || !w.parent) throw new Error('cannot write: ' + abs);
    if (typeof w.node === 'object' && w.node !== null) throw new Error('is a directory: ' + abs);
    w.parent[w.name] = String(contents);
  }

  list(abs) {
    if (!this.isDir(abs)) throw new Error('not a directory: ' + abs);
    const dir = this._walk(abs).node;
    return Object.keys(dir).sort().map((name) => ({
      name,
      isDir: typeof dir[name] === 'object' && dir[name] !== null,
      size: typeof dir[name] === 'string' ? dir[name].length : 0,
    }));
  }

  mkdir(abs) {
    const w = this._walk(abs);
    if (!w || !w.parent) throw new Error('cannot mkdir: ' + abs);
    if (w.node !== undefined) throw new Error('already exists: ' + abs);
    w.parent[w.name] = {};
  }

  remove(abs, { dir } = {}) {
    const w = this._walk(abs);
    if (!w || !w.parent || w.node === undefined) throw new Error('no such path: ' + abs);
    const isDir = typeof w.node === 'object' && w.node !== null;
    if (dir && !isDir) throw new Error('not a directory: ' + abs);
    if (!dir && isDir) throw new Error('is a directory: ' + abs);
    if (dir && Object.keys(w.node).length) throw new Error('directory not empty: ' + abs);
    delete w.parent[w.name];
  }
}

// Render one `ls -l`-ish line for a LIST entry (what real clients parse).
function formatListLine(entry) {
  const perms = entry.isDir ? 'drwxr-xr-x' : '-rw-r--r--';
  const size = String(entry.size).padStart(8);
  // A fixed, stable date keeps the listing deterministic for tests/visuals.
  return `${perms} 1 ftp ftp ${size} Jan 01 00:00 ${entry.name}`;
}

/* ------------------------------------------------------------------ *
 *  The FTP server, one session per control connection.
 *
 *  `dataProvider` abstracts how a data connection is obtained in each
 *  environment: in passive mode the session asks it to `listen()` (returning
 *  the {host, port} to advertise plus a promise for the eventual channel); in
 *  active mode it asks it to `connect(host, port)`.
 * ------------------------------------------------------------------ */

class FtpServerSession {
  constructor(control, fs, dataProvider, opts = {}) {
    this.control = control;
    this.fs = fs;
    this.data = dataProvider;
    this.users = opts.users || { anonymous: '', ftp: '', user: 'pass' };
    this.greeting = opts.greeting || ['220-Welcome to the in-memory FTP server', '220 Ready'];
    this.cwd = '/';
    this.type = 'A';
    this.user = null;
    this.authed = false;
    this._lineBuf = '';
    this._pendingData = null;   // a promise for the next data channel
    this._pendingAddr = null;   // the {host,port} we advertised (active mode)

    control.onData((chunk) => this._onData(chunk));
    control.onClose(() => {});
    this._send(this.greeting.join(CRLF) + CRLF);
  }

  _send(text) { this.control.write(text); }
  _reply(code, text) {
    // Multi-line if text has newlines; otherwise one "NNN text" line.
    const lines = String(text).split('\n');
    if (lines.length === 1) { this._send(`${code} ${text}${CRLF}`); return; }
    let out = '';
    for (let i = 0; i < lines.length; i++) {
      out += code + (i === lines.length - 1 ? ' ' : '-') + lines[i] + CRLF;
    }
    this._send(out);
  }

  _onData(chunk) {
    this._lineBuf += chunk;
    let nl;
    while ((nl = this._lineBuf.indexOf('\n')) !== -1) {
      let line = this._lineBuf.slice(0, nl);
      this._lineBuf = this._lineBuf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line !== '') this._handle(line);
    }
  }

  async _handle(line) {
    const sp = line.indexOf(' ');
    const cmd = (sp === -1 ? line : line.slice(0, sp)).toUpperCase();
    const arg = sp === -1 ? '' : line.slice(sp + 1);
    try {
      const h = this['cmd_' + cmd];
      if (!h) { this._reply(502, `Command not implemented: ${cmd}`); return; }
      if (!this.authed && !['USER', 'PASS', 'QUIT', 'SYST', 'NOOP', 'FEAT'].includes(cmd)) {
        this._reply(530, 'Not logged in'); return;
      }
      await h.call(this, arg);
    } catch (e) {
      this._reply(550, e.message || 'Error');
    }
  }

  // ---- authentication -------------------------------------------------
  cmd_USER(arg) {
    this.user = arg;
    this.authed = false;
    if (Object.prototype.hasOwnProperty.call(this.users, arg) && this.users[arg] === '') {
      this.authed = true;
      this._reply(230, 'Login successful (no password required)');
    } else {
      this._reply(331, `Password required for ${arg}`);
    }
  }
  cmd_PASS(arg) {
    if (this.user && this.users[this.user] === arg) {
      this.authed = true;
      this._reply(230, 'Login successful');
    } else {
      this._reply(530, 'Login incorrect');
    }
  }

  // ---- navigation -----------------------------------------------------
  cmd_PWD() { this._reply(257, `"${this.cwd}" is the current directory`); }
  cmd_CWD(arg) {
    const abs = this.fs.resolve(this.cwd, arg);
    if (!this.fs.isDir(abs)) { this._reply(550, 'Not a directory'); return; }
    this.cwd = abs;
    this._reply(250, 'Directory changed to ' + abs);
  }
  cmd_CDUP() { this.cwd = MemoryFileSystem.normalize(this.cwd + '/..'); this._reply(250, 'Directory changed to ' + this.cwd); }
  cmd_MKD(arg) { const abs = this.fs.resolve(this.cwd, arg); this.fs.mkdir(abs); this._reply(257, `"${abs}" created`); }
  cmd_RMD(arg) { this.fs.remove(this.fs.resolve(this.cwd, arg), { dir: true }); this._reply(250, 'Directory removed'); }
  cmd_DELE(arg) { this.fs.remove(this.fs.resolve(this.cwd, arg), { dir: false }); this._reply(250, 'File deleted'); }

  // ---- transfer settings ---------------------------------------------
  cmd_TYPE(arg) {
    const t = arg.trim().toUpperCase().split(/\s+/)[0];
    if (t !== 'A' && t !== 'I') { this._reply(504, 'Only TYPE A and I supported'); return; }
    this.type = t;
    this._reply(200, `Type set to ${t}`);
  }
  cmd_SYST() { this._reply(215, 'UNIX Type: L8 (in-memory)'); }
  cmd_NOOP() { this._reply(200, 'NOOP ok'); }
  cmd_FEAT() { this._reply(211, 'Features:\n SIZE\n PASV\n End'); }
  cmd_SIZE(arg) {
    const abs = this.fs.resolve(this.cwd, arg);
    if (!this.fs.isFile(abs)) { this._reply(550, 'Not a file'); return; }
    this._reply(213, String(this.fs.read(abs).length));
  }

  // ---- data channel setup --------------------------------------------
  async cmd_PASV() {
    // listen() may need to bind a real socket, so it resolves asynchronously
    // with the advertised address and a promise for the eventual channel.
    const { host, port, channel } = await this.data.listen();
    this._pendingData = channel;   // a promise resolving to the data channel
    this._reply(227, 'Entering Passive Mode ' + formatPasvReply(host, port));
  }
  cmd_PORT(arg) {
    const { host, port } = parsePortCommand(arg);
    this._pendingAddr = { host, port };
    this._pendingData = null;
    this._reply(200, 'PORT command successful');
  }

  // Obtain the data channel for the next transfer (passive or active).
  async _dataChannel() {
    if (this._pendingData) { const ch = await this._pendingData; this._pendingData = null; return ch; }
    if (this._pendingAddr) { const a = this._pendingAddr; this._pendingAddr = null; return this.data.connect(a.host, a.port); }
    throw new Error('No data connection — use PASV or PORT first');
  }

  // ---- the transfers --------------------------------------------------
  async cmd_LIST(arg) {
    const abs = arg ? this.fs.resolve(this.cwd, arg) : this.cwd;
    if (!this.fs.isDir(abs)) { this._reply(550, 'Not a directory'); return; }
    const ch = await this._dataChannel();
    this._reply(150, 'Here comes the directory listing');
    const body = this.fs.list(abs).map(formatListLine).join(CRLF) + CRLF;
    ch.write(body);
    ch.close();
    this._reply(226, 'Directory send OK');
  }
  async cmd_NLST(arg) {
    const abs = arg ? this.fs.resolve(this.cwd, arg) : this.cwd;
    if (!this.fs.isDir(abs)) { this._reply(550, 'Not a directory'); return; }
    const ch = await this._dataChannel();
    this._reply(150, 'Here comes the listing');
    ch.write(this.fs.list(abs).map((e) => e.name).join(CRLF) + CRLF);
    ch.close();
    this._reply(226, 'Directory send OK');
  }
  async cmd_RETR(arg) {
    const abs = this.fs.resolve(this.cwd, arg);
    if (!this.fs.isFile(abs)) { this._reply(550, 'No such file'); return; }
    const ch = await this._dataChannel();
    this._reply(150, `Opening ${this.type === 'A' ? 'ASCII' : 'BINARY'} mode data connection for ${arg}`);
    ch.write(this.fs.read(abs));
    ch.close();
    this._reply(226, 'Transfer complete');
  }
  async cmd_STOR(arg) {
    const abs = this.fs.resolve(this.cwd, arg);
    const ch = await this._dataChannel();
    this._reply(150, `Ok to send data for ${arg}`);
    let buf = '';
    ch.onData((c) => { buf += c; });
    await new Promise((resolve) => ch.onClose(resolve));
    this.fs.write(abs, buf);
    this._reply(226, 'Transfer complete');
  }

  cmd_QUIT() { this._reply(221, 'Goodbye'); this.control.close(); }
}

/* ------------------------------------------------------------------ *
 *  The in-memory wire: a pair of linked channels, and a server that
 *  speaks over them. No sockets — writes on one end surface on the other
 *  on a microtask, so the ordering (and the back-and-forth of the protocol)
 *  is exactly what a real connection would produce, just in-process.
 * ------------------------------------------------------------------ */

function channelPair() {
  const a = makeEndpoint(), b = makeEndpoint();
  a._peer = b; b._peer = a;
  return [a, b];
}

function makeEndpoint() {
  return {
    _peer: null,
    _dataCbs: [],
    _closeCbs: [],
    _closed: false,
    write(str) {
      if (this._closed || !this._peer) return;
      const peer = this._peer;
      const s = String(str);
      // Deliver asynchronously so neither side re-enters the other's stack.
      Promise.resolve().then(() => { for (const cb of peer._dataCbs) cb(s); });
    },
    onData(cb) { this._dataCbs.push(cb); },
    onClose(cb) { if (this._closed) Promise.resolve().then(cb); else this._closeCbs.push(cb); },
    close() {
      if (this._closed) return;
      this._closed = true;
      const peer = this._peer;
      Promise.resolve().then(() => {
        for (const cb of this._closeCbs) cb();
        if (peer && !peer._closed) { peer._closed = true; for (const cb of peer._closeCbs) cb(); }
      });
    },
  };
}

// A server that hands out control connections and manages passive data ports
// entirely in memory. Each PASV allocates a fresh ephemeral "port" (a counter)
// the client then "dials" with openData().
class MemoryFtpServer {
  constructor(fs, opts = {}) {
    this.fs = fs || new MemoryFileSystem();
    this.opts = opts;
    this.host = '127.0.0.1';
    this._nextPort = 50000;
    this._pendingDataPorts = new Map(); // port -> resolve(serverEndChannel)
  }

  // Open a control connection: returns the client's end; wires a session to
  // the server's end.
  connectControl() {
    const [clientEnd, serverEnd] = channelPair();
    const dataProvider = {
      listen: () => {
        const port = this._nextPort++;
        let resolveCh;
        const channel = new Promise((r) => { resolveCh = r; });
        this._pendingDataPorts.set(port, resolveCh);
        return Promise.resolve({ host: this.host, port, channel });
      },
      connect: () => { throw new Error('active mode not supported by in-memory server'); },
    };
    new FtpServerSession(serverEnd, this.fs, dataProvider, this.opts);
    return clientEnd;
  }

  // The client dialing a passive data port we advertised.
  openData(host, port) {
    const resolve = this._pendingDataPorts.get(port);
    if (!resolve) return Promise.reject(new Error('no passive listener on port ' + port));
    this._pendingDataPorts.delete(port);
    const [clientEnd, serverEnd] = channelPair();
    resolve(serverEnd);        // hand the server its end
    return Promise.resolve(clientEnd);
  }

  // A transport object an FtpClient can be constructed over.
  clientTransport() {
    const control = this.connectControl();
    return { control, openData: (h, p) => this.openData(h, p) };
  }
}

/* ------------------------------------------------------------------ */

const api = {
  CRLF,
  ReplyParser,
  classifyLine,
  parsePasvReply,
  formatPasvReply,
  formatPortCommand,
  parsePortCommand,
  FtpClient,
  FtpServerSession,
  MemoryFileSystem,
  formatListLine,
  channelPair,
  MemoryFtpServer,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.FTP = api;
