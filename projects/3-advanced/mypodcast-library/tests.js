// tests.js — dependency-free test suite for podcast-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const Core = require('./podcast-core.js');
const {
  isValidPodcastUrl, canonicalUrl,
  normalizePodcast, normalizeEpisode, clampRating,
  normalizeHashtags, parseHashtags, cleanTag,
  buildLibrary, recentEpisodeCount, sortEpisodes,
  hasPodcast, addPodcast, removePodcast, updateEpisode,
  toggleFavorite, nextRating, rateEpisode, setEpisodeHashtags,
  searchByHashtag, allHashtags,
  serializeLibrary, parseLibrary, describeStatus,
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
function deq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b),
    `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

// Factory for a raw Podbean-shaped episode.
function ep(id, title, date, extra) {
  return Object.assign({ id, title, date, url: `https://www.podbean.com/ew/${id}` }, extra || {});
}
function pod(id, name, url, episodes) {
  return { id, name, url, icon: '', episodes: episodes || [] };
}

// ---------------------------------------------------------------------------
console.log('URL validation');
// ---------------------------------------------------------------------------
eq(isValidPodcastUrl('https://www.podbean.com/podcast-detail/my-show'), true, 'detail path valid');
eq(isValidPodcastUrl('https://podbean.com/podcast-detail/my-show'), true, 'detail path without www valid');
eq(isValidPodcastUrl('http://www.podbean.com/podcast-detail/my-show/'), true, 'http + trailing slash valid');
eq(isValidPodcastUrl('https://myshow.podbean.com/'), true, 'subdomain form valid');
eq(isValidPodcastUrl('https://myshow.podbean.com'), true, 'subdomain no trailing slash valid');
eq(isValidPodcastUrl('https://www.podbean.com/'), false, 'bare podbean host is not a podcast');
eq(isValidPodcastUrl('https://www.podbean.com/podcast-detail/'), false, 'detail path needs a slug');
eq(isValidPodcastUrl('https://example.com/podcast-detail/my-show'), false, 'other host rejected');
eq(isValidPodcastUrl('https://notpodbean.com/podcast-detail/x'), false, 'lookalike host rejected');
eq(isValidPodcastUrl('podbean.com/podcast-detail/x'), false, 'missing protocol rejected');
eq(isValidPodcastUrl(''), false, 'empty rejected');
eq(isValidPodcastUrl(null), false, 'null rejected');
eq(isValidPodcastUrl('   https://myshow.podbean.com/   '), true, 'surrounding whitespace tolerated');

console.log('URL canonicalization');
eq(canonicalUrl('https://Foo.podbean.com/'), 'foo.podbean.com', 'lowercase, strip proto + slash');
eq(canonicalUrl('http://foo.podbean.com'), 'foo.podbean.com', 'http variant collapses to same');
eq(canonicalUrl('https://www.podbean.com/podcast-detail/x/'), 'www.podbean.com/podcast-detail/x', 'trailing slash dropped');

// ---------------------------------------------------------------------------
console.log('Normalization');
// ---------------------------------------------------------------------------
const p = normalizePodcast(pod('a', 'A Show', 'https://a.podbean.com/', [ep('e1', 'One', '2026-08-01')]));
eq(p.id, 'a', 'podcast id kept as string');
eq(p.name, 'A Show', 'podcast name kept');
eq(p.episodes.length, 1, 'episodes normalized');
eq(p.episodes[0].favorite, false, 'episode defaults to not-favorite');
eq(p.episodes[0].rating, 0, 'episode defaults to 0 rating');
deq(p.episodes[0].hashtags, [], 'episode defaults to no hashtags');
eq(normalizePodcast(null), null, 'null podcast rejected');
eq(normalizePodcast({ name: 'no id' }), null, 'podcast without id rejected');
eq(normalizePodcast({ id: 'x' }), null, 'podcast without name rejected');
eq(normalizePodcast({ id: 0, name: 'Zero' }).id, '0', 'id 0 is kept (stringified), not dropped');
eq(normalizeEpisode({ id: 'e', title: 'T', rating: 9 }).rating, 5, 'episode rating clamped to max on normalize');
eq(normalizeEpisode(null), null, 'null episode rejected');
eq(normalizeEpisode({ title: 'no id' }), null, 'episode without id rejected');
eq(normalizeEpisode({ id: 'e' }), null, 'episode without title rejected');
eq(normalizePodcast({ id: 'p', name: 'P', episodes: [null, { id: 'e', title: 'ok' }, {}] }).episodes.length, 1,
  'malformed episodes are filtered out');

console.log('Rating clamp');
eq(clampRating(3), 3, 'in-range rating kept');
eq(clampRating(0), 0, 'zero rating kept');
eq(clampRating(-2), 0, 'negative clamped to 0');
eq(clampRating(99), 5, 'over-max clamped to 5');
eq(clampRating(3.6), 4, 'fractional rounded');
eq(clampRating('bad'), 0, 'non-numeric -> 0');

// ---------------------------------------------------------------------------
console.log('Hashtags');
// ---------------------------------------------------------------------------
eq(cleanTag('#Comedy'), 'comedy', 'strip leading hash + lowercase');
eq(cleanTag('  ##Space## '), 'space##', 'strip only leading hashes and trim');
deq(parseHashtags('#tech, science  space'), ['tech', 'science', 'space'], 'parse mixed separators');
deq(parseHashtags('#tag #Tag tag'), ['tag'], 'parse de-dupes case-insensitively');
deq(parseHashtags(''), [], 'parse empty -> []');
deq(parseHashtags(null), [], 'parse null -> []');
deq(normalizeHashtags(['#A', 'b', 'A']), ['a', 'b'], 'normalize array de-dupes + lowercases');

// ---------------------------------------------------------------------------
console.log('Library build + recent count');
// ---------------------------------------------------------------------------
const lib0 = buildLibrary([
  pod('a', 'A', 'https://a.podbean.com/', [
    ep('e1', 'recent', '2026-08-20'),
    ep('e2', 'old', '2026-06-01'),
  ]),
  null,
  { id: 'bad' },
]);
eq(lib0.length, 1, 'buildLibrary drops malformed podcasts');
eq(recentEpisodeCount(lib0[0], '2026-08-26', 30), 1, 'recent count within 30-day window');
eq(recentEpisodeCount(lib0[0], '2026-08-26', 120), 2, 'wider window counts more');
eq(recentEpisodeCount({ episodes: [ep('x', 'X', '')] }, '2026-08-26'), 0, 'undated episode is not recent');
eq(recentEpisodeCount({ episodes: [ep('x', 'X', '2026-08-01')] }, null), 1, 'no clock -> count all episodes');

// ---------------------------------------------------------------------------
console.log('Episode ordering');
// ---------------------------------------------------------------------------
const eps = [
  normalizeEpisode(ep('a', 'Alpha', '2026-08-01')),
  normalizeEpisode(ep('b', 'Bravo', '2026-08-20')),
  normalizeEpisode(ep('c', 'Charlie', '2026-08-10', { favorite: true })),
];
deq(sortEpisodes(eps).map((e) => e.id), ['c', 'b', 'a'], 'favorites first, then newest date');

const eps2 = [
  normalizeEpisode(ep('a', 'Alpha', '2026-08-01', { favorite: true })),
  normalizeEpisode(ep('b', 'Bravo', '2026-08-20', { favorite: true })),
];
deq(sortEpisodes(eps2).map((e) => e.id), ['b', 'a'], 'among favorites, newest first');

const epsR = [
  normalizeEpisode(ep('a', 'Alpha', '2026-08-01', { rating: 2 })),
  normalizeEpisode(ep('b', 'Bravo', '2026-08-20', { rating: 5 })),
  normalizeEpisode(ep('c', 'Charlie', '2026-08-10', { rating: 5 })),
];
deq(sortEpisodes(epsR, { by: 'rating' }).map((e) => e.id), ['b', 'c', 'a'],
  'rating sort: highest first, ties broken by recency (b newer than c)');
assert(Object.isFrozen === Object.isFrozen && sortEpisodes(eps) !== eps, 'sortEpisodes returns a new array');

// ---------------------------------------------------------------------------
console.log('Library mutations (immutability + dedupe)');
// ---------------------------------------------------------------------------
let lib = [];
lib = addPodcast(lib, pod('a', 'A Show', 'https://a.podbean.com/', [ep('e1', 'One', '2026-08-01')]));
eq(lib.length, 1, 'add first podcast');
const libBefore = lib;
lib = addPodcast(lib, pod('a', 'Dup by id', 'https://other.podbean.com/'));
eq(lib.length, 1, 'duplicate id not added');
lib = addPodcast(lib, pod('a2', 'Dup by url', 'https://A.podbean.com'));
eq(lib.length, 1, 'duplicate url (case/proto-insensitive) not added');
lib = addPodcast(lib, pod('b', 'B Show', 'https://b.podbean.com/'));
eq(lib.length, 2, 'distinct podcast added');
assert(libBefore.length === 1, 'addPodcast did not mutate the original array');
eq(hasPodcast(lib, pod('b', 'x', 'https://b.podbean.com/')), true, 'hasPodcast finds by url');
eq(hasPodcast(lib, pod('zzz', 'x', 'https://zzz.podbean.com/')), false, 'hasPodcast negative');

const removed = removePodcast(lib, 'a');
eq(removed.length, 1, 'removePodcast drops the target');
eq(lib.length, 2, 'removePodcast did not mutate original');

// ---------------------------------------------------------------------------
console.log('Favorites + rating clicks');
// ---------------------------------------------------------------------------
let lib2 = buildLibrary([pod('a', 'A', 'https://a.podbean.com/', [ep('e1', 'One', '2026-08-01')])]);
const favd = toggleFavorite(lib2, 'a', 'e1');
eq(favd[0].episodes[0].favorite, true, 'toggle sets favorite');
eq(lib2[0].episodes[0].favorite, false, 'original library unchanged after toggle');
eq(toggleFavorite(favd, 'a', 'e1')[0].episodes[0].favorite, false, 'toggle again clears favorite');
deq(toggleFavorite(lib2, 'nope', 'e1'), lib2, 'toggle on missing podcast is a no-op copy');

// Star-click semantics: left-to-right fill, click-current-to-deselect.
eq(nextRating(0, 3), 3, 'click star 3 on empty -> 3');
eq(nextRating(3, 5), 5, 'click star 5 raises to 5');
eq(nextRating(5, 3), 3, 'click star 3 lowers to 3 (right-to-left)');
eq(nextRating(3, 3), 2, 'click current top star deselects one');
eq(nextRating(1, 1), 0, 'click the only star clears to 0');
eq(nextRating(4, 0), 0, 'click star 0 clears');
const rated = rateEpisode(lib2, 'a', 'e1', 4);
eq(rated[0].episodes[0].rating, 4, 'rateEpisode applies the click');
eq(rateEpisode(rated, 'a', 'e1', 4)[0].episodes[0].rating, 3, 'clicking the top star again deselects one');

// ---------------------------------------------------------------------------
console.log('Hashtag editing + search');
// ---------------------------------------------------------------------------
let lib3 = buildLibrary([
  pod('a', 'A', 'https://a.podbean.com/', [ep('e1', 'One', '2026-08-20'), ep('e2', 'Two', '2026-08-01')]),
  pod('b', 'B', 'https://b.podbean.com/', [ep('e3', 'Three', '2026-08-10')]),
]);
lib3 = setEpisodeHashtags(lib3, 'a', 'e1', '#space science');
lib3 = setEpisodeHashtags(lib3, 'a', 'e2', 'cooking');
lib3 = setEpisodeHashtags(lib3, 'b', 'e3', ['Space', 'history']);
deq(lib3[0].episodes[0].hashtags, ['space', 'science'], 'string hashtags parsed onto episode');
deq(lib3[1].episodes[0].hashtags, ['space', 'history'], 'array hashtags normalized onto episode');

const hits = searchByHashtag(lib3, '#Space');
eq(hits.length, 2, 'search finds both space episodes across podcasts');
deq(hits.map((h) => h.episode.id), ['e1', 'e3'], 'search results newest-first');
eq(hits[0].podcastName, 'A', 'search carries the podcast name');
eq(searchByHashtag(lib3, 'cook')[0].episode.id, 'e2', 'substring hashtag match');
eq(searchByHashtag(lib3, '').length, 0, 'empty query -> no results');
eq(searchByHashtag(lib3, 'nonexistent').length, 0, 'no matches -> empty');

const tags = allHashtags(lib3);
eq(tags[0].tag, 'space', 'most-used hashtag first');
eq(tags[0].count, 2, 'space counted twice');

// ---------------------------------------------------------------------------
console.log('Persistence');
// ---------------------------------------------------------------------------
const serialized = serializeLibrary(lib3);
eq(typeof serialized, 'string', 'serialize -> string');
const round = parseLibrary(serialized);
deq(round, lib3, 'serialize -> parse round-trips');
deq(parseLibrary(null), [], 'parse null -> []');
deq(parseLibrary(''), [], 'parse empty -> []');
deq(parseLibrary('{not json'), [], 'parse corrupt -> []');
deq(parseLibrary('{"a":1}'), [], 'parse non-array json -> []');
// stored data is re-normalized, so a bad rating in storage is repaired
eq(parseLibrary('[{"id":"a","name":"A","episodes":[{"id":"e","title":"T","rating":99}]}]')[0].episodes[0].rating, 5,
  'parse re-clamps stored ratings');

// ---------------------------------------------------------------------------
console.log('HTTP status messages');
// ---------------------------------------------------------------------------
eq(describeStatus(200).ok, true, '200 ok');
eq(describeStatus(404).code, 'not-found', '404 mapped');
assert(/404/.test(describeStatus(404).message), '404 message mentions 404');
eq(describeStatus(403).code, 'forbidden', '403 mapped');
eq(describeStatus(429).code, 'rate-limited', '429 mapped');
eq(describeStatus(500).code, 'error', '500 -> generic error');

// ---------------------------------------------------------------------------
console.log('Sample data integrity');
// ---------------------------------------------------------------------------
const Sample = require('./sample-data.js');
const built = buildLibrary(Sample.all());
eq(built.length, 4, 'sample library builds 4 podcasts');
built.forEach((pc) => {
  assert(isValidPodcastUrl(pc.url), `sample podcast "${pc.name}" has a valid Podbean URL`);
  assert(pc.episodes.length > 0, `sample podcast "${pc.name}" has episodes`);
});
eq(Sample.find('https://www.podbean.com/podcast-detail/signals-noise').ok, true, 'sample find by detail url');
eq(Sample.find('https://slowkitchen.podbean.com/').podcast.id, 'kitchen', 'sample find by subdomain url');
eq(Sample.find('https://missing.podbean.com/').status, 404, 'sample find miss -> 404');

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
