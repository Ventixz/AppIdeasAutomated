# Dynamic CSS Variables

A mock login form that changes its field colors by **rewriting CSS variables at
runtime** — the whole point of the exercise. The JavaScript never assigns a
color to an element; it only flips custom properties and lets the stylesheet
turn those into background, border, and size changes.

Source idea: [app-ideas / Dynamic CSS Variables](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Dynamic-CSSVar-app.md)

## Features

- **CSS-variable-driven states** — `--field-bg`, `--field-border`, and
  `--field-scale` are declared once in `:root`; validation just overrides them
  per field via `element.style.setProperty(...)`.
- **Login validation** — accepts `testuser` / `mypassword`.
- **Color feedback**
  - Field with spaces → **light yellow** background.
  - Wrong / empty user ID or password → **light red** background.
  - Everything correct → success message, fields stay white.
- **Cancel** — native form reset clears the inputs and repaints every field back
  to white.

## Bonus features implemented

- Field **border color** changes to match the error state.
- Field **scales up slightly** on error, so the feedback is felt as well as seen.

## How it works

The stylesheet wires each `<input>` to variables instead of fixed values:

```css
input {
  background: var(--field-bg);
  border: 2px solid var(--field-border);
  transform: scale(var(--field-scale));
}
```

`script.js` keeps a small `STATES` table (`ok` / `spaces` / `error`), and on
submit it evaluates each field — spaces beat value mismatches beat empties — then
writes the matching variables onto that input. Because the colors live in the
cascade, swapping a state is a single property write rather than a pile of
inline styles.

## Run it

Open `index.html` in any browser — no build step or dependencies.
