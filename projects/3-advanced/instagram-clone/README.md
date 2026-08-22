# Instagram Clone

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Instagram Clone spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Instagram-Clone-App.md).

**Instagage** — a tiny Instagram. Register or log in, upload photos with
captions, follow other people, and watch a home feed of the accounts you follow.
There's a global **Explore** feed, a **People** directory, profile grids, likes,
and a light/dark theme.

Open `index.html` in a browser. No build step or server required. Click
**"Load a demo world to explore"** on the login screen to populate a few accounts
and photos instantly (you'll be logged in as **@ada**, password `demo123`).

## User stories from the spec

- ✅ **Register & log in.** Accounts store a name, email, username, and a
  **salted password digest** (never the plaintext). You can log in by username
  *or* email.
- ✅ **Create posts with images.** Pick or drag an image; it's stored with an
  optional caption. (See the note on image storage below.)
- ✅ **Profile of your uploads.** Every profile is a 3-column grid of that user's
  photos with post / follower / following counts.
- ✅ **Follow other users.** A real follow graph — follow/unfollow from Explore,
  People, or any profile.
- ✅ **See posts from people you follow.** The **Home** feed shows posts from the
  accounts you follow (plus your own), newest first.

### Bonus features

- ✅ **Global feed.** The **Explore** tab shows every post from everyone.
- ✅ **Likes.** Tap the heart to like/unlike; counts update live.
- The spec's other bonuses (WebSocket live-refresh, direct messages, stories)
  are out of scope for a single, serverless page — noted in the routine's log,
  not attempted here.

## How a full-stack spec becomes a serverless page

The spec asks for a MERN/MEAN-style app with a server that stores images in a
database. This repo allows **no build step and no server**, so the routine keeps
the *shape* of that architecture while collapsing it into one page:

| Spec (full-stack) | Here (serverless) |
| --- | --- |
| Express API routes | `createApp(store)` methods in `instagram-core.js` |
| MongoDB documents | an injectable **store** (`localStorage` in the browser) |
| Images in GridFS / S3 | images held as **data URLs** in the store |
| `bcrypt` password hashes | a **salted string digest** (shape only — see below) |
| Passport sessions | a single `currentUser` handle in the store |

Everything the client "asks the server" goes through the core's API, exactly the
way a MERN client would `fetch` HTTP routes.

> **⚠️ Security note.** The password hash here is a salted, non-cryptographic
> string digest — enough to demonstrate *storing a salted digest instead of a
> plaintext password*, but **not** a substitute for `bcrypt`/`argon2`. A real
> deployment must use a proper KDF on a real server. This is a learning clone,
> not an auth system.

## Architecture — engine vs. presentation

As with every other advanced project here, all the rules live in a
**presentation-free engine** (`instagram-core.js`). It knows nothing about the
DOM, file inputs, or `localStorage` — you hand it a *store* and call its API.

- **`instagram-core.js`** — the "backend": account validation + salted hashing,
  sessions, the post model, the follow graph, and the derived feeds. Driven
  through an injectable store, so the same code runs in the browser and in Node.
- **`index.html` + `style.css` + `script.js`** — the client. `script.js` turns a
  chosen file into a data URL, calls the core, and paints whatever it returns
  (feeds, profiles, the People list). All state persists through a
  `localStorage`-backed store, so a reload restores your session, posts, likes,
  and follows. User text is escaped before it ever touches `innerHTML`.
- **`tests.js`** — drives the *same* core over an in-memory store, so the Node
  suite and the browser exercise identical behaviour.

## Running the tests

```bash
node tests.js
```

The suite (56 assertions) covers field validation and its warning codes, salted
password hashing, registration + duplicate rejection, login by username/email,
post ownership (only the author can delete), the follow graph and derived
followers, the home feed (followed + self, newest first) vs. the global feed,
likes, "discover people" suggestions, and that all of it **persists across app
instances** through the store (a stand-in for a page reload).

---

*Built automatically by [Claude Code](https://claude.com/claude-code) as part of
the [AppIdeasAutomated](../../../README.md) daily routine.*
