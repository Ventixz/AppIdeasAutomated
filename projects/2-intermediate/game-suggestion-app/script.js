'use strict';

/* ------------------------------------------------------------------ *
 * Game Suggestion App
 * A client-side polling app: create polls, suggest games (searched
 * against a local catalog), vote, and rank the results as a Top 5/10.
 * State lives in localStorage so polls survive a refresh.
 * ------------------------------------------------------------------ */

const STORE_KEY = 'game-suggestion-polls';
const CATALOG = window.GAME_CATALOG || [];

// --- Persistence ----------------------------------------------------
function loadPolls() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    return [];
  }
}
function savePolls(polls) {
  localStorage.setItem(STORE_KEY, JSON.stringify(polls));
}

// A tiny id helper. crypto.randomUUID exists in every modern browser; the
// timestamp+counter fallback keeps the app working in older ones.
let _seq = 0;
function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `p${Date.now().toString(36)}${(_seq++).toString(36)}`;
}

let polls = loadPolls();
let activePollId = null;

// --- Element refs ---------------------------------------------------
const homeView = document.getElementById('home-view');
const pollView = document.getElementById('poll-view');

const createForm = document.getElementById('create-form');
const titleInput = document.getElementById('poll-title');
const genreSelect = document.getElementById('poll-genre');
const top10Check = document.getElementById('poll-top10');
const pollListEl = document.getElementById('poll-list');
const noPollsEl = document.getElementById('no-polls');

const backBtn = document.getElementById('back-btn');
const pollHeading = document.getElementById('poll-heading');
const pollMeta = document.getElementById('poll-meta');
const searchInput = document.getElementById('game-search');
const suggestionsEl = document.getElementById('suggestions');
const searchHint = document.getElementById('search-hint');
const resultsEl = document.getElementById('results');
const noVotesEl = document.getElementById('no-votes');
const voteCountEl = document.getElementById('vote-count');

// --- Genre dropdown (built from the catalog) ------------------------
function populateGenres() {
  const genres = [...new Set(CATALOG.map((g) => g.genre))].sort();
  for (const genre of genres) {
    const opt = document.createElement('option');
    opt.value = genre;
    opt.textContent = genre;
    genreSelect.appendChild(opt);
  }
}

// --- Home view: list + create ---------------------------------------
function renderPollList() {
  pollListEl.innerHTML = '';
  noPollsEl.hidden = polls.length > 0;

  for (const poll of polls) {
    const li = document.createElement('li');

    const open = document.createElement('button');
    open.className = 'poll-open';
    open.innerHTML =
      `${escapeHtml(poll.title)}<span class="poll-sub">${pollSubtitle(poll)}</span>`;
    open.addEventListener('click', () => openPoll(poll.id));

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = 'Delete poll';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      polls = polls.filter((p) => p.id !== poll.id);
      savePolls(polls);
      renderPollList();
    });

    li.append(open, del);
    pollListEl.appendChild(li);
  }
}

function pollSubtitle(poll) {
  const totalVotes = poll.games.reduce((n, g) => n + g.votes, 0);
  const parts = [
    `${poll.games.length} game${poll.games.length === 1 ? '' : 's'}`,
    `${totalVotes} vote${totalVotes === 1 ? '' : 's'}`,
  ];
  if (poll.genre) parts.push(`${poll.genre} only`);
  return parts.join(' · ');
}

createForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;

  const poll = {
    id: makeId(),
    title,
    genre: genreSelect.value || '',
    topN: top10Check.checked ? 10 : 5,
    games: [], // { title, year, genre, votes }
  };
  polls.unshift(poll);
  savePolls(polls);
  createForm.reset();
  renderPollList();
  openPoll(poll.id);
});

// --- Poll view: suggest, vote, results ------------------------------
function currentPoll() {
  return polls.find((p) => p.id === activePollId);
}

function openPoll(id) {
  activePollId = id;
  const poll = currentPoll();
  if (!poll) return showHome();

  homeView.hidden = true;
  pollView.hidden = false;
  pollHeading.textContent = poll.title;
  pollMeta.textContent = poll.genre
    ? `Filtered to ${poll.genre} · Top ${poll.topN}`
    : `Any genre · Top ${poll.topN}`;
  searchInput.value = '';
  hideSuggestions();
  searchHint.textContent = poll.genre
    ? `Only ${poll.genre} games can be suggested in this poll.`
    : '';
  renderResults();
  searchInput.focus();
}

function showHome() {
  activePollId = null;
  pollView.hidden = true;
  homeView.hidden = false;
  renderPollList();
}
backBtn.addEventListener('click', showHome);

// Local stand-in for the spec's "AJAX search" against IGDB. Filters the
// catalog by substring, respecting the poll's genre restriction, and hides
// titles that have already been suggested.
function searchGames(query) {
  const poll = currentPoll();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const already = new Set(poll.games.map((g) => g.title));
  return CATALOG.filter((g) => {
    if (poll.genre && g.genre !== poll.genre) return false;
    if (already.has(g.title)) return false;
    return g.title.toLowerCase().includes(q);
  }).slice(0, 8);
}

let activeIndex = -1; // keyboard highlight in the suggestion list

function renderSuggestions() {
  const matches = searchGames(searchInput.value);
  activeIndex = -1;
  if (matches.length === 0) {
    hideSuggestions();
    return;
  }
  suggestionsEl.innerHTML = '';
  matches.forEach((g, i) => {
    const li = document.createElement('li');
    li.dataset.index = String(i);
    li.innerHTML =
      `<span>${escapeHtml(g.title)}</span>` +
      `<span class="s-meta">${g.genre} · ${g.year}</span>`;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus so blur doesn't fire first
      suggestGame(g);
    });
    suggestionsEl.appendChild(li);
  });
  suggestionsEl.hidden = false;
}

function hideSuggestions() {
  suggestionsEl.hidden = true;
  suggestionsEl.innerHTML = '';
  activeIndex = -1;
}

function suggestGame(game) {
  const poll = currentPoll();
  if (poll.games.some((g) => g.title === game.title)) return;
  // Suggesting a game seeds it with its first vote — you're voting for it.
  poll.games.push({ title: game.title, year: game.year, genre: game.genre, votes: 1 });
  savePolls(polls);
  searchInput.value = '';
  hideSuggestions();
  renderResults();
  searchInput.focus();
}

function voteFor(title) {
  const poll = currentPoll();
  const game = poll.games.find((g) => g.title === title);
  if (!game) return;
  game.votes += 1;
  savePolls(polls);
  renderResults();
}

function renderResults() {
  const poll = currentPoll();
  const ranked = [...poll.games].sort((a, b) => b.votes - a.votes).slice(0, poll.topN);
  const totalVotes = poll.games.reduce((n, g) => n + g.votes, 0);

  resultsEl.innerHTML = '';
  noVotesEl.hidden = poll.games.length > 0;
  voteCountEl.textContent = poll.games.length
    ? `${totalVotes} vote${totalVotes === 1 ? '' : 's'} · showing top ${Math.min(poll.topN, poll.games.length)}`
    : '';

  ranked.forEach((g, i) => {
    const li = document.createElement('li');

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = i === 0 ? '🏆' : `${i + 1}`;

    const name = document.createElement('span');
    name.innerHTML =
      `<span class="r-title">${escapeHtml(g.title)}</span>` +
      `<span class="r-sub">${g.genre} · ${g.year}</span>`;

    const votes = document.createElement('span');
    votes.className = 'votes';
    votes.textContent = `${g.votes}`;

    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.textContent = '▲ Vote';
    btn.addEventListener('click', () => voteFor(g.title));

    li.append(rank, name, votes, btn);
    resultsEl.appendChild(li);
  });
}

// --- Search input wiring (with keyboard nav) ------------------------
searchInput.addEventListener('input', renderSuggestions);
searchInput.addEventListener('focus', renderSuggestions);
searchInput.addEventListener('blur', () => setTimeout(hideSuggestions, 120));

searchInput.addEventListener('keydown', (e) => {
  const items = [...suggestionsEl.querySelectorAll('li')];
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % items.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = (activeIndex - 1 + items.length) % items.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIndex >= 0) items[activeIndex].dispatchEvent(new MouseEvent('mousedown'));
    return;
  } else if (e.key === 'Escape') {
    hideSuggestions();
    return;
  } else {
    return;
  }
  items.forEach((li, i) => li.classList.toggle('active', i === activeIndex));
});

// --- Utils ----------------------------------------------------------
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Boot -----------------------------------------------------------
populateGenres();
renderPollList();
