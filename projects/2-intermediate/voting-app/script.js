// script.js — the browser shell around voting-core.js.
//
// Everything impure lives here: the DOM, click handling, and localStorage.
// State transitions all go through the pure core, and after every change we
// persist the poll and re-render from scratch. The core never sees any of this.

(function () {
  'use strict';

  const core = window.votingCore;
  const STORAGE_KEY = 'voting-app.poll.v1';

  const optionsEl = document.getElementById('options');
  const totalEl = document.getElementById('total');
  const leaderEl = document.getElementById('leader');
  const addForm = document.getElementById('addForm');
  const newItemInput = document.getElementById('newItem');
  const resetBtn = document.getElementById('resetBtn');

  // ---- persistence -------------------------------------------------------
  function load() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (_) {
      raw = null;
    }
    // normalizePoll turns null / junk / partial data into a valid poll.
    return core.normalizePoll(raw);
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* storage full or unavailable — the app still works in-memory */
    }
  }

  let state = load();

  // ---- rendering ---------------------------------------------------------
  function render() {
    const total = core.totalVotes(state);
    const leadIds = new Set(core.leaders(state).map((it) => it.id));

    optionsEl.textContent = '';
    for (const item of core.ranked(state)) {
      const pct = core.percentFor(state, item.id);
      const li = document.createElement('li');
      li.className = 'option' + (leadIds.has(item.id) ? ' lead' : '');

      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = pct + '%';

      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      btn.type = 'button';
      btn.textContent = 'Vote';
      btn.setAttribute('aria-label', 'Vote for ' + item.label);
      btn.addEventListener('click', () => castVote(item.id));

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = item.label;

      const count = document.createElement('span');
      count.className = 'count';
      const noun = item.votes === 1 ? 'vote' : 'votes';
      count.textContent = `${item.votes} ${noun} · ${pct.toFixed(0)}%`;

      li.append(fill, btn, label, count);
      optionsEl.appendChild(li);
    }

    totalEl.textContent = `${total} ${total === 1 ? 'vote' : 'votes'}`;

    const winners = core.leaders(state);
    if (winners.length === 0) {
      leaderEl.textContent = 'No votes yet — cast the first one.';
    } else if (winners.length === 1) {
      leaderEl.innerHTML =
        `Leading: <strong>${escapeHtml(winners[0].label)}</strong> ` +
        `with ${winners[0].votes} ${winners[0].votes === 1 ? 'vote' : 'votes'}.`;
    } else {
      const names = winners.map((w) => `<strong>${escapeHtml(w.label)}</strong>`).join(' & ');
      leaderEl.innerHTML = `Tied: ${names} at ${winners[0].votes} each.`;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- actions -----------------------------------------------------------
  function castVote(id) {
    state = core.vote(state, id);
    save(state);
    render();
  }

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = core.addItem(state, newItemInput.value);
    if (next !== state) {
      state = next;
      save(state);
      render();
    }
    newItemInput.value = '';
    newItemInput.focus();
  });

  resetBtn.addEventListener('click', () => {
    state = core.resetVotes(state);
    save(state);
    render();
  });

  render();
})();
