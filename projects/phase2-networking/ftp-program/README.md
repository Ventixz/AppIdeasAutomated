# FTP Program

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**first entry of its Networking category**, and the first project of a new
category after the [Text category](../../phase2-text/) was finished.

> "FTP Program — Create a program that can transfer files to and from a remote
> computer using the FTP protocol."

Open `index.html` in a browser to watch a full FTP session happen in front of
you. **No build step, no dependencies, and no real network** — a faithful FTP
client and server are wired together entirely in memory.

## What it does

The browser page runs a real FTP **client** talking to a real FTP **server**,
both implemented from scratch against [RFC 959](https://www.rfc-editor.org/rfc/rfc959).
You get a file browser over the server's filesystem — navigate directories,
download a file, upload one, make folders, delete things — and beside it a
**live transcript of the control channel**: every command the client sends and
every 3-digit reply the server answers with, colour-coded by reply class, with
the data-channel transfers called out as they open and close.

The same client and server cores also run over **real 127.0.0.1 TCP sockets**
under Node (see the tests), so none of this is a toy that only talks to itself.

## The honest part: FTP is two channels, not one

The thing that makes FTP FTP — and the thing a naive "transfer a file"
implementation gets wrong — is that it does **not** send file data down the same
connection as the commands. There are two:

- a **control connection** that stays open for the whole session, carrying
  text commands (`USER`, `PASS`, `CWD`, `RETR`, …) and 3-digit reply codes; and
- a **data connection** that is opened *fresh for every single transfer* — each
  `LIST`, `RETR` and `STOR` gets its own throwaway connection — and closed when
  the transfer ends.

That split drives everything else, and each piece is modelled honestly in
[`ftp-core.js`](./ftp-core.js):

### 1. The "reply, transfer, reply" dance

A transfer command doesn't get one reply — it gets two, *with the data in
between*. `RETR readme.txt` produces, on the control channel:

```
> RETR readme.txt
< 150 Opening ASCII mode data connection for readme.txt   ← preliminary
   …the file streams over the data connection…
< 226 Transfer complete                                    ← completion
```

A client that reads only one reply, or reads the completion before draining the
data, deadlocks or truncates. The client here opens the data connection, issues
the command, reads the `150`, drains the data channel to EOF, *then* reads the
`226` — in that order.

### 2. Passive mode: the server picks a port and spells it out in bytes

Browsers (and firewalls) can't accept incoming connections, so real FTP uses
**passive mode**: the client says `PASV`, the server opens a listening port and
tells the client where to dial it — encoded as six numbers in a `227` reply:

```
< 227 Entering Passive Mode (127,0,0,1,195,80)
```

The first four are the IPv4 address; the last two are the port, **high byte
first**: `195 × 256 + 80 = 49920`. `parsePasvReply` / `formatPasvReply`
(and their active-mode twins `parsePortCommand` / `formatPortCommand`) do that
encoding, and they round-trip across the full port range in the tests. In the
browser the "port" is an in-memory counter; over real TCP it's a genuine
ephemeral socket the client connects to — same code path either way.

### 3. Multi-line replies have a specific terminator

A reply can span many lines. It opens with `NNN-` and continues until a line
that begins with *the same code followed by a space*:

```
230-Welcome, user.
230-Disk quota: 2GB
230 Logged in.          ← the space, not the dash, ends it
```

The streaming `ReplyParser` assembles these correctly even when a middle line
happens to look like `NNN-` itself, and even when a reply is split across
several wire chunks.

### 4. Paths can't escape the root

The server's `MemoryFileSystem` normalises every path — `.`, `..`, `//` and
trailing slashes — and `..` can never climb above `/`, so `CWD ../../etc` lands
at `/etc` inside the sandbox, not on your actual disk. (There is no actual disk:
the filesystem is a plain in-memory object tree.)

## The pieces

| File | What's in it |
| --- | --- |
| `ftp-core.js` | The whole protocol, transport-agnostic and DOM-free: the `ReplyParser`, the PASV/PORT codecs, the `FtpClient` state machine, the `FtpServerSession` command handler, the `MemoryFileSystem`, and an in-memory "wire" (`channelPair` / `MemoryFtpServer`) that links client and server with no socket. |
| `ftp-node.js` | A thin wrapper binding the same cores to **real** `net` TCP sockets on 127.0.0.1 — a `startServer` and a `connectClient`. Loopback only. |
| `index.html` | The single-page visualizer. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — drives the client from the UI through a strict one-command-at-a-time queue, and renders the file browser from what `LIST` actually returned (not by peeking at the filesystem behind the protocol's back). |
| `tests.js` | 39 dependency-free checks, run under Node. |

## Running the tests

```bash
node projects/phase2-networking/ftp-program/tests.js
```

**39 checks**, in three layers:

1. **Pure protocol units** — single- and multi-line reply parsing (including
   split chunks, bare `\n`, and a middle line that looks like a terminator but
   isn't), the PASV/PORT byte encoding round-tripping across the port range and
   rejecting out-of-range bytes, and the `MemoryFileSystem` with its path-safety
   guards (`..` can't escape root, no overwriting a directory as a file, no
   removing a non-empty directory).
2. **A full session over the in-memory wire** — greeting, anonymous and
   password logins (and a rejected one), navigation (`PWD`/`CWD`/`CDUP`), `LIST`,
   `NLST`, `RETR`, a `STOR`→`RETR` round-trip over Unicode content, `SIZE`,
   `DELE`, `MKD`, an unknown command surviving as `502`, and two sequential
   transfers reusing one control connection.
3. **Real-socket loopback integration** — the identical client and server cores
   over genuine 127.0.0.1 TCP: greeting, login, `LIST`, `RETR`, a `STOR`→`RETR`
   round-trip and `QUIT`, plus a check that the server advertises a passive port
   a real socket can actually dial.

## A note on scope

Real FTP over the open internet needs raw TCP to arbitrary hosts — something a
browser can't do and a sandbox shouldn't. So the value here isn't a socket
wrapper; it's a **correct protocol engine**: the two-channel design, the
reply-transfer-reply ordering, passive-mode address encoding, multi-line
replies and path safety, all written honestly and pinned down by tests — and
proven to work unchanged over a real TCP connection, not just an in-memory one.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
