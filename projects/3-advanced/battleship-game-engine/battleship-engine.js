// battleship-engine.js — a presentation-free Battleship *game engine*.
//
// The whole point of the app-ideas "Battleship Game Engine" spec is the
// separation of concerns: the engine manages game state through function
// calls (an API), and knows nothing about how a board is drawn or how a
// player is prompted. A CLI, a browser, a Discord bot — any of them can drive
// the exact same engine.
//
// Public surface:
//   startGame(options)            -> a Game object (also exposes .placements)
//   game.shoot(row, col, player)  -> a shot result
//   game.stats(player)            -> game metrics
//   game.board(player)            -> the hits/misses grid ("" | "O" | "X")
//   game.isOver() / game.winner()
//
// Randomness is *injected* (options.rng) so a seeded generator replays any
// game deterministically — which is what makes the test suite possible.

'use strict';

// The standard engine board: 8x8 with three ships.
const DEFAULT_SIZE = 8;
const DEFAULT_FLEET = [
  { name: 'Battleship', length: 4 },
  { name: 'Cruiser', length: 3 },
  { name: 'Destroyer', length: 2 },
];

// Cell markers for the hits/misses board, per the spec.
const UNTARGETED = ' '; // untargeted
const MISS = 'O';       // a miss
const HIT = 'X';        // a hit

// ---------------------------------------------------------------------------
// Ship placement
// ---------------------------------------------------------------------------

// Return the list of [row, col] cells a ship would occupy, or null if it would
// run off the board.
function shipCells(row, col, length, horizontal, size) {
  const cells = [];
  for (let i = 0; i < length; i += 1) {
    const r = horizontal ? row : row + i;
    const c = horizontal ? col + i : col;
    if (r >= size || c >= size) return null;
    cells.push([r, c]);
  }
  return cells;
}

// Randomly place a fleet on a `size`x`size` board without overlaps.
// Returns an array of placement objects: { name, length, cells: [[r,c], ...] }.
function placeFleet(fleet, size, rng) {
  const occupied = new Set();
  const key = (r, c) => `${r},${c}`;
  const placements = [];

  for (const ship of fleet) {
    let placed = null;
    // Rejection sampling: keep drawing a random origin/orientation until the
    // ship fits and doesn't collide. Bounded attempts guard against a fleet
    // that cannot possibly fit the requested board.
    for (let attempt = 0; attempt < 10000 && !placed; attempt += 1) {
      const horizontal = rng() < 0.5;
      const row = Math.floor(rng() * size);
      const col = Math.floor(rng() * size);
      const cells = shipCells(row, col, ship.length, horizontal, size);
      if (!cells) continue;
      if (cells.some(([r, c]) => occupied.has(key(r, c)))) continue;
      placed = cells;
    }
    if (!placed) {
      throw new Error(
        `Could not place ${ship.name} (length ${ship.length}) on a ${size}x${size} board`
      );
    }
    placed.forEach(([r, c]) => occupied.add(key(r, c)));
    placements.push({ name: ship.name, length: ship.length, cells: placed });
  }

  return placements;
}

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function emptyBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => UNTARGETED));
}

function totalShipCells(fleet) {
  return fleet.reduce((sum, ship) => sum + ship.length, 0);
}

// ---------------------------------------------------------------------------
// A single player's private state (their own fleet + the board of shots
// fired *at* them).
// ---------------------------------------------------------------------------

function createPlayerState(fleet, size, rng) {
  const placements = placeFleet(fleet, size, rng);
  const cellToShip = new Map();
  placements.forEach((ship, shipIndex) => {
    ship.cells.forEach(([r, c]) => cellToShip.set(`${r},${c}`, shipIndex));
  });
  return {
    placements,
    cellToShip,
    board: emptyBoard(size),
    hitsByShip: placements.map(() => 0),
    hits: 0,
    misses: 0,
    turns: 0,
  };
}

// ---------------------------------------------------------------------------
// The Game object
// ---------------------------------------------------------------------------

// startGame(options) — the engine's entry point.
//   options.size    board dimension (default 8)              [bonus: customizable]
//   options.fleet   [{ name, length }, ...] (default 3 ships)
//   options.players 1 or 2 (default 1)                        [bonus: 2-player]
//   options.rng     () => [0,1) random source (default Math.random)
function startGame(options = {}) {
  const size = options.size || DEFAULT_SIZE;
  const fleet = options.fleet || DEFAULT_FLEET;
  const players = options.players === 2 ? 2 : 1;
  const rng = options.rng || Math.random;

  if (size < 1) throw new Error('Board size must be at least 1');
  if (totalShipCells(fleet) > size * size) {
    throw new Error('Fleet is too large to fit on the board');
  }

  const states = [];
  for (let i = 0; i < players; i += 1) {
    states.push(createPlayerState(fleet, size, rng));
  }

  // Whose *board* gets shot at is the opponent's board. In 1-player mode the
  // single board is the target. In 2-player mode, player 1 shoots at player 2's
  // board and vice-versa.
  function targetIndex(player) {
    if (players === 1) return 0;
    return player === 2 ? 0 : 1;
  }

  const game = {
    size,
    players,
    fleet: fleet.map((s) => ({ ...s })),

    // The placements the spec asks startGame() to "return". For 1-player games
    // this is player 1's fleet; for 2-player, an array indexed by player-1.
    get placements() {
      return players === 1 ? states[0].placements : states.map((s) => s.placements);
    },

    // shoot(row, col, player) — fire at a coordinate.
    // Returns { hit, alreadyShot, sunk, won, shipsRemaining, board, placement }.
    shoot(row, col, player = 1) {
      const target = states[targetIndex(player)];
      if (row < 0 || col < 0 || row >= size || col >= size) {
        throw new Error(`Coordinate (${row}, ${col}) is off the board`);
      }
      const cell = target.board[row][col];
      if (cell !== UNTARGETED) {
        // Re-shooting a cell is a no-op that doesn't cost a turn.
        return {
          hit: cell === HIT,
          alreadyShot: true,
          sunk: null,
          won: game.isOver(),
          shipsRemaining: game.shipsRemaining(player),
          board: game.board(player),
          placement: game.placements,
        };
      }

      target.turns += 1;
      const shipIndex = target.cellToShip.get(`${row},${col}`);
      let sunk = null;
      if (shipIndex === undefined) {
        target.board[row][col] = MISS;
        target.misses += 1;
      } else {
        target.board[row][col] = HIT;
        target.hits += 1;
        target.hitsByShip[shipIndex] += 1;
        if (target.hitsByShip[shipIndex] === target.placements[shipIndex].length) {
          sunk = target.placements[shipIndex].name;
        }
      }

      return {
        hit: shipIndex !== undefined,
        alreadyShot: false,
        sunk,
        won: game.isOver(),
        shipsRemaining: game.shipsRemaining(player),
        board: game.board(player),
        placement: game.placements,
      };
    },

    // The hits/misses grid a given player is looking at (their opponent's, or
    // the single board in solo mode). Returned as a fresh copy.
    board(player = 1) {
      return states[targetIndex(player)].board.map((r) => r.slice());
    },

    // How many of the target board's ships are still afloat.
    shipsRemaining(player = 1) {
      const target = states[targetIndex(player)];
      return target.hitsByShip.filter((h, i) => h < target.placements[i].length).length;
    },

    // gameStats(player) — game metrics [bonus].
    stats(player = 1) {
      const target = states[targetIndex(player)];
      return {
        turns: target.turns,
        hits: target.hits,
        misses: target.misses,
        shotsFired: target.hits + target.misses,
        shipsRemaining: game.shipsRemaining(player),
        shipsSunk: target.placements.length - game.shipsRemaining(player),
        accuracy: target.turns === 0 ? 0 : target.hits / target.turns,
      };
    },

    // A game/round is over when *some* board has all its ships sunk.
    isOver() {
      return states.some((_, i) => {
        const player = players === 1 ? 1 : (i === 0 ? 2 : 1);
        return game.shipsRemaining(player) === 0;
      });
    },

    // winner() — null if ongoing; in solo mode returns 1 once cleared; in
    // 2-player mode the player number who sank the opponent's fleet.
    winner() {
      if (!game.isOver()) return null;
      if (players === 1) return 1;
      // shipsRemaining(p) counts ships left on the board player p attacks, so
      // whoever's target board is empty is the winner.
      if (game.shipsRemaining(1) === 0) return 1;
      return 2;
    },
  };

  return game;
}

// ---------------------------------------------------------------------------
// Exports (works in Node and, via the global, in the browser)
// ---------------------------------------------------------------------------

const api = {
  DEFAULT_SIZE,
  DEFAULT_FLEET,
  UNTARGETED,
  MISS,
  HIT,
  shipCells,
  placeFleet,
  totalShipCells,
  startGame,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.BattleshipEngine = api;
}
