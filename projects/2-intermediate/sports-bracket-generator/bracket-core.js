/*
 * bracket-core.js — pure, dependency-free tournament-bracket logic.
 *
 * No DOM, no globals, no Math.random(). Everything is a pure function that
 * takes data in and returns new data out, which is what makes it testable in
 * Node and reusable in the browser. script.js does all the wiring.
 *
 * A bracket is a single-elimination tree represented as an array of rounds,
 * each round an array of matches:
 *
 *   match = {
 *     id,            // stable string id, e.g. "r0m2"
 *     round,         // 0-based round index
 *     index,         // 0-based match index within the round
 *     a, b,          // the two slots (participants)
 *     winner,        // 'a' | 'b' | null
 *     date,          // ISO date string for this match, or '' (bonus)
 *     scoreA, scoreB // per-match scores, or '' (bonus)
 *   }
 *
 *   slot = {
 *     type,  // 'team' | 'bye' | 'tbd'
 *     seed,  // 1-based seed for a real team, else null
 *     name   // display name for a team, else ''
 *   }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; // Node / Jest
  } else {
    root.BracketCore = api; // browser global
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- validation -------------------------------------------------------

  // Parse a yyyy-mm-dd string into a UTC timestamp, or null if malformed.
  function parseISODate(str) {
    if (typeof str !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const ts = Date.UTC(year, month - 1, day);
    const d = new Date(ts);
    // Reject rolled-over dates like 2026-02-31.
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) {
      return null;
    }
    return ts;
  }

  // Validate a start/end date range. Returns { valid, message }.
  function validateDateRange(startStr, endStr) {
    const start = parseISODate(startStr);
    const end = parseISODate(endStr);
    if (start === null && end === null) {
      return { valid: false, message: 'Enter a valid start and end date.' };
    }
    if (start === null) return { valid: false, message: 'Start date is not a valid date.' };
    if (end === null) return { valid: false, message: 'End date is not a valid date.' };
    if (end < start) {
      return { valid: false, message: 'End date is before the start date.' };
    }
    return { valid: true, message: '' };
  }

  // Warn about a team count that can't seed a clean bracket. Returns a
  // string to show the user, or null when the count is fine.
  function teamCountWarning(n) {
    if (!Number.isInteger(n)) return 'Number of teams must be a whole number.';
    if (n < 2) return 'A tournament needs at least 2 teams.';
    if (n % 2 !== 0) {
      return 'Odd number of teams — one team gets a first-round bye.';
    }
    return null;
  }

  // ---- seeding ----------------------------------------------------------

  const isPowerOfTwo = (n) => n >= 1 && (n & (n - 1)) === 0;

  // Smallest power of two >= n.
  function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  // Standard tournament seed order for a bracket of `size` slots (size must
  // be a power of two). Position i holds the returned seed number, arranged
  // so the top seed and bottom seed sit at opposite ends and byes (seeds
  // greater than the real team count) land next to the strongest seeds.
  function seedOrder(size) {
    let seeds = [1];
    while (seeds.length < size) {
      const sum = seeds.length * 2 + 1;
      const next = [];
      for (const s of seeds) {
        next.push(s);
        next.push(sum - s);
      }
      seeds = next;
    }
    return seeds;
  }

  // ---- building ---------------------------------------------------------

  function teamSlot(seed, name) {
    return { type: 'team', seed, name: name || ('Team ' + seed) };
  }
  const byeSlot = () => ({ type: 'bye', seed: null, name: 'Bye' });
  const tbdSlot = () => ({ type: 'tbd', seed: null, name: 'TBD' });

  // Build a full single-elimination bracket.
  //   opts.numTeams   — integer >= 2
  //   opts.teamNames  — optional array of names indexed by seed-1
  // Non power-of-two counts get byes; a team facing a bye auto-advances so
  // round two shows the real matchup rather than a phantom TBD.
  function buildBracket(opts) {
    const numTeams = opts && opts.numTeams;
    const names = (opts && opts.teamNames) || [];
    if (!Number.isInteger(numTeams) || numTeams < 2) {
      throw new Error('numTeams must be an integer >= 2');
    }

    const size = nextPowerOfTwo(numTeams);
    const order = seedOrder(size);
    const totalRounds = Math.log2(size);

    // Round 0 slots come straight from the seed order; a seed above the real
    // team count is a bye.
    const firstSlots = order.map((seed) =>
      seed <= numTeams ? teamSlot(seed, names[seed - 1]) : byeSlot()
    );

    const rounds = [];
    for (let r = 0; r < totalRounds; r++) {
      const matchCount = size / Math.pow(2, r + 1);
      const round = [];
      for (let i = 0; i < matchCount; i++) {
        round.push({
          id: 'r' + r + 'm' + i,
          round: r,
          index: i,
          a: r === 0 ? firstSlots[i * 2] : tbdSlot(),
          b: r === 0 ? firstSlots[i * 2 + 1] : tbdSlot(),
          winner: null,
          date: '',
          scoreA: '',
          scoreB: '',
        });
      }
      rounds.push(round);
    }

    let bracket = { numTeams, size, totalRounds, rounds };

    // Resolve byes: if exactly one side of a first-round match is a bye, the
    // other side wins automatically and advances.
    for (let i = 0; i < rounds[0].length; i++) {
      const m = rounds[0][i];
      const aBye = m.a.type === 'bye';
      const bBye = m.b.type === 'bye';
      if (aBye !== bBye) {
        bracket = setWinner(bracket, 0, i, aBye ? 'b' : 'a');
      }
    }
    return bracket;
  }

  // ---- advancing --------------------------------------------------------

  // Return a deep-ish clone so setWinner stays pure.
  function cloneBracket(bracket) {
    return {
      numTeams: bracket.numTeams,
      size: bracket.size,
      totalRounds: bracket.totalRounds,
      rounds: bracket.rounds.map((round) =>
        round.map((m) => ({
          ...m,
          a: { ...m.a },
          b: { ...m.b },
        }))
      ),
    };
  }

  // The slot a match's winner flows into: match i of round r feeds slot
  // (i % 2 === 0 ? 'a' : 'b') of match floor(i/2) in round r+1.
  function nextSlotFor(round, index) {
    return {
      round: round + 1,
      index: Math.floor(index / 2),
      side: index % 2 === 0 ? 'a' : 'b',
    };
  }

  // Record the winner of a match and propagate them forward. If the match
  // already had a different winner, any stale downstream advancement is
  // cleared first so the tree stays consistent. Returns a NEW bracket.
  function setWinner(bracket, roundIndex, matchIndex, side) {
    if (side !== 'a' && side !== 'b') {
      throw new Error("side must be 'a' or 'b'");
    }
    const next = cloneBracket(bracket);
    const match = next.rounds[roundIndex][matchIndex];
    const chosen = side === 'a' ? match.a : match.b;
    if (chosen.type === 'bye' || chosen.type === 'tbd') {
      throw new Error('cannot advance an empty slot');
    }

    // Clear the old winner's trail before writing the new one.
    if (match.winner && match.winner !== side) {
      clearDownstream(next, roundIndex, matchIndex);
    }
    match.winner = side;

    if (roundIndex + 1 < next.totalRounds) {
      const dest = nextSlotFor(roundIndex, matchIndex);
      const target = next.rounds[dest.round][dest.index];
      target[dest.side] = { ...chosen };
    }
    return next;
  }

  // Wipe the participant this match previously fed forward, recursively, so
  // changing an earlier result doesn't leave a ghost deeper in the bracket.
  function clearDownstream(bracket, roundIndex, matchIndex) {
    if (roundIndex + 1 >= bracket.totalRounds) return;
    const dest = nextSlotFor(roundIndex, matchIndex);
    const target = bracket.rounds[dest.round][dest.index];
    // If the winner we're about to overwrite had advanced and then also won
    // downstream, clear that deeper trail first.
    if (target.winner === dest.side) {
      clearDownstream(bracket, dest.round, dest.index);
      target.winner = null;
    }
    target[dest.side] = tbdSlot();
  }

  // The tournament champion, or null if the final hasn't been decided.
  function champion(bracket) {
    const finalRound = bracket.rounds[bracket.totalRounds - 1];
    if (!finalRound || finalRound.length !== 1) return null;
    const f = finalRound[0];
    if (!f.winner) return null;
    return f.winner === 'a' ? f.a : f.b;
  }

  // Human-friendly round name, counting back from the final.
  function roundName(roundIndex, totalRounds) {
    const fromEnd = totalRounds - roundIndex;
    if (fromEnd === 1) return 'Final';
    if (fromEnd === 2) return 'Semifinals';
    if (fromEnd === 3) return 'Quarterfinals';
    const teams = Math.pow(2, fromEnd);
    return 'Round of ' + teams;
  }

  return {
    parseISODate,
    validateDateRange,
    teamCountWarning,
    isPowerOfTwo,
    nextPowerOfTwo,
    seedOrder,
    buildBracket,
    setWinner,
    champion,
    roundName,
  };
});
