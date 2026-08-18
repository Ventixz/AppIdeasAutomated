# Chat App

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Chat App spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Chat-App.md).

A multi-user chat interface. Pick a username, then send messages that appear in
the chat box as **`Username: Message`**. Because a static page has no server,
this build makes **every open browser tab a connected user**: messages you send
appear in real time in every other tab, so you can genuinely watch two "users"
talk to each other.

Open `index.html` in one tab, then open it again in a second tab (or window),
pick a different username, and chat between them — no build step or server
required.

## Real-time with no server

The spec's headline bonus is *"real-time message visibility across all connected
users."* With nothing to run a WebSocket against, the app uses two browser
primitives instead:

- **`BroadcastChannel`** delivers each new message instantly to every other tab
  on the same origin (with a `storage`-event fallback for older browsers).
- **`localStorage`** is the persistent database — the whole message log survives
  a reload and a corrupt store recovers to empty instead of throwing.

A lightweight heartbeat in `localStorage` powers the **"N tabs connected"**
presence indicator, and opening the app posts a **join notification** to
everyone else — both spec bonuses.

## Architecture — logic vs. presentation

As with the other advanced projects here, all the rules live in a
**presentation-free engine** (`chat-core.js`). It knows nothing about the DOM,
`BroadcastChannel`, or `localStorage` — only how to validate usernames, parse
what a user types, and build immutable message records. The exact same code runs
in the browser and in the Node test suite.

```js
const C = require('./chat-core.js');

C.validateUsername('  John  ');          // -> 'John' (or throws a coded error)
C.parseCommand('/msg Bob hi there');      // -> { type: 'msg', to: 'Bob', text: 'hi there' }
C.parseTokens('nice :fire: see http://x/a.png @bob');
//   -> tokens: text, image, mention — emoji already expanded
C.formatLine(msg);                        // -> "John: Hello World!"
```

### What the engine handles

- **Usernames** — trimmed, length-capped, restricted to a safe character set so a
  name can never smuggle markup into the page.
- **Slash-commands** — `parseCommand` turns a line of input into an intent:
  `/nick`, `/join`, `/msg` (private message, with `"quoted names"`), `/me`,
  `/help`, or a plain chat message.
- **Rich content** — `parseTokens` splits a message into `text`, `link`, `image`
  and `mention` tokens. The browser renders each with `textContent`, so **user
  text is never interpreted as HTML**. Image URLs embed inline (a bonus story).
- **Emoji** — a self-contained shortcode table expands `:smile:`, `:fire:`, … and
  an emoji picker inserts them; unknown codes are left untouched.
- **Channels** — topic-based rooms à la Slack, with slugified names. A DM between
  two users gets one canonical thread key regardless of who sends first.

## The browser app (`index.html`)

- A **username gate** greets you on first visit and remembers your choice.
- A **channel sidebar** (create channels with ＋ or `/join`), plus a **direct
  messages** list that fills in as you DM people, with unread badges.
- A **composer** with an emoji picker; type `/help` any time for the commands.
- Your own messages sit on the right; links, images, `@mentions` and emoji all
  render inline.
- A **light/dark theme** toggle, persisted in `localStorage`.

## Tests

```bash
node tests.js
```

74 assertions covering username validation, channel slugging, the symmetric DM
key, emoji expansion, the token parser (text / link / image / mention, with
emoji expanded first and `@` inside URLs left alone), every command form and its
error cases, the message builders and `formatLine`'s `Username: Message` output,
and the conversation helpers (per-channel filtering with a stable sort, DM-thread
grouping, channels-in-use).

## Which app-ideas user stories are covered

- [x] User is prompted for a username on arrival, which is stored for later use
- [x] Input field to compose a new message
- [x] Enter or **Send** posts the message as `Username: Message` in the chat box
- [x] *Bonus:* messages visible in real time to all connected users (every tab)
- [x] *Bonus:* join notification when a new user connects
- [x] *Bonus:* messages persisted in a store (survive reload)
- [x] *Bonus:* rich media — links and images render inline
- [x] *Bonus:* emoji selection and sending
- [x] *Bonus:* private messaging between users (`/msg`)
- [x] *Bonus:* topic-based channels, Slack-style
