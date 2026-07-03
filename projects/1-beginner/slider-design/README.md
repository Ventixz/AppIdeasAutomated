# Slider Design

An image carousel that rotates through slides on its own every few seconds, with
manual **‹ / ›** controls, clickable dots, keyboard arrows, and a play/pause
button. Each slide carries a caption overlaid on the artwork.

Source idea: [app-ideas / Slider Design](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Slider-Design.md)

## Features

- **Auto-rotate** — slides advance every 4 seconds (the "every x seconds" story).
- **Manual navigation** — previous/next buttons jump to the neighbouring slide.
- **Smooth transitions** *(bonus)* — slides cross-fade instead of cutting.
- **Text overlay** *(bonus)* — a title and blurb sit on top of each image.
- **3D effect** *(bonus)* — slides swing through a perspective as they change.
- **Dot indicators** — jump straight to any slide; the active one is highlighted.
- **Pause on hover** and a **play/pause** toggle so a slide can be read.
- **Keyboard support** — ← and → steer the carousel.
- **Reduced-motion aware** — the 3D swing is dropped for users who ask for less motion.

## How it works

`script.js` builds the slides and dots from a small `SLIDES` array, so adding a
slide is one object. Rotation is a single `show(index)` function that wraps with
modulo arithmetic, toggles an `active` class on the incoming slide, and tags the
outgoing one `leaving` so CSS can animate both. A `setInterval` drives the
auto-advance; every manual action restarts it so you always get a full interval
after interacting.

The "images" are CSS gradients rather than downloaded photos, which keeps the app
dependency-free and working offline. To use real imagery (e.g. from Unsplash, as
the spec suggests), swap each slide's `background` for a photo URL.

## Run it

Open `index.html` in any browser — no build step, no dependencies.
