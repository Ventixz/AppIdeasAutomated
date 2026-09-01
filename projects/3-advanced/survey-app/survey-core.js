/*
 * survey-core.js — the presentation-free engine for the Survey App.
 *
 * It knows nothing about the DOM, the browser, timers, or charts. Everything a
 * test could care about lives here: the two-role model (coordinators author and
 * administer surveys; respondents answer open ones), the creation rules from the
 * spec (1–10 questions, 1–5 mutually exclusive options each), the open/close
 * lifecycle, the single-selection-per-question submission rule with its
 * validation errors, duplicate-submission prevention, and result tabulation.
 *
 * The whole thing is a pure state machine: createSurveyApp() returns an object
 * of methods that mutate an in-memory store and return plain data. The browser
 * layer (script.js) renders that data; the tests (tests.js) assert on it.
 */

"use strict";

// --- Spec constants -------------------------------------------------------

const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 10;
const MIN_OPTIONS = 1;
const MAX_OPTIONS = 5;

// --- Small helpers --------------------------------------------------------

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// A tiny deterministic id generator so surveys and questions get stable,
// human-readable ids without pulling in a uuid dependency.
function makeIdFactory(prefix) {
  let n = 0;
  return function next() {
    n += 1;
    return prefix + "-" + n;
  };
}

/*
 * validateSurveyDraft(draft) — pure validation of a would-be survey.
 *
 * A draft looks like:
 *   { title: "Lunch poll",
 *     questions: [ { text: "Pizza?", options: ["Yes", "No"] }, ... ] }
 *
 * Returns { valid: boolean, errors: string[] }. Kept separate from creation so
 * both the engine and the UI can call it (the UI to show inline errors before
 * anyone hits save).
 */
function validateSurveyDraft(draft) {
  const errors = [];

  if (!draft || typeof draft !== "object") {
    return { valid: false, errors: ["A survey draft is required."] };
  }

  if (!isNonEmptyString(draft.title)) {
    errors.push("A survey needs a title.");
  }

  const questions = Array.isArray(draft.questions) ? draft.questions : [];
  if (questions.length < MIN_QUESTIONS) {
    errors.push("A survey needs at least " + MIN_QUESTIONS + " question.");
  }
  if (questions.length > MAX_QUESTIONS) {
    errors.push("A survey can have at most " + MAX_QUESTIONS + " questions.");
  }

  questions.forEach(function (q, i) {
    const label = "Question " + (i + 1);
    if (!q || typeof q !== "object") {
      errors.push(label + " is malformed.");
      return;
    }
    if (!isNonEmptyString(q.text)) {
      errors.push(label + " needs text.");
    }
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length < MIN_OPTIONS) {
      errors.push(label + " needs at least " + MIN_OPTIONS + " option.");
    }
    if (options.length > MAX_OPTIONS) {
      errors.push(label + " can have at most " + MAX_OPTIONS + " options.");
    }
    options.forEach(function (opt, j) {
      if (!isNonEmptyString(opt)) {
        errors.push(label + ", option " + (j + 1) + " is empty.");
      }
    });
    // Options must be mutually exclusive — no duplicated choices.
    const seen = new Set();
    options.forEach(function (opt) {
      if (isNonEmptyString(opt)) {
        const key = opt.trim().toLowerCase();
        if (seen.has(key)) {
          errors.push(label + " has a duplicate option: \"" + opt.trim() + "\".");
        }
        seen.add(key);
      }
    });
  });

  return { valid: errors.length === 0, errors: errors };
}

/*
 * createSurveyApp(options) — the engine factory.
 *
 * options.coordinatorPassword — the shared secret a coordinator authenticates
 *   with (the spec calls for coordinator login; respondents don't need it to
 *   answer an open survey). Defaults to "admin".
 */
function createSurveyApp(options) {
  const opts = options || {};
  const coordinatorPassword = opts.coordinatorPassword || "admin";

  const nextSurveyId = makeIdFactory("survey");
  const nextQuestionId = makeIdFactory("q");

  // surveyId -> survey record
  const surveys = new Map();

  // --- Authentication ----------------------------------------------------

  function authenticateCoordinator(password) {
    return password === coordinatorPassword;
  }

  function requireCoordinator(session) {
    if (!session || session.role !== "coordinator" || !session.authenticated) {
      throw new Error("This action requires an authenticated coordinator.");
    }
  }

  // --- Serialisation (defensive copies so callers can't mutate the store) --

  function publicSurvey(survey) {
    return {
      id: survey.id,
      title: survey.title,
      status: survey.status, // "draft" | "open" | "closed"
      questions: survey.questions.map(function (q) {
        return {
          id: q.id,
          text: q.text,
          options: q.options.slice(),
        };
      }),
      responseCount: survey.responses.length,
    };
  }

  // --- Coordinator: create ----------------------------------------------

  function createSurvey(session, draft) {
    requireCoordinator(session);
    const check = validateSurveyDraft(draft);
    if (!check.valid) {
      const err = new Error("Invalid survey: " + check.errors.join(" "));
      err.errors = check.errors;
      throw err;
    }

    const survey = {
      id: nextSurveyId(),
      title: draft.title.trim(),
      status: "draft",
      questions: draft.questions.map(function (q) {
        return {
          id: nextQuestionId(),
          text: q.text.trim(),
          options: q.options.map(function (o) {
            return o.trim();
          }),
        };
      }),
      responses: [], // each: { respondentId, answers: { questionId -> optionIndex } }
      respondents: new Set(), // ids that have already submitted (dup prevention)
    };
    surveys.set(survey.id, survey);
    return publicSurvey(survey);
  }

  // --- Coordinator: lifecycle -------------------------------------------

  function getRawOrThrow(surveyId) {
    const survey = surveys.get(surveyId);
    if (!survey) {
      throw new Error("No such survey: " + surveyId);
    }
    return survey;
  }

  function openSurvey(session, surveyId) {
    requireCoordinator(session);
    const survey = getRawOrThrow(surveyId);
    if (survey.status === "closed") {
      throw new Error("A closed survey can't be reopened.");
    }
    survey.status = "open";
    return publicSurvey(survey);
  }

  function closeSurvey(session, surveyId) {
    requireCoordinator(session);
    const survey = getRawOrThrow(surveyId);
    survey.status = "closed";
    return publicSurvey(survey);
  }

  // --- Reading -----------------------------------------------------------

  function listSurveys() {
    return Array.from(surveys.values()).map(publicSurvey);
  }

  function listOpenSurveys() {
    return listSurveys().filter(function (s) {
      return s.status === "open";
    });
  }

  function getSurvey(surveyId) {
    const survey = surveys.get(surveyId);
    return survey ? publicSurvey(survey) : null;
  }

  // --- Respondent: submit ------------------------------------------------

  /*
   * submitResponse(surveyId, respondentId, answers)
   *
   * answers is a map of questionId -> chosen option index (a single selection
   * per question, per the spec's checkbox rule). Returns { ok, errors }.
   *
   * respondentId is how duplicate submissions are detected. For anonymous use
   * the UI can pass a per-browser token; for the bonus "accounts" feature it's
   * the account id. The engine treats it opaquely.
   */
  function submitResponse(surveyId, respondentId, answers) {
    const survey = surveys.get(surveyId);
    if (!survey) {
      return { ok: false, errors: ["No such survey."] };
    }
    if (survey.status !== "open") {
      return { ok: false, errors: ["This survey isn't open for responses."] };
    }
    if (respondentId != null && survey.respondents.has(respondentId)) {
      return { ok: false, errors: ["You've already responded to this survey."] };
    }

    const answerMap = answers || {};
    const errors = [];
    const normalised = {};

    survey.questions.forEach(function (q, i) {
      const label = "Question " + (i + 1);
      const choice = answerMap[q.id];
      if (choice === undefined || choice === null || choice === "") {
        errors.push(label + " needs an answer.");
        return;
      }
      const idx = Number(choice);
      if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) {
        errors.push(label + " has an invalid selection.");
        return;
      }
      normalised[q.id] = idx;
    });

    if (errors.length > 0) {
      return { ok: false, errors: errors };
    }

    survey.responses.push({ respondentId: respondentId, answers: normalised });
    if (respondentId != null) {
      survey.respondents.add(respondentId);
    }
    return { ok: true, errors: [] };
  }

  // --- Results -----------------------------------------------------------

  /*
   * getResults(surveyId) — tabulate response counts per option.
   *
   * Returns null for an unknown survey, otherwise:
   *   { surveyId, title, status, totalResponses,
   *     questions: [ { id, text,
   *                    options: [ { text, count, percentage } ] } ] }
   *
   * Percentages are of the responses to that question (which, given the
   * all-or-nothing submission rule, equals totalResponses), rounded to a whole
   * number and always summing sensibly.
   */
  function getResults(surveyId) {
    const survey = surveys.get(surveyId);
    if (!survey) {
      return null;
    }
    const total = survey.responses.length;

    const questions = survey.questions.map(function (q) {
      const counts = q.options.map(function () {
        return 0;
      });
      survey.responses.forEach(function (r) {
        const idx = r.answers[q.id];
        if (typeof idx === "number" && idx >= 0 && idx < counts.length) {
          counts[idx] += 1;
        }
      });
      return {
        id: q.id,
        text: q.text,
        options: q.options.map(function (opt, j) {
          return {
            text: opt,
            count: counts[j],
            percentage: total === 0 ? 0 : Math.round((counts[j] / total) * 100),
          };
        }),
      };
    });

    return {
      surveyId: survey.id,
      title: survey.title,
      status: survey.status,
      totalResponses: total,
      questions: questions,
    };
  }

  return {
    // constants (handy for the UI)
    limits: {
      MIN_QUESTIONS: MIN_QUESTIONS,
      MAX_QUESTIONS: MAX_QUESTIONS,
      MIN_OPTIONS: MIN_OPTIONS,
      MAX_OPTIONS: MAX_OPTIONS,
    },
    authenticateCoordinator: authenticateCoordinator,
    createSurvey: createSurvey,
    openSurvey: openSurvey,
    closeSurvey: closeSurvey,
    listSurveys: listSurveys,
    listOpenSurveys: listOpenSurveys,
    getSurvey: getSurvey,
    submitResponse: submitResponse,
    getResults: getResults,
  };
}

// Export for Node (tests) while staying a plain global in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createSurveyApp: createSurveyApp,
    validateSurveyDraft: validateSurveyDraft,
    MIN_QUESTIONS: MIN_QUESTIONS,
    MAX_QUESTIONS: MAX_QUESTIONS,
    MIN_OPTIONS: MIN_OPTIONS,
    MAX_OPTIONS: MAX_OPTIONS,
  };
}
