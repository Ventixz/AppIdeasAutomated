# Flip Image

A single image shown in a **2&times;2 matrix**, where each cell can be flipped
independently. Arrows around every cell flip it **vertically** (&uarr;&darr;) or
**horizontally** (&larr;&rarr;) — a small exercise in CSS transforms and image
manipulation with **no image libraries**, just native HTML, CSS, and JavaScript.

Source idea: [app-ideas / FlipImage](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Flip-Image-App.md)

## Features

- **2&times;2 matrix** — the same image repeated across four cells.
- **Per-cell flipping** — each cell carries its own flip state, so the four
  copies can point in four different directions at once.
- **Directional arrows** — up/down flip vertically, left/right flip
  horizontally, by toggling the sign of a CSS `scaleX` / `scaleY` transform.

## Bonus features implemented

- **Custom image URL** — paste any image address into the input.
- **Display button** — rebuilds the matrix from the entered URL (Enter works too).
- **Load-error handling** — the URL is loaded into an off-screen `Image` first;
  if it fails, a clear error message is shown and the current matrix is kept.
- **Reset all flips** — return every cell to its original orientation.

## How it works

A flip is just a mirrored scale. Flipping horizontally negates the horizontal
axis; flipping vertically negates the vertical axis:

```js
cell.scaleX *= -1; // left / right arrow → mirror horizontally
cell.scaleY *= -1; // up / down arrow    → mirror vertically
img.style.transform = `scaleX(${cell.scaleX}) scaleY(${cell.scaleY})`;
```

Each cell is laid out as a small 3&times;3 CSS grid: the image sits in the
center and the four arrow buttons occupy the edge cells. Before a custom URL is
shown, it is loaded into a throwaway `new Image()` so an `onerror` can catch a
bad address without disturbing what's already on screen.

## Run it

Open `index.html` in any browser — no build step or dependencies. The default
image is fetched from the network on first load; after that, the flips work
entirely offline.
