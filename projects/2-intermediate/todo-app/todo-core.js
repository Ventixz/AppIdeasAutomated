// todo-core.js — pure, DOM-free logic for the To-Do App.
//
// Everything here is a pure function over an immutable state shape. There is no
// DOM access, no localStorage, no `Date.now()` reading the wall clock: the
// "current moment" and each new id are *injected* as arguments, so every
// function is deterministic and unit-testable. The browser layer (script.js)
// owns the clock, the storage, and the DOM; this file owns the rules.
//
// State shape:
//   {
//     todos:  [ { id, text, done, createdAt, completedAt } , ... ],
//     filter: 'all' | 'active' | 'completed'
//   }
//
// A todo:
//   id          — stable unique id (injected by the caller)
//   text        — the trimmed to-do text
//   done        — boolean, whether it's been marked complete
//   createdAt   — UTC ms when it was added (injected)
//   completedAt — UTC ms when it was marked done, or null while active

const FILTERS = ['all', 'active', 'completed'];

function emptyState() {
  return { todos: [], filter: 'all' };
}

// --- adding ---------------------------------------------------------------

// Add a new todo to the FRONT of the list (newest first). Blank/whitespace-only
// text is rejected: the state is returned unchanged so the UI can stay simple.
function addTodo(state, text, id, now) {
  const trimmed = (text == null ? '' : String(text)).trim();
  if (trimmed === '') return state;
  const todo = {
    id,
    text: trimmed,
    done: false,
    createdAt: now,
    completedAt: null,
  };
  return { ...state, todos: [todo, ...state.todos] };
}

// --- toggling / editing / deleting ---------------------------------------

// Flip a todo's done flag. Marking done stamps `completedAt` with `now`;
// un-marking clears it back to null. All other todos pass through untouched.
function toggleTodo(state, id, now) {
  const todos = state.todos.map((t) => {
    if (t.id !== id) return t;
    const done = !t.done;
    return { ...t, done, completedAt: done ? now : null };
  });
  return { ...state, todos };
}

// Replace a todo's text. A blank edit is treated as a no-op (the original text
// is kept) so an accidental empty save can't erase an item.
function editTodo(state, id, text) {
  const trimmed = (text == null ? '' : String(text)).trim();
  const todos = state.todos.map((t) => {
    if (t.id !== id) return t;
    if (trimmed === '') return t;
    return { ...t, text: trimmed };
  });
  return { ...state, todos };
}

function deleteTodo(state, id) {
  return { ...state, todos: state.todos.filter((t) => t.id !== id) };
}

// Remove every completed todo in one shot ("Clear completed").
function clearCompleted(state) {
  return { ...state, todos: state.todos.filter((t) => !t.done) };
}

// --- filtering / views ----------------------------------------------------

function setFilter(state, filter) {
  if (!FILTERS.includes(filter)) return state;
  return { ...state, filter };
}

// The todos that should currently be visible, given the active filter. This is
// the "separate view for active / finished tasks" bonus, expressed as a pure
// selector rather than three parallel lists.
function visibleTodos(state) {
  switch (state.filter) {
    case 'active':
      return state.todos.filter((t) => !t.done);
    case 'completed':
      return state.todos.filter((t) => t.done);
    default:
      return state.todos.slice();
  }
}

// Small tallies for the footer / filter badges.
function counts(state) {
  const total = state.todos.length;
  const completed = state.todos.reduce((n, t) => n + (t.done ? 1 : 0), 0);
  return { total, completed, active: total - completed };
}

// --- timestamp formatting -------------------------------------------------

// Human "time ago" label for a createdAt, relative to an injected `now`.
// Deterministic because `now` is passed in. Future timestamps clamp to "just now".
function timeAgo(createdAt, now) {
  const secs = Math.floor((now - createdAt) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// --- persistence helpers (serialize only — no I/O here) -------------------

// Validate and normalise a plain object parsed from storage back into a state.
// Anything malformed falls back to a clean empty state, so a corrupted
// localStorage value can never crash the app on load.
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.todos)) {
    return emptyState();
  }
  const todos = raw.todos
    .filter((t) => t && typeof t === 'object' && typeof t.text === 'string')
    .map((t) => ({
      id: t.id,
      text: t.text,
      done: Boolean(t.done),
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
      completedAt: typeof t.completedAt === 'number' ? t.completedAt : null,
    }));
  const filter = FILTERS.includes(raw.filter) ? raw.filter : 'all';
  return { todos, filter };
}

const api = {
  FILTERS,
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
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.TodoCore = api;
}
