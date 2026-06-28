# Quiz App

Test your knowledge one question at a time. Pick a topic, answer four-option
questions, and get a scored result with the time you took and a pass/fail verdict.

Source idea: [app-ideas / Quiz App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Quiz-App.md)

## Features

- **Start on a button** — choose a quiz from the dropdown and press **Start**.
- **One question at a time** — each question shows four options; pick one and the
  correct answer lights up green (a wrong pick turns red), then advance to the next.
- **Results screen** — at the end you get a score ring, the number correct, the
  **time elapsed**, and a **pass/fail** message (pass threshold is 60%).
- **Multiple quizzes** *(bonus)* — JavaScript Basics, HTML & CSS, and General
  Knowledge; the picker is data-driven so adding more is just editing `quizzes.js`.
- **Personal best** *(bonus)* — your best score per quiz is saved to
  `localStorage` and shown on the start and result screens (higher score wins,
  faster time breaks ties).
- **Share result** *(bonus)* — uses the native Web Share sheet where available
  and falls back to copying the result to the clipboard.

## How it works

Quiz content lives in `quizzes.js` as plain objects — each question is
`{ q, options, answer }`, where `answer` is the index of the correct option. The
app is a tiny three-screen state machine (start → question → result): it renders
one question at a time, locks the question once you answer, runs a live timer
with `setInterval`, and computes the score and verdict at the end. Best scores
are persisted under a single `localStorage` key.

## Run it

Open `index.html` in any browser — no build step or dependencies.
