# Shape Area & Perimeter Classes

> Source 2 (karan/Projects) · **Classes (Object-Oriented Programming)** · project 8 of 10
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Create an abstract class Shape and then inherit
from it other shapes like diamond, rectangle, circle, triangle etc. For each
shape, define the respective methods to compute area and perimeter. Then accept
the values needed from the user and print the area and perimeter."*

Like every task in this category, the point is the **design**, not the shape
count. The naive version is a single `area(type, ...dims)` function with a
`switch` inside and `Math.sqrt`/`Math.PI` sprinkled through — and it gets three
things wrong. All three are really about *where behaviour should live* and *what
counts as a correct number*.

## The design in three ideas

### 1. The abstract class owns the invariant; subclasses supply only what differs

`Shape` is genuinely abstract — constructing one throws. It holds everything true
of **every** shape: a name, dimensions that are validated once (finite, positive)
and stored as exact rationals, and the *promise* that `area()` and `perimeter()`
exist. Each subclass — `Circle`, `Rectangle`, `Square`, `RightTriangle`,
`EquilateralTriangle`, `Triangle`, `Rhombus`, `RegularPolygon`, `Ellipse` —
supplies only its own two formulas.

The trap is the `if (type === 'circle') … else if (type === 'rectangle') …`
ladder that grows a rung for every shape. Here **nothing** ever switches on a
shape's type string or uses `instanceof` to decide an answer: the collection
sorts by calling `s.area()`, totals by calling `s.area()`, decides exactness by
asking `s.isExact()`. Adding a trapezoid tomorrow is **one new class** and zero
edits anywhere else — the Open/Closed principle as a thing you can see in the diff.

`Square` is a real subclass of `Rectangle`, and `scaled()` is defined once on the
base in terms of each subclass's declared `dimensionOrder`, so every shape can be
scaled without a line of per-shape code — and a `Square` used anywhere a
`Rectangle` is expected still behaves (Liskov), which a test pins.

### 2. A measurement is an *exact value*, not a float

Floats are the second trap. `0.1 + 0.2 !== 0.3`, and a circle's area printed as
`153.93804002589985` is noise pretending to be precision. So measurements flow
through a `Quantity` type that represents an **exact** value: a rational part, a
rational multiple of **π**, and rational multiples of square-root **surds**
(√2, √3, √13, …), all over `BigInt`.

That makes the honest answers come out exactly:

- a circle of radius 7 has area **`49π`** and circumference **`14π`** — not a decimal;
- a `3`-`4`-`5` right triangle has perimeter **exactly `12`** (the √25 collapses to 5);
- a unit right triangle has perimeter **`2 + √2`**;
- an equilateral triangle of side 2 has area **`√3`**;
- a `13`-`14`-`15` triangle has area **exactly `84`** via Heron — the surd `√112896`
  reduces to `336`, then `/4`;
- a rhombus with diagonals 6 and 8 has perimeter **exactly `20`** (side 5).

Fractions are first-class too: a rectangle `8 × 5/2` has area `20` exactly.
Floating point only ever appears when you ask a `Quantity` for `.toNumber()`,
and the demo always shows the exact form first and the decimal as a muted `≈`.

### 3. The design is *honest* about what cannot be exact

Not every shape has a closed form in that algebra, and the worst thing a geometry
library can do is hide that. A **regular pentagon's** area is
`(n·s²)/(4·tan(π/n))` — transcendental — and an **ellipse's** perimeter has no
elementary form at all. So those `Quantity` values are flagged `exact === false`
and carry a numeric approximation only (the ellipse uses Ramanujan's second
approximation). A `Quantity` always knows whether it is exact, so:

- the pentagon reports an **exact perimeter** (`20`) and an **approximate area** (`≈ 27.53`);
- the ellipse reports an **exact area** (`15π`) and an **approximate perimeter** (`≈ 25.53`);
- a collection's total is exact **only if every member is**, and it says so;
- the collection can split itself into `exactOnes()` and `approximateOnes()`.

Same `area()` call across the hierarchy, honest answers — a decimal is shown with
a leading `≈` and an `approx` badge, never dressed up as exact.

## Running it

**The browser demo** — open `index.html`. Pick a shape, type its dimensions
(whole numbers or fractions like `5/2`), and the object computes its own area and
perimeter, shown in exact form with a proportioned sketch. "Add to table" builds
a collection with running totals and an exact/approximate breakdown.

**The CLI** (same classes, no dependencies):

```sh
node shape-node.js                   # the 9-shape sample collection, listed
node shape-node.js --totals          # totals + how many figures are exact
node shape-node.js --json            # the sample collection as JSON
node shape-node.js circle 7          # one shape → area 49π, perimeter 14π
node shape-node.js triangle 13 14 15 # exact Heron area (84)
node shape-node.js polygon 5 4       # a shape whose area is approximate
node shape-node.js --repl            # interactive

# pipe ';'-separated commands:
echo "add circle 7; add square 6; totals" | node shape-node.js
```

REPL / stdin commands: `<shape> <args>` (compute one), `add <shape> <args>`,
`list`, `totals`, `sample`, `clear`, `json`, `help`, `quit`. Shapes and their
arguments: `circle <radius>`, `rectangle <w> <h>`, `square <side>`,
`righttriangle <legA> <legB>`, `equilateral <side>`, `triangle <a> <b> <c>`,
`rhombus <diagP> <diagQ>`, `polygon <sides> <sideLen>`, `ellipse <semiMajor> <semiMinor>`.

**The tests:**

```sh
node tests.js        # 108 dependency-free assertions, exit code 0 on success
```

They lean on the guarantees, not the surface: `Shape` is abstract, every subclass
answers both hooks, surds reduce (`√50 = 5√2`), Heron gives `84` exactly, scaling
multiplies area by the factor **squared** and perimeter by the factor for every
shape, the inexact shapes are flagged, and invalid shapes (negative dimensions, a
broken triangle inequality, a 2-sided polygon) are refused.

## Files

| File | What's in it |
| --- | --- |
| `shape-core.js` | the engine: `Shape` (abstract) + the nine concrete shapes, `Quantity` (exact rational + π + surds), `Rational`, surd reduction, `ShapeCollection`, the registry |
| `shape-fixtures.js` | the sample collection shared by the CLI, tests and browser |
| `shape-node.js` | the CLI / REPL over the same classes |
| `tests.js` | dependency-free assertions |
| `index.html`, `style.css`, `script.js` | the browser demo (all geometry lives in the core; this only paints) |

---

*This project is one entry in a daily automated series. A [Claude Code](https://claude.com/claude-code)
routine builds one project from a public project list each day, writes it up, and
merges it. See the repository root `README.md` and `PROGRESS.md` for the full run.*
