/*
 * script.js — the browser layer for the Survey App.
 *
 * It owns the DOM, the two role views, and the survey builder. All the actual
 * survey logic — creation rules, the open/close lifecycle, submission
 * validation, duplicate prevention, result tabulation — lives in the
 * presentation-free engine (survey-core.js), which this file only calls into
 * and renders.
 *
 * State is kept in memory for the session and seeded with one demo survey so a
 * first-time visitor has something to answer. A per-browser respondent token
 * (in localStorage) gives the engine a stable id so the "one response per
 * person" rule has something to key on.
 */

"use strict";

(function () {
  const app = createSurveyApp({ coordinatorPassword: "admin" });
  const LIM = app.limits;

  // A stable per-browser id so duplicate-submission prevention works.
  function respondentId() {
    try {
      let id = localStorage.getItem("survey-app:respondent");
      if (!id) {
        id = "r-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem("survey-app:respondent", id);
      }
      return id;
    } catch (e) {
      return "r-anon"; // storage blocked — degrade to a single anon id.
    }
  }

  // ---- Seed a demo survey so the page isn't empty on first view. ----------
  const coord = { role: "coordinator", authenticated: true };
  (function seed() {
    const demo = app.createSurvey(coord, {
      title: "Team Retrospective",
      questions: [
        { text: "How was this sprint overall?", options: ["Great", "Okay", "Rough"] },
        { text: "Biggest area to improve?", options: ["Planning", "Testing", "Communication"] },
      ],
    });
    app.openSurvey(coord, demo.id);
  })();

  // ---- Element helpers ----------------------------------------------------
  const $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function statusBadge(status) {
    const b = el("span", "badge badge--" + status, status);
    return b;
  }

  // ---- Session state ------------------------------------------------------
  let coordinator = null; // set once signed in

  // ================= ROLE SWITCHING =================
  const tabResp = $("tab-respondent");
  const tabCoord = $("tab-coordinator");
  function showRole(role) {
    const isResp = role === "respondent";
    tabResp.classList.toggle("is-active", isResp);
    tabCoord.classList.toggle("is-active", !isResp);
    $("view-respondent").hidden = !isResp;
    $("view-coordinator").hidden = isResp;
    if (isResp) renderRespondentLists();
    else renderCoordinator();
  }
  tabResp.addEventListener("click", function () { showRole("respondent"); });
  tabCoord.addEventListener("click", function () { showRole("coordinator"); });

  // ================= RESPONDENT VIEW =================
  const picker = $("respondent-picker");
  const answerPane = $("respondent-answer");
  const resultsPane = $("respondent-results");

  function showRespondentPane(which) {
    picker.hidden = which !== "picker";
    answerPane.hidden = which !== "answer";
    resultsPane.hidden = which !== "results";
  }

  function renderRespondentLists() {
    showRespondentPane("picker");
    const surveys = app.listSurveys();
    const open = surveys.filter(function (s) { return s.status === "open"; });
    const closed = surveys.filter(function (s) { return s.status === "closed"; });

    const openList = $("open-list");
    openList.innerHTML = "";
    $("no-open").hidden = open.length > 0;
    open.forEach(function (s) {
      openList.appendChild(surveyRow(s, [
        { label: "Answer", cls: "btn", fn: function () { openAnswer(s.id); } },
      ]));
    });

    const closedList = $("closed-list");
    closedList.innerHTML = "";
    $("no-closed").hidden = closed.length > 0;
    closed.forEach(function (s) {
      closedList.appendChild(surveyRow(s, [
        { label: "Results", cls: "btn btn--ghost", fn: function () { openRespondentResults(s.id); } },
      ]));
    });
  }

  function surveyRow(survey, actions) {
    const row = el("li", "survey-row");
    const meta = el("div", "survey-row__meta");
    const title = el("div", "survey-row__title", survey.title);
    title.appendChild(document.createTextNode(" "));
    title.appendChild(statusBadge(survey.status));
    const sub = el("div", "survey-row__sub",
      survey.questions.length + " question" + (survey.questions.length === 1 ? "" : "s") +
      " · " + survey.responseCount + " response" + (survey.responseCount === 1 ? "" : "s"));
    meta.appendChild(title);
    meta.appendChild(sub);
    row.appendChild(meta);
    const act = el("div", "survey-row__actions");
    actions.forEach(function (a) {
      const b = el("button", a.cls, a.label);
      b.type = "button";
      b.addEventListener("click", a.fn);
      act.appendChild(b);
    });
    row.appendChild(act);
    return row;
  }

  function openAnswer(surveyId) {
    const survey = app.getSurvey(surveyId);
    if (!survey) return;
    showRespondentPane("answer");
    $("answer-title").textContent = survey.title;
    $("answer-error").hidden = true;
    const form = $("answer-form");
    form.innerHTML = "";

    survey.questions.forEach(function (q, qi) {
      const block = el("div", "q-block");
      block.appendChild(el("div", "q-block__text", (qi + 1) + ". " + q.text));
      q.options.forEach(function (opt, oi) {
        const label = el("label", "opt");
        const input = document.createElement("input");
        input.type = "radio"; // single selection per question
        input.name = q.id;
        input.value = String(oi);
        label.appendChild(input);
        label.appendChild(el("span", null, opt));
        block.appendChild(label);
      });
      form.appendChild(block);
    });

    const submit = el("button", "btn", "Submit response");
    submit.type = "submit";
    form.appendChild(submit);

    form.onsubmit = function (e) {
      e.preventDefault();
      const answers = {};
      survey.questions.forEach(function (q) {
        const checked = form.querySelector('input[name="' + q.id + '"]:checked');
        if (checked) answers[q.id] = Number(checked.value);
      });
      const res = app.submitResponse(surveyId, respondentId(), answers);
      const errBox = $("answer-error");
      if (!res.ok) {
        errBox.hidden = false;
        errBox.className = "error";
        errBox.textContent = res.errors.join(" ");
        return;
      }
      errBox.hidden = false;
      errBox.className = "ok";
      errBox.textContent = "Thanks — your response was recorded.";
      submit.disabled = true;
    };
  }

  function openRespondentResults(surveyId) {
    showRespondentPane("results");
    $("results-title").textContent = "";
    renderResults(app.getResults(surveyId), $("results-title"), $("results-body"));
  }

  $("back-to-list").addEventListener("click", renderRespondentLists);
  $("results-back").addEventListener("click", renderRespondentLists);

  // ================= COORDINATOR VIEW =================
  const login = $("login");
  const admin = $("admin");
  const builder = $("builder");
  const adminResults = $("admin-results");

  function showCoordPane(which) {
    login.hidden = which !== "login";
    admin.hidden = which !== "admin";
    builder.hidden = which !== "builder";
    adminResults.hidden = which !== "results";
  }

  function renderCoordinator() {
    if (!coordinator) {
      showCoordPane("login");
    } else {
      renderAdminList();
    }
  }

  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    const pw = $("password").value;
    if (app.authenticateCoordinator(pw)) {
      coordinator = { role: "coordinator", authenticated: true };
      $("login-error").hidden = true;
      $("password").value = "";
      renderAdminList();
    } else {
      $("login-error").hidden = false;
    }
  });

  function renderAdminList() {
    showCoordPane("admin");
    const surveys = app.listSurveys();
    const list = $("admin-list");
    list.innerHTML = "";
    $("no-surveys").hidden = surveys.length > 0;
    surveys.forEach(function (s) {
      const actions = [];
      if (s.status === "draft") {
        actions.push({ label: "Open", cls: "btn", fn: function () { app.openSurvey(coordinator, s.id); renderAdminList(); } });
      } else if (s.status === "open") {
        actions.push({ label: "Close", cls: "btn btn--danger", fn: function () { app.closeSurvey(coordinator, s.id); renderAdminList(); } });
      }
      actions.push({ label: "Results", cls: "btn btn--ghost", fn: function () { openAdminResults(s.id); } });
      list.appendChild(surveyRow(s, actions));
    });
  }

  $("new-survey").addEventListener("click", openBuilder);
  $("cancel-survey").addEventListener("click", renderAdminList);

  // ---- Survey builder -----------------------------------------------------
  function openBuilder() {
    showCoordPane("builder");
    $("survey-title").value = "";
    $("builder-error").hidden = true;
    $("questions").innerHTML = "";
    addQuestionBlock(); // start with one question
  }

  function addQuestionBlock() {
    const container = $("questions");
    if (container.children.length >= LIM.MAX_QUESTIONS) {
      flashBuilderError("Maximum " + LIM.MAX_QUESTIONS + " questions.");
      return;
    }
    const qb = el("div", "qb");
    const head = el("div", "qb__head");
    head.appendChild(el("strong", null, "Question " + (container.children.length + 1)));
    const del = el("button", "link-btn", "remove");
    del.type = "button";
    del.addEventListener("click", function () {
      qb.remove();
      renumber();
    });
    head.appendChild(del);
    qb.appendChild(head);

    const text = document.createElement("input");
    text.type = "text";
    text.placeholder = "Question text";
    text.className = "qb__text-input";
    qb.appendChild(text);

    const opts = el("div", "qb__opts");
    qb.appendChild(opts);

    function addOpt() {
      if (opts.children.length >= LIM.MAX_OPTIONS) {
        flashBuilderError("Maximum " + LIM.MAX_OPTIONS + " options per question.");
        return;
      }
      const wrap = el("div", "qb__opt");
      const oi = document.createElement("input");
      oi.type = "text";
      oi.placeholder = "Option " + (opts.children.length + 1);
      wrap.appendChild(oi);
      const rm = el("button", "link-btn", "×");
      rm.type = "button";
      rm.title = "Remove option";
      rm.addEventListener("click", function () { wrap.remove(); });
      wrap.appendChild(rm);
      opts.appendChild(wrap);
    }
    addOpt();
    addOpt(); // two options by default

    const addOptBtn = el("button", "link-btn", "+ add option");
    addOptBtn.type = "button";
    addOptBtn.addEventListener("click", addOpt);
    qb.appendChild(addOptBtn);

    container.appendChild(qb);
  }

  function renumber() {
    Array.prototype.forEach.call($("questions").children, function (qb, i) {
      qb.querySelector("strong").textContent = "Question " + (i + 1);
    });
  }

  $("add-question").addEventListener("click", addQuestionBlock);

  function flashBuilderError(msg) {
    const e = $("builder-error");
    e.hidden = false;
    e.textContent = msg;
  }

  $("save-survey").addEventListener("click", function () {
    const draft = {
      title: $("survey-title").value,
      questions: Array.prototype.map.call($("questions").children, function (qb) {
        return {
          text: qb.querySelector(".qb__text-input").value,
          options: Array.prototype.map.call(qb.querySelectorAll(".qb__opt input"), function (i) {
            return i.value;
          }).filter(function (v) { return v.trim() !== ""; }),
        };
      }),
    };
    const check = validateSurveyDraft(draft);
    if (!check.valid) {
      flashBuilderError(check.errors.join(" "));
      return;
    }
    app.createSurvey(coordinator, draft);
    renderAdminList();
  });

  function openAdminResults(surveyId) {
    showCoordPane("results");
    renderResults(app.getResults(surveyId), $("admin-results-title"), $("admin-results-body"));
  }
  $("admin-results-back").addEventListener("click", renderAdminList);

  // ================= SHARED: results rendering =================
  function renderResults(results, titleEl, bodyEl) {
    if (!results) {
      titleEl.textContent = "No results";
      bodyEl.innerHTML = "";
      return;
    }
    titleEl.textContent = results.title + " — results";
    bodyEl.innerHTML = "";
    bodyEl.appendChild(el("p", "result-total",
      results.totalResponses + " total response" + (results.totalResponses === 1 ? "" : "s")));

    results.questions.forEach(function (q, qi) {
      const block = el("div", "result-q");
      block.appendChild(el("div", "result-q__text", (qi + 1) + ". " + q.text));
      q.options.forEach(function (opt) {
        const row = el("div", "bar-row");
        row.appendChild(el("div", "bar-row__label", opt.text));
        const track = el("div", "bar-track");
        const fill = el("div", "bar-fill");
        fill.style.width = opt.percentage + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("div", "bar-row__count", opt.count + " · " + opt.percentage + "%"));
        block.appendChild(row);
      });
      bodyEl.appendChild(block);
    });
  }

  // ---- Boot ---------------------------------------------------------------
  showRole("respondent");
})();
