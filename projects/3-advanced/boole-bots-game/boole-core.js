// boole-core.js — the presentation-free Boole Bots engine.
//
// Everything about Boolean combat and arena physics lives here as a pure,
// DOM-free module. Randomness is *injected* (options.rng) so a seeded generator
// replays any battle deterministically. Two different presentation layers — the
// browser (index.html) and the test suite (tests.js) — drive this same engine.
//
// A bot carries a Boolean value (0 or 1) and an operation. When two bots collide
// each applies its own operation to (self, other); the bot whose result is 0
// loses and disappears, the bot whose result is 1 wins. Matching results tie and
// both bots resume. Play continues until a single bot remains.

'use strict';

// --- Boolean operations --------------------------------------------------

// Each op takes (self, other) and returns 0 or 1. NOT is unary and ignores the
// opponent's value; the others are the standard binary gates.
const OPERATIONS = {
  AND: { label: 'AND', unary: false, apply: (a, b) => (a && b ? 1 : 0) },
  OR: { label: 'OR', unary: false, apply: (a, b) => (a || b ? 1 : 0) },
  XOR: { label: 'XOR', unary: false, apply: (a, b) => (a ^ b ? 1 : 0) },
  NOT: { label: 'NOT', unary: true, apply: (a) => (a ? 0 : 1) },
};

const OPERATION_NAMES = Object.keys(OPERATIONS);

function applyOperation(op, self, other) {
  const def = OPERATIONS[op];
  if (!def) throw new Error(`Unknown operation: ${op}`);
  return def.apply(self ? 1 : 0, other ? 1 : 0);
}

// Resolve a collision between two bots. Returns each bot's Boolean result and
// the outcome: 'a' (a wins, b disappears), 'b' (b wins, a disappears), or
// 'tie' (matching results — both resume unharmed).
function resolveCollision(botA, botB) {
  const resultA = applyOperation(botA.operation, botA.value, botB.value);
  const resultB = applyOperation(botB.operation, botB.value, botA.value);
  let outcome;
  if (resultA === resultB) outcome = 'tie';
  else if (resultA === 1) outcome = 'a';
  else outcome = 'b';
  return { resultA, resultB, outcome };
}

// --- Directions ----------------------------------------------------------

// Unit vectors. The four cardinals are always available; the four diagonals are
// the bonus "8 directions" mode. Vectors are normalised so speed is uniform.
const SQRT1_2 = Math.SQRT1_2;
const DIRECTIONS = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
  NE: { dx: SQRT1_2, dy: -SQRT1_2 },
  NW: { dx: -SQRT1_2, dy: -SQRT1_2 },
  SE: { dx: SQRT1_2, dy: SQRT1_2 },
  SW: { dx: -SQRT1_2, dy: SQRT1_2 },
};

const CARDINAL_NAMES = ['N', 'S', 'E', 'W'];
const DIAGONAL_NAMES = ['NE', 'NW', 'SE', 'SW'];
const ALL_DIRECTION_NAMES = CARDINAL_NAMES.concat(DIAGONAL_NAMES);

// --- Defaults ------------------------------------------------------------

const DEFAULT_SIZE = 8; // 8x8 arena, per the spec
const BOT_RADIUS = 0.32; // fraction of a tile; two bots collide when they touch
const DEFAULT_SPEED = 1; // tiles per second at speed 1

// --- Arena ---------------------------------------------------------------

// createArena builds a live battle from a list of bot configs. Each config:
//   { name, value: 0|1, operation: 'AND'|'OR'|'XOR'|'NOT', speed, direction }
// Options: { size, rng, radius }. rng() must return [0, 1); it seeds starting
// tiles and any random directions so an entire battle is reproducible.
function createArena(botConfigs, options = {}) {
  const size = options.size || DEFAULT_SIZE;
  const rng = options.rng || Math.random;
  const radius = options.radius != null ? options.radius : BOT_RADIUS;

  const names = botConfigs.map((b) => b.name);
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) throw new Error(`Duplicate bot name: ${dupe}`);

  // Place each bot on a random free tile centre. Retry on the rare overlap.
  const occupied = new Set();
  const bots = botConfigs.map((cfg, index) => {
    let col;
    let row;
    let guard = 0;
    do {
      col = Math.floor(rng() * size);
      row = Math.floor(rng() * size);
      guard += 1;
    } while (occupied.has(`${col},${row}`) && guard < size * size * 4);
    occupied.add(`${col},${row}`);

    const dirName = cfg.direction || CARDINAL_NAMES[Math.floor(rng() * 4)];
    const dir = DIRECTIONS[dirName] || DIRECTIONS.N;
    return {
      id: index,
      name: cfg.name,
      value: cfg.value ? 1 : 0,
      operation: cfg.operation || 'AND',
      speed: cfg.speed != null ? cfg.speed : DEFAULT_SPEED,
      icon: cfg.icon || null,
      color: cfg.color || null,
      x: col + 0.5,
      y: row + 0.5,
      dx: dir.dx,
      dy: dir.dy,
      direction: dirName,
      alive: true,
      wins: 0,
      losses: 0,
      cooldown: 0, // brief post-collision grace so partners don't re-hit
    };
  });

  let elapsed = 0; // seconds of battle time
  let collisions = 0;
  let stalemated = false;

  function livingBots() {
    return bots.filter((b) => b.alive);
  }

  // A battle can deadlock: if every remaining pair of bots resolves to a tie,
  // nobody can ever be eliminated. Detect that so play stops with a draw instead
  // of spinning forever. (Example: two bots that both always resolve to 1.)
  function isStalemate() {
    const living = livingBots();
    if (living.length < 2) return false;
    for (let i = 0; i < living.length; i += 1) {
      for (let j = i + 1; j < living.length; j += 1) {
        if (resolveCollision(living[i], living[j]).outcome !== 'tie') return false;
      }
    }
    return true;
  }

  // Bounce a bot off any wall it has crossed, clamp it back inside, and send it
  // off in a NEW direction (spec: "bots bounce off boundary walls in new
  // directions"). The new heading is jittered via the injected rng — so battles
  // stay reproducible — but always forced to point back inward. Without this,
  // axis-aligned bots would orbit forever on fixed rows/columns and never meet.
  function bounce(bot) {
    let inwardX = 0;
    let inwardY = 0;
    if (bot.x < radius) {
      bot.x = radius;
      inwardX = 1;
    } else if (bot.x > size - radius) {
      bot.x = size - radius;
      inwardX = -1;
    }
    if (bot.y < radius) {
      bot.y = radius;
      inwardY = 1;
    } else if (bot.y > size - radius) {
      bot.y = size - radius;
      inwardY = -1;
    }
    if (!inwardX && !inwardY) return;

    // Reflect the impacted component(s), then rotate the heading by a small
    // random angle so repeated bounces fan out across the arena.
    if (inwardX) bot.dx = Math.abs(bot.dx) * inwardX;
    if (inwardY) bot.dy = Math.abs(bot.dy) * inwardY;
    const angle = Math.atan2(bot.dy, bot.dx) + (rng() - 0.5) * 1.4;
    bot.dx = Math.cos(angle);
    bot.dy = Math.sin(angle);
    // Guarantee the jitter didn't turn it back into the wall it just hit.
    if (inwardX && Math.sign(bot.dx) !== inwardX) bot.dx = Math.abs(bot.dx) * inwardX;
    if (inwardY && Math.sign(bot.dy) !== inwardY) bot.dy = Math.abs(bot.dy) * inwardY;
  }

  // Advance the battle by dt seconds. Returns the events that happened this step
  // so a presentation layer can log them: wall bounces, collisions, defeats, and
  // the final win. Movement is split into small sub-steps so fast bots can't
  // tunnel through each other between frames.
  function step(dt) {
    const events = [];
    if (livingBots().length <= 1 || stalemated) return events;
    // Nothing left can be decided — call it a draw and stop.
    if (isStalemate()) {
      stalemated = true;
      events.push({
        type: 'stalemate',
        survivors: livingBots().map((b) => b.name),
        time: elapsed,
      });
      return events;
    }

    const maxSpeed = Math.max(1, ...livingBots().map((b) => b.speed));
    const subSteps = Math.max(1, Math.ceil((maxSpeed * dt) / (radius / 2)));
    const sub = dt / subSteps;

    for (let s = 0; s < subSteps && livingBots().length > 1; s += 1) {
      for (const bot of livingBots()) {
        bot.x += bot.dx * bot.speed * sub;
        bot.y += bot.dy * bot.speed * sub;
        const before = bot.direction;
        bounce(bot);
        if (bot.cooldown > 0) bot.cooldown = Math.max(0, bot.cooldown - sub);
        void before;
      }

      // Check every living pair for contact.
      const living = livingBots();
      for (let i = 0; i < living.length; i += 1) {
        for (let j = i + 1; j < living.length; j += 1) {
          const a = living[i];
          const b = living[j];
          if (!a.alive || !b.alive) continue;
          const dxr = a.x - b.x;
          const dyr = a.y - b.y;
          if (dxr * dxr + dyr * dyr > (radius * 2) * (radius * 2)) continue;
          if (a.cooldown > 0 && b.cooldown > 0) continue;

          collisions += 1;
          const res = resolveCollision(a, b);
          const event = {
            type: 'collision',
            a: a.name,
            b: b.name,
            resultA: res.resultA,
            resultB: res.resultB,
            outcome: res.outcome,
            time: elapsed + (s + 1) * sub,
          };

          if (res.outcome === 'tie') {
            // Matching results: both survive. Reverse and separate them so the
            // pause "resumes" onto a fresh path instead of re-colliding.
            reverse(a);
            reverse(b);
            separate(a, b);
            a.cooldown = radius;
            b.cooldown = radius;
            event.loser = null;
          } else {
            const winner = res.outcome === 'a' ? a : b;
            const loser = res.outcome === 'a' ? b : a;
            winner.wins += 1;
            loser.losses += 1;
            loser.alive = false;
            reverse(winner);
            winner.cooldown = radius;
            event.winner = winner.name;
            event.loser = loser.name;
          }
          events.push(event);
        }
      }
    }

    elapsed += dt;

    const remaining = livingBots();
    if (remaining.length === 1) {
      events.push({ type: 'win', winner: remaining[0].name, time: elapsed });
    }
    return events;
  }

  // Reverse a bot's heading (used after a bounce-like resolution).
  function reverse(bot) {
    bot.dx = -bot.dx;
    bot.dy = -bot.dy;
  }

  // Push two overlapping bots apart along the line between their centres.
  function separate(a, b) {
    let nx = a.x - b.x;
    let ny = a.y - b.y;
    let len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const push = radius * 1.1;
    a.x += nx * push;
    a.y += ny * push;
    b.x -= nx * push;
    b.y -= ny * push;
    bounce(a);
    bounce(b);
  }

  // Ranked leaderboard: alive first, then by wins, then by fewest losses.
  function leaderboard() {
    return bots
      .slice()
      .sort((p, q) => {
        if (p.alive !== q.alive) return p.alive ? -1 : 1;
        if (p.wins !== q.wins) return q.wins - p.wins;
        return p.losses - q.losses;
      })
      .map((b) => ({
        name: b.name,
        value: b.value,
        operation: b.operation,
        wins: b.wins,
        losses: b.losses,
        alive: b.alive,
      }));
  }

  function winner() {
    const living = livingBots();
    return living.length === 1 ? living[0].name : null;
  }

  // Whether the battle is over — either one bot remains, or the survivors are
  // deadlocked in a draw.
  function settled() {
    return winner() !== null || stalemated;
  }

  // Structured result once settled(): a win with one champion, or a draw with
  // the co-surviving bots.
  function outcome() {
    if (winner() !== null) return { type: 'win', winner: winner() };
    if (stalemated) return { type: 'draw', survivors: livingBots().map((b) => b.name) };
    return null;
  }

  function stats() {
    return {
      elapsed,
      collisions,
      botsRemaining: livingBots().length,
      botsTotal: bots.length,
    };
  }

  return {
    bots, // live references, for a renderer to read positions each frame
    size,
    radius,
    step,
    livingBots,
    leaderboard,
    winner,
    settled,
    outcome,
    isStalemate,
    stats,
    get elapsed() {
      return elapsed;
    },
  };
}

// Run an entire battle headlessly to completion and return the winner + stats.
// Guards against a pathological non-terminating configuration with maxSeconds.
function runBattle(botConfigs, options = {}) {
  const arena = createArena(botConfigs, options);
  const dt = options.dt || 0.05;
  const maxSeconds = options.maxSeconds || 600;
  const log = [];
  while (!arena.settled() && arena.elapsed < maxSeconds) {
    const events = arena.step(dt);
    for (const e of events) log.push(e);
  }
  return {
    winner: arena.winner(),
    outcome: arena.outcome(),
    leaderboard: arena.leaderboard(),
    stats: arena.stats(),
    log,
  };
}

const api = {
  OPERATIONS,
  OPERATION_NAMES,
  DIRECTIONS,
  CARDINAL_NAMES,
  DIAGONAL_NAMES,
  ALL_DIRECTION_NAMES,
  DEFAULT_SIZE,
  BOT_RADIUS,
  applyOperation,
  resolveCollision,
  createArena,
  runBattle,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.BooleCore = api;
}
