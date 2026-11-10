# Get Atomic Time from an Internet Clock

> Source 2 (karan/Projects) · **Web** · project 3 of 9
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Get Atomic Time from Internet Clock — Create an
application that provides the exact time from an atomic clock on the internet.
(web)"*

Getting the exact time off the internet sounds like a one-liner: open a
connection to a time server, read the number it sends, set your clock. It isn't —
and the reason is the one thing that casual version ignores: **the number is
already stale by the time you read it.** The server's timestamp travelled back
to you across the network, and however long that took, your clock is now that
much behind. Worse, you don't know how long it took.

This project implements the protocol that an atomic clock on the internet
actually speaks — **NTP** (the Network Time Protocol, RFC 5905, and its
stateless subset SNTP) — and the heart of it is not the socket. It's the
arithmetic that measures the network delay and cancels it.

## The bug the naive version has

The first "get the time" everybody writes trusts the server's clock directly:

```js
const now = readServerTimestamp();   // whatever the server said "now" is
setClock(now);                        // …but that was true a round-trip ago
```

Open the demo and drag **"Network delay, reply back"** up to 90 ms. The
server's transmit timestamp (`T3`) says `12:00:00.105`, you believe it — and you
are now **90 ms behind**, because that stamp spent 90 ms crossing the network to
reach you. An HTTP `Date:` header has the same disease *and* is rounded to the
whole second. For "exact time," neither is acceptable.

## The fix is four timestamps, not one

NTP's insight is to record **four** instants around a single request/reply, not
one:

| | |
| --- | --- |
| **T1** | client transmit — your clock, when you send the request |
| **T2** | server receive — the server's clock, when it arrives |
| **T3** | server transmit — the server's clock, when it replies |
| **T4** | client destination — your clock, when the reply lands |

T1 and T4 are read from *your* clock; T2 and T3 from the server's. From those
four numbers, two quantities fall out (`ntp-core.js`, straight from RFC 5905 §8):

```
clock offset   θ = ((T2 − T1) + (T3 − T4)) / 2
round-trip delay δ = (T4 − T1) − (T3 − T2)
```

The algebra is the whole trick. `(T2 − T1)` is *outbound travel + offset*;
`(T3 − T4)` is *offset − return travel*. Average them and — **if the two travel
times are equal** — the travel cancels and you're left with the pure offset,
even though your own clock was used to measure T1 and T4 and your clock is
*wrong*. The corrected time is then simply `T4 + θ`. The demo shows this hitting
**exact** on a symmetric path while the naive "trust T3" answer stays wrong by
the return-trip time.

The one thing NTP cannot see is **path asymmetry**. Drag the out and back
sliders apart (untick "keep return trip = out trip") and the error reappears —
it's exactly *half* the asymmetry, because the formula splits the round trip
evenly. Symmetric routing is the assumption the entire protocol rests on, and
the demo makes that assumption visible.

## The other hard part: NTP's clock format

The second thing that trips people up is that NTP does **not** count from 1970.
Its 64-bit timestamp is **32 bits of seconds since 1900-01-01** plus **32 bits
of fraction**, where the fraction is in units of 1/2³² of a second.
`ntp-core.js` converts both ways and handles the parts that bite:

- **The 1900 epoch** — Unix time is `ntpSeconds − 2208988800` (70 years, 17 of
  them leap years). Off-by-that is the classic NTP bug.
- **The 2³² fraction** — `0x80000000` is exactly half a second, not "a big
  number." Getting this wrong throws away all the sub-second precision that was
  the point.
- **The 2036 era rollover** — the 32-bit seconds field wraps on
  2036-02-07 06:28:16 UTC. A correct client resolves which 136-year *era* a
  value belongs to by picking the one nearest to now; the tests check a
  post-2036 timestamp converts correctly despite having wrapped.

## The tests are the protocol's own numbers

`tests.js` is anchored on checkable facts, not made-up cases: the epoch constant
derived from first principles, the RFC §8 offset/delay worked example to the
millisecond, the 2036 era rollover, and a full round-trip through
`buildRequestPacket` → `parseReplyPacket` → `solveExchange` so the 48-byte wire
layout and the arithmetic are verified together the way the client uses them. It
also checks the RFC §8 sanity gate — a reply with leap-indicator 3, the wrong
mode, stratum 0 (a "kiss-o'-death" packet) or a zero transmit timestamp must be
rejected, not trusted.

## Files

| file | what it is |
| --- | --- |
| `ntp-core.js` | the whole engine — the 1900-epoch 64-bit timestamp conversions (with era-rollover handling), build/parse of the 48-byte packet, and the offset/delay/corrected-time arithmetic. No sockets, no `Date.now()` baked into the math, no dependencies. |
| `ntp-node.js` | the real I/O layer — sends the request over **UDP port 123** with Node's built-in `dgram`, times T1 and T4, keeps the lowest-delay sample, and prints the offset, delay and corrected time. Zero dependencies. `--demo` solves a canned exchange with no network. |
| `index.html` + `script.js` + `style.css` | a browser demo: a slider-driven four-timestamp exchange you can watch, with the live offset/delay math and a side-by-side of **naive vs. NTP** accuracy, plus a decoder for real 48-byte reply bytes pasted as hex. |
| `tests.js` | dependency-free checks anchored on the RFC 5905 §8 example, the epoch math, the 2036 rollover, a full packet round-trip, and the reply sanity gate. |

## Run it

**The browser demo** — open `index.html`. Drag the sliders and watch the offset
get recovered exactly while the naive answer drifts. Untick *keep return trip =
out trip* to see what path asymmetry costs. Expand *Decode a real 48-byte NTP
packet* to parse actual reply bytes with the same core the server uses.

**The CLI** (Node, no dependencies):

```bash
# the arithmetic offline, no network needed:
node ntp-node.js --demo

# query a real internet time server:
node ntp-node.js time.cloudflare.com
node ntp-node.js --server time.google.com --samples 4

# machine-readable, and a hint for stepping the system clock:
node ntp-node.js pool.ntp.org --json
node ntp-node.js pool.ntp.org --set-hint
```

(NTP is UDP on port 123 and is frequently blocked on restricted or sandboxed
networks — the CLI says so and points you at `--demo`. The hard part, the
arithmetic, runs identically offline.)

**The tests:**

```bash
node tests.js
#  ✓ all 17 checks passing
```

## What this demonstrates about the web

"Reading the time off a server" is the easy, boring part — a few lines of
`dgram`. What makes the answer *exact* is refusing to trust that reading on its
own: measuring the round trip with four timestamps, cancelling the symmetric
delay so your own wrong clock drops out of the math, and getting NTP's peculiar
1900-epoch fixed-point timestamp right across a rollover that's a decade away.
Skip the four-timestamp dance — just believe the server — and every clock you
set is quietly late by however long the reply took to arrive.

---

*Part of a daily automated [Claude Code](https://claude.com/claude-code)
routine that builds one project per day. See the repository
[`README.md`](../../../README.md) and [`PROGRESS.md`](../../../PROGRESS.md).*
