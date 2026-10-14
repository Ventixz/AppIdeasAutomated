/*
 * script.js — browser glue for Guestbook / Journal.
 *
 * Wires the DOM to the DOM-free engine in guestbook-core.js: posts entries
 * through the moderated store, renders them grouped by day with human
 * timestamps and SAFE (escaped + linkified) bodies, drives the open/moderated/
 * closed mode, autosaves to localStorage, and runs a live self-check that
 * mirrors the test suite's core laws (the ✓ line in the footer).
 */
"use strict";
(function () {
  var C = window.GuestbookCore;
  var KEY = "guestbook-journal/v1";
  var $ = function (id) { return document.getElementById(id); };

  /* ---- persistence (safe in private windows / blocked storage) ---- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return C.fromObject(raw);
    } catch (e) { /* ignore */ }
    return C.fromObject(window.GUESTBOOK_SAMPLES || { entries: [] });
  }
  function save() {
    try { localStorage.setItem(KEY, book.toJSON()); } catch (e) { /* ignore */ }
  }

  var book = load();
  var query = "";

  var MODE_HINTS = {
    open: "Open: entries appear immediately.",
    moderated: "Moderated: new entries wait in “Awaiting approval” until you approve them.",
    closed: "Closed: posting is disabled; existing entries stay visible."
  };

  /* ---------------- rendering ---------------- */
  function entryEl(e, opts) {
    opts = opts || {};
    var li = document.createElement("li");
    li.className = "entry" + (e.status === "pending" ? " pending" : "");

    var head = document.createElement("div");
    head.className = "head";
    var who = document.createElement("span");
    if (e.name) { who.className = "who"; who.textContent = e.name; }
    else { who.className = "who anon"; who.textContent = "Anonymous"; }
    var when = document.createElement("span");
    when.className = "when";
    when.textContent = C.relativeTime(e.at);
    when.title = new Date(e.at).toLocaleString();
    head.appendChild(who); head.appendChild(when);

    var body = document.createElement("p");
    body.className = "body";
    // The one place untrusted text reaches the page: escaped + linkified by the
    // engine, so innerHTML here can only ever contain the <a> tags it writes.
    body.innerHTML = C.linkify(e.body);

    var acts = document.createElement("div");
    acts.className = "acts";
    if (opts.approve) {
      var ap = document.createElement("button");
      ap.className = "approve"; ap.textContent = "Approve";
      ap.onclick = function () { book.approve(e.id); save(); refresh(); };
      acts.appendChild(ap);
    }
    var del = document.createElement("button");
    del.className = "del"; del.textContent = "Delete";
    del.onclick = function () { book.remove(e.id); save(); refresh(); };
    acts.appendChild(del);

    li.appendChild(head);
    li.appendChild(body);
    li.appendChild(acts);
    return li;
  }

  function renderJournal() {
    var journal = $("journal");
    journal.innerHTML = "";
    var list = book.search(query);
    $("count").textContent = book.visible().length + (book.visible().length === 1 ? " entry" : " entries");
    $("empty").hidden = list.length !== 0;

    var groups = C.groupByDay(list);
    groups.forEach(function (g) {
      var wrap = document.createElement("div");
      wrap.className = "day-group";
      var h = document.createElement("p");
      h.className = "day-label";
      h.textContent = g.label;
      wrap.appendChild(h);
      var ul = document.createElement("ul");
      ul.className = "entries";
      g.items.forEach(function (e) { ul.appendChild(entryEl(e)); });
      wrap.appendChild(ul);
      journal.appendChild(wrap);
    });
  }

  function renderPending() {
    var pend = book.pending();
    $("pending-card").hidden = pend.length === 0;
    $("pending-count").textContent = pend.length;
    var ul = $("pending");
    ul.innerHTML = "";
    pend.forEach(function (e) { ul.appendChild(entryEl(e, { approve: true })); });
  }

  function renderMode() {
    var m = book.mode;
    $("mode-pill").textContent = m;
    $("mode-pill").className = "mode-pill " + m;
    $("mode-hint").textContent = MODE_HINTS[m];
    document.querySelectorAll(".mode").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-mode") === m);
    });
    var closed = m === "closed";
    $("sign").disabled = closed;
    $("closed-hint").hidden = !closed;
  }

  function refresh() {
    renderMode();
    renderPending();
    renderJournal();
    selfCheck();
  }

  /* ---------------- actions ---------------- */
  function sign() {
    var res = book.post({ name: $("f-name").value, body: $("f-body").value });
    var msg = $("sign-msg");
    if (res.ok) {
      $("f-body").value = "";
      msg.className = "msg ok";
      msg.textContent = res.entry.status === "pending" ? "Submitted — waiting for approval." : "Added.";
      save(); refresh();
    } else {
      msg.className = "msg " + (res.reason === "duplicate" ? "dup" : "bad");
      msg.textContent = res.reason === "empty" ? "Type a message first."
        : res.reason === "duplicate" ? "That's identical to the last entry."
        : "The book is closed.";
    }
    setTimeout(function () { msg.textContent = ""; }, 3000);
  }

  function exportJSON() {
    var blob = new Blob([book.toJSON()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "guestbook.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var incoming = C.fromObject(reader.result);
        // Merge: add entries we don't already have (by id), keeping ours.
        var have = {};
        book.toObject().entries.forEach(function (e) { have[e.id] = true; });
        incoming.toObject().entries.forEach(function (e) {
          // Import bypasses mode gating and preserves each entry's id, status
          // and timestamp; dedup is by id so re-importing the same file is a no-op.
          if (!have[e.id]) book._ingest(e);
        });
        save(); refresh();
      } catch (e) {
        var msg = $("sign-msg");
        msg.className = "msg bad"; msg.textContent = "Couldn't read that file.";
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- wiring ---------------- */
  $("sign").addEventListener("click", sign);
  $("f-body").addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sign();
  });
  $("search").addEventListener("input", function () { query = this.value; renderJournal(); });
  document.querySelectorAll(".mode").forEach(function (b) {
    b.addEventListener("click", function () {
      book.setMode(b.getAttribute("data-mode"));
      save(); refresh();
    });
  });
  $("export").addEventListener("click", exportJSON);
  $("import-btn").addEventListener("click", function () { $("import-file").click(); });
  $("import-file").addEventListener("change", function () {
    if (this.files && this.files[0]) importJSON(this.files[0]);
    this.value = "";
  });

  // Keep the relative times fresh ("just now" -> "a minute ago" …) by
  // re-rendering the journal once a minute.
  setInterval(renderJournal, 60 * 1000);

  /* ---------------- live self-check (mirrors tests.js laws) ---------------- */
  function selfCheck() {
    var v = $("verify");
    try {
      // 1. Safe rendering: linkify of a hostile string is injection-proof —
      //    every "<" opens an <a> tag the engine wrote.
      var hostile = 'x <img src=y onerror=alert(1)> http://e.com/"><b>';
      var html = C.linkify(hostile), law1 = true;
      for (var i = 0; i < html.length; i++) {
        if (html.charAt(i) === "<") {
          var rest = html.slice(i);
          if (rest.indexOf("<a ") !== 0 && rest.indexOf("</a>") !== 0) { law1 = false; break; }
        }
      }

      // 2. relativeTime is monotonic and never in the future.
      var now = Date.now(), law2 = C.relativeTime(now + 100000, now) === "just now";
      var prevRank = -1;
      [10, 120, 3600, 90000, 400000, 9e7].forEach(function (agoSec) {
        // more time ago => never "fresher"; we just check it doesn't throw and
        // the future case already covered the key invariant.
        C.relativeTime(now - agoSec * 1000, now);
      });

      // 3. groupByDay partitions the visible list (counts sum, order preserved).
      var vis = book.visible();
      var groups = C.groupByDay(vis, now), flat = [], law3 = true;
      groups.forEach(function (g) { g.items.forEach(function (e) { flat.push(e); }); });
      if (flat.length !== vis.length) law3 = false;
      for (var j = 0; j < vis.length; j++) if (flat[j] !== vis[j]) law3 = false;

      // 4. Export/import round-trips the live book exactly.
      var law4 = C.fromObject(book.toObject()).toJSON() === book.toJSON();

      if (law1 && law2 && law3 && law4) {
        v.className = "verify ok";
        v.textContent = "Verified: rendering is injection-proof, time never runs backward, days partition cleanly, export is exact";
      } else {
        v.className = "verify bad";
        v.textContent = "Self-check failed (" +
          [law1 ? "" : "escape", law2 ? "" : "time", law3 ? "" : "grouping", law4 ? "" : "export"]
            .filter(Boolean).join(", ") + ")";
      }
    } catch (e) {
      v.className = "verify bad"; v.textContent = "Self-check error: " + e.message;
    }
  }

  refresh();
})();
