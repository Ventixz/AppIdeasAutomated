// quiz-core.js — the part of Quiz Maker that actually matters.
//
// Source 2 (karan/Projects) · Files category · "Quiz Maker":
//   "Make an application which takes various questions from a file, picked
//    randomly, and puts together a quiz for students. [...] generate a
//    different quiz each time, and grade the completed quizzes with an answer
//    key."
//
// This module does four things and nothing else, so each can be tested in Node
// without a browser:
//   1. parseBank(text)      — turn a forgiving plain-text question file into a
//                             validated question bank (with precise errors).
//   2. assembleQuiz(bank)   — pick N questions at random (seeded, reproducible),
//                             shuffle them and their options, and split the
//                             result into a STUDENT quiz and a separate ANSWER
//                             KEY.
//   3. grade(quiz, key, …)  — mark a completed quiz against its key.
//   4. serializeBank(bank)  — write a bank back out in the same file format.
//
// No dependencies. Works under Node (module.exports) and the browser (window).

'use strict';

// ---------------------------------------------------------------------------
// Seeded RNG — grading only works if "a random quiz" is reproducible. A quiz
// assembled from a given seed must come out identical every time (so a teacher
// can re-print it, and so the tests can assert on it). Math.random() can't do
// that; mulberry32 is a tiny, well-distributed seedable PRNG.
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9; // avoid the degenerate all-zero state
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normalize an arbitrary string seed to a 32-bit int so seeds can be words.
function seedToInt(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed == null ? '' : seed);
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Fisher-Yates using a supplied rng. Returns a new array; never mutates input.
function shuffled(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The file format.
//
// A question file is plain text. Real teacher-authored files are messy, so the
// parser is forgiving about everything that doesn't change meaning and strict
// about everything that does.
//
//   # lines beginning with a hash are comments
//
//   What is the capital of France? {2}   <- stem; optional {N} = points
//   * Paris                              <- '*' marks a CORRECT option
//   - London                            <- '-' marks an incorrect option
//   - Berlin
//   > Paris has been the capital since 987. <- '>' adds an explanation
//
//   The Earth is flat.                   <- blank line optional between blocks
//   - True
//   * False
//
// Multiple '*' options in one question => a multi-answer ("select all") item.
// ---------------------------------------------------------------------------

const POINTS_RE = /\s*\{\s*(\d+)\s*\}\s*$/; // trailing {N}

function parseBank(text) {
  const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  const questions = [];
  const errors = [];
  const warnings = [];

  let cur = null; // question under construction
  let qSeq = 0;
  let optSeq = 0;

  const err = (line, msg) => errors.push({ line, message: msg });
  const warn = (line, msg) => warnings.push({ line, message: msg });

  // Finalize the in-progress question: validate it and push it.
  function flush() {
    if (!cur) return;
    if (cur.options.length === 0) {
      err(cur.line, `Question "${truncate(cur.stem)}" has no answer options.`);
    } else if (cur.options.length < 2) {
      warn(cur.line, `Question "${truncate(cur.stem)}" has only one option.`);
    }
    if (cur.options.length > 0 && !cur.options.some((o) => o.correct)) {
      err(cur.line, `Question "${truncate(cur.stem)}" has no option marked correct (use '*').`);
    }
    // Duplicate option text within a question is almost always a typo and makes
    // grading ambiguous, so reject it.
    const seen = new Map();
    for (const o of cur.options) {
      const k = o.text.toLowerCase();
      if (seen.has(k)) {
        err(o.line, `Duplicate option "${truncate(o.text)}" in "${truncate(cur.stem)}".`);
      }
      seen.set(k, true);
    }
    questions.push(cur);
    cur = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    const line = raw.replace(/\s+$/, ''); // strip trailing whitespace only
    const trimmed = line.trim();

    if (trimmed === '') continue; // blank: a soft separator, never required
    if (trimmed.startsWith('#')) continue; // comment

    const marker = trimmed[0];
    const rest = trimmed.slice(1).trim();

    if (marker === '*' || marker === '-') {
      if (!cur) {
        err(lineNo, `Answer option "${truncate(trimmed)}" appears before any question.`);
        continue;
      }
      if (rest === '') {
        err(lineNo, `Empty answer option.`);
        continue;
      }
      cur.options.push({
        id: `o${++optSeq}`,
        text: rest,
        correct: marker === '*',
        line: lineNo,
      });
      continue;
    }

    if (marker === '>') {
      if (!cur) {
        err(lineNo, `Explanation "${truncate(rest)}" appears before any question.`);
        continue;
      }
      cur.explanation = cur.explanation ? `${cur.explanation} ${rest}` : rest;
      continue;
    }

    // Anything else starts a new question stem.
    flush();
    let stem = trimmed;
    let points = 1;
    const m = stem.match(POINTS_RE);
    if (m) {
      points = parseInt(m[1], 10);
      stem = stem.replace(POINTS_RE, '').trim();
      if (points < 1) {
        warn(lineNo, `Points for "${truncate(stem)}" must be >= 1; using 1.`);
        points = 1;
      }
    }
    if (stem === '') {
      err(lineNo, `Empty question stem.`);
      continue;
    }
    cur = { id: `q${++qSeq}`, stem, points, options: [], explanation: '', line: lineNo };
  }
  flush();

  return { questions, errors, warnings };
}

function truncate(s, n = 40) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// Assemble a student quiz + a separate answer key.
//
// The single most important rule: the quiz handed to the student contains NO
// correctness information. Correctness lives only in the key. After we shuffle
// the options, "the correct answer" is a *letter in this particular quiz*, which
// is why the key is produced here, bound to this assembly, and not derived later
// from the bank (the shuffle would make that wrong).
// ---------------------------------------------------------------------------
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function assembleQuiz(bank, opts) {
  opts = opts || {};
  const questions = (bank && bank.questions) || [];
  const usable = questions.filter((q) => q.options.length >= 2 && q.options.some((o) => o.correct));
  if (usable.length === 0) {
    throw new Error('Cannot assemble a quiz: the bank has no usable questions.');
  }

  const requested = opts.count == null ? 10 : opts.count;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error('count must be a positive integer.');
  }
  const count = Math.min(requested, usable.length);
  const shuffleQuestions = opts.shuffleQuestions !== false;
  const shuffleOptions = opts.shuffleOptions !== false;
  const seed = opts.seed == null ? (Date.now() ^ (Math.random() * 1e9)) >>> 0 : opts.seed;
  const rng = makeRng(seedToInt(seed));

  // Pick `count` questions. Shuffle-then-slice gives a uniform random subset.
  const picked = (shuffleQuestions ? shuffled(usable, rng) : usable.slice()).slice(0, count);

  const items = [];
  const key = {};
  let totalPoints = 0;

  for (const q of picked) {
    const opts2 = shuffleOptions ? shuffled(q.options, rng) : q.options.slice();
    const choices = opts2.map((o, idx) => ({ letter: LETTERS[idx], text: o.text }));
    const correctLetters = opts2
      .map((o, idx) => (o.correct ? LETTERS[idx] : null))
      .filter(Boolean);

    items.push({ questionId: q.id, stem: q.stem, points: q.points, choices });
    key[q.id] = {
      correctLetters,
      multi: correctLetters.length > 1,
      points: q.points,
      explanation: q.explanation || '',
    };
    totalPoints += q.points;
  }

  return {
    quiz: {
      seed: String(seed),
      count: items.length,
      totalPoints,
      items,
    },
    key,
  };
}

// ---------------------------------------------------------------------------
// Grade a completed quiz against its key.
//
// responses: { [questionId]: "B" | ["A","C"] }  (letters as shown on the quiz)
// A single-answer item scores all-or-nothing. A multi-answer item scores
// all-or-nothing by default (the chosen SET must equal the correct SET); pass
// { partial: true } to award proportional credit for multi-answer items with no
// penalty for wrong picks beyond the ones missed.
// ---------------------------------------------------------------------------
function grade(quiz, key, responses, opts) {
  opts = opts || {};
  const partial = !!opts.partial;
  responses = responses || {};

  let score = 0;
  let max = 0;
  const byQuestion = [];

  for (const item of quiz.items) {
    const k = key[item.questionId];
    if (!k) {
      throw new Error(`Answer key is missing question ${item.questionId}.`);
    }
    max += item.points;

    const chosen = normalizeChoice(responses[item.questionId]);
    const correct = new Set(k.correctLetters);
    const chosenSet = new Set(chosen);

    let awarded = 0;
    let isCorrect = false;

    if (chosen.length === 0) {
      // unanswered
    } else if (!k.multi) {
      isCorrect = chosen.length === 1 && correct.has(chosen[0]);
      awarded = isCorrect ? item.points : 0;
    } else if (partial) {
      const hits = chosen.filter((c) => correct.has(c)).length;
      const wrong = chosen.filter((c) => !correct.has(c)).length;
      const net = Math.max(0, hits - wrong); // wrong picks cancel right ones
      awarded = (net / correct.size) * item.points;
      isCorrect = net === correct.size && wrong === 0;
    } else {
      isCorrect = setsEqual(chosenSet, correct);
      awarded = isCorrect ? item.points : 0;
    }

    score += awarded;
    byQuestion.push({
      questionId: item.questionId,
      stem: item.stem,
      chosen,
      correctLetters: k.correctLetters.slice(),
      correct: isCorrect,
      awarded: round2(awarded),
      points: item.points,
      explanation: k.explanation,
    });
  }

  return {
    score: round2(score),
    max,
    percentage: max === 0 ? 0 : round2((score / max) * 100),
    correctCount: byQuestion.filter((b) => b.correct).length,
    total: quiz.items.length,
    byQuestion,
  };
}

function normalizeChoice(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const s = String(x).trim().toUpperCase();
    if (s === '') continue;
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Serialize a bank back to the file format (round-trips through parseBank).
// ---------------------------------------------------------------------------
function serializeBank(bank) {
  const out = [];
  for (const q of (bank.questions || [])) {
    out.push(q.points && q.points !== 1 ? `${q.stem} {${q.points}}` : q.stem);
    for (const o of q.options) out.push(`${o.correct ? '*' : '-'} ${o.text}`);
    if (q.explanation) out.push(`> ${q.explanation}`);
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

const API = {
  makeRng,
  seedToInt,
  shuffled,
  parseBank,
  assembleQuiz,
  grade,
  serializeBank,
  LETTERS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.QuizCore = API;
