/*
 * samples.js — a few starter entries, shown only on first load so the page is
 * not empty the first time you open it. Timestamps are set relative to "now"
 * at load, so the relative-time and day-grouping views have something to show.
 */
(function () {
  var now = Date.now();
  var MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  window.GUESTBOOK_SAMPLES = {
    version: 1,
    mode: "open",
    seq: 4,
    entries: [
      { id: 1, name: "", body: "First entry. This whole page is grown by an automated Claude routine — one project a day.", at: now - 3 * DAY - 2 * HOUR, status: "visible" },
      { id: 2, name: "Grace", body: "Try pasting a link like https://github.com/florinpop17/app-ideas — it becomes a safe, clickable link, and anything that looks like <code> stays harmless text.", at: now - DAY - 4 * HOUR, status: "visible" },
      { id: 3, name: "", body: "Switch the book to \"moderated\" and new posts wait for approval; switch it to \"closed\" and posting stops. That's the \"allow or disallow comments\" knob.", at: now - 5 * HOUR, status: "visible" },
      { id: 4, name: "Ada", body: "Entries are grouped by day and timestamped in plain English — \"just now\", \"yesterday\", a real date once it's old enough.", at: now - 8 * MIN, status: "visible" }
    ]
  };
})();
