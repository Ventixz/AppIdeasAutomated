# Emoji Translator App

Type a sentence and turn the words it recognises into emoji — untranslatable
words, numbers, and punctuation are left exactly as you wrote them.

Source idea: [app-ideas / Emoji Translator App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Emoji-Translator-App.md)

## Running

Open `index.html` in any browser — no build, no dependencies:

```bash
open projects/2-intermediate/emoji-translator-app/index.html
```

## How to use

1. Pick an **input language** (English, Español, or Français).
2. Type some text — try `I love pizza and my dog when it is sunny`.
3. Click **Translate**. Known words become emoji; everything else is preserved.
4. Click **Clear** to reset the input and output.

Tip: press **Ctrl/Cmd + Enter** in the text box to translate without reaching
for the button.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Input strings with words, numbers, punctuation | `#input` textarea |
| **Translate** converts eligible words to emoji | `translate()` in `script.js` |
| Warning on empty or unchanged input | `onTranslate()` — empty check + `translatedCount === 0` |
| Output shows emoji while preserving other text | word-only regex replace keeps spacing/punctuation |
| **Clear** resets input and output | `onClear()` |
| **Bonus:** emoji synonyms | multiple words per emoji in `dictionary.js` (e.g. happy/glad/joy → 😊) |
| **Bonus:** language selection | `#language` dropdown, one dictionary per language |

## How it works

- **Dictionaries** in `dictionary.js` are written emoji-first — each emoji lists
  every word (synonym) that maps to it. `buildLookup()` flattens the chosen
  language into a fast, lower-cased `word → emoji` map.
- **Translation** runs a single regex replace over letter/number runs
  (`/[\p{L}\p{N}']+/gu`). Only whole words are matched, so `pizza!` becomes
  `🍕!` — the punctuation and all whitespace survive untouched.
- **Validation** distinguishes *empty* input from input where nothing was
  recognised: if `translatedCount` is 0 the app warns instead of echoing the
  text back unchanged.

## Files

| File | Purpose |
| --- | --- |
| `index.html`   | Language picker, text box, buttons, output area |
| `style.css`    | Dark, card-based responsive layout |
| `dictionary.js`| Per-language emoji dictionaries + `buildLookup()` |
| `script.js`    | UI wiring, translation, validation, Clear |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 44 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
