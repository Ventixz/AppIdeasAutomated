// battleship-core.js — DOM-free, deterministic core for the Battleship Bot.
//
// This file holds two layers, and neither of them ever touches the DOM, the
// network, Discord, the clock, or a global random source:
//
//   1. A small Battleship *game engine* — fleet placement, shooting, hit /
//      miss / sunk detection, and win detection. All randomness is *injected*
//      as an `rng` argument (a function returning a float in [0, 1)), so a
//      seeded generator makes an entire game reproducible under test.
//
//   2. A *bot presentation layer* — the thing that turns a line of chat like
//      `bb shoot 3,4` into a reply. `handleCommand` is a pure reducer: it
//      takes the current session and a line of text and returns a *new*
//      session plus the messages the bot would post. The browser shell and the
//      test suite drive the exact same function.
//
// The spec (florinpop17/app-ideas, Tier 3 → Battleship Bot) describes a Discord
// bot. With no network access in this environment, the browser app renders a
// faithful Discord-style chat that speaks the identical `bb …` command grammar.

'use strict';

// ---- board geometry --------------------------------------------------------

const BOARD_SIZE = 10;

// The standard Milton-Bradley fleet: 17 cells across five ships.
const FLEET = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];

const TOTAL_SHIP_CELLS = FLEET.reduce((n, s) => n + s.size, 0); // 17

function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

// Build an empty SIZE×SIZE grid filled with `fill`.
function emptyGrid(fill) {
  const g = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    const row = [];
    for (let c = 0; c < BOARD_SIZE; c += 1) row.push(fill);
    g.push(row);
  }
  return g;
}

// ---- fleet placement -------------------------------------------------------

// The cells a ship of `size` would occupy if its bow sits at (r,c) pointing in
// `dir` ('H' or 'V'). Returns null if any cell would fall off the board.
function shipCells(r, c, size, dir) {
  const cells = [];
  for (let i = 0; i < size; i += 1) {
    const rr = dir === 'V' ? r + i : r;
    const cc = dir === 'H' ? c + i : c;
    if (!inBounds(rr, cc)) return null;
    cells.push([rr, cc]);
  }
  return cells;
}

function cellsFree(occupied, cells) {
  return cells.every(([r, c]) => occupied[r][c] === null);
}

// Place the whole fleet using the injected rng. Returns { occupied, ships }
// where `occupied` is a grid of ship-index|null and `ships` carries each
// ship's placed cells. Ships never overlap; the classic rules allow them to
// touch. rng() must return a float in [0, 1).
function placeFleet(rng) {
  const occupied = emptyGrid(null);
  const ships = [];

  FLEET.forEach((spec, index) => {
    // Rejection-sample a legal placement. The board is far larger than the
    // fleet, so this terminates quickly; the guard just prevents an infinite
    // loop if a caller somehow passes a degenerate rng.
    let placed = null;
    for (let attempt = 0; attempt < 10000 && !placed; attempt += 1) {
      const dir = rng() < 0.5 ? 'H' : 'V';
      const r = Math.floor(rng() * BOARD_SIZE);
      const c = Math.floor(rng() * BOARD_SIZE);
      const cells = shipCells(r, c, spec.size, dir);
      if (cells && cellsFree(occupied, cells)) placed = cells;
    }
    if (!placed) throw new Error(`could not place ${spec.name}`);

    placed.forEach(([r, c]) => {
      occupied[r][c] = index;
    });
    ships.push({
      name: spec.name,
      size: spec.size,
      cells: placed,
      hits: 0,
      sunk: false,
    });
  });

  return { occupied, ships };
}

// ---- game engine -----------------------------------------------------------

// A fresh game: a hidden fleet plus an all-unknown shot grid. Immutable value.
function createGame(rng) {
  const { occupied, ships } = placeFleet(rng);
  return {
    occupied, // ship-index | null  (hidden from the player)
    shots: emptyGrid('unknown'), // 'unknown' | 'hit' | 'miss'
    ships,
    shotsFired: 0,
    status: 'playing', // 'playing' | 'won'
  };
}

function cloneGrid(g) {
  return g.map((row) => row.slice());
}

// Fire at (r, c). Pure: returns { game, result } with a *new* game value.
// result.kind is one of:
//   'invalid' — off the board
//   'repeat'  — that cell was already fired at
//   'miss'    — water
//   'hit'     — hit a ship that still has cells left
//   'sunk'    — hit that sank a ship (but the fleet survives)
//   'won'     — hit that sank the final ship
function shoot(game, r, c) {
  if (game.status !== 'playing') {
    return { game, result: { kind: 'over' } };
  }
  if (!inBounds(r, c)) {
    return { game, result: { kind: 'invalid' } };
  }
  if (game.shots[r][c] !== 'unknown') {
    return { game, result: { kind: 'repeat' } };
  }

  const shots = cloneGrid(game.shots);
  const shipIndex = game.occupied[r][c];

  if (shipIndex === null) {
    shots[r][c] = 'miss';
    return {
      game: { ...game, shots, shotsFired: game.shotsFired + 1 },
      result: { kind: 'miss' },
    };
  }

  // A hit. Copy the fleet so we can bump this ship's hit count immutably.
  shots[r][c] = 'hit';
  const ships = game.ships.map((s, i) => {
    if (i !== shipIndex) return s;
    const hits = s.hits + 1;
    return { ...s, hits, sunk: hits >= s.size };
  });
  const ship = ships[shipIndex];
  const fleetSunk = ships.every((s) => s.sunk);
  const status = fleetSunk ? 'won' : 'playing';

  let kind = 'hit';
  if (fleetSunk) kind = 'won';
  else if (ship.sunk) kind = 'sunk';

  return {
    game: { ...game, shots, ships, shotsFired: game.shotsFired + 1, status },
    result: { kind, shipName: ship.name },
  };
}

function shipsRemaining(game) {
  return game.ships.filter((s) => !s.sunk).length;
}

// ---- board rendering -------------------------------------------------------

// Glyphs for the monospace board the bot posts back into chat.
const GLYPH = {
  unknown: '·',
  hit: 'X',
  miss: 'o',
  ship: '#', // only shown when the board is revealed
};

// Render the shot grid as a monospace block. When `reveal` is true, un-hit
// ship cells are shown as '#', which is how the board looks after a win or a
// surrender. Returns a plain string (no ANSI, no markup).
function renderBoard(game, options) {
  const reveal = !!(options && options.reveal);
  const header = '   ' + Array.from({ length: BOARD_SIZE }, (_, i) => i).join(' ');
  const lines = [header];

  for (let r = 0; r < BOARD_SIZE; r += 1) {
    const cells = [];
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const shot = game.shots[r][c];
      let glyph = GLYPH[shot];
      if (reveal && shot === 'unknown' && game.occupied[r][c] !== null) {
        glyph = GLYPH.ship;
      }
      cells.push(glyph);
    }
    lines.push(`${r}  ${cells.join(' ')}`);
  }
  return lines.join('\n');
}

// A one-line fleet status ledger, e.g. "Carrier ~~~~~  Battleship ▉▉▉▉ …".
// Used under the board so the player can see which ships are already sunk.
function renderFleetStatus(game) {
  return game.ships
    .map((s) => `${s.name}: ${s.sunk ? 'SUNK' : `${s.hits}/${s.size}`}`)
    .join('  ·  ');
}

// ---- bot command layer -----------------------------------------------------

const HELP_TEXT = [
  '**Battleship Bot** — sink the hidden fleet before you run out of patience!',
  '',
  'The board is a 10×10 grid (rows and columns numbered 0–9). Somewhere on it',
  'are five ships: Carrier (5), Battleship (4), Cruiser (3), Submarine (3) and',
  'Destroyer (2). Call your shots and I will tell you hit or miss.',
  '',
  'Commands:',
  '  `bb help`         — show these rules',
  '  `bb start`        — deal a fresh board and begin',
  '  `bb shoot r,c`    — fire at row r, column c (e.g. `bb shoot 3,4`)',
  '  `bb surrender`    — give up and reveal the board',
].join('\n');

// Parse a raw chat line into a command. Returns null for anything that is not
// addressed to the bot (does not start with the `bb` prefix). Otherwise
// returns { cmd, r, c, error } — `cmd` is one of help/start/shoot/surrender/
// unknown; shoot carries parsed r,c or an `error` string.
function parseCommand(text) {
  const raw = String(text == null ? '' : text).trim();
  const m = /^bb\b\s*(.*)$/i.exec(raw);
  if (!m) return null; // not talking to the bot

  const rest = m[1].trim();
  if (rest === '' || /^help$/i.test(rest)) return { cmd: 'help' };
  if (/^start$/i.test(rest)) return { cmd: 'start' };
  if (/^surrender$/i.test(rest)) return { cmd: 'surrender' };

  const shot = /^shoot\b\s*(.*)$/i.exec(rest);
  if (shot) {
    const coords = shot[1].trim();
    // Accept "r,c", "r ,c", "r c" — any comma/space separated pair of ints.
    const cm = /^(-?\d+)\s*[, ]\s*(-?\d+)$/.exec(coords);
    if (!cm) {
      return { cmd: 'shoot', error: 'Usage: `bb shoot r,c` — e.g. `bb shoot 3,4`.' };
    }
    return { cmd: 'shoot', r: parseInt(cm[1], 10), c: parseInt(cm[2], 10) };
  }

  return { cmd: 'unknown', rest };
}

// A session bundles the current game (or null before `bb start`) with nothing
// else — it is a plain value the caller owns and threads back in.
function createSession() {
  return { game: null };
}

// The heart of the bot. Pure reducer over (session, text):
//   handleCommand(session, text, rng) -> { session, replies }
// `replies` is an array of { text, board?, reveal?, kind } messages the bot
// would post, in order. `board`/`reveal` let the shell render a graphical card
// (bonus feature) instead of the plain text grid if it wishes; `text` always
// carries a chat-ready fallback. rng is only consulted for `bb start`.
function handleCommand(session, text, rng) {
  const parsed = parseCommand(text);
  if (!parsed) return { session, replies: [] }; // ignore non-bb chatter

  switch (parsed.cmd) {
    case 'help':
      return reply(session, { text: HELP_TEXT, kind: 'help' });

    case 'start': {
      const game = createGame(rng || Math.random);
      const next = { ...session, game };
      return {
        session: next,
        replies: [
          {
            kind: 'start',
            text:
              'A fresh fleet is hidden on the board. Call your shots with ' +
              '`bb shoot r,c` (rows & columns 0–9).',
            board: renderBoard(game),
            game,
          },
        ],
      };
    }

    case 'shoot':
      return handleShoot(session, parsed, rng);

    case 'surrender': {
      if (!session.game || session.game.status !== 'playing') {
        return reply(session, {
          text: 'There is no game in progress. Start one with `bb start`.',
          kind: 'error',
        });
      }
      const game = session.game;
      const revealed = renderBoard(game, { reveal: true });
      return {
        session: { ...session, game: { ...game, status: 'surrendered' } },
        replies: [
          {
            kind: 'surrender',
            text:
              'You surrendered. Here is where the fleet was hiding — ' +
              `you sank ${game.ships.filter((s) => s.sunk).length} of ${game.ships.length}. ` +
              'Play again with `bb start`.',
            board: revealed,
            reveal: true,
            game,
          },
        ],
      };
    }

    case 'unknown':
    default:
      return reply(session, {
        text: `Sorry, I don't know \`bb ${parsed.rest || ''}\`. Try \`bb help\`.`,
        kind: 'error',
      });
  }
}

function handleShoot(session, parsed, rng) {
  if (!session.game || session.game.status !== 'playing') {
    return reply(session, {
      text: 'No game in progress. Start one with `bb start`.',
      kind: 'error',
    });
  }
  if (parsed.error) {
    return reply(session, { text: parsed.error, kind: 'error' });
  }

  const { game, result } = shoot(session.game, parsed.r, parsed.c);
  const at = `${parsed.r},${parsed.c}`;

  if (result.kind === 'invalid') {
    return reply(session, {
      text: `(${at}) is off the board — rows and columns run 0–9.`,
      kind: 'error',
    });
  }
  if (result.kind === 'repeat') {
    return reply(session, {
      text: `You already fired at (${at}). Pick a fresh cell.`,
      kind: 'error',
    });
  }

  const next = { ...session, game };
  let text;
  if (result.kind === 'miss') {
    text = `💧 Miss at (${at}).`;
  } else if (result.kind === 'hit') {
    text = `💥 Hit at (${at})!`;
  } else if (result.kind === 'sunk') {
    text = `🔥 Hit at (${at}) — you sank my **${result.shipName}**! ` +
      `${shipsRemaining(game)} ship(s) left.`;
  } else if (result.kind === 'won') {
    text =
      `🎉 Hit at (${at}) — that sinks my **${result.shipName}** and the whole fleet! ` +
      `**Congratulations, you win in ${game.shotsFired} shots!** Play again with \`bb start\`.`;
  }

  return {
    session: next,
    replies: [
      {
        kind: result.kind,
        text,
        board: renderBoard(game, { reveal: result.kind === 'won' }),
        reveal: result.kind === 'won',
        game,
      },
    ],
  };
}

// Small helper: a single-message reply that leaves the session unchanged.
function reply(session, message) {
  return { session, replies: [message] };
}

// ---- exports ---------------------------------------------------------------

const API = {
  BOARD_SIZE,
  FLEET,
  TOTAL_SHIP_CELLS,
  HELP_TEXT,
  GLYPH,
  inBounds,
  emptyGrid,
  shipCells,
  placeFleet,
  createGame,
  shoot,
  shipsRemaining,
  renderBoard,
  renderFleetStatus,
  parseCommand,
  createSession,
  handleCommand,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
if (typeof window !== 'undefined') {
  window.battleshipCore = API;
}
