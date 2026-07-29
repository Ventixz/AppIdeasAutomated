# Meme Generator

Upload an image, drop a caption on the top and bottom, style it, drag it wherever
you like, doodle on top, then save it or share it. Everything runs on a single
HTML `<canvas>` with no libraries.

Source idea: [app-ideas / Meme Generator](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Meme-Generator-App.md)

## Running

Open `index.html` in any modern browser — nothing to install:

```bash
open projects/2-intermediate/meme-generator-app/index.html
```

No image handy? Click **Use a sample** for a self-contained placeholder so you
can try every feature immediately.

## What it does

Every user story from the spec, plus **all four** bonus features:

- **Upload an image onto a canvas** — file picker reads the image locally
  (`FileReader`), and the canvas resizes to the image's aspect ratio (user story 1).
- **Top text** and **bottom text** — two independent caption lines, auto
  upper-cased meme-style with an outline for readability (user stories 2 & 3).
- **Text color** — pick the fill *and* the outline color separately (user story 4).
- **Text size** — a slider from 16–120px, live (user story 5).
- **Save the meme** — exports the composited canvas to a `meme.png` download
  (user story 6).
- **Font family** *(bonus)* — Impact, Arial Black, Georgia, Comic Sans, Courier,
  Verdana.
- **Share on social media** *(bonus)* — Twitter/X, Reddit, and Facebook buttons
  open a pre-filled share dialog using your captions.
- **Drag the text** *(bonus)* — in *Move text* mode, grab either caption and
  place it anywhere on the image. Positions are stored as fractions so they hold
  when the image changes.
- **Draw shapes** *(bonus)* — Pencil (free draw), Rectangle, and Circle tools
  with their own color and brush width, plus **Undo last shape** and
  **Clear drawings**.

## How it works

The whole picture is a small model — the image, two text lines (positioned as
`0..1` fractions of the canvas), and a list of committed shapes. Every
interaction mutates the model and calls a single `draw()` that repaints in
order: **image → drawings → captions**. Pointer events are mapped from screen
space into canvas pixels so drag and draw stay accurate even when the canvas is
scaled down to fit the layout. Saving is just `canvas.toDataURL()` behind a
download link — the exported PNG is exactly what you see.

---

*Part of an automated [Claude Code](https://claude.com/claude-code) routine that
builds one app-ideas project per day.*
