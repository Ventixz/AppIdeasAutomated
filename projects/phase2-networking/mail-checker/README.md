# Mail Checker (POP3 / IMAP)

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**fourth entry of its Networking category**, after the
[FTP Program](../ftp-program/), the [Bandwidth Monitor](../bandwidth-monitor/)
and the [Port Scanner](../port-scanner/).

> "Mail Checker — write a program that will take a username and password and
> check POP3 / IMAP mail."

Open `index.html` in a browser for a live checker against a simulated mail
server: pick **POP3** or **IMAP**, choose a mailbox, hit **Check mail**, and
watch the real protocol exchange scroll past in the **session log** — dot-stuffed
POP3 multi-lines and byte-counted IMAP `{literal}`s and all. No build step, no
dependencies. The same engine drives **real TCP/TLS sockets** under Node (see
`mailcheck-node.js` and the tests).

## What it does

The task's one sentence — "check POP3 / IMAP mail" — hides the real lesson:
**POP3 and IMAP answer "do I have new mail?" in fundamentally different ways,**
and a good checker has to be honest about that.

| | POP3 | IMAP |
| --- | --- | --- |
| **Model** | download-and-forget spool | messages stay on the server, in folders |
| **Read/unread?** | **no such concept** | per-message flags (`\Seen`, `\Recent`, …) |
| **"How much mail?"** | `STAT` → count + total size | `STATUS` → `MESSAGES` |
| **"How much *new* mail?"** | **can't tell you** | `STATUS` → `UNSEEN` / `RECENT` |

So the engine normalises both into one `MailboxStatus`, but it never *pretends*:
a POP3 check returns `unseen: null` — **unknown**, not a dishonest `0` — because
POP3 genuinely cannot know. IMAP returns real `unseen` and `recent` counts, and
asks for them with `STATUS`, which (unlike `SELECT`) doesn't open the mailbox and
so doesn't disturb the `\Recent` flags.

## The honest part: two protocols, two framing tricks

The reason a "just read the lines" mail client breaks on real mail is that
neither protocol is purely line-based once a message body is involved. Each has
its own trick for framing data that might itself contain newlines — and the
engine implements both, because the tests feed it exactly the inputs that expose
a parser that skipped them.

### POP3: dot-stuffing

A POP3 multi-line response (the body after `LIST`, `TOP`, `RETR`) ends with a
line containing a single `.`. But what if a message body has its *own* line that
starts with `.`? The server prepends an extra dot (`.` → `..`), and the client
must strip exactly one back off — [`unstuffDot`](./mailcheck-core.js). Miss this
and any message with a line beginning `.` is silently corrupted; if that line
was just `.`, the whole response is truncated early. A test ships a message whose
subject is literally `. leading dot test` and asserts it survives the round trip.

### IMAP: byte-counted {literals}

IMAP frames arbitrary data with a **literal**: the server writes `{114}` at the
end of a line, meaning "the next 114 bytes are data — don't try to read them as
lines." Those bytes can contain CRLFs, parentheses, quotes, anything. A client
that keeps calling `readLine()` here will mis-parse the moment a header value
contains a `)`. So the engine's [`readImapFetch`](./mailcheck-core.js) reads the
literal with **`readExact(n)`** — honouring the byte count — then resumes line
reading. The channel ([`makeChannel`](./mailcheck-core.js)) serves line reads and
exact-byte reads off one buffer precisely so this works, even when the `{114}`
and its bytes arrive in separate TCP chunks (a test splits them deliberately).

## The other honest part: credentials are wire data

Usernames and passwords go onto a newline-delimited connection, so an unescaped
newline in a credential **injects a second command**. The engine refuses to let
that happen:

- **POP3** has no quoting at all, so [`assertNoControl`](./mailcheck-core.js)
  rejects any credential containing CR, LF or NUL outright. (A test tries
  `alice\r\nDELE 1` and asserts it throws.)
- **IMAP** has quoted strings, so [`imapQuote`](./mailcheck-core.js) wraps the
  value and backslash-escapes `"` and `\` — the demo's IMAP mailbox uses the
  password `p@ss "word"` on purpose, to prove a space-and-quote password is sent
  (and parsed back) correctly — while still refusing CR/LF, which a quoted string
  can't carry.

And passwords are never logged. The demo's session log shows the `LOGIN`
line because it's a local simulation you control; the Node CLI warns that a real
tool should take the password from the environment, not `argv`.

## Use TLS

Plaintext POP3 (110) and IMAP (143) send your password in the clear to anyone on
the network path. Real use means **implicit TLS** — POP3S on **995**, IMAPS on
**993** — which is why `mailcheck-node.js` speaks `tls` and its CLI defaults to
it (`--no-tls` is only for talking to a local plaintext mock). The loopback mock
servers are plaintext because there is no network to sniff.

## The pieces

| File | What's in it |
| --- | --- |
| `mailcheck-core.js` | The whole engine, DOM-free and transport-agnostic: the POP3 and IMAP clients, every parser (`parsePop3Status`, `parsePop3Stat`, `unstuffDot`, `parseImapCompletion`, `parseImapStatusItems`, `parseImapExists`, `parseImapFlags`, `parseHeaderLines`), the credential guards (`assertNoControl`, `imapQuote`), the line/byte channel, and the simulated POP3/IMAP servers that speak the real wire protocol. |
| `mailcheck-node.js` | Binds the same client — and the same servers — to **real** TCP/TLS sockets via Node's `net`/`tls`. Includes a loopback mock-server launcher (for the tests) and a CLI. |
| `index.html` | The single-page checker demo. |
| `style.css` | Dark theme, matching the routine's house style. |
| `script.js` | Browser glue — the protocol toggle, simulated mailboxes, the normalised summary, the message list, and the live session log. |
| `tests.js` | 31 dependency-free checks, run under Node. |

## Running it for real

```bash
# Check a POP3S account you own (implicit TLS on 995 by default):
node projects/phase2-networking/mail-checker/mailcheck-node.js pop3 mail.example.com you@example.com 'your-password'

# Check an IMAPS account, with a preview of the latest messages:
node projects/phase2-networking/mail-checker/mailcheck-node.js imap imap.example.com you@example.com 'your-password' --preview
```

> ⚠️ **Only check accounts you own or are authorised to access.** The password
> is passed on the command line here for convenience; a real tool should read it
> from the environment or a prompt (argv is visible in `ps`). The tests only
> ever talk to **loopback** mock servers.

## Running the tests

```bash
node projects/phase2-networking/mail-checker/tests.js
```

**31 checks**, in five layers:

1. **Pure parsers** — POP3 `+OK`/`-ERR` and `STAT`, dot-unstuffing, IMAP tagged
   completions, `STATUS` item lists, `EXISTS`, `FLAGS`, the argument tokenizer,
   and RFC 822 header parsing with folded continuation lines.
2. **Credential safety** — CR/LF/NUL in a credential is refused; IMAP quoting
   wraps and escapes `"`/`\` and still refuses CR/LF.
3. **In-memory end-to-end** — the real client against the real (simulated) POP3
   and IMAP server loops: correct counts, the POP3-can't-know-unseen contract,
   IMAP unseen/recent, auth failures (→ `AuthError`), an empty mailbox, and the
   dot-stuffed / `{literal}` multi-line preview paths (including a subject that
   begins with `.`).
4. **The channel** — line reads and exact-byte reads interleave across chunk
   boundaries, and a reader past end-of-stream resolves `null`.
5. **Real TCP sockets** — start loopback mock servers and check them over actual
   `net` connections: POP3 counts, IMAP `STATUS`, an IMAP `{literal}` FETCH, and
   a wrong password — all over real sockets, proving the same engine works
   unchanged on the wire, not just against an in-memory pipe.

## A note on scope

A web page can't open an arbitrary TCP socket, so the demo talks to a
**simulated** server running in the same page — but one that speaks the genuine
line protocol. The value here isn't the simulation; it's a **correct mail-check
engine**: the honest POP3-vs-IMAP normalisation, dot-stuffing, byte-counted
literals, credential-injection guards and TLS-by-default, all pinned down by
tests and proven to run unchanged against real kernel sockets. The simulated
servers implement a practical slice of each protocol (`USER`/`PASS`/`STAT`/
`LIST`/`UIDL`/`TOP` for POP3; `LOGIN`/`STATUS`/`SELECT`/`FETCH`/`LOGOUT` for
IMAP) — enough to check mail honestly, not a full server. A production IMAP
client also needs a complete parser for `ENVELOPE` and `BODYSTRUCTURE`
S-expressions, `AUTHENTICATE` (SASL), `IDLE` for push, and `UID` commands; those
are deliberately out of scope for a one-day "check my mail" build.

---

Built automatically by the daily [Claude Code](https://claude.com/claude-code)
routine described in the [repository README](../../../README.md).
