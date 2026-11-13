# E-Card Generator

> Source 2 (karan/Projects) · **Web** · project 6 of 9
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"E-Card Generator — Make a site that allows
people to generate a digital postcard with a message and image."*

Design a postcard in the browser — pick an occasion, write a message, choose
colours and a font — then **send it as a link**. The whole card is encoded into
the URL fragment, so opening the link reconstructs the exact card the sender
made. Nothing is uploaded; there is no server.

That "send it as a link" requirement is what makes the project more than a form.
It forces a correct serialization codec, and that codec has a famous trap. The
project is built around three such traps.

## Try it

Open `index.html` in a browser. Edit the fields and watch the canvas update
live. Then:

- **Download PNG** — saves the rendered card as an image.
- **Copy share link** — copies a URL like `…/index.html#card=1eyJ…`. Open it in
  a new tab (or send it to someone) and the card comes back exactly.
- **Copy message** — just the text, for pasting into a chat.

Run the tests with `node tests.js` (62 checks, no dependencies).

## Trap 1 — you cannot `btoa` an emoji

The obvious way to pack a card into a URL is base64. The obvious way to base64
in a browser is `btoa`. But `btoa('🎂')` **throws** — it only accepts characters
in the Latin-1 range (0–255), and "🎂" is U+1F382. Even `btoa('é')` throws. So
every e-card with an emoji or an accent — i.e. most of them — breaks the naïve
approach immediately.

The fix is to go through UTF-8 first: turn the string into a byte array where
each character becomes its 1–4 UTF-8 bytes, *then* base64 those bytes. And since
the result goes in a URL, we use **base64url** (the `-`/`_` alphabet with no `=`
padding) so there is nothing to percent-escape. `ecard-core.js` implements both
the UTF-8 codec and the base64url codec by hand, so the round-trip is fully
deterministic and testable in Node:

```
encodeCard(card)  ->  "1eyJvY2Nhc2lvbiI6ImNvbmdyYXRzIiw…"   (version byte + base64url)
decodeCard(token) ->  the same card back, emoji and all
```

The token is **versioned** (a leading `1`) so the format can change later
without silently misreading old links, and `decodeCard` *throws* on anything
malformed rather than returning a half-parsed card — `parseShareUrl` catches that
and falls back to the default card, so a corrupted link never crashes the page.

The card also travels in the URL **fragment** (`#card=…`), which browsers never
send to a server. The message stays on the two machines that matter.

## Trap 2 — text has to fit the card

A message is free text, but the card is a fixed rectangle. `wrapText` does greedy
word wrapping: it packs words onto a line up to a width, respects explicit line
breaks, **hard-breaks** a single word too long to ever fit (a pasted URL, say),
and — when there are more lines than the card has room for — stops and ends the
last visible line with an **ellipsis** instead of spilling off the edge.

The core wraps by character count (pure, testable). The canvas renderer in
`script.js` then does a second pass that *measures* each line against the real
font and width, because a proportional font makes "WWWW" far wider than "iiii"
even though they are the same length — character count is a good first cut, pixel
measurement is the truth.

## Trap 3 — the message is user input

The live preview is drawn on a `<canvas>`, so text is painted as pixels and can't
execute. But the "Copy message" helper and any future HTML rendering need the
message escaped, so `escapeHtml` is in the core and covered by tests
(`<img onerror=…>` becomes inert text). Field lengths are also capped — by *code
point*, so truncation never splits an emoji into a broken half-character — which
keeps the token short and the layout predictable.

## Files

| File | What it is |
| --- | --- |
| `ecard-core.js` | Dependency-free core: UTF-8 + base64url codec, card (de)serialisation, share-URL build/parse, word wrap, HTML escape, validation. Runs in Node and the browser. |
| `tests.js` | 62 Node checks: codec round-trips (emoji, accents, CJK), bad-token rejection, wrapping (pack / hard-break / truncate), escaping, normalisation. |
| `index.html` | The editor + canvas preview + action buttons. |
| `style.css` | Responsive two-column layout, light & dark themes. |
| `script.js` | Glue: form ⇄ card, canvas rendering, download / copy, hydrate from a `#card=` link on load. |

## Design notes

- **No build step, no dependencies, no network.** Everything is static files.
- **The core is the product.** All the logic that could be wrong — encoding,
  wrapping, validation — lives in a module with no DOM, so it is unit-tested
  directly. `script.js` is deliberately thin.
- **Shareability is privacy-preserving by construction.** Because the card lives
  in the fragment, "share" is a copy-paste, not an upload. There is no account,
  no storage, and nothing leaves the browser.
