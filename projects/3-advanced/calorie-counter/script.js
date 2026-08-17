// script.js — the browser layer for the Calorie Counter. It owns the DOM,
// events, and the "load more" paging; all searching and ranking is delegated to
// calorie-core.js. The food data comes from foods-data.js (window.FOODS), which
// is a build-time mirror of foods.json so the page also works from file://.

(function () {
  'use strict';

  const C = window.CalorieCore;
  const FOODS = window.FOODS || [];

  const els = {
    form: document.getElementById('search-form'),
    query: document.getElementById('query'),
    clear: document.getElementById('clear-btn'),
    warning: document.getElementById('warning'),
    meta: document.getElementById('results-meta'),
    count: document.getElementById('count-label'),
    results: document.getElementById('results'),
    more: document.getElementById('more-btn'),
    theme: document.getElementById('theme-btn'),
  };

  // Current search state. `limit` grows by PAGE_SIZE each time "load more" is hit.
  let matches = [];
  let terms = [];
  let limit = C.PAGE_SIZE;

  // --- Theme --------------------------------------------------------------

  const THEME_KEY = 'calorie-counter:theme';

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      els.theme.textContent = '☀️ Light';
    } else {
      document.documentElement.removeAttribute('data-theme');
      els.theme.textContent = '🌙 Dark';
    }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (_e) { /* ignore */ }
    const prefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  }

  els.theme.addEventListener('click', function () {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_e) { /* ignore */ }
  });

  // --- Rendering ----------------------------------------------------------

  function showWarning(message) {
    els.warning.textContent = message;
    els.warning.hidden = false;
  }
  function hideWarning() {
    els.warning.hidden = true;
    els.warning.textContent = '';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Wrap the plain (non-wildcard) search terms in <mark> for visual feedback.
  // Operates on already-escaped text, so we only ever inject our own <mark> tags.
  function highlight(description) {
    let html = escapeHtml(description);
    const plain = terms.filter((t) => !C.hasWildcard(t) && t.length > 0);
    // Longest first so "apple" wins over "app" when both are present.
    plain.sort((a, b) => b.length - a.length);
    plain.forEach((term) => {
      const re = new RegExp('(' + C.escapeRegExp(escapeHtml(term)) + ')', 'ig');
      html = html.replace(re, '<mark>$1</mark>');
    });
    return html;
  }

  function foodRow(food) {
    const row = document.createElement('div');
    row.className = 'food-row';
    row.innerHTML =
      '<div class="food-main">' +
        '<div class="food-desc">' + highlight(food.description) + '</div>' +
        '<div class="food-portion">' + escapeHtml(food.portion) + '</div>' +
      '</div>' +
      '<div class="food-cal">' + food.calories +
        '<span class="unit">cal</span></div>';
    return row;
  }

  function renderResults() {
    const page = C.paginate(matches, limit);

    els.results.innerHTML = '';
    page.rows.forEach((food) => els.results.appendChild(foodRow(food)));

    els.meta.hidden = false;
    const total = page.total;
    els.count.innerHTML =
      '<strong>' + total + '</strong> ' +
      (total === 1 ? 'food matches' : 'foods match') +
      (page.hasMore ? ' — showing ' + page.shown : '');

    els.more.hidden = !page.hasMore;
  }

  // --- Actions ------------------------------------------------------------

  function runSearch() {
    hideWarning();
    let result;
    try {
      result = C.search(FOODS, els.query.value);
    } catch (e) {
      if (e.code === 'EMPTY_QUERY') {
        resetResults();
        showWarning('Please enter a food to search for.');
        els.query.focus();
        return;
      }
      throw e;
    }

    terms = result.terms;
    matches = result.matches;
    limit = C.PAGE_SIZE;

    if (matches.length === 0) {
      resetResults();
      showWarning('No foods matched “' + els.query.value.trim() + '”. Try another term.');
      return;
    }
    renderResults();
  }

  function resetResults() {
    matches = [];
    terms = [];
    limit = C.PAGE_SIZE;
    els.meta.hidden = true;
    els.more.hidden = true;
    els.results.innerHTML = '<p class="placeholder">Results will appear here.</p>';
  }

  function clearAll() {
    els.query.value = '';
    hideWarning();
    resetResults();
    els.query.focus();
  }

  // --- Wiring -------------------------------------------------------------

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    runSearch();
  });

  els.clear.addEventListener('click', clearAll);

  els.more.addEventListener('click', function () {
    limit += C.PAGE_SIZE;
    renderResults();
  });

  initTheme();

  // Fail loudly in the console if the dataset is malformed, but keep the page up.
  try {
    C.validateFoods(FOODS);
  } catch (e) {
    showWarning('Food data failed to load correctly: ' + e.message);
  }
})();
