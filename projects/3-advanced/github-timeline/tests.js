// tests.js — dependency-free test suite for timeline-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const Core = require('./timeline-core.js');
const {
  validateUsername, reposUrl, normalizeRepo,
  buildTimeline, yearSummary, groupByYear, describeStatus,
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

// A tiny factory for raw API-shaped repo records.
function repo(name, createdAt, extra) {
  return Object.assign({
    id: name,
    name,
    full_name: `octocat/${name}`,
    description: `${name} description`,
    html_url: `https://github.com/octocat/${name}`,
    created_at: createdAt,
    language: 'JavaScript',
    stargazers_count: 3,
    forks_count: 1,
    fork: false,
    private: false,
  }, extra || {});
}

// ---- Username validation ----------------------------------------------------
eq(validateUsername('octocat').ok, true, 'plain username is valid');
eq(validateUsername('  octocat  ').name, 'octocat', 'username is trimmed');
eq(validateUsername('a-b-c').ok, true, 'single hyphens allowed');
eq(validateUsername('').code, 'empty', 'empty username rejected');
eq(validateUsername('   ').code, 'empty', 'whitespace-only username rejected');
eq(validateUsername('-nope').code, 'hyphen-edge', 'leading hyphen rejected');
eq(validateUsername('nope-').code, 'hyphen-edge', 'trailing hyphen rejected');
eq(validateUsername('a--b').code, 'double-hyphen', 'double hyphen rejected');
eq(validateUsername('bad_name').code, 'bad-chars', 'underscore rejected');
eq(validateUsername('bad name').code, 'bad-chars', 'space rejected');
eq(validateUsername('bad@name').code, 'bad-chars', 'at-sign rejected');
eq(validateUsername('a'.repeat(40)).code, 'too-long', '40 chars rejected');
eq(validateUsername('a'.repeat(39)).ok, true, '39 chars accepted');

// ---- reposUrl ---------------------------------------------------------------
assert(reposUrl('octocat').startsWith('https://api.github.com/users/octocat/repos'),
  'reposUrl targets the right endpoint');
assert(reposUrl('octocat').includes('per_page=100'), 'reposUrl defaults to 100 per page');
assert(reposUrl('octocat').includes('sort=created'), 'reposUrl sorts by creation');
assert(reposUrl('a b').includes('a%20b'), 'reposUrl encodes the username');
assert(reposUrl('octocat', { perPage: 500 }).includes('per_page=100'),
  'perPage is clamped to 100');
assert(reposUrl('octocat', { perPage: 0 }).includes('per_page=1'),
  'perPage is clamped up to 1');
assert(reposUrl('octocat', { page: 3 }).includes('page=3'), 'page is passed through');

// ---- normalizeRepo ----------------------------------------------------------
const norm = normalizeRepo(repo('hello', '2021-05-04T00:00:00Z'));
eq(norm.name, 'hello', 'normalizeRepo keeps the name');
eq(norm.createdYear, 2021, 'normalizeRepo derives the created year (UTC)');
eq(norm.description, 'hello description', 'normalizeRepo keeps the description');
eq(norm.url, 'https://github.com/octocat/hello', 'normalizeRepo keeps the html_url');
eq(norm.stars, 3, 'normalizeRepo reads stargazers_count');
eq(normalizeRepo(null), null, 'normalizeRepo rejects null');
eq(normalizeRepo({ name: 'x' }), null, 'normalizeRepo rejects a repo with no created_at');
eq(normalizeRepo({ created_at: '2020-01-01T00:00:00Z' }), null, 'normalizeRepo rejects a repo with no name');
eq(normalizeRepo(repo('x', 'not-a-date')), null, 'normalizeRepo rejects an unparseable date');
eq(normalizeRepo(repo('x', '2020-01-01T00:00:00Z', { description: null })).description, '',
  'null description becomes empty string');
eq(normalizeRepo(repo('x', '2020-01-01T00:00:00Z', { language: null })).language, null,
  'null language stays null');

// ---- buildTimeline: ordering & filtering ------------------------------------
const sample = [
  repo('newest', '2023-01-01T00:00:00Z'),
  repo('oldest', '2019-01-01T00:00:00Z'),
  repo('middle', '2021-06-15T00:00:00Z'),
];
const desc = buildTimeline(sample);
eq(desc.map((r) => r.name).join(','), 'newest,middle,oldest', 'default order is newest-first');
const asc = buildTimeline(sample, { order: 'asc' });
eq(asc.map((r) => r.name).join(','), 'oldest,middle,newest', 'asc order is oldest-first');

eq(buildTimeline([]).length, 0, 'empty input yields empty timeline');
eq(buildTimeline(null).length, 0, 'null input yields empty timeline');

const withPrivate = buildTimeline([
  repo('pub', '2022-01-01T00:00:00Z'),
  repo('secret', '2022-02-01T00:00:00Z', { private: true }),
]);
eq(withPrivate.length, 1, 'private repos are excluded (public only, per spec)');
eq(withPrivate[0].name, 'pub', 'the surviving repo is the public one');

const forks = [
  repo('mine', '2022-01-01T00:00:00Z'),
  repo('forked', '2022-02-01T00:00:00Z', { fork: true }),
];
eq(buildTimeline(forks).length, 2, 'forks included by default');
eq(buildTimeline(forks, { includeForks: false }).length, 1, 'forks excluded when asked');
eq(buildTimeline(forks, { includeForks: false })[0].name, 'mine', 'the non-fork survives');

// Deterministic tie-break: same timestamp -> alphabetical by name.
const sameTime = buildTimeline([
  repo('bravo', '2022-01-01T00:00:00Z'),
  repo('alpha', '2022-01-01T00:00:00Z'),
]);
eq(sameTime.map((r) => r.name).join(','), 'alpha,bravo', 'equal timestamps break ties by name');

// ---- yearSummary (bonus feature) --------------------------------------------
const timeline = buildTimeline([
  repo('a', '2020-03-01T00:00:00Z'),
  repo('b', '2020-09-01T00:00:00Z'),
  repo('c', '2021-01-01T00:00:00Z'),
  repo('d', '2023-01-01T00:00:00Z'),
]);
const summary = yearSummary(timeline);
eq(summary.total, 4, 'summary total counts every repo');
eq(summary.rows.length, 3, 'summary has one row per distinct year');
eq(summary.rows[0].year, 2023, 'summary rows are newest-year-first');
eq(summary.rows[0].count, 1, '2023 has one repo');
eq(summary.rows[summary.rows.length - 1].year, 2020, 'oldest year is last');
eq(summary.rows[summary.rows.length - 1].count, 2, '2020 has two repos');
eq(summary.max, 2, 'summary max is the busiest year count');
eq(yearSummary([]).total, 0, 'empty timeline summarizes to zero');
eq(yearSummary([]).max, 0, 'empty timeline has max 0 (no divide-by-zero)');

// ---- groupByYear ------------------------------------------------------------
const groups = groupByYear(timeline);
eq(groups.length, 3, 'groupByYear makes one bucket per year');
eq(groups[0].year, 2023, 'first group follows the timeline (newest) order');
eq(groups[2].year, 2020, 'last group is the oldest year');
eq(groups[2].repos.length, 2, '2020 bucket holds both 2020 repos');
// Repos within a year preserve the incoming timeline order (desc within 2020).
eq(groups[2].repos.map((r) => r.name).join(','), 'b,a', 'within-year order matches the timeline');

// ---- describeStatus ---------------------------------------------------------
eq(describeStatus(200).ok, true, '200 is ok');
eq(describeStatus(404).code, 'not-found', '404 -> not-found');
eq(describeStatus(403).code, 'rate-limited', '403 -> rate-limited');
eq(describeStatus(401).code, 'unauthorized', '401 -> unauthorized');
eq(describeStatus(500).code, 'error', '500 -> generic error');
assert(describeStatus(500).message.includes('500'), 'generic error names the status code');

// ---- report -----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
