# Distance Between Two Cities

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
thirteenth entry of its **Numbers** category, following
[Find PI to the Nth Digit](../find-pi-nth-digit/),
[Find e to the Nth Digit](../find-e-nth-digit/),
[Fibonacci Sequence](../fibonacci-sequence/),
[Prime Factorization](../prime-factorization/),
[Next Prime Number](../next-prime-number/),
[Tile Cost Calculator](../tile-cost-calculator/),
[Mortgage Calculator](../mortgage-calculator/),
[Change Return Program](../change-return/),
[Binary to Decimal and Back Converter](../binary-decimal-converter/),
[Calculator](../calculator/),
[Unit Converter](../unit-converter/) and
[Alarm Clock](../alarm-clock/).

> "Distance Between Two Cities — Calculates the distance between two cities and
> allows the user to specify a unit of distance. This program may require finding
> coordinates for the cities like latitude and longitude."

Open `index.html` in a browser. **No build step, no server, no dependencies, and
no network** — one HTML page, a stylesheet, and two scripts. Type two city names
(or raw `lat, lon` coordinates), pick a unit, and it shows the distance, the
initial compass bearing, the midpoint, and the great-circle path on a small map.

## What it does

- **Distance between two cities** in km, miles, nautical miles, metres, feet or
  yards.
- **Cities from an offline gazetteer** — 40 well-known world cities with their
  coordinates baked in, plus a few aliases (`NYC`, `LA`, `SF`, `CDMX`, `Rio`).
  No geocoding API, no key.
- **Raw coordinate entry** — type `40.7128, -74.0060`, `40.7128 N, 74.0060 W`, or
  DMS `40°42'46"N 74°00'21"W` for either endpoint.
- **Initial bearing** in degrees and as a 16-point compass label, plus the
  great-circle **midpoint**.
- A simple **equirectangular map** drawing both points and the curved
  great-circle route (no map tiles — just a lat/lon grid and a projected arc).

## The interesting part: the shortest path on Earth is a curve, and Earth isn't a sphere

The naive way to "measure the distance between two lat/lon points" is Pythagoras
on the coordinates — and it is wrong almost everywhere. Longitude degrees shrink
toward the poles, and the shortest path over a globe is a **great-circle arc**,
which on a flat map looks bent. So the real work is spherical (and then
ellipsoidal) trigonometry, and none of it needs the DOM, a network or a map
tile. All of it lives in [`distance-core.js`](./distance-core.js), which is
DOM-free, I/O-free and console-free, so the suite can check known distances,
symmetry and the triangle inequality without a browser.

### `haversine(lat1, lon1, lat2, lon2)` — the sphere

The great-circle distance on a sphere of mean radius `6371.0088 km`, via the
haversine formula. It is chosen over the shorter spherical law of cosines
because it stays **numerically stable for every pair**, including points a few
metres apart where the law of cosines loses all its precision. This is the
workhorse: it always returns an answer.

### `vincenty(lat1, lon1, lat2, lon2)` — the ellipsoid

Earth is an oblate spheroid (it bulges ~21 km at the equator), so a sphere is
already an approximation. Vincenty's inverse formula iterates over the **WGS-84
ellipsoid** — the same model GPS uses — and is accurate to sub-millimetre on
well-conditioned pairs. The honest catch, and a genuinely interesting edge, is
that the iteration **fails to converge for near-antipodal points**; there the
core returns `null` and `distance(..., 'auto')` transparently falls back to the
haversine so the app never shows a blank. New York → London is `5570 km` on the
sphere and `5585 km` on the ellipsoid — a real 15 km difference the two models
disagree on.

### Bearings, midpoint, and the inverse projection

`initialBearing` gives the compass heading you'd set out on (it changes along a
great circle, which is why long flights curve toward the poles); `midpoint`
finds the half-way point; and `destinationPoint(lat, lon, bearing, dist)`
projects forward along a great circle. That last one is the exact **inverse** of
haversine-plus-bearing, which is what the property tests round-trip against —
travel `d` km on bearing θ, and the measured distance back is `d` and the
measured bearing is θ again.

### Units, coordinates, and the gazetteer

Every unit factor is **exact by international definition** (`1 mi = 1609.344 m`,
`1 nmi = 1852 m`, `1 ft = 0.3048 m`), so a round trip (`km → mi → km`) returns
the original value rather than drifting on an approximate constant.
`parseCoordinate` reads decimal, hemisphere-lettered and DMS forms and rejects
out-of-range or unreadable input with plain-English errors; `formatDMS` is its
inverse. `lookupCity` normalises names (case, accents, punctuation), understands
`"City, Country"` and a handful of aliases, and returns `null` for the unknown.

`index.html` + `script.js` are only a thin layer over that core: the two inputs,
the unit/model selectors, and an SVG that projects the sampled great-circle arc
equirectangularly.

## Tests

A dependency-free suite exercises the core without a browser:

- **Known distances** — NY↔London, Paris↔Tokyo, NY↔LA and more within a
  tolerance, plus cardinal references (1° of latitude ≈ 111.19 km, a quarter of
  the equator, antipodal ≈ π·R, pole to pole).
- **Vincenty vs. haversine** — agree to within 0.6% on normal pairs, `0` for a
  coincident point, `null` (non-convergence) for antipodes, and `auto` falling
  back to the sphere there.
- **Units** — the exact factors, unknown-unit errors, and `km → unit → km`
  round-trips for every unit.
- **Bearings & compass** — the four cardinals, the `[0, 360)` range, and the
  16-point labels including wrap-around and negatives.
- **Coordinate parsing** — decimal, hemisphere and DMS forms, out-of-range and
  gibberish rejection, and a format→parse round-trip.
- **Gazetteer** — case-insensitive lookup, aliases, `"City, Country"`, unknowns,
  the city-to-city helper matching the raw haversine, and every entry in range.
- **Six property sweeps** — symmetry and non-negativity over 500 random pairs,
  no distance beyond π·R, the triangle inequality over 400 triples, and
  `destinationPoint` round-tripping both its distance and its bearing.

```bash
node projects/phase2-numbers/distance-between-cities/tests.js   # -> 80 passed, 0 failed.
```

---

*Part of [AppIdeasAutomated](../../../README.md). Idea from
[karan/Projects](https://github.com/karan/Projects); built automatically by a
Claude Code routine.*
