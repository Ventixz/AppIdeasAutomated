// tests.js — dependency-free test suite for battleship-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const core = require('./battleship-core.js');

const {
  BOARD_SIZE,
  TOTAL_SHIP_CELLS,
  FLEET,
  placeFleet,
  createGame,
  shoot,
  shipsRemaining,
  renderBoard,
  parseCommand,
  createSession,
  handleCommand,
} = core;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
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

// Find the coordinates of every ship cell on a game's hidden board.
function allShipCells(game) {
  const cells = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      if (game.occupied[r][c] !== null) cells.push([r, c]);
    }
  }
  return cells;
}

// ---- fleet placement -------------------------------------------------------

(function placementIsLegal() {
  for (let seed = 1; seed <= 50; seed += 1) {
    const { occupied, ships } = placeFleet(mulberry32(seed));

    // Right number of ships, right sizes.
    eq(ships.length, FLEET.length, `seed ${seed}: ship count`);
    let total = 0;
    ships.forEach((s, i) => {
      eq(s.cells.length, s.size, `seed ${seed}: ${s.name} length`);
      total += s.size;
      // Every claimed cell is on the board and maps back to this ship.
      s.cells.forEach(([r, c]) => {
        assert(r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE, `seed ${seed}: ${s.name} in bounds`);
        eq(occupied[r][c], i, `seed ${seed}: ${s.name} owns (${r},${c})`);
      });
      // Each ship is a straight, contiguous line (H or V).
      const rows = new Set(s.cells.map(([r]) => r));
      const cols = new Set(s.cells.map(([, c]) => c));
      assert(rows.size === 1 || cols.size === 1, `seed ${seed}: ${s.name} is straight`);
    });
    eq(total, TOTAL_SHIP_CELLS, `seed ${seed}: total ship cells`);

    // No overlaps: exactly TOTAL_SHIP_CELLS occupied cells.
    let occ = 0;
    for (let r = 0; r < BOARD_SIZE; r += 1)
      for (let c = 0; c < BOARD_SIZE; c += 1) if (occupied[r][c] !== null) occ += 1;
    eq(occ, TOTAL_SHIP_CELLS, `seed ${seed}: no overlaps`);
  }
})();

// ---- shooting mechanics ----------------------------------------------------

(function missesAndHits() {
  const game = createGame(mulberry32(7));
  const ships = allShipCells(game);
  const shipSet = new Set(ships.map(([r, c]) => `${r},${c}`));

  // Find a water cell and a ship cell deterministically.
  let water = null;
  for (let r = 0; r < BOARD_SIZE && !water; r += 1)
    for (let c = 0; c < BOARD_SIZE && !water; c += 1)
      if (!shipSet.has(`${r},${c}`)) water = [r, c];

  const missRes = shoot(game, water[0], water[1]);
  eq(missRes.result.kind, 'miss', 'water cell is a miss');
  eq(missRes.game.shots[water[0]][water[1]], 'miss', 'miss recorded on grid');
  eq(missRes.game.shotsFired, 1, 'shot counter incremented on miss');

  const hitRes = shoot(game, ships[0][0], ships[0][1]);
  assert(['hit', 'sunk', 'won'].includes(hitRes.result.kind), 'ship cell is a hit');
  eq(hitRes.game.shots[ships[0][0]][ships[0][1]], 'hit', 'hit recorded on grid');
})();

(function purityAndGuards() {
  const game = createGame(mulberry32(3));
  const before = JSON.stringify(game);
  const ships = allShipCells(game);
  shoot(game, ships[0][0], ships[0][1]);
  eq(JSON.stringify(game), before, 'shoot does not mutate the input game');

  // Off-board and repeat guards.
  eq(shoot(game, -1, 0).result.kind, 'invalid', 'negative row is invalid');
  eq(shoot(game, 0, 10).result.kind, 'invalid', 'column 10 is invalid');

  const first = shoot(game, ships[0][0], ships[0][1]);
  const again = shoot(first.game, ships[0][0], ships[0][1]);
  eq(again.result.kind, 'repeat', 'firing the same cell twice is a repeat');
  eq(again.game.shotsFired, first.game.shotsFired, 'repeat does not spend a shot');
})();

(function sinkAndWin() {
  const game = createGame(mulberry32(11));
  // Sink exactly the first ship, cell by cell.
  const ship = game.ships[0];
  let state = game;
  let lastKind = null;
  ship.cells.forEach(([r, c]) => {
    const res = shoot(state, r, c);
    state = res.game;
    lastKind = res.result.kind;
  });
  eq(lastKind, 'sunk', 'final cell of a ship reports sunk');
  eq(state.ships[0].sunk, true, 'ship marked sunk');
  eq(shipsRemaining(state), FLEET.length - 1, 'one fewer ship remaining');

  // Now sink the whole fleet and expect a win on the very last cell.
  let full = createGame(mulberry32(11));
  const everyCell = allShipCells(full);
  let result = null;
  everyCell.forEach(([r, c]) => {
    result = shoot(full, r, c);
    full = result.game;
  });
  eq(result.result.kind, 'won', 'sinking the last cell reports won');
  eq(full.status, 'won', 'game status is won');
  eq(full.shotsFired, TOTAL_SHIP_CELLS, 'won in exactly 17 shots (no wasted shots)');
  eq(shoot(full, 0, 0).result.kind, 'over', 'no shooting after the game is won');
})();

// ---- command parsing -------------------------------------------------------

(function parsing() {
  assert(parseCommand('hello there') === null, 'non-bb text is ignored');
  eq(parseCommand('bb').cmd, 'help', 'bare bb is help');
  eq(parseCommand('bb help').cmd, 'help', 'bb help');
  eq(parseCommand('BB HELP').cmd, 'help', 'command parsing is case-insensitive');
  eq(parseCommand('bb start').cmd, 'start', 'bb start');
  eq(parseCommand('bb surrender').cmd, 'surrender', 'bb surrender');

  const s = parseCommand('bb shoot 3,4');
  eq(s.cmd, 'shoot', 'bb shoot parsed');
  eq(s.r, 3, 'shoot row');
  eq(s.c, 4, 'shoot col');

  eq(parseCommand('bb shoot 3 4').r, 3, 'space-separated coords accepted');
  eq(parseCommand('bb shoot  9 , 0 ').c, 0, 'spaces around comma tolerated');
  assert(parseCommand('bb shoot banana').error, 'garbage coords produce an error');
  eq(parseCommand('bb fly').cmd, 'unknown', 'unknown verb');
})();

// ---- bot layer end-to-end --------------------------------------------------

(function botFlow() {
  let session = createSession();

  // Shooting before starting is refused.
  let out = handleCommand(session, 'bb shoot 0,0', mulberry32(5));
  session = out.session;
  eq(out.replies.length, 1, 'one reply to premature shot');
  assert(/no game/i.test(out.replies[0].text), 'refuses shot before start');

  // Help works without a game.
  out = handleCommand(session, 'bb help', mulberry32(5));
  assert(/Commands:/.test(out.replies[0].text), 'help lists commands');

  // Start deals a board.
  out = handleCommand(session, 'bb start', mulberry32(5));
  session = out.session;
  assert(session.game && session.game.status === 'playing', 'start creates a playing game');
  assert(typeof out.replies[0].board === 'string', 'start posts a board');

  // Non-bb chatter is dropped entirely (no reply).
  const chatter = handleCommand(session, 'nice weather today', mulberry32(5));
  eq(chatter.replies.length, 0, 'ignores non-bb chat');

  // Play the seeded game to completion via the bot layer.
  const cells = allShipCells(session.game);
  let last = null;
  cells.forEach(([r, c]) => {
    last = handleCommand(session, `bb shoot ${r},${c}`, mulberry32(5));
    session = last.session;
  });
  assert(/Congratulations/i.test(last.replies[0].text), 'win message congratulates the player');
  assert(last.replies[0].reveal === true, 'winning reply reveals the board');
  eq(session.game.status, 'won', 'session game is won at the end');

  // After a win, shooting is refused again.
  const afterWin = handleCommand(session, 'bb shoot 0,0', mulberry32(5));
  assert(/no game/i.test(afterWin.replies[0].text), 'no play after win');
})();

(function surrenderFlow() {
  let session = createSession();
  session = handleCommand(session, 'bb start', mulberry32(9)).session;
  const out = handleCommand(session, 'bb surrender', mulberry32(9));
  eq(out.session.game.status, 'surrendered', 'surrender sets status');
  assert(out.replies[0].reveal === true, 'surrender reveals the board');
  assert(/surrender/i.test(out.replies[0].text), 'surrender acknowledged');

  // The revealed board shows hidden ship cells as '#'.
  assert(out.replies[0].board.includes('#'), 'revealed board shows ship glyphs');
})();

(function boardRendering() {
  const game = createGame(mulberry32(2));
  const board = renderBoard(game);
  const lines = board.split('\n');
  eq(lines.length, BOARD_SIZE + 1, 'board has a header plus 10 rows');
  assert(lines[0].includes('0') && lines[0].includes('9'), 'header labels columns 0–9');
  // Before any shot the visible board is all unknown glyphs (no X/o).
  assert(!board.includes('X') && !board.includes('o'), 'fresh board shows no hits or misses');
})();

// ---- summary ---------------------------------------------------------------

if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} failed.`);
  process.exit(1);
}
