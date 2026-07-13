"use strict";

/* Card Memory Game
 * Flip cards to find matching pairs before the timer runs out.
 * Bonus features: Easy/Medium/Hard difficulty + persisted win/loss/best-time
 * records (stored in localStorage). */

const DIFFICULTIES = {
  easy:   { label: "Easy",   cols: 4, limit: 90  },   // 4x4 -> 8 pairs
  medium: { label: "Medium", cols: 6, limit: 120 },   // 6x6 -> 18 pairs
  hard:   { label: "Hard",   cols: 8, limit: 180 },   // 8x8 -> 32 pairs
};

// 32 distinct symbols — enough for the hardest board (32 pairs).
const SYMBOLS = [
  "🍎","🍌","🍇","🍓","🍑","🍍","🥝","🍒",
  "🐶","🐱","🦊","🐼","🐧","🦉","🐙","🦄",
  "⚽","🏀","🎸","🎲","🚀","⛵","🎯","🎈",
  "🌸","🌵","🍄","⭐","🔥","💎","🎃","👑",
];

const STORAGE_KEY = "card-memory-records";

/* ---- DOM ---------------------------------------------------------------- */
const el = {
  board:      document.getElementById("board"),
  difficulty: document.getElementById("difficulty"),
  start:      document.getElementById("start"),
  status:     document.getElementById("status"),
  timer:      document.getElementById("timer"),
  moves:      document.getElementById("moves"),
  pairs:      document.getElementById("pairs"),
  recordsBody:document.getElementById("records-body"),
  clearStats: document.getElementById("clear-stats"),
  overlay:    document.getElementById("overlay"),
  dialogTitle:document.getElementById("dialog-title"),
  dialogBody: document.getElementById("dialog-body"),
  dialogAgain:document.getElementById("dialog-again"),
};

/* ---- Game state --------------------------------------------------------- */
const state = {
  running: false,
  locked: false,       // true while a mismatched pair is flipping back
  first: null,         // first flipped card element in the current turn
  matched: 0,
  totalPairs: 0,
  moves: 0,
  elapsed: 0,
  limit: 0,
  tick: null,
  difficulty: "medium",
};

/* ---- Helpers ------------------------------------------------------------ */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ---- Records (localStorage) --------------------------------------------- */
function loadRecords() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { data = {}; }
  for (const key of Object.keys(DIFFICULTIES)) {
    data[key] = data[key] || { wins: 0, losses: 0, best: null };
  }
  return data;
}

function saveRecords(records) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
  catch { /* storage disabled — records just won't persist */ }
}

function renderRecords() {
  const records = loadRecords();
  el.recordsBody.innerHTML = "";
  for (const key of Object.keys(DIFFICULTIES)) {
    const r = records[key];
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${DIFFICULTIES[key].label}</td>` +
      `<td>${r.wins}</td>` +
      `<td>${r.losses}</td>` +
      `<td>${r.best == null ? "—" : fmtTime(r.best)}</td>`;
    el.recordsBody.appendChild(tr);
  }
}

function recordResult(won) {
  const records = loadRecords();
  const r = records[state.difficulty];
  if (won) {
    r.wins += 1;
    if (r.best == null || state.elapsed < r.best) r.best = state.elapsed;
  } else {
    r.losses += 1;
  }
  saveRecords(records);
  renderRecords();
}

/* ---- Timer -------------------------------------------------------------- */
function startTimer() {
  clearInterval(state.tick);
  state.tick = setInterval(() => {
    state.elapsed += 1;
    el.timer.textContent = fmtTime(state.elapsed);
    if (state.elapsed >= state.limit) endGame(false);
  }, 1000);
}

function stopTimer() { clearInterval(state.tick); state.tick = null; }

/* ---- Board build -------------------------------------------------------- */
function buildBoard() {
  const { cols } = DIFFICULTIES[state.difficulty];
  const pairCount = (cols * cols) / 2;
  state.totalPairs = pairCount;

  const faces = shuffle(
    SYMBOLS.slice(0, pairCount).flatMap((sym) => [sym, sym])
  );

  el.board.style.setProperty("--cols", cols);
  el.board.innerHTML = "";

  faces.forEach((symbol) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.dataset.symbol = symbol;
    card.setAttribute("role", "gridcell");
    card.setAttribute("aria-label", "Hidden card");
    card.innerHTML =
      `<span class="card__inner">` +
        `<span class="card__face card__face--back" aria-hidden="true"></span>` +
        `<span class="card__face card__face--front">${symbol}</span>` +
      `</span>`;
    card.addEventListener("click", () => onCardClick(card));
    el.board.appendChild(card);
  });
}

/* ---- Turn logic --------------------------------------------------------- */
function onCardClick(card) {
  if (!state.running || state.locked) return;
  if (card.classList.contains("is-flipped") || card.classList.contains("is-matched")) return;

  flip(card, true);

  if (!state.first) {
    state.first = card;
    return;
  }

  // Second card of the turn.
  state.moves += 1;
  el.moves.textContent = state.moves;

  const a = state.first;
  const b = card;
  state.first = null;

  if (a.dataset.symbol === b.dataset.symbol) {
    a.classList.add("is-matched");
    b.classList.add("is-matched");
    a.disabled = true;
    b.disabled = true;
    a.setAttribute("aria-label", `Matched ${a.dataset.symbol}`);
    b.setAttribute("aria-label", `Matched ${b.dataset.symbol}`);
    state.matched += 1;
    el.pairs.textContent = `${state.matched} / ${state.totalPairs}`;
    if (state.matched === state.totalPairs) endGame(true);
  } else {
    state.locked = true;
    setTimeout(() => {
      flip(a, false);
      flip(b, false);
      state.locked = false;
    }, 750);
  }
}

function flip(card, faceUp) {
  card.classList.toggle("is-flipped", faceUp);
  card.setAttribute("aria-label", faceUp ? `Card ${card.dataset.symbol}` : "Hidden card");
}

/* ---- Game lifecycle ----------------------------------------------------- */
function startGame() {
  state.difficulty = el.difficulty.value;
  const cfg = DIFFICULTIES[state.difficulty];

  state.running = true;
  state.locked = false;
  state.first = null;
  state.matched = 0;
  state.moves = 0;
  state.elapsed = 0;
  state.limit = cfg.limit;

  el.moves.textContent = "0";
  el.timer.textContent = "0:00";
  el.overlay.hidden = true;
  el.start.textContent = "Restart";

  buildBoard();
  el.pairs.textContent = `0 / ${state.totalPairs}`;
  el.status.innerHTML =
    `Find all <strong>${state.totalPairs}</strong> pairs before ` +
    `<strong>${fmtTime(cfg.limit)}</strong> runs out.`;

  startTimer();
}

function endGame(won) {
  if (!state.running) return;
  state.running = false;
  state.locked = true;
  stopTimer();
  recordResult(won);

  // Reveal remaining cards on a loss so the player sees the answers.
  if (!won) {
    el.board.querySelectorAll(".card:not(.is-matched)").forEach((c) => {
      c.classList.add("is-flipped");
      c.disabled = true;
    });
  }

  if (won) {
    el.dialogTitle.textContent = "🎉 Congratulations!";
    el.dialogBody.innerHTML =
      `You matched all ${state.totalPairs} pairs in ` +
      `<strong>${fmtTime(state.elapsed)}</strong> ` +
      `with <strong>${state.moves}</strong> moves.`;
    el.status.textContent = "Solved! 🎉";
  } else {
    el.dialogTitle.textContent = "⏰ Time's up!";
    el.dialogBody.innerHTML =
      `You found <strong>${state.matched} / ${state.totalPairs}</strong> pairs. ` +
      `Try again — you've got this.`;
    el.status.textContent = "Out of time.";
  }
  el.overlay.hidden = false;
  el.dialogAgain.focus();
}

/* ---- Wire-up ------------------------------------------------------------ */
el.start.addEventListener("click", startGame);
el.dialogAgain.addEventListener("click", startGame);
el.clearStats.addEventListener("click", () => {
  saveRecords({});
  renderRecords();
  el.status.textContent = "Records cleared.";
});
el.overlay.addEventListener("click", (e) => {
  if (e.target === el.overlay) el.overlay.hidden = true;
});

renderRecords();
