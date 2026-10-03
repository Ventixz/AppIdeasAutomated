# Inverted Index

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**only entry of its Data Structures category**, and the thirty-second Source 2
project overall. It follows the whole
[Graph category](../../phase2-graph/).

> "An inverted index is a data structure used to create full text search. Given
> a set of text files, implement a program to create an inverted index. Also
> create a user interface to do a search using that inverted index which returns
> a list of files that contain the query term / terms. The search index can be
> in memory."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

A plain ("forward") index maps each file to the words it holds. Searching that
means re-reading every file for every query. An **inverted index** turns it
inside out: for each **term** (a normalised word) it stores the **sorted list of
files that contain it** — the term's *postings list* — plus, per file, how often
the term occurs and at which positions. A query is then answered by merging a
few short sorted lists, not by scanning the corpus.

- **Edit the corpus live.** Each box is one "text file". Add, rename, remove, or
  retype any of them and the index rebuilds as you type. It ships with five
  sample files so there's something to search immediately.
- **A real query language.** Space-separated words are **AND** by default;
  `OR` unions; `-word` or `NOT word` excludes; `"quoted text"` is an exact
  **phrase** (adjacent, in order); and `( … )` groups. OR sits below the
  implicit AND, so `a b OR c d` reads as `(a AND b) OR (c AND d)`.
- **Ranked results.** Matches are ordered by **TF-IDF** — a file weighs more
  when it uses a query term often (sub-linearly) and that term is rare across the
  corpus. Each hit shows a relevance bar, a **keyword-in-context snippet** with
  the matched words highlighted, and the per-term counts.
- **See the index itself.** The whole `term → files` table is on the page,
  filterable, with document frequency and per-file term frequency. The terms
  your current query touches light up <span>amber</span>, so you can watch the
  structure the search is actually reading.
- **Two analysis switches.** *Remove stop words* drops ultra-common words
  (`the`, `and`, `of`…); *fold word endings* runs a conservative stemmer so
  `Cats`/`cat` and `running`/`run` collapse to one term. Both change which words
  count as equal — and the index rebuilds to match.
- **A live ✓ Verified line** re-checks every result against a brute-force scan
  (see below), so the proof travels with the answer.

## How the search works

Every postings list is kept **sorted by file id**, which is what makes an
inverted index fast:

- **AND** is a linear **intersection** of two sorted lists, **OR** a **union**,
  and **NOT** a **difference** against the list of all files — each a single
  pass, never a nested loop.
- A **phrase** first intersects the postings of its words (only files holding
  all of them can contain the phrase), then checks the stored **positions**: some
  occurrence of the first word at position *p* must be followed by the second at
  *p+1*, the third at *p+2*, and so on.
- The query runs through the **same analyzer** as the documents, so `Cats` in
  the box finds `cat` in the index, and a stop word typed into the query simply
  carries no constraint.

## Why the answer is trustworthy

An inverted index is only an *acceleration* of a question with an obvious slow
answer — "which files contain this?" — so every result is pinned to that slow
answer by **independent checks** in
[`inverted-index-core.js`](./inverted-index-core.js), exercised by
[`tests.js`](./tests.js):

- **Index merge ↔ brute-force scan.** Answering a query by merging postings
  (`evaluate`) must return **exactly** the files you get by testing the same
  parsed query against each document on its own, with no index at all
  (`scanMatch`). The two share no code path. A randomised fuzz loop throws
  thousands of random corpora and random boolean/phrase queries at both and
  demands they agree every time.
- **Postings invariants.** File ids strictly ascending and unique, each term
  frequency equal to the number of stored positions, positions ascending.
- **TF-IDF ↔ recomputed.** Scores are checked against the formula applied by
  hand to the raw term counts, and the ranking is confirmed to put the more
  relevant file first.

What is *proved* is that the index faithfully accelerates search over whatever
the analyzer produces. The stemmer and stop-word list are deliberately simple
linguistic **heuristics**; changing them changes which words are treated as
equal, but the index-vs-scan equivalence holds regardless, because both sides
run the identical analyzer.

## Run the tests

```bash
node projects/phase2-data-structures/inverted-index/tests.js
```

Hand-worked cases (tokenisation, stop words, the stemmer, postings, phrase
adjacency, boolean precedence, TF-IDF values) plus a **4,000-trial fuzz loop**
that tries to drive the index merge and the brute-force scan apart — and can't.

## Files

| File | What's in it |
| --- | --- |
| [`index.html`](./index.html) | The page: corpus editor, search box, results, and the live index table. |
| [`style.css`](./style.css) | The dark house-style theme. |
| [`inverted-index-core.js`](./inverted-index-core.js) | All the logic: the analyzer, index builder, sorted-set merges, the boolean/phrase query parser and evaluator, TF-IDF ranking, and the brute-force oracle. No DOM, runs under Node. |
| [`script.js`](./script.js) | The DOM controller: manages the corpus, paints results and snippets, draws the index table, runs the live verification. Owns no search logic. |
| [`tests.js`](./tests.js) | The dependency-free verification suite. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
