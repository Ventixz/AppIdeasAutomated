// kudos-core.js — the presentation-free engine for the Kudos Slackbot app.
//
// It knows nothing about the DOM, Slack, or the network. It owns a small store
// of "kudos" (public recognitions of a teammate's effort) and a parser for the
// `/kudo` slash command, and it turns each command into a reply the UI can
// render. The store's clock and id counter are *injected*, so every command is
// fully deterministic and the same code runs in the browser and in Node (for
// the test suite).
//
// Commands (mirrors the app-ideas spec):
//   /kudo add <@user> <text>       — recognize a teammate
//   /kudo replace <kudo-id> <text> — reword an existing kudo (giver only)
//   /kudo delete <kudo-id>         — remove a kudo (giver only)
//   /kudo list [n|*]               — the latest n kudos (default 5, `*` = all)
//   /kudo user <@user>             — every kudo a person has received
//   /kudo top [n]                  — leaderboard by kudos received (bonus)
//   /kudo help                     — usage

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  else root.KudosCore = api;                                             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_LIST = 5;
  const DEFAULT_TOP = 5;

  // ---------------------------------------------------------------------------
  // Slack ids. In Slack a user reference looks like `<@U012ABC>` or a person
  // types `@grace`. We accept either and normalize to a bare handle so the
  // store has one canonical key per person.
  // ---------------------------------------------------------------------------
  function normalizeUser(raw) {
    if (raw == null) return '';
    let s = String(raw).trim();
    // Slack's mention encoding: <@U123|grace> or <@U123>
    const m = s.match(/^<@([^|>]+)(?:\|[^>]*)?>$/);
    if (m) s = m[1];
    if (s[0] === '@') s = s.slice(1);
    return s.toLowerCase();
  }

  function isValidUser(raw) {
    const u = normalizeUser(raw);
    return /^[a-z0-9][a-z0-9._-]{0,38}$/.test(u);
  }

  function mention(user) {
    return '@' + user;
  }

  // ---------------------------------------------------------------------------
  // The store. A thin wrapper around an array of kudo records:
  //   { id, to, from, text, at }
  // `seq` yields the next numeric id; `now` yields the current epoch ms. Both
  // are injected so tests stay deterministic.
  // ---------------------------------------------------------------------------
  function createStore(opts) {
    opts = opts || {};
    let counter = 0;
    const seq = opts.seq || (() => (counter += 1));
    const now = opts.now || (() => 0);
    const kudos = [];

    function idFor(n) {
      return 'k' + n;
    }

    return {
      // Raw access, mostly for the UI and tests.
      all() {
        return kudos.slice();
      },
      get(id) {
        return kudos.find((k) => k.id === id) || null;
      },
      size() {
        return kudos.length;
      },

      // Create a kudo. `from` is the person running the command.
      add(from, toRaw, text) {
        const id = idFor(seq());
        const rec = {
          id,
          to: normalizeUser(toRaw),
          from: normalizeUser(from),
          text: String(text),
          at: now(),
        };
        kudos.push(rec);
        return rec;
      },

      // Reword an existing kudo. Only its author may change it.
      replace(from, id, text) {
        const rec = kudos.find((k) => k.id === id);
        if (!rec) return { ok: false, code: 'not-found' };
        if (rec.from !== normalizeUser(from)) return { ok: false, code: 'forbidden', rec };
        rec.text = String(text);
        return { ok: true, rec };
      },

      // Delete a kudo. Only its author may remove it.
      remove(from, id) {
        const i = kudos.findIndex((k) => k.id === id);
        if (i === -1) return { ok: false, code: 'not-found' };
        const rec = kudos[i];
        if (rec.from !== normalizeUser(from)) return { ok: false, code: 'forbidden', rec };
        kudos.splice(i, 1);
        return { ok: true, rec };
      },

      // The latest `n` kudos, newest first. `n === Infinity` returns all.
      latest(n) {
        const list = kudos.slice().reverse();
        return n === Infinity ? list : list.slice(0, Math.max(0, n));
      },

      // Every kudo a person has received, newest first.
      forUser(userRaw) {
        const u = normalizeUser(userRaw);
        return kudos.filter((k) => k.to === u).reverse();
      },

      // Leaderboard: [{ user, count }] by kudos received, descending. Ties
      // break alphabetically so the ordering is stable.
      leaderboard(n) {
        const counts = new Map();
        for (const k of kudos) counts.set(k.to, (counts.get(k.to) || 0) + 1);
        const rows = Array.from(counts, ([user, count]) => ({ user, count }));
        rows.sort((a, b) => b.count - a.count || (a.user < b.user ? -1 : a.user > b.user ? 1 : 0));
        return n === Infinity ? rows : rows.slice(0, Math.max(0, n));
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Command parsing. We split `/kudo <sub> <rest...>` into a small structured
  // object, without touching the store. This keeps parse errors (bad counts,
  // unknown sub-commands) separate from execution.
  // ---------------------------------------------------------------------------
  function parseCount(token, fallback) {
    if (token == null || token === '') return { ok: true, value: fallback };
    if (token === '*') return { ok: true, value: Infinity };
    if (!/^\d+$/.test(token)) return { ok: false };
    return { ok: true, value: parseInt(token, 10) };
  }

  function parseCommand(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (text === '') return { ok: false, code: 'empty' };

    // Tolerate both "/kudo add ..." and a bare "add ..." (Slack strips the
    // leading "/kudo" before it reaches a handler; the demo keeps it).
    let body = text;
    const lead = body.match(/^\/kudos?\b\s*/i);
    if (lead) body = body.slice(lead[0].length);
    body = body.trim();
    if (body === '') return { ok: true, sub: 'help' };

    const sp = body.indexOf(' ');
    const sub = (sp === -1 ? body : body.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? '' : body.slice(sp + 1).trim();

    switch (sub) {
      case 'add': {
        const s = rest.indexOf(' ');
        if (s === -1) return { ok: false, code: 'add-usage' };
        const to = rest.slice(0, s).trim();
        const body2 = rest.slice(s + 1).trim();
        if (!isValidUser(to)) return { ok: false, code: 'bad-user', token: to };
        if (body2 === '') return { ok: false, code: 'add-usage' };
        return { ok: true, sub, to, text: body2 };
      }
      case 'replace': {
        const s = rest.indexOf(' ');
        if (s === -1) return { ok: false, code: 'replace-usage' };
        const id = rest.slice(0, s).trim();
        const body2 = rest.slice(s + 1).trim();
        if (body2 === '') return { ok: false, code: 'replace-usage' };
        return { ok: true, sub, id, text: body2 };
      }
      case 'delete':
      case 'remove': {
        if (rest === '') return { ok: false, code: 'delete-usage' };
        return { ok: true, sub: 'delete', id: rest.split(/\s+/)[0] };
      }
      case 'list': {
        const c = parseCount(rest.split(/\s+/)[0], DEFAULT_LIST);
        if (!c.ok) return { ok: false, code: 'bad-count', token: rest };
        return { ok: true, sub, n: c.value };
      }
      case 'user': {
        const token = rest.split(/\s+/)[0];
        if (!isValidUser(token)) return { ok: false, code: 'bad-user', token };
        return { ok: true, sub, user: token };
      }
      case 'top': {
        const c = parseCount(rest.split(/\s+/)[0], DEFAULT_TOP);
        if (!c.ok) return { ok: false, code: 'bad-count', token: rest };
        return { ok: true, sub, n: c.value };
      }
      case 'help':
        return { ok: true, sub: 'help' };
      default:
        return { ok: false, code: 'unknown-sub', token: sub };
    }
  }

  // ---------------------------------------------------------------------------
  // Reply formatting. Each command produces a `{ type, text, data }` reply the
  // UI renders. `type` lets the UI style errors, tables, and notices; `text` is
  // a plain-text fallback (also what a real Slack bot would post).
  // ---------------------------------------------------------------------------
  const USAGE = [
    '*Kudos* — recognize your teammates, and keep it from scrolling away.',
    '• `/kudo add @user <message>` — give a kudo',
    '• `/kudo replace <id> <message>` — reword one of yours',
    '• `/kudo delete <id>` — remove one of yours',
    '• `/kudo list [n|*]` — the latest n kudos (default 5)',
    '• `/kudo user @user` — every kudo someone has received',
    '• `/kudo top [n]` — the leaderboard',
  ].join('\n');

  function errText(err) {
    switch (err.code) {
      case 'empty': return 'Type a command, e.g. `/kudo add @grace shipped the release`.';
      case 'add-usage': return 'Usage: `/kudo add @user <message>`';
      case 'replace-usage': return 'Usage: `/kudo replace <kudo-id> <message>`';
      case 'delete-usage': return 'Usage: `/kudo delete <kudo-id>`';
      case 'bad-user': return `"${err.token || ''}" doesn't look like a Slack user. Try \`@grace\`.`;
      case 'bad-count': return `"${String(err.token || '').trim()}" isn't a number. Use a count like \`5\` or \`*\` for all.`;
      case 'unknown-sub': return `Unknown command "${err.token}". Try \`/kudo help\`.`;
      default: return 'Sorry, I did not understand that. Try `/kudo help`.';
    }
  }

  // Execute a raw command string against a store as user `from`.
  function handleCommand(store, raw, from) {
    const cmd = parseCommand(raw);
    if (!cmd.ok) return { type: 'error', text: errText(cmd), data: cmd };

    switch (cmd.sub) {
      case 'help':
        return { type: 'help', text: USAGE };

      case 'add': {
        const rec = store.add(from, cmd.to, cmd.text);
        return {
          type: 'kudo',
          text: `Kudo *${rec.id}* recorded: ${mention(rec.from)} → ${mention(rec.to)} — "${rec.text}"`,
          data: rec,
        };
      }

      case 'replace': {
        const r = store.replace(from, cmd.id, cmd.text);
        if (!r.ok && r.code === 'not-found') {
          return { type: 'error', text: `No kudo with id \`${cmd.id}\`.`, data: r };
        }
        if (!r.ok && r.code === 'forbidden') {
          return { type: 'error', text: `Only ${mention(r.rec.from)} can change kudo \`${cmd.id}\`.`, data: r };
        }
        return { type: 'kudo', text: `Kudo *${r.rec.id}* updated: "${r.rec.text}"`, data: r.rec };
      }

      case 'delete': {
        const r = store.remove(from, cmd.id);
        if (!r.ok && r.code === 'not-found') {
          return { type: 'error', text: `No kudo with id \`${cmd.id}\`.`, data: r };
        }
        if (!r.ok && r.code === 'forbidden') {
          return { type: 'error', text: `Only ${mention(r.rec.from)} can delete kudo \`${cmd.id}\`.`, data: r };
        }
        return { type: 'notice', text: `Kudo *${cmd.id}* deleted.`, data: r.rec };
      }

      case 'list': {
        const list = store.latest(cmd.n);
        if (list.length === 0) return { type: 'notice', text: 'No kudos yet. Be the first: `/kudo add @user <message>`.' };
        const head = cmd.n === Infinity ? `All ${list.length} kudos` : `Latest ${list.length} kudos`;
        return { type: 'list', text: head + ':\n' + list.map(kudoLine).join('\n'), data: list };
      }

      case 'user': {
        const list = store.forUser(cmd.user);
        const who = mention(normalizeUser(cmd.user));
        if (list.length === 0) return { type: 'notice', text: `${who} has no kudos yet.` };
        return {
          type: 'list',
          text: `${who} has ${list.length} kudo${list.length === 1 ? '' : 's'}:\n` + list.map(kudoLine).join('\n'),
          data: list,
        };
      }

      case 'top': {
        const rows = store.leaderboard(cmd.n);
        if (rows.length === 0) return { type: 'notice', text: 'No kudos yet — nobody is on the board.' };
        const lines = rows.map((r, i) => `${i + 1}. ${mention(r.user)} — ${r.count} kudo${r.count === 1 ? '' : 's'}`);
        return { type: 'top', text: '*Kudos leaderboard*\n' + lines.join('\n'), data: rows };
      }

      default:
        return { type: 'error', text: errText({ code: 'unknown-sub', token: cmd.sub }) };
    }
  }

  function kudoLine(k) {
    return `• \`${k.id}\` ${mention(k.to)} ← ${mention(k.from)}: "${k.text}"`;
  }

  return {
    DEFAULT_LIST,
    DEFAULT_TOP,
    normalizeUser,
    isValidUser,
    mention,
    createStore,
    parseCommand,
    parseCount,
    handleCommand,
    kudoLine,
    USAGE,
  };
});
