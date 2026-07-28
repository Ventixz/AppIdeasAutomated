'use strict';

/*  ==========================================================================
 *  LaTeX → MathML core
 *  --------------------------------------------------------------------------
 *  This is the real project: a tiny, dependency-free compiler that turns a
 *  useful subset of LaTeX math into native browser MathML. It has NO DOM
 *  dependencies — it takes a string and returns a string — so it can be
 *  unit-tested straight from Node (see the README "Sanity check" section).
 *  Everything below the "App wiring" banner is the editor that drives it.
 *  ========================================================================== */

/* Named symbols → the Unicode character MathML should show. */
var SYM = {
  // lower-case greek
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  // upper-case greek
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // operators & relations
  times: '×', div: '÷', cdot: '⋅', pm: '±', mp: '∓', ast: '∗', star: '⋆',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  equiv: '≡', cong: '≅', sim: '∼', propto: '∝', ll: '≪', gg: '≫',
  subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', in: '∈',
  notin: '∉', ni: '∋', cup: '∪', cap: '∩', emptyset: '∅', infty: '∞',
  partial: '∂', nabla: '∇', forall: '∀', exists: '∃', neg: '¬', lnot: '¬',
  wedge: '∧', vee: '∨', oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥',
  angle: '∠', triangle: '△', circ: '∘', bullet: '∙', dagger: '†', prime: '′',
  degree: '°',
  // arrows
  rightarrow: '→', to: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒',
  Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦',
  // dots
  cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱',
  // big operators
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', oint: '∮',
  bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂'
};

/* Big operators whose sub/super-scripts sit under/over the symbol. */
var BIGOPS = { sum: 1, prod: 1, coprod: 1, bigcup: 1, bigcap: 1, bigoplus: 1, bigotimes: 1 };

/* Named functions rendered as an upright word (e.g. \sin, \log). */
var FUNCS = {
  sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1, sinh: 1, cosh: 1, tanh: 1,
  log: 1, ln: 1, lg: 1, exp: 1, arg: 1, dim: 1, ker: 1, deg: 1, hom: 1
};

/* Functions that take movable limits (e.g. \lim_{x\to0}). */
var LIMOPS = { lim: 1, max: 1, min: 1, sup: 1, inf: 1, det: 1, gcd: 1, Pr: 1 };

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* --- tokenizer --------------------------------------------------------- */
function tokenize(src) {
  var tokens = [];
  var i = 0;
  while (i < src.length) {
    var c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '\\') {
      var j = i + 1;
      if (j < src.length && /[a-zA-Z]/.test(src[j])) {
        var name = '';
        while (j < src.length && /[a-zA-Z]/.test(src[j])) { name += src[j]; j++; }
        tokens.push({ t: 'cmd', v: name });
        i = j;
      } else {
        // escaped single char: \{  \}  \,  \\  \%  ...
        tokens.push({ t: 'cmd', v: src[j] === undefined ? '' : src[j] });
        i = j + 1;
      }
      continue;
    }
    if (/[0-9]/.test(c)) {
      var num = '';
      while (i < src.length && /[0-9.]/.test(src[i])) { num += src[i]; i++; }
      tokens.push({ t: 'num', v: num });
      continue;
    }
    if (/[a-zA-Z]/.test(c)) { tokens.push({ t: 'var', v: c }); i++; continue; }
    if (c === '{') { tokens.push({ t: 'lb' }); i++; continue; }
    if (c === '}') { tokens.push({ t: 'rb' }); i++; continue; }
    if (c === '[') { tokens.push({ t: 'lk' }); i++; continue; }
    if (c === ']') { tokens.push({ t: 'rk' }); i++; continue; }
    if (c === '^') { tokens.push({ t: 'sup' }); i++; continue; }
    if (c === '_') { tokens.push({ t: 'sub' }); i++; continue; }
    tokens.push({ t: 'op', v: c }); i++;
  }
  return tokens;
}

/* --- parser ------------------------------------------------------------ */
function peek(s) { return s.tokens[s.pos]; }

function parseSequence(s, stop) {
  var out = [];
  while (s.pos < s.tokens.length) {
    var t = s.tokens[s.pos];
    if (t.t === stop) break;
    if (t.t === 'rb' || t.t === 'rk') break; // never consume a closer we don't own
    var atom = parseAtom(s);
    if (atom === null) break;
    out.push(parseScripts(s, atom));
  }
  return out;
}

/* A brace group, or a single atom if no braces follow. Always returns an
 * <mrow>…</mrow> so it can slot straight into mfrac / msup / etc. */
function parseGroup(s) {
  var t = peek(s);
  if (t && t.t === 'lb') {
    s.pos++;
    var seq = parseSequence(s, 'rb');
    if (peek(s) && peek(s).t === 'rb') s.pos++;
    return '<mrow>' + seq.join('') + '</mrow>';
  }
  var a = parseAtom(s);
  return '<mrow>' + (a ? a.ml : '') + '</mrow>';
}

function parseAtom(s) {
  var t = peek(s);
  if (!t) return null;
  switch (t.t) {
    case 'num': s.pos++; return { ml: '<mn>' + esc(t.v) + '</mn>', big: false };
    case 'var': s.pos++; return { ml: '<mi>' + esc(t.v) + '</mi>', big: false };
    case 'op':  s.pos++; return { ml: '<mo>' + esc(t.v) + '</mo>', big: false };
    case 'lb': {
      s.pos++;
      var seq = parseSequence(s, 'rb');
      if (peek(s) && peek(s).t === 'rb') s.pos++;
      return { ml: '<mrow>' + seq.join('') + '</mrow>', big: false };
    }
    case 'cmd': return parseCommand(s);
    case 'sup': case 'sub':
      // a stray script marker with nothing before it — show it literally
      s.pos++;
      return { ml: '<mo>' + (t.t === 'sup' ? '^' : '_') + '</mo>', big: false };
    default:
      s.pos++;
      return { ml: '', big: false };
  }
}

function parseCommand(s) {
  var t = s.tokens[s.pos]; s.pos++;
  var name = t.v;

  if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
    var a = parseGroup(s), b = parseGroup(s);
    return { ml: '<mfrac>' + a + b + '</mfrac>', big: false };
  }
  if (name === 'binom') {
    var top = parseGroup(s), bot = parseGroup(s);
    return {
      ml: '<mrow><mo>(</mo><mfrac linethickness="0">' + top + bot +
          '</mfrac><mo>)</mo></mrow>', big: false
    };
  }
  if (name === 'sqrt') {
    if (peek(s) && peek(s).t === 'lk') {
      s.pos++;
      var idx = parseSequence(s, 'rk');
      if (peek(s) && peek(s).t === 'rk') s.pos++;
      var rad = parseGroup(s);
      return { ml: '<mroot>' + rad + '<mrow>' + idx.join('') + '</mrow></mroot>', big: false };
    }
    return { ml: '<msqrt>' + parseGroup(s) + '</msqrt>', big: false };
  }
  if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
    // grab the raw contents of the following group as text
    return { ml: '<mtext>' + esc(rawGroup(s)) + '</mtext>', big: false };
  }
  if (name === 'left' || name === 'right') {
    // \left( … \right) — the delimiter is the next token; emit it as a fence
    var d = s.tokens[s.pos]; s.pos++;
    var ch = d ? (d.v === undefined ? '' : d.v) : '';
    if (ch === '.') ch = '';
    return { ml: ch ? '<mo>' + esc(ch) + '</mo>' : '', big: false };
  }
  if (name === ',' || name === ':' || name === ';' || name === ' ') {
    return { ml: '<mspace width="0.22em"></mspace>', big: false };
  }
  if (name === '{' || name === '}' || name === '%' || name === '&' ||
      name === '#' || name === '$' || name === '_') {
    return { ml: '<mo>' + esc(name) + '</mo>', big: false };
  }

  if (Object.prototype.hasOwnProperty.call(SYM, name)) {
    return { ml: '<mo>' + SYM[name] + '</mo>', big: !!BIGOPS[name] };
  }
  if (LIMOPS[name]) {
    return { ml: '<mo movablelimits="true">' + name + '</mo>', big: true };
  }
  if (FUNCS[name]) {
    return { ml: '<mi>' + name + '</mi>', big: false };
  }
  // unknown command — render the name so nothing silently vanishes
  return { ml: '<mi>' + esc(name) + '</mi>', big: false };
}

/* Read a group as literal characters (for \text{...}). */
function rawGroup(s) {
  var out = '';
  if (peek(s) && peek(s).t === 'lb') {
    s.pos++;
    var depth = 1;
    while (s.pos < s.tokens.length && depth > 0) {
      var t = s.tokens[s.pos++];
      if (t.t === 'lb') { depth++; out += '{'; }
      else if (t.t === 'rb') { depth--; if (depth > 0) out += '}'; }
      else if (t.t === 'cmd') out += '\\' + t.v;
      else if (t.v !== undefined) out += t.v;
      else out += ' ';
    }
    return out.trim();
  }
  var a = parseAtom(s);
  return a ? a.ml.replace(/<[^>]+>/g, '') : '';
}

/* Attach any trailing _ / ^ scripts to a freshly parsed atom. */
function parseScripts(s, atom) {
  var sub = null, sup = null;
  while (s.pos < s.tokens.length) {
    var t = s.tokens[s.pos];
    if (t.t === 'sub' && sub === null) { s.pos++; sub = parseGroup(s); }
    else if (t.t === 'sup' && sup === null) { s.pos++; sup = parseGroup(s); }
    else break;
  }
  if (sub === null && sup === null) return atom.ml;
  var base = atom.ml;
  if (atom.big) {
    if (sub !== null && sup !== null) return '<munderover>' + base + sub + sup + '</munderover>';
    if (sub !== null) return '<munder>' + base + sub + '</munder>';
    return '<mover>' + base + sup + '</mover>';
  }
  if (sub !== null && sup !== null) return '<msubsup>' + base + sub + sup + '</msubsup>';
  if (sub !== null) return '<msub>' + base + sub + '</msub>';
  return '<msup>' + base + sup + '</msup>';
}

/* Public: LaTeX string → MathML <mrow> string. Pure, DOM-free. */
function latexToMathML(latex) {
  var s = { tokens: tokenize(String(latex == null ? '' : latex)), pos: 0 };
  var seq = parseSequence(s, null);
  return '<mrow>' + seq.join('') + '</mrow>';
}

/* Public: wrap a formula in a full <math> element. Pure, DOM-free. */
function renderMath(latex, display) {
  return '<math xmlns="http://www.w3.org/1998/Math/MathML" display="' +
    (display ? 'block' : 'inline') + '">' + latexToMathML(latex) + '</math>';
}

/* Export for Node sanity checks; harmless in the browser. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { latexToMathML: latexToMathML, renderMath: renderMath, tokenize: tokenize };
}

/*  ====== App wiring =======================================================
 *  Everything below drives the on-page editor: the rich-text document, the
 *  formula dialog, and save / load. None of it is needed to compile LaTeX.
 *  ========================================================================= */
(function () {
  if (typeof document === 'undefined') return; // running under Node

  var doc = document.getElementById('doc');
  var dlg = document.getElementById('formula-dialog');
  var latexInput = document.getElementById('latex-input');
  var preview = document.getElementById('formula-preview');
  var displayToggle = document.getElementById('display-toggle');
  var status = document.getElementById('status');

  var savedRange = null;      // caret position inside the doc when a dialog opens
  var editingNode = null;     // the formula span currently being re-edited

  /* ---- selection helpers ---- */
  function saveRange() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount && doc.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  }
  function restoreRange() {
    if (!savedRange) { doc.focus(); return; }
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  document.addEventListener('selectionchange', function () {
    if (dlg.open) return;
    saveRange();
  });

  function flash(msg) {
    status.textContent = msg;
    status.classList.add('show');
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { status.classList.remove('show'); }, 2400);
  }

  /* ---- rich-text toolbar (bonus: font size, colour, bold, …) ---- */
  function exec(cmd, val) {
    doc.focus();
    restoreRange();
    document.execCommand(cmd, false, val);
    saveRange();
  }

  document.querySelectorAll('[data-cmd]').forEach(function (btn) {
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () { exec(btn.dataset.cmd, btn.dataset.val || null); });
  });

  document.getElementById('font-size').addEventListener('change', function (e) {
    exec('fontSize', e.target.value);
  });
  document.getElementById('fore-color').addEventListener('input', function (e) {
    exec('foreColor', e.target.value);
  });

  /* ---- insert image (bonus) ---- */
  document.getElementById('image-file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      restoreRange();
      // stored as a data: URI so a saved document is fully self-contained
      document.execCommand('insertImage', false, reader.result);
      saveRange();
      flash('Image inserted');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  /* ---- formula dialog ---- */
  function openFormulaDialog(node) {
    editingNode = node || null;
    saveRange();
    latexInput.value = node ? (node.getAttribute('data-latex') || '') : '';
    displayToggle.checked = node ? node.getAttribute('data-display') === 'block' : false;
    updatePreview();
    dlg.showModal();
    latexInput.focus();
    latexInput.select();
  }

  function updatePreview() {
    var latex = latexInput.value;
    preview.innerHTML = latex.trim()
      ? renderMath(latex, displayToggle.checked)
      : '<span class="preview-empty">Your formula appears here…</span>';
  }
  latexInput.addEventListener('input', updatePreview);
  displayToggle.addEventListener('change', updatePreview);

  document.getElementById('insert-formula').addEventListener('click', function () {
    openFormulaDialog(null);
  });
  document.getElementById('formula-cancel').addEventListener('click', function () {
    dlg.close();
  });

  // quick-insert snippets in the dialog
  document.querySelectorAll('[data-snippet]').forEach(function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () {
      var snip = b.dataset.snippet;
      var start = latexInput.selectionStart || 0;
      var end = latexInput.selectionEnd || 0;
      var v = latexInput.value;
      latexInput.value = v.slice(0, start) + snip + v.slice(end);
      latexInput.focus();
      latexInput.selectionStart = latexInput.selectionEnd = start + snip.length;
      updatePreview();
    });
  });

  document.getElementById('formula-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var latex = latexInput.value.trim();
    if (!latex) { dlg.close(); return; }
    var span = editingNode || document.createElement('span');
    span.className = 'math-formula';
    span.contentEditable = 'false';
    span.setAttribute('data-latex', latex);
    span.setAttribute('data-display', displayToggle.checked ? 'block' : 'inline');
    span.setAttribute('title', 'Double-click to edit');
    span.innerHTML = renderMath(latex, displayToggle.checked);

    if (!editingNode) {
      restoreRange();
      var range = savedRange || (function () {
        var r = document.createRange(); r.selectNodeContents(doc); r.collapse(false); return r;
      })();
      range.deleteContents();
      range.insertNode(span);
      // drop a caret just after the freshly inserted formula
      var after = document.createTextNode('​');
      span.parentNode.insertBefore(after, span.nextSibling);
      var r2 = document.createRange();
      r2.setStartAfter(after); r2.collapse(true);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r2);
      saveRange();
    }
    editingNode = null;
    dlg.close();
    flash('Formula ' + (span.isConnected ? 'updated' : 'inserted'));
  });

  // double-click a formula to edit it — proof the LaTeX survives round-trips
  doc.addEventListener('dblclick', function (e) {
    var f = e.target.closest ? e.target.closest('.math-formula') : null;
    if (f) { e.preventDefault(); openFormulaDialog(f); }
  });

  /* ---- save / load (user stories 3 & 4) ---- */
  var TITLE = document.getElementById('doc-title');

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  document.getElementById('save-btn').addEventListener('click', function () {
    // formulas carry their LaTeX in data-latex, so the source is preserved
    var payload = {
      format: 'math-editor',
      version: 1,
      title: TITLE.value || 'Untitled',
      html: doc.innerHTML,
      savedAt: new Date().toISOString()
    };
    var name = (TITLE.value || 'document').replace(/[^\w\-]+/g, '_') + '.mathdoc';
    download(name, JSON.stringify(payload, null, 2));
    flash('Saved to ' + name);
  });

  document.getElementById('export-btn').addEventListener('click', function () {
    // standalone HTML — opens in any browser, formulas render as native MathML
    var html =
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>' + esc(TITLE.value || 'Document') + '</title>' +
      '<style>body{font-family:Georgia,serif;max-width:46rem;margin:2rem auto;' +
      'padding:0 1rem;line-height:1.6}math[display="block"]{display:block;' +
      'text-align:center;margin:1rem 0}img{max-width:100%}</style></head><body>' +
      '<h1>' + esc(TITLE.value || 'Document') + '</h1>' + doc.innerHTML +
      '</body></html>';
    download((TITLE.value || 'document').replace(/[^\w\-]+/g, '_') + '.html',
      html, 'text/html');
    flash('Exported standalone HTML');
  });

  document.getElementById('load-file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (data.format !== 'math-editor') throw new Error('Not a .mathdoc file');
        TITLE.value = data.title || 'Untitled';
        doc.innerHTML = data.html || '';
        rerenderFormulas();      // re-compile from data-latex so they're live again
        flash('Loaded "' + (data.title || 'document') + '"');
      } catch (err) {
        flash('Could not load: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // On load, recompile every formula from its stored LaTeX. This is what
  // guarantees "load the file and all the formulas are still intact".
  function rerenderFormulas() {
    doc.querySelectorAll('.math-formula').forEach(function (span) {
      var latex = span.getAttribute('data-latex') || '';
      var block = span.getAttribute('data-display') === 'block';
      span.contentEditable = 'false';
      span.setAttribute('title', 'Double-click to edit');
      span.innerHTML = renderMath(latex, block);
    });
  }

  document.getElementById('clear-btn').addEventListener('click', function () {
    if (doc.textContent.trim() && !confirm('Clear the whole document?')) return;
    doc.innerHTML = '';
    TITLE.value = '';
    doc.focus();
  });

  /* ---- seed a small welcome document so the app isn't blank ---- */
  (function seed() {
    doc.innerHTML =
      '<p>Welcome to the <strong>Math Editor</strong> — a Claude Code routine build. ' +
      'Type anywhere in this document, then use <em>Insert formula</em> to drop in ' +
      'math such as ' +
      '<span class="math-formula" contenteditable="false" data-latex="e^{i\\pi}+1=0" ' +
      'data-display="inline" title="Double-click to edit">' +
      renderMath('e^{i\\pi}+1=0', false) + '</span>.</p>' +
      '<p>Formulas can also stand on their own line:</p>' +
      '<p><span class="math-formula" contenteditable="false" ' +
      'data-latex="\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)" data-display="block" ' +
      'title="Double-click to edit">' +
      renderMath('\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)', true) + '</span></p>' +
      '<p>Double-click any formula to edit its LaTeX. Save keeps everything intact.</p>';
  })();

  // MathML feature note for browsers without it (rare in 2024+).
  if (!('MathMLElement' in window)) {
    flash('Heads up: this browser has limited MathML support.');
  }
})();
