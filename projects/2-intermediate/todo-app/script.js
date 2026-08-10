// script.js — DOM + localStorage wiring for the To-Do App.
//
// All of the rules live in the pure todo-core.js (window.TodoCore). This file
// only does the three things that pure core deliberately can't: read the clock,
// touch localStorage, and render/patch the DOM. State flows one way — an action
// produces a new state via the core, we persist it, then re-render from it.

(function () {
  const Core = window.TodoCore;
  const STORAGE_KEY = 'todo-app.state.v1';

  // --- persistence: localStorage is the "data survives a browser close" store.
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return Core.normalizeState(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return Core.emptyState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore quota / private-mode errors — the app still works in-memory */
    }
  }

  let state = load();

  // Monotonic, collision-resistant id without Math.random(): time + counter.
  let seq = 0;
  function nextId() {
    seq += 1;
    return `${Date.now().toString(36)}-${seq}`;
  }

  // --- DOM handles ---------------------------------------------------------
  const form = document.getElementById('composer');
  const input = document.getElementById('new-todo');
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const summary = document.getElementById('summary');
  const clearBtn = document.getElementById('clear-completed');
  const filterNav = document.getElementById('filters');

  // The id of the todo currently being edited inline (or null).
  let editingId = null;

  // --- commit: apply a state change, persist, re-render --------------------
  function commit(next) {
    state = next;
    save(state);
    render();
  }

  // --- rendering -----------------------------------------------------------
  const EMPTY_MESSAGES = {
    all: 'Nothing here yet. Add your first to-do above.',
    active: 'No active tasks — nice, you\'re all caught up.',
    completed: 'No completed tasks yet.',
  };

  function render() {
    const now = Date.now();
    const visible = Core.visibleTodos(state);
    const { total, active, completed } = Core.counts(state);

    // filter buttons: active state + badge counts
    filterNav.querySelectorAll('.filter').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === state.filter);
    });
    filterNav.querySelector('[data-count="total"]').textContent = total;
    filterNav.querySelector('[data-count="active"]').textContent = active;
    filterNav.querySelector('[data-count="completed"]').textContent = completed;

    // the list
    list.innerHTML = '';
    visible.forEach((todo) => list.appendChild(renderItem(todo, now)));

    // empty state
    if (visible.length === 0) {
      empty.hidden = false;
      empty.textContent = EMPTY_MESSAGES[state.filter];
    } else {
      empty.hidden = true;
    }

    // footer
    summary.textContent = total === 0
      ? ''
      : `${active} left · ${completed} done`;
    clearBtn.hidden = completed === 0;
  }

  function renderItem(todo, now) {
    const li = document.createElement('li');
    li.className = 'item' + (todo.done ? ' done' : '');
    li.dataset.id = todo.id;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'check';
    check.checked = todo.done;
    check.setAttribute('aria-label', todo.done ? 'Mark as active' : 'Mark as complete');
    check.addEventListener('change', () => commit(Core.toggleTodo(state, todo.id, Date.now())));

    const body = document.createElement('div');
    body.className = 'body';

    if (editingId === todo.id) {
      body.appendChild(buildEditor(todo));
    } else {
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = todo.text;
      text.title = 'Double-click to edit';
      text.addEventListener('dblclick', () => startEdit(todo.id));
      body.appendChild(text);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = todo.done
        ? `Completed · added ${Core.timeAgo(todo.createdAt, now)}`
        : `Added ${Core.timeAgo(todo.createdAt, now)}`;
      body.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.type = 'button';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', () => startEdit(todo.id));

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn del';
    delBtn.type = 'button';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', () => {
      if (editingId === todo.id) editingId = null;
      commit(Core.deleteTodo(state, todo.id));
    });

    actions.append(editBtn, delBtn);
    li.append(check, body, actions);
    return li;
  }

  function buildEditor(todo) {
    const editor = document.createElement('input');
    editor.className = 'edit-input';
    editor.type = 'text';
    editor.value = todo.text;
    editor.maxLength = 240;

    const finish = (saveIt) => {
      if (editingId !== todo.id) return;
      editingId = null;
      if (saveIt) {
        commit(Core.editTodo(state, todo.id, editor.value));
      } else {
        render();
      }
    };

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    editor.addEventListener('blur', () => finish(true));

    // focus + place the caret at the end once it's in the DOM
    setTimeout(() => {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    }, 0);

    return editor;
  }

  function startEdit(id) {
    editingId = id;
    render();
  }

  // --- events --------------------------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = Core.addTodo(state, input.value, nextId(), Date.now());
    if (next !== state) {
      input.value = '';
      commit(next);
    }
    input.focus();
  });

  filterNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter');
    if (!btn) return;
    commit(Core.setFilter(state, btn.dataset.filter));
  });

  clearBtn.addEventListener('click', () => commit(Core.clearCompleted(state)));

  // Keep two open tabs roughly in sync: reload state when another tab writes.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      state = load();
      editingId = null;
      render();
    }
  });

  render();
})();
