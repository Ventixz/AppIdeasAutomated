/*
 * tests.js — zero-dependency checks for cms-core.js. Run: `node tests.js`.
 */

'use strict';

const C = require('./cms-core.js');

let passed = 0;
let failed = 0;

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${msg}\n   expected: ${e}\n   actual:   ${a}`);
  }
}
function ok(cond, msg) {
  eq(Boolean(cond), true, msg);
}
function includes(hay, needle, msg) {
  if (String(hay).includes(needle)) passed++;
  else {
    failed++;
    console.error(`FAIL: ${msg}\n   "${needle}" not found in:\n   ${hay}`);
  }
}
function excludes(hay, needle, msg) {
  if (!String(hay).includes(needle)) passed++;
  else {
    failed++;
    console.error(`FAIL: ${msg}\n   "${needle}" unexpectedly present in:\n   ${hay}`);
  }
}

/* ---------------- escapeHtml ---------------- */

eq(C.escapeHtml('<b>'), '&lt;b&gt;', 'escapes angle brackets');
eq(C.escapeHtml('a & b'), 'a &amp; b', 'escapes ampersand');
eq(C.escapeHtml(`"'`), '&quot;&#39;', 'escapes quotes');
eq(C.escapeHtml('plain'), 'plain', 'leaves plain text alone');

/* ---------------- sanitizeUrl ---------------- */

eq(C.sanitizeUrl('https://example.com'), 'https://example.com', 'allows https');
eq(C.sanitizeUrl('http://x.io/a?b=1#c'), 'http://x.io/a?b=1#c', 'allows http w/ query');
eq(C.sanitizeUrl('mailto:a@b.com'), 'mailto:a@b.com', 'allows mailto');
eq(C.sanitizeUrl('/relative/path'), '/relative/path', 'allows root-relative');
eq(C.sanitizeUrl('page.html'), 'page.html', 'allows plain relative');
eq(C.sanitizeUrl('#anchor'), '#anchor', 'allows fragment');
eq(C.sanitizeUrl('//cdn.example.com/x'), '//cdn.example.com/x', 'allows protocol-relative');
eq(C.sanitizeUrl('javascript:alert(1)'), '#', 'blocks javascript: scheme');
eq(C.sanitizeUrl('JaVaScRiPt:alert(1)'), '#', 'blocks javascript: case-insensitively');
eq(C.sanitizeUrl('data:text/html,<script>'), '#', 'blocks data: scheme');
eq(C.sanitizeUrl('vbscript:msgbox'), '#', 'blocks vbscript: scheme');
eq(C.sanitizeUrl('java\tscript:alert(1)'), '#', 'blocks tab-obfuscated javascript:');
eq(C.sanitizeUrl('  javascript:alert(1)  '), '#', 'blocks whitespace-padded javascript:');
eq(C.sanitizeUrl(''), '#', 'empty url → #');

/* ---------------- slugify ---------------- */

eq(C.slugify('Hello World'), 'hello-world', 'basic slug');
eq(C.slugify('  Trim  Me  '), 'trim-me', 'collapses/trims whitespace');
eq(C.slugify('Café Déjà Vu'), 'cafe-deja-vu', 'folds accents to ascii');
eq(C.slugify('C++ & C#'), 'c-c', 'drops punctuation');
eq(C.slugify('---weird---'), 'weird', 'trims leading/trailing hyphens');
eq(C.slugify('100% Pure'), '100-pure', 'keeps digits');
eq(C.slugify(''), 'untitled', 'empty title → untitled');
eq(C.slugify('   '), 'untitled', 'whitespace title → untitled');
eq(C.slugify('你好'), 'untitled', 'non-latin with no ascii → untitled');

/* ---------------- uniqueSlug ---------------- */

eq(C.uniqueSlug('My Post', []), 'my-post', 'unique when nothing taken');
eq(C.uniqueSlug('My Post', ['my-post']), 'my-post-2', 'collision → -2');
eq(C.uniqueSlug('My Post', ['my-post', 'my-post-2']), 'my-post-3', 'collision → -3');
eq(C.uniqueSlug('My Post', new Set(['my-post'])), 'my-post-2', 'accepts a Set');

/* ---------------- renderInline ---------------- */

eq(C.renderInline('**bold**'), '<strong>bold</strong>', 'bold');
eq(C.renderInline('*italic*'), '<em>italic</em>', 'italic');
eq(C.renderInline('**b** and *i*'), '<strong>b</strong> and <em>i</em>', 'bold + italic');
eq(C.renderInline('`code`'), '<code>code</code>', 'inline code');
includes(C.renderInline('`<script>`'), '<code>&lt;script&gt;</code>', 'code escapes html');
// Code spans are literal — markdown inside them is NOT interpreted:
eq(C.renderInline('`*not italic*`'), '<code>*not italic*</code>', 'no markdown inside code');
eq(
  C.renderInline('[text](https://x.io)'),
  '<a href="https://x.io">text</a>',
  'link'
);
includes(
  C.renderInline('[x](javascript:alert(1))'),
  'href="#"',
  'link with js scheme is neutralised'
);
includes(
  C.renderInline('![alt](pic.png)'),
  '<img src="pic.png" alt="alt">',
  'image'
);
includes(
  C.renderInline('![x](javascript:alert(1))'),
  'src="#"',
  'image with js scheme is neutralised'
);
// Raw HTML in prose is escaped, not passed through:
eq(
  C.renderInline('<script>alert(1)</script>'),
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  'raw html is escaped'
);

/* ---------------- renderMarkdown: blocks ---------------- */

eq(C.renderMarkdown('# Title'), '<h1>Title</h1>', 'h1');
eq(C.renderMarkdown('### Three'), '<h3>Three</h3>', 'h3');
eq(C.renderMarkdown('###### Six'), '<h6>Six</h6>', 'h6');
eq(C.renderMarkdown('Just a line.'), '<p>Just a line.</p>', 'paragraph');
eq(
  C.renderMarkdown('one\ntwo'),
  '<p>one two</p>',
  'consecutive lines join into one paragraph'
);
eq(
  C.renderMarkdown('a\n\nb'),
  '<p>a</p>\n<p>b</p>',
  'blank line splits paragraphs'
);
eq(C.renderMarkdown('---'), '<hr>', 'horizontal rule');
eq(
  C.renderMarkdown('- one\n- two'),
  '<ul><li>one</li><li>two</li></ul>',
  'unordered list'
);
eq(
  C.renderMarkdown('1. first\n2. second'),
  '<ol><li>first</li><li>second</li></ol>',
  'ordered list'
);
eq(
  C.renderMarkdown('> quoted'),
  '<blockquote>quoted</blockquote>',
  'blockquote'
);
includes(
  C.renderMarkdown('```\n<x>\n```'),
  '<pre><code>&lt;x&gt;</code></pre>',
  'fenced code escapes html'
);
includes(
  C.renderMarkdown('```js\nvar a=1;\n```'),
  'class="language-js"',
  'fenced code carries language class'
);
// Markdown inside a code fence is literal:
const fenced = C.renderMarkdown('```\n# not a heading\n*not italic*\n```');
includes(fenced, '# not a heading', 'no heading parsing inside fence');
excludes(fenced, '<em>', 'no emphasis parsing inside fence');
// A heading immediately followed by a paragraph:
eq(
  C.renderMarkdown('# H\ntext'),
  '<h1>H</h1>\n<p>text</p>',
  'heading then paragraph'
);

/* ---------------- excerpt ---------------- */

eq(C.excerpt('short text'), 'short text', 'short text unchanged');
eq(
  C.excerpt('**bold** and `code` and [link](x)'),
  'bold and and link',
  'excerpt strips markdown'
);
ok(C.excerpt('word '.repeat(100), 50).length <= 51, 'excerpt respects max length');
ok(C.excerpt('word '.repeat(100), 50).endsWith('…'), 'long excerpt ends with ellipsis');

/* ---------------- normalizeTags ---------------- */

eq(C.normalizeTags(['A', 'b', 'A']), ['a', 'b'], 'lowercases + dedupes array');
eq(C.normalizeTags('One, Two , one'), ['one', 'two'], 'splits + dedupes string');
eq(C.normalizeTags([' ', '', 'x']), ['x'], 'drops blanks');

/* ---------------- CMS store ---------------- */

function freshCms() {
  let n = 0;
  let t = 0;
  return new C.CMS({
    idgen: () => `id${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  });
}

{
  const cms = freshCms();
  const p = cms.create({ title: 'Hello World', body: 'Hi' });
  eq(p.id, 'id1', 'create assigns id');
  eq(p.slug, 'hello-world', 'create derives slug');
  eq(p.status, 'draft', 'create defaults to draft');
  eq(p.type, 'post', 'create defaults to type post');
  ok(p.createdAt === p.updatedAt, 'create sets equal timestamps');
}

{
  const cms = freshCms();
  cms.create({ title: 'Dup' });
  const b = cms.create({ title: 'Dup' });
  eq(b.slug, 'dup-2', 'duplicate titles get unique slugs');
}

{
  const cms = freshCms();
  const p = cms.create({ title: 'Orig' });
  const slugBefore = p.slug;
  const u = cms.update(p.id, { title: 'Renamed' });
  eq(u.title, 'Renamed', 'update changes title');
  eq(u.slug, slugBefore, 'renaming title does NOT change slug (links stay valid)');
  ok(u.updatedAt > u.createdAt, 'update bumps updatedAt');
}

{
  const cms = freshCms();
  const p = cms.create({ title: 'A' });
  cms.create({ title: 'B' }); // its slug is 'b'
  const u = cms.update(p.id, { slug: 'B' });
  eq(u.slug, 'b-2', 'explicit re-slug de-dupes against others');
}

{
  const cms = freshCms();
  const p = cms.create({ title: 'Publish me' });
  eq(cms.publish(p.id).status, 'published', 'publish sets status');
  eq(cms.unpublish(p.id).status, 'draft', 'unpublish reverts status');
}

{
  const cms = freshCms();
  const p = cms.create({ title: 'Delete me' });
  eq(cms.remove(p.id), true, 'remove returns true when it deletes');
  eq(cms.get(p.id), null, 'removed item is gone');
  eq(cms.remove('nope'), false, 'remove returns false when nothing matches');
}

{
  const cms = freshCms();
  cms.create({ title: 'Draft one' });
  const pub = cms.create({ title: 'Published one', status: 'published' });
  eq(cms.list().length, 2, 'list returns all');
  eq(cms.published().length, 1, 'published returns only published');
  eq(cms.published()[0].id, pub.id, 'published returns the right one');
}

{
  const cms = freshCms();
  const first = cms.create({ title: 'First' });
  const second = cms.create({ title: 'Second' });
  // Newest first:
  eq(cms.list()[0].id, second.id, 'list is newest-first');
  eq(cms.list()[1].id, first.id, 'list ordering stable');
}

{
  const cms = freshCms();
  cms.create({ title: 'Tagged', tags: ['news', 'tech'], status: 'published' });
  cms.create({ title: 'Other', tags: ['tech'], status: 'published' });
  eq(cms.list({ tag: 'news' }).length, 1, 'filter by tag');
  eq(cms.list({ tag: 'tech' }).length, 2, 'filter by shared tag');
  eq(cms.list({ query: 'other' }).length, 1, 'filter by query on title');
}

{
  const cms = freshCms();
  cms.create({ title: 'X', tags: ['a', 'b'], status: 'published' });
  cms.create({ title: 'Y', tags: ['a'], status: 'published' });
  cms.create({ title: 'Z', tags: ['a'], status: 'draft' }); // draft excluded
  const cloud = cms.tagCloud();
  eq(cloud[0], { tag: 'a', count: 2 }, 'tag cloud counts published only, by freq');
  eq(cloud[1], { tag: 'b', count: 1 }, 'tag cloud secondary entry');
}

{
  const cms = freshCms();
  cms.create({ title: 'Round', body: 'trip', tags: ['x'], status: 'published' });
  const json = cms.toJSON();
  const restored = C.CMS.fromJSON(json);
  eq(restored.items.length, 1, 'fromJSON restores items');
  eq(restored.items[0].title, 'Round', 'fromJSON restores fields');
  eq(C.CMS.fromJSON('not json').items.length, 0, 'fromJSON tolerates garbage');
  eq(C.CMS.fromJSON('{"items":"x"}').items.length, 0, 'fromJSON tolerates bad shape');
}

{
  const cms = freshCms();
  try {
    cms.create({ title: 'bad', status: 'weird' });
    ok(false, 'invalid status should throw');
  } catch {
    ok(true, 'invalid status throws on create');
  }
}

/* ---------------- renderSite ---------------- */

{
  const cms = freshCms();
  cms.create({ title: 'Visible', body: '# Hi\n\nBody here.', status: 'published' });
  cms.create({ title: 'Hidden draft', status: 'draft' });
  const site = C.renderSite(cms, { siteTitle: 'Blog' });
  ok('index.html' in site, 'site has index.html');
  ok('visible.html' in site, 'site has the published post page');
  ok(!('hidden-draft.html' in site), 'site omits draft pages');
  includes(site['index.html'], 'Visible', 'index lists published post');
  excludes(site['index.html'], 'Hidden draft', 'index omits drafts');
  includes(site['visible.html'], '<h1>Hi</h1>', 'post page renders markdown body');
  includes(site['visible.html'], '<title>Visible — Blog</title>', 'post page has title tag');
}

{
  // End-to-end XSS: a malicious post must not produce executable markup.
  const cms = freshCms();
  cms.create({
    title: 'Pwn',
    body: 'Hi <script>alert(1)</script> [x](javascript:alert(2))',
    status: 'published',
  });
  const page = C.renderSite(cms)['pwn.html'];
  excludes(page, '<script>alert(1)</script>', 'no raw script tag survives to output');
  includes(page, '&lt;script&gt;', 'script tag is escaped');
  excludes(page, 'href="javascript:', 'no javascript: href survives to output');
}

/* ---------------- summary ---------------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
