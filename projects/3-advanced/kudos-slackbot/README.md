# Kudos Slackbot

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Kudos Slackbot spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Kudos-Slackbot.md).

**Kudos** lets a team recognize each other's effort — and, unlike a nice message
in a busy channel, the recognition doesn't scroll away after a few days. You give
a kudo with a slash command, and you can list, filter, reword, delete, and rank
them later.

Open `index.html` in a browser. No build step, no server, no network, and no
Slack account required — it's a **self-contained mock of a Slack channel** so you
can drive the whole `/kudo` command surface right on the page.

```bash
open projects/3-advanced/kudos-slackbot/index.html
```

## Commands from the spec

Type these in the composer (the leading `/kudo` is optional there), or click a
quick-command chip:

| Command | What it does | Spec item |
| --- | --- | --- |
| `/kudo add @user <message>` | Recognize a teammate | ✅ create |
| `/kudo replace <id> <message>` | Reword one of *your* kudos | ✅ modify |
| `/kudo delete <id>` | Remove one of *your* kudos | ✅ delete |
| `/kudo list [n \| *]` | The latest `n` kudos (default 5; `*` = all) | ✅ view recent |
| `/kudo user @user` | Every kudo a person has received | ✅ view for a person |
| `/kudo top [n]` | **Leaderboard** by kudos received, descending | ✅ bonus |
| `/kudo help` | Usage | — |

- ✅ **Create** — `add` attributes the kudo to whoever is *"posting as"* in the
  sidebar and returns the new kudo's id.
- ✅ **Modify / delete** — `replace` and `delete` are **author-scoped**: only the
  person who gave a kudo can change or remove it, exactly as you'd want in a
  channel others can read.
- ✅ **View recent** — `list` shows the newest kudos first, with `*` for the full
  history.
- ✅ **View for a person** — `user @grace` filters to one recipient.
- ✅ **Bonus leaderboard** — `top` ranks people by how many kudos they've
  received (ties break alphabetically so the order is stable).

Switch the **"posting as"** selector in the sidebar to act as a different
teammate — that's how you can see the author-only rules on `replace`/`delete`
kick in.

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** ([`kudos-core.js`](./kudos-core.js)). It never
touches the DOM, Slack, or the network:

- **`createStore({ seq, now })`** owns the kudos records and every mutation
  (`add`, `replace`, `remove`, `latest`, `forUser`, `leaderboard`). The id
  counter and clock are **injected**, so the store is fully deterministic.
- **`parseCommand(raw)`** turns a raw `/kudo …` string into a structured command
  (or a typed parse error) — recipient validation, count parsing (`n` / `*`),
  and unknown-subcommand handling all happen here, before anything is stored.
- **`handleCommand(store, raw, from)`** ties them together and returns a typed
  reply (`kudo` / `list` / `top` / `notice` / `error` / `help`) that the UI
  styles.

[`script.js`](./script.js) is a thin browser glue layer: it owns a live store,
wires the composer and the "posting as" selector to `handleCommand`, seeds a
small believable channel history *through the real command path*, and renders
each reply as a Slack-style message (with a tiny, fully-escaped `*bold*` /
`` `code` `` mrkdwn subset — no user text can inject markup).

## The core is pure and tested

Because the engine is DOM-free and deterministic, it ships a dependency-free
test suite:

```bash
node projects/3-advanced/kudos-slackbot/tests.js   # -> 88 passed, 0 failed
```

The tests cover user-id normalization (including Slack's `<@U…|label>` mention
encoding), command parsing and every parse error, the author-only rules on
`replace`/`delete`, newest-first ordering, the leaderboard's sort and tie-break,
and the end-to-end `handleCommand` flow including empty-state replies.

## Notes & trade-offs

- **Why a mock instead of a real Slack app?** A real bot needs a hosted
  endpoint, an OAuth token, and a signing secret — none of which fit a
  static, open-it-in-a-browser demo. Everything the spec asks for is *command
  behaviour*, and that behaviour lives entirely in the tested engine. Porting
  it to a real Slack app is a thin adapter: map an incoming slash-command
  payload to `handleCommand(store, text, user_id)` and post the reply's `text`
  back. The engine wouldn't change.
- **Persistence** is in-memory for the demo — refresh and the seeded channel
  comes back. A real deployment would swap the in-memory array in `createStore`
  for a database without touching the command logic.
