# Image Gallery

> Source 2 (karan/Projects) · **Classes (Object-Oriented Programming)** · project 7 of 10
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Create an image abstract class and then a class
that inherits from it for each image type,"* then a gallery that holds and
displays them.

Like every task in this category, the point is the **design**, not the feature
list. The one-sentence brief hides three things a naive version gets wrong — and
all three are really about where behaviour should *live*.

## The design in three ideas

### 1. The abstract class owns the invariant; subclasses declare *capabilities*, not branches

`ImageAsset` is genuinely abstract — constructing one throws. It holds everything
that is true of **every** image: identity, intrinsic dimensions, tags, and an
exact transform pipeline. Each subclass — `JpegImage`, `PngImage`, `GifImage`,
`SvgImage` — supplies only the two things that actually *differ* between formats:

- a **capability profile**: `{ alpha, animation, lossy, vector }`
- a **byte estimate** for a given pixel box

The trap is the `if (format === 'png') … else if (format === 'gif') …` ladder
that grows a new rung every time a format or a feature is added. Here nothing in
the gallery ever switches on a format string or `instanceof`: sorting by file
size calls `img.estimatedBytes()`, deciding whether a transparency warning is
needed asks `img.capabilities.alpha`. Adding WebP tomorrow is **one new class**
and zero edits anywhere else — the definition of the Open/Closed principle, not
as a slogan but as a thing you can see in the diff.

A visible payoff of real polymorphism: an **SVG's** estimated size does **not**
grow when you scale it up (it's resolution-independent markup), while a **PNG's**
does. Same `estimatedBytes()` call, two honest answers — a test pins both.

### 2. Transforms compose *exactly* and *lazily* — geometry without pixels

Crop, resize, scale, rotate (by quarter-turns) and flip are modelled as a small
algebra over a `(width, height)` box. A `TransformPipeline` is an **immutable
value**: every builder returns a *new* pipeline, so transforming an image never
mutates it — which is what makes a gallery of shared assets safe to show
transformed per view.

Dimensions are folded through the pipeline as **exact rationals over `BigInt`**,
so the geometry is pure arithmetic and never touches a pixel:

- scaling a 4000×3000 photo by `3/2` and then by `2/3` returns **4000×3000 to the
  pixel** — floats would drift, this doesn't;
- four 90° rotations are the **identity**; one swaps the sides;
- a crop is a *window*, so a crop larger than the current image is **refused**,
  and it's checked against the **post-scale** dimensions, not the originals.

Nothing is "baked" until a real pixel count is needed (for display or a byte
estimate), and only then is a single rounding applied.

### 3. Converting between formats is *honest* about what is lost

`convertTo(TargetFormat)` returns `{ image, losses }`. The loss list is computed
by **comparing the two capability profiles** against what the image actually uses:

| Going from → to | Reported loss |
| --- | --- |
| alpha → no alpha (PNG → JPEG) | *alpha channel flattened against #ffffff* |
| animated → still (GIF → PNG) | *animation (N frames) reduced to the first frame* |
| vector → raster (SVG → PNG) | *vector art rasterized at W×H* |
| lossless → lossy (PNG → JPEG) | *re-encoded with lossy compression (generation loss)* |

`losses` is empty **iff** the target can represent everything the source uses, so
an opaque still JPEG → PNG comes back clean. The point is that a conversion never
drops a feature in silence — it says so, the same way the Recipe manager's
"what can I make?" says *incomparable* rather than guessing grams-to-cups.

### And the gallery itself: a derived index, kept in lock-step

`Gallery` keeps the images as the single source of truth (`id → ImageAsset`) and
rebuilds its **by-tag** and **by-format** indexes on every add, remove and
retag. A lookup can therefore never name an image the gallery no longer holds —
`tests.js` proves it by asserting the live indexes always equal a full
`_reindex()` rebuild, before and after a removal. Albums are ordered, de-duplicated
lists of ids, and removing an image drops it from its albums too. `search({ tags,
format, text })` is served by intersecting index hits, not by scanning.

## Run it

**In the browser** — open `index.html`. A visual gallery with tag / format /
album filters, five sort keys, a transform panel (watch the dimensions and the
estimated size change *exactly*) and a convert panel that prints the capability
losses. There are no real image files in the repo, so each asset is drawn as a
generated SVG placeholder whose aspect ratio and orientation track the engine's
**effective** dimensions — the picture is decorative, the geometry is real.

**On the command line** — no dependencies, no build:

```sh
node gallery-node.js                 # the sample gallery, listed
node gallery-node.js --albums        # every album and its images
node gallery-node.js --json          # the whole gallery as JSON
node gallery-node.js --stats         # one-line stats

# pipe ';'-separated commands:
echo "convert img-logo jpeg; transform img-sunset scale 1/2; list" | node gallery-node.js
```

REPL / stdin commands: `list`, `show <id>`, `tags`, `bytag <t>`, `byformat <f>`,
`search <text>`, `sort <title|newest|oldest|largest|heaviest>`, `albums`,
`convert <id> <fmt>`, `transform <id> <crop|resize|scale|rotate|fliph|flipv> [args]`,
`stats`, `add <fmt> <title> <W> <H>`, `rm <id>`.

**The tests:**

```sh
node tests.js        # 67 dependency-free assertions, exit code 0 on success
```

They lean on the guarantees, not the surface: the base class is abstract, each
subclass answers the abstract hooks, transforms round-trip exactly, conversion
declares exactly the right losses, and the gallery's indexes always equal a fresh
rebuild.

## Files

| File | What's in it |
| --- | --- |
| `gallery-core.js` | the engine: `ImageAsset` (abstract) + `JpegImage` / `PngImage` / `GifImage` / `SvgImage`, `Transform` / `TransformPipeline`, `Rational`, `Gallery` |
| `gallery-fixtures.js` | the sample gallery shared by the CLI, tests and browser |
| `gallery-node.js` | the CLI / REPL over the same classes |
| `tests.js` | dependency-free assertions |
| `index.html`, `style.css`, `script.js` | the browser demo (logic lives in the core; this only paints) |

---

*This project is one entry in a daily automated series. A [Claude Code](https://claude.com/claude-code)
routine builds one project from a public project list each day, writes it up, and
merges it. See the repository root `README.md` and `PROGRESS.md` for the full run.*
