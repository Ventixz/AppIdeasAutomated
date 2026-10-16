/*
 * script.js — browser glue for the Regex Query Tool.
 *
 * It owns no logic: every answer comes from REGEX_TOOL (regex-core.js). This
 * file reads the inputs, calls the engine, and paints the result. All text
 * from the engine is inserted with textContent / createTextNode — never
 * innerHTML on user input — so a pattern or search string can never inject
 * markup into the page.
 */
(function () {
  "use strict";
  var T = window.REGEX_TOOL;

  var $pattern = document.getElementById("pattern");
  var $flags = document.getElementById("flags");
  var $input = document.getElementById("input");
  var $library = document.getElementById("library");
  var $status = document.getElementById("status");
  var $flagHelp = document.getElementById("flag-help");
  var $count = document.getElementById("match-count");
  var $redos = document.getElementById("redos");
  var $highlight = document.getElementById("highlight");
  var $groupsWrap = document.getElementById("groups-wrap");
  var $matches = document.getElementById("matches");
  var $explain = document.getElementById("explain");

  /* ---------- populate the example dropdown ---------- */
  var placeholder = document.createElement("option");
  placeholder.textContent = "— pick a pattern —";
  placeholder.value = "";
  $library.appendChild(placeholder);
  T.LIBRARY.forEach(function (e, i) {
    var o = document.createElement("option");
    o.value = String(i);
    o.textContent = e.name;
    $library.appendChild(o);
  });
  $library.addEventListener("change", function () {
    var e = T.LIBRARY[Number($library.value)];
    if (!e) return;
    $pattern.value = e.pattern;
    $flags.value = e.flags;
    $input.value = e.sample;
    $library.value = "";
    render();
  });

  /* ---------- render ---------- */
  function render() {
    var pattern = $pattern.value;
    var flags = $flags.value;
    var input = $input.value;

    showFlagHelp(flags);

    // 1. Static safety check — show this even if the pattern is also invalid.
    renderRedos(pattern);

    // 2. Run the query.
    var res = T.findMatches(pattern, flags, input);
    if (!res.ok) {
      setStatus(res.error, "err");
      $count.textContent = "";
      $highlight.textContent = input; // show the raw text, unhighlighted
      $groupsWrap.classList.add("hidden");
      renderExplain(pattern);
      return;
    }

    var n = res.matches.length;
    setStatus(n + (n === 1 ? " match" : " matches") + (res.global ? "" : " (no /g — first only)"),
              n ? "ok" : "");
    $count.textContent = n ? "(" + n + ")" : "(none)";

    renderHighlight(input, res.matches);
    renderMatches(res.matches);
    renderExplain(pattern);
  }

  function setStatus(msg, cls) {
    $status.textContent = msg;
    $status.className = "small" + (cls ? " " + cls : "");
  }

  function showFlagHelp(flags) {
    var names = [];
    for (var i = 0; i < flags.length; i++) {
      if (T.FLAG_INFO[flags[i]] && names.indexOf(flags[i]) === -1) {
        names.push(flags[i]);
      }
    }
    if (!names.length) { $flagHelp.textContent = "No flags. Add g (global), i (ignore case), m (multiline)…"; return; }
    $flagHelp.textContent = names.map(function (f) { return f + " = " + T.FLAG_INFO[f]; }).join("  ·  ");
  }

  /* ---------- ReDoS warning ---------- */
  function renderRedos(pattern) {
    var a = T.analyze(pattern);
    clear($redos);
    if (a.safe) { $redos.classList.add("hidden"); return; }
    $redos.classList.remove("hidden");
    var head = document.createElement("div");
    var strong = document.createElement("strong");
    strong.textContent = "⚠ Possible catastrophic backtracking (ReDoS).";
    head.appendChild(strong);
    head.appendChild(document.createTextNode(
      " This pattern has a shape that can take exponential time on certain inputs — " +
      "running it on untrusted text could hang the page. Reported statically; the " +
      "match below still runs, so keep the search string short while experimenting."));
    $redos.appendChild(head);
    var ul = document.createElement("ul");
    a.warnings.forEach(function (w) {
      var li = document.createElement("li");
      li.textContent = w.detail;
      ul.appendChild(li);
    });
    $redos.appendChild(ul);
  }

  /* ---------- highlight panel ---------- */
  function renderHighlight(input, matches) {
    clear($highlight);
    if (!input) { return; }
    var segs = T.segment(input, matches);
    if (!matches.length) { $highlight.appendChild(document.createTextNode(input)); return; }
    segs.forEach(function (s) {
      if (!s.isMatch) {
        $highlight.appendChild(document.createTextNode(s.text));
      } else if (s.zeroWidth) {
        var z = document.createElement("mark");
        z.className = "zw";
        z.title = "zero-width match";
        $highlight.appendChild(z);
      } else {
        var mk = document.createElement("mark");
        mk.className = "m" + (s.matchIndex % 2 ? " alt" : "");
        mk.textContent = s.text;
        mk.title = "match #" + (s.matchIndex + 1);
        $highlight.appendChild(mk);
      }
    });
  }

  /* ---------- per-match group tables ---------- */
  function renderMatches(matches) {
    clear($matches);
    if (!matches.length) { $groupsWrap.classList.add("hidden"); return; }
    $groupsWrap.classList.remove("hidden");

    matches.forEach(function (m, i) {
      var card = document.createElement("div");
      card.className = "match-card";

      var head = document.createElement("div");
      head.className = "match-head";
      var idx = document.createElement("span");
      idx.className = "idx";
      idx.textContent = "Match #" + (i + 1) + " · [" + m.index + ", " + m.end + ")";
      var val = document.createElement("span");
      val.className = "val";
      val.textContent = m.end === m.index ? "(zero-width)" : JSON.stringify(m.match);
      head.appendChild(idx);
      head.appendChild(val);
      card.appendChild(head);

      if (m.groups.length) {
        var table = document.createElement("table");
        table.className = "groups-table";
        var thead = document.createElement("tr");
        ["Group", "Value", "Position"].forEach(function (h) {
          var th = document.createElement("th"); th.textContent = h; thead.appendChild(th);
        });
        table.appendChild(thead);
        m.groups.forEach(function (g) {
          var tr = document.createElement("tr");
          var label = document.createElement("td");
          label.textContent = String(g.n);
          if (g.name) {
            var nm = document.createElement("span");
            nm.className = "name";
            nm.textContent = " <" + g.name + ">";
            label.appendChild(nm);
          }
          var v = document.createElement("td");
          v.className = "v";
          if (g.value === null) { v.innerHTML = ""; v.appendChild(emptyNote("did not match")); }
          else v.textContent = JSON.stringify(g.value);
          var pos = document.createElement("td");
          pos.className = "pos";
          pos.textContent = g.start === null ? "—" : "[" + g.start + ", " + g.end + ")";
          tr.appendChild(label); tr.appendChild(v); tr.appendChild(pos);
          table.appendChild(tr);
        });
        card.appendChild(table);
      } else {
        card.appendChild(emptyNote("no capture groups"));
      }
      $matches.appendChild(card);
    });
  }

  function emptyNote(text) {
    var s = document.createElement("span");
    s.className = "empty-note";
    s.textContent = text;
    return s;
  }

  /* ---------- pattern explainer ---------- */
  function renderExplain(pattern) {
    clear($explain);
    if (!pattern) { $explain.appendChild(emptyNote("empty pattern")); return; }
    var tokens = T.explain(pattern);
    tokens.forEach(function (t) {
      var span = document.createElement("span");
      span.className = "tok";
      var code = document.createElement("code");
      code.textContent = t.text;
      var d = document.createElement("span");
      d.className = "d";
      d.textContent = t.desc;
      span.appendChild(code);
      span.appendChild(d);
      $explain.appendChild(span);
    });
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  /* ---------- wire up ---------- */
  [$pattern, $flags, $input].forEach(function (el) {
    el.addEventListener("input", render);
  });
  render();
})();
