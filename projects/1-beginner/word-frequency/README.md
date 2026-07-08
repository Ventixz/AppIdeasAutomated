# Word Frequency

Paste in a block of text and see how often each word appears, ranked from most
to least frequent — a small building block behind search, sorting, and semantic
analysis.

Source idea: [app-ideas / Word Frequency](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Word-Frequency-App.md)

## Features

- **Text input** — type or paste up to 2048 characters, with a live character
  counter.
- **Translate** — one click tallies every word and builds the frequency table.
- **Sorted table** — each row is a word and its count, ordered by frequency
  (descending), with alphabetical tie-breaking for a stable order.
- **Summary line** — total words, unique words, and the single most frequent word.
- **Input validation** — an empty box (or text with no real words) shows a clear
  error instead of an empty table.
- **Bar chart** *(bonus)* — a column-style visualization of the top words, each
  bar scaled to the most frequent word.
- **Fetch from a URL** *(bonus)* — load a web page's visible text into the box
  via a CORS-friendly reader proxy, then analyze it like any other text.

## How it works

Text is lowercased and split on whitespace after stripping punctuation, so
`Don't` and `don't` count as the same word and trailing commas don't create
phantom entries:

```js
text.toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")   // keep letters, digits, ' and -
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))  // trim stray ' / -
    .filter(Boolean);
```

Counts accumulate in a `Map`, then the entries are sorted by count descending
(alphabetical on ties) to drive both the chart and the table.

## Run it

Open `index.html` in any browser — no build step, no dependencies.
