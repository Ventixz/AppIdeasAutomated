# Random Meal Generator

Click one button and get a complete random recipe — name, photo, category and
cuisine, the full ingredient list with measures, and step-by-step instructions.
Click again for a different meal. When a meal has a tutorial, its YouTube video
is embedded right in the card.

Source idea: [app-ideas / Random Meal Generator](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Random-Meal-Generator.md)

## Features

- **One-tap surprise** — the *Surprise me* button pulls a random meal from
  [TheMealDB](https://www.themealdb.com) API.
- **Full recipe card** — name, dish photo, category + area badges, ingredients
  paired with their measures, and the preparation instructions.
- **Keep rolling** — every click fetches a fresh, different meal.
- **YouTube video** *(bonus)* — when the meal includes a tutorial link, the
  video is embedded under the recipe.
- **Friendly states** — distinct loading, error, and offline messages so the UI
  never silently stalls.

## How it works

`script.js` calls TheMealDB's `random.php` endpoint with `fetch`. The API hands
back ingredients and measures as 20 flat numbered fields, so the code zips
`strIngredient1..20` with `strMeasure1..20` and drops the blanks. The YouTube
embed is built by parsing the 11-character video id out of the watch URL. Every
value from the API is HTML-escaped before it touches `innerHTML`.

## Run it

Open `index.html` in any browser — no build step or dependencies. It does need
an internet connection, since the meals come live from TheMealDB.
