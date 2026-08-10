# To-Do App

The classic to-do list — add things you want to get done, check them off, edit
or delete them, and filter between **All / Active / Done**. Everything is saved
in the browser's own `localStorage`, so your list is still there when you close
the tab and come back. Pure vanilla HTML/CSS/JS — no build step, no server, no
network.

Source idea: [app-ideas / To-Do App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/To-Do-App.md)

## Running

Open `index.html` in any modern browser:

```bash
open projects/2-intermediate/todo-app/index.html
```

## How to use

- Type in the field and press **Enter** or click **Add** to create a to-do.
- Click the round **checkbox** to mark a task done (again to reactivate it).
- **Double-click** a task's text, or click the **✎** button, to edit it inline —
  **Enter** saves, **Esc** cancels.
- Click **✕** to delete a task.
- Use the **All / Active / Done** tabs to switch views; each shows a live count.
- **Clear completed** removes every finished task at once.

Open the app in two tabs and they stay roughly in sync — a write in one tab
refreshes the other via the `storage` event.

## How it maps to the spec

| Spec item | Where it lives |
| --- | --- |
| Input field + submit (Enter **or** button) adds to the list | `#composer` in [`index.html`](./index.html) → `addTodo()` |
| Mark a to-do as completed | the round checkbox → `toggleTodo()` |
| Delete a to-do | the **✕** button → `deleteTodo()` |
| **Bonus:** edit an existing to-do | double-click / **✎** → `editTodo()` |
| **Bonus:** separate views for active vs finished tasks | the filter tabs → `setFilter()` + `visibleTodos()` |
| **Bonus:** timestamp for when each to-do was created | `createdAt` + `timeAgo()` shown under each item |
| **Persistence:** survives closing the browser window | `localStorage` load/save in [`script.js`](./script.js) |

## The core is pure and tested

All the rules — adding, toggling, editing, deleting, filtering, the "time ago"
label, and validating data read back from storage — live in a DOM-free
[`todo-core.js`](./todo-core.js). State is an immutable value and every function
returns a **new** state rather than mutating in place. The "current moment" and
each new id are **injected** as arguments instead of being read from the clock,
so every function is fully deterministic. That ships a dependency-free test
suite:

```bash
node projects/2-intermediate/todo-app/tests.js   # -> 42 passed, 0 failed.
```

The tests cover front-insertion and trimming on add, the done/`completedAt`
round-trip on toggle, blank-edit protection, delete and clear-completed, the
three filter views with their counts, every branch of the `timeAgo` label, and
`normalizeState()` recovering gracefully from `null`, garbage, and
partially-corrupted stored data.

### A note on persistence

The spec suggests `localStorage`, and that's exactly what's used — the app is
fully offline. `script.js` owns the one impure boundary (clock, storage, DOM);
`todo-core.js` stays pure so it can be tested without a browser.
