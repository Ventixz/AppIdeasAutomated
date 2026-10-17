/*
 * ftp-node.js — binds the transport-agnostic cores in ftp-core.js to *real*
 * TCP sockets using Node's built-in `net` module (no third-party packages).
 *
 * This is what proves the protocol engine isn't just talking to itself: the
 * integration test in tests.js starts a real FTP server listening on a
 * 127.0.0.1 ephemeral port, connects a real client socket to it, and runs a
 * full session — greeting, login, PASV, LIST, STOR, RETR, QUIT — over actual
 * TCP. Loopback only; it never reaches off the machine.
 */
'use strict';

const net = require('net');
const {
  FtpClient,
  FtpServerSession,
  MemoryFileSystem,
} = require('./ftp-core.js');

// Wrap a net.Socket in the channel interface ftp-core speaks.
function socketChannel(sock) {
  sock.setEncoding('utf8');
  let closed = false;
  const closeCbs = [];
  sock.on('close', () => { closed = true; for (const cb of closeCbs) cb(); });
  return {
    write(s) { if (!closed) sock.write(s); },
    onData(cb) { sock.on('data', cb); },
    onClose(cb) { if (closed) cb(); else closeCbs.push(cb); },
    close() { if (!closed) sock.end(); },
  };
}

// Start a real FTP server. Resolves with { port, close } once it's listening.
function startServer(fs, opts = {}) {
  const filesystem = fs || new MemoryFileSystem();
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      const control = socketChannel(sock);
      const dataProvider = {
        // Passive mode: open a one-shot listener on an ephemeral loopback port.
        // Resolves only once the socket is actually bound, so address().port
        // is available.
        listen() {
          return new Promise((resolve) => {
            let resolveCh;
            const channel = new Promise((r) => { resolveCh = r; });
            const dataServer = net.createServer((dataSock) => {
              resolveCh(socketChannel(dataSock));
              dataServer.close();
            });
            dataServer.listen(0, '127.0.0.1', () => {
              resolve({ host: '127.0.0.1', port: dataServer.address().port, channel });
            });
          });
        },
        // Active mode: dial the client's advertised address.
        connect(host, port) {
          const dataSock = net.connect(port, host);
          return socketChannel(dataSock);
        },
      };
      new FtpServerSession(control, filesystem, dataProvider, opts);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close(), server, fs: filesystem });
    });
  });
}

// Build an FtpClient connected to a real server over loopback TCP.
function connectClient(port, opts = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      const control = socketChannel(sock);
      const transport = {
        control,
        openData(host, p) {
          return new Promise((res, rej) => {
            const d = net.connect(p, host, () => res(socketChannel(d)));
            d.on('error', rej);
          });
        },
      };
      resolve(new FtpClient(transport, opts));
    });
    sock.on('error', reject);
  });
}

module.exports = { startServer, connectClient, socketChannel };
