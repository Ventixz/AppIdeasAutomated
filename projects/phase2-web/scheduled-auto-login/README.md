# Scheduled Auto Login and Action

> Source 2 (karan/Projects) · **Web** · project 5 of 9
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Scheduled Auto Login and Action — Create a
program that will automatically log in to a site on a specified schedule and
perform an action."*

The example targets the task suggests — "check in on a service," "get your
balance," "send yourself an email" — all point at the same shape of program: a
thing that wakes up on a schedule, authenticates, does one small job, and goes
back to sleep. The naïve version is ten lines (`setInterval`, send credentials,
do the thing). The real version is interesting because the ten-line version is
wrong in three specific, testable ways, and this project is built around those
three.

## A note on scope, up front

This builds the **scheduling-and-resilience engine**, and demonstrates it against
a **mock site** — there is no real third party anywhere in the code. That is
deliberate: the hard parts of this task are *when to run*, *how to survive a
service saying "no"*, and *how to keep secrets out of your logs*, none of which
need a real login to show. For a real service, the right client is its **official
API**, used with a token you are entitled to use and **within its terms of service
and rate limits** — you drop that in where the mock `site` is. Credentials come
from the **environment or a secret manager**, never from source or the command
line, and never reach a log (see §3). This engine is not, and should not be turned
into, a way to log in where you are not authorized to.

## Trap 1 — "every day at 09:00" is not "now + 24 hours"

The single most common scheduler bug is computing the next run as *now plus the
period*. It drifts (each run starts a little late, so the error accumulates), and
it breaks outright across a clock change: on the day the clocks spring forward,
the day is 23 hours long, so `+24h` fires at 08:00 or 10:00 instead of 09:00.

The correct answer is to recompute the **next wall-clock occurrence** of the
target time, every time:

```
nextRun({kind:'dailyAt', hour:9, minute:0}, now)  ->  the next 09:00 strictly after now
```

`nextRun` handles `interval` (on a deterministic grid anchored to a fixed point,
so a restart lands back on the same schedule instead of drifting by the restart
duration), `dailyAt`, and `weeklyAt`. It is **strictly after** the time you pass —
calling it with the moment a run just happened gives you the *following* run, not
the same one again (the off-by-one that double-fires schedulers).

> **The DST caveat, honestly.** The core works in a *fixed* UTC offset, which has
> no daylight-saving transitions, so "daily at 09:00" is exact and testable. A
> real time zone needs the IANA tz database, which a dependency-free core can't
> carry — but the *shape* of the fix (rebuild the wall-clock time on the next day,
> never add a flat 24h) is exactly what makes a real implementation correct too;
> only the offset lookup changes.

## Trap 2 — the site will say "no," and a tight retry loop makes it worse

Logins fail. Actions fail. Sessions expire while you weren't looking. The ten-line
version either crashes on the first failure or retries immediately in a tight
loop — which is how you get your IP blocked, and how a fleet of clients that all
failed at the same instant synchronise into a spike that knocks the service over.

The engine answers this with two pieces:

- **A session state machine.** A session is `{loggedInAtMs, ttlMs}`, and whether
  you're logged in is a *function of the current time*, not a flag you set at
  startup. Before every action the engine checks `sessionActive(session, now)` and
  re-authenticates if it has expired. A mid-action `expired` signal from the
  server is treated as normal lifecycle (drop the session, log in again), **not**
  as a failure to back off on.
- **Exponential backoff with jitter.** After each *failure* the wait grows
  (`base · factor^(n-1)`), capped at a maximum, and is **jittered** so retries
  don't line up. `full` jitter picks a random wait in `[0, delay]`; `equal` picks
  `[delay/2, delay]`. A hard credential **rejection** is distinguished from a
  transient failure — retrying bad credentials never helps, so the engine gives up
  immediately instead of backing off forever. There's a `maxAttempts` give-up
  limit for transient failures too.

The browser demo's §2 visualises the backoff curve (watch it cap, watch the jitter
band widen); §1 runs a whole simulated window and shows the state machine logging
in, expiring, re-authing, backing off and giving up — all on a seeded virtual
clock, so it's reproducible.

## Trap 3 — the config you log contains the password

A scheduler almost always grows a "print my config so I can see what's wrong"
line. The moment it does, the password, the API key and the session cookie are in
a log file, a terminal scrollback, a CI artifact — somewhere they outlive their
usefulness and their secrecy. `redactSecrets` walks a config object and masks any
field whose **name** looks secret (`password`, `apiKey`, `token`, `sessionId`, …),
showing just the first and last two characters so you can tell *which* secret it is
without exposing it. Logging the whole config becomes safe by default instead of
by remembering. Edit the config in the demo's §3 and watch the masks appear.

## The missed-run policy

If the scheduler process is down for a while, several fires are skipped. What then?
There's no universal answer, so `missedRunPolicy` makes it an explicit choice
rather than an accidental default:

- `skip` — ignore the gap, run the next future fire (right for "only useful now"
  actions like a presence check-in).
- `one` — run a single catch-up immediately, then resume (right for "has it been
  done today" actions).
- `all` — run every missed fire (right for actions that must not be dropped — but
  a day of downtime on a 5-minute schedule is 288 runs fired in a burst, which can
  look like an attack to the far end).

## The tests are anchored on checkable facts

`tests.js` (**68 checks**) pins the parts that are easy to get subtly wrong:
exact next-fire times **across a day boundary** and under a non-zero offset, the
**strictly-after** guarantee, the exponential backoff sequence (1000 → 2000 →
4000 → 8000 → capped) and the documented jitter bounds, the session state
machine's transition at the TTL boundary, each missed-run policy, redaction
(including that the original object isn't mutated and circular references don't
crash), and **three full scripted simulations** whose event logs are asserted
event-by-event: fail-then-succeed drives exactly the right backoffs; a hard
rejection gives up without a retry storm; a mid-action expiry triggers exactly one
re-auth and then succeeds.

## Files

| file | what it is |
| --- | --- |
| `scheduler-core.js` | the whole engine, no I/O — `nextRun` for interval/daily/weekly schedules, exponential backoff with jitter, the session state machine, the missed-run policy, `redactSecrets`, the mock sites, and a deterministic virtual-clock `simulate()`. Clock and RNG are always injected. Runs in Node and the browser. |
| `scheduler-node.js` | the real I/O layer — a `setTimeout`-driven `--live` loop against a mock site, an offline `--demo`, `--next` to print upcoming fire times, and `--config` showing credentials read from the environment and redacted. Zero dependencies. |
| `index.html` + `script.js` + `style.css` | a browser demo: the schedule simulator with a live event log, the backoff visualiser, and the credential-redaction panel. |
| `tests.js` | 68 dependency-free checks anchored on exact times, the backoff sequence, and full scripted simulations. |

## Run it

**The browser demo** — open `index.html`. In §1 pick a schedule, a session TTL and
a site reliability, and run the simulation; read the event log and the summary
tiles. Drag the §2 controls to see the backoff curve cap and the jitter band. Edit
the §3 config to watch secrets get masked.

**The CLI** (Node 18+, no dependencies):

```bash
node scheduler-node.js --demo                 # offline: a simulated day, instant
node scheduler-node.js --next --daily 09:00   # print the next few fire times
node scheduler-node.js --live --every 5s      # a real loop, fires every 5s (Ctrl-C)
node scheduler-node.js --config               # show credential sourcing + redaction

# credentials come from the environment, never argv:
SAL_USERNAME=alice SAL_PASSWORD=secret node scheduler-node.js --config
```

**The tests:**

```bash
node tests.js
#  ✓ all 68 checks passing
```

## What this demonstrates about the web

"Do a small thing on a schedule" is one of the most common real programs there is,
and it's a good lesson in how much of robustness is *timing and failure handling*
rather than the happy-path action itself. The action is one line; getting the
*when* right across clock changes, surviving a flaky and occasionally hostile
remote without turning into a retry storm, treating session expiry as expected
rather than exceptional, and never leaking the credentials that make any of it
possible — that's the program. And the responsible version starts by asking not
"how do I log in automatically" but "do I have an official, permitted way to do
this," then builds the boring, correct scheduling around *that*.

---

*Part of a daily automated [Claude Code](https://claude.com/claude-code)
routine that builds one project per day. See the repository
[`README.md`](../../../README.md) and [`PROGRESS.md`](../../../PROGRESS.md).*
