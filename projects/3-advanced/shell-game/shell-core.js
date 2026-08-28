/*
 * shell-core.js — the presentation-free engine for the Shell Game.
 *
 * Not a single line in here touches the DOM, the canvas, or a timer. You hand
 * it a game state (a plain object) and it hands you back a new one. Everything
 * the browser draws — where the pea sits, which shells are lifted, the running
 * win/game tally — is decided here, so the exact same rules run in the browser
 * and under Node in `tests.js`.
 *
 * The state is treated as immutable: every mutator returns a fresh object and
 * never edits the one it was given.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api; // Node / tests
  } else {
    root.ShellCore = api; // browser (window.ShellCore)
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_SHELLS = 3;

  // Phases of a single round:
  //   "placing"  — no pea on the board; waiting for the player to choose a shell
  //   "ready"    — pea is hidden, shells are still; waiting to shuffle
  //   "shuffling"— swaps are being applied (the browser animates this window)
  //   "guessing" — shuffle done; the player is clicking to find the pea
  //   "won"      — the pea has been found; round is over
  const PHASES = ["placing", "ready", "shuffling", "guessing", "won"];

  function isInt(n) {
    return typeof n === "number" && Number.isInteger(n);
  }

  /**
   * A fresh game. Stats (games played + wins) live on the state and persist
   * across rounds; everything else is per-round and resets on placePea().
   */
  function createGame(shellCount) {
    const count = shellCount === undefined ? DEFAULT_SHELLS : shellCount;
    if (!isInt(count) || count < 2) {
      throw new Error("shellCount must be an integer >= 2");
    }
    return {
      shellCount: count,
      peaAt: null, // index of the shell hiding the pea, or null while placing
      phase: "placing",
      guesses: 0, // guesses made this round
      revealed: [], // shells lifted this round that were empty (wrong guesses)
      lastGuess: null, // index of the most recent guess, or null
      stats: { games: 0, wins: 0 },
    };
  }

  function assertIndex(state, index) {
    if (!isInt(index) || index < 0 || index >= state.shellCount) {
      throw new Error(
        "shell index " + index + " out of range 0.." + (state.shellCount - 1)
      );
    }
  }

  /**
   * Place the pea under `index` to start a round. Only legal from "placing" or
   * "won" (i.e. between rounds). Bumps the games-played counter — one game
   * begins the moment the pea is hidden, exactly as the spec's bonus asks.
   */
  function placePea(state, index) {
    if (state.phase !== "placing" && state.phase !== "won") {
      throw new Error('placePea is only valid between rounds (phase "' + state.phase + '")');
    }
    assertIndex(state, index);
    return Object.assign({}, state, {
      peaAt: index,
      phase: "ready",
      guesses: 0,
      revealed: [],
      lastGuess: null,
      stats: {
        games: state.stats.games + 1,
        wins: state.stats.wins,
      },
    });
  }

  /**
   * Follow a single swap of two shell positions and report where the pea ends
   * up. Pure arithmetic on the index — the caller owns the pea position.
   */
  function applySwap(peaAt, a, b) {
    if (peaAt === a) return b;
    if (peaAt === b) return a;
    return peaAt;
  }

  /**
   * Build a random sequence of `count` swaps for a board of `shellCount`
   * shells. `rng` is an injectable () => [0,1) source so tests are
   * deterministic; it defaults to Math.random. Each swap is a distinct pair
   * [a, b] with a < b — never a no-op self-swap.
   */
  function generateSwaps(shellCount, count, rng) {
    if (!isInt(shellCount) || shellCount < 2) {
      throw new Error("shellCount must be an integer >= 2");
    }
    if (!isInt(count) || count < 0) {
      throw new Error("count must be a non-negative integer");
    }
    const random = typeof rng === "function" ? rng : Math.random;
    const swaps = [];
    for (let i = 0; i < count; i++) {
      const a = Math.floor(random() * shellCount);
      let b = Math.floor(random() * (shellCount - 1));
      if (b >= a) b += 1; // skip a, so b !== a and every pair is reachable
      swaps.push(a < b ? [a, b] : [b, a]);
    }
    return swaps;
  }

  /**
   * Apply a whole list of swaps at once, moving the pea and switching the round
   * into the guessing phase. The browser uses the same swap list to animate the
   * 5-second shuffle; the engine just needs the final resting place.
   */
  function applySwaps(state, swaps) {
    if (state.phase !== "ready" && state.phase !== "shuffling") {
      throw new Error('shuffle is only valid after the pea is placed (phase "' + state.phase + '")');
    }
    if (!Array.isArray(swaps)) {
      throw new Error("swaps must be an array of [a, b] pairs");
    }
    let peaAt = state.peaAt;
    for (const pair of swaps) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new Error("each swap must be a [a, b] pair");
      }
      assertIndex(state, pair[0]);
      assertIndex(state, pair[1]);
      peaAt = applySwap(peaAt, pair[0], pair[1]);
    }
    return Object.assign({}, state, {
      peaAt: peaAt,
      phase: "guessing",
      guesses: 0,
      revealed: [],
      lastGuess: null,
    });
  }

  /**
   * Mark the round as mid-shuffle. Purely a phase flag so the UI can lock input
   * while the animation plays; the actual pea move happens in applySwaps().
   */
  function beginShuffle(state) {
    if (state.phase !== "ready") {
      throw new Error('beginShuffle is only valid from "ready" (phase "' + state.phase + '")');
    }
    return Object.assign({}, state, { phase: "shuffling" });
  }

  /**
   * The player lifts shell `index`. Returns { state, correct, firstGuess, win }.
   *
   * Scoring, per the spec's bonus rules:
   *   - a *game* was already counted when the pea was placed;
   *   - a *win* is counted only when the FIRST guess of the round is correct.
   * A wrong guess lifts an empty shell (added to `revealed`) and the round
   * continues; a correct guess ends the round in the "won" phase.
   */
  function guess(state, index) {
    if (state.phase !== "guessing") {
      throw new Error('guess is only valid while guessing (phase "' + state.phase + '")');
    }
    assertIndex(state, index);
    if (state.revealed.indexOf(index) !== -1) {
      // Already-lifted empty shell — a harmless repeat, not a new guess.
      return { state: state, correct: false, firstGuess: false, win: false, repeat: true };
    }

    const firstGuess = state.guesses === 0;
    const correct = index === state.peaAt;
    const win = correct && firstGuess;

    const next = Object.assign({}, state, {
      guesses: state.guesses + 1,
      lastGuess: index,
      revealed: correct ? state.revealed.slice() : state.revealed.concat([index]),
      phase: correct ? "won" : "guessing",
      stats: {
        games: state.stats.games,
        wins: state.stats.wins + (win ? 1 : 0),
      },
    });

    return { state: next, correct: correct, firstGuess: firstGuess, win: win, repeat: false };
  }

  /**
   * Ready the board for the next round without touching the running stats.
   * (placePea also accepts a "won" state directly; this is the explicit reset
   * for a UI "New game" button.)
   */
  function nextRound(state) {
    return Object.assign({}, state, {
      peaAt: null,
      phase: "placing",
      guesses: 0,
      revealed: [],
      lastGuess: null,
    });
  }

  /** Win rate as a 0..1 fraction (0 when no games have been played yet). */
  function winRate(state) {
    if (state.stats.games === 0) return 0;
    return state.stats.wins / state.stats.games;
  }

  return {
    DEFAULT_SHELLS: DEFAULT_SHELLS,
    PHASES: PHASES,
    createGame: createGame,
    placePea: placePea,
    applySwap: applySwap,
    generateSwaps: generateSwaps,
    applySwaps: applySwaps,
    beginShuffle: beginShuffle,
    guess: guess,
    nextRound: nextRound,
    winRate: winRate,
  };
});
