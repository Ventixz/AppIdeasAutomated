# Regular Expression Helper

Learn and test regular expressions in the browser. Type a pattern, toggle the
flags you want, pick a `RegExp` function, paste in some text, and press **Run** —
every match is highlighted in place and listed with its index.

A regular expression is *"a concise way to describe a pattern that can be used to
test, search, match, replace, or split"* the contents of a string. This app is
both a teaching aid and a quick scratchpad for checking a pattern before you drop
it into real code.

Source idea: [app-ideas / Regular Expression Helper](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/RegExp-Helper-App.md)

## Running

Open `index.html` in any browser — no build step, no dependencies, no network:

```bash
open projects/2-intermediate/regexp-helper/index.html
```

## How to use

1. Type a **regular expression** in the `/ … /` box (just the pattern — no
   slashes needed).
2. Tick any **flags** you want (`g`, `i`, `m`, `y`); the little flags box next to
   the pattern updates to show what's active.
3. Choose a **function** — `test()`, `search()`, or `match()`.
4. Paste your **test string** into the text area.
5. Press **Run**. You'll see:
   - a **summary** of what the chosen function returned (green on a hit, red on a
     miss),
   - your text with every match **highlighted**, and
   - a table of each match with its **index**.
6. **Clear** resets the whole form.

Missing the pattern or the test string shows a warning instead of running.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Input a regular expression | `#pattern` in `index.html` |
| Enter a string to test | `#text` textarea |
| Click a **Run** button | `#run` + `submit` handler in `script.js` |
| Warning if no expression | `RegexCore.validate()` → `showErrors()` |
| Warning if no string | `RegexCore.validate()` → `showErrors()` |
| Matching text highlighted | `renderHighlight()` in `script.js` |
| Notification when nothing matches | `res.summary` + red summary styling |

### Bonus features (all implemented)

| Bonus | Where it lives |
| --- | --- |
| Select regex flags (g / i / m / y) | flag checkboxes → `currentFlags()` |
| Choose the function (test / search / match) | `#fn` dropdown → `RegexCore.run()` |
| Message showing the function's result | `res.summary` for each function |
| Automated testing (Jest-compatible) | `tests.js` + `regex-core.js` |

## Design notes

- **Logic is separated from the DOM.** All the matching lives in
  [`regex-core.js`](./regex-core.js) as pure functions (`validate`, `run`,
  `collectMatches`). [`script.js`](./script.js) only reads the form and paints
  the result. That split is what makes the logic unit-testable.
- **Safe highlighting.** Matches are rendered by building text nodes and
  `<mark>` elements, never by string-concatenating HTML, so nothing in the
  user's input can be interpreted as markup.
- **Zero-width matches are handled.** Patterns like `` (empty) or `\b` can match
  without consuming characters; `collectMatches()` advances past them so it never
  loops forever, and empty matches are shown as a visible `∅` marker.

## Tests

`tests.js` covers validation, all three functions, flags, and the highlighter's
match collection. It runs two ways with **no dependencies**:

```bash
# standalone (built-in mini test runner)
node projects/2-intermediate/regexp-helper/tests.js

# or under Jest, unchanged, if you have it installed
npx jest projects/2-intermediate/regexp-helper/tests.js
```

```
All 15 tests passed.
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup for the two-panel layout |
| `style.css` | Styling, highlight + summary states |
| `regex-core.js` | Pure, testable regex logic (browser + Node) |
| `script.js` | Form wiring and result rendering |
| `tests.js` | Dependency-free, Jest-compatible test suite |
