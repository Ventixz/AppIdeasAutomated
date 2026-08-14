// tests.js — dependency-free test suite for battleship-engine.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const {
  DEFAULT_SIZE,
  DEFAULT_FLEET,
  UNTARGETED,
  MISS,
  HIT,
  shipCells,
  placeFleet,
  totalShipCells,
  startGame,
} = require('./battleship-engine.js');

const cli = require('./cli.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  ✗ ${msg}`); }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

// A tiny seedable RNG (mulberry32) so every game below is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Every ship cell across a placements array, as a flat "r,c" set.
function allCells(placements) {
  const set = new Set();
  placements.forEach((ship) => ship.cells.forEach(([r, c]) => set.add(`${r},${c}`)));
  return set;
}

// ---- ship placement --------------------------------------------------------

(function placementFits() {
  eq(shipCells(0, 0, 3, true, 8).length, 3, 'horizontal ship of 3 yields 3 cells');
  eq(shipCells(6, 0, 3, false, 8), null, 'vertical ship running off the bottom is rejected');
  eq(shipCells(0, 6, 3, true, 8), null, 'horizontal ship running off the right is rejected');
})();

(function placementNoOverlaps() {
  // Place many fleets on many seeds; assert no overlaps and correct cell counts.
  for (let seed = 1; seed <= 200; seed += 1) {
    const placements = placeFleet(DEFAULT_FLEET, DEFAULT_SIZE, mulberry32(seed));
    const cells = allCells(placements);
    eq(cells.size, totalShipCells(DEFAULT_FLEET), `seed ${seed}: no ships overlap`);
    // Each cell is inside the board.
    placements.forEach((ship) => ship.cells.forEach(([r, c]) => {
      assert(r >= 0 && r < DEFAULT_SIZE && c >= 0 && c < DEFAULT_SIZE, `seed ${seed}: cell in bounds`);
    }));
    // Each ship's cells are contiguous in one line.
    placements.forEach((ship) => {
      const rows = new Set(ship.cells.map(([r]) => r));
      const cols = new Set(ship.cells.map(([, c]) => c));
      assert(rows.size === 1 || cols.size === 1, `seed ${seed}: ${ship.name} is a straight line`);
    });
  }
})();

// ---- startGame -------------------------------------------------------------

(function startGameDefaults() {
  const game = startGame({ rng: mulberry32(7) });
  eq(game.size, 8, 'default board is 8x8');
  eq(game.fleet.length, 3, 'default fleet has three ships');
  eq(totalShipCells(game.fleet), 9, 'default fleet is 2+3+4 = 9 cells');
  eq(game.shipsRemaining(), 3, 'all three ships afloat at the start');
  assert(!game.isOver(), 'fresh game is not over');
  eq(game.winner(), null, 'fresh game has no winner');
  // Fresh board is entirely untargeted.
  const flat = game.board().flat();
  assert(flat.every((cell) => cell === UNTARGETED), 'fresh board is all untargeted');
})();

(function startGameCustomSize() {
  const game = startGame({ size: 12, rng: mulberry32(9) });   // bonus: custom dims
  eq(game.size, 12, 'custom board dimension is honoured');
  eq(game.board().length, 12, 'board grid matches custom size');
})();

(function startGameRejectsImpossibleFleet() {
  let threw = false;
  try { startGame({ size: 2, rng: mulberry32(1) }); } catch (e) { threw = true; }
  assert(threw, 'a 9-cell fleet cannot fit a 2x2 board and is rejected');
})();

// ---- shoot -----------------------------------------------------------------

(function shootHitAndMiss() {
  const game = startGame({ rng: mulberry32(3) });
  const ships = allCells(game.placements);
  // Find a known ship cell and a known empty cell.
  let hitCell = null;
  let missCell = null;
  for (let r = 0; r < game.size && (!hitCell || !missCell); r += 1) {
    for (let c = 0; c < game.size && (!hitCell || !missCell); c += 1) {
      if (ships.has(`${r},${c}`) && !hitCell) hitCell = [r, c];
      if (!ships.has(`${r},${c}`) && !missCell) missCell = [r, c];
    }
  }
  const missRes = game.shoot(missCell[0], missCell[1]);
  assert(!missRes.hit, 'shooting empty water is a miss');
  eq(game.board()[missCell[0]][missCell[1]], MISS, 'miss records an "O"');

  const hitRes = game.shoot(hitCell[0], hitCell[1]);
  assert(hitRes.hit, 'shooting a ship cell is a hit');
  eq(game.board()[hitCell[0]][hitCell[1]], HIT, 'hit records an "X"');
})();

(function shootRejectsOffBoard() {
  const game = startGame({ rng: mulberry32(4) });
  let threw = false;
  try { game.shoot(-1, 0); } catch (e) { threw = true; }
  assert(threw, 'shooting off the board throws');
})();

(function reshootIsNoOp() {
  const game = startGame({ rng: mulberry32(5) });
  const first = game.shoot(0, 0);
  const turnsAfterFirst = game.stats().turns;
  const second = game.shoot(0, 0);
  assert(second.alreadyShot, 're-shooting a cell reports alreadyShot');
  eq(game.stats().turns, turnsAfterFirst, 're-shooting does not cost a turn');
  eq(second.hit, first.hit, 're-shooting reports the original hit/miss value');
})();

// ---- a whole game to completion (seeded, deterministic) --------------------

(function playToWin() {
  // Sweep every seed; each game must end exactly when the last ship cell is hit,
  // and the win must fire on precisely the Nth ship-cell hit.
  for (let seed = 1; seed <= 100; seed += 1) {
    const game = startGame({ rng: mulberry32(seed) });
    const ships = allCells(game.placements);
    const shipCellList = [...ships].map((s) => s.split(',').map(Number));
    let sunkAt = -1;
    shipCellList.forEach(([r, c], i) => {
      const res = game.shoot(r, c);
      assert(res.hit, `seed ${seed}: every ship cell shot is a hit`);
      if (res.won && sunkAt === -1) sunkAt = i + 1;
    });
    eq(sunkAt, shipCellList.length, `seed ${seed}: win fires on the final ship cell`);
    eq(game.shipsRemaining(), 0, `seed ${seed}: no ships remain after the sweep`);
    assert(game.isOver(), `seed ${seed}: game reports over`);
    eq(game.winner(), 1, `seed ${seed}: solo winner is player 1`);
  }
})();

(function sinkReportsShipName() {
  const game = startGame({ rng: mulberry32(11) });
  // Sink the destroyer (length 2) specifically and check the name comes back.
  const destroyer = game.placements.find((s) => s.name === 'Destroyer');
  const [a, b] = destroyer.cells;
  const first = game.shoot(a[0], a[1]);
  eq(first.sunk, null, 'first hit on a 2-cell ship does not sink it');
  const second = game.shoot(b[0], b[1]);
  eq(second.sunk, 'Destroyer', 'second hit sinks and names the Destroyer');
})();

// ---- gameStats (bonus) -----------------------------------------------------

(function statsAccounting() {
  const game = startGame({ rng: mulberry32(6) });
  const ships = allCells(game.placements);
  // One deliberate miss.
  let missCell = null;
  for (let r = 0; r < game.size && !missCell; r += 1)
    for (let c = 0; c < game.size && !missCell; c += 1)
      if (!ships.has(`${r},${c}`)) missCell = [r, c];
  game.shoot(missCell[0], missCell[1]);
  // Two deliberate hits.
  const [h1, h2] = [...ships].slice(0, 2).map((s) => s.split(',').map(Number));
  game.shoot(h1[0], h1[1]);
  game.shoot(h2[0], h2[1]);

  const stats = game.stats();
  eq(stats.turns, 3, 'stats count three turns');
  eq(stats.hits, 2, 'stats count two hits');
  eq(stats.misses, 1, 'stats count one miss');
  eq(stats.shotsFired, 3, 'shotsFired = hits + misses');
  assert(Math.abs(stats.accuracy - 2 / 3) < 1e-9, 'accuracy = hits / turns');
})();

// ---- two-player mode (bonus) ----------------------------------------------

(function twoPlayerSeparateBoards() {
  const game = startGame({ players: 2, rng: mulberry32(8) });
  eq(game.players, 2, 'two-player game reports two players');
  assert(Array.isArray(game.placements) && game.placements.length === 2, 'two placement sets exist');

  // Player 1 shoots player 2's board; the mark lands on P2's board only.
  const p2ships = allCells(game.placements[1]);
  const [r, c] = [...p2ships][0].split(',').map(Number);
  const res = game.shoot(r, c, 1);
  assert(res.hit, 'player 1 hits a player-2 ship cell');
  eq(game.board(1)[r][c], HIT, "player 1's target board records the hit");
  eq(game.board(2)[r][c], UNTARGETED, "player 2's board is untouched by player 1's shot");
})();

(function twoPlayerWinner() {
  const game = startGame({ players: 2, rng: mulberry32(12) });
  // Player 1 sinks player 2's entire fleet.
  const p2ships = allCells(game.placements[1]);
  [...p2ships].forEach((s) => {
    const [r, c] = s.split(',').map(Number);
    game.shoot(r, c, 1);
  });
  assert(game.isOver(), 'two-player game ends when a fleet is wiped out');
  eq(game.winner(), 1, 'player 1 wins after sinking player 2');
})();

// ---- presentation layer (pure helpers) ------------------------------------

(function cliRendering() {
  const game = startGame({ rng: mulberry32(2) });
  const text = cli.renderBoard(game.board());
  const lines = text.split('\n');
  eq(lines.length, DEFAULT_SIZE + 1, 'rendered board has a header plus 8 rows');
  assert(lines[0].includes('0') && lines[0].includes('7'), 'header labels columns 0–7');

  eq(JSON.stringify(cli.parseCoord('3,4')), JSON.stringify({ row: 3, col: 4 }), 'parseCoord reads "3,4"');
  eq(JSON.stringify(cli.parseCoord('3 4')), JSON.stringify({ row: 3, col: 4 }), 'parseCoord reads "3 4"');
  eq(cli.parseCoord('nope'), null, 'parseCoord rejects garbage');
})();

// ---- summary ---------------------------------------------------------------

if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} failed.`);
  process.exit(1);
}
