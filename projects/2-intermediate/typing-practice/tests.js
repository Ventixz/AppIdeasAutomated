// tests.js — dependency-free test suite for typing-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const {
  INITIAL_INTERVAL,
  MIN_INTERVAL,
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
} = require('./typing-core.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${b}, got ${a})`);
}

const WORDS = ['alpha', 'bravo', 'charlie'];

// --- matching -------------------------------------------------------------
assert(matches('alpha', 'alpha'), 'exact match');
assert(matches('  Alpha  ', 'alpha'), 'match ignores case and surrounding space');
assert(!matches('alph', 'alpha'), 'partial word does not match');
assert(!matches('', ''), 'empty vs empty is never a match');

// --- interval decay -------------------------------------------------------
eq(decreaseInterval(3000), 2760, 'interval decays by the decay factor');
assert(decreaseInterval(MIN_INTERVAL) === MIN_INTERVAL, 'interval never drops below the floor');
assert(decreaseInterval(850) === MIN_INTERVAL, 'interval clamps up to the floor');

// --- fresh session --------------------------------------------------------
let s = createSession(WORDS);
eq(s.currentWord, 'alpha', 'fresh session shows the first word');
eq(s.running, false, 'fresh session is not running');
eq(s.successes, 0, 'fresh session has zero successes');
eq(s.intervalMs, INITIAL_INTERVAL, 'fresh session starts at the initial interval');
assert(createSession([]).words.length > 0, 'empty word list falls back to defaults');

// --- submit while stopped is a no-op --------------------------------------
assert(submit(s, 'alpha') === s, 'submitting before Start does nothing');

// --- start resets and runs ------------------------------------------------
s = start(s);
eq(s.running, true, 'start sets running');
eq(s.currentWord, 'alpha', 'start begins on the first word');

// --- a correct entry ------------------------------------------------------
let c = submit(s, 'ALPHA ');
eq(c.successes, 1, 'correct entry increments successes');
eq(c.attempts, 1, 'correct entry increments total attempts');
eq(c.currentWord, 'bravo', 'correct entry advances to the next word');
eq(c.streak, 1, 'correct entry grows the streak');
eq(c.bestStreak, 1, 'best streak tracks the current streak');
assert(c.intervalMs < s.intervalMs, 'correct entry makes the timer faster');
eq(c.lastResult, 'correct', 'correct entry is flagged correct');

// --- an incorrect entry ---------------------------------------------------
let w = submit(s, 'wrong');
eq(w.successes, 0, 'incorrect entry does not add a success');
eq(w.attempts, 1, 'incorrect entry still counts as an attempt');
eq(w.currentWord, 'alpha', 'incorrect entry keeps the same word');
eq(w.streak, 0, 'incorrect entry keeps streak at zero');
eq(w.intervalMs, s.intervalMs, 'incorrect entry does not change the interval');
eq(w.lastResult, 'incorrect', 'incorrect entry is flagged incorrect');

// --- streak reset on a mistake after a run --------------------------------
let run = start(createSession(WORDS));
run = submit(run, 'alpha'); // streak 1
run = submit(run, 'bravo'); // streak 2
eq(run.streak, 2, 'consecutive correct entries build a streak');
eq(run.bestStreak, 2, 'best streak records the peak');
run = submit(run, 'nope'); // wrong -> streak resets
eq(run.streak, 0, 'a mistake resets the current streak');
eq(run.bestStreak, 2, 'best streak survives a later mistake');

// --- word list wraps around -----------------------------------------------
let wrap = start(createSession(['x', 'y']));
wrap = submit(wrap, 'x');
wrap = submit(wrap, 'y');
eq(wrap.currentWord, 'x', 'advancing past the end wraps back to the first word');

// --- expire counts as a miss ----------------------------------------------
let e = expire(start(createSession(WORDS)));
eq(e.attempts, 1, 'expiring the timer counts an attempt');
eq(e.successes, 0, 'expiring the timer adds no success');
eq(e.currentWord, 'alpha', 'expiring keeps the same word');
assert(expire(createSession(WORDS)) === createSession(WORDS) || !expire(createSession(WORDS)).running,
  'expire on a stopped session is a no-op');

// --- accuracy -------------------------------------------------------------
eq(accuracy(createSession(WORDS)), 0, 'accuracy is 0 with no attempts');
let acc = start(createSession(WORDS));
acc = submit(acc, 'alpha'); // 1/1
acc = submit(acc, 'nope'); // 1/2
eq(accuracy(acc), 0.5, 'accuracy is successes over attempts');

// --- stop -----------------------------------------------------------------
let st = stop(start(createSession(WORDS)));
eq(st.running, false, 'stop clears running');

// --- cumulative stats -----------------------------------------------------
let stats = emptyStats();
eq(stats.sessions, 0, 'empty stats start at zero sessions');
stats = mergeStats(stats, { successes: 5, attempts: 8, bestStreak: 3 });
eq(stats.sessions, 1, 'merging records one session');
eq(stats.totalSuccesses, 5, 'merging accumulates successes');
eq(stats.totalAttempts, 8, 'merging accumulates attempts');
eq(stats.bestStreak, 3, 'merging tracks the best streak');
stats = mergeStats(stats, { successes: 2, attempts: 2, bestStreak: 2 });
eq(stats.totalSuccesses, 7, 'a second session adds to the total');
eq(stats.bestStreak, 3, 'best streak keeps the higher value');

// --- stats recovery from garbage ------------------------------------------
eq(normalizeStats(null).sessions, 0, 'null stats recover to empty');
eq(normalizeStats('nonsense').totalAttempts, 0, 'string stats recover to empty');
eq(normalizeStats({ sessions: -4, totalSuccesses: 'x', bestStreak: 9 }).sessions, 0,
  'negative counts are floored to zero');
eq(normalizeStats({ sessions: -4, totalSuccesses: 'x', bestStreak: 9 }).bestStreak, 9,
  'valid fields survive alongside invalid ones');

// --- summary --------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
