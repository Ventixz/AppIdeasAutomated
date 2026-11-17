// tests.js — run with `node tests.js`. No dependencies.
// Exercises the four jobs of quiz-core: parse, assemble, grade, serialize.

'use strict';

const {
  parseBank,
  assembleQuiz,
  grade,
  serializeBank,
  makeRng,
  shuffled,
} = require('./quiz-core.js');

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function section(name) {
  console.log('\n' + name);
}

const SAMPLE = `
# A tiny mixed bank
What is the capital of France? {2}
* Paris
- London
- Berlin
> Paris has been the capital since 987.

The Earth is flat.
- True
* False

Which are prime numbers? {3}
* 2
* 7
- 9
- 15
`;

// ---------------------------------------------------------------------------
section('parseBank — happy path');
{
  const bank = parseBank(SAMPLE);
  eq(bank.errors.length, 0, 'clean file has no errors');
  eq(bank.questions.length, 3, 'three questions parsed');

  const q1 = bank.questions[0];
  eq(q1.stem, 'What is the capital of France?', 'stem has {points} stripped');
  eq(q1.points, 2, 'points parsed from {2}');
  eq(q1.options.length, 3, 'three options');
  eq(q1.options[0].correct, true, 'first option (*) is correct');
  eq(q1.options[1].correct, false, 'second option (-) is incorrect');
  eq(q1.explanation, 'Paris has been the capital since 987.', 'explanation captured');

  const q2 = bank.questions[1];
  eq(q2.points, 1, 'default points is 1');
  eq(q2.options.find((o) => o.correct).text, 'False', 'correct T/F answer is False');

  const q3 = bank.questions[2];
  eq(q3.options.filter((o) => o.correct).length, 2, 'multi-answer: two correct options');
}

// ---------------------------------------------------------------------------
section('parseBank — comments, blanks, CRLF');
{
  const bank = parseBank('# c1\r\nStem one\r\n* yes\r\n- no\r\n\r\n# c2\r\nStem two\r\n* a\r\n- b\r\n');
  eq(bank.errors.length, 0, 'CRLF + comments parse cleanly');
  eq(bank.questions.length, 2, 'two questions across CRLF lines');
  eq(bank.questions[0].stem, 'Stem one', 'CRLF trimmed from stem');
}

// ---------------------------------------------------------------------------
section('parseBank — validation errors with line numbers');
{
  const bad = parseBank('* orphan option\n\nNo correct one?\n- a\n- b\n\nNo options here?\n');
  ok(bad.errors.length >= 3, 'collects multiple errors');
  ok(bad.errors.some((e) => e.line === 1 && /before any question/.test(e.message)),
    'orphan option flagged at line 1');
  ok(bad.errors.some((e) => /no option marked correct/.test(e.message)),
    'missing-correct flagged');
  ok(bad.errors.some((e) => /no answer options/.test(e.message)),
    'no-options flagged');
}

{
  const dup = parseBank('Pick one\n* a\n- a\n- b\n');
  ok(dup.errors.some((e) => /Duplicate option/.test(e.message)), 'duplicate option flagged');
}

{
  const one = parseBank('Only one option\n* yes\n');
  eq(one.errors.length, 0, 'single-option question is not an error');
  ok(one.warnings.some((w) => /only one option/.test(w.message)), 'single-option warned');
}

// ---------------------------------------------------------------------------
section('assembleQuiz — selection and shuffling');
{
  const bank = parseBank(SAMPLE);
  const { quiz, key } = assembleQuiz(bank, { count: 2, seed: 'exam-1' });
  eq(quiz.items.length, 2, 'picks requested count');
  eq(Object.keys(key).length, 2, 'key has one entry per picked question');

  // count larger than the bank clamps to what exists
  const all = assembleQuiz(bank, { count: 99, seed: 'x' });
  eq(all.quiz.items.length, 3, 'count clamps to bank size');

  // letters are A, B, C... contiguous
  for (const item of all.quiz.items) {
    item.choices.forEach((c, i) => eq(c.letter, 'ABCDEFG'[i], 'choice letters are contiguous'));
  }

  // the student quiz must NOT leak correctness
  const json = JSON.stringify(all.quiz);
  ok(!/correct/.test(json), 'assembled quiz exposes no "correct" field');
}

// ---------------------------------------------------------------------------
section('assembleQuiz — reproducible from a seed');
{
  const bank = parseBank(SAMPLE);
  const a = assembleQuiz(bank, { count: 3, seed: 'same' });
  const b = assembleQuiz(bank, { count: 3, seed: 'same' });
  eq(JSON.stringify(a.quiz), JSON.stringify(b.quiz), 'same seed => identical quiz');
  eq(JSON.stringify(a.key), JSON.stringify(b.key), 'same seed => identical key');

  // different seeds should (almost always) differ in order or option layout
  const c = assembleQuiz(bank, { count: 3, seed: 'other-seed-xyz' });
  ok(JSON.stringify(a.quiz) !== JSON.stringify(c.quiz), 'different seed => different quiz');
}

// ---------------------------------------------------------------------------
section('assembleQuiz — key tracks the shuffle (the core trap)');
{
  // Build a bank where the correct option is deterministically findable, then
  // confirm the key's correctLetters point at the SHUFFLED position's letter,
  // and that answering with that letter actually grades as correct.
  const bank = parseBank('Q?\n* RIGHT\n- w1\n- w2\n- w3\n');
  for (let s = 0; s < 25; s++) {
    const { quiz, key } = assembleQuiz(bank, { count: 1, seed: 'seed' + s });
    const item = quiz.items[0];
    const keyLetter = key[item.questionId].correctLetters[0];
    const letterOfRight = item.choices.find((c) => c.text === 'RIGHT').letter;
    eq(keyLetter, letterOfRight, 'key letter matches where RIGHT landed after shuffle');
  }
}

// ---------------------------------------------------------------------------
section('grade — single-answer all-or-nothing');
{
  const bank = parseBank(SAMPLE);
  const { quiz, key } = assembleQuiz(bank, { count: 3, seed: 'grade-me', shuffleOptions: false, shuffleQuestions: false });

  // Answer everything correctly by reading the key (simulating a perfect student)
  const perfect = {};
  for (const item of quiz.items) perfect[item.questionId] = key[item.questionId].correctLetters.slice();
  const g1 = grade(quiz, key, perfect);
  eq(g1.score, g1.max, 'perfect answers => full score');
  eq(g1.percentage, 100, 'perfect => 100%');
  eq(g1.correctCount, 3, 'all three correct');

  // Answer everything wrong / blank
  const g0 = grade(quiz, key, {});
  eq(g0.score, 0, 'no answers => zero');
  eq(g0.correctCount, 0, 'no answers => none correct');
  ok(g0.byQuestion.every((b) => b.chosen.length === 0), 'blank responses recorded as empty');
}

// ---------------------------------------------------------------------------
section('grade — wrong single answer earns nothing');
{
  const bank = parseBank('Pick A\n* A-text\n- B-text\n');
  const { quiz, key } = assembleQuiz(bank, { count: 1, seed: 'q', shuffleOptions: false });
  const id = quiz.items[0].questionId;
  const correct = key[id].correctLetters[0]; // 'A' since shuffleOptions:false
  const wrong = correct === 'A' ? 'B' : 'A';
  const g = grade(quiz, key, { [id]: wrong });
  eq(g.score, 0, 'wrong choice scores 0');
  eq(g.byQuestion[0].correct, false, 'marked incorrect');
}

// ---------------------------------------------------------------------------
section('grade — multi-answer strict vs partial');
{
  // Isolate the multi-answer question (3 points, correct = {2,7})
  const bank = parseBank('Which are prime? {4}\n* 2\n* 7\n- 9\n- 15\n');
  const { quiz, key } = assembleQuiz(bank, { count: 1, seed: 'm', shuffleOptions: false });
  const id = quiz.items[0].questionId;
  const corr = key[id].correctLetters; // ['A','B'] with shuffleOptions:false
  ok(key[id].multi, 'detected as multi-answer');

  // strict: exact set required
  eq(grade(quiz, key, { [id]: corr }).score, 4, 'strict: exact set => full points');
  eq(grade(quiz, key, { [id]: [corr[0]] }).score, 0, 'strict: partial selection => 0');

  // partial: proportional, wrong picks cancel right ones
  const p1 = grade(quiz, key, { [id]: [corr[0]] }, { partial: true });
  eq(p1.score, 2, 'partial: one of two right => half points');
  const pWrong = grade(quiz, key, { [id]: [corr[0], 'C'] }, { partial: true }); // one right, one wrong
  eq(pWrong.score, 0, 'partial: a wrong pick cancels a right one');
  const pFull = grade(quiz, key, { [id]: corr }, { partial: true });
  eq(pFull.score, 4, 'partial: all correct => full points');
  eq(pFull.byQuestion[0].correct, true, 'partial full is marked correct');
}

// ---------------------------------------------------------------------------
section('grade — tolerant of messy responses');
{
  const bank = parseBank('Q\n* yes\n- no\n');
  const { quiz, key } = assembleQuiz(bank, { count: 1, seed: 'z', shuffleOptions: false });
  const id = quiz.items[0].questionId;
  eq(grade(quiz, key, { [id]: 'a' }).score, 1, 'lowercase letter accepted');
  eq(grade(quiz, key, { [id]: ' A ' }).score, 1, 'whitespace trimmed');
  eq(grade(quiz, key, { [id]: ['A', 'A'] }).score, 1, 'duplicate letters de-duped');
}

// ---------------------------------------------------------------------------
section('assembleQuiz — rejects unusable banks');
{
  let threw = false;
  try {
    assembleQuiz(parseBank('# empty\n'), { count: 3 });
  } catch (e) {
    threw = true;
  }
  ok(threw, 'empty bank throws');

  let threw2 = false;
  try {
    assembleQuiz(parseBank(SAMPLE), { count: 0 });
  } catch (e) {
    threw2 = true;
  }
  ok(threw2, 'count < 1 throws');
}

// ---------------------------------------------------------------------------
section('serializeBank — round-trips through parseBank');
{
  const bank = parseBank(SAMPLE);
  const text = serializeBank(bank);
  const reparsed = parseBank(text);
  eq(reparsed.errors.length, 0, 're-parsed output is clean');
  eq(reparsed.questions.length, bank.questions.length, 'same question count after round-trip');
  eq(reparsed.questions[0].points, 2, 'points survive round-trip');
  eq(reparsed.questions[2].options.filter((o) => o.correct).length, 2,
    'multi-answer correctness survives round-trip');
  eq(reparsed.questions[0].explanation, bank.questions[0].explanation,
    'explanation survives round-trip');
}

// ---------------------------------------------------------------------------
section('rng — seeded, deterministic, in range');
{
  const r1 = makeRng(123);
  const r2 = makeRng(123);
  let sameAll = true;
  let inRange = true;
  for (let i = 0; i < 1000; i++) {
    const a = r1();
    const b = r2();
    if (a !== b) sameAll = false;
    if (a < 0 || a >= 1) inRange = false;
  }
  ok(sameAll, 'same seed => identical stream');
  ok(inRange, 'values stay in [0,1)');

  // shuffle is a permutation (no loss/dup)
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const sh = shuffled(arr, makeRng(9));
  eq(sh.length, arr.length, 'shuffle preserves length');
  eq(sh.slice().sort((a, b) => a - b).join(','), '1,2,3,4,5,6,7,8', 'shuffle preserves elements');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
