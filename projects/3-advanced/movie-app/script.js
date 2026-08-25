// script.js — the browser client. Thin painter: it reads the DOM, asks a data
// source (live TheMovieDB or the bundled sample catalog) for JSON, hands that
// JSON to MovieCore, and renders whatever comes back. Every value from the data
// source is written with textContent (never innerHTML), so a synopsis or cast
// name can't inject markup.

(function () {
  'use strict';

  const Core = window.MovieCore;
  const Sample = window.SampleData;

  const KEY_STORAGE = 'movieapp.apikey';
  const LIST_STORAGE = 'movieapp.watchlist';

  // --- element handles ------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const els = {
    homeLink: $('home-link'),
    searchForm: $('search-form'),
    searchInput: $('search-input'),
    tabBrowse: $('tab-browse'),
    tabWatchlist: $('tab-watchlist'),
    watchlistCount: $('watchlist-count'),
    sourceLabel: $('source-label'),
    keyForm: $('key-form'),
    keyInput: $('key-input'),
    keyClear: $('key-clear'),
    message: $('message'),
    gridView: $('grid-view'),
    gridTitle: $('grid-title'),
    grid: $('grid'),
    sentinel: $('sentinel'),
    gridStatus: $('grid-status'),
    detailView: $('detail-view'),
  };

  // --- app state ------------------------------------------------------------
  const state = {
    apiKey: safeGet(KEY_STORAGE) || '',
    watchlist: Core.parseWatchlist(safeGet(LIST_STORAGE)),
    mode: 'browse',       // 'browse' | 'search' | 'watchlist' | 'detail'
    query: '',
    page: 1,
    totalPages: 1,
    movies: [],
    loading: false,
  };

  // ==========================================================================
  // Storage helpers (localStorage can throw in private mode — never let it
  // take the app down).
  // ==========================================================================
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function safeRemove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function persistWatchlist() {
    safeSet(LIST_STORAGE, Core.serializeWatchlist(state.watchlist));
    els.watchlistCount.textContent = String(state.watchlist.length);
  }

  // ==========================================================================
  // Data source — one of two backends behind a single async shape. Both return
  // the raw API-shaped JSON that MovieCore expects.
  // ==========================================================================
  function usingLive() { return Boolean(state.apiKey); }

  async function fetchJson(url) {
    const res = await fetch(url);
    const status = Core.describeStatus(res.status);
    if (!status.ok) throw new Error(status.message);
    return res.json();
  }

  async function loadDiscover(page) {
    if (usingLive()) return fetchJson(Core.discoverUrl(state.apiKey, { page }));
    return Sample.page(page); // synchronous, but await-safe
  }

  async function loadMovie(id) {
    if (usingLive()) return fetchJson(Core.movieUrl(state.apiKey, id));
    const found = Sample.find(id);
    if (!found) throw new Error('That movie could not be found.');
    return found;
  }

  async function loadSearch(query, page) {
    if (usingLive()) return fetchJson(Core.searchUrl(state.apiKey, query, { page }));
    return Sample.search(query);
  }

  // ==========================================================================
  // Views
  // ==========================================================================
  function showMessage(text) {
    if (!text) { els.message.hidden = true; return; }
    els.message.textContent = text;
    els.message.hidden = false;
  }

  function setActiveTab(which) {
    els.tabBrowse.classList.toggle('is-active', which === 'browse');
    els.tabWatchlist.classList.toggle('is-active', which === 'watchlist');
  }

  function showGrid() {
    els.gridView.hidden = false;
    els.detailView.hidden = true;
  }
  function showDetail() {
    els.gridView.hidden = true;
    els.detailView.hidden = false;
  }

  // Build one poster card. Uses a lettered placeholder when there is no artwork.
  function movieCard(movie) {
    const card = document.createElement('article');
    card.className = 'card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${movie.title}${movie.year ? ', ' + movie.year : ''}`);

    const poster = Core.posterUrl(movie.posterPath);
    const art = document.createElement('div');
    art.className = 'card-poster';
    if (poster) {
      const img = document.createElement('img');
      img.src = poster;
      img.alt = '';
      img.loading = 'lazy';
      art.appendChild(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'poster-placeholder';
      ph.textContent = movie.title.slice(0, 1).toUpperCase();
      art.appendChild(ph);
    }
    card.appendChild(art);

    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = movie.title;
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const year = document.createElement('span');
    year.textContent = movie.year ? String(movie.year) : '—';
    meta.appendChild(year);
    if (movie.rating) {
      const rating = document.createElement('span');
      rating.className = 'card-rating';
      rating.textContent = '★ ' + movie.rating.toFixed(1);
      meta.appendChild(rating);
    }
    body.appendChild(meta);
    card.appendChild(body);

    const open = () => openDetail(movie.id);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return card;
  }

  function renderGrid(replace) {
    if (replace) els.grid.textContent = '';
    const start = replace ? 0 : els.grid.childElementCount;
    for (let i = start; i < state.movies.length; i += 1) {
      els.grid.appendChild(movieCard(state.movies[i]));
    }
    if (state.movies.length === 0) {
      els.gridStatus.textContent = state.mode === 'search'
        ? `No movies match “${state.query}”.`
        : 'No movies to show.';
    } else if (state.page >= state.totalPages) {
      els.gridStatus.textContent = 'You’ve reached the end.';
    } else {
      els.gridStatus.textContent = '';
    }
  }

  // --- Browse (homepage): latest movies, sorted by release date -------------
  async function openBrowse() {
    state.mode = 'browse';
    state.query = '';
    state.page = 1;
    state.movies = [];
    setActiveTab('browse');
    showGrid();
    els.gridTitle.textContent = 'Latest movies';
    els.grid.textContent = '';
    showMessage('');
    await loadMore(true);
  }

  // --- Search ---------------------------------------------------------------
  async function openSearch(query) {
    state.mode = 'search';
    state.query = query;
    state.page = 1;
    state.movies = [];
    setActiveTab('browse');
    showGrid();
    els.gridTitle.textContent = `Results for “${query}”`;
    els.grid.textContent = '';
    showMessage('');
    await loadMore(true);
  }

  // Shared loader for browse + search; supports "scroll for more" paging.
  async function loadMore(replace) {
    if (state.loading || state.mode === 'watchlist' || state.mode === 'detail') return;
    if (!replace && state.page >= state.totalPages) return;
    state.loading = true;
    els.gridStatus.textContent = 'Loading…';
    const wantPage = replace ? 1 : state.page + 1;
    try {
      const raw = state.mode === 'search'
        ? await loadSearch(state.query, wantPage)
        : await loadDiscover(wantPage);
      const fresh = Core.buildCatalog(raw);
      state.movies = replace ? fresh : Core.mergePage(state.movies, fresh);
      state.page = raw && raw.page ? raw.page : wantPage;
      state.totalPages = raw && raw.total_pages ? raw.total_pages : 1;
      renderGrid(replace);
    } catch (err) {
      showMessage(err.message || 'Something went wrong loading movies.');
      els.gridStatus.textContent = '';
    } finally {
      state.loading = false;
    }
  }

  // --- Detail page ----------------------------------------------------------
  async function openDetail(id) {
    state.mode = 'detail';
    showMessage('');
    showDetail();
    els.detailView.textContent = '';
    els.detailView.appendChild(makeBackButton());
    const loading = document.createElement('p');
    loading.className = 'grid-status';
    loading.textContent = 'Loading…';
    els.detailView.appendChild(loading);
    try {
      const raw = await loadMovie(id);
      const movie = Core.normalizeMovie(raw);
      renderDetail(movie);
    } catch (err) {
      loading.textContent = err.message || 'Could not load that movie.';
    }
  }

  function makeBackButton() {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back-btn';
    back.textContent = '← Back';
    back.addEventListener('click', () => {
      if (state.mode === 'detail') {
        // Return to whatever list we came from.
        if (previousMode === 'watchlist') openWatchlist();
        else { showGrid(); state.mode = previousMode; }
      }
    });
    return back;
  }
  let previousMode = 'browse';

  function renderDetail(movie) {
    const dm = Core.detailModel(movie);
    els.detailView.textContent = '';
    els.detailView.appendChild(makeBackButton());
    if (!dm) {
      const p = document.createElement('p');
      p.textContent = 'That movie could not be found.';
      els.detailView.appendChild(p);
      return;
    }

    const hero = document.createElement('div');
    hero.className = 'detail-hero';

    const posterWrap = document.createElement('div');
    posterWrap.className = 'detail-poster';
    if (dm.poster) {
      const img = document.createElement('img');
      img.src = dm.poster;
      img.alt = '';
      posterWrap.appendChild(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'poster-placeholder';
      ph.textContent = dm.title.slice(0, 1).toUpperCase();
      posterWrap.appendChild(ph);
    }
    hero.appendChild(posterWrap);

    const info = document.createElement('div');
    info.className = 'detail-info';

    const h2 = document.createElement('h2');
    h2.className = 'detail-title';
    h2.textContent = dm.title + (dm.year ? ` (${dm.year})` : '');
    info.appendChild(h2);

    const facts = document.createElement('div');
    facts.className = 'detail-facts';
    [dm.ratingText, dm.votesText, dm.runtimeText, dm.genresText]
      .filter(Boolean)
      .forEach((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        facts.appendChild(span);
      });
    info.appendChild(facts);

    const overview = document.createElement('p');
    overview.className = 'detail-overview';
    overview.textContent = dm.overview;
    info.appendChild(overview);

    // Watchlist toggle (bonus feature)
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'watch-btn';
    const refreshToggle = () => {
      const inList = Core.isInWatchlist(state.watchlist, dm.id);
      toggle.textContent = inList ? '✓ In your watchlist' : '+ Add to watchlist';
      toggle.classList.toggle('is-in', inList);
    };
    toggle.addEventListener('click', () => {
      state.watchlist = Core.toggleWatchlist(state.watchlist, movie, Date.now());
      persistWatchlist();
      refreshToggle();
    });
    refreshToggle();
    info.appendChild(toggle);

    hero.appendChild(info);
    els.detailView.appendChild(hero);

    // Cast
    if (dm.cast.length) {
      const castTitle = document.createElement('h3');
      castTitle.className = 'section-title';
      castTitle.textContent = 'Cast';
      els.detailView.appendChild(castTitle);

      const castList = document.createElement('ul');
      castList.className = 'cast-list';
      dm.cast.forEach((c) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'cast-name';
        name.textContent = c.name;
        li.appendChild(name);
        if (c.character) {
          const role = document.createElement('span');
          role.className = 'cast-role';
          role.textContent = c.character;
          li.appendChild(role);
        }
        castList.appendChild(li);
      });
      els.detailView.appendChild(castList);
    }
  }

  // --- Watchlist view (bonus feature: watchlist + reviews) ------------------
  function openWatchlist() {
    previousMode = 'watchlist';
    state.mode = 'watchlist';
    setActiveTab('watchlist');
    showGrid();
    showMessage('');
    els.gridTitle.textContent = 'Your watchlist';
    els.grid.textContent = '';
    els.gridStatus.textContent = '';

    if (state.watchlist.length === 0) {
      els.gridStatus.textContent = 'Your watchlist is empty. Open a movie and add it.';
      return;
    }
    state.watchlist.forEach((entry) => {
      els.grid.appendChild(watchlistCard(entry));
    });
  }

  function watchlistCard(entry) {
    const card = document.createElement('article');
    card.className = 'card watch-card';

    const art = document.createElement('div');
    art.className = 'card-poster';
    const poster = Core.posterUrl(entry.posterPath);
    if (poster) {
      const img = document.createElement('img');
      img.src = poster; img.alt = ''; img.loading = 'lazy';
      art.appendChild(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'poster-placeholder';
      ph.textContent = entry.title.slice(0, 1).toUpperCase();
      art.appendChild(ph);
    }
    art.style.cursor = 'pointer';
    art.addEventListener('click', () => { previousMode = 'watchlist'; openDetail(entry.id); });
    card.appendChild(art);

    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = entry.title + (entry.year ? ` (${entry.year})` : '');
    body.appendChild(title);

    // Review editor
    const review = document.createElement('textarea');
    review.className = 'review-box';
    review.placeholder = 'Write a quick review…';
    review.value = entry.review || '';
    review.addEventListener('change', () => {
      state.watchlist = Core.setReview(state.watchlist, entry.id, review.value);
      persistWatchlist();
    });
    body.appendChild(review);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost remove-btn';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      state.watchlist = Core.removeFromWatchlist(state.watchlist, entry.id);
      persistWatchlist();
      openWatchlist();
    });
    body.appendChild(remove);

    card.appendChild(body);
    return card;
  }

  // ==========================================================================
  // Data-source (API key) controls
  // ==========================================================================
  function refreshSourceLabel() {
    els.sourceLabel.textContent = usingLive()
      ? 'live TheMovieDB'
      : 'bundled sample catalog';
    els.keyInput.value = state.apiKey;
  }

  // ==========================================================================
  // Wiring
  // ==========================================================================
  function wire() {
    els.homeLink.addEventListener('click', openBrowse);
    els.homeLink.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBrowse(); }
    });

    els.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = els.searchInput.value.trim();
      if (q) { previousMode = 'search'; openSearch(q); }
      else openBrowse();
    });

    els.tabBrowse.addEventListener('click', () => { previousMode = 'browse'; openBrowse(); });
    els.tabWatchlist.addEventListener('click', openWatchlist);

    els.keyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = els.keyInput.value.trim();
      state.apiKey = key;
      if (key) safeSet(KEY_STORAGE, key); else safeRemove(KEY_STORAGE);
      refreshSourceLabel();
      openBrowse();
    });
    els.keyClear.addEventListener('click', () => {
      state.apiKey = '';
      safeRemove(KEY_STORAGE);
      refreshSourceLabel();
      openBrowse();
    });

    // "Scroll to browse additional movies" — infinite scroll via IntersectionObserver.
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          if (state.mode === 'browse' || state.mode === 'search') loadMore(false);
        }
      }, { rootMargin: '200px' });
      io.observe(els.sentinel);
    }
  }

  // ==========================================================================
  // Boot
  // ==========================================================================
  refreshSourceLabel();
  persistWatchlist();
  wire();
  openBrowse();
})();
