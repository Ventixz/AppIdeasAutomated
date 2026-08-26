// podcast-core.js — the presentation-free engine for MyPodcast Library.
//
// It knows nothing about the DOM, `fetch`, or Puppeteer. You hand it the raw
// records a Podbean scrape (or the bundled sample data) produces and it
// validates podcast URLs, normalizes each podcast/episode into a small stable
// shape, orders episodes (recent first, then favourites), owns the per-episode
// favourite / star-rating / hashtag rules, searches the whole library by
// hashtag, and serializes the library to a plain string for localStorage. The
// same code runs in the browser (loaded as a plain script) and in Node (for
// the test suite).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  else root.PodcastCore = api;                                            // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_RATING = 5;

  // ---------------------------------------------------------------------------
  // Validating a Podbean podcast URL.
  //
  // The spec: "the Save button validates that URLs begin with the Podbean
  // podcast-detail path". Podbean serves podcast pages two ways — the canonical
  // detail path `https://www.podbean.com/podcast-detail/<slug>` and per-show
  // subdomains `https://<show>.podbean.com/`. We accept both, over http or
  // https, and reject anything else so a stray link can't enter the library.
  // ---------------------------------------------------------------------------
  const DETAIL_PATH_RE = /^https?:\/\/(www\.)?podbean\.com\/podcast-detail\/[A-Za-z0-9._~-]+\/?$/i;
  const SUBDOMAIN_RE = /^https?:\/\/[A-Za-z0-9-]+\.podbean\.com\/?$/i;

  function isValidPodcastUrl(url) {
    const clean = String(url == null ? '' : url).trim();
    if (!clean) return false;
    // The subdomain form must not itself be the bare www host with no show.
    if (SUBDOMAIN_RE.test(clean) && !/^https?:\/\/www\.podbean\.com\/?$/i.test(clean)) {
      return true;
    }
    return DETAIL_PATH_RE.test(clean);
  }

  // Canonicalize a URL for de-duplication: lowercase host, drop a trailing
  // slash, strip the protocol so http/https variants of one show collapse.
  function canonicalUrl(url) {
    return String(url == null ? '' : url)
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Normalizing raw records.
  //
  // A scrape hands back loosely-shaped objects; the app needs a handful of
  // fields. Anything that isn't a real podcast/episode (no id, no name/title)
  // is dropped by returning null so a partial record can't crash the render.
  // ---------------------------------------------------------------------------
  function normalizePodcast(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = raw.name || raw.title;
    if (raw.id == null || !name) return null;

    const episodes = (Array.isArray(raw.episodes) ? raw.episodes : [])
      .map(normalizeEpisode)
      .filter(Boolean);

    return {
      id: String(raw.id),
      name: String(name),
      icon: raw.icon ? String(raw.icon) : '',
      url: raw.url ? String(raw.url) : '',
      episodes: episodes,
    };
  }

  function normalizeEpisode(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = raw.title || raw.name;
    if (raw.id == null || !title) return null;

    return {
      id: String(raw.id),
      title: String(title),
      icon: raw.icon ? String(raw.icon) : '',
      url: raw.url ? String(raw.url) : '',
      date: raw.date ? String(raw.date) : '',
      favorite: Boolean(raw.favorite),
      rating: clampRating(raw.rating),
      hashtags: normalizeHashtags(raw.hashtags),
    };
  }

  // Ratings are 0..5 whole stars. Clamp and round so a bad value can't paint
  // half a star or six of them.
  function clampRating(value) {
    const n = Math.round(Number(value));
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min(MAX_RATING, Math.max(0, n));
  }

  // ---------------------------------------------------------------------------
  // Hashtags. Users attach freeform tags; we store them lowercased, without the
  // leading '#', de-duplicated and in a stable order.
  // ---------------------------------------------------------------------------
  function normalizeHashtags(tags) {
    const list = Array.isArray(tags) ? tags : [];
    return dedupe(list.map(cleanTag).filter(Boolean));
  }

  // Turn a freeform string ("#Comedy, science  space") into clean tag tokens.
  function parseHashtags(text) {
    const raw = String(text == null ? '' : text).split(/[\s,]+/);
    return dedupe(raw.map(cleanTag).filter(Boolean));
  }

  function cleanTag(tag) {
    return String(tag == null ? '' : tag).trim().replace(/^#+/, '').toLowerCase();
  }

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    list.forEach((item) => {
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Building the library and counting recent episodes.
  // ---------------------------------------------------------------------------
  function buildLibrary(rawPodcasts) {
    return (Array.isArray(rawPodcasts) ? rawPodcasts : [])
      .map(normalizePodcast)
      .filter(Boolean);
  }

  // "Each podcast entry shows ... recent episode count." An episode counts as
  // recent when its broadcast date is within `days` (default 30) of `now`.
  function recentEpisodeCount(podcast, now, days) {
    if (!podcast || !Array.isArray(podcast.episodes)) return 0;
    const windowDays = days || 30;
    const nowMs = toMillis(now);
    if (nowMs == null) return podcast.episodes.length;
    const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000;
    return podcast.episodes.filter((ep) => {
      const t = toMillis(ep.date);
      return t != null && t >= cutoff;
    }).length;
  }

  function toMillis(dateStr) {
    if (dateStr == null || dateStr === '') return null;
    const t = Date.parse(dateStr);
    return isNaN(t) ? null : t;
  }

  // ---------------------------------------------------------------------------
  // Ordering episodes.
  //
  // The spec: "The list prioritizes recent episodes, followed by marked
  // favourites." We read that as: newest first, but a favourite outranks a
  // non-favourite so starred episodes float to the top of the timeline. The
  // bonus rating sort ("descending rating") is a separate mode.
  // ---------------------------------------------------------------------------
  function sortEpisodes(episodes, opts) {
    const options = opts || {};
    const list = (Array.isArray(episodes) ? episodes : []).slice();

    if (options.by === 'rating') {
      // Bonus: highest rated first, ties broken by recency then title.
      list.sort((a, b) =>
        (b.rating - a.rating) || compareDate(b.date, a.date) || a.title.localeCompare(b.title));
      return list;
    }

    // Default: favourites first, then newest date, then title.
    list.sort((a, b) => {
      const fav = (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
      if (fav !== 0) return fav;
      const byDate = compareDate(b.date, a.date);
      if (byDate !== 0) return byDate;
      return a.title.localeCompare(b.title);
    });
    return list;
  }

  // Compare two ISO-ish dates; undated episodes sort last. Returns <0 if a is
  // older than b, matching Array.sort's contract for `compareDate(b, a)` usage.
  function compareDate(a, b) {
    const ta = toMillis(a);
    const tb = toMillis(b);
    if (ta == null && tb == null) return 0;
    if (ta == null) return -1;
    if (tb == null) return 1;
    return ta - tb;
  }

  // ---------------------------------------------------------------------------
  // Library mutations. Every function returns a NEW array/object — the caller
  // treats state as immutable — and de-dupes podcasts by canonical URL or id.
  // ---------------------------------------------------------------------------
  function hasPodcast(library, podcast) {
    if (!podcast) return false;
    const url = canonicalUrl(podcast.url);
    return (library || []).some((p) =>
      p.id === String(podcast.id) || (url && canonicalUrl(p.url) === url));
  }

  function addPodcast(library, rawPodcast) {
    const current = Array.isArray(library) ? library : [];
    const podcast = normalizePodcast(rawPodcast);
    if (!podcast || hasPodcast(current, podcast)) return current.slice();
    return current.concat([podcast]);
  }

  function removePodcast(library, id) {
    const target = String(id);
    return (Array.isArray(library) ? library : []).filter((p) => p.id !== target);
  }

  // Map an update over one episode inside one podcast, rebuilding only the
  // touched objects so unrelated state keeps its identity.
  function updateEpisode(library, podcastId, episodeId, updater) {
    const pid = String(podcastId);
    const eid = String(episodeId);
    return (Array.isArray(library) ? library : []).map((p) => {
      if (p.id !== pid) return p;
      return Object.assign({}, p, {
        episodes: p.episodes.map((ep) =>
          ep.id === eid ? updater(ep) : ep),
      });
    });
  }

  function toggleFavorite(library, podcastId, episodeId) {
    return updateEpisode(library, podcastId, episodeId, (ep) =>
      Object.assign({}, ep, { favorite: !ep.favorite }));
  }

  // Bonus: apply a click on the Nth star. Clicking a fresh star fills up to it
  // (left-to-right); clicking the star that is already the current rating
  // clears it by one (the right-to-left "deselect").
  function nextRating(current, clickedStar) {
    const cur = clampRating(current);
    const star = clampRating(clickedStar);
    if (star === 0) return 0;
    return star === cur ? star - 1 : star;
  }

  function rateEpisode(library, podcastId, episodeId, clickedStar) {
    return updateEpisode(library, podcastId, episodeId, (ep) =>
      Object.assign({}, ep, { rating: nextRating(ep.rating, clickedStar) }));
  }

  function setEpisodeHashtags(library, podcastId, episodeId, text) {
    const tags = Array.isArray(text) ? normalizeHashtags(text) : parseHashtags(text);
    return updateEpisode(library, podcastId, episodeId, (ep) =>
      Object.assign({}, ep, { hashtags: tags }));
  }

  // ---------------------------------------------------------------------------
  // Bonus: hashtag search across the whole library. Returns a flat list of
  // { podcastId, podcastName, episode } matches, newest first, so the client
  // can render them in the same episode table.
  // ---------------------------------------------------------------------------
  function searchByHashtag(library, query) {
    const needle = cleanTag(query);
    const results = [];
    if (!needle) return results;
    (Array.isArray(library) ? library : []).forEach((p) => {
      p.episodes.forEach((ep) => {
        if (ep.hashtags.some((t) => t === needle || t.indexOf(needle) !== -1)) {
          results.push({ podcastId: p.id, podcastName: p.name, episode: ep });
        }
      });
    });
    results.sort((a, b) => compareDate(b.episode.date, a.episode.date));
    return results;
  }

  // Every distinct hashtag in the library, with a count, most-used first —
  // handy for a tag cloud / autocomplete.
  function allHashtags(library) {
    const counts = new Map();
    (Array.isArray(library) ? library : []).forEach((p) => {
      p.episodes.forEach((ep) => {
        ep.hashtags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
      });
    });
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));
  }

  // ---------------------------------------------------------------------------
  // Persistence. The client hands us whatever came out of localStorage (a
  // string or null); we hand back a clean library, tolerating corruption. And
  // we serialize back to a compact string for saving.
  // ---------------------------------------------------------------------------
  function serializeLibrary(library) {
    return JSON.stringify(Array.isArray(library) ? library : []);
  }

  function parseLibrary(raw) {
    if (!raw) return [];
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return buildLibrary(data); // reuse normalization so stored data is clean too
    } catch (err) {
      return []; // corrupt storage shouldn't take the app down
    }
  }

  // ---------------------------------------------------------------------------
  // Interpreting an HTTP status from a Podbean fetch into a friendly message.
  // The spec calls out 404 explicitly ("checks for 404 errors").
  // ---------------------------------------------------------------------------
  function describeStatus(status) {
    switch (Number(status)) {
      case 200: return { ok: true, code: 'ok', message: '' };
      case 404: return { ok: false, code: 'not-found', message: 'No podcast lives at that URL (404). Check the link and try again.' };
      case 403: return { ok: false, code: 'forbidden', message: 'Podbean refused that request (403).' };
      case 429: return { ok: false, code: 'rate-limited', message: 'Too many requests — wait a moment and try again.' };
      default:
        return { ok: false, code: 'error', message: `Podbean returned an unexpected error (HTTP ${status}).` };
    }
  }

  return {
    MAX_RATING,
    isValidPodcastUrl,
    canonicalUrl,
    normalizePodcast,
    normalizeEpisode,
    clampRating,
    normalizeHashtags,
    parseHashtags,
    cleanTag,
    buildLibrary,
    recentEpisodeCount,
    sortEpisodes,
    hasPodcast,
    addPodcast,
    removePodcast,
    updateEpisode,
    toggleFavorite,
    nextRating,
    rateEpisode,
    setEpisodeHashtags,
    searchByHashtag,
    allHashtags,
    serializeLibrary,
    parseLibrary,
    describeStatus,
  };
});
