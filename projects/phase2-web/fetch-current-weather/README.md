# Fetch Current Weather

> Source 2 (karan/Projects) · **Web** · project 4 of 9
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Fetch Current Weather — Get the current weather
for a specified location. (web)"*

"Get the weather for a place" sounds like one API call. It is at least two, and
the number it hands back is not the number a person actually wants. This project
builds the whole pipeline — place name → coordinates → conditions — and spends
most of its effort on the part the one-liner skips: turning what the sensor
measured into what the air *feels like*, and knowing when each correction is
even allowed to apply.

Data comes from [Open-Meteo](https://open-meteo.com), which is free and needs
**no API key** — so the demo and CLI run for anyone, with nothing to sign up for.

## There is no "weather for a place name" endpoint

You cannot ask a forecast API for "Paris." Weather is indexed by **coordinates**,
so the first step is *geocoding* the name to a latitude/longitude. And names are
ambiguous — there are [dozens of Springfields](https://en.wikipedia.org/wiki/Springfield)
— so geocoding returns a **list of candidates**, not an answer. The pipeline is:

```
"Paris"  ──geocode──▶  [ {48.85, 2.35, FR}, {33.66, -95.56, US Texas}, … ]
                            │ pick one (CLI: most populous; web: you click)
                            ▼
                     forecast(lat, lon)  ──▶  current conditions
```

`buildGeocodeUrl` / `parseGeocodeResponse` do the first hop and label each
candidate (`"Paris, Île-de-France, FR"` vs `"Paris, Texas, US"`) so the ambiguity
is visible instead of silently guessed.

## The hard part: the thermometer is the wrong number

A thermometer reads **air temperature**. That is almost never what you want to
show as "the weather," because it is not what the air *feels* like:

- **Wind** strips the thin warm layer off your skin, so a cold day feels colder
  the harder it blows — **wind chill**.
- **Humidity** stops your sweat evaporating, so a hot day feels hotter the more
  humid it is — **heat index**.

The naïve app shows the raw number and is wrong in exactly the conditions people
check the weather *for* — a cold snap or a heat wave. So `weather-core.js`
computes the apparent temperature with the real formulas:

```
wind chill (°C)  WCT = 13.12 + 0.6215·T − 11.37·V^0.16 + 0.3965·T·V^0.16      (Environment Canada)
heat index (°F)  HI  = −42.379 + 2.049·T + 10.143·R − 0.225·T·R − …           (NWS Rothfusz regression)
```

## The correctness trap is the *domain*, not the formula

The formulas are easy to copy. The bug everyone ships is applying them where
they don't hold. **Wind chill is only defined for T ≤ 10 °C and wind > 4.8 km/h**;
**the heat index regression is only meant for T ≥ 27 °C (80 °F)**. Run heat index
on a cold morning and you get a number that is pure noise; run wind chill on a
warm breeze and it *raises* the apparent temperature, which is nonsense.

So `apparentTemperatureC` is a **dispatcher with guards**: each formula returns
`null` outside its domain, and the dispatcher picks wind chill, or heat index,
or — crucially — *neither*, in which case the feels-like **is** the air
temperature. Open the demo's section 2 and drag the sliders: watch the model
badge flip between *wind chill*, *heat index* and *raw air temp*, and watch the
boundaries where each one switches off. That boundary is the whole lesson.

## The condition is a number, not a phrase

The API reports `weather_code`: a single integer from **WMO code table 4677**
(`0` = clear, `61` = slight rain, `95` = thunderstorm, …). A weather display's
remaining job is turning that integer into words and a glyph, and *degrading
gracefully* when a provider adds a code you've never seen — a display that throws
on an unknown code is worse than one that says "unknown conditions."
`describeWeatherCode` is that dictionary; the demo's section 3 is the whole table.

## A couple of details that bite

- **Coordinate rounding is the cache key.** Two clicks on the same city give
  floats differing in the 9th decimal. `roundCoord(…, 4)` (~11 m) collapses them
  so `makeCacheKey` actually hits instead of fetching twice for the same place.
- **Unit conversion without a refetch.** The parsed observation is stored in SI;
  `formatObservation(obs, 'imperial')` re-renders °F/mph from it, so the unit
  toggle is instant and never re-queries the network.
- **Exact conversions.** 1 mile = 1.609344 km and 1 knot = 1.852 km/h *exactly* —
  the tests pin these rather than using rounded constants.

## The tests are anchored on checkable facts

`tests.js` (61 checks) leans on things that can be verified independently: the
exact unit relationships, the published Environment Canada wind-chill table value
(−5 °C at 30 km/h → −13), the NWS heat-index reference (90 °F at 70 % → ~105 °F),
the full 16-point compass, the WMO table, and a complete **geocode → forecast**
round-trip through canned API payloads so the URL building and response parsing
are exercised exactly as the client uses them — including that an `{error:true}`
payload and a missing `current` block both raise a readable error.

## Files

| file | what it is |
| --- | --- |
| `weather-core.js` | the whole engine, no I/O — the geocode/forecast URL builders and response parsers, the WMO code dictionary, exact unit conversions, the compass, and the wind-chill / heat-index / apparent-temperature math with domain guards. Runs in Node and the browser. |
| `weather-node.js` | the real I/O layer — runs the two-step pipeline over Open-Meteo with Node's built-in `fetch` (zero dependencies), picks the best match for a bare name, `--list`s candidates, toggles `--imperial`/`--json`, and `--demo` shows the output with no network. |
| `index.html` + `script.js` + `style.css` | a browser demo: live city search (with graceful offline fallback), the feels-like slider lab where you can watch the model switch at its domain boundaries, and a clickable WMO code table. |
| `tests.js` | 61 dependency-free checks anchored on published reference values and a full pipeline round-trip. |

## Run it

**The browser demo** — open `index.html`. Search a city and pick a candidate;
drag the section-2 sliders to see wind chill and heat index take over (and switch
off) at their real boundaries; click any WMO code to decode it. If the network is
blocked, the search falls back to canned data so the output is still visible.

**The CLI** (Node 18+, no dependencies):

```bash
node weather-node.js "Paris"                 # best match, current conditions
node weather-node.js "Springfield" --list    # show the ambiguous candidates
node weather-node.js "Tokyo" --imperial      # °F + mph
node weather-node.js --lat 64.14 --lon -21.9 # skip geocoding, use coordinates
node weather-node.js "Berlin" --json         # machine-readable
node weather-node.js --demo                  # offline: canned data, no network
```

(Open-Meteo is plain HTTPS and usually reachable, but on a sandboxed network the
CLI says so and points you at `--demo`; the arithmetic runs identically offline.)

**The tests:**

```bash
node tests.js
#  ✓ all 61 checks passing
```

## What this demonstrates about the web

Fetching weather is a good lesson in how often "one API call" is really a
*pipeline over an external service you don't control*: you resolve an ambiguous
human input to a machine key (geocoding), you fetch, and then you do the real
work — interpreting a coded enum and correcting a raw measurement into something
meaningful, while refusing to apply a correction outside the domain where it's
valid. Skip that last step and your weather app confidently reports a dangerous
heat wave as a pleasant 35° and a biting wind as a calm −3°.

---

*Part of a daily automated [Claude Code](https://claude.com/claude-code)
routine that builds one project per day. See the repository
[`README.md`](../../../README.md) and [`PROGRESS.md`](../../../PROGRESS.md).*
