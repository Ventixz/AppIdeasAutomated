/* Quiz App — vanilla JS, no dependencies.
   Flow: start screen -> one question at a time -> result screen.
   Best scores per quiz are remembered in localStorage. */
(function () {
  "use strict";

  const QUIZZES = window.QUIZZES || [];
  const STORE_KEY = "quiz-app:best";

  // ---- element refs -------------------------------------------------------
  const screens = {
    start: document.getElementById("start"),
    quiz: document.getElementById("quiz"),
    result: document.getElementById("result"),
  };
  const picker = document.getElementById("quiz-picker");
  const bestLine = document.getElementById("best-line");
  const startBtn = document.getElementById("start-btn");

  const progressEl = document.getElementById("progress");
  const timerEl = document.getElementById("timer");
  const trackFill = document.getElementById("track-fill");
  const questionEl = document.getElementById("question");
  const answersEl = document.getElementById("answers");
  const nextBtn = document.getElementById("next-btn");

  const verdictEl = document.getElementById("verdict");
  const scoreRing = document.getElementById("score-ring");
  const scorePct = document.getElementById("score-pct");
  const scoreLine = document.getElementById("score-line");
  const timeLine = document.getElementById("time-line");
  const bestResult = document.getElementById("best-result");
  const shareBtn = document.getElementById("share-btn");
  const retryBtn = document.getElementById("retry-btn");
  const shareNote = document.getElementById("share-note");

  // ---- run state ----------------------------------------------------------
  let quiz = null; // active quiz object
  let index = 0; // current question index
  let correct = 0; // number answered correctly
  let locked = false; // true once an answer is chosen for this question
  let startTime = 0; // ms timestamp when quiz began
  let tick = null; // setInterval handle for the timer

  // ---- helpers ------------------------------------------------------------
  function show(name) {
    Object.keys(screens).forEach((k) => (screens[k].hidden = k !== name));
  }

  function fmtTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function loadBest() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveBest(map) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(map));
    } catch (e) {
      /* storage unavailable — scores just won't persist */
    }
  }

  // ---- start screen -------------------------------------------------------
  function buildPicker() {
    QUIZZES.forEach((qz, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = qz.title;
      picker.appendChild(opt);
    });
    picker.addEventListener("change", showBestForSelection);
    showBestForSelection();
  }

  function showBestForSelection() {
    const qz = QUIZZES[Number(picker.value)];
    const best = loadBest()[qz.id];
    if (best) {
      bestLine.hidden = false;
      bestLine.textContent = `Best so far: ${best.correct}/${best.total} in ${fmtTime(best.time)}`;
    } else {
      bestLine.hidden = true;
    }
  }

  // ---- quiz flow ----------------------------------------------------------
  function startQuiz() {
    quiz = QUIZZES[Number(picker.value)];
    index = 0;
    correct = 0;
    startTime = Date.now();
    startTimer();
    show("quiz");
    renderQuestion();
  }

  function startTimer() {
    stopTimer();
    timerEl.textContent = "0:00";
    tick = setInterval(() => {
      timerEl.textContent = fmtTime(Date.now() - startTime);
    }, 250);
  }

  function stopTimer() {
    if (tick) clearInterval(tick);
    tick = null;
  }

  function renderQuestion() {
    locked = false;
    nextBtn.disabled = true;
    const item = quiz.questions[index];
    const total = quiz.questions.length;

    progressEl.textContent = `Question ${index + 1} / ${total}`;
    trackFill.style.width = `${(index / total) * 100}%`;
    questionEl.textContent = item.q;
    nextBtn.textContent = index === total - 1 ? "Finish" : "Next";

    answersEl.innerHTML = "";
    item.options.forEach((text, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "answer";
      btn.type = "button";
      btn.textContent = text;
      btn.addEventListener("click", () => choose(i, btn, item.answer));
      li.appendChild(btn);
      answersEl.appendChild(li);
    });
  }

  function choose(picked, btn, answer) {
    if (locked) return; // one answer per question
    locked = true;

    const buttons = answersEl.querySelectorAll(".answer");
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === answer) b.classList.add("correct");
    });
    if (picked === answer) {
      correct++;
    } else {
      btn.classList.add("wrong");
    }
    nextBtn.disabled = false;
  }

  function next() {
    if (!locked) return;
    index++;
    if (index < quiz.questions.length) {
      renderQuestion();
    } else {
      finish();
    }
  }

  // ---- result screen ------------------------------------------------------
  function finish() {
    stopTimer();
    const elapsed = Date.now() - startTime;
    const total = quiz.questions.length;
    const ratio = correct / total;
    const passed = ratio >= (quiz.pass || 0.6);

    // record personal best (higher score wins, ties broken by faster time)
    const map = loadBest();
    const prev = map[quiz.id];
    const isBest =
      !prev || correct > prev.correct || (correct === prev.correct && elapsed < prev.time);
    if (isBest) {
      map[quiz.id] = { correct, total, time: elapsed };
      saveBest(map);
    }
    const best = map[quiz.id];

    verdictEl.textContent = passed ? "You passed! 🎉" : "Keep practising 💪";
    verdictEl.className = passed ? "pass" : "fail";
    const pct = Math.round(ratio * 100);
    scorePct.textContent = `${pct}%`;
    scoreRing.style.setProperty("--pct", `${pct}`);
    scoreRing.dataset.state = passed ? "pass" : "fail";
    scoreLine.textContent = `${correct} / ${total}`;
    timeLine.textContent = fmtTime(elapsed);
    bestResult.textContent = `${best.correct}/${best.total} · ${fmtTime(best.time)}`;

    shareNote.hidden = true;
    show("result");

    // stash the latest run so the share button can describe it
    finish.last = { title: quiz.title, correct, total, time: fmtTime(elapsed) };
  }

  async function share() {
    const r = finish.last;
    if (!r) return;
    const text = `I scored ${r.correct}/${r.total} on the "${r.title}" quiz in ${r.time}!`;
    const url = location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Quiz App", text, url });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${text} ${url}`);
        flashShare("Result copied to clipboard ✓");
        return;
      }
    } catch (e) {
      /* user dismissed the share sheet — nothing to do */
      return;
    }
    flashShare(text);
  }

  function flashShare(msg) {
    shareNote.textContent = msg;
    shareNote.hidden = false;
  }

  function reset() {
    showBestForSelection();
    show("start");
  }

  // ---- wire up ------------------------------------------------------------
  buildPicker();
  startBtn.addEventListener("click", startQuiz);
  nextBtn.addEventListener("click", next);
  shareBtn.addEventListener("click", share);
  retryBtn.addEventListener("click", reset);
})();
