/*
 * script.js — wires the form to RegexCore and renders the results in the page.
 * All the actual regex logic lives in regex-core.js so it can be unit-tested.
 */
(function () {
  "use strict";

  var form = document.getElementById("regex-form");
  var patternEl = document.getElementById("pattern");
  var flagsEl = document.getElementById("flags");
  var textEl = document.getElementById("text");
  var fnEl = document.getElementById("fn");
  var errorsEl = document.getElementById("errors");
  var clearBtn = document.getElementById("clear");

  var flagBoxes = [
    document.getElementById("flag-g"),
    document.getElementById("flag-i"),
    document.getElementById("flag-m"),
    document.getElementById("flag-y"),
  ];

  var resultEmpty = document.getElementById("result-empty");
  var resultEl = document.getElementById("result");
  var summaryEl = document.getElementById("summary");
  var highlightEl = document.getElementById("highlight");
  var matchesTable = document.getElementById("matches-table");
  var matchesBody = document.getElementById("matches-body");

  // Keep the read-only flags field mirroring the checkboxes.
  function currentFlags() {
    return flagBoxes
      .filter(function (b) { return b.checked; })
      .map(function (b) { return b.value; })
      .join("");
  }
  function syncFlags() {
    flagsEl.value = currentFlags();
  }
  flagBoxes.forEach(function (b) {
    b.addEventListener("change", syncFlags);
  });
  syncFlags();

  function showErrors(list) {
    errorsEl.innerHTML = "";
    list.forEach(function (msg) {
      var li = document.createElement("li");
      li.textContent = msg;
      errorsEl.appendChild(li);
    });
  }

  // Build the highlighted view. We rebuild the string from plain text nodes and
  // <mark> spans so nothing in the user's input can be interpreted as HTML.
  function renderHighlight(text, matches) {
    highlightEl.innerHTML = "";
    if (!matches.length) {
      highlightEl.appendChild(document.createTextNode(text));
      highlightEl.classList.add("no-match");
      return;
    }
    highlightEl.classList.remove("no-match");
    var cursor = 0;
    matches.forEach(function (m) {
      if (m.index > cursor) {
        highlightEl.appendChild(
          document.createTextNode(text.slice(cursor, m.index))
        );
      }
      var mark = document.createElement("mark");
      // Empty matches (zero-width) get a visible marker so they aren't invisible.
      mark.textContent = m.text.length ? m.text : "∅";
      if (!m.text.length) mark.classList.add("empty");
      highlightEl.appendChild(mark);
      cursor = m.index + m.text.length;
    });
    if (cursor < text.length) {
      highlightEl.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function renderMatchList(matches) {
    matchesBody.innerHTML = "";
    if (!matches.length) {
      matchesTable.hidden = true;
      return;
    }
    matches.forEach(function (m, i) {
      var tr = document.createElement("tr");
      var n = document.createElement("td");
      n.textContent = String(i + 1);
      var t = document.createElement("td");
      var code = document.createElement("code");
      code.textContent = m.text.length ? m.text : "(empty match)";
      t.appendChild(code);
      var idx = document.createElement("td");
      idx.textContent = String(m.index);
      tr.appendChild(n);
      tr.appendChild(t);
      tr.appendChild(idx);
      matchesBody.appendChild(tr);
    });
    matchesTable.hidden = false;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var pattern = patternEl.value;
    var text = textEl.value;
    var flags = currentFlags();
    var fn = fnEl.value;

    var problems = RegexCore.validate(pattern, text);
    if (problems.length) {
      showErrors(problems);
      resultEl.hidden = true;
      resultEmpty.hidden = false;
      return;
    }
    showErrors([]);

    var res = RegexCore.run(pattern, flags, text, fn);

    summaryEl.textContent = res.summary;
    summaryEl.classList.toggle("hit", res.matched);
    summaryEl.classList.toggle("miss", !res.matched);

    renderHighlight(text, res.matches);
    renderMatchList(res.matches);

    resultEmpty.hidden = true;
    resultEl.hidden = false;
  });

  clearBtn.addEventListener("click", function () {
    form.reset();
    flagBoxes.forEach(function (b) { b.checked = false; });
    syncFlags();
    showErrors([]);
    resultEl.hidden = true;
    resultEmpty.hidden = false;
  });
})();
