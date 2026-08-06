/*
 * script.js — DOM wiring for the Sports Bracket Generator.
 *
 * All tournament logic lives in bracket-core.js. This file only reads the
 * form, asks the core to build/advance a bracket, renders it, and persists
 * the whole thing to localStorage so it survives a reload (bonus feature).
 */
(function () {
  'use strict';
  const C = window.BracketCore;
  const STORAGE_KEY = 'sports-bracket-generator/v1';

  const $ = (id) => document.getElementById(id);
  const form = $('setup-form');
  const nameInput = $('tname');
  const startInput = $('start');
  const endInput = $('end');
  const teamsInput = $('teams');
  const teamNamesBox = $('team-names');
  const dateWarning = $('date-warning');
  const teamWarning = $('team-warning');
  const bracketEl = $('bracket');
  const bracketMeta = $('bracket-meta');
  const championBanner = $('champion-banner');

  // Live app state. `bracket` is whatever the core last returned; the rest is
  // the metadata the form captured.
  let state = {
    tournament: '',
    start: '',
    end: '',
    numTeams: 8,
    teamNames: [],
    bracket: null,
  };

  // ---- team-name inputs -------------------------------------------------

  // Rebuild the "team names" inputs to match the requested count, keeping any
  // names the user already typed.
  function syncTeamNameInputs() {
    const n = clampTeams(parseInt(teamsInput.value, 10));
    const existing = readTeamNameInputs();
    teamNamesBox.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const wrap = document.createElement('label');
      wrap.className = 'seed-input';
      const seed = document.createElement('span');
      seed.textContent = '#' + (i + 1);
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Team ' + (i + 1);
      input.value = existing[i] || '';
      input.dataset.seedIndex = String(i);
      wrap.appendChild(seed);
      wrap.appendChild(input);
      teamNamesBox.appendChild(wrap);
    }
  }

  function readTeamNameInputs() {
    return Array.from(teamNamesBox.querySelectorAll('input')).map((el) =>
      el.value.trim()
    );
  }

  function clampTeams(n) {
    if (!Number.isInteger(n)) return 2;
    return Math.max(2, Math.min(64, n));
  }

  // Warn (but never block) on odd counts, per the spec.
  function showTeamWarning() {
    const n = parseInt(teamsInput.value, 10);
    const msg = C.teamCountWarning(n);
    toggleWarning(teamWarning, msg);
  }

  function toggleWarning(el, msg) {
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  // ---- generate ---------------------------------------------------------

  function onSubmit(e) {
    e.preventDefault();
    const numTeams = clampTeams(parseInt(teamsInput.value, 10));

    // Date range is validated only when at least one date is supplied; an
    // all-blank range is allowed (dates are optional metadata here).
    let dateMsg = null;
    if (startInput.value || endInput.value) {
      const res = C.validateDateRange(startInput.value, endInput.value);
      if (!res.valid) dateMsg = res.message;
    }
    toggleWarning(dateWarning, dateMsg);
    if (dateMsg) return; // invalid dates block generation

    showTeamWarning(); // odd-count warning shows but does not block

    state = {
      tournament: nameInput.value.trim(),
      start: startInput.value,
      end: endInput.value,
      numTeams,
      teamNames: readTeamNameInputs(),
      bracket: C.buildBracket({ numTeams, teamNames: readTeamNameInputs() }),
    };
    persist();
    render();
  }

  // ---- rendering --------------------------------------------------------

  function render() {
    renderMeta();
    renderBracket();
    renderChampion();
  }

  function renderMeta() {
    if (!state.bracket) {
      bracketMeta.textContent = '';
      return;
    }
    const bits = [];
    if (state.tournament) bits.push('“' + state.tournament + '”');
    bits.push(state.numTeams + ' teams');
    if (state.start && state.end) bits.push(state.start + ' → ' + state.end);
    bracketMeta.textContent = bits.join('  ·  ');
  }

  function renderChampion() {
    const champ = state.bracket && C.champion(state.bracket);
    if (champ) {
      championBanner.hidden = false;
      championBanner.innerHTML =
        '<span class="trophy">🏆</span> Champion: <strong>' +
        escapeHtml(champ.name) +
        '</strong>';
    } else {
      championBanner.hidden = true;
      championBanner.textContent = '';
    }
  }

  function renderBracket() {
    const b = state.bracket;
    bracketEl.innerHTML = '';
    if (!b) {
      const hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = 'Fill in the form and hit Generate bracket.';
      bracketEl.appendChild(hint);
      return;
    }
    b.rounds.forEach((round, r) => {
      const col = document.createElement('div');
      col.className = 'round';
      const title = document.createElement('div');
      title.className = 'round-title';
      title.textContent = C.roundName(r, b.totalRounds);
      col.appendChild(title);
      round.forEach((match) => col.appendChild(renderMatch(match)));
      bracketEl.appendChild(col);
    });
  }

  function renderMatch(match) {
    const el = document.createElement('div');
    el.className = 'match';

    // Bonus: per-match date.
    const dateWrap = document.createElement('div');
    dateWrap.className = 'match-date';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = match.date || '';
    dateInput.title = 'Match date';
    dateInput.addEventListener('change', () => {
      match.date = dateInput.value;
      persist();
    });
    dateWrap.appendChild(dateInput);
    el.appendChild(dateWrap);

    el.appendChild(renderSlot(match, 'a'));
    el.appendChild(renderSlot(match, 'b'));
    return el;
  }

  function renderSlot(match, side) {
    const slot = match[side];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot ' + slot.type;
    if (match.winner === side) btn.classList.add('won');

    const seed = document.createElement('span');
    seed.className = 'seed';
    seed.textContent = slot.seed ? slot.seed : '';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = slot.name;

    btn.appendChild(seed);
    btn.appendChild(name);

    // Bonus: per-match score entry (only for real teams).
    if (slot.type === 'team') {
      const score = document.createElement('input');
      score.className = 'score';
      score.type = 'number';
      score.min = '0';
      score.value = side === 'a' ? match.scoreA : match.scoreB;
      score.placeholder = '–';
      score.title = 'Score';
      score.addEventListener('click', (e) => e.stopPropagation());
      score.addEventListener('change', () => {
        if (side === 'a') match.scoreA = score.value;
        else match.scoreB = score.value;
        persist();
      });
      btn.appendChild(score);
    }

    const advanceable = slot.type === 'team';
    btn.disabled = !advanceable;
    if (advanceable) {
      btn.addEventListener('click', () => advance(match, side));
    }
    return btn;
  }

  // Advance the clicked team: hand the core the current bracket and re-render
  // whatever it returns.
  function advance(match, side) {
    state.bracket = C.setWinner(state.bracket, match.round, match.index, side);
    persist();
    render();
  }

  // ---- persistence (bonus) ---------------------------------------------

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* storage unavailable — app still works for this session */
    }
  }

  function restore() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (_) {
      saved = null;
    }
    if (!saved || !saved.bracket) return false;
    state = saved;
    nameInput.value = state.tournament || '';
    startInput.value = state.start || '';
    endInput.value = state.end || '';
    teamsInput.value = state.numTeams || 8;
    syncTeamNameInputs();
    // repopulate name inputs from saved names
    Array.from(teamNamesBox.querySelectorAll('input')).forEach((el, i) => {
      el.value = (state.teamNames && state.teamNames[i]) || '';
    });
    render();
    return true;
  }

  function clearSaved() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    state = { tournament: '', start: '', end: '', numTeams: 8, teamNames: [], bracket: null };
    form.reset();
    teamsInput.value = 8;
    syncTeamNameInputs();
    toggleWarning(dateWarning, null);
    toggleWarning(teamWarning, null);
    render();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // ---- init -------------------------------------------------------------
  form.addEventListener('submit', onSubmit);
  teamsInput.addEventListener('input', () => {
    syncTeamNameInputs();
    showTeamWarning();
  });
  $('clear-btn').addEventListener('click', clearSaved);

  syncTeamNameInputs();
  if (!restore()) render();
})();
