# Charity Finder

Discover charitable organizations that match your interests. Filter a
directory of real charities by name, home country, the countries they serve,
and the cause they focus on — then open a card to read the mission, visit the
website, or view a live project.

Source idea: [app-ideas / Charity Finder App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Charity-Finder-App.md)

## Running it

Open `index.html` in any modern browser — no build step, no dependencies, no
API key.

## Using it

1. On the splash page, press **Browse charities**.
2. Pick any combination of the four dropdown filters:
   - **Organization name**
   - **Home country**
   - **Countries served**
   - **Cause / theme** _(bonus)_
3. Press **Search** to shortlist matching organizations. **Clear** resets all
   filters.
4. Each result card shows the organization's **ID, name, address, and logo**.
   The logo and name link to the charity's website.
5. Press **View project** on a card to open a project detail dialog with a
   funding progress bar _(bonus)_.

## What the spec asked for

Core user stories — all implemented:

- App name in the page heading and a splash-page overview.
- Search interface with dropdown filters for name, home country, and countries
  served, plus a **Search** button.
- Organization cards showing **ID, name, address, and logo**.
- **Clickable logos** linking to each organization's website.
- Footer with GitHub and other links.

Bonus features — implemented:

- **Charity theme/focus dropdown filter.**
- **Project link on cards** opening a **project detail page** (a modal dialog)
  with the associated project's title, summary, and funding progress.

## A note on the GlobalGiving API

The original spec is built around the **GlobalGiving API**, which requires a
private API key and returns XML. That doesn't fit this repository's rule of
"open `index.html`, no build, no secrets," so the app ships with a curated set
of **real** organizations in [`data.js`](./data.js), shaped like the fields the
GlobalGiving API exposes (`id`, `name`, `address`, `logo`, home country,
countries served, `themes`, `mission`, `website`, and a representative
project). Swapping in a live API-backed data source later means replacing only
`data.js` — the search, rendering, and dialog logic are agnostic to where the
records come from.

Every logo is an inline SVG data URI, so the cards render fully offline with no
third-party image requests.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup: masthead, splash, search form, results grid, dialog, footer |
| `style.css` | Layout, cards, the search grid, and the project dialog |
| `data.js` | The charity directory (stands in for the GlobalGiving API) |
| `script.js` | Builds the filters, runs the search, renders cards and the project dialog |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 40 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
