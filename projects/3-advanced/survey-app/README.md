# Survey App

A **Tier 3 (Advanced)** project, built by the automated Claude routine from the
[app-ideas Survey App spec](https://github.com/florinpop17/app-ideas/blob/master/Projects/3-Advanced/Survey-App.md).

> "The Survey App enables feedback collection through a full-featured survey
> platform… dividing users into two roles with distinct permissions."

A two-role survey platform: **coordinators** sign in to author surveys, open and
close them, and read the results; **respondents** answer whatever is open and can
review the results of anything that's closed.

Open `index.html` in a browser. **No build step, no server, and no
dependencies** — an HTML page and two scripts. A demo survey ("Team
Retrospective") is seeded and already open so there's something to answer on the
first visit.

## The whole point: two roles, one shared site

The spec's defining feature is the split between **survey coordinators** and
**survey respondents**, on the same website, with different permissions. That
split is enforced in the engine, not just hidden in the UI: every administrative
method (`createSurvey`, `openSurvey`, `closeSurvey`) demands an *authenticated
coordinator session* and throws without one. A respondent can answer an open
survey and read a closed one — nothing more.

## User stories from the spec

**Coordinators**

- ✅ **Authenticate to reach admin functions** — a sign-in gate (demo password
  `admin`); the engine rejects any admin call without an authenticated session.
- ✅ **Create a survey with 1–10 multiple-choice questions** — enforced as a hard
  limit in `validateSurveyDraft()`.
- ✅ **1–5 mutually-exclusive options per question** — also validated, including a
  duplicate-option check so the choices really are mutually exclusive.
- ✅ **Title entry with save / cancel** — the builder has both.
- ✅ **Open and close surveys for responses** — the lifecycle is
  `draft → open → closed`; a closed survey can't be reopened.
- ✅ **View results in tabular form** — per-option response counts and percentages.

**Respondents**

- ✅ **Complete open surveys** — only surveys with status `open` accept responses.
- ✅ **One selection per question** — the answer form uses radio buttons and the
  engine rejects anything else.
- ✅ **Validation errors on incomplete submissions** — every question must be
  answered; the engine returns a per-question error list and the UI shows it.
- ✅ **View closed-survey results** — the same results view, open to respondents
  once a survey is closed.

### Bonus features

- ✅ **Prevention of duplicate submissions** — each respondent gets a stable
  per-browser id (in `localStorage`); the engine remembers who has answered and
  blocks a second submission.
- ✅ **Graphical result visualisation** — results render as horizontal bar charts
  (built from the same tabulated counts, no charting library).
- ⬜ Respondent account creation / login — the engine already keys duplicate
  prevention on an opaque `respondentId`, so wiring real accounts in would be a
  UI change, not an engine one.

## Architecture — engine vs. presentation

As with every other advanced project here, all the logic lives in a
**presentation-free engine** (`survey-core.js`) that never touches the DOM, a
timer, or `localStorage`:

- `survey-core.js` — the two-role permission model, `validateSurveyDraft()` (the
  1–10 / 1–5 rules and the mutually-exclusive-options check), `createSurveyApp()`
  (the survey store, the open/close lifecycle, single-selection submission with
  validation, duplicate prevention, and result tabulation with counts and
  percentages). Every returned object is a defensive copy, so a caller can't
  reach in and mutate the store.
- `script.js` — the browser layer: the role tabs, the coordinator sign-in, the
  survey builder (add/remove questions and options within the limits), the
  answer form, and the bar-chart results.
- `index.html` / `style.css` — the page and its styling.
- `tests.js` — the test suite.

Because both the UI and the tests call the *same* `validateSurveyDraft()`, the
inline builder errors and the engine's guarantees can never drift apart.

## Running the tests

```bash
node tests.js
```

52 assertions cover coordinator authentication, the permission model (a
respondent or an unauthenticated session is refused every admin action), draft
validation (title required, the 1–10 question and 1–5 option limits at their
exact boundaries, duplicate options, blank text), the `draft → open → closed`
lifecycle and the no-reopen rule, submission validation (not-open, incomplete,
out-of-range selection, unknown survey), duplicate-submission prevention, result
tabulation (counts and rounded percentages, including the empty case), listing
open vs. all surveys, and the defensive-copy immutability of returned data.

## A note on faithfulness

A production version wouldn't change the engine at all: it would swap the
in-memory store for a database and the shared demo password for real coordinator
accounts, and add the respondent-account bonus on top of the `respondentId` hook
that's already there. The permission model, the creation rules, the submission
validation, the duplicate rule, and the result maths — the parts the tests pin
down — would carry over unchanged.
