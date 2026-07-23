'use strict';

/* GitHub Profiles — search the GitHub API and display a user card.
 * Vanilla JS, no build, no dependencies. */

const API = 'https://api.github.com';
const THEME_KEY = 'github-profiles-theme';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const statusEl = document.getElementById('status');
const card = document.getElementById('card');

const el = {
  avatar: document.getElementById('avatar'),
  name: document.getElementById('name'),
  login: document.getElementById('login'),
  bio: document.getElementById('bio'),
  followers: document.getElementById('followers'),
  following: document.getElementById('following'),
  repos: document.getElementById('repos'),
  repoList: document.getElementById('repo-list'),
};

/* ---------- Theme (bonus: toggle + persist) ---------- */

const themeToggle = document.getElementById('theme-toggle');
const themeIcon = themeToggle.querySelector('.theme-icon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersLight =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
}

themeToggle.addEventListener('click', () => {
  const next =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

initTheme();

/* ---------- Helpers ---------- */

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', Boolean(isError));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Rank repositories by a combined stars + forks score, take the top 4.
function topRepos(repos, n = 4) {
  return [...repos]
    .sort(
      (a, b) =>
        b.stargazers_count + b.forks_count - (a.stargazers_count + a.forks_count)
    )
    .slice(0, n);
}

/* ---------- Rendering ---------- */

function renderUser(user) {
  el.avatar.src = user.avatar_url;
  el.avatar.alt = `${user.login}'s avatar`;
  el.name.textContent = user.name || user.login;
  el.login.textContent = `@${user.login}`;
  el.login.href = user.html_url;
  el.bio.textContent = user.bio || '';
  el.bio.hidden = !user.bio;
  el.followers.textContent = user.followers;
  el.following.textContent = user.following;
  el.repos.textContent = user.public_repos;
}

function renderRepos(repos) {
  const top = topRepos(repos);
  if (top.length === 0) {
    el.repoList.innerHTML = '<li class="repo-desc">No public repositories yet.</li>';
    return;
  }
  el.repoList.innerHTML = top
    .map(
      (r) => `
      <li>
        <a class="repo" href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener">
          <div class="repo-name">${escapeHtml(r.name)}</div>
          <p class="repo-desc">${escapeHtml(r.description || 'No description')}</p>
          <div class="repo-meta">
            <span>⭐ ${r.stargazers_count}</span>
            <span>🍴 ${r.forks_count}</span>
          </div>
        </a>
      </li>`
    )
    .join('');
}

/* ---------- Data ---------- */

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function search(username) {
  const name = username.trim();
  if (!name) return;

  setStatus(`Searching for “${name}”…`, false);
  card.hidden = true;

  try {
    const user = await fetchJson(`${API}/users/${encodeURIComponent(name)}`);
    // Grab up to 100 repos so the top-4 ranking has real data to work with.
    const repos = await fetchJson(
      `${API}/users/${encodeURIComponent(name)}/repos?per_page=100&sort=updated`
    );

    renderUser(user);
    renderRepos(repos);
    card.hidden = false;
    setStatus('', false);
  } catch (err) {
    if (err.status === 404) {
      // Spec: alert the user for an invalid username.
      alert(`No GitHub user found for “${name}”.`);
      setStatus(`No user found for “${name}”.`, true);
    } else if (err.status === 403) {
      setStatus('GitHub API rate limit reached — try again in a little while.', true);
    } else {
      setStatus('Something went wrong fetching that profile. Please try again.', true);
    }
  }
}

/* ---------- Wire up ---------- */

form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(input.value);
});
