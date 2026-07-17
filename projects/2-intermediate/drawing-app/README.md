# Drawing App

Create digital artwork on an HTML `<canvas>` — freehand drawing, shape tools,
colour and brush controls, undo, clear, and one-click PNG export.

Source idea: [app-ideas / Drawing App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Drawing-App.md)

## Running

Open `index.html` in any browser — no build, no dependencies:

```bash
open projects/2-intermediate/drawing-app/index.html
```

## How to use

1. Pick a **tool**: Pen, Eraser, Line, Rectangle, Circle, or Star.
2. Choose a **colour** with the picker or a preset swatch.
3. Set the brush/stroke **size** with the slider.
4. **Click and drag** on the canvas to draw. Shape tools drag out from the
   start point and preview live until you release.
5. **Undo** (↩ or Ctrl/Cmd+Z), **Clear** the whole canvas, or **Save PNG** to
   download your artwork.

Tick **Fill shapes** to fill rectangles, circles, and stars with the current
colour instead of only outlining them.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| Draw on a `canvas` with the mouse | `startDraw` / `moveDraw` freehand path (Pointer Events, so touch works too) |
| Change the colour | colour `<input type="color">` + preset swatch grid → `state.colour` |
| Change the size of the tool | size range slider → `state.size` → `ctx.lineWidth` |
| Clear the canvas | **Clear** button → `initCanvas()` |
| **Bonus:** save as an image | **Save PNG** → `canvas.toDataURL("image/png")` download |
| **Bonus:** draw different shapes | Line / Rectangle / Circle / Star tools → `drawShape()` |

Plus a few extras beyond the spec: an **eraser**, a multi-step **undo** stack,
keyboard undo, and live shape previews.

## How it works

- **Freehand** strokes extend a single `Path2D` line as the pointer moves,
  with round caps/joins so lines look smooth.
- **Shapes** snapshot the canvas on pointer-down, then on every move restore
  the snapshot and redraw the shape — that gives a flicker-free live preview
  without committing until you release.
- **Undo** keeps up to 30 `ImageData` snapshots taken before each stroke.
- **Coordinates** are scaled through `canvas.width / rect.width` so drawing
  stays accurate even when the canvas is displayed smaller than its intrinsic
  900×620 resolution.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Toolbar markup + the `<canvas>` |
| `style.css`  | Dark, panelled responsive layout |
| `script.js`  | Tool state, drawing logic, shapes, undo, PNG export |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 43 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
