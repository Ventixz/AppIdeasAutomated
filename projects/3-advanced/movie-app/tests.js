// tests.js — dependency-free test suite for movie-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const Core = require('./movie-core.js');
const {
  discoverUrl, movieUrl, searchUrl, posterUrl,
  normalizeMovie, clampRating, releaseYear, normalizeGenres, normalizeCast,
  buildCatalog, mergePage, detailModel, formatCount, formatRuntime,
  isInWatchlist, addToWatchlist, removeFromWatchlist, toggleWatchlist,
  setReview, serializeWatchlist, parseWatchlist, describeStatus,
} = Core;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

// A tiny factory for raw API-shaped movie records.
function movie(id, title, releaseDate, extra) {
  return Object.assign({
    id,
    title,
    overview: `${title} overview`,
    release_date: releaseDate,
    vote_average: 7.2,
    vote_count: 1200,
    poster_path: `/${id}.jpg`,
    backdrop_path: `/${id}-bd.jpg`,
    genre_ids: [28, 12],
  }, extra || {});
}

// --- API URL builders -------------------------------------------------------
(function () {
  const d = discoverUrl('KEY', { page: 2 });
  assert(d.includes('/discover/movie'), 'discoverUrl hits the discover endpoint');
  assert(d.includes('sort_by=release_date.desc'), 'discoverUrl sorts by release date desc');
  assert(d.includes('page=2'), 'discoverUrl passes the page');
  assert(d.includes('api_key=KEY'), 'discoverUrl includes the key');
  eq(discoverUrl('K', { page: 0 }).includes('page=1'), true, 'discoverUrl clamps page to >= 1');
  eq(discoverUrl('K', { page: 9999 }).includes('page=500'), true, 'discoverUrl clamps page to <= 500');

  const m = movieUrl('KEY', 550);
  assert(m.includes('/movie/550'), 'movieUrl targets the movie id');
  assert(m.includes('append_to_response=credits'), 'movieUrl asks for credits');

  const s = searchUrl('KEY', 'blade runner', { page: 3 });
  assert(s.includes('/search/movie'), 'searchUrl hits the search endpoint');
  assert(s.includes('query=blade%20runner'), 'searchUrl url-encodes the query');
  assert(s.includes('page=3'), 'searchUrl passes the page');

  eq(posterUrl('/abc.jpg'), 'https://image.tmdb.org/t/p/w342/abc.jpg', 'posterUrl builds a full CDN url');
  eq(posterUrl('abc.jpg'), 'https://image.tmdb.org/t/p/w342/abc.jpg', 'posterUrl tolerates a missing leading slash');
  eq(posterUrl('/abc.jpg', 'w780'), 'https://image.tmdb.org/t/p/w780/abc.jpg', 'posterUrl honors a custom size');
  eq(posterUrl(''), '', 'posterUrl returns empty string when there is no artwork');
})();

// --- normalizeMovie ---------------------------------------------------------
(function () {
  const n = normalizeMovie(movie(1, 'Arrival', '2016-11-11'));
  eq(n.id, 1, 'normalize keeps id');
  eq(n.title, 'Arrival', 'normalize keeps title');
  eq(n.year, 2016, 'normalize derives the year');
  eq(n.rating, 7.2, 'normalize keeps the rating');
  eq(n.genres.join(','), 'Action,Adventure', 'normalize resolves genre ids to names');

  eq(normalizeMovie(null), null, 'normalize rejects null');
  eq(normalizeMovie({ id: 5 }), null, 'normalize rejects a record with no title');
  eq(normalizeMovie({ title: 'x' }), null, 'normalize rejects a record with no id');
  // id 0 is a valid id, must not be dropped by a truthiness check
  assert(normalizeMovie({ id: 0, title: 'Zero' }) !== null, 'normalize accepts id 0');

  const alt = normalizeMovie({ id: 9, name: 'Show', first_air_date: '2001-03-02' });
  eq(alt.title, 'Show', 'normalize falls back to name');
  eq(alt.year, 2001, 'normalize falls back to first_air_date');
})();

// --- clampRating / releaseYear ---------------------------------------------
(function () {
  eq(clampRating(7.30001), 7.3, 'clampRating rounds to one decimal');
  eq(clampRating(-2), 0, 'clampRating floors negatives to 0');
  eq(clampRating(99), 10, 'clampRating caps at 10');
  eq(clampRating('abc'), 0, 'clampRating handles non-numbers');
  eq(releaseYear('2021-05-04'), 2021, 'releaseYear extracts the year');
  eq(releaseYear(''), null, 'releaseYear returns null for empty');
  eq(releaseYear('nope'), null, 'releaseYear returns null for garbage');
})();

// --- genres / cast ----------------------------------------------------------
(function () {
  eq(normalizeGenres([{ id: 1, name: 'Drama' }]).join(','), 'Drama', 'genres from objects');
  eq(normalizeGenres([28, 878]).join(','), 'Action,Science Fiction', 'genres from ids');
  eq(normalizeGenres([999999]).length, 0, 'unknown genre ids are dropped');
  eq(normalizeGenres('nope').length, 0, 'genres tolerates non-arrays');

  const cast = normalizeCast([
    { name: 'A', character: 'Hero' },
    { name: 'B', character: 'Villain' },
    { nope: true },
  ]);
  eq(cast.length, 2, 'cast drops nameless entries');
  eq(cast[0].character, 'Hero', 'cast keeps character');
  eq(normalizeCast([{ name: 'x' }, { name: 'y' }, { name: 'z' }], 2).length, 2, 'cast respects the limit');
})();

// --- buildCatalog -----------------------------------------------------------
(function () {
  const raw = {
    results: [
      movie(1, 'B', '2020-01-01'),
      movie(2, 'A', '2022-06-01'),
      movie(3, 'C', '2022-06-01'), // same date as A -> title tie-break
      movie(4, 'NoDate', ''),      // dropped: no release date
      null,
    ],
  };
  const desc = buildCatalog(raw);
  eq(desc.length, 3, 'catalog drops movies with no release date and nulls');
  eq(desc[0].title, 'A', 'catalog is newest-first; A before C on a tie (title order)');
  eq(desc[1].title, 'C', 'catalog tie-break by title');
  eq(desc[2].title, 'B', 'catalog puts the oldest last');

  const asc = buildCatalog(raw, { order: 'asc' });
  eq(asc[0].title, 'B', 'ascending order puts the oldest first');

  // accepts a bare array too, not just {results}
  eq(buildCatalog([movie(1, 'X', '2019-01-01')]).length, 1, 'catalog accepts a bare array');
})();

// --- mergePage --------------------------------------------------------------
(function () {
  const page1 = buildCatalog([movie(1, 'A', '2020-01-01'), movie(2, 'B', '2019-01-01')]);
  const page2 = buildCatalog([movie(2, 'B', '2019-01-01'), movie(3, 'C', '2018-01-01')]);
  const merged = mergePage(page1, page2);
  eq(merged.length, 3, 'mergePage de-duplicates by id');
  eq(merged.map((m) => m.id).join(','), '1,2,3', 'mergePage preserves existing order and appends new');
  eq(mergePage(null, page2).length, 2, 'mergePage tolerates a null base');
})();

// --- detailModel / formatting ----------------------------------------------
(function () {
  const m = normalizeMovie(movie(1, 'Dune', '2021-10-22', {
    runtime: 155, vote_count: 15300,
    genres: [{ id: 878, name: 'Science Fiction' }, { id: 12, name: 'Adventure' }],
    credits: { cast: [{ name: 'Timothée', character: 'Paul' }] },
  }));
  const dm = detailModel(m);
  eq(dm.ratingText, '7.2 / 10', 'detail formats the rating');
  eq(dm.votesText, '15.3K votes', 'detail formats the vote count');
  eq(dm.runtimeText, '2h 35m', 'detail formats the runtime');
  eq(dm.genresText, 'Science Fiction, Adventure', 'detail joins genres');
  eq(dm.cast[0].name, 'Timothée', 'detail carries cast');
  eq(detailModel(null), null, 'detailModel tolerates null');

  const noRating = detailModel(normalizeMovie(movie(2, 'Obscure', '2000-01-01', { vote_average: 0, vote_count: 0 })));
  eq(noRating.ratingText, 'Not yet rated', 'detail handles an unrated movie');
  eq(noRating.overview !== '', true, 'detail always has some overview text');

  eq(formatCount(1204), '1.2K', 'formatCount thousands');
  eq(formatCount(950), '950', 'formatCount below 1000');
  eq(formatCount(2100000), '2.1M', 'formatCount millions');
  eq(formatRuntime(137), '2h 17m', 'runtime h+m');
  eq(formatRuntime(45), '45m', 'runtime minutes only');
  eq(formatRuntime(120), '2h', 'runtime whole hours');
  eq(formatRuntime(0), '', 'runtime unknown -> empty');
})();

// --- watchlist --------------------------------------------------------------
(function () {
  const m1 = normalizeMovie(movie(1, 'A', '2020-01-01'));
  const m2 = normalizeMovie(movie(2, 'B', '2021-01-01'));

  let list = addToWatchlist([], m1, 100);
  eq(list.length, 1, 'add appends a movie');
  eq(isInWatchlist(list, 1), true, 'isInWatchlist finds an added movie');
  eq(list[0].addedAt, 100, 'add stamps the provided timestamp');

  const same = addToWatchlist(list, m1, 200);
  eq(same.length, 1, 'add is idempotent for a movie already present');

  const before = list;
  list = addToWatchlist(list, m2, 101);
  eq(before.length, 1, 'add does not mutate the input array');
  eq(list.length, 2, 'add returns a new longer array');

  list = removeFromWatchlist(list, 1);
  eq(list.length, 1, 'remove drops the matching entry');
  eq(isInWatchlist(list, 1), false, 'remove really removes');

  let t = toggleWatchlist([], m1, 1);
  eq(t.length, 1, 'toggle adds when absent');
  t = toggleWatchlist(t, m1, 1);
  eq(t.length, 0, 'toggle removes when present');

  // reviews
  let reviewed = addToWatchlist([], m1, 1);
  reviewed = setReview(reviewed, 1, '  Loved it  ');
  eq(reviewed[0].review, 'Loved it', 'setReview trims and stores the text');
  reviewed = setReview(reviewed, 999, 'no such movie');
  eq(reviewed[0].review, 'Loved it', 'setReview on a missing id is a no-op');
})();

// --- persistence ------------------------------------------------------------
(function () {
  const m1 = normalizeMovie(movie(1, 'A', '2020-01-01'));
  const list = setReview(addToWatchlist([], m1, 42), 1, 'great');
  const round = parseWatchlist(serializeWatchlist(list));
  eq(round.length, 1, 'serialize/parse round-trips length');
  eq(round[0].title, 'A', 'round-trip keeps title');
  eq(round[0].review, 'great', 'round-trip keeps review');
  eq(round[0].addedAt, 42, 'round-trip keeps timestamp');

  eq(parseWatchlist(null).length, 0, 'parse handles null');
  eq(parseWatchlist('not json {').length, 0, 'parse tolerates corrupt JSON');
  eq(parseWatchlist('{"a":1}').length, 0, 'parse rejects non-array data');
  eq(parseWatchlist('[{"id":1}]').length, 0, 'parse drops entries missing a title');
  eq(parseWatchlist([{ id: 1, title: 'ok' }])[0].review, '', 'parse fills a default review');
})();

// --- describeStatus ---------------------------------------------------------
(function () {
  eq(describeStatus(200).ok, true, 'status 200 is ok');
  eq(describeStatus(401).code, 'unauthorized', 'status 401 -> unauthorized');
  eq(describeStatus(404).code, 'not-found', 'status 404 -> not-found');
  eq(describeStatus(429).code, 'rate-limited', 'status 429 -> rate-limited');
  eq(describeStatus(500).code, 'error', 'unexpected status -> error');
})();

// --- summary ----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
