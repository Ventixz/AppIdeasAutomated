// script.js — the browser client for MyPodcast Library.
//
// It owns the DOM, the clock, and localStorage; every rule lives in
// podcast-core.js. The "fetch a podcast by its Podbean URL" step is emulated by
// sample-data.js (a real build would swap in a Puppeteer-backed endpoint), so
// the app runs with zero configuration. Every value that came from the data
// source is written with textContent — never innerHTML — so an episode title
// or hashtag can never inject markup.

(function () {
  'use strict';

  const Core = window.PodcastCore;
  const Sample = window.SampleData;
  const STORAGE_KEY = 'mypodcast.library.v1';

  // --- state ---------------------------------------------------------------
  let library = Core.parseLibrary(safeGet(STORAGE_KEY));
  let sortMode = 'recent'; // or 'rating' (bonus)

  // --- element handles -----------------------------------------------------
  const el = {
    homeLink: document.getElementById('home-link'),
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
    searchCancel: document.getElementById('search-cancel'),
    message: document.getElementById('message'),

    libraryView: document.getElementById('library-view'),
    addToggle: document.getElementById('add-toggle'),
    addPanel: document.getElementById('add-panel'),
    addUrl: document.getElementById('add-url'),
    addError: document.getElementById('add-error'),
    addCancel: document.getElementById('add-cancel'),
    rows: document.getElementById('podcast-rows'),
    table: document.getElementById('podcast-table'),
    empty: document.getElementById('library-empty'),

    episodesView: document.getElementById('episodes-view'),
    searchView: document.getElementById('search-view'),
  };

  // --- persistence ---------------------------------------------------------
  function persist() {
    safeSet(STORAGE_KEY, Core.serializeLibrary(library));
  }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  // --- view routing --------------------------------------------------------
  function showLibrary() {
    el.libraryView.hidden = false;
    el.episodesView.hidden = true;
    el.searchView.hidden = true;
    el.searchCancel.hidden = true;
    renderLibrary();
  }

  function renderLibrary() {
    el.rows.textContent = '';
    const now = new Date().toISOString();

    if (library.length === 0) {
      el.table.hidden = true;
      el.empty.hidden = false;
      return;
    }
    el.table.hidden = false;
    el.empty.hidden = true;

    library.forEach((p) => {
      const tr = document.createElement('tr');
      tr.className = 'podcast-row';

      const iconTd = document.createElement('td');
      if (p.icon) {
        const img = document.createElement('img');
        img.className = 'pod-icon';
        img.src = p.icon;
        img.alt = '';
        iconTd.appendChild(img);
      }

      const nameTd = document.createElement('td');
      const name = document.createElement('div');
      name.className = 'pod-name';
      name.textContent = p.name;
      nameTd.appendChild(name);

      const countTd = document.createElement('td');
      countTd.className = 'num';
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = String(Core.recentEpisodeCount(p, now));
      countTd.appendChild(pill);

      const actionTd = document.createElement('td');
      actionTd.className = 'num';
      const remove = document.createElement('button');
      remove.className = 'row-remove';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', (ev) => {
        ev.stopPropagation();
        library = Core.removePodcast(library, p.id);
        persist();
        renderLibrary();
      });
      actionTd.appendChild(remove);

      // Clicking the row (its icon/name) opens the episodes page.
      [iconTd, nameTd, countTd].forEach((td) => {
        td.addEventListener('click', () => showEpisodes(p.id));
      });

      tr.append(iconTd, nameTd, countTd, actionTd);
      el.rows.appendChild(tr);
    });
  }

  // --- the add-a-podcast flow ---------------------------------------------
  function openAddPanel() {
    el.addPanel.hidden = false;
    el.addToggle.setAttribute('aria-expanded', 'true');
    el.addError.hidden = true;
    el.addUrl.value = '';
    el.addUrl.focus();
  }
  function closeAddPanel() {
    el.addPanel.hidden = true;
    el.addToggle.setAttribute('aria-expanded', 'false');
  }
  function showAddError(text) {
    el.addError.textContent = text;
    el.addError.hidden = false;
  }

  function trySavePodcast(url) {
    // 1. Validate the URL shape (Podbean podcast-detail path / subdomain).
    if (!Core.isValidPodcastUrl(url)) {
      showAddError('That is not a Podbean podcast URL. It should look like ' +
        'https://www.podbean.com/podcast-detail/… or https://your-show.podbean.com/.');
      return;
    }
    // 2. "Fetch" it (emulated) and surface a 404 the way the spec asks.
    const res = Sample.find(url);
    if (!res.ok) {
      showAddError(Core.describeStatus(res.status).message);
      return;
    }
    // 3. De-dupe and persist.
    if (Core.hasPodcast(library, Core.normalizePodcast(res.podcast))) {
      showAddError('That podcast is already in your library.');
      return;
    }
    library = Core.addPodcast(library, res.podcast);
    persist();
    closeAddPanel();
    flash(`Added “${res.podcast.name}”.`);
    renderLibrary();
  }

  // --- one podcast's episodes ---------------------------------------------
  function showEpisodes(podcastId) {
    const podcast = library.find((p) => p.id === podcastId);
    if (!podcast) return showLibrary();

    el.libraryView.hidden = true;
    el.searchView.hidden = true;
    el.episodesView.hidden = false;
    el.searchCancel.hidden = true;
    renderEpisodes(podcast);
  }

  function renderEpisodes(podcast) {
    const view = el.episodesView;
    view.textContent = '';

    const back = document.createElement('button');
    back.className = 'back-link';
    back.type = 'button';
    back.textContent = '← All podcasts';
    back.addEventListener('click', showLibrary);
    view.appendChild(back);

    const head = document.createElement('div');
    head.className = 'episodes-head';
    if (podcast.icon) {
      const img = document.createElement('img');
      img.src = podcast.icon; img.alt = '';
      head.appendChild(img);
    }
    const h2 = document.createElement('h2');
    h2.textContent = podcast.name;
    head.appendChild(h2);
    view.appendChild(head);

    // Sort toggle: recent (default) vs. rating (bonus).
    const controls = document.createElement('div');
    controls.className = 'sort-controls';
    [['recent', 'Most recent'], ['rating', 'Top rated']].forEach(([mode, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (sortMode === mode) b.className = 'is-active';
      b.addEventListener('click', () => { sortMode = mode; renderEpisodes(podcast); });
      controls.appendChild(b);
    });
    view.appendChild(controls);

    const table = document.createElement('table');
    table.className = 'episode-table';
    const tbody = document.createElement('tbody');
    const ordered = Core.sortEpisodes(podcast.episodes, { by: sortMode === 'rating' ? 'rating' : 'recent' });
    ordered.forEach((ep) => tbody.appendChild(episodeRow(podcast, ep)));
    table.appendChild(tbody);
    view.appendChild(table);
  }

  // Build one episode <tr>. `context` (a podcast name) is shown in search mode.
  function episodeRow(podcast, ep, contextName) {
    const tr = document.createElement('tr');

    // icon → links out to the Podbean episode page
    const iconTd = document.createElement('td');
    if (ep.icon || podcast.icon) {
      const a = document.createElement('a');
      a.href = ep.url || '#';
      a.target = '_blank'; a.rel = 'noopener';
      const img = document.createElement('img');
      img.className = 'ep-icon';
      img.src = ep.icon || podcast.icon; img.alt = '';
      a.appendChild(img);
      iconTd.appendChild(a);
    }

    // title + date + hashtags + tag editor
    const mainTd = document.createElement('td');
    const title = document.createElement('div');
    title.className = 'ep-title';
    const link = document.createElement('a');
    link.href = ep.url || '#';
    link.target = '_blank'; link.rel = 'noopener';
    link.textContent = ep.title;
    title.appendChild(link);
    if (contextName) {
      const ctx = document.createElement('span');
      ctx.className = 'ep-date';
      ctx.textContent = '  · ' + contextName;
      title.appendChild(ctx);
    }
    mainTd.appendChild(title);

    if (ep.hashtags.length) {
      const tags = document.createElement('div');
      tags.className = 'ep-tags';
      ep.hashtags.forEach((t) => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = '#' + t;
        tags.appendChild(span);
      });
      mainTd.appendChild(tags);
    }

    // freeform hashtag editor (bonus)
    const tagInput = document.createElement('input');
    tagInput.className = 'tag-input';
    tagInput.type = 'text';
    tagInput.placeholder = 'Add hashtags (space or comma separated)…';
    tagInput.value = ep.hashtags.join(' ');
    tagInput.addEventListener('change', () => {
      library = Core.setEpisodeHashtags(library, podcast.id, ep.id, tagInput.value);
      persist();
    });
    mainTd.appendChild(tagInput);

    const dateTd = document.createElement('td');
    dateTd.className = 'ep-date';
    dateTd.textContent = ep.date || '';

    // stars (bonus)
    const starsTd = document.createElement('td');
    const stars = document.createElement('span');
    stars.className = 'stars';
    for (let s = 1; s <= Core.MAX_RATING; s += 1) {
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'star' + (s <= ep.rating ? ' is-on' : '');
      star.textContent = s <= ep.rating ? '★' : '☆';
      star.setAttribute('aria-label', `${s} star${s > 1 ? 's' : ''}`);
      star.addEventListener('click', () => {
        library = Core.rateEpisode(library, podcast.id, ep.id, s);
        persist();
        rerenderCurrent(podcast);
      });
      stars.appendChild(star);
    }
    starsTd.appendChild(stars);

    // heart / favourite
    const heartTd = document.createElement('td');
    const heart = document.createElement('button');
    heart.type = 'button';
    heart.className = 'heart' + (ep.favorite ? ' is-on' : '');
    heart.textContent = ep.favorite ? '❤️' : '🤍';
    heart.setAttribute('aria-label', ep.favorite ? 'Remove favourite' : 'Mark favourite');
    heart.setAttribute('aria-pressed', String(ep.favorite));
    heart.addEventListener('click', () => {
      library = Core.toggleFavorite(library, podcast.id, ep.id);
      persist();
      rerenderCurrent(podcast);
    });
    heartTd.appendChild(heart);

    tr.append(iconTd, mainTd, dateTd, starsTd, heartTd);
    return tr;
  }

  // After a star/heart click, re-render whatever list is on screen so ordering
  // and fill states update in place.
  function rerenderCurrent(podcast) {
    if (!el.searchView.hidden) {
      runSearch(el.searchInput.value);
    } else {
      const fresh = library.find((p) => p.id === podcast.id);
      if (fresh) renderEpisodes(fresh);
    }
  }

  // --- hashtag search (bonus) ---------------------------------------------
  function runSearch(query) {
    const results = Core.searchByHashtag(library, query);
    el.libraryView.hidden = true;
    el.episodesView.hidden = true;
    el.searchView.hidden = false;
    el.searchCancel.hidden = false;

    const view = el.searchView;
    view.textContent = '';

    const h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.textContent = `Episodes tagged “#${Core.cleanTag(query)}” (${results.length})`;
    view.appendChild(h2);

    if (results.length === 0) {
      const none = document.createElement('p');
      none.className = 'watermark';
      none.textContent = 'No episodes match that hashtag';
      view.appendChild(none);
      return;
    }

    const table = document.createElement('table');
    table.className = 'episode-table';
    const tbody = document.createElement('tbody');
    results.forEach((hit) => {
      const podcast = library.find((p) => p.id === hit.podcastId);
      tbody.appendChild(episodeRow(podcast, hit.episode, hit.podcastName));
    });
    table.appendChild(tbody);
    view.appendChild(table);
  }

  function flash(text) {
    el.message.textContent = text;
    el.message.hidden = false;
    setTimeout(() => { el.message.hidden = true; }, 2500);
  }

  // --- wiring --------------------------------------------------------------
  el.homeLink.addEventListener('click', showLibrary);
  el.homeLink.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showLibrary(); }
  });

  el.addToggle.addEventListener('click', () => {
    if (el.addPanel.hidden) openAddPanel(); else closeAddPanel();
  });
  el.addCancel.addEventListener('click', closeAddPanel);
  el.addPanel.addEventListener('submit', (e) => {
    e.preventDefault();
    trySavePodcast(el.addUrl.value);
  });

  el.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = el.searchInput.value.trim();
    if (q) runSearch(q);
  });
  el.searchCancel.addEventListener('click', () => {
    el.searchInput.value = '';
    showLibrary();
  });

  // First paint. Seed a first-run library from the sample data so the app has
  // something to show, but never clobber a returning user's saved library.
  if (library.length === 0 && !safeGet(STORAGE_KEY)) {
    library = Core.buildLibrary(Sample.all().slice(0, 2));
    persist();
  }
  showLibrary();
})();
