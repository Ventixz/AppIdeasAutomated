# Product Landing Page

A single-page marketing site for **Sprout**, a fictional self-watering smart
planter. It presents the product with imagery, a feature list, a value
proposition, pricing and several conversion-focused touchpoints — all
dependency-free and built from a single static page.

Source idea: [app-ideas / Product Landing Page](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Product-Landing-Page.md)

## Core requirements

- **Product imagery** — an inline SVG illustration of the planter in the hero
  (no image files to ship).
- **Features list** — a six-card grid of what the product does.
- **How it improves your life** — a "Why people love Sprout" benefits section.
- **Contact section with an email** — a `mailto:` link in the contact section.

## Bonus features

- **FAQ section** — an accordion built with native `<details>`/`<summary>`.
- **Contact form** — name, email and message with client-side validation.
- **Newsletter signup** — email capture with validation and a confirmation.
- **Purchase** — three pricing tiers with "Buy now" buttons that simulate
  adding an item to a cart.

## How it works

`script.js` wires up the interactive pieces with plain DOM APIs:

- Email checks use a single shared regular expression.
- The contact and newsletter forms validate on submit, flag invalid fields in
  red, and show an `aria-live` status message; fields clear their error styling
  as you type.
- Each "Buy now" button reads its plan and price from `data-` attributes and
  reports a simulated cart update.

The layout is responsive via CSS grid with `auto-fit`/`minmax`, and the hero
collapses to a single column on narrow screens.

## Run it

Open `index.html` in any browser — no build step or dependencies.
