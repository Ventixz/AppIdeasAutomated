/*
 * editor-core.js — the engine behind the Text Editor.
 *
 * karan/Projects asks for "a Notepad which can open, write, and save
 * documents." Opening a file and saving a Blob is the easy 20 lines. The part
 * that actually makes a text editor an editor — and the part every naive
 * tutorial gets wrong — is the two problems underneath the typing:
 *
 *   1. AN `input` EVENT DOESN'T TELL YOU WHAT CHANGED. The browser hands you the
 *      new value of the <textarea> and nothing else: not where the edit was,
 *      not whether it was a type, a paste, a delete, or a select-all-and-retype.
 *      The naive editor throws the old value away and keeps the new one whole.
 *      A real editor must DIFF the old and new strings to recover the minimal
 *      changed range {from, to, insert} — because everything below needs it.
 *
 *   2. UNDO IS NOT "ONE STEP PER KEYSTROKE". Press Ctrl+Z in any real editor
 *      after typing "hello" and the whole word disappears in one step, not five.
 *      Editors COALESCE a run of contiguous typing (or a run of backspacing)
 *      into a single undo group, and BREAK the group when you jump the caret,
 *      switch from typing to deleting, cross a newline, or pause. The naive
 *      editor pushes one undo entry per input event, so Ctrl+Z claws the text
 *      back one character at a time — the single most common home-grown-editor
 *      complaint there is.
 *
 * Both are implemented here, DOM-free, so they run in Node and the browser and
 * the test suite can cross-check them:
 *
 *   - diffEdit / applyEdit        the minimal-edit model, code-point safe so an
 *                                 emoji or a combining mark is never split.
 *   - History                     coalescing undo/redo built on that model.
 *   - naiveUndoSteps              the deliberately-wrong one-step-per-event
 *                                 counter, kept so the gap can be shown, not
 *                                 asserted.
 *
 * Everything works in CODE POINTS, not UTF-16 units. `"😀".length` is 2 in
 * JavaScript; splitting an edit between those two halves yields a lone
 * surrogate and mojibake. Every offset below indexes code points, and the
 * utf16<->cp helpers convert at the <textarea> boundary where selectionStart
 * is still a UTF-16 index.
 */
"use strict";
(function (root) {

  /* ---------------- code-point primitives ---------------- */

  // Array of code points (each a 1- or 2-UTF-16-unit string). Array.from and
  // the spread both iterate by code point, so astral characters stay whole.
  function cp(str) { return Array.from(str); }
  function cpLen(str) { return cp(str).length; }

  // Convert a UTF-16 index (what the DOM gives you via selectionStart) to a
  // code-point index, and back. Used only at the <textarea> boundary.
  function utf16ToCp(str, i) { return Array.from(str.slice(0, i)).length; }
  function cpToUtf16(str, n) { return cp(str).slice(0, n).join("").length; }

  /* ---------------- the minimal-edit model ---------------- */

  // diffEdit(old, new): the single contiguous range that changed, as code-point
  // offsets into `old`. Peel a common prefix and a (non-overlapping) common
  // suffix; whatever is left in the middle is the edit. The result is minimal:
  // `from` is the first differing code point and `to` the last, so no unchanged
  // text is ever dragged into the edit.
  //
  //   diffEdit("the cat", "the dog")  -> { from: 4, to: 7, insert: "dog", removed: "cat" }
  //   diffEdit("abc", "abXc")         -> { from: 2, to: 2, insert: "X",   removed: "" }
  //   diffEdit("abXc", "abc")         -> { from: 2, to: 3, insert: "",    removed: "X" }
  function diffEdit(oldStr, newStr) {
    var a = cp(oldStr), b = cp(newStr);
    var n = a.length, m = b.length;
    var i = 0;
    while (i < n && i < m && a[i] === b[i]) i++;
    var j = 0;
    while (j < n - i && j < m - i && a[n - 1 - j] === b[m - 1 - j]) j++;
    return {
      from: i,
      to: n - j,
      insert: b.slice(i, m - j).join(""),
      removed: a.slice(i, n - j).join("")
    };
  }

  // applyEdit(doc, edit): replace code-point range [from, to) of `doc` with
  // edit.insert. Returns the new document AND the inverse edit, so the exact
  // same machinery runs undo. inverse.insert is whatever this edit removed, and
  // its range is where the inserted text now sits — apply the inverse to the
  // result and you are back to `doc`, bit for bit.
  function applyEdit(doc, edit) {
    var a = cp(doc);
    var from = edit.from, to = edit.to;
    if (from < 0 || to < from || to > a.length) {
      throw new RangeError("edit range [" + from + "," + to + ") out of [0," + a.length + "]");
    }
    var removed = a.slice(from, to).join("");
    var after = a.slice(0, from).join("") + edit.insert + a.slice(to).join("");
    var inverse = {
      from: from,
      to: from + cpLen(edit.insert),
      insert: removed,
      removed: edit.insert
    };
    return { doc: after, inverse: inverse, removed: removed };
  }

  /* ---------------- coalescing undo/redo ---------------- */

  // How a change is classified, which decides whether it extends the open undo
  // group or starts a new one. The editor labels each change; the History only
  // ever coalesces "insert" with "insert" and "delete" with "delete".
  var KINDS = { INSERT: "insert", DELETE: "delete", OTHER: "other" };

  // History(initialDoc): an undo/redo stack whose steps are net edits computed
  // with diffEdit. A "step" is one undo-able unit:
  //   { from, oldText, newText, caretBefore, caretAfter }
  // meaning: in the document BEFORE the step, the code-point range
  // [from, from+len(oldText)) holds oldText and becomes newText; undo swaps
  // them. Steps after `index` are the redo tail, discarded the moment a fresh
  // edit is committed.
  function History(initialDoc) {
    this.current = initialDoc == null ? "" : String(initialDoc);
    this.initial = this.current;
    this.steps = [];
    this.index = 0;          // number of steps currently applied
    this.coalesceMs = 700;   // a pause longer than this breaks the group
    this._group = null;      // the open, still-growing group (or null)
  }

  // commit(newDoc, caretAfter, meta): record the transition current -> newDoc.
  // meta = { kind, time, caretBefore }. Returns { coalesced, noop }.
  //
  // The whole coalescing decision lives here. We EXTEND the open group — i.e.
  // rewrite the top step in place rather than pushing a new one — only when all
  // of these hold:
  //   * there is an open group and we are at the tip (no pending redo);
  //   * this change is the same coalescible kind as the group;
  //   * it arrived within coalesceMs of the last one;
  //   * the group has not been sealed (a newline seals it, so each line is at
  //     least one undo step — matching how editors break undo at line breaks).
  // Otherwise we close the group and push a brand-new step.
  History.prototype.commit = function (newDoc, caretAfter, meta) {
    newDoc = String(newDoc);
    meta = meta || {};
    var kind = meta.kind || KINDS.OTHER;
    var time = meta.time == null ? now() : meta.time;
    if (newDoc === this.current) return { coalesced: false, noop: true };

    var coalescible = (kind === KINDS.INSERT || kind === KINDS.DELETE);
    var g = this._group;
    var canExtend = !!g &&
      this.index === this.steps.length &&
      coalescible &&
      kind === g.kind &&
      !g.sealed &&
      (time - g.lastTime) <= this.coalesceMs;

    if (canExtend) {
      var net = diffEdit(g.startDoc, newDoc);
      var top = this.steps[this.index - 1];
      top.from = net.from;
      top.oldText = net.removed;
      top.newText = net.insert;
      top.caretAfter = caretAfter;
      g.lastTime = time;
      if (sealsGroup(kind, net.insert)) g.sealed = true;
      this.current = newDoc;
      return { coalesced: true, noop: false };
    }

    // New step: drop any redo tail, diff against the live document, push.
    var before = this.current;
    var d = diffEdit(before, newDoc);
    this.steps.length = this.index;
    var caretBefore = meta.caretBefore == null ? d.from : meta.caretBefore;
    this.steps.push({
      from: d.from,
      oldText: d.removed,
      newText: d.insert,
      caretBefore: caretBefore,
      caretAfter: caretAfter
    });
    this.index++;
    this.current = newDoc;
    this._group = {
      startDoc: before,
      kind: kind,
      lastTime: time,
      caretBefore: caretBefore,
      sealed: !coalescible || sealsGroup(kind, d.insert)
    };
    return { coalesced: false, noop: false };
  };

  // A newline just typed ends the group, so the next line starts a fresh undo
  // step. Deletes never self-seal (hold Backspace and the whole run is one
  // step, which is what people expect).
  function sealsGroup(kind, insertedText) {
    return kind === KINDS.INSERT && /\n$/.test(insertedText);
  }

  History.prototype.canUndo = function () { return this.index > 0; };
  History.prototype.canRedo = function () { return this.index < this.steps.length; };

  // undo(): revert the top applied step. In the current (after) document the
  // range [from, from+len(newText)) holds newText; put oldText back. Returns
  // the new document and the caret to restore, or null if nothing to undo.
  // Undoing always closes the open group, so later typing cannot merge across
  // an undo boundary.
  History.prototype.undo = function () {
    if (this.index === 0) return null;
    this._group = null;
    var step = this.steps[this.index - 1];
    var res = applyEdit(this.current, {
      from: step.from,
      to: step.from + cpLen(step.newText),
      insert: step.oldText
    });
    this.current = res.doc;
    this.index--;
    return { doc: this.current, caret: step.caretBefore };
  };

  // redo(): re-apply the next step. In the current (before) document the range
  // [from, from+len(oldText)) holds oldText; put newText back.
  History.prototype.redo = function () {
    if (this.index === this.steps.length) return null;
    this._group = null;
    var step = this.steps[this.index];
    var res = applyEdit(this.current, {
      from: step.from,
      to: step.from + cpLen(step.oldText),
      insert: step.newText
    });
    this.current = res.doc;
    this.index++;
    return { doc: this.current, caret: step.caretAfter };
  };

  // How many undo groups exist, and how many are currently applied — the
  // numbers the page's history strip draws.
  History.prototype.size = function () { return this.steps.length; };

  /* ---------------- the naive rival, kept honest on purpose ---------------- */

  // naiveUndoSteps(docSequence): the count-every-keystroke model. Given the
  // list of document states a session passed through (the first is the starting
  // document, the rest one per input event), the naive editor pushes one undo
  // entry per CHANGE — so the step count is the number of transitions, not the
  // number of states (the starting document is not something you can undo to a
  // prior state). This is exactly the "Ctrl+Z deletes one character at a time"
  // behaviour, quantified so the README and tests can show the gap against
  // History's coalesced count instead of merely claiming it.
  function naiveUndoSteps(docSequence) {
    if (docSequence.length === 0) return 0;
    var steps = 0, prev = docSequence[0];
    for (var i = 1; i < docSequence.length; i++) {
      if (docSequence[i] !== prev) { steps++; prev = docSequence[i]; }
    }
    return steps;
  }

  // Replay a sequence of document states through a History, classifying each
  // transition the way the editor would (grew at the caret = insert, shrank =
  // delete, otherwise other). Returns the History so callers can read .size().
  // Shared by the live page's "coalesced vs naive" readout and the tests.
  function replay(docSequence, opts) {
    opts = opts || {};
    var h = new History(docSequence.length ? docSequence[0] : "");
    if (opts.coalesceMs != null) h.coalesceMs = opts.coalesceMs;
    var t = 0;
    for (var i = 1; i < docSequence.length; i++) {
      var prev = docSequence[i - 1], next = docSequence[i];
      var d = diffEdit(prev, next);
      var kind = d.insert && !d.removed ? KINDS.INSERT
        : d.removed && !d.insert ? KINDS.DELETE
          : KINDS.OTHER;
      t += opts.step == null ? 1 : opts.step; // simulated ms between events
      h.commit(next, d.from + cpLen(d.insert), {
        kind: kind, time: t, caretBefore: d.from
      });
    }
    return h;
  }

  /* ---------------- document statistics ---------------- */

  var WORDISH = /[\p{L}\p{N}]/u;

  // Words: whitespace-delimited tokens carrying at least one letter or digit —
  // the same honest rule the Count Words project landed on, so "hi :) !!!" is
  // one word, not three, and "" is zero, not one.
  function countWords(str) {
    if (!str) return 0;
    var toks = str.split(/\p{White_Space}+/u);
    var n = 0;
    for (var i = 0; i < toks.length; i++) {
      if (toks[i] && WORDISH.test(toks[i])) n++;
    }
    return n;
  }

  // UTF-8 byte length without TextEncoder, so the number is right on every
  // runtime and is honestly bytes-on-disk, not JavaScript's UTF-16 .length.
  function utf8Bytes(str) {
    var b = 0;
    var arr = cp(str);
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i].codePointAt(0);
      b += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return b;
  }

  // stats(doc): the live readout. chars are code points (so one emoji is one
  // character, not two); lines is newline count + 1 for a non-empty document,
  // and 0 for the empty one.
  function stats(doc) {
    doc = doc == null ? "" : String(doc);
    return {
      chars: cpLen(doc),
      bytes: utf8Bytes(doc),
      words: countWords(doc),
      lines: doc.length === 0 ? 0 : doc.split("\n").length
    };
  }

  function now() {
    return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
  }

  /* ---------------- exports ---------------- */

  var API = {
    cp: cp,
    cpLen: cpLen,
    utf16ToCp: utf16ToCp,
    cpToUtf16: cpToUtf16,
    diffEdit: diffEdit,
    applyEdit: applyEdit,
    History: History,
    KINDS: KINDS,
    naiveUndoSteps: naiveUndoSteps,
    replay: replay,
    countWords: countWords,
    utf8Bytes: utf8Bytes,
    stats: stats
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  } else {
    root.EDITOR = API;
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
