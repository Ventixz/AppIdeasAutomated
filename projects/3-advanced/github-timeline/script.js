// script.js — the browser client for the GitHub Timeline app.
//
// It owns everything the engine deliberately doesn't: reading the form, calling
// the GitHub REST API with `fetch`, and painting the DOM. All the rules
// (validation, normalization, ordering, the year tally) live in timeline-core.js
// and are exercised by the same code in tests.js.

(function () {
  'use strict';

  const Core = window.TimelineCore;

  const form = document.getElementById('search');
  const input = document.getElementById('username');
  const button = document.getElementById('generate');
  const warning = document.getElementById('warning');
  const result = document.getElementById('result');
  const optForks = document.getElementById('opt-forks');
  const optOrder = document.getElementById('opt-order');

  // ---- small DOM helpers ----------------------------------------------------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // textContent => no HTML injection
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function showWarning(message) {
    warning.textContent = message;
    warning.classList.remove('is-hidden');
  }
  function hideWarning() {
    warning.textContent = '';
    warning.classList.add('is-hidden');
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ---- network --------------------------------------------------------------
  // Returns { ok, status, repos } | throws on a network failure.
  async function fetchRepos(username) {
    const res = await fetch(Core.reposUrl(username, { perPage: 100 }), {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { ok: false, status: res.status, repos: [] };
    const repos = await res.json();
    return { ok: true, status: res.status, repos };
  }

  async function fetchProfile(username) {
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null; // profile is a nicety; the timeline still renders without it
    }
  }

  // ---- rendering ------------------------------------------------------------
  function renderProfile(profile, timeline) {
    const card = el('div', 'profile');
    if (profile && profile.avatar_url) {
      const img = el('img');
      img.src = profile.avatar_url;
      img.alt = `${profile.login} avatar`;
      img.loading = 'lazy';
      card.appendChild(img);
    }
    const who = el('div', 'who');
    const h2 = el('h2');
    const a = el('a');
    a.href = (profile && profile.html_url) || `https://github.com/${(profile && profile.login) || ''}`;
    a.textContent = (profile && (profile.name || profile.login)) || 'GitHub user';
    a.target = '_blank';
    a.rel = 'noopener';
    h2.appendChild(a);
    who.appendChild(h2);

    if (profile && profile.login) {
      const handle = el('div', 'bio', `@${profile.login}`);
      who.appendChild(handle);
    }
    if (profile && profile.bio) who.appendChild(el('p', 'bio', profile.bio));

    const shown = timeline.length;
    const total = (profile && typeof profile.public_repos === 'number') ? profile.public_repos : shown;
    const countsText = shown === total
      ? `${shown} public ${shown === 1 ? 'repo' : 'repos'}`
      : `Showing ${shown} of ${total} public repos`;
    who.appendChild(el('div', 'counts', countsText));

    card.appendChild(who);
    return card;
  }

  function renderSummary(summary) {
    const box = el('div', 'summary');
    box.appendChild(el('h3', null, 'Repositories created per year'));
    summary.rows.forEach((row) => {
      const line = el('div', 'bar-row');
      line.appendChild(el('span', 'bar-year', String(row.year)));
      const track = el('div', 'bar-track');
      const fill = el('div', 'bar-fill');
      fill.style.width = `${summary.max ? (row.count / summary.max) * 100 : 0}%`;
      track.appendChild(fill);
      line.appendChild(track);
      line.appendChild(el('span', 'bar-count', String(row.count)));
      box.appendChild(line);
    });
    return box;
  }

  function renderEntry(repo) {
    const li = el('li', 'entry');
    const card = el('div', 'card');

    const name = el('p', 'repo-name');
    const link = el('a');
    link.href = repo.url;
    link.textContent = repo.name;
    link.target = '_blank';
    link.rel = 'noopener';
    name.appendChild(link);
    if (repo.isFork) {
      const flag = el('span', 'fork-flag', 'fork');
      name.appendChild(document.createTextNode(' '));
      name.appendChild(flag);
    }
    card.appendChild(name);

    card.appendChild(el('p', 'repo-date', `Created ${formatDate(repo.createdAt)}`));

    if (repo.description) card.appendChild(el('p', 'repo-desc', repo.description));

    const meta = el('div', 'repo-meta');
    if (repo.language) {
      const tag = el('span', 'tag');
      tag.appendChild(el('span', 'dot'));
      tag.appendChild(el('span', null, repo.language));
      meta.appendChild(tag);
    }
    meta.appendChild(el('span', 'tag', `★ ${repo.stars}`));
    meta.appendChild(el('span', 'tag', `⑂ ${repo.forks}`));
    card.appendChild(meta);

    li.appendChild(card);
    return li;
  }

  function renderTimeline(profile, timeline) {
    clear(result);

    result.appendChild(renderProfile(profile, timeline));

    if (timeline.length === 0) {
      result.appendChild(el('p', 'empty', 'This user has no public repositories to show.'));
      return;
    }

    result.appendChild(renderSummary(Core.yearSummary(timeline)));

    const list = el('ul', 'timeline');
    Core.groupByYear(timeline).forEach((group) => {
      list.appendChild(el('li', 'year-label', String(group.year)));
      group.repos.forEach((repo) => list.appendChild(renderEntry(repo)));
    });
    result.appendChild(list);
  }

  // ---- orchestration --------------------------------------------------------
  async function generate(rawName) {
    hideWarning();

    const check = Core.validateUsername(rawName);
    if (!check.ok) {
      showWarning(check.message);
      return;
    }
    const username = check.name;

    button.disabled = true;
    clear(result);
    const loading = el('p', 'loading', `Fetching @${username}'s public repositories…`);
    result.appendChild(loading);

    try {
      const [repoRes, profile] = await Promise.all([
        fetchRepos(username),
        fetchProfile(username),
      ]);

      if (!repoRes.ok) {
        clear(result);
        showWarning(Core.describeStatus(repoRes.status).message);
        return;
      }

      const timeline = Core.buildTimeline(repoRes.repos, {
        includeForks: optForks.checked,
        order: optOrder.value === 'asc' ? 'asc' : 'desc',
      });
      renderTimeline(profile, timeline);
    } catch (err) {
      clear(result);
      showWarning('Could not reach GitHub. Check your connection and try again.');
    } finally {
      button.disabled = false;
    }
  }

  // ---- wiring ---------------------------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    generate(input.value);
  });

  // Re-render with new options if a timeline is already showing.
  [optForks, optOrder].forEach((ctrl) => {
    ctrl.addEventListener('change', () => {
      if (input.value.trim() && !warning.textContent) generate(input.value);
    });
  });

  // Example chips in the hint.
  result.addEventListener('click', (e) => {
    const target = e.target.closest('[data-example]');
    if (!target) return;
    input.value = target.getAttribute('data-example');
    generate(input.value);
  });

  input.focus();
})();
