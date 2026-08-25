// movie-core.js — the presentation-free engine for the Movie App.
//
// It knows nothing about the DOM or `fetch`. You hand it the raw JSON that a
// movie API (shaped like TheMovieDB) returns, and it normalizes each record
// into a small stable shape, sorts the catalog by release date, paginates it
// for the "scroll for more" feature, builds a detail view-model, and manages a
// personal watchlist (with reviews) that serializes to a plain string for
// localStorage. The same code runs in the browser (loaded as a plain script)
// and in Node (for the test suite).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  else root.MovieCore = api;                                             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // TheMovieDB serves poster images from this CDN; the path is a partial like
  // "/abc.jpg". `w342` is a sensible card-sized width. The engine only builds
  // the URL string — it never fetches anything.
  const IMAGE_BASE = 'https://image.tmdb.org/t/p/';

  // ---------------------------------------------------------------------------
  // Building API URLs. The client passes an API key; the engine assembles the
  // endpoints the app needs: the latest/now-playing list (homepage), a single
  // movie's details, and a title search (used by the search box / bonus flows).
  // Keys are never logged or stored by the engine — it just interpolates them.
  // ---------------------------------------------------------------------------
  const API_BASE = 'https://api.themoviedb.org/3';

  function discoverUrl(apiKey, opts) {
    const options = opts || {};
    const page = Math.max(1, Math.min(500, Number(options.page) || 1));
    // "sort by release date" is exactly the homepage story: newest first.
    return `${API_BASE}/discover/movie` +
      `?api_key=${encodeURIComponent(apiKey)}` +
      `&sort_by=release_date.desc&include_adult=false&page=${page}` +
      `&vote_count.gte=10`;
  }

  function movieUrl(apiKey, id) {
    const cleanId = encodeURIComponent(String(id).trim());
    return `${API_BASE}/movie/${cleanId}` +
      `?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits`;
  }

  function searchUrl(apiKey, query, opts) {
    const options = opts || {};
    const page = Math.max(1, Math.min(500, Number(options.page) || 1));
    return `${API_BASE}/search/movie` +
      `?api_key=${encodeURIComponent(apiKey)}` +
      `&query=${encodeURIComponent(String(query).trim())}` +
      `&include_adult=false&page=${page}`;
  }

  // Build a full poster URL from the API's partial path. Returns '' when there
  // is no artwork so the client can drop in a placeholder instead.
  function posterUrl(path, size) {
    if (!path) return '';
    const width = size || 'w342';
    const clean = String(path).startsWith('/') ? String(path) : '/' + String(path);
    return `${IMAGE_BASE}${width}${clean}`;
  }

  // ---------------------------------------------------------------------------
  // Normalizing a raw movie record.
  //
  // The API hands back dozens of fields; the app needs a handful. Anything that
  // isn't a real movie (no id, no title) is dropped by returning null so a
  // partial/garbage record can't crash the render.
  // ---------------------------------------------------------------------------
  function normalizeMovie(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = raw.title || raw.name || raw.original_title;
    if (raw.id == null || !title) return null;

    const release = raw.release_date || raw.first_air_date || '';
    const year = releaseYear(release);

    return {
      id: raw.id,
      title: String(title),
      overview: raw.overview ? String(raw.overview) : '',
      releaseDate: release ? String(release) : '',
      year: year,
      rating: clampRating(raw.vote_average),
      votes: Number(raw.vote_count) || 0,
      posterPath: raw.poster_path ? String(raw.poster_path) : '',
      backdropPath: raw.backdrop_path ? String(raw.backdrop_path) : '',
      genres: normalizeGenres(raw.genres || raw.genre_ids),
      runtime: Number(raw.runtime) || 0,
      cast: normalizeCast(raw.credits && raw.credits.cast),
    };
  }

  // Ratings come back 0..10 as a float; clamp and round to one decimal so the
  // UI never shows "7.30000001" or a nonsense out-of-range value.
  function clampRating(value) {
    const n = Number(value);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;
  }

  // Pull a 4-digit year out of an ISO-ish date ("2021-05-04" → 2021). Returns
  // null when there is no usable date, so the client can hide the year.
  function releaseYear(dateStr) {
    const m = /^(\d{4})/.exec(String(dateStr || ''));
    return m ? Number(m[1]) : null;
  }

  // Genres arrive either as full {id,name} objects (detail endpoint) or as bare
  // id numbers (list endpoint). Normalize both to a list of trimmed names,
  // dropping ids we can't resolve.
  function normalizeGenres(genres) {
    if (!Array.isArray(genres)) return [];
    return genres
      .map((g) => {
        if (g && typeof g === 'object' && g.name) return String(g.name);
        if (typeof g === 'number') return GENRE_NAMES[g] || null;
        return null;
      })
      .filter(Boolean);
  }

  // TheMovieDB's stable genre id → name table, so list-endpoint results (which
  // only carry ids) still show readable genres.
  const GENRE_NAMES = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
    80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
    14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
    9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
    10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  };

  // Keep the top billed cast (in the API's own order), name + character only.
  function normalizeCast(cast, limit) {
    if (!Array.isArray(cast)) return [];
    const max = limit || 12;
    return cast
      .filter((c) => c && c.name)
      .slice(0, max)
      .map((c) => ({
        name: String(c.name),
        character: c.character ? String(c.character) : '',
      }));
  }

  // ---------------------------------------------------------------------------
  // Building the catalog for the homepage.
  //
  // The spec: "view the latest movies" and "sorted by release date". We
  // normalize, drop movies with no release date (they can't be sorted onto the
  // timeline sensibly), and sort newest-first with a title tie-break so equal
  // dates are deterministic.
  // ---------------------------------------------------------------------------
  function buildCatalog(rawResults, opts) {
    const options = opts || {};
    const order = options.order === 'asc' ? 'asc' : 'desc';
    const results = (rawResults && rawResults.results) || rawResults || [];

    const movies = (Array.isArray(results) ? results : [])
      .map(normalizeMovie)
      .filter(Boolean)
      .filter((m) => m.releaseDate);

    movies.sort((a, b) => {
      const diff = a.releaseDate < b.releaseDate ? -1 : a.releaseDate > b.releaseDate ? 1 : 0;
      if (diff !== 0) return order === 'asc' ? diff : -diff;
      return a.title.localeCompare(b.title);
    });

    return movies;
  }

  // "Scroll to see more": merge a freshly fetched page into what's already
  // shown, de-duplicating by id (the API can repeat a title across pages when
  // new releases shift the window) and preserving the existing order.
  function mergePage(existing, incoming) {
    const seen = new Set((existing || []).map((m) => m.id));
    const merged = (existing || []).slice();
    (incoming || []).forEach((m) => {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push(m);
      }
    });
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Detail view-model. Turns a normalized movie into the exact strings the
  // detail page shows, so the client stays a thin painter.
  // ---------------------------------------------------------------------------
  function detailModel(movie) {
    if (!movie) return null;
    return {
      id: movie.id,
      title: movie.title,
      year: movie.year,
      overview: movie.overview || 'No synopsis available.',
      rating: movie.rating,
      ratingText: movie.rating ? `${movie.rating.toFixed(1)} / 10` : 'Not yet rated',
      votesText: movie.votes ? `${formatCount(movie.votes)} votes` : '',
      runtimeText: formatRuntime(movie.runtime),
      genresText: movie.genres.length ? movie.genres.join(', ') : '',
      cast: movie.cast,
      poster: posterUrl(movie.posterPath),
      backdrop: posterUrl(movie.backdropPath, 'w780'),
    };
  }

  // "1204" → "1,204"; "15300" → "15.3K"; "2100000" → "2.1M".
  function formatCount(n) {
    const num = Number(n) || 0;
    if (num < 1000) return String(num);
    if (num < 1000000) {
      const k = num / 1000;
      return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'K';
    }
    const m = num / 1000000;
    return (Math.round(m * 10) / 10) + 'M';
  }

  // 137 → "2h 17m"; 45 → "45m"; 0/unknown → ''.
  function formatRuntime(minutes) {
    const total = Number(minutes) || 0;
    if (total <= 0) return '';
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  // ---------------------------------------------------------------------------
  // Bonus feature: a personal watchlist, with optional reviews.
  //
  // The watchlist is a plain array of small entries the client can serialize to
  // localStorage. The engine owns the add/remove/toggle/review rules so the same
  // logic is testable in Node.
  // ---------------------------------------------------------------------------
  function watchlistEntry(movie) {
    return {
      id: movie.id,
      title: movie.title,
      year: movie.year,
      posterPath: movie.posterPath,
      rating: movie.rating,
      review: '',
      addedAt: null, // stamped by the client, which owns the clock
    };
  }

  function isInWatchlist(list, id) {
    return (list || []).some((e) => e.id === id);
  }

  // Add a movie if it isn't already present; returns a NEW array (never mutates
  // the input) so the client can treat state as immutable.
  function addToWatchlist(list, movie, stampedAt) {
    const current = Array.isArray(list) ? list : [];
    if (!movie || isInWatchlist(current, movie.id)) return current.slice();
    const entry = watchlistEntry(movie);
    if (stampedAt != null) entry.addedAt = stampedAt;
    return current.concat([entry]);
  }

  function removeFromWatchlist(list, id) {
    return (Array.isArray(list) ? list : []).filter((e) => e.id !== id);
  }

  // Add if absent, remove if present. Handy for a single star/bookmark button.
  function toggleWatchlist(list, movie, stampedAt) {
    const current = Array.isArray(list) ? list : [];
    return isInWatchlist(current, movie.id)
      ? removeFromWatchlist(current, movie.id)
      : addToWatchlist(current, movie, stampedAt);
  }

  // Attach / edit a user's review text on an entry already in the list. Returns
  // a new array; a no-op (returns a copy) if the movie isn't in the list.
  function setReview(list, id, text) {
    const review = String(text == null ? '' : text).trim();
    return (Array.isArray(list) ? list : []).map((e) =>
      e.id === id ? Object.assign({}, e, { review }) : e
    );
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers. The client hands us whatever came out of localStorage
  // (a string or null); we hand back a clean array, tolerating corruption. And
  // we serialize back to a compact string for saving.
  // ---------------------------------------------------------------------------
  function serializeWatchlist(list) {
    return JSON.stringify(Array.isArray(list) ? list : []);
  }

  function parseWatchlist(raw) {
    if (!raw) return [];
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(data)) return [];
      return data
        .filter((e) => e && e.id != null && e.title)
        .map((e) => ({
          id: e.id,
          title: String(e.title),
          year: e.year == null ? null : Number(e.year),
          posterPath: e.posterPath ? String(e.posterPath) : '',
          rating: clampRating(e.rating),
          review: e.review ? String(e.review) : '',
          addedAt: e.addedAt == null ? null : e.addedAt,
        }));
    } catch (err) {
      return []; // corrupt storage shouldn't take the app down
    }
  }

  // ---------------------------------------------------------------------------
  // Interpreting an HTTP status from the movie API into a friendly message.
  // ---------------------------------------------------------------------------
  function describeStatus(status) {
    switch (Number(status)) {
      case 200: return { ok: true, code: 'ok', message: '' };
      case 401: return { ok: false, code: 'unauthorized', message: 'That API key was rejected. Check it and try again.' };
      case 404: return { ok: false, code: 'not-found', message: 'That movie could not be found.' };
      case 429: return { ok: false, code: 'rate-limited', message: 'Too many requests — wait a moment and try again.' };
      default:
        return { ok: false, code: 'error', message: `The movie service returned an unexpected error (HTTP ${status}).` };
    }
  }

  return {
    IMAGE_BASE,
    API_BASE,
    discoverUrl,
    movieUrl,
    searchUrl,
    posterUrl,
    normalizeMovie,
    clampRating,
    releaseYear,
    normalizeGenres,
    normalizeCast,
    buildCatalog,
    mergePage,
    detailModel,
    formatCount,
    formatRuntime,
    watchlistEntry,
    isInWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    toggleWatchlist,
    setReview,
    serializeWatchlist,
    parseWatchlist,
    describeStatus,
  };
});
