# Pomodoro Clock

A time-management timer built on the Pomodoro Technique: focused **25-minute**
work sessions separated by short **5-minute** breaks, with a longer **10-minute**
break every fourth round. No libraries — the countdown runs on `setInterval` and
the end-of-session chime is synthesised with the Web Audio API, so there are no
audio files to ship.

Source idea: [app-ideas / Pomodoro Clock](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Pomodoro-Clock.md)

## Features

- **Work timer** — a 25-minute focus session, shown as `MM:SS`.
- **Break timer** — a 5-minute break that follows each work session.
- **Start / Pause, Stop, Reset** — Start/Pause toggles the countdown, Stop rewinds
  the current session to full length while keeping your place in the cycle, and
  Reset returns to a fresh first work session.

### Bonus features

- **Audio alert** — three short ascending beeps play when a session hits `00:00`,
  generated on the fly with the Web Audio API (no asset files).
- **Customisable durations** — adjust the work, short-break, and long-break
  lengths; changes apply the next time a session starts.
- **Long break every 4th round** — a 10-minute long break automatically replaces
  every fourth short break.

## How it works

A single `state` object tracks the current phase (`work`, `short`, or `long`),
the seconds remaining, and how many work sessions have completed. Each tick
decrements the remaining seconds; when it reaches zero, `chime()` fires and
`advance()` moves to the next phase — work always flows into a break, and every
fourth completed work session promotes that break to a long one. The dial's
border colour and the document title both reflect the active phase.

## Run it

Open `index.html` in any browser — no build step or dependencies.
