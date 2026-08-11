// typing-core.js — DOM-free, deterministic core for the Typing Practice app.
//
// The whole game is modelled as an immutable value. Every function takes a state
// and returns a *new* state; nothing is mutated in place and nothing reaches for
// the clock, the DOM, or a random source on its own. Word advancement is a plain
// sequential walk over the provided `words` array, so a given sequence of inputs
// always produces the same sequence of states. That is what makes the whole thing
// testable in Node without a browser.

'use strict';

// Tuning constants for the "gets faster as you succeed" mechanic.
const INITIAL_INTERVAL = 3000; // ms allowed per word at the start
const MIN_INTERVAL = 800; // fastest we ever go
const DECAY = 0.92; // interval multiplier applied on each correct word

const DEFAULT_WORDS = [
  'ability', 'balance', 'candid', 'diagram', 'elegant', 'foundry',
  'gadget', 'harbor', 'insight', 'journal', 'kernel', 'lattice',
  'magnet', 'network', 'october', 'pattern', 'quorum', 'render',
  'signal', 'texture', 'utility', 'vector', 'window', 'yonder',
];

// A word is "correct" if it matches ignoring surrounding whitespace and case.
// Typing tutors are usually forgiving about capitalisation, so we are too.
function normalizeWord(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function matches(input, target) {
  return normalizeWord(input) === normalizeWord(target) && normalizeWord(target) !== '';
}

// Decrease the per-word interval a little, never dropping below the floor.
function decreaseInterval(ms) {
  const next = Math.round(ms * DECAY);
  return Math.max(MIN_INTERVAL, next);
}

// Build a fresh, not-yet-running session over a list of words.
function createSession(words, intervalMs) {
  const list = (Array.isArray(words) && words.length ? words : DEFAULT_WORDS).map(String);
  return {
    words: list,
    index: 0,
    currentWord: list[0],
    successes: 0,
    attempts: 0,
    streak: 0,
    bestStreak: 0,
    intervalMs: typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : INITIAL_INTERVAL,
    running: false,
    lastResult: null, // 'correct' | 'incorrect' | null
    message: 'Press Start to begin.',
  };
}

// Start (or restart) a session: counters reset, back to the first word, running.
function start(state) {
  return {
    ...state,
    index: 0,
    currentWord: state.words[0],
    successes: 0,
    attempts: 0,
    streak: 0,
    bestStreak: 0,
    intervalMs: INITIAL_INTERVAL,
    running: true,
    lastResult: null,
    message: 'Go! Type the word above.',
  };
}

function stop(state) {
  return { ...state, running: false, message: 'Stopped. Press Start to try again.' };
}

// Advance to the next word, wrapping around the list.
function nextIndex(state) {
  return (state.index + 1) % state.words.length;
}

// Submit what the user typed. Correct -> new word, faster interval, streak up.
// Incorrect -> same word stays, attempt counted, streak reset, retry message.
// A submission while stopped is a no-op.
function submit(state, input) {
  if (!state.running) return state;

  if (matches(input, state.currentWord)) {
    const successes = state.successes + 1;
    const streak = state.streak + 1;
    const idx = nextIndex(state);
    return {
      ...state,
      index: idx,
      currentWord: state.words[idx],
      successes,
      attempts: state.attempts + 1,
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
      intervalMs: decreaseInterval(state.intervalMs),
      lastResult: 'correct',
      message: `Nice! "${state.currentWord}" ✓  (${successes} correct)`,
    };
  }

  return {
    ...state,
    attempts: state.attempts + 1,
    streak: 0,
    lastResult: 'incorrect',
    message: 'Not quite — the input flashed and cleared. Try that word again.',
  };
}

// Timer ran out before a correct entry: counts as a missed attempt, word stays.
function expire(state) {
  if (!state.running) return state;
  return {
    ...state,
    attempts: state.attempts + 1,
    streak: 0,
    lastResult: 'incorrect',
    message: "Time's up on that word — give it another go.",
  };
}

// successes / attempts as a 0..1 fraction (0 when nothing attempted yet).
function accuracy(state) {
  return state.attempts === 0 ? 0 : state.successes / state.attempts;
}

// ---- Cumulative, cross-session stats (bonus: persistent tracking) ----------

function emptyStats() {
  return { sessions: 0, totalSuccesses: 0, totalAttempts: 0, bestStreak: 0 };
}

// Fold a finished session's numbers into the running totals.
function mergeStats(stats, session) {
  const s = normalizeStats(stats);
  return {
    sessions: s.sessions + 1,
    totalSuccesses: s.totalSuccesses + (session.successes || 0),
    totalAttempts: s.totalAttempts + (session.attempts || 0),
    bestStreak: Math.max(s.bestStreak, session.bestStreak || 0),
  };
}

// Recover a sane stats object from anything that came back out of storage:
// null, a string, a partial object, negative or non-numeric fields.
function normalizeStats(raw) {
  const base = emptyStats();
  if (!raw || typeof raw !== 'object') return base;
  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    sessions: num(raw.sessions),
    totalSuccesses: num(raw.totalSuccesses),
    totalAttempts: num(raw.totalAttempts),
    bestStreak: num(raw.bestStreak),
  };
}

const API = {
  INITIAL_INTERVAL,
    MIN_INTERVAL,
    DECAY,
    DEFAULT_WORDS,
    normalizeWord,
    matches,
    decreaseInterval,
    createSession,
    start,
    stop,
    submit,
    expire,
    accuracy,
    emptyStats,
    mergeStats,
    normalizeStats,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
if (typeof window !== 'undefined') {
  window.typingCore = API;
}
