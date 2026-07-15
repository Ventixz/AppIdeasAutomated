# Chrome Theme Extension

Design a personal Chrome color theme, preview it live on a mock browser, and
export a **real, installable** Chrome theme — plus a **night light** blue-light
filter that dims warm over every page and switches on by itself after sunset.

Source idea: [app-ideas / Chrome Theme Extension](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Chrome-Theme-Extension.md)

This project ships in two parts:

1. **`index.html` — the customizer** (open in any browser, no build, no deps).
   Pick colors, try color-safe palettes, play with the night-light filter, then
   click **Export** to download a native `manifest.json` theme and the
   `filter.js` night-light script.
2. **`extension/` — a working extension** you can load unpacked in Chrome right
   now. It themes the new-tab page and runs the night-light filter with a popup
   toggle.

## Running the customizer

Open `index.html` in a browser:

```bash
open projects/2-intermediate/chrome-theme-extension/index.html
```

- **Customize** the six theme colors, or start from a **palette** — the ones
  tagged _color-safe_ avoid red/green ambiguity for common forms of color
  blindness (a core user story of the spec).
- The **live preview** repaints a mock browser window as you edit.
- Toggle **🌙 Night light**, drag the **strength**, and leave **auto after
  sunset** on — the warm overlay is exactly what the real extension injects.
- **Export** downloads `manifest.json` (a genuine Chrome theme built from your
  colors) and `filter.js`, and shows both on screen to copy.

## Loading the real extension in Chrome

```
projects/2-intermediate/chrome-theme-extension/extension/
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Open a new tab to see the themed new-tab page (click 🎨 to switch palettes),
   and click the toolbar icon for the **night-light** popup.

The night light turns on automatically between **19:00 and 06:00**, or whenever
you flip **Force on now** in the popup — and every open tab updates instantly.

## Installing a generated theme as your default

The customizer's exported `manifest.json` is a native Chrome *theme* (not a
regular extension), so it becomes your browser's actual default theme:

1. Put the exported `manifest.json` in its own folder.
2. `chrome://extensions` → **Developer mode** → **Load unpacked** → pick that
   folder. Chrome applies it as the current theme immediately.

## How the pieces map to the spec

| Spec user story | Where it lives |
| --- | --- |
| Create themes from personal color preferences | Customizer color pickers → exported `manifest.json` theme |
| Aids people with color blindness | _Color-safe_ palettes (blue/orange, high-contrast, deuteranopia) |
| Install and set as the default theme | Native theme manifest, load-unpacked instructions above |
| **Bonus:** night-sight toggle switch | Popup **Force on** / **Auto** toggles + strength slider |
| **Bonus:** auto night light in the evening | `filter.js` + `background.js` evening check (19:00–06:00) |

Publishing to the Chrome Web Store and a Firefox port are the remaining bonus
items; the manifest is MV3 and the code is store-ready, but publishing needs a
developer account, so it's left as a manual step.

## Files

| File | Purpose |
| --- | --- |
| `index.html` / `style.css` / `script.js` | The in-browser customizer + live preview + exporter |
| `extension/manifest.json` | MV3 manifest: new-tab override, content script, popup, service worker |
| `extension/newtab.html` · `newtab.css` · `newtab.js` | Themed new-tab page with a palette switcher |
| `extension/filter.js` | Content script that overlays the night-light wash on every page |
| `extension/background.js` | Service worker: seeds defaults, 1-minute heartbeat for auto mode |
| `extension/popup.html` · `popup.css` · `popup.js` | Night-light toggle, strength, and auto controls |

## A note on the warm overlay

The filter is a fixed, full-viewport `#ff8c1a` layer at low opacity using
`mix-blend-mode: multiply` and `pointer-events: none`, so it warms the whole
page without ever blocking clicks. It's a lightweight, page-level stand-in for
a true display-level color-temperature shift.

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 41 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
