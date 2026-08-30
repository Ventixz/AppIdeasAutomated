/*
 * archiver-core.js — the presentation-free engine for the Slack Archiver.
 *
 * Nothing in here touches the DOM, a button, or a real network. It models the
 * whole problem the spec describes:
 *
 *   Slack's free tier purges messages past a 10,000-message limit, so a team
 *   loses its "institutional knowledge". The app should extract channel history
 *   via Slack's `channels.history` API (≈50 messages/minute), storing it in a
 *   database and letting owners export it — running automatically, from the
 *   last message retrieved, with only team owners allowed to drive it.
 *
 * With no Slack workspace and no network available here, the engine ships a
 * faithful *mock* of the pieces it would talk to:
 *
 *   • createMockSlack()   — a stand-in Slack workspace whose `history()` behaves
 *                           like `channels.history`: paginated, oldest-first,
 *                           and hard-capped at the API's rate limit per call.
 *   • createArchive()     — the "database": append-only, de-duplicated by ts,
 *                           remembering the last message pulled per channel.
 *   • ArchiverService     — the owner-gated orchestrator: manage which channels
 *                           are archived, then `tick()` to pull the next page for
 *                           each — exactly "start from the last retrieved
 *                           message" — automatically.
 *   • exportChannel()     — dump an archived channel to a JSON or text file.
 *   • queryArchive()      — the bonus "API for applications to retrieve archived
 *                           messages from the database".
 *
 * A real deployment would swap the mock for the live Slack Web API and a real
 * database, leaving this tested logic untouched. The browser (`script.js`) and
 * the Node suite (`tests.js`) both drive this exact code.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api; // Node / tests
  } else {
    root.ArchiverCore = api; // browser (window.ArchiverCore)
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Slack's documented ceiling for the channels.history extraction the spec
  // targets: ~50 messages per minute. We model one `tick()` as one such call,
  // so no single pull may exceed this many messages.
  const RATE_LIMIT = 50;

  /* ---------------------------------------------------------------------- *
   *  Seeded PRNG — so the mock workspace and the tests are deterministic.
   * ---------------------------------------------------------------------- */

  // Mulberry32: a tiny, well-distributed 32-bit generator. Returns a function
  // yielding a float in [0, 1) on each call.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------------------- *
   *  Timestamps.
   *
   *  Slack identifies each message by a `ts` string like "1610000000.000200"
   *  — seconds since the epoch with a microsecond-ish suffix — and that ts is
   *  both the sort key and the primary key. We generate and compare them the
   *  same way so ordering and de-duplication behave like the real thing.
   * ---------------------------------------------------------------------- */

  const BASE_EPOCH = 1610000000; // 2021-01-07, an arbitrary but fixed origin

  function makeTs(index) {
    // One message every ~90 simulated seconds, with a unique suffix so no two
    // messages ever collide even within the same second.
    const seconds = BASE_EPOCH + index * 90;
    const suffix = String(index % 1000000).padStart(6, "0");
    return seconds + "." + suffix;
  }

  // Numeric comparison of two Slack ts strings (a < b → negative).
  function compareTs(a, b) {
    return parseFloat(a) - parseFloat(b);
  }

  /* ---------------------------------------------------------------------- *
   *  Mock Slack workspace.
   * ---------------------------------------------------------------------- */

  const AUTHORS = [
    "grace",
    "ada",
    "linus",
    "margaret",
    "dennis",
    "barbara",
    "alan",
    "radia",
  ];

  const SNIPPETS = [
    "shipped the fix, deploying now",
    "can someone review my PR?",
    "standup in 5",
    "the build is green again",
    "who owns the billing service?",
    "great work on the launch team",
    "I'll take the on-call this week",
    "docs are updated, link in the thread",
    "found the root cause, it was a cache key",
    "lunch? there's tacos downstairs",
    "reminder: retro is Friday",
    "the demo went really well",
    "rolling back, something looks off",
    "welcome to the channel!",
    "postmortem doc is ready for comments",
    "nice, tests are passing locally",
  ];

  // Build a deterministic workspace. `config`:
  //   channels           — [{ id, name }]
  //   messagesPerChannel — how many historical messages each channel holds
  //   seed               — PRNG seed (author/text choices)
  //
  // Returns an object exposing the workspace's channels and a `history()`
  // method shaped like Slack's channels.history endpoint.
  function createMockSlack(config) {
    config = config || {};
    const channels = (config.channels || []).map(function (c) {
      return { id: c.id, name: c.name };
    });
    const perChannel =
      config.messagesPerChannel == null ? 120 : config.messagesPerChannel;
    const rand = mulberry32(config.seed == null ? 1 : config.seed);

    // Pre-generate every channel's full history once, oldest-first.
    const store = {};
    channels.forEach(function (ch, cIdx) {
      const msgs = [];
      for (let i = 0; i < perChannel; i++) {
        // Offset the ts sequence per channel so channels don't share ts values.
        const globalIndex = cIdx * 1000000 + i;
        const author = AUTHORS[Math.floor(rand() * AUTHORS.length)];
        const text = SNIPPETS[Math.floor(rand() * SNIPPETS.length)];
        msgs.push({ ts: makeTs(globalIndex), user: author, text: text });
      }
      store[ch.id] = msgs;
    });

    // Slack-style history read. Options:
    //   oldest — only return messages strictly newer than this ts (the cursor)
    //   limit  — page size requested; silently clamped to the rate limit
    // Always oldest-first, never more than RATE_LIMIT messages.
    function history(channelId, opts) {
      opts = opts || {};
      const all = store[channelId];
      if (!all) throw new Error("channel_not_found: " + channelId);

      const oldest = opts.oldest || null;
      const limit = Math.min(
        opts.limit == null ? RATE_LIMIT : opts.limit,
        RATE_LIMIT
      );

      const page = [];
      for (let i = 0; i < all.length && page.length < limit; i++) {
        if (oldest === null || compareTs(all[i].ts, oldest) > 0) {
          page.push(all[i]);
        }
      }
      // has_more mirrors Slack's paging flag: is there anything past this page?
      const last = page.length ? page[page.length - 1].ts : oldest;
      let hasMore = false;
      for (let i = 0; i < all.length; i++) {
        if (last !== null && compareTs(all[i].ts, last) > 0) {
          hasMore = true;
          break;
        }
      }
      return { messages: page, has_more: hasMore };
    }

    function totalMessages(channelId) {
      return (store[channelId] || []).length;
    }

    return {
      channels: channels,
      history: history,
      totalMessages: totalMessages,
      RATE_LIMIT: RATE_LIMIT,
    };
  }

  /* ---------------------------------------------------------------------- *
   *  The archive "database".
   *
   *  Append-only and de-duplicated by ts. It remembers each channel's cursor
   *  (`lastTs`) so periodic extraction always resumes from the last message it
   *  retrieved — never re-pulling the whole history.
   * ---------------------------------------------------------------------- */

  function createArchive() {
    // channels: id -> { messages: [ordered], lastTs, byTs: Set }
    return { channels: {} };
  }

  function channelBucket(archive, channelId) {
    if (!archive.channels[channelId]) {
      archive.channels[channelId] = {
        messages: [],
        lastTs: null,
        byTs: {},
      };
    }
    return archive.channels[channelId];
  }

  // Append a page of messages to a channel, ignoring any ts already stored.
  // Returns the number of genuinely new messages written.
  function ingest(archive, channelId, messages) {
    const bucket = channelBucket(archive, channelId);
    let added = 0;
    messages.forEach(function (m) {
      if (bucket.byTs[m.ts]) return; // de-dupe: already archived
      bucket.byTs[m.ts] = true;
      bucket.messages.push({ ts: m.ts, user: m.user, text: m.text });
      added++;
    });
    // Keep the store ordered oldest-first and advance the cursor.
    bucket.messages.sort(function (a, b) {
      return compareTs(a.ts, b.ts);
    });
    if (bucket.messages.length) {
      bucket.lastTs = bucket.messages[bucket.messages.length - 1].ts;
    }
    return added;
  }

  function lastTs(archive, channelId) {
    const bucket = archive.channels[channelId];
    return bucket ? bucket.lastTs : null;
  }

  function archivedCount(archive, channelId) {
    const bucket = archive.channels[channelId];
    return bucket ? bucket.messages.length : 0;
  }

  function archivedChannels(archive) {
    return Object.keys(archive.channels);
  }

  /* ---------------------------------------------------------------------- *
   *  Access control — only Team owners may drive archiving.
   * ---------------------------------------------------------------------- */

  function canArchive(user) {
    return Boolean(user) && user.role === "owner";
  }

  function requireOwner(user, action) {
    if (!canArchive(user)) {
      throw new Error(
        "not_authorized: only a Team owner may " + (action || "do that") + "."
      );
    }
  }

  /* ---------------------------------------------------------------------- *
   *  Archiver service — the owner-gated orchestrator.
   *
   *  Holds the set of subscribed channels and pulls the next page for each on
   *  every tick. Channel management and starting/stopping are owner-only;
   *  the tick itself is what a scheduler would call automatically.
   * ---------------------------------------------------------------------- */

  function createArchiverService(opts) {
    const slack = opts.slack;
    const archive = opts.archive || createArchive();
    const subscriptions = {}; // channelId -> true
    let running = false;

    function isSubscribed(channelId) {
      return Boolean(subscriptions[channelId]);
    }

    function subscribedChannels() {
      return Object.keys(subscriptions);
    }

    // Owner adds a channel to the archive set. Validates the channel exists.
    function addChannel(user, channelId) {
      requireOwner(user, "add channels");
      const known = slack.channels.some(function (c) {
        return c.id === channelId;
      });
      if (!known) throw new Error("channel_not_found: " + channelId);
      subscriptions[channelId] = true;
      return subscribedChannels();
    }

    function removeChannel(user, channelId) {
      requireOwner(user, "remove channels");
      delete subscriptions[channelId];
      return subscribedChannels();
    }

    function start(user) {
      requireOwner(user, "start archiving");
      running = true;
      return running;
    }

    function stop(user) {
      requireOwner(user, "stop archiving");
      running = false;
      return running;
    }

    function isRunning() {
      return running;
    }

    // One extraction pass: for every subscribed channel, pull the next page
    // (starting from the archive's cursor) and ingest it. Returns a per-channel
    // report of how many new messages landed. Callable directly (a scheduler
    // "tick") but no-ops unless archiving has been started.
    function tick() {
      const report = {};
      if (!running) return report;
      subscribedChannels().forEach(function (channelId) {
        const cursor = lastTs(archive, channelId);
        const res = slack.history(channelId, {
          oldest: cursor,
          limit: RATE_LIMIT,
        });
        const added = ingest(archive, channelId, res.messages);
        report[channelId] = {
          added: added,
          hasMore: res.has_more,
          total: archivedCount(archive, channelId),
        };
      });
      return report;
    }

    return {
      archive: archive,
      addChannel: addChannel,
      removeChannel: removeChannel,
      isSubscribed: isSubscribed,
      subscribedChannels: subscribedChannels,
      start: start,
      stop: stop,
      isRunning: isRunning,
      tick: tick,
    };
  }

  /* ---------------------------------------------------------------------- *
   *  Export — write an archived channel to a file payload.
   * ---------------------------------------------------------------------- */

  function exportChannel(archive, channelId, format) {
    const bucket = archive.channels[channelId];
    const messages = bucket ? bucket.messages : [];
    if (format === "text") {
      return messages
        .map(function (m) {
          return "[" + m.ts + "] " + m.user + ": " + m.text;
        })
        .join("\n");
    }
    // Default: JSON, pretty-printed, shaped like an export a downstream tool
    // could re-import.
    return JSON.stringify(
      { channel: channelId, count: messages.length, messages: messages },
      null,
      2
    );
  }

  /* ---------------------------------------------------------------------- *
   *  Retrieval API (bonus) — "an API for applications to retrieve archived
   *  messages from the database."
   * ---------------------------------------------------------------------- */

  // Query one channel's archive. Options (all optional):
  //   text  — case-insensitive substring the message must contain
  //   user  — exact author to filter to
  //   since — only messages strictly newer than this ts
  //   limit — cap the number of results (newest-first)
  // Returns newest-first, since retrieval usually wants the latest first.
  function queryArchive(archive, channelId, options) {
    options = options || {};
    const bucket = archive.channels[channelId];
    if (!bucket) return [];

    let rows = bucket.messages.slice();

    if (options.since) {
      rows = rows.filter(function (m) {
        return compareTs(m.ts, options.since) > 0;
      });
    }
    if (options.user) {
      rows = rows.filter(function (m) {
        return m.user === options.user;
      });
    }
    if (options.text) {
      const needle = String(options.text).toLowerCase();
      rows = rows.filter(function (m) {
        return m.text.toLowerCase().indexOf(needle) !== -1;
      });
    }

    // Newest-first for retrieval.
    rows.sort(function (a, b) {
      return compareTs(b.ts, a.ts);
    });

    if (options.limit != null) {
      rows = rows.slice(0, options.limit);
    }
    return rows;
  }

  /* ---------------------------------------------------------------------- *
   *  Serialization — persist / restore the archive to the browser's database.
   * ---------------------------------------------------------------------- */

  function serialize(archive) {
    const out = { channels: {} };
    Object.keys(archive.channels).forEach(function (id) {
      out.channels[id] = {
        messages: archive.channels[id].messages,
        lastTs: archive.channels[id].lastTs,
      };
    });
    return JSON.stringify(out);
  }

  // Rebuild an archive from serialized text. Corrupt or partial data recovers
  // to as much as can be salvaged rather than throwing.
  function deserialize(text) {
    const archive = createArchive();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return archive;
    }
    if (!parsed || typeof parsed !== "object" || !parsed.channels) {
      return archive;
    }
    Object.keys(parsed.channels).forEach(function (id) {
      const src = parsed.channels[id];
      if (!src || !Array.isArray(src.messages)) return;
      const clean = src.messages.filter(function (m) {
        return m && typeof m.ts === "string" && typeof m.text === "string";
      });
      ingest(archive, id, clean);
    });
    return archive;
  }

  return {
    RATE_LIMIT: RATE_LIMIT,
    mulberry32: mulberry32,
    makeTs: makeTs,
    compareTs: compareTs,
    createMockSlack: createMockSlack,
    createArchive: createArchive,
    ingest: ingest,
    lastTs: lastTs,
    archivedCount: archivedCount,
    archivedChannels: archivedChannels,
    canArchive: canArchive,
    requireOwner: requireOwner,
    createArchiverService: createArchiverService,
    exportChannel: exportChannel,
    queryArchive: queryArchive,
    serialize: serialize,
    deserialize: deserialize,
  };
});
