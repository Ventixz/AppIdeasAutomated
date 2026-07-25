# Image Scanner

Pull the **contact details** out of a photo — phone numbers, emails and website
links — and file them into a searchable, taggable history. The app-ideas spec
describes a native iOS/Android app backed by the Google Cloud Vision OCR API;
this is an honest **browser adaptation** that keeps the whole extraction
pipeline real while staying true to the routine's rules: vanilla JS, no build,
no dependencies, no API keys.

Source idea: [app-ideas / Image-Scanner](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Image-Scaner.md)

## Running

Open `index.html` in any browser — nothing to install:

```bash
open projects/2-intermediate/image-scanner/index.html
```

## How to use

1. **Add an image** — “Capture photo” opens the camera on mobile; “Import image”
   picks an existing file. A preview appears.
2. The app **reads the text**. Where your browser supports the experimental
   on-device `TextDetector`, this happens automatically. Everywhere else, a
   **paste box** opens — type or paste the text you can read and press
   **Extract contacts**. Either way the same extraction runs.
3. Detected **phones, emails and links** show up as cards. Tap **👤 Save** on any
   card to download it as a `.vcf` (vCard) you can add to your contacts.
4. Press **💾 Save scan** to file the result into **history**.
5. Search history by text, phone, email or **tag**. Add tags with **+ tag**,
   reopen a past scan with **↩ Reopen**, or delete individual scans.

## The OCR question (no dependencies allowed)

Real OCR of an arbitrary photo needs either a cloud API (the spec's Google Cloud
Vision) or a bundled model — both off-limits under the routine's no-dependency,
no-API-key rule. So OCR here is **progressive**:

- **`TextDetector`** — if the browser exposes the experimental Shape Detection
  API, the app reads text straight off the image on-device, no network.
- **Manual text layer** — otherwise the paste box carries the text in. This
  keeps the *real* deliverable — the extraction and organizing pipeline —
  fully functional and testable on every browser.

The regex extraction is identical regardless of where the text came from.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Capture a new photo **or** import an existing image | `captureInput` (`capture="environment"`) / `importInput` → `loadImage()` |
| Process the image to extract text | `runOcr()` (TextDetector) + manual text layer |
| Identify phone numbers, emails, URLs in card format | `extract()` + `renderResults()` |
| Save extracted details as contacts | `saveContact()` → downloadable vCard |
| Searchable history of previous scans | `history` in `localStorage`, `renderHistory()` + `matches()` |
| **Bonus:** tagging to organize results | `+ tag` / `× ` → `tags[]` per scan |
| **Bonus:** tag-based search | `matches()` searches tags alongside text and values |

Auth and cross-device sync (the remaining bonuses) require a backend and are out
of scope for a static, dependency-free page; the local history stands in for
per-device persistence.

## How the extraction works

- **Emails** — a standard `local@domain.tld` pattern.
- **URLs** — `http(s)://…` or `www.…`, trimmed of trailing punctuation.
- **Phones** — a loose digit-and-separator run, then **validated by digit count**
  (7–15 digits) and screened against **date-like shapes** (e.g. `2026-07-25`) so
  dates and order numbers don't masquerade as phone numbers.
- Results are **de-duplicated** case-insensitively per kind.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Capture/import controls, results cards, history UI |
| `style.css`  | Dark, card-based responsive styling |
| `script.js`  | OCR, regex extraction, vCard export, history + tagging |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 50 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
