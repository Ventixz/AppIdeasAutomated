// cli.js — the *text-based presentation layer* the spec asks for.
//
// It owns everything the engine deliberately doesn't: drawing the 2D board,
// prompting for coordinates, printing hit/miss feedback, congratulating the
// winner, offering a replay, and (bonus) a "stats" command plus two-player
// alternating turns in a single terminal session.
//
// Run it:  node cli.js            (1-player)
//          node cli.js --2p       (two-player, alternating turns)
//          node cli.js --size 10  (custom board dimension)

'use strict';

const readline = require('readline');
const { startGame } = require('./battleship-engine.js');

// --- board rendering -------------------------------------------------------

// Render a hits/misses grid as a labelled 2D block of text.
function renderBoard(board) {
  const size = board.length;
  const header = '   ' + Array.from({ length: size }, (_, c) => String(c).padStart(2, ' ')).join('');
  const lines = [header];
  for (let r = 0; r < size; r += 1) {
    const cells = board[r].map((cell) => (cell === ' ' ? '.' : cell)).join(' ');
    lines.push(`${String(r).padStart(2, ' ')}  ${cells}`);
  }
  return lines.join('\n');
}

function renderStats(stats) {
  return [
    `  turns played : ${stats.turns}`,
    `  hits         : ${stats.hits}`,
    `  misses       : ${stats.misses}`,
    `  ships sunk   : ${stats.shipsSunk}`,
    `  ships left   : ${stats.shipsRemaining}`,
    `  accuracy     : ${(stats.accuracy * 100).toFixed(1)}%`,
  ].join('\n');
}

// --- input parsing ---------------------------------------------------------

// Accept "r,c", "r c", or "r, c". Returns { row, col } or null.
function parseCoord(text) {
  const m = text.trim().match(/^(\d+)\s*[, ]\s*(\d+)$/);
  if (!m) return null;
  return { row: Number(m[1]), col: Number(m[2]) };
}

// --- the interactive loop --------------------------------------------------

function play(options, io) {
  const twoPlayer = options.players === 2;
  const rl = io || readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  async function round() {
    const game = startGame(options);
    let player = 1;

    console.log(`\n=== New game (${game.size}x${game.size}, ${game.fleet.length} ships${twoPlayer ? ', 2 players' : ''}) ===`);

    while (!game.isOver()) {
      const label = twoPlayer ? `Player ${player} ` : '';
      console.log(`\n${label}board (shots you've fired):`);
      console.log(renderBoard(game.board(player)));

      const answer = (await ask(`\n${label}target "row,col" (or "stats", "quit"): `)).trim().toLowerCase();

      if (answer === 'quit') { rl.close(); return; }
      if (answer === 'stats') {
        console.log('\n' + renderStats(game.stats(player)));
        continue;
      }

      const coord = parseCoord(answer);
      if (!coord) {
        console.log('  ✗ Please enter coordinates as "row,col", e.g. 3,4');
        continue;
      }
      if (coord.row >= game.size || coord.col >= game.size) {
        console.log(`  ✗ Off the board — rows/cols run 0–${game.size - 1}.`);
        continue;
      }

      const result = game.shoot(coord.row, coord.col, player);
      if (result.alreadyShot) {
        console.log("  · You've already fired there. Try somewhere else.");
        continue;
      }

      if (result.hit) {
        console.log(result.sunk ? `  💥 HIT — you sank the ${result.sunk}!` : '  💥 HIT!');
      } else {
        console.log('  · Miss.');
      }

      if (game.isOver()) break;
      if (twoPlayer) player = player === 1 ? 2 : 1; // alternate turns
    }

    const winner = game.winner();
    console.log(twoPlayer
      ? `\n🎉 Congratulations, Player ${winner} — you sank the enemy fleet!`
      : '\n🎉 Congratulations — you sank the whole fleet!');
    console.log('\nFinal stats:\n' + renderStats(game.stats(twoPlayer ? winner : 1)));

    const again = (await ask('\nPlay again? (y/n): ')).trim().toLowerCase();
    if (again === 'y' || again === 'yes') return round();
    rl.close();
  }

  return round();
}

// --- argv wiring -----------------------------------------------------------

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--2p') options.players = 2;
    else if (argv[i] === '--size') options.size = Number(argv[i + 1]);
  }
  return options;
}

if (require.main === module) {
  play(parseArgs(process.argv.slice(2)));
}

module.exports = { renderBoard, renderStats, parseCoord, play };
