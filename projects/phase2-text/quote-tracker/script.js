/*
 * script.js — browser glue for Quote Tracker.
 *
 * Wires the DOM to the DOM-free engine in tracker-core.js: parses pasted
 * attributions live, adds/removes quotes through the deduping Store, autosaves
 * the collection to localStorage, renders browse + search + tag filter, picks
 * the quote of the day from the fair rotation, and runs a live self-check that
 * mirrors the test suite's core laws (the ✓ line in the footer).
 */
"use strict";
(function () {
  var C = window.QuoteCore;
  var KEY = "quote-tracker/v1";
  var $ = function (id) { return document.getElementById(id); };

  /* ---- persistence (safe in private windows / blocked storage) ---- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return C.fromObject(raw);
    } catch (e) { /* ignore */ }
    return C.fromObject(window.QUOTE_SAMPLES || []);
  }
  function save() {
    try { localStorage.setItem(KEY, store.toJSON()); } catch (e) { /* ignore */ }
  }

  var store = load();

  // Day index = whole days since the Unix epoch, in local time.
  function today() {
    var d = new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  }
  var dayOffset = 0; // "next" button walks the rotation forward

  var activeTags = {}; // tag -> true

  /* ---------------- rendering ---------------- */
  function chip(tag, on, onClick) {
    var el = document.createElement("span");
    el.className = "chip" + (on ? " on" : "");
    el.textContent = tag;
    if (onClick) el.addEventListener("click", onClick);
    return el;
  }

  function renderQotd() {
    var q = store.quoteOfDay(today() + dayOffset);
    if (!q) {
      $("qotd-text").textContent = "Add a quote to get started.";
      $("qotd-by").textContent = "";
      $("qotd-tags").textContent = "";
      return;
    }
    $("qotd-text").textContent = "“" + q.text + "”";
    $("qotd-by").textContent = q.author || "unknown";
    var tags = $("qotd-tags"); tags.textContent = "";
    q.tags.forEach(function (t) { tags.appendChild(chip(t, false)); });
  }

  function renderTagbar() {
    var bar = $("tagbar"); bar.textContent = "";
    store.tagCounts().forEach(function (tc) {
      bar.appendChild(chip(tc.tag + " · " + tc.count, !!activeTags[tc.tag], function () {
        if (activeTags[tc.tag]) delete activeTags[tc.tag];
        else activeTags[tc.tag] = true;
        renderList(); renderTagbar();
      }));
    });
  }

  function renderList() {
    var tagFilter = Object.keys(activeTags);
    var results = store.search($("search").value, tagFilter);
    var ul = $("quotes"); ul.textContent = "";
    results.forEach(function (q) {
      var li = document.createElement("li"); li.className = "quote";
      var text = document.createElement("div"); text.className = "q";
      text.textContent = "“" + q.text + "”";
      var by = document.createElement("div"); by.className = "by";
      by.textContent = q.author || "unknown";
      var meta = document.createElement("div"); meta.className = "meta";
      var tags = document.createElement("div"); tags.className = "tags";
      q.tags.forEach(function (t) { tags.appendChild(chip(t, false)); });
      var del = document.createElement("button"); del.className = "del";
      del.textContent = "Delete"; del.title = "remove this quote";
      del.addEventListener("click", function () {
        store.remove(q.id); save(); refresh();
      });
      meta.appendChild(tags); meta.appendChild(del);
      li.appendChild(text); li.appendChild(by); li.appendChild(meta);
      ul.appendChild(li);
    });
    $("empty").hidden = results.length !== 0;
    $("count").textContent = store.count() + " saved" +
      (results.length !== store.count() ? " · " + results.length + " shown" : "");
  }

  function refresh() { renderQotd(); renderTagbar(); renderList(); selfCheck(); }

  /* ---------------- add ---------------- */
  function msg(cls, text) {
    var m = $("add-msg"); m.className = "msg " + cls; m.textContent = text;
    if (text) setTimeout(function () { if (m.textContent === text) { m.textContent = ""; m.className = "msg"; } }, 3500);
  }

  // Live: typing in the paste box fills the split fields.
  $("paste").addEventListener("input", function () {
    var p = C.parseAttribution($("paste").value);
    $("f-text").value = p.text;
    $("f-author").value = p.author;
  });

  function tagsFromInput() {
    return $("f-tags").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  $("add").addEventListener("click", function () {
    var text = $("f-text").value.trim();
    if (!text) {
      // fall back to parsing the paste box if the split fields are empty
      var p = C.parseAttribution($("paste").value);
      text = p.text; $("f-author").value = $("f-author").value || p.author;
    }
    if (!text) { msg("bad", "Nothing to add — type a quote."); return; }
    var res = store.add({ text: text, author: $("f-author").value.trim(), tags: tagsFromInput() });
    if (res.added) {
      msg("ok", "Added.");
      $("paste").value = ""; $("f-text").value = ""; $("f-author").value = ""; $("f-tags").value = "";
      save(); refresh();
    } else if (res.item) {
      msg("dup", "Already in your collection.");
    } else {
      msg("bad", "That quote is empty.");
    }
  });

  /* ---------------- browse controls ---------------- */
  $("search").addEventListener("input", renderList);
  $("shuffle").addEventListener("click", function () { dayOffset++; renderQotd(); });

  /* ---------------- export / import ---------------- */
  $("export").addEventListener("click", function () {
    var blob = new Blob([store.toJSON()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "quotes.json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $("import-btn").addEventListener("click", function () { $("import-file").click(); });
  $("import-file").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var incoming = C.fromObject(String(reader.result));
        var before = store.count(), added = 0;
        incoming.list().forEach(function (q) {
          if (store.add({ text: q.text, author: q.author, tags: q.tags }).added) added++;
        });
        save(); refresh();
        msg("ok", "Imported " + added + " new quote" + (added === 1 ? "" : "s") +
          (added < incoming.count() ? " (" + (incoming.count() - added) + " already present)" : "") + ".");
      } catch (err) {
        msg("bad", "Could not read that file as a quotes export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  /* ---------------- live self-check (mirrors tests.js laws) ---------------- */
  function selfCheck() {
    var v = $("verify");
    try {
      // 1. Attribution round-trips on a probe.
      var probe = { text: "live check 😀 well-being", author: "Author X" };
      var rt = C.parseAttribution(C.formatAttribution(probe));
      var law1 = rt.text === probe.text && rt.author === probe.author;

      // 2. The current store has no identity-duplicate keys.
      var keys = {}, law2 = true;
      store.list().forEach(function (q) {
        var k = C.quoteKey(q.text, q.author);
        if (keys[k]) law2 = false; keys[k] = 1;
      });

      // 3. Over count days the rotation is a permutation (every quote once).
      var n = store.count(), law3 = true;
      if (n > 0) {
        var seen = {};
        for (var d = 0; d < n; d++) {
          var idx = C.orderForDay(n, d);
          if (idx < 0 || idx >= n || seen[idx]) law3 = false;
          seen[idx] = 1;
        }
        if (Object.keys(seen).length !== n) law3 = false;
      }

      // 4. Export/import round-trips the live store.
      var law4 = C.fromObject(store.toObject()).toJSON() === store.toJSON();

      if (law1 && law2 && law3 && law4) {
        v.className = "verify ok";
        v.textContent = "Verified: attribution round-trips, no duplicates, rotation is fair, export is exact";
      } else {
        v.className = "verify bad";
        v.textContent = "Self-check failed (" +
          [law1 ? "" : "attr", law2 ? "" : "dup", law3 ? "" : "rotation", law4 ? "" : "export"]
            .filter(Boolean).join(", ") + ")";
      }
    } catch (e) {
      v.className = "verify bad"; v.textContent = "Self-check error: " + e.message;
    }
  }

  refresh();
})();
