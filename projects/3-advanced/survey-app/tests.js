/*
 * tests.js — Node test suite for the Survey App engine (survey-core.js).
 *
 * Run with:  node tests.js
 *
 * The engine is presentation-free, so every user story that isn't literally a
 * pixel is pinned down here: the two-role permission model, the creation rules
 * (1–10 questions, 1–5 mutually-exclusive options), the open/close lifecycle,
 * single-selection submission with its validation errors, duplicate-submission
 * prevention (the bonus), and result tabulation with counts and percentages.
 */

"use strict";

const Core = require("./survey-core.js");
const { createSurveyApp, validateSurveyDraft } = Core;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error("  ✗ " + msg);
  }
}

function assertEqual(actual, expected, msg) {
  assert(actual === expected, msg + " (expected " + expected + ", got " + actual + ")");
}

function assertThrows(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  assert(threw, msg);
}

// Convenience: an authenticated coordinator session and a valid draft.
const coordinator = { role: "coordinator", authenticated: true };
const respondentSession = { role: "respondent", authenticated: false };

function sampleDraft() {
  return {
    title: "Lunch Poll",
    questions: [
      { text: "Favourite cuisine?", options: ["Pizza", "Sushi", "Tacos"] },
      { text: "Eat in or take out?", options: ["In", "Out"] },
    ],
  };
}

// --- Authentication --------------------------------------------------------

(function testAuth() {
  const app = createSurveyApp({ coordinatorPassword: "s3cret" });
  assert(app.authenticateCoordinator("s3cret") === true, "correct password authenticates");
  assert(app.authenticateCoordinator("nope") === false, "wrong password rejected");

  const app2 = createSurveyApp();
  assert(app2.authenticateCoordinator("admin") === true, "default password is admin");
})();

// --- Permission model ------------------------------------------------------

(function testPermissions() {
  const app = createSurveyApp();
  assertThrows(function () {
    app.createSurvey(respondentSession, sampleDraft());
  }, "respondent cannot create a survey");
  assertThrows(function () {
    app.createSurvey(null, sampleDraft());
  }, "no session cannot create a survey");
  assertThrows(function () {
    app.createSurvey({ role: "coordinator", authenticated: false }, sampleDraft());
  }, "unauthenticated coordinator cannot create a survey");

  // A valid coordinator can.
  const survey = app.createSurvey(coordinator, sampleDraft());
  assert(survey && survey.id, "authenticated coordinator can create a survey");
  assertThrows(function () {
    app.openSurvey(respondentSession, survey.id);
  }, "respondent cannot open a survey");
  assertThrows(function () {
    app.closeSurvey(respondentSession, survey.id);
  }, "respondent cannot close a survey");
})();

// --- Draft validation ------------------------------------------------------

(function testValidation() {
  assert(validateSurveyDraft(sampleDraft()).valid, "a well-formed draft validates");

  assert(!validateSurveyDraft({ title: "", questions: sampleDraft().questions }).valid,
    "empty title is invalid");

  assert(!validateSurveyDraft({ title: "X", questions: [] }).valid,
    "zero questions is invalid");

  const eleven = { title: "X", questions: [] };
  for (let i = 0; i < 11; i++) {
    eleven.questions.push({ text: "Q" + i, options: ["a", "b"] });
  }
  assert(!validateSurveyDraft(eleven).valid, "eleven questions exceeds the max of 10");

  const tenOk = { title: "X", questions: [] };
  for (let i = 0; i < 10; i++) {
    tenOk.questions.push({ text: "Q" + i, options: ["a", "b"] });
  }
  assert(validateSurveyDraft(tenOk).valid, "exactly ten questions is allowed");

  assert(!validateSurveyDraft({ title: "X", questions: [{ text: "Q", options: [] }] }).valid,
    "zero options is invalid");

  assert(!validateSurveyDraft({
    title: "X",
    questions: [{ text: "Q", options: ["a", "b", "c", "d", "e", "f"] }],
  }).valid, "six options exceeds the max of 5");

  assert(validateSurveyDraft({
    title: "X",
    questions: [{ text: "Q", options: ["a"] }],
  }).valid, "a single option is allowed (min is 1)");

  assert(!validateSurveyDraft({
    title: "X",
    questions: [{ text: "Q", options: ["Yes", "yes"] }],
  }).valid, "duplicate options (case-insensitive) are rejected");

  assert(!validateSurveyDraft({
    title: "X",
    questions: [{ text: "  ", options: ["a", "b"] }],
  }).valid, "blank question text is invalid");

  // createSurvey should refuse an invalid draft and expose the errors.
  const app = createSurveyApp();
  let caught = null;
  try {
    app.createSurvey(coordinator, { title: "", questions: [] });
  } catch (e) {
    caught = e;
  }
  assert(caught && Array.isArray(caught.errors) && caught.errors.length > 0,
    "createSurvey throws with an errors array for a bad draft");
})();

// --- Lifecycle -------------------------------------------------------------

(function testLifecycle() {
  const app = createSurveyApp();
  const survey = app.createSurvey(coordinator, sampleDraft());
  assertEqual(survey.status, "draft", "a new survey starts as a draft");

  const opened = app.openSurvey(coordinator, survey.id);
  assertEqual(opened.status, "open", "openSurvey opens it");

  const closed = app.closeSurvey(coordinator, survey.id);
  assertEqual(closed.status, "closed", "closeSurvey closes it");

  assertThrows(function () {
    app.openSurvey(coordinator, survey.id);
  }, "a closed survey cannot be reopened");

  assertThrows(function () {
    app.openSurvey(coordinator, "survey-999");
  }, "opening an unknown survey throws");

  assert(app.getSurvey("survey-999") === null, "getSurvey returns null for unknown id");
})();

// --- Submission: validation ------------------------------------------------

(function testSubmissionValidation() {
  const app = createSurveyApp();
  const survey = app.createSurvey(coordinator, sampleDraft());
  const q0 = survey.questions[0].id;
  const q1 = survey.questions[1].id;

  // Not open yet.
  let r = app.submitResponse(survey.id, "alice", { [q0]: 0, [q1]: 0 });
  assert(!r.ok, "cannot submit to a survey that isn't open");

  app.openSurvey(coordinator, survey.id);

  // Incomplete — only one question answered.
  r = app.submitResponse(survey.id, "alice", { [q0]: 0 });
  assert(!r.ok, "incomplete submission is rejected");
  assert(r.errors.length === 1, "one missing-answer error reported");

  // Out-of-range option index.
  r = app.submitResponse(survey.id, "alice", { [q0]: 0, [q1]: 9 });
  assert(!r.ok, "out-of-range selection is rejected");

  // Unknown survey.
  r = app.submitResponse("survey-999", "alice", {});
  assert(!r.ok, "submitting to an unknown survey fails");

  // A complete, valid submission.
  r = app.submitResponse(survey.id, "alice", { [q0]: 1, [q1]: 0 });
  assert(r.ok, "a complete valid submission succeeds");
})();

// --- Duplicate prevention (bonus) -----------------------------------------

(function testDuplicatePrevention() {
  const app = createSurveyApp();
  const survey = app.createSurvey(coordinator, sampleDraft());
  const q0 = survey.questions[0].id;
  const q1 = survey.questions[1].id;
  app.openSurvey(coordinator, survey.id);

  const first = app.submitResponse(survey.id, "bob", { [q0]: 0, [q1]: 1 });
  assert(first.ok, "bob's first submission succeeds");

  const second = app.submitResponse(survey.id, "bob", { [q0]: 2, [q1]: 0 });
  assert(!second.ok, "bob's second submission is blocked as a duplicate");

  const other = app.submitResponse(survey.id, "carol", { [q0]: 0, [q1]: 0 });
  assert(other.ok, "a different respondent can still submit");

  const results = app.getResults(survey.id);
  assertEqual(results.totalResponses, 2, "only two responses recorded (dup ignored)");
})();

// --- Results tabulation ----------------------------------------------------

(function testResults() {
  const app = createSurveyApp();
  const survey = app.createSurvey(coordinator, sampleDraft());
  const q0 = survey.questions[0].id; // Pizza / Sushi / Tacos
  const q1 = survey.questions[1].id; // In / Out
  app.openSurvey(coordinator, survey.id);

  // Empty results before anyone answers.
  let results = app.getResults(survey.id);
  assertEqual(results.totalResponses, 0, "no responses yet");
  assertEqual(results.questions[0].options[0].count, 0, "zero count with no responses");
  assertEqual(results.questions[0].options[0].percentage, 0, "zero percentage with no responses");

  // Three respondents: two pick Pizza, one picks Tacos; two pick In, one Out.
  app.submitResponse(survey.id, "u1", { [q0]: 0, [q1]: 0 });
  app.submitResponse(survey.id, "u2", { [q0]: 0, [q1]: 0 });
  app.submitResponse(survey.id, "u3", { [q0]: 2, [q1]: 1 });

  results = app.getResults(survey.id);
  assertEqual(results.totalResponses, 3, "three responses tabulated");
  assertEqual(results.questions[0].options[0].count, 2, "Pizza counted twice");
  assertEqual(results.questions[0].options[1].count, 0, "Sushi counted zero");
  assertEqual(results.questions[0].options[2].count, 1, "Tacos counted once");
  assertEqual(results.questions[0].options[0].percentage, 67, "Pizza is 67%");
  assertEqual(results.questions[1].options[0].count, 2, "In counted twice");
  assertEqual(results.questions[1].options[1].count, 1, "Out counted once");

  assert(app.getResults("survey-999") === null, "results for unknown survey is null");
})();

// --- Listing ---------------------------------------------------------------

(function testListing() {
  const app = createSurveyApp();
  const a = app.createSurvey(coordinator, sampleDraft());
  const b = app.createSurvey(coordinator, sampleDraft());
  app.openSurvey(coordinator, a.id);

  assertEqual(app.listSurveys().length, 2, "listSurveys returns all surveys");
  assertEqual(app.listOpenSurveys().length, 1, "listOpenSurveys returns only open ones");
  assertEqual(app.listOpenSurveys()[0].id, a.id, "the open one is survey a");
})();

// --- Immutability ----------------------------------------------------------

(function testImmutability() {
  const app = createSurveyApp();
  const survey = app.createSurvey(coordinator, sampleDraft());
  // Mutating the returned copy must not corrupt the store.
  survey.questions[0].options.push("HACK");
  survey.title = "changed";
  const fresh = app.getSurvey(survey.id);
  assertEqual(fresh.title, "Lunch Poll", "title unchanged by caller mutation");
  assertEqual(fresh.questions[0].options.length, 3, "options unchanged by caller mutation");
})();

// --- Report ----------------------------------------------------------------

console.log("\nSurvey App engine tests");
console.log("  passed: " + passed);
if (failed > 0) {
  console.log("  failed: " + failed);
  process.exit(1);
} else {
  console.log("  all green ✓");
}
