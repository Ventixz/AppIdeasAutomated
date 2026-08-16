# Calendar

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Calendar spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Calendar-App.md).

A month-view scheduling app. Click a day to add an event, click an event to
edit it, **drag an event onto another day** to reschedule it, and set a reminder
that pops a toast when it's due. Switch between light and dark themes, and
everything you do is saved in the browser so the calendar survives a reload.

## Architecture — logic vs. presentation

As with the other advanced projects here, every rule lives in a
**presentation-free engine** (`calendar-core.js`). It knows nothing about the
DOM, clicks or `localStorage` — only dates, events, the month grid, and which
reminders are due. Anything non-deterministic (the clock, id generation) is
*injected*, so the same engine runs identically in the browser and in the test
suite.

```js
const C = require('./calendar-core.js');

// Build a month grid (weeks of 7 cells, with the today cell flagged):
C.monthGrid(2026, 8, '2026-08-16');   // -> [[{key:'2026-07-26', inMonth:false}, ...], ...]

// Immutable event operations:
let events = C.addEvent([], { title: 'Dentist', date: '2026-08-20', time: '09:00' }, { idGen });
events = C.moveEvent(events, id, '2026-08-25');   // drag to a new date
events = C.updateEvent(events, id, { time: '10:30' });

// Reminders, decided purely from an injected "now":
C.dueReminders(events, C.wallClockNow(new Date()));  // -> events whose reminder has fired
```

Dates are stored as `YYYY-MM-DD` keys and times as 24-hour `HH:MM`. Timestamps
are computed over the wall-clock components with `Date.UTC`, so the engine is
**timezone-independent and deterministic** — the browser feeds it a matching
"wall-clock-as-UTC" now (`wallClockNow`), and the tests build `now` the same way.

## The browser app (`index.html`)

Open `index.html` and you get:

- **Month view** — a proper 7-column grid with the leading/trailing days of the
  neighbouring months greyed out, today highlighted, and `‹ / ›` / **Today**
  navigation.
- **Event editor** — a dialog for the title, date, time, description, reminder
  and colour, with inline validation (empty title, bad date/time all caught by
  the core's `validateEvent`).
- **Drag to reschedule** — grab any event chip and drop it on another day.
- **Reminders** — every event can carry a reminder ("at start", 5 min … 1 day
  before); when it comes due a toast pops in the corner, and it only fires once.
- **Side panel** — the selected day's events in full, plus a one-click
  **+ Add event**.

### Spec coverage

Core requirements:

- ✅ **Create** an event
- ✅ **Edit** an event
- ✅ **Delete** an event

Enhanced capabilities (all implemented):

- ✅ **Drag events between dates**
- ✅ **Set a reminder** for an event (toast notification when due)
- ✅ **Light / dark theme** toggle (CSS custom properties, choice remembered)
- ✅ **Local storage** — events persist across reloads; a corrupt store is
  recovered event-by-event instead of wiping the calendar

## Tests

A dependency-free, Jest-style suite covers the date maths (leap years, month
wrapping, weekday lookup), the month grid, event validation, immutable
create/update/delete/move (including reminder rescheduling on move/time edit),
day querying and sorting, reminder due-times, and storage round-trips that
tolerate corruption:

```bash
node tests.js   # -> All 94 tests passed.
```

*Built automatically by a Claude Code routine. Idea:
[florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).*
