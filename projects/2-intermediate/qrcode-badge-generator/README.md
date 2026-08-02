# QRCode Badge Generator

Collect an attendee's details at an event and turn them into a printable name
badge with a **scannable QR code**. The QR code encodes a vCard, so pointing a
phone camera at the badge offers to save the person straight into Contacts.

Source idea: [app-ideas / QRCode Badge Generator](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/QRCode-Badge-App.md)

## Running

Open `index.html` in any browser — no build step, no network calls:

```bash
open projects/2-intermediate/qrcode-badge-generator/index.html
```

The QR encoding is done by the **[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)**
NPM package (the one the spec calls for), vendored here as `qrcode.js` +
`qrcode_UTF8.js` so the app stays dependency-free and offline.

## How to use

1. Enter a **Name** (first + last) and **Email** — both required. Twitter and
   GitHub are optional.
2. Press **Create badge**. A badge appears on the right with the attendee's
   details and a QR code.
3. Scan the QR code with a phone camera to verify — it should offer to add the
   contact.
4. Press **Print badge** to print just the badge (everything else is hidden on
   the printed page).
5. **Cancel** clears every field and the badge panel.

Edit any field and press **Create badge** again to update the badge.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Input panel with name, email, Twitter, GitHub + Cancel/Create | `index.html` `#badge-form` |
| Name & email required, socials optional | `validate()` in `script.js` |
| Cancel clears inputs **and** badge panel | `cancelBtn` click handler |
| Create generates a badge image | `renderBadge()` → `renderQR()` |
| "Required fields are empty" | `validate()` |
| First **and** last name required | `name.split(/\s+/).length < 2` |
| "Email input field isn't a properly formatted email address" | `EMAIL_RE` test |
| "Twitter account name doesn't start with '@'" | `validate()` |
| Badge shows attendee info + encoded QR code | `renderBadge()` + vCard in `buildVCard()` |
| **Bonus:** Print button below the badge | `#print` button |
| **Bonus:** Print enabled only after a valid badge shows | `printBtn.disabled` toggling |
| **Bonus:** edit fields and update the badge | re-submitting the form |
| **Bonus:** print-only badge layout | `@media print` in `style.css` |
| **Bonus:** "@" auto-prepends to Twitter handle | `twitter` `blur` handler |

## What the QR code contains

A [vCard 3.0](https://en.wikipedia.org/wiki/VCard) record — name (`FN`/`N`),
email, and, when supplied, Twitter and GitHub profile URLs. Error-correction
level **M** is used so the code still scans if the printed badge gets a little
scuffed.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Input panel + badge panel markup |
| `style.css` | Layout, badge styling, print rules |
| `script.js` | Validation, vCard build, QR render, print/cancel |
| `qrcode.js` | Vendored qrcode-generator package (MIT) |
| `qrcode_UTF8.js` | UTF-8 byte encoding for accented names (MIT) |
