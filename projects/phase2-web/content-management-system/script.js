/*
 * script.js — browser glue for the Flatpress admin.
 * All content logic lives in cms-core.js (window.CMS). This file only wires
 * the DOM to that engine and persists the store in localStorage.
 */

(function () {
  'use strict';

  const Core = window.CMS;
  const STORE_KEY = 'flatpress.store.v1';
  const TITLE_KEY = 'flatpress.sitetitle.v1';

  /* ---- persistence ------------------------------------------------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Core.CMS.fromJSON(raw);
    } catch (e) { /* ignore */ }
    return new Core.CMS();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, cms.toJSON()); } catch (e) { /* ignore */ }
  }
  function loadSiteTitle() {
    try { return localStorage.getItem(TITLE_KEY) || 'My Site'; } catch (e) { return 'My Site'; }
  }
  function saveSiteTitle(t) {
    try { localStorage.setItem(TITLE_KEY, t); } catch (e) { /* ignore */ }
  }

  let cms = load();
  let selectedId = null;

  /* ---- element helpers --------------------------------------------- */

  const $ = (id) => document.getElementById(id);

  /* ---- tabs -------------------------------------------------------- */

  const tabs = {
    content: { btn: $('tab-content'), view: $('view-content') },
    preview: { btn: $('tab-preview'), view: $('view-preview') },
    data: { btn: $('tab-data'), view: $('view-data') },
  };
  function showTab(name) {
    for (const [k, t] of Object.entries(tabs)) {
      t.btn.classList.toggle('active', k === name);
      t.view.hidden = k !== name;
    }
    if (name === 'preview') renderPreview();
  }
  tabs.content.btn.onclick = () => showTab('content');
  tabs.preview.btn.onclick = () => showTab('preview');
  tabs.data.btn.onclick = () => showTab('data');

  /* ---- list rendering ---------------------------------------------- */

  function currentFilter() {
    const status = document.querySelector('input[name=statusf]:checked').value;
    const query = $('search').value.trim();
    return { status: status || undefined, query: query || undefined };
  }

  function renderList() {
    const list = $('item-list');
    list.innerHTML = '';
    const items = cms.list(currentFilter());
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = 'Nothing here yet.';
      li.style.cursor = 'default';
      li.style.color = 'var(--muted)';
      list.appendChild(li);
      return;
    }
    for (const it of items) {
      const li = document.createElement('li');
      li.className = it.id === selectedId ? 'active' : '';
      const title = document.createElement('span');
      title.className = 'it-title';
      title.textContent = it.title || '(untitled)';
      const meta = document.createElement('span');
      meta.className = 'it-meta';
      meta.textContent = `${it.type} · ${it.status}` +
        (it.tags.length ? ` · ${it.tags.join(', ')}` : '');
      li.appendChild(title);
      li.appendChild(meta);
      li.onclick = () => selectItem(it.id);
      list.appendChild(li);
    }
  }

  /* ---- editor ------------------------------------------------------ */

  function selectItem(id) {
    selectedId = id;
    const it = cms.get(id);
    $('editor-empty').hidden = true;
    $('editor-form').hidden = false;
    $('f-title').value = it.title;
    $('f-slug').textContent = it.slug;
    $('f-tags').value = it.tags.join(', ');
    $('f-body').value = it.body;
    updateStatusUi(it);
    renderLivePreview();
    renderList();
  }

  function updateStatusUi(it) {
    const badge = $('f-status-badge');
    badge.textContent = it.status;
    badge.className = 'badge ' + it.status;
    $('toggle-publish').textContent =
      it.status === Core.STATUS.PUBLISHED ? 'Unpublish' : 'Publish';
  }

  function renderLivePreview() {
    $('live-preview').innerHTML = Core.renderMarkdown($('f-body').value);
  }

  function deselect() {
    selectedId = null;
    $('editor-form').hidden = true;
    $('editor-empty').hidden = false;
    renderList();
  }

  // Create
  function create(type) {
    const it = cms.create({ title: 'Untitled', type });
    save();
    selectItem(it.id);
    $('f-title').select();
  }
  $('new-post').onclick = () => create('post');
  $('new-page').onclick = () => create('page');

  // Save (title, body, tags). Slug stays put unless re-slugged explicitly.
  $('save').onclick = () => {
    if (!selectedId) return;
    cms.update(selectedId, {
      title: $('f-title').value,
      body: $('f-body').value,
      tags: $('f-tags').value,
    });
    save();
    selectItem(selectedId);
  };

  // Regenerate slug from current title (and de-dupe).
  $('reslug').onclick = () => {
    if (!selectedId) return;
    cms.update(selectedId, { slug: $('f-title').value || 'untitled' });
    save();
    selectItem(selectedId);
  };

  // Publish / unpublish toggle.
  $('toggle-publish').onclick = () => {
    if (!selectedId) return;
    const it = cms.get(selectedId);
    if (it.status === Core.STATUS.PUBLISHED) cms.unpublish(it.id);
    else cms.publish(it.id);
    save();
    selectItem(selectedId);
  };

  // Delete.
  $('delete').onclick = () => {
    if (!selectedId) return;
    const it = cms.get(selectedId);
    if (!confirm(`Delete "${it.title}"? This cannot be undone.`)) return;
    cms.remove(selectedId);
    save();
    deselect();
  };

  // Live preview as you type.
  $('f-body').addEventListener('input', renderLivePreview);

  // Filters.
  $('search').addEventListener('input', renderList);
  document.querySelectorAll('input[name=statusf]').forEach((r) =>
    r.addEventListener('change', renderList)
  );

  /* ---- site preview ------------------------------------------------ */

  const siteTitleInput = $('site-title');
  siteTitleInput.value = loadSiteTitle();

  function renderPreview() {
    const siteTitle = siteTitleInput.value || 'My Site';
    const pages = Core.renderSite(cms, { siteTitle });
    const picker = $('page-picker');
    const prev = picker.value;
    picker.innerHTML = '';
    Object.keys(pages).forEach((path) => {
      const opt = document.createElement('option');
      opt.value = path;
      opt.textContent = path;
      picker.appendChild(opt);
    });
    if (prev && pages[prev]) picker.value = prev;
    showPage(pages, picker.value || 'index.html');
    picker.onchange = () => showPage(pages, picker.value);
  }
  function showPage(pages, path) {
    // srcdoc keeps the preview sandboxed from this admin document.
    $('site-frame').srcdoc = pages[path] || '';
  }
  siteTitleInput.addEventListener('input', () => {
    saveSiteTitle(siteTitleInput.value);
    renderPreview();
  });

  /* ---- data tab ---------------------------------------------------- */

  $('export').onclick = () => {
    $('data-box').value = cms.toJSON();
    $('data-box').select();
    try { navigator.clipboard.writeText(cms.toJSON()); } catch (e) { /* ignore */ }
  };
  $('import').onclick = () => {
    const incoming = Core.CMS.fromJSON($('data-box').value);
    if (!incoming.items.length && $('data-box').value.trim()) {
      alert('Could not parse that JSON (or it had no items).');
      return;
    }
    cms = incoming;
    save();
    deselect();
    renderList();
    alert(`Imported ${cms.items.length} item(s).`);
  };
  $('seed').onclick = () => {
    if (cms.items.length && !confirm('Replace current content with the sample set?')) return;
    cms = sampleContent();
    save();
    deselect();
    renderList();
  };
  $('wipe').onclick = () => {
    if (!confirm('Erase ALL content? This cannot be undone.')) return;
    cms = new Core.CMS();
    save();
    deselect();
    renderList();
  };

  function sampleContent() {
    const c = new Core.CMS();
    c.create({
      title: 'Welcome to Flatpress',
      tags: ['meta', 'news'],
      status: 'published',
      body:
        '# Welcome\n\nThis is a **flat-file CMS** that runs entirely in your ' +
        'browser. Write in *Markdown*, hit **Publish**, and switch to the ' +
        '**Site preview** tab to see the generated pages.\n\n' +
        '## Features\n\n- Markdown with `inline code`\n- Draft vs published\n' +
        '- Tags and search\n- A static-site preview\n\n' +
        '> Everything is saved in your browser — nothing is uploaded.',
    });
    c.create({
      title: 'A draft in progress',
      tags: ['tech'],
      status: 'draft',
      body: 'This one is still a draft, so it will **not** appear on the site preview.',
    });
    c.create({
      title: 'About',
      type: 'page',
      status: 'published',
      body: 'A standalone page. Built by an automated Claude Code routine.',
    });
    return c;
  }

  /* ---- boot -------------------------------------------------------- */

  if (!cms.items.length) cms = sampleContent(), save();
  renderList();
})();
