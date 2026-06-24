// Notes App — create, edit, delete, and persist notes in localStorage.
// Bonus: a tiny Markdown renderer for the preview, and a creation date per note.

const STORAGE_KEY = "notes-app.notes";

const el = {
  list: document.getElementById("note-list"),
  emptyList: document.getElementById("empty-list"),
  search: document.getElementById("search"),
  editor: document.getElementById("editor"),
  placeholder: document.getElementById("placeholder"),
  title: document.getElementById("note-title"),
  body: document.getElementById("note-body"),
  preview: document.getElementById("preview"),
  createdAt: document.getElementById("created-at"),
  saveState: document.getElementById("save-state"),
  newBtn: document.getElementById("new-note"),
  deleteBtn: document.getElementById("delete-note"),
  previewBtn: document.getElementById("toggle-preview"),
};

let notes = load();
let activeId = null;
let previewing = false;

// ---- Persistence -----------------------------------------------------------

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

// Unique-enough id without external deps.
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---- Markdown (minimal subset) ---------------------------------------------
// Escapes HTML first, then applies headings, bold/italic, inline code, links,
// and unordered lists. Intentionally small — enough to make notes readable.

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(src) {
  const lines = escapeHtml(src).split("\n");
  const out = [];
  let inList = false;

  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const item = line.match(/^\s*[-*]\s+(.*)$/);

    if (item) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }

    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (line.trim() === "") {
      out.push("");
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

// ---- Rendering -------------------------------------------------------------

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function noteTitle(note) {
  return note.title.trim() || "Untitled note";
}

function renderList() {
  const query = el.search.value.trim().toLowerCase();
  const visible = notes
    .filter(
      (n) =>
        !query ||
        n.title.toLowerCase().includes(query) ||
        n.body.toLowerCase().includes(query)
    )
    .sort((a, b) => b.updated - a.updated);

  el.list.replaceChildren();
  for (const note of visible) {
    const li = document.createElement("li");
    li.className = "note-item" + (note.id === activeId ? " active" : "");
    li.dataset.id = note.id;

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = noteTitle(note);

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = formatDate(note.created);

    li.append(title, meta);
    el.list.appendChild(li);
  }

  el.emptyList.hidden = visible.length > 0;
}

function showEditor(note) {
  activeId = note.id;
  previewing = false;
  el.editor.hidden = false;
  el.placeholder.hidden = true;
  el.title.value = note.title;
  el.body.value = note.body;
  el.createdAt.textContent = "Created " + formatDate(note.created);
  el.saveState.textContent = "Saved";
  syncPreviewToggle();
  renderList();
}

function showPlaceholder() {
  activeId = null;
  el.editor.hidden = true;
  el.placeholder.hidden = false;
  renderList();
}

function syncPreviewToggle() {
  el.body.hidden = previewing;
  el.preview.hidden = !previewing;
  el.previewBtn.textContent = previewing ? "Edit" : "Preview";
  if (previewing) {
    const note = notes.find((n) => n.id === activeId);
    el.preview.innerHTML = renderMarkdown(note ? note.body : "");
  }
}

// ---- Actions ---------------------------------------------------------------

function createNote() {
  const now = Date.now();
  const note = { id: makeId(), title: "", body: "", created: now, updated: now };
  notes.push(note);
  save();
  showEditor(note);
  el.title.focus();
}

function updateActive() {
  const note = notes.find((n) => n.id === activeId);
  if (!note) return;
  note.title = el.title.value;
  note.body = el.body.value;
  note.updated = Date.now();
  save();
  el.saveState.textContent = "Saved";
  renderList();
}

function deleteActive() {
  const note = notes.find((n) => n.id === activeId);
  if (!note) return;
  if (!confirm(`Delete "${noteTitle(note)}"? This can't be undone.`)) return;
  notes = notes.filter((n) => n.id !== activeId);
  save();
  showPlaceholder();
}

// ---- Events ----------------------------------------------------------------

el.newBtn.addEventListener("click", createNote);
el.deleteBtn.addEventListener("click", deleteActive);

el.previewBtn.addEventListener("click", () => {
  previewing = !previewing;
  syncPreviewToggle();
});

let saveTimer = null;
function onEdit() {
  el.saveState.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(updateActive, 300);
}
el.title.addEventListener("input", onEdit);
el.body.addEventListener("input", onEdit);

el.search.addEventListener("input", renderList);

el.list.addEventListener("click", (e) => {
  const li = e.target.closest(".note-item");
  if (!li) return;
  const note = notes.find((n) => n.id === li.dataset.id);
  if (note) showEditor(note);
});

// ---- Boot ------------------------------------------------------------------

renderList();
showPlaceholder();
