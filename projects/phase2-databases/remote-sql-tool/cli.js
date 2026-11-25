#!/usr/bin/env node
'use strict';
/*
 * cli.js — run SQL against a remote PostgreSQL server from the command line,
 * using the hand-written protocol in pg-core.js. No `pg`, no `libpq`.
 *
 *   node cli.js --demo "SELECT * FROM employees LIMIT 3"
 *       Talk to the in-process mock server (no network). Great for seeing the
 *       handshake without a database.
 *
 *   node cli.js --host db.example.com --port 5432 --user alice \
 *               --db appdb "SELECT now()"
 *       Connect over TCP to a real PostgreSQL server. The password is read from
 *       the PGPASSWORD environment variable (never a command-line flag — flags
 *       show up in `ps` and shell history).
 *
 * Flags: --host --port --user --db/--database --demo --trace
 * SQL is the first non-flag argument, or read from stdin if omitted.
 *
 * Responsible use: this connects to servers you provide. Credentials come from
 * the environment, not the command line; the tool does not store them.
 */

const net = require('net');
const P = require('./pg-core.js');

function parseArgs(argv) {
  const opts = { host: '127.0.0.1', port: 5432, user: process.env.USER || 'postgres', database: null, demo: false, trace: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') opts.demo = true;
    else if (a === '--trace') opts.trace = true;
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '--port') opts.port = parseInt(argv[++i], 10);
    else if (a === '--user' || a === '-U') opts.user = argv[++i];
    else if (a === '--db' || a === '--database' || a === '-d') opts.database = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else rest.push(a);
  }
  opts.sql = rest.join(' ');
  if (!opts.database) opts.database = opts.user;
  return opts;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (data += d));
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

function printTable(result) {
  if (!result.fields || result.fields.length === 0) {
    console.log(result.command || '(no rows)');
    return;
  }
  const headers = result.fields.map(f => f.name);
  const rows = result.rows.map(r => headers.map(h => {
    const v = r[h];
    return v === null ? 'NULL' : String(v);
  }));
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length), 0));
  const line = (cells) => ' ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ');
  console.log(line(headers));
  console.log(' ' + widths.map(w => '-'.repeat(w)).join('-+-'));
  for (const r of rows) console.log(line(r));
  console.log(`(${result.rowCount} row${result.rowCount === 1 ? '' : 's'})`);
}

function colorTrace(e) {
  const dir = e.dir === 'C→S' ? '\x1b[36m' + e.dir + '\x1b[0m' : '\x1b[33m' + e.dir + '\x1b[0m';
  console.error(`  ${dir}  ${e.label}  [${e.len}B]`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node cli.js [--demo] [--host H] [--port P] [--user U] [--db D] [--trace] "SQL"');
    console.log('Password is read from PGPASSWORD. With --demo, user "postgres" password "postgres".');
    return;
  }
  if (!opts.sql) opts.sql = await readStdin();
  if (!opts.sql) opts.sql = 'SELECT version()';

  const password = opts.demo ? (process.env.PGPASSWORD || 'postgres') : (process.env.PGPASSWORD || '');
  const onTrace = opts.trace ? colorTrace : null;

  const client = new P.PgClient({
    user: opts.user, password, database: opts.database,
    application_name: 'remote-sql-tool/cli', onTrace,
  });

  if (opts.demo) {
    const server = new P.PgServer({ authMethod: 'scram-sha-256', users: { [opts.user]: password }, database: opts.database });
    P.connectLoopback(client, server);
    if (opts.trace) console.error(`\x1b[2m[demo] in-process mock server, SCRAM-SHA-256, user "${opts.user}"\x1b[0m`);
    await runQueries(client, opts);
    return;
  }

  // Real TCP connection.
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port }, async () => {
      client.attach({ write: (bytes) => socket.write(Buffer.from(bytes)) });
      socket.on('data', (buf) => client.push(new Uint8Array(buf)));
      socket.on('error', reject);
      socket.on('close', () => { /* connection closed */ });
      try {
        if (opts.trace) console.error(`\x1b[2m[connected] ${opts.host}:${opts.port} as "${opts.user}" → db "${opts.database}"\x1b[0m`);
        await runQueries(client, opts);
        socket.end();
        resolve();
      } catch (e) { socket.destroy(); reject(e); }
    });
    socket.on('error', reject);
  });
}

async function runQueries(client, opts) {
  await client.connect();
  if (opts.trace) console.error(`\x1b[2m[auth] ${client.authMethod}; server ${client.parameters.server_version || '?'}\x1b[0m`);
  try {
    const result = await client.query(opts.sql);
    for (const r of result.results) printTable({ ...r, rowCount: r.rows.length });
  } finally {
    client.end();
  }
}

main().catch((e) => {
  console.error('\x1b[31merror:\x1b[0m ' + (e.code ? `[${e.code}] ` : '') + e.message);
  process.exit(1);
});
