/*
 * mailcheck-node.js — binds the transport-agnostic engine in mailcheck-core.js
 * to *real* sockets using Node's built-in `net` and `tls` modules (no
 * third-party packages).
 *
 * Two things live here:
 *
 *   1. `socketConnection` / `connect` — wrap a real TCP or TLS socket in the
 *      exact `Connection` shape the core drives (writeLine / writeRaw / readLine
 *      / readExact / close). The socket is read as `latin1` so that one
 *      character equals one byte: IMAP's {literal} byte counts and `readExact`
 *      then line up with no surprises from multi-byte decoding.
 *
 *   2. `startMockServer` — runs the SAME `servePop3` / `serveImap` loops from the
 *      core over a real `net` server on loopback. That is what proves the
 *      client is talking a genuine wire protocol over a genuine socket, not just
 *      to an in-memory pipe: the integration tests start one of these, connect
 *      to it with a real socket, and check the counts come back right.
 *
 * TLS by default for the CLI, because plaintext POP3/IMAP sends your password in
 * the clear. Loopback mock servers are plaintext (there's no network to sniff).
 */
'use strict';

const net = require('net');
const tls = require('tls');
const core = require('./mailcheck-core.js');

/**
 * Wrap a connected socket as a core `Connection`.
 * @param {import('net').Socket} socket  already-connected TCP or TLS socket
 */
function socketConnection(socket) {
  const inbound = core.makeChannel();
  socket.setEncoding('latin1'); // 1 char == 1 byte, so literal counts are exact
  socket.on('data', (chunk) => inbound.feed(chunk));
  socket.on('end', () => inbound.end());
  socket.on('close', () => inbound.end());
  socket.on('error', () => inbound.end());
  return {
    writeLine(line) { socket.write(line + core.CRLF, 'latin1'); },
    writeRaw(str) { socket.write(str, 'latin1'); },
    readLine() { return inbound.readLine(); },
    readExact(n) { return inbound.readExact(n); },
    close() { try { socket.end(); } catch (_) { /* already gone */ } },
  };
}

/**
 * Open a real connection and return a `Connection`.
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {boolean} [opts.tls=true]   use implicit TLS (995 POP3S / 993 IMAPS)
 * @param {boolean} [opts.rejectUnauthorized=true]  verify the server cert
 * @returns {Promise<object>} the Connection
 */
function connect(opts) {
  const { host, port } = opts;
  const useTls = opts.tls !== false;
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    let socket;
    if (useTls) {
      socket = tls.connect(
        { host, port, rejectUnauthorized: opts.rejectUnauthorized !== false, servername: host },
        () => { socket.removeListener('error', onError); resolve(socketConnection(socket)); });
    } else {
      socket = net.connect({ host, port }, () => {
        socket.removeListener('error', onError);
        resolve(socketConnection(socket));
      });
    }
    socket.once('error', onError);
  });
}

/**
 * Convenience: connect, check the mailbox, done. Always returns the normalised
 * MailboxStatus from the core.
 * @param {'pop3'|'imap'} protocol
 * @param {object} opts  { host, port, tls, user, pass, mailbox, preview }
 */
async function checkMail(protocol, opts) {
  const conn = await connect(opts);
  try {
    // `return await` is deliberate: without the await, the `finally` would
    // close the socket before the protocol exchange's promise settles.
    if (opts.preview) {
      return await (protocol === 'pop3'
        ? core.pop3Preview(conn, opts, opts.limit || 10)
        : core.imapPreview(conn, opts, opts.limit || 10));
    }
    return await core.checkMailbox(protocol, conn, opts);
  } finally {
    conn.close();
  }
}

/**
 * Start a real loopback mock server speaking `protocol`, backed by `mailbox`.
 * Resolves with { server, port, close } once it is listening.
 */
function startMockServer(protocol, mailbox, opts = {}) {
  const serve = protocol === 'pop3' ? core.servePop3 : core.serveImap;
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      const conn = socketConnection(socket);
      Promise.resolve().then(() => serve(conn, mailbox)).catch(() => {});
    });
    server.once('error', reject);
    server.listen(opts.port || 0, opts.host || '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port, host: addr.address, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { socketConnection, connect, checkMail, startMockServer };

/* ------------------------------------------------------------------ *
 * Tiny CLI:
 *   node mailcheck-node.js <pop3|imap> <host> <user> <pass> [port] [--no-tls] [--preview]
 *
 * The password is read from argv for convenience here; a real tool should take
 * it from the environment or a prompt, never from the command line (argv is
 * visible in `ps`). Only check accounts you own.
 * ------------------------------------------------------------------ */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const pos = argv.filter((a) => !a.startsWith('--'));
  const [protocol, host, user, pass, portArg] = pos;
  if (!protocol || !host || !user || pass === undefined) {
    console.error('usage: node mailcheck-node.js <pop3|imap> <host> <user> <pass> [port] [--no-tls] [--preview]');
    process.exit(2);
  }
  const useTls = !flags.has('--no-tls');
  const defaultPort = protocol === 'pop3' ? (useTls ? 995 : 110) : (useTls ? 993 : 143);
  const port = portArg ? Number(portArg) : defaultPort;

  checkMail(protocol, {
    host, port, user, pass, tls: useTls, preview: flags.has('--preview'),
  }).then((status) => {
    const unseen = status.unseen === null ? 'n/a (POP3 has no unread concept)' : status.unseen;
    console.log(`\n${status.protocol.toUpperCase()} ${host} — ${status.mailbox}`);
    console.log(`  messages: ${status.total}`);
    console.log(`  unseen:   ${unseen}`);
    if (status.recent !== null) console.log(`  recent:   ${status.recent}`);
    if (status.sizeOctets !== null) console.log(`  size:     ${status.sizeOctets} octets`);
    if (status.messages && status.messages.length) {
      console.log('\n  latest:');
      for (const m of status.messages) {
        const mark = m.seen === false ? '•' : ' ';
        console.log(`   ${mark} ${(m.subject || '(no subject)').slice(0, 50).padEnd(50)} — ${m.from}`);
      }
    }
    console.log('');
  }).catch((err) => {
    console.error(`mail check failed: ${err.name || 'Error'}: ${err.message}`);
    process.exit(1);
  });
}
