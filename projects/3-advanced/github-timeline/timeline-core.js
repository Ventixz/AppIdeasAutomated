// timeline-core.js — the presentation-free engine for the GitHub Timeline app.
//
// It knows nothing about the DOM or `fetch`. You hand it the raw JSON that the
// GitHub REST API returns for `/users/:name/repos`, and it validates usernames,
// normalizes each repo into a small stable shape, sorts them into a timeline,
// and tallies them by the year they were created. The same code runs in the
// browser (loaded as a plain script) and in Node (for the test suite).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  else root.TimelineCore = api;                                          // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Username validation — GitHub's own rules.
  //
  // A GitHub username may contain only alphanumerics and single hyphens, cannot
  // begin or end with a hyphen, cannot contain two hyphens in a row, and is at
  // most 39 characters long. We validate before ever hitting the network so the
  // "not a valid user name" warning can fire instantly for obvious garbage.
  // ---------------------------------------------------------------------------
  const MAX_USERNAME = 39;

  function validateUsername(raw) {
    const name = String(raw == null ? '' : raw).trim();
    if (name === '') return { ok: false, code: 'empty', message: 'Enter a GitHub username.' };
    if (name.length > MAX_USERNAME) {
      return { ok: false, code: 'too-long', message: `Usernames are at most ${MAX_USERNAME} characters.` };
    }
    if (name.startsWith('-') || name.endsWith('-')) {
      return { ok: false, code: 'hyphen-edge', message: 'Usernames cannot start or end with a hyphen.' };
    }
    if (name.includes('--')) {
      return { ok: false, code: 'double-hyphen', message: 'Usernames cannot contain two hyphens in a row.' };
    }
    if (!/^[A-Za-z0-9-]+$/.test(name)) {
      return { ok: false, code: 'bad-chars', message: 'Usernames may only contain letters, numbers, and hyphens.' };
    }
    return { ok: true, code: 'ok', name };
  }

  // Build the REST API URL for a user's public repos. `perPage` is clamped to
  // GitHub's 1..100 window; `sort=created` asks the API to order by creation.
  function reposUrl(username, opts) {
    const options = opts || {};
    const perPage = Math.max(1, Math.min(100, options.perPage || 100));
    const page = Math.max(1, options.page || 1);
    const name = encodeURIComponent(String(username).trim());
    return `https://api.github.com/users/${name}/repos` +
      `?per_page=${perPage}&page=${page}&sort=created&direction=desc&type=owner`;
  }

  // ---------------------------------------------------------------------------
  // Normalizing a raw repo record.
  //
  // The API hands back dozens of fields per repo; the timeline only needs a
  // handful. `normalizeRepo` also drops anything that isn't a real dated repo
  // (defensive against partial/garbage records) by returning null.
  // ---------------------------------------------------------------------------
  function normalizeRepo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.name || !raw.created_at) return null;
    const created = new Date(raw.created_at);
    if (isNaN(created.getTime())) return null;
    return {
      id: raw.id,
      name: String(raw.name),
      fullName: raw.full_name ? String(raw.full_name) : String(raw.name),
      description: raw.description ? String(raw.description) : '',
      url: raw.html_url ? String(raw.html_url) : '',
      createdAt: raw.created_at,
      createdYear: created.getUTCFullYear(),
      language: raw.language ? String(raw.language) : null,
      stars: Number(raw.stargazers_count) || 0,
      forks: Number(raw.forks_count) || 0,
      isFork: Boolean(raw.fork),
      isPrivate: Boolean(raw.private),
    };
  }

  // ---------------------------------------------------------------------------
  // Building the timeline.
  //
  // The spec says: "Only public repositories should be displayed." So we drop
  // anything flagged private, normalize the rest, and sort by creation date.
  // `order` is 'desc' (newest first, default) or 'asc' (oldest first).
  // `includeForks` defaults to true; the client can offer a toggle.
  // ---------------------------------------------------------------------------
  function buildTimeline(rawRepos, opts) {
    const options = opts || {};
    const order = options.order === 'asc' ? 'asc' : 'desc';
    const includeForks = options.includeForks !== false;

    const repos = (Array.isArray(rawRepos) ? rawRepos : [])
      .map(normalizeRepo)
      .filter(Boolean)
      .filter((r) => !r.isPrivate)          // public only, per the spec
      .filter((r) => includeForks || !r.isFork);

    repos.sort((a, b) => {
      const diff = new Date(a.createdAt) - new Date(b.createdAt);
      if (diff !== 0) return order === 'asc' ? diff : -diff;
      // Stable tie-break by name so equal timestamps have a deterministic order.
      return a.name.localeCompare(b.name);
    });

    return repos;
  }

  // ---------------------------------------------------------------------------
  // Bonus feature: "a summary of the number of repos tallied by the year they
  // were created." Returns an array of { year, count } sorted newest-year-first,
  // plus a convenience `max` for drawing a bar chart.
  // ---------------------------------------------------------------------------
  function yearSummary(repos) {
    const counts = new Map();
    (repos || []).forEach((r) => {
      counts.set(r.createdYear, (counts.get(r.createdYear) || 0) + 1);
    });
    const rows = Array.from(counts.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year);
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
    return { rows, max, total: (repos || []).length };
  }

  // Group a sorted timeline into year buckets, preserving the timeline's order
  // within each year. Returns [{ year, repos: [...] }, ...] in timeline order.
  function groupByYear(repos) {
    const groups = [];
    const index = new Map();
    (repos || []).forEach((r) => {
      let bucket = index.get(r.createdYear);
      if (!bucket) {
        bucket = { year: r.createdYear, repos: [] };
        index.set(r.createdYear, bucket);
        groups.push(bucket);
      }
      bucket.repos.push(r);
    });
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Interpreting an HTTP status from the repos endpoint into a friendly message.
  // The client passes the fetch's status code; we turn it into a warning the
  // user can act on (404 → invalid user, 403 → rate limited, etc.).
  // ---------------------------------------------------------------------------
  function describeStatus(status) {
    switch (Number(status)) {
      case 200: return { ok: true, code: 'ok', message: '' };
      case 404: return { ok: false, code: 'not-found', message: 'No GitHub user by that name.' };
      case 403: return { ok: false, code: 'rate-limited', message: 'GitHub rate limit reached — try again in a little while.' };
      case 401: return { ok: false, code: 'unauthorized', message: 'GitHub rejected the request (unauthorized).' };
      default:
        return { ok: false, code: 'error', message: `GitHub returned an unexpected error (HTTP ${status}).` };
    }
  }

  return {
    MAX_USERNAME,
    validateUsername,
    reposUrl,
    normalizeRepo,
    buildTimeline,
    yearSummary,
    groupByYear,
    describeStatus,
  };
});
