# Remote SQL Tool

> Source 2 (karan/Projects) · **Databases** · project 2 of 7
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"A utility that can execute queries on remote
servers from your local computer across the Internet."* You give it a host, a
user and a password; it runs your query and hands back the rows.

The word that matters is **remote**. Yesterday's *SQL Query Analyzer* ran a
database inside the page. Today the database is somewhere else, and "somewhere
else" means you don't call a function — you exchange **framed bytes over a
socket**. So this project is the other half of talking to a database: the
**wire protocol**. It speaks PostgreSQL's frontend/backend protocol, version
3.0, **from the bytes up** — no `pg`, no `pg-protocol`, no `libpq`. Even the
crypto the login needs (MD5, SHA-256, HMAC, PBKDF2) is hand-written, so the
**SCRAM-SHA-256 handshake is real**, not stubbed.

```
StartupMessage → Authentication(SCRAM) → … → ReadyForQuery → Query → RowDescription → DataRow* → CommandComplete
```

## Try it

**In the browser** — open `index.html`. A browser can't open a raw TCP socket,
so the "server" on the page is an **in-process backend that speaks the same
protocol**; the client connects to it over a loopback. The handshake is
genuine — pick an auth method, hit **Connect**, and watch the **protocol trace**
fill with every message that crosses the wire (click a row to see its hex).
Then run a query. Known accounts: `secure`/`pencil`, `app`/`hunter2`,
`postgres`/`postgres`. Type a wrong password to see authentication fail for
real.

**In a terminal** — the *same* `PgClient` against a real server:

```bash
# No network — talk to the in-process mock, and print the handshake:
node cli.js --demo --trace "SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3"

# A real PostgreSQL server over TCP (password from the environment, never a flag):
PGPASSWORD=secret node cli.js --host db.example.com --port 5432 --user alice --db appdb "SELECT now()"
```

**The checks** — `node tests.js` (92 of them, no dependencies).

## The three things that are actually hard

### Trap 1 — framing: the length counts itself, and the first message is special

Every v3 message is `[1 type byte][Int32 length][payload]`. The classic mistakes
are both off-by-four: the **length field counts its own 4 bytes** but **not** the
type byte, so a reader that adds or forgets those 4 bytes desyncs and every
message after it is garbage. Worse, the **very first message (`StartupMessage`)
has no type byte at all** — just length + payload — so a reader that always eats
a type byte is wrong from byte one. And because this is TCP, bytes arrive in
arbitrary chunks: a message can be split across three reads, or three messages
can arrive in one. `MessageReader` buffers and only yields *whole* messages. The
tests feed it a two-message stream **one byte at a time** and still recover both,
and feed it a payload containing the bytes `D` and `T` (which are also message
type codes) to prove they stay inside the body and don't fake a frame boundary.

### Trap 2 — authentication is a protocol, not a password compare

A server can demand any of several methods, and the client has to actually
perform them:

- **MD5**: respond with `"md5" + md5( md5(password + user) + salt )`. The salt
  (sent by the server) makes every login's bytes different, so a captured
  response can't be replayed.
- **SCRAM-SHA-256** (RFC 5802 / RFC 7677): a four-message challenge. The client
  sends a nonce; the server replies with a salt and an iteration count; the
  client runs **PBKDF2** over the password and derives a *proof* without ever
  sending the password. The part people skip is the end: the server sends back a
  signature, and the client **must verify it** — that's what proves the server
  also knew the password and stops a man in the middle. We also check that the
  server's nonce **extends** the one we sent (another MITM guard). The whole
  exchange — client-first, client-final, and the expected server signature — is
  **pinned byte-for-byte to the RFC 7677 worked example** (`user` / `pencil`),
  and the server side is implemented too, so the browser demo does a *real*
  SCRAM round trip and the tests prove a wrong password is rejected and a
  tampered server signature is caught.

### Trap 3 — a row is bytes, and NULL is not the empty string

A `DataRow` is raw bytes per column. You only know a column is an integer and
not text because the `RowDescription` that came *first* carried its **type OID**;
decoding happens by OID (`16`→bool, `23`→int4, `20`→int8, …). And a column
length of **`-1` means SQL `NULL`**, which is emphatically **not** a zero-length
value (`0` → empty string `''`). Conflate them and every nullable column lies.
The tests keep them distinct, and the demo data has a `manager_id` that is `NULL`
for some rows and a real id for others so you can see both.

## What's in here

| File | Role |
| --- | --- |
| `pg-core.js` | The whole protocol: byte/crypto helpers, framing reader/writer, SCRAM + MD5 auth, type decoding, the `PgClient` state machine, and an in-memory `PgServer` that speaks the same protocol. No dependencies, runs in Node and the browser. |
| `cli.js` | A command-line client: `--demo` (in-process mock) or a real TCP connection. `--trace` prints the handshake. |
| `index.html` / `style.css` / `script.js` | The browser UI: connection form, query editor, typed result grid, and the live protocol trace. |
| `tests.js` | 92 checks — crypto vectors, framing, SCRAM vs. the RFC, full handshakes for every auth method, and the mini-SQL. |

## Honest scope

- The **protocol** is complete enough to log in and run the *simple query*
  protocol against a real PostgreSQL server (it's the same `PgClient` either
  way). The extended/prepared-statement protocol, `COPY`, binary result formats,
  and TLS negotiation are out of scope for one day — the CLI connects in
  cleartext over TCP, so point it only at servers where that's acceptable
  (a trusted network, a tunnel, or a demo).
- **SASLprep** (RFC 4013) password normalization is reduced to the common
  ASCII case; full stringprep tables aren't bundled.
- The in-page/mock **server's SQL engine is deliberately small** (`SELECT` with
  `WHERE`/`AND`/`IS NULL`, `ORDER BY`, `LIMIT`, `count(*)`, a few scalar
  functions). Yesterday's project was the full SQL engine; today the *protocol*
  is the point, so the engine is just enough to make the wire interesting.
- **Credentials** come from the environment (`PGPASSWORD`), never a command-line
  flag (flags leak into `ps` and shell history), and nothing is stored.
