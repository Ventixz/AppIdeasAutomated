/*
 * script.js — browser glue for the RSS Feed Creator.
 *
 * The engine (feed-core.js) does the real work; this file only wires it to the
 * page: parse the textarea as you type, render the normalised posts, run the
 * round-trip law live as the ✓ Verified line, and offer the canonical RSS 2.0
 * rebuild as a download or clipboard copy. All feed data is placed with
 * textContent (never innerHTML), so a feed's own markup is shown as text and
 * can never execute. Every localStorage access is wrapped in try/catch so a
 * private window degrades quietly.
 */
"use strict";

(function () {
  var F = window.FEED;
  var SAMPLES = window.FEED_SAMPLES;
  var STORE_KEY = "rss-feed-creator:draft";

  var $ = function (id) { return document.getElementById(id); };
  var source = $("source");
  var stKind = $("stKind"), stPosts = $("stPosts"), verify = $("verify");
  var feedCard = $("feedCard"), feedTitle = $("feedTitle"), feedLink = $("feedLink"), feedDesc = $("feedDesc");
  var postsEl = $("posts"), postsHeading = $("postsHeading");
  var btnDownload = $("btnDownload"), btnCopy = $("btnCopy"), copyNote = $("copyNote");
  var autosave = $("autosave");

  var current = null; // last successfully parsed feed

  /* ---------------- helpers ---------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmtDate(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    // A stable, locale-light rendering: 2026-10-07 09:30 UTC.
    function p(x) { return x < 10 ? "0" + x : "" + x; }
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
      " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " UTC";
  }

  function looksLikeHtml(s) { return /<[a-zA-Z][\s\S]*>/.test(s); }

  /* ---------------- rendering ---------------- */

  function renderEmpty(message, isError) {
    postsEl.textContent = "";
    var box = el("div", "empty" + (isError ? " err" : ""), message);
    postsEl.appendChild(box);
    postsHeading.textContent = "Posts";
    feedCard.hidden = true;
    btnDownload.disabled = true;
    btnCopy.disabled = true;
  }

  function renderFeed(feed) {
    // Feed meta card.
    feedTitle.textContent = feed.title || "(untitled feed)";
    if (feed.link) {
      feedLink.textContent = feed.link;
      feedLink.href = feed.link;
      feedLink.hidden = false;
    } else {
      feedLink.hidden = true;
    }
    feedDesc.textContent = feed.description || "";
    feedCard.hidden = false;

    // Posts.
    postsEl.textContent = "";
    postsHeading.textContent = feed.posts.length === 1 ? "1 post" : feed.posts.length + " posts";
    if (!feed.posts.length) {
      postsEl.appendChild(el("div", "empty", "The feed parsed, but it has no posts."));
      return;
    }

    feed.posts.forEach(function (p) {
      var card = el("div", "post");
      var head = el("div", "post-head");
      var h = el("h3", "post-title");
      if (p.link) {
        var a = el("a", null, p.title || "(untitled)");
        a.href = p.link; a.target = "_blank"; a.rel = "noopener";
        h.appendChild(a);
      } else {
        h.textContent = p.title || "(untitled)";
      }
      head.appendChild(h);
      card.appendChild(head);

      var meta = el("div", "post-meta");
      var date = fmtDate(p.date);
      if (date) {
        meta.appendChild(el("span", null, "🕑 " + date));
      } else if (p.dateText) {
        meta.appendChild(el("span", "nodate", "🕑 unparsed date: " + p.dateText));
      } else {
        meta.appendChild(el("span", "nodate", "🕑 no date"));
      }
      if (p.author) meta.appendChild(el("span", null, "✍ " + p.author));
      card.appendChild(meta);

      var bodyText = p.content || p.summary;
      if (bodyText) {
        var body = el("div", "post-body", bodyText);
        if (looksLikeHtml(bodyText)) body.classList.add("html-note");
        card.appendChild(body);
      }
      postsEl.appendChild(card);
    });
  }

  /* ---------------- the live round-trip check ---------------- */

  function runVerify(feed) {
    try {
      var rebuilt = F.parseFeed(F.toRss(feed));
      var ok = rebuilt.posts.length === feed.posts.length;
      for (var k = 0; ok && k < feed.posts.length; k++) {
        var a = feed.posts[k], b = rebuilt.posts[k];
        var at = a.date instanceof Date ? a.date.getTime() : null;
        var bt = b.date instanceof Date ? b.date.getTime() : null;
        if ((a.title || "").trim() !== (b.title || "").trim() ||
            a.link !== b.link || at !== bt) ok = false;
      }
      verify.className = "verify " + (ok ? "ok" : "bad");
      verify.textContent = ok
        ? "✓ round-trips through RSS 2.0 (" + feed.posts.length + " posts)"
        : "✗ round-trip mismatch";
    } catch (e) {
      verify.className = "verify bad";
      verify.textContent = "✗ round-trip error";
    }
  }

  /* ---------------- parse-on-change ---------------- */

  function setKindBadge(kind) {
    stKind.className = "badge" + (kind ? " " + kind : "");
    stKind.textContent = kind ? kind.toUpperCase() : "—";
  }

  function update() {
    var xml = source.value;
    saveDraft(xml);

    if (!xml.trim()) {
      current = null;
      setKindBadge(null);
      stPosts.textContent = "0 posts";
      verify.textContent = "";
      verify.className = "verify";
      renderEmpty("Paste a feed's XML above, or load one of the samples.", false);
      return;
    }

    var feed;
    try {
      feed = F.parseFeed(xml);
    } catch (e) {
      current = null;
      setKindBadge("err");
      stKind.textContent = "ERROR";
      stPosts.textContent = "—";
      verify.textContent = "";
      verify.className = "verify";
      renderEmpty((e && e.message) ? e.message : "Could not parse the feed.", true);
      return;
    }

    current = feed;
    setKindBadge(feed.kind);
    stPosts.textContent = feed.posts.length === 1 ? "1 post" : feed.posts.length + " posts";
    btnDownload.disabled = false;
    btnCopy.disabled = false;
    copyNote.textContent = "";
    renderFeed(feed);
    runVerify(feed);
  }

  /* ---------------- persistence ---------------- */

  function saveDraft(xml) {
    try {
      if (xml) localStorage.setItem(STORE_KEY, xml);
      else localStorage.removeItem(STORE_KEY);
      autosave.textContent = xml
        ? "Draft saved in this browser · " + xml.length.toLocaleString() + " chars"
        : "—";
    } catch (e) {
      autosave.textContent = "(autosave unavailable in this browser)";
    }
  }

  function loadDraft() {
    try { return localStorage.getItem(STORE_KEY) || ""; }
    catch (e) { return ""; }
  }

  /* ---------------- download / copy ---------------- */

  function rebuiltXml() { return current ? F.toRss(current) : ""; }

  function download() {
    if (!current) return;
    var blob = new Blob([rebuiltXml()], { type: "application/rss+xml;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "feed.xml";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function copy() {
    if (!current) return;
    var text = rebuiltXml();
    function done() { copyNote.textContent = "Copied the RSS 2.0 rebuild to the clipboard."; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallbackCopy);
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch (e) {
        copyNote.textContent = "Couldn't copy — select the download instead.";
      }
    }
  }

  /* ---------------- wiring ---------------- */

  source.addEventListener("input", update);

  $("btnRss").addEventListener("click", function () { source.value = SAMPLES.rss.xml; update(); });
  $("btnAtom").addEventListener("click", function () { source.value = SAMPLES.atom.xml; update(); });
  $("btnClear").addEventListener("click", function () { source.value = ""; update(); source.focus(); });

  $("btnOpen").addEventListener("click", function () { $("fileInput").click(); });
  $("fileInput").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { source.value = String(reader.result || ""); update(); };
    reader.readAsText(file);
    e.target.value = ""; // allow re-opening the same file
  });

  btnDownload.addEventListener("click", download);
  btnCopy.addEventListener("click", copy);

  /* ---------------- start ---------------- */

  var saved = loadDraft();
  source.value = saved || SAMPLES.rss.xml; // first visit lands on a working example
  update();
})();
