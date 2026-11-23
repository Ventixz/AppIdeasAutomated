/*
 * tests.js — dependency-free checks for snippet-core.js.
 *
 *   node tests.js
 *
 * Covers the lexer's priority-order correctness (comments vs strings vs
 * keyword-substrings), losslessness, HTML escaping / injection safety, ranked
 * search with composable filters, tag/language normalization, and defensive
 * load-time validation of the store.
 */

'use strict';

const C = require('./snippet-core.js');

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ ' + msg); }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, `${msg}\n      expected: ${e}\n      actual:   ${a}`);
}
function section(name) { console.log('\n' + name); }

// Helper: extract tokens of a given type as a list of their values.
function valuesOfType(tokens, type) {
  return tokens.filter((t) => t.type === type).map((t) => t.value);
}
function typeOf(tokens, value) {
  const t = tokens.find((tok) => tok.value === value);
  return t ? t.type : undefined;
}

/* ================================================================== *
 * 1. Lexer — losslessness
 * ================================================================== */
section('Lexer: losslessness (tokens rejoin to the exact input)');
{
  const samples = [
    'const x = 1; // hi',
    'def f(a, b):\n    return a + b  # sum',
    'SELECT * FROM users WHERE id = 10; -- comment',
    'int main() { return 0; } /* done */',
    'weird   \t\n spacing && |pipes| ~tilde~',
    'unicode café é emoji \u{1f600} and "日本語"',
    '',
  ];
  for (const [i, src] of samples.entries()) {
    for (const lang of ['javascript', 'python', 'sql', 'c', 'plain']) {
      const rejoined = C.tokenize(src, lang).map((t) => t.value).join('');
      ok(rejoined === src, `sample ${i} roundtrips under ${lang}`);
    }
  }
}

/* ================================================================== *
 * 2. Lexer — priority order is what makes it correct
 * ================================================================== */
section('Lexer: comments vs strings vs keyword-substrings');
{
  // "//" inside a string is NOT a comment.
  let toks = C.tokenize('const u = "http://x//y";', 'javascript');
  eq(valuesOfType(toks, 'comment'), [], 'no comment token for // inside a JS string');
  ok(valuesOfType(toks, 'string').includes('"http://x//y"'), 'the whole URL is one string');

  // "#" inside a Python string is NOT a comment.
  toks = C.tokenize("msg = 'use #hashtags'  # real comment", 'python');
  eq(valuesOfType(toks, 'string'), ["'use #hashtags'"], 'Python string keeps its #');
  eq(valuesOfType(toks, 'comment'), ['# real comment'], 'only the trailing # is a comment');

  // A keyword as a substring of a longer identifier must NOT be a keyword.
  toks = C.tokenize('var information = formatter;', 'javascript');
  ok(typeOf(toks, 'var') === 'keyword', '"var" alone is a keyword');
  ok(typeOf(toks, 'information') === 'identifier', '"for" inside "information" is not a keyword');
  ok(typeOf(toks, 'formatter') === 'identifier', '"for" inside "formatter" is not a keyword');
  eq(valuesOfType(toks, 'keyword'), ['var'], 'exactly one keyword in the line');

  // Keyword vs function-call classification.
  toks = C.tokenize('return parseDate(x)', 'javascript');
  ok(typeOf(toks, 'return') === 'keyword', 'return is a keyword');
  ok(typeOf(toks, 'parseDate') === 'function', 'name followed by ( is a function');

  // Function detection tolerates whitespace before the paren.
  toks = C.tokenize('foo   (1)', 'javascript');
  ok(typeOf(toks, 'foo') === 'function', 'name followed by spaces then ( is still a function');

  // An identifier NOT followed by ( is a plain identifier, not a function.
  toks = C.tokenize('let total = base', 'javascript');
  ok(typeOf(toks, 'total') === 'identifier', 'bare name is an identifier');
  ok(typeOf(toks, 'base') === 'identifier', 'bare name is an identifier (2)');
}

section('Lexer: strings, escapes, block comments');
{
  // Escaped quote does not end the string.
  let toks = C.tokenize('x = "a\\"b"', 'javascript');
  eq(valuesOfType(toks, 'string'), ['"a\\"b"'], 'escaped quote stays inside the string');

  // Escaped backslash before a quote DOES end the string.
  toks = C.tokenize('x = "a\\\\" + y', 'javascript');
  ok(valuesOfType(toks, 'string')[0] === '"a\\\\"', 'trailing \\\\ closes the string');

  // Block comment spans lines and swallows // and keywords inside it.
  toks = C.tokenize('/* for return\n const */ x', 'javascript');
  eq(valuesOfType(toks, 'comment'), ['/* for return\n const */'], 'block comment is one token');
  eq(valuesOfType(toks, 'keyword'), [], 'no keywords recognised inside a block comment');

  // Unterminated string stops at newline (does not eat the rest of the file).
  toks = C.tokenize('a = "oops\nb = 2', 'javascript');
  ok(valuesOfType(toks, 'string')[0] === '"oops', 'unterminated string stops at newline');
  ok(typeOf(toks, 'b') === 'identifier', 'code after a broken string is still lexed');

  // Python triple-quoted string.
  toks = C.tokenize('x = """line1\nline2 # not a comment"""', 'python');
  eq(valuesOfType(toks, 'string'), ['"""line1\nline2 # not a comment"""'],
    'triple-quoted string is one multi-line token');
  eq(valuesOfType(toks, 'comment'), [], 'no comment inside a triple-quoted string');
}

section('Lexer: numbers');
{
  const toks = C.tokenize('0xFF 0b1010 3.14 1e-9 42n 1_000 .5', 'javascript');
  eq(valuesOfType(toks, 'number'),
    ['0xFF', '0b1010', '3.14', '1e-9', '42n', '1_000', '.5'],
    'hex, binary, float, exponent, bigint, separators, leading-dot all parse as numbers');
}

section('Lexer: SQL is case-insensitive for keywords');
{
  const toks = C.tokenize('select Id from Users', 'sql');
  ok(typeOf(toks, 'select') === 'keyword', 'lowercase select is a keyword');
  const toks2 = C.tokenize('SELECT Id FROM Users', 'sql');
  ok(typeOf(toks2, 'SELECT') === 'keyword', 'uppercase SELECT is a keyword');
  ok(typeOf(toks2, 'Users') === 'identifier', 'table name is not a keyword');
}

section('Lexer: language aliases and unknown fallback');
{
  eq(C.resolveLanguage('TS').name, 'javascript', 'ts resolves to javascript');
  eq(C.resolveLanguage('py').name, 'python', 'py resolves to python');
  eq(C.resolveLanguage('c++').name, 'c', 'c++ resolves to c');
  eq(C.resolveLanguage('Brainfuck').name, 'plain', 'unknown language falls back to plain');
  // Plain never highlights anything.
  const toks = C.tokenize('for return SELECT', 'plain');
  eq(valuesOfType(toks, 'keyword'), [], 'plain text has no keywords');
}

/* ================================================================== *
 * 3. HTML rendering — escape exactly once, injection-safe
 * ================================================================== */
section('highlightHtml: escaping and injection safety');
{
  const malicious = 'var s = "</span><script>alert(1)</script>";';
  const html = C.highlightHtml(malicious, 'javascript');
  ok(!html.includes('<script>'), 'raw <script> never appears in the output');
  ok(html.includes('&lt;script&gt;'), 'the <script> text is escaped to visible text');
  ok(!html.includes('</span><script'), 'a literal </span> in code cannot close our spans');

  // Ampersand escaped exactly once (no double-escaping to &amp;amp;).
  const amp = C.highlightHtml('a && b', 'javascript');
  ok((amp.match(/&amp;/g) || []).length === 2, 'each & in && escapes to &amp;');
  ok(!amp.includes('&amp;amp;'), 'no double escaping');

  // Rendering is lossless once you un-escape: strip tags, unescape, compare.
  const code = 'if (a < b && c > d) return "<x>";';
  const stripped = C.highlightHtml(code, 'javascript')
    .replace(/<span class="tok-[a-z]+">/g, '')
    .replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  ok(stripped === code, 'highlightHtml preserves the exact source after un-escaping');

  // Every emitted class is a known token type.
  const classes = (C.highlightHtml('def f(x): return 1 # c', 'python').match(/tok-[a-z]+/g) || []);
  const known = new Set(['tok-keyword', 'tok-string', 'tok-comment', 'tok-number',
    'tok-function', 'tok-identifier', 'tok-operator', 'tok-punctuation', 'tok-text']);
  ok(classes.every((c) => known.has(c)), 'all span classes are known token types');
}

/* ================================================================== *
 * 4. Tag + language normalization
 * ================================================================== */
section('normalizeTags');
{
  eq(C.normalizeTags([' API ', 'api', 'DB', 'db', '']), ['api', 'db'],
    'trim, lowercase, dedupe, drop blanks, preserve order');
  eq(C.normalizeTags('React, hooks\nState, react'), ['react', 'hooks', 'state'],
    'string tags split on comma/newline and dedupe');
  eq(C.normalizeTags(undefined), [], 'undefined -> empty tag list');
}

/* ================================================================== *
 * 5. Store — add / get / update / remove
 * ================================================================== */
section('SnippetStore: CRUD');
{
  const store = new C.SnippetStore();
  const a = store.add({ title: 'Debounce', language: 'js', tags: ['util', 'util'], code: 'const x=1' });
  ok(a.id && a.id.startsWith('s_'), 'add returns a snippet with a generated id');
  eq(a.language, 'javascript', 'language alias normalized on add');
  eq(a.tags, ['util'], 'tags normalized + deduped on add');

  ok(store.get(a.id) === a, 'get returns the stored snippet');
  ok(store.get('nope') === null, 'get of unknown id is null');

  const t0 = a.updatedAt;
  // Ensure the clock advances so updatedAt strictly increases.
  const spin = Date.now; let fakeNow = t0 + 5;
  Date.now = () => fakeNow;
  store.update(a.id, { title: 'Debounce fn', tags: 'perf' });
  Date.now = spin;
  eq(store.get(a.id).title, 'Debounce fn', 'update changes the title');
  eq(store.get(a.id).tags, ['perf'], 'update replaces tags');
  ok(store.get(a.id).updatedAt >= t0, 'update bumps updatedAt');

  ok(store.remove(a.id) === true, 'remove returns true when something was removed');
  ok(store.get(a.id) === null, 'snippet is gone after remove');
  ok(store.remove(a.id) === false, 'remove of missing id returns false');
}

section('SnippetStore: add validation');
{
  const store = new C.SnippetStore();
  let threw = false;
  try { store.add({ title: 'x', code: '   ' }); } catch (_e) { threw = true; }
  ok(threw, 'add rejects empty/whitespace-only code');

  const s = store.add({ code: 'x=1' });
  eq(s.title, 'Untitled snippet', 'missing title defaults to "Untitled snippet"');
  eq(s.language, 'plain', 'missing language defaults to plain');
}

/* ================================================================== *
 * 6. Store — ranked search with composable filters
 * ================================================================== */
section('SnippetStore: search ranking and filters');
{
  const store = new C.SnippetStore();
  const named = store.add({ title: 'parseDate helper', language: 'js', tags: ['date'], code: 'return 1' });
  const caller = store.add({ title: 'format row', language: 'js', tags: ['table'], code: 'parseDate(x)' });
  const py = store.add({ title: 'parse dates', language: 'python', tags: ['date', 'etl'], code: 'pass' });

  // Free term: title hit outranks a code-only hit.
  let res = store.search('parsedate');
  ok(res[0].id === named.id, 'title match ranks above a code-only match');
  ok(res.map((s) => s.id).includes(caller.id), 'code-only match is still returned');

  // lang: filter composes with a free term.
  res = store.search('lang:python parse');
  eq(res.map((s) => s.id), [py.id], 'lang:python narrows to the Python snippet');

  // tag: and #tag are equivalent and must be present.
  const byTag = store.search('tag:date').map((s) => s.id).sort();
  const byHash = store.search('#date').map((s) => s.id).sort();
  eq(byTag, byHash, 'tag:date and #date return the same set');
  ok(byTag.includes(named.id) && byTag.includes(py.id) && !byTag.includes(caller.id),
    'tag filter keeps only snippets carrying the tag');

  // Multiple free terms are ANDed.
  res = store.search('parse etl');
  eq(res.map((s) => s.id), [py.id], 'both terms must match (AND semantics)');

  // Empty query returns everything, newest first.
  res = store.search('');
  eq(res.length, 3, 'empty query returns all snippets');

  // A term matching nothing yields no results.
  eq(store.search('zzzznotfound').length, 0, 'unmatched term returns nothing');

  // Language filter via alias.
  eq(store.search('lang:js').length, 2, 'lang:js (alias) matches both JavaScript snippets');
}

section('parseQuery');
{
  eq(C.parseQuery('lang:py tag:api #db foo bar'),
    { lang: 'py', tags: ['api', 'db'], terms: ['foo', 'bar'] },
    'query splits into lang, tags, and free terms');
  eq(C.parseQuery('  '), { lang: null, tags: [], terms: [] }, 'blank query parses empty');
}

/* ================================================================== *
 * 7. Store — persistence round-trip + defensive loading
 * ================================================================== */
section('SnippetStore: serialize / deserialize round-trip');
{
  const store = new C.SnippetStore();
  // Deliberately nasty code: quotes, backslashes, newlines, unicode, HTML.
  const nasty = 'const s = "a\\"b\\\\c";\n// café 日本語 </span><b>\nreturn `x${y}`;';
  store.add({ title: 'Edge "case" é', language: 'js', tags: ['x'], code: nasty });
  store.add({ title: 'Second', language: 'python', tags: ['a', 'b'], code: 'pass # ok' });

  const json = store.serialize();
  const back = C.SnippetStore.deserialize(json);
  eq(back.toJSON(), store.toJSON(), 'full store survives serialize -> deserialize exactly');
  eq(back.get(store.toJSON()[0].id).code, nasty, 'nasty code is byte-identical after round-trip');
}

section('SnippetStore: defensive loading never throws');
{
  // Garbage JSON -> empty store, not a crash.
  eq(C.SnippetStore.deserialize('{not json').toJSON(), [], 'invalid JSON yields an empty store');
  eq(C.SnippetStore.deserialize('{"a":1}').toJSON(), [], 'non-array JSON yields an empty store');
  eq(C.SnippetStore.deserialize('null').toJSON(), [], 'null yields an empty store');

  // Mixed good/bad records: bad ones dropped, good ones coerced.
  const dirty = JSON.stringify([
    { title: 'good', language: 'js', tags: ['t'], code: 'x=1' },
    null,                                              // dropped: not an object
    42,                                                // dropped: not an object
    { code: 'y=2' },                                   // kept: missing title/lang -> defaults
    { title: 'bad lang', language: 'klingon', code: 'z=3' }, // kept: unknown lang -> plain
  ]);
  const store = C.SnippetStore.deserialize(dirty);
  eq(store.snippets.length, 3, 'null and non-object records are dropped, valid ones kept');
  eq(store.get(store.snippets[2].id).language, 'plain', 'unknown language coerced to plain on load');

  // Duplicate ids in stored data get de-collided.
  const dup = JSON.stringify([
    { id: 'same', title: 'a', code: 'x=1' },
    { id: 'same', title: 'b', code: 'y=2' },
  ]);
  const store2 = C.SnippetStore.deserialize(dup);
  ok(store2.snippets[0].id !== store2.snippets[1].id, 'colliding ids are made unique on load');
}

/* ================================================================== *
 * 8. Store — aggregates
 * ================================================================== */
section('SnippetStore: languagesInUse / tagsInUse');
{
  const store = new C.SnippetStore();
  store.add({ title: 'a', language: 'js', tags: ['api', 'util'], code: 'x=1' });
  store.add({ title: 'b', language: 'js', tags: ['api'], code: 'y=2' });
  store.add({ title: 'c', language: 'python', tags: ['etl'], code: 'pass' });

  const langs = store.languagesInUse();
  eq(langs.find((l) => l.name === 'javascript').count, 2, 'js counted twice');
  eq(langs.find((l) => l.name === 'python').count, 1, 'python counted once');

  const tags = store.tagsInUse();
  eq(tags.find((t) => t.tag === 'api').count, 2, 'api tag counted twice');
  eq(tags.map((t) => t.tag), ['api', 'etl', 'util'], 'tags listed alphabetically');
}

/* ================================================================== */
console.log(`\n${'='.repeat(48)}`);
console.log(`  ${passed} passed, ${failed} failed  (${passed + failed} checks)`);
console.log('='.repeat(48));
process.exit(failed === 0 ? 0 : 1);
