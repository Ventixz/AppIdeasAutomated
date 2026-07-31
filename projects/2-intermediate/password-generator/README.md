# Password Generator

Generate a strong, random password. Pick a length, choose which character
types to include, then generate and copy it to your clipboard — with a live
strength estimate.

Source idea: [app-ideas / Password Generator](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Password-Generator.md)

## Running

Open `index.html` in any browser — no build, no dependencies:

```bash
open projects/2-intermediate/password-generator/index.html
```

> Clipboard copy uses `navigator.clipboard`, which needs a secure context.
> Opening the file locally works in most browsers; if copy is blocked, serve
> it (`python3 -m http.server`) and open via `http://localhost`.

## How to use

1. Drag the **Length** slider (4–64 characters).
2. Tick the character types to **Include**: uppercase, lowercase, numbers,
   and/or symbols.
3. Click **Generate password**. A fresh password appears and the strength
   meter updates.
4. Click **Copy to clipboard** to copy it.

A password is generated automatically on load, so the app is useful right away.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Select the password length | `#length` range slider → `generate()` |
| Include uppercase / lowercase / numbers / symbols | four checkboxes → `selectedSets()` |
| **Generate password** button shows a password | `generate()` writes to `#output` |
| **Copy to clipboard** button | `copyToClipboard()` |
| **Bonus:** see the password strength | `updateStrength()` + strength meter |

## How it works

- **Secure randomness.** Characters are drawn with the Web Crypto API
  (`crypto.getRandomValues`), not `Math.random()`. `randomInt()` uses
  rejection sampling so every character in the pool is equally likely — no
  modulo bias.
- **Every selected type is guaranteed.** The generator first takes one
  character from each selected set, fills the rest from the combined pool,
  then runs a Fisher–Yates **shuffle** so the guaranteed characters aren't
  stuck at the front.
- **Strength = entropy.** Strength is estimated as
  `length × log₂(poolSize)` bits and bucketed into Weak / Fair / Good /
  Strong. A 16-character password with all four types is ~104 bits ("Strong").
- **Copy fallback.** If the async clipboard API is unavailable, it falls back
  to a hidden `<textarea>` + `execCommand('copy')`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Slider, checkboxes, output, strength meter, buttons |
| `style.css`  | Dark, card-based responsive layout + strength colours |
| `script.js`  | Secure generation, guaranteed types, strength, clipboard |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 56 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
