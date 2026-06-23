# Lorem Ipsum Generator

Produce placeholder text on demand. Choose how much you want — paragraphs,
sentences, or words — and the generator stitches together latin-ish filler,
ready to drop into a mockup or layout. One click copies it to the clipboard.

Source idea: [app-ideas / Lorem Ipsum Generator App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Lorem-Ipsum-App.md)

## Features

- **Pick the unit** — generate a number of **paragraphs**, **sentences**, or
  **words**.
- **Classic opener** — optionally start the text with the traditional
  “Lorem ipsum dolor sit amet…”.
- **Copy to clipboard** — one button copies the generated text; falls back to
  selecting it when the Clipboard API isn't available.
- **Word count** — a running tally of how many words were produced.

## How it works

Sentences are assembled from a small word bank, each 6–14 words long with an
occasional comma spliced in so the output doesn't read mechanically.
Paragraphs bundle 3–6 of those sentences. Everything is capitalized and
punctuated as it's built. The classic opener is stored separately and prepended
verbatim when the toggle is on. Output is rendered as real `<p>` elements via
`replaceChildren`, and the copy button reads their text back out joined with
blank lines.

## Run it

Open `index.html` in any browser — no build step or dependencies. A first batch
is generated automatically on load.
