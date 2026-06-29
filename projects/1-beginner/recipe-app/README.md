# Recipe App

Browse a list of recipe titles, click one, and read its full card — meal type,
servings, difficulty, timing, ingredients with amounts, and step-by-step
preparation. A search box filters the list as you type.

Source idea: [app-ideas / Recipe App](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Recipe-App.md)

## Features

- **List of recipes** — every recipe title shows in the sidebar with its emoji
  and meal type.
- **Recipe card** — selecting a title renders a card with the title, meal type,
  servings, difficulty level, total time, ingredients (each with its amount),
  and numbered preparation steps.
- **Swap cards** — click any other title to instantly swap the displayed card;
  the active title stays highlighted.
- **Dish photo** *(bonus)* — each card leads with a large emoji standing in for
  a photo of the finished dish.
- **Search** *(bonus)* — the search box filters recipes by title or meal type
  and shows a friendly message when nothing matches.

## How it works

Recipe data lives in `recipes.js` as plain objects — the spec suggests encoding
the initial data as JSON, so each recipe carries its `mealType`, `servings`,
`difficulty`, `ingredients` (amount + item) and `steps`. `script.js` renders the
title list, filters it on input, and re-renders a single card on selection. All
data text is escaped before it touches `innerHTML`. No external API is required,
so the app works fully offline.

## Run it

Open `index.html` in any browser — no build step or dependencies.
