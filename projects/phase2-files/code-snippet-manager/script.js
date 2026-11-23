/*
 * script.js — thin glue between the browser UI and snippet-core.js.
 *
 * All the real work (lexing, highlighting, search, validation, persistence)
 * lives in the core and is unit-tested under Node. This file only wires DOM
 * events to the store and renders the results.
 */

'use strict';

(function () {
  const Core = window.SnippetCore;
  const STORAGE_KEY = 'code-snippet-manager.v1';

  // --- load store from localStorage (defensively) -------------------
  let store;
  try {
    store = Core.SnippetStore.deserialize(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch (_e) {
    store = new Core.SnippetStore([]);
  }

  let selectedId = null;
  let activeFacet = null; // { type: 'lang'|'tag', value }
  let dirty = false;

  // --- element handles ----------------------------------------------
  const $ = (id) => document.getElementById(id);
  const els = {
    search: $('search'), facets: $('facets'), list: $('snippet-list'),
    count: $('count-label'), empty: $('empty'), editor: $('editor'),
    title: $('title'), language: $('language'), tags: $('tags'), code: $('code'),
    preview: $('preview'), stamp: $('stamp'), saveState: $('save-state'),
    toast: $('toast'),
  };

  // --- language dropdown --------------------------------------------
  for (const { name, label } of Core.languageList()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = label;
    els.language.appendChild(opt);
  }

  // --- persistence ---------------------------------------------------
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, store.serialize()); }
    catch (_e) { toast('Could not save to local storage'); }
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add('hidden'), 1800);
  }

  // --- rendering: the sidebar list ----------------------------------
  function currentQuery() {
    let q = els.search.value.trim();
    if (activeFacet) {
      q = (activeFacet.type === 'lang' ? `lang:${activeFacet.value} ` : `tag:${activeFacet.value} `) + q;
    }
    return q.trim();
  }

  function renderFacets() {
    els.facets.innerHTML = '';
    const langs = store.languagesInUse();
    const tags = store.tagsInUse();
    const make = (text, type, value) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (activeFacet && activeFacet.type === type && activeFacet.value === value ? ' active' : '');
      chip.textContent = text;
      chip.onclick = () => {
        if (activeFacet && activeFacet.type === type && activeFacet.value === value) activeFacet = null;
        else activeFacet = { type, value };
        render();
      };
      return chip;
    };
    for (const l of langs) els.facets.appendChild(make(`${l.label} (${l.count})`, 'lang', l.name));
    for (const t of tags) els.facets.appendChild(make(`#${t.tag} (${t.count})`, 'tag', t.tag));
  }

  function renderList() {
    const results = store.search(currentQuery());
    els.list.innerHTML = '';
    els.count.textContent = `${store.snippets.length} snippet${store.snippets.length === 1 ? '' : 's'}`;

    if (results.length === 0) {
      const li = document.createElement('li');
      li.className = 'snip-empty';
      li.textContent = store.snippets.length === 0 ? 'No snippets yet.' : 'No matches.';
      els.list.appendChild(li);
      return;
    }

    for (const s of results) {
      const li = document.createElement('li');
      li.className = 'snip' + (s.id === selectedId ? ' active' : '');
      li.onclick = () => selectSnippet(s.id);

      const title = document.createElement('div');
      title.className = 'snip-title';
      title.textContent = s.title;

      const sub = document.createElement('div');
      sub.className = 'snip-sub';
      const lang = document.createElement('span');
      lang.className = 'snip-lang';
      lang.textContent = Core.LANGUAGES[s.language].label;
      sub.appendChild(lang);
      if (s.tags.length) {
        const tg = document.createElement('span');
        tg.className = 'snip-tag';
        tg.textContent = s.tags.map((t) => '#' + t).join(' ');
        sub.appendChild(tg);
      }

      li.appendChild(title);
      li.appendChild(sub);
      els.list.appendChild(li);
    }
  }

  function render() {
    renderFacets();
    renderList();
  }

  // --- rendering: the editor preview --------------------------------
  function renderPreview() {
    els.preview.innerHTML = Core.highlightHtml(els.code.value, els.language.value);
  }

  // --- selection + editor state -------------------------------------
  function showEditor(show) {
    els.editor.classList.toggle('hidden', !show);
    els.empty.classList.toggle('hidden', show);
  }

  function selectSnippet(id) {
    if (dirty) saveCurrent(true);
    const s = store.get(id);
    if (!s) { selectedId = null; showEditor(false); render(); return; }
    selectedId = id;
    els.title.value = s.title;
    els.language.value = s.language;
    els.tags.value = s.tags.join(', ');
    els.code.value = s.code;
    els.stamp.textContent = 'Updated ' + new Date(s.updatedAt).toLocaleString();
    renderPreview();
    setDirty(false);
    showEditor(true);
    render();
  }

  function setDirty(d) {
    dirty = d;
    els.saveState.textContent = d ? 'Unsaved…' : 'Saved';
    els.saveState.className = 'save-state ' + (d ? 'dirty' : 'saved');
  }

  function saveCurrent(silent) {
    if (!selectedId) return;
    const code = els.code.value;
    if (code.trim() === '') { if (!silent) toast('Nothing to save — the snippet is empty'); return; }
    store.update(selectedId, {
      title: els.title.value,
      language: els.language.value,
      tags: els.tags.value,
      code,
    });
    persist();
    setDirty(false);
    const s = store.get(selectedId);
    if (s) els.stamp.textContent = 'Updated ' + new Date(s.updatedAt).toLocaleString();
    render();
  }

  function newSnippet() {
    if (dirty) saveCurrent(true);
    const s = store.add({ title: 'Untitled snippet', language: 'javascript', tags: [], code: '// your code here\n' });
    persist();
    selectSnippet(s.id);
    els.title.focus();
    els.title.select();
  }

  function deleteCurrent() {
    if (!selectedId) return;
    const s = store.get(selectedId);
    if (!s) return;
    if (!window.confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
    store.remove(selectedId);
    persist();
    selectedId = null;
    dirty = false;
    showEditor(false);
    render();
    toast('Snippet deleted');
  }

  // --- debounced autosave while typing ------------------------------
  let saveTimer = null;
  function scheduleSave() {
    setDirty(true);
    renderPreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveCurrent(true), 600);
  }

  // --- event wiring --------------------------------------------------
  $('new-btn').onclick = newSnippet;
  $('empty-new').onclick = newSnippet;
  $('delete-btn').onclick = deleteCurrent;

  $('copy-btn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(els.code.value);
      toast('Copied to clipboard');
    } catch (_e) {
      els.code.select();
      toast('Press Ctrl/Cmd+C to copy');
    }
  };

  els.search.addEventListener('input', () => { activeFacet = null; render(); });
  els.code.addEventListener('input', scheduleSave);
  els.title.addEventListener('input', () => setDirty(true));
  els.tags.addEventListener('input', () => setDirty(true));
  els.language.addEventListener('change', () => { setDirty(true); renderPreview(); });

  // Save on blur of the quick fields so a click away always persists.
  for (const f of [els.title, els.tags, els.code]) {
    f.addEventListener('blur', () => { if (dirty) saveCurrent(true); });
  }

  // Keyboard: Ctrl/Cmd+B = new, Ctrl/Cmd+S = save.
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); newSnippet(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(false); toast('Saved'); }
  });

  // Tab inserts a tab in the code area instead of leaving the field.
  els.code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = els.code.selectionStart, end = els.code.selectionEnd;
      els.code.value = els.code.value.slice(0, start) + '    ' + els.code.value.slice(end);
      els.code.selectionStart = els.code.selectionEnd = start + 4;
      scheduleSave();
    }
  });

  window.addEventListener('beforeunload', () => { if (dirty) saveCurrent(true); });

  // --- sample data ---------------------------------------------------
  const SAMPLES = [
    {
      title: 'debounce', language: 'javascript', tags: ['util', 'timing'],
      code: `// Delay a call until it stops firing for \`wait\` ms.\nfunction debounce(fn, wait = 200) {\n  let t;\n  return function (...args) {\n    clearTimeout(t);\n    t = setTimeout(() => fn.apply(this, args), wait);\n  };\n}`,
    },
    {
      title: 'chunked(iterable, n)', language: 'python', tags: ['util', 'itertools'],
      code: `def chunked(seq, n):\n    """Yield successive n-sized chunks from seq."""\n    for i in range(0, len(seq), n):\n        yield seq[i:i + n]  # a slice, not a copy of the whole list`,
    },
    {
      title: 'recent orders by customer', language: 'sql', tags: ['query', 'report'],
      code: `-- top 5 customers by spend this year\nSELECT c.name, SUM(o.total) AS spend\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.created_at >= '2026-01-01'\nGROUP BY c.name\nORDER BY spend DESC\nLIMIT 5;`,
    },
    {
      title: 'clamp(v, lo, hi)', language: 'c', tags: ['math', 'util'],
      code: `/* keep v within [lo, hi] */\nint clamp(int v, int lo, int hi) {\n    if (v < lo) return lo;\n    if (v > hi) return hi;\n    return v;\n}`,
    },
  ];

  $('sample-btn').onclick = loadSamples;
  $('empty-sample').onclick = loadSamples;
  function loadSamples() {
    let first = null;
    for (const s of SAMPLES) {
      const added = store.add(s);
      if (!first) first = added.id;
    }
    persist();
    render();
    if (first) selectSnippet(first);
    toast('Loaded sample snippets');
  }

  // --- boot ----------------------------------------------------------
  render();
  const firstList = store.list();
  if (firstList.length) selectSnippet(firstList[0].id);
  else showEditor(false);
})();
