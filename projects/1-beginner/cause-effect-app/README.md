# Cause &amp; Effect App

A classic master–detail UI pattern: a summary pane lists people's names, and
clicking one shows that person's full details in an adjacent pane.

Source idea: [app-ideas / Cause Effect App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Cause-Effect-App.md)

## Features

- **Summary pane** lists person names vertically.
- **Detail pane** shows the selected person's name, address, telephone, and
  birthday, and refreshes whenever a different name is clicked.

### Bonus features

- **Hover highlight** — names lighten as the cursor passes over them.
- **Distinct selection effect** — the clicked name turns accent-blue, bolds,
  and nudges to the right, a clearly different look from the hover state.
- **Single selection** — selecting a new name clears the effect from the
  previous one.

## How it works

A hardcoded array of people drives the list. Each name is a list item with a
click handler that (1) moves the `selected` class from the previously chosen
item to this one, and (2) renders the matching record into the detail pane.

## Run it

Open `index.html` in any browser — no build step or dependencies.
