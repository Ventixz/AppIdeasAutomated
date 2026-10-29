# Patient / Doctor Scheduler

> Source 2 (karan/Projects) · **Classes (Object-Oriented Programming)** · project 5 of 10
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Create a patient class and a doctor class. A
doctor can handle several patients. Write a scheduling program — a doctor can
only handle 16 patients during an 8-hour work day."*

Like every task in this category, the point is the **design**, not the feature
list. "16 patients in an 8-hour day" isn't a slogan — it's **16 half-hour
slots** — and modelling it honestly means getting three things right that a
naive version gets wrong.

## The design in three ideas

### 1. `Person` is abstract; the role is the subclass

A patient and a doctor are both people — they share a name and an id — but you
never have a bare "person" in a clinic. `new Person()` throws. The only concrete
kinds are `Patient` and `Doctor`, and each answers `role` its own way. Shared
identity lives in the base; the thing that differs lives below it. A hand-rolled
subclass that forgets to define `role` can't be used either — the abstract-ness
is a rule the objects enforce, not a comment everyone is trusted to honor.

### 2. Time is a discrete, exact slot grid — not a floating clock

The 8-hour day (09:00–17:00) is exactly **16 slots** of 30 minutes, indexed
0–15. Every time is integer minutes validated onto that grid:

- `"09:30"` *is* slot 1 — exactly.
- `"09:15"` is **refused** (off the half-hour grid), not silently rounded.
- `"17:00"` is **refused** (past the last slot) — the clinic is closed.

No `Date` arithmetic, no floating minutes that drift. Two appointments collide
only when their slot integers are equal, which makes "no double-booking" a
trivially correct integer comparison rather than a fuzzy time-overlap check.

### 3. The invariants are the objects' job, and booking is atomic

- A **`Doctor`** refuses a second patient in a slot it already holds (no
  double-booking) and refuses more than its daily cap (`maxPerDay`, default 16,
  the full day). A `Doctor` is correct on its own — even used directly, without
  the scheduler, it never breaks its own two rules.
- The **`Scheduler`** adds the one rule a lone doctor can't see: **a patient
  can't be in two places at the same instant.** Booking the same patient with a
  different doctor in the same slot is refused.
- Every booking is **atomic**: it passes *every* check before anything is
  written, so a rejected booking leaves both sides untouched. A **reschedule**
  validates the target slot *before* releasing the old one, so a bad move never
  loses the appointment.
- A patient's appointment list is **derived** by scanning the doctors'
  schedules — there is no second copy to fall out of sync, so what the patient
  sees and what the doctor holds can never disagree.

Because a full day has exactly 16 slots and the default cap is 16, the "16 per
day" limit and "every slot full" coincide at the top — but the cap is a separate,
testable rule: a doctor who runs a shorter clinic (say `maxPerDay: 4`) is refused
a 5th booking even though 12 slots are still open on the clock.

## The classes

| Class | Kind | Responsibility |
| --- | --- | --- |
| `Person` | abstract base | identity (`name`, `id`); declares `role`; can't be instantiated |
| `Patient` | subclass | a person who gets booked (plus an optional `reason`) |
| `Doctor` | subclass | owns a day book; enforces no-double-booking + the daily cap |
| `Appointment` | value object | an immutable (patient, doctor, day, slot) fact |
| `Scheduler` | aggregate | registers people; books/cancels/reschedules; enforces one-patient-one-place; keeps it all atomic |
| `Slot` | helper | the 16-slot time grid: parse/format times, convert ↔ slot index |

## Run it

No dependencies, no build step.

```bash
# the engine's proof suite (77 checks)
node tests.js

# the CLI — prints the sample clinic's day grid, then a REPL
node scheduler-node.js

# drive it with piped commands
echo "add doctor 'Dr. House' Diagnostics 3; add patient 'Zoe' checkup; booknext Zoe House; day" \
     | node scheduler-node.js --empty

# the clinic as JSON
node scheduler-node.js --json
```

Open **`index.html`** in a browser for the visual version: a live day grid (one
column per doctor, one row per slot), click a free cell to book the selected
patient or a filled cell to cancel, with the daily cap shown per doctor.

## Files

- `scheduler-core.js` — the engine: `Person`/`Patient`/`Doctor`, `Appointment`,
  `Scheduler`, and the `Slot` grid helper. DOM-free, no dependencies.
- `scheduler-fixtures.js` — a sample clinic shared by all three front ends.
- `scheduler-node.js` — the CLI / REPL.
- `tests.js` — 77 dependency-free assertions over the design's guarantees.
- `index.html` / `script.js` / `style.css` — the browser front end.

---

*Part of [AppIdeasAutomated](../../../README.md) — one project a day, built by an
automated Claude Code routine.*
