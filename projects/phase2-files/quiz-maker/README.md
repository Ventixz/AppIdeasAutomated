# Quiz Maker

> Source 2 (karan/Projects) · **Files** · project 1 of 6
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Make an application which takes various
questions from a file, picked randomly, and puts together a quiz for students."*
It should generate a different quiz each time and grade the completed quizzes
with an answer key.

A self-contained quiz maker: it reads a plain-text **question file**, assembles a
randomized quiz, and grades what the student submits against an answer key. No
server and no build step — open `index.html`, paste a bank or open a `.quiz`
file. The engine that actually matters runs in Node too, under `node tests.js`.

## Try it

Open `index.html` and click **load the sample** (or open any `.quiz` file, or
paste your own). Pick how many questions you want, optionally type a **seed**,
and hit **Assemble quiz**. Answer it, press **Grade it**, and you get a score, a
per-question review, and the explanations. **New random quiz** reshuffles from the
same bank. Run the logic tests with `node tests.js` (91 checks, no dependencies).

This is a "Files" project, so the whole thing is built around the file: a
forgiving, human-writable question format, a parser that is strict where it
matters, and an assembler/grader pair kept honest by that file. The three things
that are genuinely hard live in `quiz-core.js`, where they can be tested without a
browser.

## The file format

A question file is plain text — the kind of thing a teacher actually types:

```
# lines beginning with a hash are comments

What is the capital of France? {2}   <- stem; the optional {N} sets points
* Paris                              <- '*' marks a CORRECT option
- London                            <- '-' marks an incorrect option
- Berlin
> Paris has been the capital since 987.   <- '>' adds an explanation

Which are prime numbers? {3}         <- two or more '*' => "select all" question
* 2
* 7
- 9
```

`sample-bank.quiz` is a full example.

## Trap 1 — the file is the interface, so the parser has to be forgiving *and* strict

Teacher-authored files are messy: trailing spaces, Windows line endings, blank
lines between questions, comment lines, inconsistent spacing after the marker.
None of that changes what a question *means*, so the parser silently tolerates
all of it — it splits on `\r\n|\r|\n`, trims trailing whitespace, skips blanks
and `#` comments, and accepts any spacing after `*`/`-`/`>`.

But the things that *do* change meaning are rejected loudly, each with the line
number so the author can fix the file:

- an option (`*`/`-`) or explanation (`>`) that appears **before any question**,
- a question with **no options**, or with **no option marked correct** (`*`),
- a **duplicate option** inside one question (it makes grading ambiguous),
- an empty stem or an empty option.

`parseBank` returns `{ questions, errors, warnings }` rather than throwing, so the
UI can show *every* problem at once (and a single-option question is a *warning*,
not an error — it's unusual but gradeable). The tests feed it a deliberately
broken file and assert the errors land on the right lines.

## Trap 2 — "a different quiz each time" fights "grade it with an answer key"

The textbook mistake is to shuffle the options the student sees but keep the
answer key as *"the correct answer is option #1"* from the original file. The
moment you shuffle, option #1 isn't the right one any more, and the key grades
every paper wrong.

So the key is **produced by the assembler, bound to this exact assembly** — not
derived later from the bank. `assembleQuiz` picks the questions, shuffles their
order, shuffles each question's options, assigns the display letters A/B/C… *after*
the shuffle, and only then records which letter is correct **in this quiz**. The
test that matters re-runs the assembly across 25 seeds and asserts that the key's
letter always points at wherever the known-correct option actually landed.

And "a different quiz each time" has to be *reproducible on demand*: a teacher
needs to reprint the same quiz, and the tests need something to assert on.
`Math.random()` can't do that, so assembly runs on a small seeded PRNG
(mulberry32). Same seed in, byte-identical quiz and key out — the UI shows the
seed so you can regenerate any quiz, and the tests pin it.

## Trap 3 — the student quiz must not carry the answers

If the correctness flags ride along in the quiz object, they're one "View Source"
away in the browser. `assembleQuiz` returns two separate objects: the **quiz**
(stems, points, and lettered choices — and nothing else) and the **key**
(correct letters + explanations), kept apart. The test suite serializes the quiz
to JSON and asserts the string `correct` appears nowhere in it.

## Grading

`grade(quiz, key, responses)` marks a completed quiz. Single-answer questions are
all-or-nothing. "Select all that apply" questions are all-or-nothing too by
default (the chosen *set* must equal the correct set), but pass `{ partial: true }`
for proportional credit where a wrong pick cancels out a right one — both paths
are tested. Grading is tolerant of messy input: letters are upper-cased, trimmed,
and de-duplicated, so `' a '`, `'A'`, and `['A','A']` all mean the same choice.

It returns the score, the max, a percentage, a correct count, and a per-question
breakdown (what you chose, the right answer, points awarded, and the explanation)
— which is exactly what the results screen renders.

## Files

| File | What it is |
| --- | --- |
| `quiz-core.js` | The engine: `parseBank`, `assembleQuiz`, `grade`, `serializeBank`, seeded RNG. Runs in Node and the browser. |
| `tests.js` | 91 assertions over all four jobs. `node tests.js`. |
| `sample-bank.quiz` | An example question file in the format. |
| `index.html` / `style.css` / `script.js` | The browser UI — thin glue over the engine. |

## Note

This project is part of an automated daily routine run by Claude Code (see the
repository root [`README.md`](../../../README.md) and
[`PROGRESS.md`](../../../PROGRESS.md)). Each day the routine builds the next
unchecked project from its source list, writes it up, and merges it.
