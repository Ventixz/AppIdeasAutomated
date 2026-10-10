/*
 * script.js — the browser glue for the Text Editor.
 *
 * All the real logic is in editor-core.js (window.EDITOR); this file wires a
 * <textarea> to it. The one genuinely fiddly part lives here: the `input` event
 * gives us only the textarea's NEW value, so on every change we
 *
 *   1. classify the change (grew at the caret = insert, shrank = delete, else
 *      other) by comparing the new value and caret to the previous ones;
 *   2. hand the whole new value to EDITOR.History.commit, which diffs it against
 *      the live document and decides whether to coalesce;
 *   3. read selectionStart (a UTF-16 index) and convert it to a code-point
 *      offset before storing it, so a caret sitting after an emoji is recorded
 *      and restored correctly.
 *
 * Open uses FileReader, Save builds a Blob and clicks a temporary <a download>,
 * and a working copy is mirrored to localStorage — every storage access wrapped
 * in try/catch so a private window or blocked storage degrades quietly.
 *
 * The ✓ Verified line runs the same exactness check the test suite does, live:
 * the history's steps, reconstructed forward from the initial document with
 * applyEdit, must reproduce the current text. A regression lights up on the
 * page, not just in CI.
 */
"use strict";
(function () {
  var E = window.EDITOR;
  var $ = function (id) { return document.getElementById(id); };

  var editor = $("editor");
  var fname = $("fname"), dirty = $("dirty");
  var btnNew = $("btnNew"), btnOpen = $("btnOpen"), btnSave = $("btnSave");
  var btnUndo = $("btnUndo"), btnRedo = $("btnRedo");
  var fileInput = $("fileInput");
  var stChars = $("stChars"), stWords = $("stWords"), stLines = $("stLines"), stBytes = $("stBytes");
  var verify = $("verify");
  var hist = $("hist"), histLegend = $("histLegend");
  var cmpCoalesced = $("cmpCoalesced"), cmpNaive = $("cmpNaive"), cmpNote = $("cmpNote");
  var autosave = $("autosave");

  var STORE_KEY = "appideas.text-editor.draft";

  // ----- editor state -----
  var history = new E.History("");
  var fileName = "untitled.txt";
  var savedDoc = "";           // the text as of the last Save / Open / New
  var naiveSteps = 0;          // one per input event, the rival's tally
  var prevValue = "";          // last value we saw (to classify the next change)

  // Convert the textarea's UTF-16 caret to a code-point offset and back.
  function caretCp() { return E.utf16ToCp(editor.value, editor.selectionStart); }
  function setCaretCp(doc, cpIndex) {
    var u = E.cpToUtf16(doc, cpIndex);
    try { editor.setSelectionRange(u, u); } catch (e) { /* detached node, ignore */ }
  }

  // Classify a change by how the length and caret moved. Pure typing grows the
  // document by text inserted at the caret; Backspace/Delete shrink it; a paste
  // over a selection, or anything that both adds and removes, is "other" and
  // always starts its own undo step.
  function classify(before, after, caretAfterCp) {
    var d = E.diffEdit(before, after);
    if (d.insert && !d.removed) return E.KINDS.INSERT;
    if (d.removed && !d.insert) return E.KINDS.DELETE;
    return E.KINDS.OTHER;
  }

  // ----- rendering -----
  function renderStats() {
    var s = E.stats(editor.value);
    stChars.textContent = s.chars + (s.chars === 1 ? " char" : " chars");
    stWords.textContent = s.words + (s.words === 1 ? " word" : " words");
    stLines.textContent = s.lines + (s.lines === 1 ? " line" : " lines");
    stBytes.textContent = humanBytes(s.bytes);
  }

  function humanBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderButtons() {
    btnUndo.disabled = !history.canUndo();
    btnRedo.disabled = !history.canRedo();
  }

  function renderDirty() {
    var isDirty = editor.value !== savedDoc;
    dirty.hidden = !isDirty;
    document.title = (isDirty ? "• " : "") + fileName + " — Text Editor";
  }

  // The history strip: one block per undo step, filled up to `index`, hollow
  // after. A short label on each block names the net edit it represents.
  function renderHistory() {
    hist.innerHTML = "";
    var n = history.size();
    if (n === 0) {
      var empty = document.createElement("span");
      empty.className = "hist-empty";
      empty.textContent = "No edits yet.";
      hist.appendChild(empty);
    }
    for (var i = 0; i < n; i++) {
      var st = history.steps[i];
      var block = document.createElement("span");
      block.className = "hblock " + (i < history.index ? "on" : "off");
      block.title = describeStep(st);
      block.textContent = labelStep(st);
      hist.appendChild(block);
    }
    histLegend.textContent = history.index + " of " + n +
      (n === 1 ? " step applied" : " steps applied");
  }

  function labelStep(st) {
    if (st.newText && !st.oldText) return "+" + snippet(st.newText);
    if (st.oldText && !st.newText) return "−" + snippet(st.oldText);
    return "±" + snippet(st.newText || st.oldText);
  }
  function describeStep(st) {
    if (st.newText && !st.oldText) return 'inserted "' + st.newText + '"';
    if (st.oldText && !st.newText) return 'deleted "' + st.oldText + '"';
    return 'replaced "' + st.oldText + '" with "' + st.newText + '"';
  }
  function snippet(s) {
    s = s.replace(/\n/g, "⏎"); // show newline as the return symbol
    var pts = E.cp(s);
    return pts.length <= 8 ? s : pts.slice(0, 7).join("") + "…";
  }

  function renderCompare() {
    var coalesced = history.size();
    cmpCoalesced.textContent = coalesced;
    cmpNaive.textContent = naiveSteps;
    if (naiveSteps === 0) {
      cmpNote.innerHTML = "Type a few words to see the gap open.";
    } else if (coalesced < naiveSteps) {
      var saved = naiveSteps - coalesced;
      cmpNote.innerHTML = "Coalescing folded <b>" + naiveSteps +
        "</b> keystroke-level changes into <b>" + coalesced +
        "</b> undo " + (coalesced === 1 ? "step" : "steps") +
        " — <b class='good'>" + saved + " fewer</b> presses of Ctrl+Z to take back this session.";
    } else {
      cmpNote.innerHTML = "Every change here was its own step (newlines, pauses " +
        "and caret jumps break the run), so the two counts match.";
    }
  }

  // Live exactness check — the ✓ Verified line. Reconstruct the current text by
  // applying the applied steps forward from the initial document; it must equal
  // what's in the box.
  function renderVerify() {
    var ok = true;
    try {
      var doc = history.initial;
      for (var i = 0; i < history.index; i++) {
        var st = history.steps[i];
        doc = E.applyEdit(doc, {
          from: st.from, to: st.from + E.cpLen(st.oldText), insert: st.newText
        }).doc;
      }
      ok = (doc === editor.value) && (history.current === editor.value);
    } catch (e) { ok = false; }
    verify.textContent = ok ? "✓ history exact" : "✗ history drift";
    verify.className = "verify " + (ok ? "ok" : "bad");
  }

  function renderAll() {
    renderStats();
    renderButtons();
    renderDirty();
    renderHistory();
    renderCompare();
    renderVerify();
  }

  // ----- autosave -----
  function autosaveWrite() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        name: fileName, text: editor.value, at: Date.now()
      }));
      autosave.textContent = "Saved to this browser at " + timeNow() + ".";
    } catch (e) {
      autosave.textContent = "Browser storage unavailable — autosave off.";
    }
  }
  function autosaveRead() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function timeNow() {
    var d = new Date();
    return d.toLocaleTimeString();
  }

  // ----- the core change handler -----
  // Called on every `input`. Classify, commit to the History, mirror to
  // storage, repaint. caretBefore is recomputed from prevValue so a step undoes
  // back to where the caret was before the change, not after it.
  function onChange() {
    var before = prevValue;
    var after = editor.value;
    if (after === before) return;
    var caretAfter = caretCp();
    var kind = classify(before, after, caretAfter);
    // Caret before the edit: the start of the diffed range.
    var caretBefore = E.diffEdit(before, after).from;
    var res = history.commit(after, caretAfter, {
      kind: kind, time: Date.now(), caretBefore: caretBefore
    });
    if (!res.noop) naiveSteps++;
    prevValue = after;
    autosaveWrite();
    renderAll();
  }

  // ----- commands -----
  function doUndo() {
    var r = history.undo();
    if (!r) return;
    editor.value = r.doc;
    prevValue = r.doc;
    setCaretCp(r.doc, r.caret);
    editor.focus();
    autosaveWrite();
    renderAll();
  }
  function doRedo() {
    var r = history.redo();
    if (!r) return;
    editor.value = r.doc;
    prevValue = r.doc;
    setCaretCp(r.doc, r.caret);
    editor.focus();
    autosaveWrite();
    renderAll();
  }

  function doNew() {
    if (editor.value !== savedDoc &&
        !window.confirm("Discard unsaved changes and start a new document?")) return;
    loadText("", "untitled.txt");
  }

  function doOpen() { fileInput.click(); }

  function onFilePicked(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      loadText(String(reader.result), file.name || "untitled.txt");
    };
    reader.onerror = function () {
      window.alert("Could not read that file.");
    };
    reader.readAsText(file);
    fileInput.value = ""; // allow re-opening the same file
  }

  // Load fresh text as a new document: reset the history to it, so Open and New
  // start a clean undo timeline (you can't undo back into the previous file).
  function loadText(text, name) {
    editor.value = text;
    prevValue = text;
    fileName = name;
    fname.textContent = name;
    savedDoc = text;
    history = new E.History(text);
    naiveSteps = 0;
    setCaretCp(text, 0);
    editor.focus();
    autosaveWrite();
    renderAll();
  }

  function doSave() {
    var text = editor.value;
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName || "untitled.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    savedDoc = text;
    renderDirty();
  }

  // ----- keyboard shortcuts -----
  document.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var key = e.key.toLowerCase();
    if (key === "s") { e.preventDefault(); doSave(); }
    else if (key === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); doRedo(); }
    else if (key === "o") { e.preventDefault(); doOpen(); }
  });

  // ----- wiring -----
  editor.addEventListener("input", onChange);
  // Keep caretBefore accurate after caret-only moves (arrow keys, clicks don't
  // change the value, so onChange won't fire — prevValue stays correct).
  btnNew.addEventListener("click", doNew);
  btnOpen.addEventListener("click", doOpen);
  btnSave.addEventListener("click", doSave);
  btnUndo.addEventListener("click", doUndo);
  btnRedo.addEventListener("click", doRedo);
  fileInput.addEventListener("change", onFilePicked);

  // ----- boot: restore an autosaved draft if present -----
  (function boot() {
    var saved = autosaveRead();
    if (saved && typeof saved.text === "string" && saved.text.length) {
      editor.value = saved.text;
      prevValue = saved.text;
      fileName = saved.name || "untitled.txt";
      fname.textContent = fileName;
      savedDoc = saved.text;           // restored copy counts as "saved" state
      history = new E.History(saved.text);
      autosave.textContent = "Restored a draft autosaved earlier in this browser.";
    } else {
      autosave.textContent = "Nothing saved yet.";
    }
    renderAll();
    editor.focus();
  })();
})();
