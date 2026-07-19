/*
 * Flashcards App — UI wiring, random card selection, distractor generation,
 * scoring, and the bonus Results / Reset / Shuffle / More Info controls.
 *
 * DECK comes from deck.js (loaded first). It is never mutated: `order` holds a
 * shuffled list of indices into DECK, and `pos` walks through it.
 */
(function () {
  "use strict";

  // ---- state ---------------------------------------------------------------
  let order = [];       // shuffled indices into DECK
  let pos = -1;         // position within `order`
  let current = null;   // { card, options, answered }
  let correct = 0;
  let attempts = 0;

  // ---- elements ------------------------------------------------------------
  const el = {
    deckLabel: document.getElementById("deck-label"),
    scoreMini: document.getElementById("score-mini"),
    question: document.getElementById("question"),
    options: document.getElementById("options"),
    feedback: document.getElementById("feedback"),
    info: document.getElementById("info"),
    moreInfo: document.getElementById("more-info"),
    next: document.getElementById("next"),
    results: document.getElementById("results"),
    shuffle: document.getElementById("shuffle"),
    reset: document.getElementById("reset"),
    resultsPanel: document.getElementById("results-panel"),
  };

  // ---- helpers -------------------------------------------------------------
  const LETTERS = ["A", "B", "C", "D"];

  // Fisher–Yates: returns a new shuffled copy, leaving the input untouched.
  function shuffled(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Build four options for a card: the correct answer plus three distractors
  // drawn at random from *other* cards' answers (per the spec), all shuffled.
  function buildOptions(cardIndex) {
    const card = DECK[cardIndex];
    const distractors = shuffled(
      DECK
        .filter((_, i) => i !== cardIndex)
        .map((c) => c.answer)
        // guard against duplicate answer text colliding with the correct one
        .filter((a) => a !== card.answer)
    ).slice(0, 3);
    return shuffled([card.answer, ...distractors]);
  }

  function renderScore() {
    el.scoreMini.textContent = correct + " / " + attempts;
    el.deckLabel.textContent = "Card " + (pos + 1) + " of " + order.length;
  }

  // ---- rendering a card ----------------------------------------------------
  function showCard() {
    const cardIndex = order[pos];
    const card = DECK[cardIndex];
    current = { card, options: buildOptions(cardIndex), answered: false };

    el.question.textContent = card.question;
    el.feedback.textContent = "";
    el.feedback.className = "feedback";
    el.info.hidden = true;
    el.info.textContent = "";
    el.moreInfo.textContent = "More Info";
    el.resultsPanel.hidden = true;

    el.options.innerHTML = "";
    current.options.forEach((text, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.innerHTML =
        '<span class="option__key">' + LETTERS[i] + "</span>" +
        '<span class="option__text"></span>';
      btn.querySelector(".option__text").textContent = text;
      btn.addEventListener("click", () => onAnswer(btn, text));
      li.appendChild(btn);
      el.options.appendChild(li);
    });

    renderScore();
  }

  // Advance to the next card, wrapping around the shuffled deck.
  function nextCard() {
    if (order.length === 0) return;
    pos = (pos + 1) % order.length;
    showCard();
  }

  // ---- answering ----------------------------------------------------------
  function onAnswer(btn, text) {
    if (current.answered) return; // one attempt per card
    current.answered = true;
    attempts += 1;

    const isCorrect = text === current.card.answer;
    if (isCorrect) correct += 1;

    // Lock every option, then mark the correct one and the wrong pick.
    el.options.querySelectorAll(".option").forEach((o) => {
      o.disabled = true;
      const label = o.querySelector(".option__text").textContent;
      if (label === current.card.answer) o.classList.add("option--correct");
    });
    if (!isCorrect) btn.classList.add("option--wrong");

    el.feedback.textContent = isCorrect
      ? "🎉 Correct — nicely done!"
      : "❌ Not quite. The answer is “" + current.card.answer + "”.";
    el.feedback.className = "feedback " + (isCorrect ? "feedback--ok" : "feedback--err");

    renderScore();
  }

  // ---- bonus controls ------------------------------------------------------
  function toggleInfo() {
    if (!current) return;
    const showing = !el.info.hidden;
    if (showing) {
      el.info.hidden = true;
      el.moreInfo.textContent = "More Info";
    } else {
      el.info.textContent = current.card.info || "No extra info for this card.";
      el.info.hidden = false;
      el.moreInfo.textContent = "Hide Info";
    }
  }

  function showResults() {
    const wrong = attempts - correct;
    const pct = attempts ? Math.round((correct / attempts) * 100) : 0;
    el.resultsPanel.innerHTML =
      "<strong>Results</strong>" +
      '<div class="results-panel__grid">' +
      '<span>✅ Correct</span><span>' + correct + "</span>" +
      '<span>❌ Incorrect</span><span>' + wrong + "</span>" +
      '<span>📊 Answered</span><span>' + attempts + "</span>" +
      '<span>🎯 Accuracy</span><span>' + pct + "%</span>" +
      "</div>";
    el.resultsPanel.hidden = false;
  }

  function resetScore() {
    correct = 0;
    attempts = 0;
    el.resultsPanel.hidden = true;
    renderScore();
    // Re-render the current card so its options unlock for a fresh attempt.
    if (pos >= 0) showCard();
  }

  function shuffleDeck() {
    order = shuffled(DECK.map((_, i) => i));
    pos = -1;
    el.resultsPanel.hidden = true;
    nextCard();
  }

  // ---- init ----------------------------------------------------------------
  el.next.addEventListener("click", nextCard);
  el.moreInfo.addEventListener("click", toggleInfo);
  el.results.addEventListener("click", showResults);
  el.reset.addEventListener("click", resetScore);
  el.shuffle.addEventListener("click", shuffleDeck);

  // Keyboard: 1–4 pick options, Enter/→ goes to the next card.
  document.addEventListener("keydown", (e) => {
    if (["1", "2", "3", "4"].includes(e.key)) {
      const btn = el.options.querySelectorAll(".option")[Number(e.key) - 1];
      if (btn && !btn.disabled) btn.click();
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      nextCard();
    }
  });

  order = shuffled(DECK.map((_, i) => i));
  nextCard();
})();
