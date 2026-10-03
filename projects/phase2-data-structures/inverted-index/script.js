/*
 * script.js — the DOM controller for the Inverted Index page.
 *
 * It owns NO search logic: every term, posting, boolean merge, phrase match and
 * TF-IDF score comes from inverted-index-core.js. This file only manages the
 * editable corpus, rebuilds the index when the text or options change, runs the
 * query box, and paints the results, the live index table, and the ✓ Verified
 * line (which re-checks each result against the core's brute-force scan).
 */
"use strict";
(function () {
  var II = window.InvertedIndexCore;

  var SAMPLES = [
    { name: "foxes.txt", text: "The quick brown fox jumps over the lazy dog. The dog was not amused, but the fox simply ran on into the quick morning light." },
    { name: "cats.txt", text: "A lazy cat sleeps all day long. Cats are quiet; dogs are loud. This particular cat ignored the barking dog entirely and kept sleeping." },
    { name: "search.txt", text: "An inverted index maps each term to the documents that contain it. Searching then merges these short postings lists quickly, instead of re-reading every file." },
    { name: "cities.txt", text: "New York is a big city. I love New York in the autumn. The city that never sleeps has many bright lights and quick yellow cabs." },
    { name: "running.txt", text: "She was running fast this morning, and he ran even faster. Running every day keeps that lazy feeling far away." }
  ];

  var EXAMPLES = ["fox", "quick brown", "cat OR dog", "lazy -cat", '"new york"', "running", "quick morning"];

  // ---- state ----------------------------------------------------------------
  var docs = SAMPLES.map(function (d) { return { name: d.name, text: d.text }; });
  var index = null;

  // ---- elements --------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var docsEl = $("docs"), docCountEl = $("docCount");
  var queryEl = $("query"), verdictEl = $("verdict"), verifyEl = $("verify");
  var resultsEl = $("results"), examplesEl = $("examples");
  var indexTableEl = $("indexTable"), indexMetaEl = $("indexMeta"), filterEl = $("filter");
  var optStop = $("optStop"), optStem = $("optStem");

  // ---- small helpers ---------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // =============================================================================
  // Corpus editors
  // =============================================================================
  function renderDocs() {
    docsEl.innerHTML = "";
    docs.forEach(function (d, i) {
      var wrap = document.createElement("div");
      wrap.className = "doc";

      var head = document.createElement("div");
      head.className = "doc-head";
      var name = document.createElement("input");
      name.type = "text"; name.className = "doc-name"; name.value = d.name;
      name.setAttribute("aria-label", "File name");
      name.addEventListener("input", function () { docs[i].name = name.value; scheduleRebuild(); });
      var id = document.createElement("span");
      id.className = "doc-id"; id.textContent = "doc " + i;
      var del = document.createElement("button");
      del.type = "button"; del.className = "danger-x"; del.textContent = "✕";
      del.title = "Remove this file";
      del.addEventListener("click", function () { docs.splice(i, 1); renderDocs(); rebuild(); });
      head.appendChild(name); head.appendChild(id); head.appendChild(del);

      var ta = document.createElement("textarea");
      ta.value = d.text; ta.rows = 2;
      ta.setAttribute("aria-label", "File contents");
      ta.addEventListener("input", function () { docs[i].text = ta.value; scheduleRebuild(); });

      wrap.appendChild(head); wrap.appendChild(ta);
      docsEl.appendChild(wrap);
    });
    docCountEl.textContent = docs.length + (docs.length === 1 ? " file" : " files");
  }

  // =============================================================================
  // Build the index from the current corpus + options
  // =============================================================================
  function rebuild() {
    index = II.buildIndex(docs, { stopwords: optStop.checked, stem: optStem.checked });
    renderIndexTable();
    runSearch();
  }
  var scheduleRebuild = debounce(rebuild, 220);

  // =============================================================================
  // Search + results
  // =============================================================================
  function runSearch() {
    if (!index) return;
    var q = queryEl.value;
    var ast = II.parseQuery(q, index.analyzer);
    var out = II.search(index, q);
    var termSet = Object.create(null);
    out.terms.forEach(function (t) { termSet[t] = true; });

    // verdict line
    if (!q.trim()) {
      verdictEl.className = "verdict none";
      verdictEl.textContent = "Type a query above to search " + index.N + " file" + (index.N === 1 ? "" : "s") + ".";
    } else {
      var n = out.results.length;
      verdictEl.className = "verdict";
      verdictEl.innerHTML =
        '<span class="n">' + n + '</span> file' + (n === 1 ? "" : "s") +
        " match <span class=\"q\">" + escapeHtml(II.describe(ast)) + "</span>";
    }

    // results
    renderResults(out, termSet);
    // mark matching terms in the index table
    markIndexHits(termSet);
    // live verification
    verify(ast);
  }

  function renderResults(out, termSet) {
    resultsEl.innerHTML = "";
    if (!queryEl.value.trim()) {
      resultsEl.innerHTML = '<p class="empty-note">No query yet — the ranked matches will appear here.</p>';
      return;
    }
    if (out.results.length === 0) {
      resultsEl.innerHTML = '<p class="empty-note">Nothing matched. Try a different word, <code>OR</code>, or remove a <code>-exclusion</code>.</p>';
      return;
    }
    var maxScore = 0;
    out.results.forEach(function (r) { if (r.score > maxScore) maxScore = r.score; });

    out.results.forEach(function (r) {
      var card = document.createElement("div");
      card.className = "result";

      var head = document.createElement("div");
      head.className = "r-head";
      head.innerHTML = '<span class="r-name">' + escapeHtml(r.name) + '</span>' +
        '<span class="r-score">score ' + r.score.toFixed(3) + '</span>';
      card.appendChild(head);

      var bar = document.createElement("div");
      bar.className = "score-bar";
      var pct = maxScore > 0 ? Math.max(6, Math.round(100 * r.score / maxScore)) : 100;
      bar.innerHTML = '<i style="width:' + pct + '%"></i>';
      card.appendChild(bar);

      var snip = document.createElement("p");
      snip.className = "snippet";
      snip.innerHTML = snippetHtml(index.docs[r.id].text, termSet);
      card.appendChild(snip);

      if (out.terms.length) {
        var terms = document.createElement("div");
        terms.className = "r-terms";
        out.terms.forEach(function (t) {
          var c = r.tf[t] || 0;
          var chip = document.createElement("span");
          chip.className = "r-term";
          chip.innerHTML = escapeHtml(t) + ": <b>" + c + "</b>";
          terms.appendChild(chip);
        });
        card.appendChild(terms);
      }
      resultsEl.appendChild(card);
    });
  }

  // KWIC snippet: a window of the raw text centred on the first matching term,
  // with every matching surface form highlighted. Matching reuses the analyzer's
  // stemmer and stop-word test so it agrees with how the index was built.
  function matchRanges(text, termSet) {
    var re = /[A-Za-z0-9']+/g, m, ranges = [];
    while ((m = re.exec(text)) !== null) {
      var surf = m[0];
      var norm = index.analyzer.stem(surf.toLowerCase().replace(/['‘’]/g, ""));
      if (norm && !index.analyzer.isStop(surf) && termSet[norm]) {
        ranges.push([m.index, m.index + surf.length]);
      }
    }
    return ranges;
  }
  function snippetHtml(text, termSet) {
    var ranges = matchRanges(text, termSet);
    var winStart = 0, winEnd = Math.min(text.length, 260), pre = "", post = "";
    if (ranges.length) {
      var c = ranges[0][0];
      winStart = Math.max(0, c - 90);
      winEnd = Math.min(text.length, c + 180);
    }
    if (winStart > 0) { while (winStart > 0 && /\S/.test(text[winStart - 1])) winStart--; pre = "… "; }
    if (winEnd < text.length) { while (winEnd < text.length && /\S/.test(text[winEnd])) winEnd++; post = " …"; }

    var out = "", cur = winStart;
    ranges.forEach(function (r) {
      if (r[1] <= winStart || r[0] >= winEnd) return;
      var s = Math.max(r[0], winStart), e = Math.min(r[1], winEnd);
      out += escapeHtml(text.slice(cur, s)) + "<mark>" + escapeHtml(text.slice(s, e)) + "</mark>";
      cur = e;
    });
    out += escapeHtml(text.slice(cur, winEnd));
    return pre + out + post;
  }

  // =============================================================================
  // The inverted-index table
  // =============================================================================
  var MAX_ROWS = 400;
  function renderIndexTable() {
    var terms = Object.keys(index.postings).sort();
    var totalTokens = index.docs.reduce(function (s, d) { return s + d.length; }, 0);
    indexMetaEl.textContent =
      index.N + " file" + (index.N === 1 ? "" : "s") + " · " +
      terms.length + " unique term" + (terms.length === 1 ? "" : "s") + " · " +
      totalTokens + " token" + (totalTokens === 1 ? "" : "s") + " indexed";

    var filter = (filterEl.value || "").trim().toLowerCase();
    if (filter) terms = terms.filter(function (t) { return t.indexOf(filter) !== -1; });

    var head = "<thead><tr><th>term</th><th class=\"df\">df</th><th>postings (file : term-frequency)</th></tr></thead>";
    if (terms.length === 0) {
      indexTableEl.innerHTML = head + '<tbody><tr><td class="none" colspan="3">no terms' + (filter ? " match “" + escapeHtml(filter) + "”" : "") + "</td></tr></tbody>";
      return;
    }
    var shown = terms.slice(0, MAX_ROWS);
    var rows = shown.map(function (t) {
      var list = index.postings[t];
      var postingHtml = list.map(function (p) {
        return '<span class="posting">' + escapeHtml(index.docs[p.id].name) +
          ' <span class="pf">:' + p.tf + "</span></span>";
      }).join("&nbsp; ");
      return '<tr data-term="' + escapeHtml(t) + '"><td class="term">' + escapeHtml(t) +
        '</td><td class="df">' + list.length + '</td><td>' + postingHtml + "</td></tr>";
    }).join("");
    var more = terms.length > MAX_ROWS
      ? '<tr><td class="none" colspan="3">… and ' + (terms.length - MAX_ROWS) + " more (filter to narrow)</td></tr>"
      : "";
    indexTableEl.innerHTML = head + "<tbody>" + rows + more + "</tbody>";
  }
  function markIndexHits(termSet) {
    var rows = indexTableEl.querySelectorAll("tr[data-term]");
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].getAttribute("data-term");
      rows[i].classList.toggle("hit", !!termSet[t]);
    }
  }

  // =============================================================================
  // Live verification: the index merge must agree with a brute-force scan
  // =============================================================================
  function verify(ast) {
    var inv = II.checkInvariants(index);
    if (!inv.ok) {
      verifyEl.className = "verify bad";
      verifyEl.textContent = "Index invariant broken: " + inv.errors[0];
      return;
    }
    if (!queryEl.value.trim()) {
      verifyEl.className = "verify ok";
      verifyEl.textContent = "Index built: postings sorted, de-duplicated, positions consistent.";
      return;
    }
    var viaIndex = II.evaluate(index, ast);
    var viaScan = II.scanMatch(index, ast);
    var agree = JSON.stringify(viaIndex) === JSON.stringify(viaScan);
    if (agree) {
      verifyEl.className = "verify ok";
      verifyEl.textContent = "Verified: the index returned the same " + viaIndex.length +
        " file" + (viaIndex.length === 1 ? "" : "s") + " as a brute-force scan of every document.";
    } else {
      verifyEl.className = "verify bad";
      verifyEl.textContent = "Mismatch between index merge and brute-force scan!";
    }
  }

  // =============================================================================
  // Wiring
  // =============================================================================
  function renderExamples() {
    EXAMPLES.forEach(function (ex) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "example"; b.textContent = ex;
      b.addEventListener("click", function () { queryEl.value = ex; runSearch(); queryEl.focus(); });
      examplesEl.appendChild(b);
    });
  }

  queryEl.addEventListener("input", debounce(runSearch, 80));
  filterEl.addEventListener("input", debounce(function () { renderIndexTable(); runSearchHighlightOnly(); }, 120));
  optStop.addEventListener("change", rebuild);
  optStem.addEventListener("change", rebuild);
  $("addDoc").addEventListener("click", function () {
    docs.push({ name: "doc" + (docs.length + 1) + ".txt", text: "" });
    renderDocs(); rebuild();
  });
  $("reset").addEventListener("click", function () {
    docs = SAMPLES.map(function (d) { return { name: d.name, text: d.text }; });
    renderDocs(); rebuild();
  });

  // re-apply the "hit" highlight on the (re-rendered) table after a filter
  function runSearchHighlightOnly() {
    if (!index) return;
    var out = II.search(index, queryEl.value);
    var termSet = Object.create(null);
    out.terms.forEach(function (t) { termSet[t] = true; });
    markIndexHits(termSet);
  }

  // ---- boot ----
  renderExamples();
  renderDocs();
  rebuild();
  queryEl.value = "quick brown";
  runSearch();
})();
