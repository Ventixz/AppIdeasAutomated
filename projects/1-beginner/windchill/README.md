# Windchill

Combine the actual air temperature with the wind speed to work out the
**wind chill factor** — how cold it actually *feels*. Switch between Metric
and English units, type your numbers, and get the perceived temperature.

Source idea: [app-ideas / Windchill](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Windchill-App.md)

## Features

- **Metric or English** — toggle between °C / km/h and °F / mph. Switching
  systems relabels the fields and recalculates in place.
- **Calculate** — press the button (or just keep typing) to see the wind chill.
- **Input validation** — an empty or non-numeric field, or a negative wind
  speed, produces a clear error message instead of a bogus number.
- **Range check** *(bonus)* — if the computed wind chill isn't below the actual
  temperature, the app flags it, since the formula only holds for cold, windy
  conditions.
- **No-change nudge** *(bonus)* — pressing **Calculate** again without editing
  anything prompts you to enter new values.
- **Live updates** *(bonus)* — the result refreshes as you edit either field,
  no button press required.

## How it works

The app uses the U.S. National Weather Service wind-chill formulas. With
temperature `t` and wind speed `v`:

```js
// English — t in °F, v in mph
35.74 + 0.6215*t - 35.75*v**0.16 + 0.4275*t*v**0.16

// Metric — t in °C, v in km/h
13.12 + 0.6215*t - 11.37*v**0.16 + 0.3965*t*v**0.16
```

Both are empirical fits that only apply to cold temperatures with meaningful
wind. Outside that range the result can equal or exceed the actual temperature,
which is exactly the case the range-check bonus catches.

## Run it

Open `index.html` in any browser — no build step, no dependencies.
