/*
 * tests.js — dependency-free checks for the page-scraper engine, run under
 * Node:
 *   node projects/phase2-web/page-scraper/tests.js
 *
 * The centre of gravity is URL resolution, and the test corpus is not made up:
 * it is the canonical "normal" and "abnormal" example tables from RFC 3986
 * §5.4, the reference-resolution test vectors every URL library is checked
 * against. If resolveUrl passes those, it is correct in exactly the way a
 * scraper needs — the string-concatenation version fails a third of them.
 *
 * Layers:
 *   1. RFC 3986 §5.4.1 normal examples   — the ordinary cases.
 *   2. RFC 3986 §5.4.2 abnormal examples — the ones naive code gets wrong
 *      (extra "..", scheme-only refs, dot segments in odd places).
 *   3. remove_dot_segments §5.2.4 worked examples.
 *   4. srcset parsing (commas in URLs, optional descriptors).
 *   5. HTML extraction — the right attributes, skipping script/style/comments,
 *      entity decoding, <base href>, dedup, internal/external classification.
 */
'use strict';

const assert = require('assert');
const {
  parseUri, recompose, removeDotSegments, resolveUrl, parseSrcset,
  extract, hostOf, skipRef,
} = require('./scraper-core.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push([name, e]); }
}

/* ------------------------------------------------------------------ *
 * 1 + 2. RFC 3986 §5.4 — the reference resolution vectors
 * ------------------------------------------------------------------ *
 * Base for every case below, straight from the RFC.
 */
const BASE = 'http://a/b/c/d;p?q';

const NORMAL = {
  'g:h': 'g:h',
  g: 'http://a/b/c/g',
  './g': 'http://a/b/c/g',
  'g/': 'http://a/b/c/g/',
  '/g': 'http://a/g',
  '//g': 'http://g',
  '?y': 'http://a/b/c/d;p?y',
  'g?y': 'http://a/b/c/g?y',
  '#s': 'http://a/b/c/d;p?q#s',
  'g#s': 'http://a/b/c/g#s',
  'g?y#s': 'http://a/b/c/g?y#s',
  ';x': 'http://a/b/c/;x',
  'g;x': 'http://a/b/c/g;x',
  'g;x?y#s': 'http://a/b/c/g;x?y#s',
  '': 'http://a/b/c/d;p?q',
  '.': 'http://a/b/c/',
  './': 'http://a/b/c/',
  '..': 'http://a/b/',
  '../': 'http://a/b/',
  '../g': 'http://a/b/g',
  '../..': 'http://a/',
  '../../': 'http://a/',
  '../../g': 'http://a/g',
};

const ABNORMAL = {
  // Extra ".." segments that would escape the root are discarded, not errored.
  '../../../g': 'http://a/g',
  '../../../../g': 'http://a/g',
  // "." and ".." where the path isn't a complete segment.
  '/./g': 'http://a/g',
  '/../g': 'http://a/g',
  'g.': 'http://a/b/c/g.',
  '.g': 'http://a/b/c/.g',
  'g..': 'http://a/b/c/g..',
  '..g': 'http://a/b/c/..g',
  // Nonsensical but legal dot combinations.
  './../g': 'http://a/b/g',
  './g/.': 'http://a/b/c/g/',
  'g/./h': 'http://a/b/c/g/h',
  'g/../h': 'http://a/b/c/h',
  'g;x=1/./y': 'http://a/b/c/g;x=1/y',
  'g;x=1/../y': 'http://a/b/c/y',
  // Query and fragment must not be confused for dot segments.
  'g?y/./x': 'http://a/b/c/g?y/./x',
  'g?y/../x': 'http://a/b/c/g?y/../x',
  'g#s/./x': 'http://a/b/c/g#s/./x',
  'g#s/../x': 'http://a/b/c/g#s/../x',
};

check('RFC 3986 §5.4.1 — all 22 normal examples resolve exactly', () => {
  for (const [ref, want] of Object.entries(NORMAL)) {
    const got = resolveUrl(BASE, ref);
    assert.strictEqual(got, want, `resolve(${JSON.stringify(ref)}) → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
});

check('RFC 3986 §5.4.2 — all abnormal examples resolve exactly (strict)', () => {
  for (const [ref, want] of Object.entries(ABNORMAL)) {
    const got = resolveUrl(BASE, ref);
    assert.strictEqual(got, want, `resolve(${JSON.stringify(ref)}) → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
});

check('strict vs non-strict scheme handling (RFC 3986 §5.4.2 "http:g")', () => {
  // Strict: a scheme makes it an absolute URI, unchanged.
  assert.strictEqual(resolveUrl(BASE, 'http:g', { strict: true }), 'http:g');
  // Non-strict (the "backward compatibility" note): same-scheme ref is treated
  // as relative, the behaviour of most deployed browsers.
  assert.strictEqual(resolveUrl(BASE, 'http:g', { strict: false }), 'http://a/b/c/g');
});

check('protocol-relative references inherit the base scheme', () => {
  assert.strictEqual(resolveUrl('https://x.test/a/b', '//cdn.test/lib.js'), 'https://cdn.test/lib.js');
  assert.strictEqual(resolveUrl('http://x.test/a/b', '//cdn.test/lib.js'), 'http://cdn.test/lib.js');
});

/* ------------------------------------------------------------------ *
 * 3. remove_dot_segments — §5.2.4 worked examples
 * ------------------------------------------------------------------ */
check('removeDotSegments — the two §5.2.4 worked examples', () => {
  assert.strictEqual(removeDotSegments('/a/b/c/./../../g'), '/a/g');
  assert.strictEqual(removeDotSegments('mid/content=5/../6'), 'mid/6');
});

check('removeDotSegments — leading traversal cannot escape above root', () => {
  assert.strictEqual(removeDotSegments('/../../x'), '/x');
  assert.strictEqual(removeDotSegments('../../x'), 'x');
});

/* ------------------------------------------------------------------ *
 * parseUri / recompose round-trips
 * ------------------------------------------------------------------ */
check('parseUri splits the five components and distinguishes absent from empty', () => {
  const p = parseUri('http://user@host:8080/path/x?a=1&b=2#frag');
  assert.strictEqual(p.scheme, 'http');
  assert.strictEqual(p.authority, 'user@host:8080');
  assert.strictEqual(p.path, '/path/x');
  assert.strictEqual(p.query, 'a=1&b=2');
  assert.strictEqual(p.fragment, 'frag');

  const q = parseUri('http://host'); // authority present, path EMPTY (not absent)
  assert.strictEqual(q.authority, 'host');
  assert.strictEqual(q.path, '');
  assert.strictEqual(q.query, undefined, 'no query is undefined, not ""');
  assert.strictEqual(q.fragment, undefined);
});

check('recompose is the inverse of parseUri for a range of URLs', () => {
  for (const u of [
    'http://a/b/c/d;p?q', 'g:h', '//g', '?y', '#s',
    'https://user@h:9/p?x#y', 'mailto:a@b.test', 'file:///etc/hosts',
  ]) {
    assert.strictEqual(recompose(parseUri(u)), u, `round-trip ${u}`);
  }
});

/* ------------------------------------------------------------------ *
 * 4. srcset parsing
 * ------------------------------------------------------------------ */
check('parseSrcset — density and width descriptors', () => {
  const r = parseSrcset('a.png 1x, b.png 2x, c.png 3x');
  assert.deepStrictEqual(r.map((c) => c.url), ['a.png', 'b.png', 'c.png']);
  assert.deepStrictEqual(r.map((c) => c.descriptor), ['1x', '2x', '3x']);

  const w = parseSrcset('s.jpg 480w, m.jpg 800w, l.jpg 1200w');
  assert.deepStrictEqual(w.map((c) => c.url), ['s.jpg', 'm.jpg', 'l.jpg']);
});

check('parseSrcset — a bare URL with no descriptor', () => {
  assert.deepStrictEqual(parseSrcset('only.png'), [{ url: 'only.png', descriptor: '' }]);
});

check('parseSrcset — commas inside the URL do not split candidates', () => {
  // A data: URL or a query string can contain commas; the separator is the
  // comma that follows the descriptor (or a comma glued to the URL).
  const r = parseSrcset('/img?w=1,h=2 1x, /img?w=3,h=4 2x');
  assert.deepStrictEqual(r.map((c) => c.url), ['/img?w=1,h=2', '/img?w=3,h=4']);
  assert.deepStrictEqual(r.map((c) => c.descriptor), ['1x', '2x']);
});

check('parseSrcset — a comma glued to the URL ends that candidate', () => {
  // "a.png," — the trailing comma on the token both ends the URL and the
  // candidate (so the next token is a fresh URL, not this one's descriptor).
  const r = parseSrcset('a.png, b.png 2x');
  assert.deepStrictEqual(r.map((c) => c.url), ['a.png', 'b.png']);
  assert.deepStrictEqual(r.map((c) => c.descriptor), ['', '2x']);
});

check('parseSrcset — a comma INSIDE a non-whitespace run stays in the URL', () => {
  // The WHATWG footgun: without whitespace, "a.png,b.png" is one URL token,
  // exactly as browsers parse it. Spec-correct, even if surprising.
  const r = parseSrcset('a.png,b.png 2x');
  assert.deepStrictEqual(r.map((c) => c.url), ['a.png,b.png']);
});

/* ------------------------------------------------------------------ *
 * 5. HTML extraction
 * ------------------------------------------------------------------ */
const PAGE = `
<!DOCTYPE html>
<html>
<head>
  <base href="https://site.test/docs/">
  <link rel="stylesheet" href="../css/main.css">
  <script src="//cdn.test/app.js"></script>
  <style>.x { background: url(not-a-link.png); }</style>
</head>
<body>
  <a href="page2.html">next</a>
  <a href='/home'>home</a>
  <a href="https://other.test/out">external</a>
  <a href="#section">anchor only</a>
  <a href="mailto:hi@site.test">mail</a>
  <a href="page2.html">dup of next</a>
  <img src="images/logo.png" alt="logo">
  <img srcset="hero-480.jpg 480w, hero-960.jpg 960w" src="hero.jpg">
  <!-- <a href="commented-out.html">should be ignored</a> -->
  <script>
    var s = '<a href="inside-script.html">nope</a>';
  </script>
</body>
</html>`;

check('extract honours <base href> for resolution', () => {
  const r = extract(PAGE, 'https://origin.test/start/index.html');
  assert.strictEqual(r.base, 'https://site.test/docs/');
});

check('extract resolves links against the effective base', () => {
  const r = extract(PAGE, 'https://origin.test/start/index.html');
  const urls = r.links.map((l) => l.url);
  assert.ok(urls.includes('https://site.test/docs/page2.html'), 'relative link resolved');
  assert.ok(urls.includes('https://site.test/home'), 'root-relative link resolved');
  assert.ok(urls.includes('https://other.test/out'), 'absolute external link kept');
});

check('extract skips anchors, mailto, and commented/scripted markup', () => {
  const r = extract(PAGE, 'https://origin.test/start/index.html');
  const urls = r.links.map((l) => l.url).join(' ');
  assert.ok(!/section/.test(urls), 'same-page #anchor skipped');
  assert.ok(!/mailto/.test(urls), 'mailto skipped');
  assert.ok(!/commented-out/.test(urls), 'commented-out link skipped');
  assert.ok(!/inside-script/.test(urls), 'link text inside <script> skipped');
  assert.ok(!/not-a-link/.test(JSON.stringify(r)), 'url() inside <style> skipped');
});

check('extract de-duplicates and counts repeats', () => {
  const r = extract(PAGE, 'https://origin.test/start/index.html');
  const next = r.links.find((l) => l.url === 'https://site.test/docs/page2.html');
  assert.strictEqual(next.count, 2, 'two identical hrefs collapse to one record, count 2');
});

check('extract classifies internal vs external against the base host', () => {
  const r = extract(PAGE, 'https://origin.test/start/index.html');
  const internal = r.links.find((l) => l.url === 'https://site.test/home');
  const external = r.links.find((l) => l.url === 'https://other.test/out');
  assert.strictEqual(internal.internal, true);
  assert.strictEqual(external.internal, false);
});

check('extract pulls images including every srcset candidate', () => {
  const r = extract(PAGE, 'https://origin.test/start/index.html');
  const imgs = r.images.map((i) => i.url);
  assert.ok(imgs.includes('https://site.test/docs/images/logo.png'), 'img src');
  assert.ok(imgs.includes('https://site.test/docs/hero-480.jpg'), 'srcset candidate 1');
  assert.ok(imgs.includes('https://site.test/docs/hero-960.jpg'), 'srcset candidate 2');
  assert.ok(imgs.includes('https://site.test/docs/hero.jpg'), 'img src alongside srcset');
});

check('extract collects non-link, non-image assets (css, js) separately', () => {
  const r = extract(PAGE, 'https://origin.test/start/index.html');
  const assets = r.assets.map((a) => a.url);
  assert.ok(assets.includes('https://site.test/css/main.css'), 'stylesheet resolved from ../');
  assert.ok(assets.includes('https://cdn.test/app.js'), 'protocol-relative script resolved');
});

check('decodeEntities turns &amp; back into & in query strings', () => {
  const r = extract('<a href="/s?a=1&amp;b=2">x</a>', 'https://h.test/');
  assert.strictEqual(r.links[0].url, 'https://h.test/s?a=1&b=2');
});

check('extraction is tolerant of unquoted and single-quoted attributes', () => {
  const r = extract("<a href=plain.html>x</a><a href='quoted.html'>y</a>", 'https://h.test/d/');
  const urls = r.links.map((l) => l.url);
  assert.ok(urls.includes('https://h.test/d/plain.html'));
  assert.ok(urls.includes('https://h.test/d/quoted.html'));
});

check("a '>' inside an attribute value does not end the tag early", () => {
  const r = extract('<a href="a.html" title="1 > 0">x</a>', 'https://h.test/');
  assert.strictEqual(r.links.length, 1);
  assert.strictEqual(r.links[0].url, 'https://h.test/a.html');
});

check('hostOf strips userinfo and port, keeps IPv6 literal', () => {
  assert.strictEqual(hostOf('http://user:pw@Example.COM:8080/x'), 'example.com');
  assert.strictEqual(hostOf('http://[2001:db8::1]:443/x'), '[2001:db8::1]');
  assert.strictEqual(hostOf('mailto:a@b.test'), '');
});

check('skipRef screens non-fetchable references', () => {
  for (const r of ['#', '#top', ' javascript:void(0)', 'mailto:a@b', 'tel:+1', 'data:image/png;base64,AAAA', '']) {
    assert.ok(skipRef(r), `should skip ${JSON.stringify(r)}`);
  }
  for (const r of ['/x', 'page.html', 'https://h/x', '//cdn/x']) {
    assert.ok(!skipRef(r), `should keep ${JSON.stringify(r)}`);
  }
});

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
if (failures.length === 0) {
  console.log(`\n  ✓ all ${passed} checks passing\n`);
} else {
  console.error(`\n  ${passed} passed, ${failures.length} FAILED:\n`);
  for (const [name, err] of failures) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err && err.message ? err.message : err}`);
  }
  process.exit(1);
}
