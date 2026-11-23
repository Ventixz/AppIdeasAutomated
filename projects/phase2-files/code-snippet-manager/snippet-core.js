/*
 * snippet-core.js — the dependency-free engine behind the Code Snippet Manager.
 *
 * Three independent pieces, all usable from Node and the browser:
 *   1. A syntax highlighter written as a real character-level LEXER (no
 *      highlight.js / Prism / regex-soup). It scans in priority order so that
 *      a "//" inside a string is not a comment, a "#" inside a Python string is
 *      not a comment, and a keyword that appears as a substring of a longer
 *      identifier (the "for" in "information") is never highlighted.
 *   2. HTML rendering that tokenizes FIRST and escapes each token's text
 *      exactly once, so code that literally contains "</span>" or "<script>"
 *      shows up as visible text and can never break the markup or inject.
 *   3. A SnippetStore: add / update / delete / get / list, a ranked search with
 *      composable `lang:` / `tag:` / `#tag` filters, and load-time validation
 *      that never trusts the stored JSON.
 *
 * No dependencies. Runs under `node tests.js` and inside index.html unchanged.
 */

'use strict';

/* ------------------------------------------------------------------ *
 * 1. Language specs
 * ------------------------------------------------------------------ */

// Each spec drives the one generic lexer below. Keeping the behaviour in data
// (not in code) is what lets one tokenizer handle several languages without a
// forest of special cases.
const LANGUAGES = {
  javascript: {
    label: 'JavaScript',
    aliases: ['js', 'jsx', 'node', 'nodejs', 'mjs', 'cjs', 'typescript', 'ts', 'tsx'],
    lineComment: '//',
    blockComment: ['/*', '*/'],
    strings: ['"', "'", '`'],      // backtick = template literal (treated as a plain string here)
    tripleStrings: [],
    keywords: [
      'abstract', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
      'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
      'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if',
      'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new',
      'null', 'of', 'private', 'protected', 'public', 'return', 'set', 'static',
      'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
      'var', 'void', 'while', 'with', 'yield',
    ],
  },
  python: {
    label: 'Python',
    aliases: ['py', 'py3', 'python3'],
    lineComment: '#',
    blockComment: null,
    strings: ['"', "'"],
    tripleStrings: ['"""', "'''"],
    keywords: [
      'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
      'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from',
      'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not',
      'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield',
      'self', 'cls', 'match', 'case',
    ],
  },
  c: {
    label: 'C / C++ / Java',
    aliases: ['cpp', 'c++', 'cc', 'h', 'hpp', 'java', 'cs', 'csharp', 'go', 'rust', 'rs'],
    lineComment: '//',
    blockComment: ['/*', '*/'],
    strings: ['"', "'"],
    tripleStrings: [],
    keywords: [
      'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const',
      'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'extern',
      'false', 'final', 'float', 'for', 'func', 'goto', 'if', 'import', 'inline',
      'int', 'interface', 'long', 'namespace', 'new', 'null', 'nullptr',
      'package', 'private', 'protected', 'public', 'return', 'short', 'signed',
      'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw',
      'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'var',
      'void', 'volatile', 'while',
    ],
  },
  sql: {
    label: 'SQL',
    aliases: ['mysql', 'postgres', 'postgresql', 'sqlite', 'plsql'],
    lineComment: '--',
    blockComment: ['/*', '*/'],
    strings: ["'", '"'],
    tripleStrings: [],
    caseInsensitiveKeywords: true,
    keywords: [
      'add', 'all', 'alter', 'and', 'as', 'asc', 'between', 'by', 'case', 'check',
      'column', 'constraint', 'create', 'cross', 'default', 'delete', 'desc',
      'distinct', 'drop', 'else', 'end', 'exists', 'foreign', 'from', 'full',
      'group', 'having', 'in', 'index', 'inner', 'insert', 'into', 'is', 'join',
      'key', 'left', 'like', 'limit', 'not', 'null', 'offset', 'on', 'or',
      'order', 'outer', 'primary', 'references', 'right', 'select', 'set', 'table',
      'then', 'union', 'unique', 'update', 'values', 'view', 'when', 'where',
    ],
  },
  plain: {
    label: 'Plain text',
    aliases: ['text', 'txt', 'none', ''],
    lineComment: null,
    blockComment: null,
    strings: [],
    tripleStrings: [],
    keywords: [],
  },
};

// Build a fast alias -> canonical-name lookup once.
const ALIAS_INDEX = (() => {
  const idx = {};
  for (const name of Object.keys(LANGUAGES)) {
    idx[name] = name;
    for (const a of LANGUAGES[name].aliases) idx[a.toLowerCase()] = name;
  }
  return idx;
})();

// Resolve any user-supplied language string (case/alias-insensitive) to a spec.
// Unknown languages fall back to "plain" so the lexer always has something to do.
function resolveLanguage(lang) {
  const key = String(lang == null ? '' : lang).trim().toLowerCase();
  const name = ALIAS_INDEX[key] || 'plain';
  return { name, spec: LANGUAGES[name] };
}

function languageList() {
  return Object.keys(LANGUAGES).map((name) => ({ name, label: LANGUAGES[name].label }));
}

/* ------------------------------------------------------------------ *
 * 2. The lexer
 * ------------------------------------------------------------------ */

function isDigit(ch) { return ch >= '0' && ch <= '9'; }
function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}
function isIdentPart(ch) { return isIdentStart(ch) || isDigit(ch); }

const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ',', ';', ':', '.']);
const OPERATOR = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?']);

function startsWith(code, i, token) {
  if (!token) return false;
  return code.startsWith(token, i);
}

/*
 * tokenize(code, lang) -> [{ type, value }, ...]
 *
 * This is the whole highlighter. It walks the string once, left to right, and
 * at each position tries the token kinds in a fixed PRIORITY ORDER. That order
 * is the entire reason it is correct where a pile of regexes would not be:
 *
 *   comment  >  string  >  number  >  identifier  >  operator  >  punctuation
 *
 * Because a string is recognised as one unit before we ever look for a comment
 * marker inside it, `const u = "a//b"` keeps "//b" as part of the string.
 * Because an identifier is read whole and then classified, "information" is one
 * identifier and the "for" inside it is never seen as a keyword.
 *
 * `value` of every token concatenated back together === the original code,
 * exactly. tokenize is lossless; the tests assert it.
 */
function tokenize(code, lang) {
  const { spec } = resolveLanguage(lang);
  code = String(code == null ? '' : code);
  const tokens = [];
  const n = code.length;
  let i = 0;
  let plain = '';

  const flush = () => {
    if (plain) { tokens.push({ type: 'text', value: plain }); plain = ''; }
  };
  const push = (type, value) => { flush(); tokens.push({ type, value }); };

  const kwSet = new Set(
    spec.caseInsensitiveKeywords ? spec.keywords.map((k) => k.toLowerCase()) : spec.keywords
  );
  const isKeyword = (word) =>
    kwSet.has(spec.caseInsensitiveKeywords ? word.toLowerCase() : word);

  while (i < n) {
    const c = code[i];

    // --- block comment (/* ... */) ---
    if (spec.blockComment && startsWith(code, i, spec.blockComment[0])) {
      const open = spec.blockComment[0];
      const close = spec.blockComment[1];
      let j = i + open.length;
      const end = code.indexOf(close, j);
      const stop = end === -1 ? n : end + close.length; // unterminated -> to EOF
      push('comment', code.slice(i, stop));
      i = stop;
      continue;
    }

    // --- line comment (// or # or --) ---
    if (spec.lineComment && startsWith(code, i, spec.lineComment)) {
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      push('comment', code.slice(i, j));
      i = j;
      continue;
    }

    // --- triple-quoted string (Python """...""") ---
    let tripled = false;
    for (const tq of spec.tripleStrings) {
      if (startsWith(code, i, tq)) {
        let j = i + tq.length;
        const end = code.indexOf(tq, j);
        const stop = end === -1 ? n : end + tq.length;
        push('string', code.slice(i, stop));
        i = stop;
        tripled = true;
        break;
      }
    }
    if (tripled) continue;

    // --- single/double/backtick string with backslash escapes ---
    if (spec.strings.includes(c)) {
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }   // skip escaped char, incl. \" and \\
        if (code[j] === c) { j++; break; }             // closing quote
        // A non-template string never spans a raw newline; stop so an unterminated
        // quote can't swallow the rest of the file.
        if (code[j] === '\n' && c !== '`') { break; }
        j++;
      }
      push('string', code.slice(i, Math.min(j, n)));
      i = Math.min(j, n);
      continue;
    }

    // --- number (incl. 0x.., 0b.., floats, exponents, underscores, suffixes) ---
    if (isDigit(c) || (c === '.' && isDigit(code[i + 1]))) {
      let j = i;
      if (c === '0' && (code[i + 1] === 'x' || code[i + 1] === 'X')) {
        j += 2;
        while (j < n && /[0-9a-fA-F_]/.test(code[j])) j++;
      } else if (c === '0' && (code[i + 1] === 'b' || code[i + 1] === 'B')) {
        j += 2;
        while (j < n && /[01_]/.test(code[j])) j++;
      } else {
        while (j < n && (isDigit(code[j]) || code[j] === '_' || code[j] === '.')) j++;
        if (code[j] === 'e' || code[j] === 'E') {
          j++;
          if (code[j] === '+' || code[j] === '-') j++;
          while (j < n && isDigit(code[j])) j++;
        }
      }
      while (j < n && /[a-zA-Z]/.test(code[j])) j++; // suffixes: n, f, L, u, ...
      push('number', code.slice(i, j));
      i = j;
      continue;
    }

    // --- identifier / keyword / function-call name ---
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(code[j])) j++;
      const word = code.slice(i, j);
      if (isKeyword(word)) {
        push('keyword', word);
      } else {
        // Classify as a function name only when the next non-space char is "(".
        let k = j;
        while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
        push(code[k] === '(' ? 'function' : 'identifier', word);
      }
      i = j;
      continue;
    }

    // --- operators and punctuation ---
    if (OPERATOR.has(c)) { push('operator', c); i++; continue; }
    if (PUNCTUATION.has(c)) { push('punctuation', c); i++; continue; }

    // --- anything else (whitespace, unknown): accumulate as plain text ---
    plain += c;
    i++;
  }

  flush();
  return tokens;
}

/* ------------------------------------------------------------------ *
 * 3. HTML rendering (escape exactly once, after tokenizing)
 * ------------------------------------------------------------------ */

// Escape the three characters that matter in HTML *text* content. We never build
// markup from un-escaped user code: we tokenize first, then escape each token's
// text, so "</span>" or "<script>alert(1)</script>" in a snippet becomes inert
// visible text. (Quotes aren't escaped because tokens are never put in attributes.)
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Render highlighted code as an HTML string of <span class="tok-TYPE">...</span>.
// Plain text/whitespace is emitted escaped but unwrapped to keep the output small.
function highlightHtml(code, lang) {
  const tokens = tokenize(code, lang);
  let out = '';
  for (const t of tokens) {
    const esc = escapeHtml(t.value);
    out += t.type === 'text' ? esc : `<span class="tok-${t.type}">${esc}</span>`;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 4. The snippet store
 * ------------------------------------------------------------------ */

let idCounter = 0;
function makeId() {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `s_${Date.now().toString(36)}_${idCounter.toString(36)}_${rand}`;
}

// Tags: trimmed, lower-cased, de-duplicated, order preserved, blanks dropped.
function normalizeTags(tags) {
  const list = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(/[,\n]/)
      : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw).trim().toLowerCase();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

class SnippetStore {
  constructor(snippets) {
    this.snippets = [];
    if (Array.isArray(snippets)) for (const s of snippets) this._ingest(s, false);
  }

  // Validate + coerce one record. Returns a clean snippet or null if unsalvageable.
  // `strict` throws on bad input (used by add); loose mode (used on load) just
  // drops junk so a corrupted store can never crash the app.
  _clean(input, strict) {
    if (!input || typeof input !== 'object') {
      if (strict) throw new TypeError('snippet must be an object');
      return null;
    }
    const code = typeof input.code === 'string' ? input.code : '';
    if (strict && code.trim() === '') throw new Error('snippet code is required');
    const { name: language } = resolveLanguage(input.language);
    const now = Date.now();
    const created = Number.isFinite(input.createdAt) ? input.createdAt : now;
    const updated = Number.isFinite(input.updatedAt) ? input.updatedAt : created;
    return {
      id: typeof input.id === 'string' && input.id ? input.id : makeId(),
      title: typeof input.title === 'string' && input.title.trim()
        ? input.title.trim()
        : 'Untitled snippet',
      language,
      tags: normalizeTags(input.tags),
      code,
      createdAt: created,
      updatedAt: updated,
    };
  }

  _ingest(input, strict) {
    const clean = this._clean(input, strict);
    if (!clean) return null;
    // Guarantee unique ids even if the stored data had collisions.
    if (this.snippets.some((s) => s.id === clean.id)) clean.id = makeId();
    this.snippets.push(clean);
    return clean;
  }

  add(input) {
    const clean = this._ingest(input, true);
    return clean;
  }

  get(id) { return this.snippets.find((s) => s.id === id) || null; }

  update(id, patch) {
    const s = this.get(id);
    if (!s) return null;
    if (patch.title !== undefined) {
      const t = String(patch.title).trim();
      s.title = t || s.title;
    }
    if (patch.code !== undefined) s.code = String(patch.code);
    if (patch.language !== undefined) s.language = resolveLanguage(patch.language).name;
    if (patch.tags !== undefined) s.tags = normalizeTags(patch.tags);
    s.updatedAt = Date.now();
    return s;
  }

  remove(id) {
    const before = this.snippets.length;
    this.snippets = this.snippets.filter((s) => s.id !== id);
    return this.snippets.length < before;
  }

  // All snippets, most-recently-updated first.
  list() {
    return this.snippets.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Distinct languages actually in use, with counts.
  languagesInUse() {
    const counts = {};
    for (const s of this.snippets) counts[s.language] = (counts[s.language] || 0) + 1;
    return Object.keys(counts).sort().map((name) => ({
      name, label: LANGUAGES[name].label, count: counts[name],
    }));
  }

  // Distinct tags, with counts, alphabetical.
  tagsInUse() {
    const counts = {};
    for (const s of this.snippets) for (const t of s.tags) counts[t] = (counts[t] || 0) + 1;
    return Object.keys(counts).sort().map((tag) => ({ tag, count: counts[tag] }));
  }

  /*
   * search(query) -> ranked array of snippets.
   *
   * The query is a mix of three things, all optional and composable:
   *   lang:js      narrow to a language (alias-aware)
   *   tag:api  /  #api   narrow to a tag (must be present)
   *   free words   ranked across fields
   *
   * Filters are ANDed and narrow the candidate set. Every free term must match
   * SOMEWHERE in a surviving snippet (AND across terms), and the score is the
   * sum of per-term field weights: a hit in the title counts for far more than a
   * hit buried in the code, so "the snippet named parseDate" beats "a snippet
   * that merely calls parseDate". Ties break by most-recently-updated.
   */
  search(query) {
    const parsed = parseQuery(query);
    const langFilter = parsed.lang ? resolveLanguage(parsed.lang).name : null;

    let candidates = this.snippets.filter((s) => {
      if (langFilter && s.language !== langFilter) return false;
      for (const tag of parsed.tags) if (!s.tags.includes(tag)) return false;
      return true;
    });

    if (parsed.terms.length === 0) {
      return candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    const scored = [];
    for (const s of candidates) {
      const title = s.title.toLowerCase();
      const code = s.code.toLowerCase();
      const langLabel = (s.language + ' ' + LANGUAGES[s.language].label).toLowerCase();
      const tagStr = s.tags.join(' ');
      let score = 0;
      let allMatch = true;
      for (const term of parsed.terms) {
        let termScore = 0;
        if (title.includes(term)) termScore += 10;
        if (tagStr.includes(term)) termScore += 6;
        if (langLabel.includes(term)) termScore += 3;
        if (code.includes(term)) termScore += 1;
        if (termScore === 0) { allMatch = false; break; }
        score += termScore;
      }
      if (allMatch) scored.push({ s, score });
    }

    scored.sort((a, b) => b.score - a.score || b.s.updatedAt - a.s.updatedAt);
    return scored.map((x) => x.s);
  }

  // --- persistence ---------------------------------------------------

  toJSON() { return this.snippets.slice(); }
  serialize() { return JSON.stringify(this.snippets); }

  // Never trust what comes back from storage. Parse defensively and validate
  // every record; a malformed blob yields an empty store rather than an error.
  static deserialize(json) {
    let data;
    try {
      data = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (_e) {
      return new SnippetStore([]);
    }
    if (!Array.isArray(data)) return new SnippetStore([]);
    return new SnippetStore(data);
  }
}

// Parse a search string into { lang, tags[], terms[] }.
function parseQuery(query) {
  const out = { lang: null, tags: [], terms: [] };
  const parts = String(query == null ? '' : query).trim().split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith('lang:')) {
      out.lang = lower.slice(5);
    } else if (lower.startsWith('tag:')) {
      const t = lower.slice(4).trim();
      if (t) out.tags.push(t);
    } else if (part.startsWith('#') && part.length > 1) {
      out.tags.push(lower.slice(1));
    } else {
      out.terms.push(lower);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Exports (Node) + globals (browser)
 * ------------------------------------------------------------------ */

const API = {
  LANGUAGES,
  resolveLanguage,
  languageList,
  tokenize,
  escapeHtml,
  highlightHtml,
  normalizeTags,
  parseQuery,
  SnippetStore,
  makeId,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
if (typeof window !== 'undefined') {
  window.SnippetCore = API;
}
