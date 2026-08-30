/*
 * tests.js — a dependency-free test suite for the Slack Archiver engine.
 *
 *   node tests.js
 *
 * Drives the same archiver-core.js the browser uses. The mock Slack workspace
 * is seeded, so every message, page boundary and count is exact — nothing here
 * is flaky.
 */

const C = require("./archiver-core.js");

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

function eq(a, b, msg) {
  ok(
    a === b,
    msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"
  );
}

function throws(fn, matcher, msg) {
  let threw = null;
  try {
    fn();
  } catch (e) {
    threw = e;
  }
  ok(threw !== null && (!matcher || threw.message.indexOf(matcher) !== -1), msg);
}

// A workspace used by many tests: two channels, small histories.
function makeWorkspace(perChannel) {
  return C.createMockSlack({
    channels: [
      { id: "C1", name: "general" },
      { id: "C2", name: "random" },
    ],
    messagesPerChannel: perChannel == null ? 120 : perChannel,
    seed: 42,
  });
}

const OWNER = { id: "U_owner", name: "grace", role: "owner" };
const MEMBER = { id: "U_member", name: "ada", role: "member" };

/* --- Timestamps ---------------------------------------------------------- */

(function tsOrdering() {
  const a = C.makeTs(0);
  const b = C.makeTs(1);
  const c = C.makeTs(100);
  ok(C.compareTs(a, b) < 0, "earlier index yields an earlier ts");
  ok(C.compareTs(c, a) > 0, "later index yields a later ts");
  eq(C.compareTs(a, a), 0, "a ts compares equal to itself");
})();

/* --- Mock Slack behaves like channels.history ---------------------------- */

(function historyIsRateLimited() {
  const slack = makeWorkspace(120);
  const page = slack.history("C1", { oldest: null, limit: 1000 });
  eq(
    page.messages.length,
    C.RATE_LIMIT,
    "a single history call never exceeds the rate limit"
  );
  eq(page.has_more, true, "has_more is set when messages remain");
})();

(function historyIsDeterministic() {
  const a = makeWorkspace(10).history("C1", {});
  const b = makeWorkspace(10).history("C1", {});
  eq(
    JSON.stringify(a.messages),
    JSON.stringify(b.messages),
    "same seed → identical history"
  );
})();

(function historyResumesFromCursor() {
  const slack = makeWorkspace(120);
  const first = slack.history("C1", { oldest: null });
  const cursor = first.messages[first.messages.length - 1].ts;
  const second = slack.history("C1", { oldest: cursor });
  ok(
    C.compareTs(second.messages[0].ts, cursor) > 0,
    "the next page starts strictly after the cursor"
  );
  // No overlap between the two pages.
  const firstTs = new Set(
    first.messages.map(function (m) {
      return m.ts;
    })
  );
  const overlap = second.messages.some(function (m) {
    return firstTs.has(m.ts);
  });
  ok(!overlap, "consecutive pages never overlap");
})();

(function unknownChannelThrows() {
  const slack = makeWorkspace(10);
  throws(
    function () {
      slack.history("nope", {});
    },
    "channel_not_found",
    "history on an unknown channel throws"
  );
})();

/* --- Archive: append-only, de-duplicated, cursor-tracking ---------------- */

(function ingestDeduplicates() {
  const archive = C.createArchive();
  const msgs = [
    { ts: "100.000000", user: "a", text: "hi" },
    { ts: "200.000000", user: "b", text: "yo" },
  ];
  eq(C.ingest(archive, "C1", msgs), 2, "first ingest writes both messages");
  eq(
    C.ingest(archive, "C1", msgs),
    0,
    "re-ingesting the same messages adds nothing"
  );
  eq(C.archivedCount(archive, "C1"), 2, "archive holds two messages");
  eq(C.lastTs(archive, "C1"), "200.000000", "cursor is the newest ts");
})();

(function ingestKeepsOrder() {
  const archive = C.createArchive();
  C.ingest(archive, "C1", [{ ts: "300.000000", user: "a", text: "z" }]);
  C.ingest(archive, "C1", [{ ts: "100.000000", user: "a", text: "a" }]);
  const msgs = archive.channels.C1.messages;
  ok(
    C.compareTs(msgs[0].ts, msgs[1].ts) < 0,
    "archive stays ordered oldest-first even if pages arrive out of order"
  );
  eq(C.lastTs(archive, "C1"), "300.000000", "cursor tracks the newest ts");
})();

/* --- Access control: owners only ----------------------------------------- */

(function ownerGate() {
  eq(C.canArchive(OWNER), true, "owner can archive");
  eq(C.canArchive(MEMBER), false, "member cannot archive");
  eq(C.canArchive(null), false, "a missing user cannot archive");
})();

(function serviceRejectsNonOwners() {
  const slack = makeWorkspace(60);
  const svc = C.createArchiverService({ slack: slack });
  throws(
    function () {
      svc.addChannel(MEMBER, "C1");
    },
    "not_authorized",
    "a member cannot add a channel"
  );
  throws(
    function () {
      svc.start(MEMBER);
    },
    "not_authorized",
    "a member cannot start archiving"
  );
})();

(function ownerManagesChannels() {
  const slack = makeWorkspace(60);
  const svc = C.createArchiverService({ slack: slack });
  svc.addChannel(OWNER, "C1");
  ok(svc.isSubscribed("C1"), "owner subscribed C1");
  ok(!svc.isSubscribed("C2"), "C2 not yet subscribed");
  throws(
    function () {
      svc.addChannel(OWNER, "does-not-exist");
    },
    "channel_not_found",
    "adding an unknown channel is rejected"
  );
  svc.removeChannel(OWNER, "C1");
  ok(!svc.isSubscribed("C1"), "owner removed C1");
})();

/* --- The archiver tick: automatic, incremental extraction ---------------- */

(function tickNoOpsUntilStarted() {
  const slack = makeWorkspace(120);
  const svc = C.createArchiverService({ slack: slack });
  svc.addChannel(OWNER, "C1");
  const report = svc.tick();
  eq(
    Object.keys(report).length,
    0,
    "tick does nothing until archiving is started"
  );
  eq(C.archivedCount(svc.archive, "C1"), 0, "nothing archived before start");
})();

(function tickPullsAPageAtATime() {
  const slack = makeWorkspace(120);
  const svc = C.createArchiverService({ slack: slack });
  svc.addChannel(OWNER, "C1");
  svc.start(OWNER);

  const r1 = svc.tick();
  eq(r1.C1.added, C.RATE_LIMIT, "first tick pulls one rate-limited page");
  eq(r1.C1.hasMore, true, "more remains after the first page");

  const r2 = svc.tick();
  eq(r2.C1.added, C.RATE_LIMIT, "second tick pulls the next page");

  const r3 = svc.tick();
  eq(r3.C1.added, 20, "third tick pulls the final partial page (120 total)");
  eq(r3.C1.hasMore, false, "no more messages after the last page");
  eq(
    C.archivedCount(svc.archive, "C1"),
    120,
    "the full history is archived after three ticks"
  );

  const r4 = svc.tick();
  eq(r4.C1.added, 0, "an exhausted channel adds nothing on further ticks");
})();

(function tickHandlesMultipleChannels() {
  const slack = makeWorkspace(30);
  const svc = C.createArchiverService({ slack: slack });
  svc.addChannel(OWNER, "C1");
  svc.addChannel(OWNER, "C2");
  svc.start(OWNER);
  const r = svc.tick();
  eq(r.C1.added, 30, "C1 fully pulled (30 < rate limit)");
  eq(r.C2.added, 30, "C2 fully pulled independently");
  ok(
    C.lastTs(svc.archive, "C1") !== C.lastTs(svc.archive, "C2"),
    "each channel keeps its own cursor"
  );
})();

(function stopHaltsExtraction() {
  const slack = makeWorkspace(120);
  const svc = C.createArchiverService({ slack: slack });
  svc.addChannel(OWNER, "C1");
  svc.start(OWNER);
  svc.tick();
  svc.stop(OWNER);
  const before = C.archivedCount(svc.archive, "C1");
  svc.tick();
  eq(
    C.archivedCount(svc.archive, "C1"),
    before,
    "no extraction happens while stopped"
  );
})();

/* --- Export -------------------------------------------------------------- */

(function exportFormats() {
  const archive = C.createArchive();
  C.ingest(archive, "C1", [
    { ts: "100.000000", user: "grace", text: "hello" },
    { ts: "200.000000", user: "ada", text: "world" },
  ]);

  const text = C.exportChannel(archive, "C1", "text");
  ok(text.indexOf("grace: hello") !== -1, "text export includes the messages");
  eq(text.split("\n").length, 2, "text export has one line per message");

  const json = JSON.parse(C.exportChannel(archive, "C1", "json"));
  eq(json.count, 2, "json export reports the count");
  eq(json.messages.length, 2, "json export carries the messages");
  eq(json.channel, "C1", "json export names the channel");
})();

/* --- Retrieval API (bonus) ----------------------------------------------- */

(function queryFilters() {
  const archive = C.createArchive();
  C.ingest(archive, "C1", [
    { ts: "100.000000", user: "grace", text: "deploy is green" },
    { ts: "200.000000", user: "ada", text: "please review my PR" },
    { ts: "300.000000", user: "grace", text: "deploy rolled back" },
  ]);

  const all = C.queryArchive(archive, "C1", {});
  eq(all.length, 3, "an empty query returns everything");
  eq(all[0].ts, "300.000000", "results are newest-first");

  const byUser = C.queryArchive(archive, "C1", { user: "grace" });
  eq(byUser.length, 2, "user filter narrows to that author");

  const byText = C.queryArchive(archive, "C1", { text: "DEPLOY" });
  eq(byText.length, 2, "text filter is case-insensitive");

  const since = C.queryArchive(archive, "C1", { since: "100.000000" });
  eq(since.length, 2, "since filter excludes older-or-equal messages");

  const limited = C.queryArchive(archive, "C1", { limit: 1 });
  eq(limited.length, 1, "limit caps the result count");
  eq(limited[0].ts, "300.000000", "the limited result is the newest");

  eq(
    C.queryArchive(archive, "missing", {}).length,
    0,
    "querying an unknown channel returns nothing"
  );
})();

/* --- Serialization round-trip + corruption recovery ---------------------- */

(function serializeRoundTrip() {
  const slack = makeWorkspace(30);
  const svc = C.createArchiverService({ slack: slack });
  svc.addChannel(OWNER, "C1");
  svc.start(OWNER);
  svc.tick();

  const text = C.serialize(svc.archive);
  const restored = C.deserialize(text);
  eq(
    C.archivedCount(restored, "C1"),
    C.archivedCount(svc.archive, "C1"),
    "a serialized archive restores its message count"
  );
  eq(
    C.lastTs(restored, "C1"),
    C.lastTs(svc.archive, "C1"),
    "a restored archive keeps its cursor"
  );
})();

(function deserializeRecoversFromGarbage() {
  eq(
    C.archivedChannels(C.deserialize("not json at all")).length,
    0,
    "garbage deserializes to an empty archive, not a crash"
  );
  const partial = C.deserialize(
    JSON.stringify({
      channels: {
        C1: {
          messages: [
            { ts: "100.000000", user: "a", text: "keep me" },
            { ts: "200.000000", user: "b" }, // missing text → dropped
            null, // junk → dropped
          ],
        },
      },
    })
  );
  eq(
    C.archivedCount(partial, "C1"),
    1,
    "corrupt rows are dropped, valid ones survive"
  );
})();

/* --- Report -------------------------------------------------------------- */

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
