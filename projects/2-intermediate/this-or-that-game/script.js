/*
 * script.js — DOM wiring + persistence for the This or That Game.
 *
 * All the game logic (pairing, vote tally, leaderboard) lives in the pure,
 * DOM-free thisorthat-core.js. This file only:
 *   - renders each item to a deterministic SVG "image",
 *   - reads/writes the vote tally to localStorage (the offline "database"),
 *   - handles clicks and the smooth swap transition.
 */
'use strict';

(function () {
  const Core = window.ThisOrThatCore;
  const STORAGE_KEY = 'this-or-that:votes:v1';

  const el = {
    arena: document.getElementById('arena'),
    choiceA: document.getElementById('choiceA'),
    choiceB: document.getElementById('choiceB'),
    imgA: document.getElementById('imgA'),
    imgB: document.getElementById('imgB'),
    labelA: document.getElementById('labelA'),
    labelB: document.getElementById('labelB'),
    pctA: document.getElementById('pctA'),
    pctB: document.getElementById('pctB'),
    counter: document.getElementById('counter'),
    board: document.getElementById('board'),
    boardEmpty: document.getElementById('boardEmpty'),
    reset: document.getElementById('reset'),
  };

  let tally = loadTally();
  let current = null;      // [itemA, itemB]
  let prevKey = null;      // pairKey of the last shown pair
  let locked = false;      // guards against double-clicks mid-transition

  // --- persistence: localStorage is our offline "database" -------------
  function loadTally() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  function saveTally() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tally)); } catch (e) { /* ignore quota/private mode */ }
  }

  // --- deterministic SVG image per item --------------------------------
  // Same id -> same picture, so a leaderboard thumbnail always matches the
  // card the player voted on. The hue pair is derived from the id's hash.
  function imageDataUrl(item) {
    const hash = Core.hashString(item.id);
    const h1 = hash % 360;
    const h2 = (h1 + 40 + (hash >> 8) % 80) % 360;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="hsl(' + h1 + ',70%,55%)"/>' +
          '<stop offset="1" stop-color="hsl(' + h2 + ',70%,42%)"/>' +
        '</linearGradient></defs>' +
        '<rect width="300" height="300" fill="url(#g)"/>' +
        '<text x="150" y="165" font-size="150" text-anchor="middle" ' +
          'dominant-baseline="middle">' + escapeXml(item.emoji) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  function escapeXml(s) {
    return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  }

  function renderImage(container, item) {
    const img = document.createElement('img');
    img.src = imageDataUrl(item);
    img.alt = item.label;
    container.textContent = '';
    container.appendChild(img);
  }

  // --- rendering -------------------------------------------------------
  function paintPair(pair) {
    const [a, b] = pair;
    renderImage(el.imgA, a);
    renderImage(el.imgB, b);
    el.labelA.textContent = a.label;
    el.labelB.textContent = b.label;
    el.pctA.textContent = shareText(a.id);
    el.pctB.textContent = shareText(b.id);
    el.choiceA.classList.remove('picked');
    el.choiceB.classList.remove('picked');
  }

  // A little social-proof line under each card: this image's share of all
  // votes so far. Purely informational.
  function shareText(id) {
    const total = Core.totalVotes(tally);
    const v = tally[id] || 0;
    if (!total) return '';
    return Math.round((v / total) * 100) + '% of all votes';
  }

  function renderCounter() {
    const total = Core.totalVotes(tally);
    el.counter.textContent = total === 1 ? '1 vote cast so far' : total + ' votes cast so far';
  }

  function renderBoard() {
    const rows = Core.leaderboard(tally, Core.ITEMS, 10);
    el.board.textContent = '';
    if (!rows.length) {
      el.boardEmpty.style.display = '';
      return;
    }
    el.boardEmpty.style.display = 'none';
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'board__row';

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = (i + 1) + '.';

      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      renderImage(thumb, row.item);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.item.label;

      const votes = document.createElement('span');
      votes.className = 'votes';
      votes.textContent = row.votes + (row.votes === 1 ? ' vote' : ' votes');

      li.append(rank, thumb, name, votes);
      el.board.appendChild(li);
    });
  }

  // --- the play loop ---------------------------------------------------
  function nextPair() {
    current = Core.pickPair(Core.ITEMS, Math.random, prevKey);
    prevKey = Core.pairKey(current[0].id, current[1].id);
    paintPair(current);
  }

  function vote(side) {
    if (locked || !current) return;
    locked = true;
    const chosen = current[side === 'A' ? 0 : 1];
    (side === 'A' ? el.choiceA : el.choiceB).classList.add('picked');

    tally = Core.recordVote(tally, chosen.id);
    saveTally();
    renderCounter();
    renderBoard();

    // Smooth transition (bonus): fade the current pair out, swap, fade in.
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delay = reduce ? 0 : 260;
    el.arena.classList.add('swapping');
    window.setTimeout(() => {
      nextPair();
      el.arena.classList.remove('swapping');
      locked = false;
    }, delay);
  }

  el.choiceA.addEventListener('click', () => vote('A'));
  el.choiceB.addEventListener('click', () => vote('B'));

  el.reset.addEventListener('click', () => {
    if (!window.confirm('Clear every vote and empty the leaderboard?')) return;
    tally = {};
    saveTally();
    renderCounter();
    renderBoard();
    paintPair(current); // refresh the share percentages
  });

  // --- boot ------------------------------------------------------------
  nextPair();
  renderCounter();
  renderBoard();
})();
