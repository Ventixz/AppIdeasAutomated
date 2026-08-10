// tests.js — dependency-free test suite for todo-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const {
  emptyState,
  addTodo,
  toggleTodo,
  editTodo,
  deleteTodo,
  clearCompleted,
  setFilter,
  visibleTodos,
  counts,
  timeAgo,
  normalizeState,
} = require('./todo-core.js');

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
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// A fixed instant to inject as "now": 2026-08-10T09:00:00Z.
const T0 = Date.UTC(2026, 7, 10, 9, 0, 0);
const MIN = 60 * 1000;

// --- addTodo --------------------------------------------------------------
{
  const s0 = emptyState();
  const s1 = addTodo(s0, 'Buy milk', 'a', T0);
  eq(s1.todos.length, 1, 'add appends one todo');
  eq(s1.todos[0].text, 'Buy milk', 'stores trimmed text');
  eq(s1.todos[0].done, false, 'new todo starts active');
  eq(s1.todos[0].createdAt, T0, 'stamps injected createdAt');
  eq(s1.todos[0].completedAt, null, 'new todo has no completedAt');
  eq(s0.todos.length, 0, 'addTodo does not mutate the input state');

  const s2 = addTodo(s1, 'Walk dog', 'b', T0 + MIN);
  eq(s2.todos.map((t) => t.id), ['b', 'a'], 'newest todo goes to the front');

  eq(addTodo(s1, '   ', 'x', T0).todos.length, 1, 'whitespace-only text is rejected');
  eq(addTodo(s1, '', 'x', T0), s1, 'empty text returns state unchanged');
  eq(addTodo(s1, '  hi  ', 'c', T0).todos[0].text, 'hi', 'text is trimmed');
}

// --- toggleTodo -----------------------------------------------------------
{
  let s = addTodo(emptyState(), 'Task', 'a', T0);
  s = toggleTodo(s, 'a', T0 + 5 * MIN);
  eq(s.todos[0].done, true, 'toggle marks done');
  eq(s.todos[0].completedAt, T0 + 5 * MIN, 'toggle stamps injected completedAt');

  s = toggleTodo(s, 'a', T0 + 9 * MIN);
  eq(s.todos[0].done, false, 'toggle again un-marks');
  eq(s.todos[0].completedAt, null, 'un-marking clears completedAt');

  const before = addTodo(emptyState(), 'Task', 'a', T0);
  toggleTodo(before, 'a', T0);
  eq(before.todos[0].done, false, 'toggle does not mutate input state');
  eq(toggleTodo(before, 'nope', T0).todos[0].done, false, 'toggle of unknown id is a no-op');
}

// --- editTodo -------------------------------------------------------------
{
  const s = addTodo(emptyState(), 'old', 'a', T0);
  eq(editTodo(s, 'a', 'new text').todos[0].text, 'new text', 'edit replaces text');
  eq(editTodo(s, 'a', '  spaced  ').todos[0].text, 'spaced', 'edit trims text');
  eq(editTodo(s, 'a', '   ').todos[0].text, 'old', 'blank edit keeps original text');
  eq(editTodo(s, 'zzz', 'x').todos[0].text, 'old', 'edit of unknown id is a no-op');
  eq(s.todos[0].text, 'old', 'edit does not mutate input state');
}

// --- deleteTodo / clearCompleted -----------------------------------------
{
  let s = emptyState();
  s = addTodo(s, 'one', 'a', T0);
  s = addTodo(s, 'two', 'b', T0);
  s = addTodo(s, 'three', 'c', T0);
  eq(deleteTodo(s, 'b').todos.map((t) => t.id), ['c', 'a'], 'delete removes the right todo');
  eq(deleteTodo(s, 'missing').todos.length, 3, 'delete of unknown id changes nothing');

  s = toggleTodo(s, 'a', T0);
  s = toggleTodo(s, 'c', T0);
  eq(clearCompleted(s).todos.map((t) => t.id), ['b'], 'clearCompleted drops only done todos');
}

// --- setFilter / visibleTodos / counts -----------------------------------
{
  let s = emptyState();
  s = addTodo(s, 'active-1', 'a', T0);
  s = addTodo(s, 'done-1', 'b', T0);
  s = addTodo(s, 'active-2', 'c', T0);
  s = toggleTodo(s, 'b', T0);

  eq(counts(s), { total: 3, completed: 1, active: 2 }, 'counts tally correctly');

  eq(visibleTodos(s).length, 3, 'default filter (all) shows everything');
  eq(visibleTodos(setFilter(s, 'active')).map((t) => t.id), ['c', 'a'], 'active view hides done todos');
  eq(visibleTodos(setFilter(s, 'completed')).map((t) => t.id), ['b'], 'completed view shows only done todos');
  eq(setFilter(s, 'bogus').filter, 'all', 'invalid filter is ignored');
}

// --- timeAgo --------------------------------------------------------------
eq(timeAgo(T0, T0 + 10 * 1000), 'just now', 'under 45s reads as just now');
eq(timeAgo(T0, T0 + 5 * MIN), '5 minutes ago', 'minutes label');
eq(timeAgo(T0, T0 + 1 * MIN), '1 minute ago', 'singular minute');
eq(timeAgo(T0, T0 + 3 * 60 * MIN), '3 hours ago', 'hours label');
eq(timeAgo(T0, T0 + 2 * 24 * 60 * MIN), '2 days ago', 'days label');
eq(timeAgo(T0, T0 - 5000), 'just now', 'future timestamp clamps to just now');

// --- normalizeState -------------------------------------------------------
{
  eq(normalizeState(null), emptyState(), 'null parses to empty state');
  eq(normalizeState({ todos: 'nope' }), emptyState(), 'non-array todos falls back to empty');
  eq(normalizeState('garbage'), emptyState(), 'garbage string falls back to empty');

  const cleaned = normalizeState({
    filter: 'active',
    todos: [
      { id: 'a', text: 'ok', done: true, createdAt: T0, completedAt: T0 },
      { id: 'b', text: 'partial' }, // missing fields get defaults
      { nope: 1 }, // no text — dropped
    ],
  });
  eq(cleaned.filter, 'active', 'valid filter is preserved');
  eq(cleaned.todos.length, 2, 'entries without text are dropped');
  eq(cleaned.todos[1], { id: 'b', text: 'partial', done: false, createdAt: 0, completedAt: null },
    'missing fields are filled with safe defaults');
  eq(normalizeState({ todos: [], filter: 'weird' }).filter, 'all', 'invalid stored filter resets to all');
}

// --- report ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
