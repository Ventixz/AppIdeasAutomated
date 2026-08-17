# Calorie Counter

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Calorie Counter spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Calorie-Counter-App.md).

Search a database of common foods and see each item's portion size and calorie
count. Type a food description, press **Search**, and browse the ranked matches
in a scrollable panel. Results are capped at 25 rows with a **Load more** button
for the rest, the match count is shown, and **wildcards** (`*` and `?`) are
supported. Switch between light and dark themes; the choice is remembered.

## Architecture — logic vs. presentation

As with the other advanced projects here, every rule lives in a
**presentation-free engine** (`calorie-core.js`). It knows nothing about the
DOM, clicks, or how food data is loaded — only how to turn a food list plus a
query string into ranked, paginated matches. That means the exact same code runs
in the browser and in the Node test suite.

```js
const C = require('./calorie-core.js');
const foods = require('./foods.json');

// Search returns the parsed terms and the ranked matches:
const { terms, matches } = C.search(foods, 'apple');   // throws EMPTY_QUERY if blank

// Progressive display — first 25, then grow the limit on "load more":
C.paginate(matches, C.PAGE_SIZE);   // -> { rows, shown, total, hasMore }
```

### Matching rules

- **Multi-term queries are AND** — `green apple` matches only foods whose
  description contains both words.
- **Plain terms are substring matches** — `apple` also matches *Pineapple*.
- **Wildcard terms are anchored to whole words** — `*` means "any run of
  characters", `?` means "exactly one character". So `app*` matches the word
  *apple* but **not** *pineapple*, `*nut` matches *peanut*, and `b?n` matches
  *ban* but not *bn*.
- **Ranking** favours descriptions that start with the whole query, then those
  with a word starting with the first term, then everything else — alphabetical
  within each tier.

## The data (`foods.json`)

`foods.json` is the canonical dataset — 135 common foods, each with a
`description`, a `portion`, and a `calories` count, in the spirit of the USDA
food data the spec points at. The calorie figures are approximate and for
demonstration only.

Because a page opened directly from the file system (`file://`) can't `fetch()`
a local JSON file, `foods-data.js` is a **build-time mirror** of `foods.json`
(it just assigns the same array to `window.FOODS`). Regenerate it after editing
the data:

```bash
node -e 'const fs=require("fs");const f=JSON.parse(fs.readFileSync("foods.json","utf8"));fs.writeFileSync("foods-data.js","window.FOODS = "+JSON.stringify(f,null,2)+";\n")'
```

The test suite validates `foods.json` directly, so drift or a malformed record
fails the build rather than silently showing wrong numbers.

## The browser app (`index.html`)

- A single search box with **Search** and **Clear** buttons.
- A warning banner appears when you search with an empty box, or when nothing
  matches.
- Matching terms are highlighted in each result.
- The results panel scrolls and shows at most 25 rows; **Load more** reveals the
  next 25.
- The match count is shown above the list.
- A theme toggle (persisted in `localStorage`) switches light/dark.

Open `index.html` in any browser — no build step or server required.

## Tests

```bash
node tests.js
```

42 assertions covering normalization, tokenizing, wildcard-to-regex conversion,
term matching, AND semantics, ranking order, empty/no-match handling,
pagination and `hasMore`, and dataset integrity (size, no duplicate
descriptions, valid calories).

## Which app-ideas user stories are covered

- [x] Food items loaded at app startup from a JSON file
- [x] Input box, **Search** button and **Clear** button
- [x] Warning when no search term is entered
- [x] Warning when no matches are found
- [x] Results show description, portion and calories in a scrollable panel,
      capped at 25 entries
- [x] **Clear** resets the search box and results
- [x] *Bonus:* count of matching items shown near the results
- [x] *Bonus:* wildcard characters (`*`, `?`) supported in searches
- [x] *Bonus:* a **Load more** control reveals entries beyond the first 25
