// script.js — the browser presentation layer. It owns the DOM and nothing else;
// every rule of the game comes from BattleshipEngine (battleship-engine.js).

(function () {
  'use strict';

  const { startGame } = window.BattleshipEngine;

  const boardEl = document.getElementById('board');
  const messageEl = document.getElementById('message');
  const sizeSel = document.getElementById('size');
  const resetBtn = document.getElementById('reset');
  const revealBtn = document.getElementById('reveal');
  const stat = {
    turns: document.getElementById('stat-turns'),
    hits: document.getElementById('stat-hits'),
    misses: document.getElementById('stat-misses'),
    ships: document.getElementById('stat-ships'),
    acc: document.getElementById('stat-acc'),
  };

  let game = null;
  let cells = [];       // flat array of button elements, indexed r*size + c
  let revealed = false;

  function setMessage(text, kind) {
    messageEl.textContent = text;
    messageEl.className = 'message' + (kind ? ' ' + kind : '');
  }

  function refreshStats() {
    const s = game.stats();
    stat.turns.textContent = s.turns;
    stat.hits.textContent = s.hits;
    stat.misses.textContent = s.misses;
    stat.ships.textContent = s.shipsRemaining;
    stat.acc.textContent = (s.accuracy * 100).toFixed(0) + '%';
  }

  // Which cells belong to a ship — used only by the Reveal button.
  function shipCellSet() {
    const set = new Set();
    game.placements.forEach((ship) => ship.cells.forEach(([r, c]) => set.add(r * game.size + c)));
    return set;
  }

  function newGame() {
    const size = Number(sizeSel.value);
    game = startGame({ size });
    revealed = false;
    cells = [];
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        const btn = document.createElement('button');
        btn.className = 'cell';
        btn.type = 'button';
        btn.setAttribute('aria-label', `Fire at row ${r}, column ${c}`);
        btn.addEventListener('click', () => fire(r, c, btn));
        boardEl.appendChild(btn);
        cells.push(btn);
      }
    }
    refreshStats();
    setMessage('Click a cell to fire.');
  }

  function fire(r, c, btn) {
    if (game.isOver() || btn.disabled) return;
    const result = game.shoot(r, c);
    btn.disabled = true;

    if (result.hit) {
      btn.classList.add('hit');
      if (result.sunk) {
        markSunk(result.sunk);
        setMessage(`💥 Hit — you sank the ${result.sunk}!`, 'hit');
      } else {
        setMessage('💥 Hit!', 'hit');
      }
    } else {
      btn.classList.add('miss');
      setMessage('Miss.');
    }

    refreshStats();

    if (result.won) {
      const s = game.stats();
      setMessage(`🎉 Victory! Fleet sunk in ${s.turns} shots (${(s.accuracy * 100).toFixed(0)}% accuracy).`, 'win');
      cells.forEach((cell) => { cell.disabled = true; });
    }
  }

  // Colour the sunk ship's cells. We re-derive them from placements.
  function markSunk(name) {
    const ship = game.placements.find((sp) => sp.name === name);
    if (!ship) return;
    ship.cells.forEach(([r, c]) => cells[r * game.size + c].classList.add('sunk'));
  }

  function toggleReveal() {
    revealed = !revealed;
    const ships = shipCellSet();
    cells.forEach((cell, i) => {
      if (!ships.has(i)) return;
      if (cell.classList.contains('hit') || cell.classList.contains('sunk')) return;
      cell.classList.toggle('ship', revealed);
    });
    revealBtn.textContent = revealed ? 'Hide fleet' : 'Reveal fleet';
  }

  resetBtn.addEventListener('click', newGame);
  revealBtn.addEventListener('click', toggleReveal);
  sizeSel.addEventListener('change', newGame);

  newGame();
})();
