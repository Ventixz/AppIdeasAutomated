/*
 * tests.js — zero-dependency checks for forum-core.js. Run: `node tests.js`.
 */

'use strict';

const F = require('./forum-core.js');
const { Board } = F;

let passed = 0;
let failed = 0;

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
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
    console.error(`FAIL: ${msg}\n   "${needle}" SHOULD NOT appear in:\n   ${hay}`);
  }
}
function throws(fn, msg) {
  try {
    fn();
    failed++;
    console.error(`FAIL: ${msg}\n   expected throw, got none`);
  } catch (_) {
    passed++;
  }
}

/* ============================================================= *
 * Trap 3a — escapeHtml
 * ============================================================= */
eq(F.escapeHtml('<b>'), '&lt;b&gt;', 'escape angle brackets');
eq(F.escapeHtml('a & b'), 'a &amp; b', 'escape ampersand');
eq(F.escapeHtml('"x"'), '&quot;x&quot;', 'escape double quote');
eq(F.escapeHtml("it's"), 'it&#39;s', 'escape single quote');
eq(
  F.escapeHtml('<script>alert(1)</script>'),
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  'escape a script tag whole'
);
eq(F.escapeHtml('plain'), 'plain', 'plain text untouched');
// Ampersand escaped first so entities are not double-mangled into tags.
eq(F.escapeHtml('<&>'), '&lt;&amp;&gt;', 'ampersand-first ordering');

/* ============================================================= *
 * Trap 3b — autolink (input is already escaped)
 * ============================================================= */
includes(
  F.autolink('see http://example.com here'),
  '<a href="http://example.com"',
  'linkifies a bare http url'
);
includes(F.autolink('https://a.io'), 'target="_blank"', 'adds target blank');
includes(F.autolink('https://a.io'), 'rel="nofollow noopener"', 'adds rel');

// Trailing punctuation stays OUTSIDE the link.
{
  const out = F.autolink('go to http://x.com.');
  includes(out, '>http://x.com</a>.', 'trailing period left outside link');
  excludes(out, 'x.com.</a>', 'period not swallowed into href text');
}
{
  const out = F.autolink('(see http://x.com)');
  includes(out, '>http://x.com</a>)', 'unbalanced close paren left outside');
}
{
  // Balanced parens inside the URL are kept (Wikipedia case).
  const out = F.autolink('http://en.wikipedia.org/wiki/Foo_(bar)');
  includes(out, 'wiki/Foo_(bar)</a>', 'balanced parens kept in url');
}
{
  const out = F.autolink('ping http://x.com, then http://y.com!');
  includes(out, '>http://x.com</a>,', 'comma after first url outside');
  includes(out, '>http://y.com</a>!', 'bang after second url outside');
}
// Dangerous schemes are never linkified (regex only matches http/https).
excludes(
  F.autolink(F.escapeHtml('click javascript:alert(1)')),
  '<a ',
  'javascript: scheme is not linked'
);
excludes(
  F.autolink(F.escapeHtml('data:text/html,<b>')),
  '<a ',
  'data: scheme is not linked'
);
// No URL -> text unchanged.
eq(F.autolink('nothing here'), 'nothing here', 'plain text unchanged');

/* ============================================================= *
 * renderBody — the full pipeline is XSS-safe end to end
 * ============================================================= */
{
  const evil = 'hi <script>alert(document.cookie)</script> http://ok.com';
  const html = F.renderBody(evil);
  excludes(html, '<script>', 'no raw script tag survives renderBody');
  includes(html, '&lt;script&gt;', 'script tag is shown as escaped text');
  includes(html, '<a href="http://ok.com"', 'safe url still linked in body');
}
{
  // A URL that itself contains an attempted tag cannot break out.
  const html = F.renderBody('http://x.com/"><img src=x onerror=1>');
  excludes(html, '<img', 'injected img tag neutralised');
  includes(html, '&quot;&gt;&lt;img', 'injection shown as escaped text');
}
eq(F.renderBody('line1\nline2'), 'line1<br>line2', 'newline becomes <br>');
eq(F.renderBody('a\r\nb'), 'a<br>b', 'CRLF becomes single <br>');

/* ============================================================= *
 * excerpt — code-point-safe truncation
 * ============================================================= */
eq(F.excerpt('short', 140), 'short', 'short string unchanged');
eq(F.excerpt('  a   b  ', 140), 'a b', 'whitespace collapsed');
eq(F.excerpt('abcdef', 3), 'abc…', 'truncates with ellipsis');
{
  // '😀' is a surrogate pair; truncating by code point must not split it.
  const s = '😀😀😀😀😀';
  const out = F.excerpt(s, 2);
  eq(Array.from(out).length, 3, 'two emoji + ellipsis, no broken surrogate');
  ok(!out.includes('�'), 'no replacement char from a split emoji');
}

/* ============================================================= *
 * Board — creating threads and replies
 * ============================================================= */
{
  const b = new Board();
  const { thread, post } = b.createThread({
    title: 'Hello world',
    author: 'ada',
    body: 'first post',
    createdAt: 1000,
  });
  ok(thread.id, 'thread gets an id');
  eq(post.parentId, null, 'opening post is a root (parentId null)');
  eq(b.postsIn(thread.id).length, 1, 'thread starts with one post');
  eq(b.replyCount(thread.id), 0, 'no replies yet');

  const r1 = b.reply({
    threadId: thread.id,
    parentId: post.id,
    author: 'bob',
    body: 'nice',
    createdAt: 2000,
  });
  ok(r1.id !== post.id, 'reply gets a distinct id');
  eq(b.replyCount(thread.id), 1, 'one reply counted');
  eq(b.lastActivity(thread.id), 2000, 'bump time follows newest post');

  throws(() => b.createThread({ title: '', body: 'x' }), 'empty title rejected');
  throws(
    () => b.reply({ threadId: thread.id, body: '' }),
    'empty reply body rejected'
  );
  throws(
    () => b.reply({ threadId: 'nope', body: 'x' }),
    'reply to missing thread rejected'
  );
  // Blank author defaults to anon.
  const r2 = b.reply({ threadId: thread.id, parentId: post.id, body: 'yo' });
  eq(r2.author, 'anon', 'blank author becomes anon');
}

/* ============================================================= *
 * Trap 1 — reply tree: normal nesting
 * ============================================================= */
{
  const b = new Board();
  const { thread, post: root } = b.createThread({
    title: 'T',
    body: 'root',
    createdAt: 1,
  });
  const a = b.reply({ threadId: thread.id, parentId: root.id, body: 'a', createdAt: 2 });
  const c = b.reply({ threadId: thread.id, parentId: a.id, body: 'c', createdAt: 3 });
  b.reply({ threadId: thread.id, parentId: root.id, body: 'b', createdAt: 4 });

  const tree = b.buildTree(thread.id);
  eq(tree.post.id, root.id, 'tree root is the opening post');
  eq(tree.children.length, 2, 'root has two direct replies');
  // Siblings sorted by createdAt: 'a' (t2) before 'b' (t4).
  eq(tree.children[0].post.body, 'a', 'first sibling by time is a');
  eq(tree.children[1].post.body, 'b', 'second sibling by time is b');
  eq(tree.children[0].children[0].post.id, c.id, 'c nests under a');
  eq(Board.countTree(tree), 4, 'four nodes total');
  eq(Board.treeDepth(tree), 3, 'depth is three (root -> a -> c)');
}

/* ============================================================= *
 * Trap 1a — ORPHAN: reply whose parent was deleted is NOT dropped
 * ============================================================= */
{
  const b = new Board();
  const { thread, post: root } = b.createThread({ title: 'T', body: 'r', createdAt: 1 });
  const mid = b.reply({ threadId: thread.id, parentId: root.id, body: 'm', createdAt: 2 });
  const leaf = b.reply({ threadId: thread.id, parentId: mid.id, body: 'l', createdAt: 3 });

  // Soft-delete the middle post: it becomes a tombstone but stays in the tree.
  b.deletePost(mid.id);
  const tree = b.buildTree(thread.id);
  eq(Board.countTree(tree), 3, 'tombstoned parent keeps all three nodes');
  const midNode = tree.children.find((c) => c.post.id === mid.id);
  eq(midNode.post.body, F.TOMBSTONE, 'deleted post shows as tombstone');
  eq(midNode.children[0].post.id, leaf.id, 'child still hangs under tombstone');
}
{
  // True orphan: parentId points at an id that never existed. Re-parent to root.
  const b = new Board();
  const { thread, post: root } = b.createThread({ title: 'T', body: 'r', createdAt: 1 });
  const orphan = b.reply({
    threadId: thread.id,
    parentId: 'p9999',
    body: 'lost',
    createdAt: 2,
  });
  const tree = b.buildTree(thread.id);
  const found = tree.children.find((c) => c.post.id === orphan.id);
  ok(found, 'orphan re-parented to root, not dropped');
  eq(Board.countTree(tree), 2, 'root + re-parented orphan');
}
{
  // Cross-thread parent is treated as an orphan too.
  const b = new Board();
  const t1 = b.createThread({ title: 'A', body: 'r1', createdAt: 1 });
  const t2 = b.createThread({ title: 'B', body: 'r2', createdAt: 1 });
  const cross = b.reply({
    threadId: t2.thread.id,
    parentId: t1.post.id, // parent lives in a different thread
    body: 'x',
    createdAt: 2,
  });
  const tree = b.buildTree(t2.thread.id);
  const found = tree.children.find((c) => c.post.id === cross.id);
  ok(found, 'cross-thread parent re-parented to local root');
}

/* ============================================================= *
 * Trap 1b — CYCLE: must not loop forever, must not lose nodes
 * ============================================================= */
{
  const b = new Board();
  const { thread, post: root } = b.createThread({ title: 'T', body: 'r', createdAt: 1 });
  const x = b.reply({ threadId: thread.id, parentId: root.id, body: 'x', createdAt: 2 });
  const y = b.reply({ threadId: thread.id, parentId: x.id, body: 'y', createdAt: 3 });
  // Force a cycle by editing x to point at y (x -> y -> x ...).
  b.getPost(x.id).parentId = y.id;

  let tree;
  // The real assertion: this returns instead of hanging / overflowing.
  tree = b.buildTree(thread.id);
  ok(tree, 'buildTree returns on a cycle (no infinite loop)');
  eq(Board.countTree(tree), 3, 'cycle nodes re-parented, none lost');
  // x and y both reachable from root somewhere in the tree.
  const ids = [];
  (function collect(n) {
    ids.push(n.post.id);
    n.children.forEach(collect);
  })(tree);
  ok(ids.includes(x.id) && ids.includes(y.id), 'both cycle members present');
}

/* ============================================================= *
 * Trap 2 — bump order
 * ============================================================= */
{
  const b = new Board();
  const t1 = b.createThread({ title: 'old', body: 'r', createdAt: 100 });
  const t2 = b.createThread({ title: 'new', body: 'r', createdAt: 200 });
  // t1 gets a fresh reply -> should bump above t2.
  b.reply({ threadId: t1.thread.id, parentId: t1.post.id, body: 'bump', createdAt: 300 });

  let list = b.listThreads();
  eq(list[0].title, 'old', 'thread with newest reply bumps to top');
  eq(list[1].title, 'new', 'untouched newer thread falls below');

  // A DELETED reply must NOT bump the thread.
  const b2 = new Board();
  const a = b2.createThread({ title: 'a', body: 'r', createdAt: 100 });
  const c = b2.createThread({ title: 'c', body: 'r', createdAt: 200 });
  const spam = b2.reply({ threadId: a.thread.id, parentId: a.post.id, body: 'spam', createdAt: 999 });
  b2.deletePost(spam.id); // removed by a mod
  list = b2.listThreads();
  eq(list[0].title, 'c', 'deleted reply does not float its thread');
  eq(b2.lastActivity(a.thread.id), 100, 'bump time ignores deleted posts');

  // Sticky pins to the very top regardless of activity.
  const b3 = new Board();
  b3.createThread({ title: 'rules', body: 'r', createdAt: 1, sticky: true });
  const hot = b3.createThread({ title: 'hot', body: 'r', createdAt: 500 });
  b3.reply({ threadId: hot.thread.id, parentId: hot.post.id, body: 'x', createdAt: 9999 });
  list = b3.listThreads();
  eq(list[0].title, 'rules', 'sticky thread stays on top');
  eq(list[1].title, 'hot', 'active non-sticky thread comes after sticky');
}
{
  // Thread with every post deleted still has a stable position (root time).
  const b = new Board();
  const only = b.createThread({ title: 'ghost', body: 'r', createdAt: 42 });
  b.deletePost(only.post.id);
  eq(b.lastActivity(only.thread.id), 42, 'all-deleted thread falls back to its createdAt');
  eq(b.listThreads().length, 1, 'thread still listed after root deleted');
}

/* ============================================================= *
 * Persistence round-trip (export / import)
 * ============================================================= */
{
  const b = new Board();
  const { thread, post } = b.createThread({ title: 'persist', body: 'r', createdAt: 1 });
  b.reply({ threadId: thread.id, parentId: post.id, body: 'child', createdAt: 2 });
  const json = JSON.parse(JSON.stringify(b.toJSON()));

  const restored = new Board(json);
  eq(restored.listThreads().length, 1, 'thread survives round-trip');
  eq(restored.replyCount(thread.id), 1, 'reply survives round-trip');
  // New ids keep climbing past the restored max (no collision).
  const r = restored.reply({ threadId: thread.id, parentId: post.id, body: 'more', createdAt: 3 });
  const allIds = restored.posts.map((p) => p.id);
  eq(new Set(allIds).size, allIds.length, 'no id collision after restore');
  ok(r.id !== post.id, 'restored board mints fresh ids');
}
{
  // Empty / garbage state does not crash the constructor.
  const b = new Board({ threads: null, posts: 'nope' });
  eq(b.listThreads().length, 0, 'garbage state yields empty board');
  eq(b.buildTree('whatever'), null, 'buildTree on unknown thread is null');
}

/* ============================================================= */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
