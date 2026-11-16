# CAPTCHA Maker

> Source 2 (karan/Projects) · **Web** · project 9 of 9
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"CAPTCHA Maker — takes a bunch of text and
creates an image used for verification purposes."*

A self-contained, image-based CAPTCHA: it generates a random code, draws it onto
a `<canvas>` with tilt, colour, speckle and distractor lines, and verifies what
the user types back. No server and no build step — open `index.html`. The engine
that actually matters runs in Node too, under `node tests.js`.

## Try it

Open `index.html`. A distorted code appears; type it (case and spaces don't
matter) and press **Verify**. Get it wrong and watch the attempt counter drop;
exhaust it and the challenge is *burned* — even the right answer won't save it.
The sliders change length, distortion, noise and time-to-live, re-issuing a fresh
challenge each time. Run the logic tests with `node tests.js` (67 checks, no
dependencies).

A CAPTCHA *looks* like "draw some wobbly letters and compare strings." It isn't.
Three things about it are genuinely hard, and the whole project is built around
getting all three right — in `captcha-core.js`, where they can be tested without
a browser.

## Trap 1 — it must be hard for bots *and* easy for humans, and those fight

Make the code harder to read and you punish humans before bots. The usual own
goal is the **alphabet**: include both `O` and `0`, or `1` and `l` and `I`, and a
tired human can't tell which glyph they're looking at — so now you're forced to
"accept `O` for `0`" at verify time, which quietly hands bots a free pass too.

The fix is upstream: the generation alphabet
(`ABCDEFGHJKMNPQRSTUVWXYZ23456789`) **omits every confusable glyph** — no
`0 O 1 I L`. If an ambiguous character can never appear in a challenge, you never
have to accept an ambiguous answer. 31 symbols, ~4.95 bits each; a 6-character
code is ~29.7 bits of entropy, shown live in the UI. Normalization then only has
to do the *uncontroversial* things — fold case, strip whitespace — because those
are never the challenge. The tests pin the alphabet (asserting each confusable is
absent) and the entropy formula.

## Trap 2 — the answer must never reach the client, and a solved code must die

The textbook CAPTCHA bug is shipping the answer to the browser — in a hidden
field, a cookie, or JavaScript a bot just reads. `CaptchaStore` stands in for the
server: `issue()` returns an opaque **token** and the challenge *text to render*,
but the verifiable secret (the normalized answer, expiry, attempt budget) stays
in the store, keyed by that token. The page holds only the token and *asks* the
store to verify — exactly as a real client asks a server. The headless smoke test
confirms the answer appears nowhere in the DOM.

Verification is then careful about three things the naïve `answer === guess` gets
wrong:

- **Single-use.** A correct guess *deletes* the challenge, so a captured token
  can't be replayed to wave through a second request.
- **Expiry.** Every challenge carries a TTL; past it, even the correct answer is
  rejected and the token is burned. The boundary is tested exactly (valid *at*
  the expiry instant, invalid one millisecond later).
- **Constant-time compare.** `constantTimeEqual` runs over the full length and
  never short-circuits, so a timing attacker learns neither the answer's length
  nor how many leading characters matched.

## Trap 3 — a short code with unlimited guesses is no CAPTCHA at all

~30 bits sounds safe until you realise a bot can just *keep guessing the same
token*. A six-character code falls in minutes to an unbounded loop. So every
challenge has an **attempt budget**: each wrong guess decrements it (the UI shows
the count), and the moment it hits zero the token is burned from the store — not
merely flagged. After that the token is `unknown`, and crucially **even the
correct answer is refused**, forcing a brand-new challenge. The tests walk the
budget down, confirm the lockout, and confirm a burned token rejects the right
answer.

Expiry and single-use reinforce this: a bot can't stockpile tokens (they age out,
and `sweep()` reaps them) and can't reuse a solved one.

## Files

| File | What's in it |
| --- | --- |
| `captcha-core.js` | The engine: the confusable-free `ALPHABET`, a CSPRNG-backed `randomText`/`randomToken` (with a seeded rng for tests), `normalize`, `constantTimeEqual`, the `CaptchaStore` (issue / verify / expiry / attempt budget / sweep), and pure `buildGlyphs`/`buildNoise` geometry. Zero dependencies; runs in Node and the browser. |
| `tests.js` | 67 Node checks covering all three traps. `node tests.js`. |
| `index.html` / `style.css` / `script.js` | The browser UI. `script.js` only draws the canvas from the engine's geometry and shows results — it never knows the answer, it holds a token and asks the store. |

## About this project

This is one entry in an automated series: a scheduled Claude Code routine builds
one project per day from a public "list of projects" repository, working from the
easiest level up. See the [repository README](../../../README.md) and
[`PROGRESS.md`](../../../PROGRESS.md) for the full story.
