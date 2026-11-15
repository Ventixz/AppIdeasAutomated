/*
 * forum-core.js — the dependency-free engine behind the Web Board (Forum).
 *
 * Source 2 (karan/Projects) · Web · "Web Board (Forum) — a simple message board
 * system." Built by an automated Claude Code routine.
 *
 * A forum looks simple — threads, replies, done — but three things about it are
 * genuinely hard, and all three live in this file so they can be unit-tested
 * without a browser:
 *
 *   1. Rebuilding the nested reply TREE from the flat list the board stores,
 *      without dropping orphans (parent deleted) or looping forever on a cycle.
 *   2. BUMP ORDER: threads sort by last *live* activity — a removed reply must
 *      not float a thread, and a sticky thread pins to the top regardless.
 *   3. User posts are HOSTILE text: escape first, then autolink bare URLs
 *      safely (http/https only, trailing punctuation left outside the link).
 *
 * Runs under Node (module.exports) and in the browser (window.Forum).
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Trap 3 (part a) — escape every character HTML cares about.
 * This runs on raw user input BEFORE anything else touches it.
 * ------------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ *
 * Trap 3 (part b) — autolink bare URLs in already-escaped text.
 *
 * Why "already-escaped" matters: we never see a raw '<', so a URL can't carry
 * a tag out of the text. We only ever EMIT anchors we build ourselves, around
 * http/https URLs only — never javascript:, data:, etc., because the regex
 * simply doesn't match them.
 *
 * The classic bug this avoids: greedy matching that swallows trailing
 * punctuation. "(see http://x.com)." must link "http://x.com", not
 * "http://x.com)." — so we peel trailing .,!?;:'" off the end, and peel a
 * trailing ')' only when the URL has no matching '(' (so Wikipedia-style
 * "en.wikipedia.org/wiki/Foo_(bar)" keeps its paren).
 * ------------------------------------------------------------------ */
function autolink(escapedText) {
  // '<' never appears literally (input is escaped), so stop at whitespace only.
  const URL_RE = /\bhttps?:\/\/[^\s]+/g;
  return String(escapedText).replace(URL_RE, (match) => {
    let url = match;
    let trail = '';

    // Peel trailing punctuation that is almost never part of a URL.
    // ')' is handled specially below, so it is not in this set.
    let changed = true;
    while (changed && url.length) {
      changed = false;
      const last = url[url.length - 1];
      if ('.,!?;:\'"'.includes(last)) {
        trail = last + trail;
        url = url.slice(0, -1);
        changed = true;
        continue;
      }
      // A ';' at the end could be the tail of an entity we created while
      // escaping (e.g. "&amp;"). The loop above already strips a bare ';',
      // which is the safe choice for a trailing separator.
      if (last === ')') {
        const opens = (url.match(/\(/g) || []).length;
        const closes = (url.match(/\)/g) || []).length;
        if (closes > opens) {
          trail = last + trail;
          url = url.slice(0, -1);
          changed = true;
        }
      }
    }

    if (!url) return match; // nothing left to link; emit unchanged

    // url is already HTML-escaped, so it is safe inside both the href value
    // (quotes are &quot;) and the link text.
    return (
      '<a href="' + url + '" rel="nofollow noopener" target="_blank">' +
      url + '</a>' + trail
    );
  });
}

/* Full render pipeline for a post body: escape, autolink, newlines -> <br>. */
function renderBody(raw) {
  const escaped = escapeHtml(raw);
  const linked = autolink(escaped);
  return linked.replace(/\r\n|\r|\n/g, '<br>');
}

/* A short, safe preview (collapsed whitespace, truncated by code point so an
 * emoji is never split). Returns plain text (caller escapes if needed). */
function excerpt(raw, maxChars) {
  const n = maxChars == null ? 140 : maxChars;
  const collapsed = String(raw).replace(/\s+/g, ' ').trim();
  const cps = Array.from(collapsed); // code points, not UTF-16 units
  if (cps.length <= n) return collapsed;
  return cps.slice(0, n).join('').trimEnd() + '…';
}

/* ------------------------------------------------------------------ *
 * The board itself.
 * ------------------------------------------------------------------ */
const TOMBSTONE = '[deleted]';

class Board {
  constructor(state) {
    // state is optional restored JSON (from localStorage / export).
    state = state || {};
    this.threads = Array.isArray(state.threads) ? state.threads.slice() : [];
    this.posts = Array.isArray(state.posts) ? state.posts.slice() : [];
    this._seq = Number.isInteger(state.seq) ? state.seq : this._computeSeq();
  }

  _computeSeq() {
    let max = 0;
    for (const t of this.threads) max = Math.max(max, numId(t.id));
    for (const p of this.posts) max = Math.max(max, numId(p.id));
    return max;
  }

  _nextId(prefix) {
    this._seq += 1;
    return prefix + this._seq;
  }

  toJSON() {
    return { threads: this.threads, posts: this.posts, seq: this._seq };
  }

  /* --- creating content ------------------------------------------- */

  createThread({ title, author, body, createdAt, sticky }) {
    const t = normalizeText(title);
    if (!t) throw new Error('thread title is required');
    const now = createdAt == null ? Date.now() : createdAt;
    const thread = {
      id: this._nextId('t'),
      title: t,
      author: normalizeText(author) || 'anon',
      sticky: Boolean(sticky),
      createdAt: now,
    };
    this.threads.push(thread);
    // The opening post of a thread is a root post (parentId === null).
    const root = this._addPost({
      threadId: thread.id,
      parentId: null,
      author: thread.author,
      body,
      createdAt: now,
    });
    return { thread, post: root };
  }

  reply({ threadId, parentId, author, body, createdAt }) {
    const thread = this.getThread(threadId);
    if (!thread) throw new Error('no such thread: ' + threadId);
    // parentId may dangle or point elsewhere; the tree builder repairs it at
    // render time, so we store exactly what the caller gave us.
    return this._addPost({
      threadId,
      parentId: parentId == null ? null : parentId,
      author,
      body,
      createdAt,
    });
  }

  _addPost({ threadId, parentId, author, body, createdAt }) {
    const text = normalizeText(body);
    if (!text) throw new Error('post body is required');
    const post = {
      id: this._nextId('p'),
      threadId,
      parentId: parentId == null ? null : parentId,
      author: normalizeText(author) || 'anon',
      body: text,
      createdAt: createdAt == null ? Date.now() : createdAt,
      deleted: false,
    };
    this.posts.push(post);
    return post;
  }

  /* Soft delete: keep the row so the reply tree underneath it survives, but
   * blank the body and mark it a tombstone. Deleting the root tombstones the
   * opening post without destroying the thread or its replies. */
  deletePost(id) {
    const p = this.getPost(id);
    if (!p) return false;
    p.deleted = true;
    p.body = TOMBSTONE;
    return true;
  }

  getThread(id) {
    return this.threads.find((t) => t.id === id) || null;
  }
  getPost(id) {
    return this.posts.find((p) => p.id === id) || null;
  }
  postsIn(threadId) {
    return this.posts.filter((p) => p.threadId === threadId);
  }

  /* --- Trap 2: bump order ----------------------------------------- *
   * Last activity = newest createdAt among LIVE (non-deleted) posts in the
   * thread. If every post is deleted, fall back to the thread's own createdAt
   * so it still has a stable position. */
  lastActivity(threadId) {
    const live = this.postsIn(threadId).filter((p) => !p.deleted);
    if (live.length === 0) {
      const t = this.getThread(threadId);
      return t ? t.createdAt : 0;
    }
    return live.reduce((m, p) => Math.max(m, p.createdAt), -Infinity);
  }

  replyCount(threadId) {
    // Replies = live posts that are not the opening (root) post.
    return this.postsIn(threadId).filter((p) => !p.deleted && p.parentId !== null)
      .length;
  }

  /* Threads for the index page: sticky first, then most-recently-active,
   * with id as a final tiebreak so the order is fully deterministic. */
  listThreads() {
    return this.threads
      .map((t) => ({
        ...t,
        lastActivity: this.lastActivity(t.id),
        replies: this.replyCount(t.id),
      }))
      .sort((a, b) => {
        if (a.sticky !== b.sticky) return a.sticky ? -1 : 1;
        if (b.lastActivity !== a.lastActivity)
          return b.lastActivity - a.lastActivity;
        return numId(a.id) - numId(b.id);
      });
  }

  /* --- Trap 1: rebuild the reply tree ----------------------------- *
   * The board stores posts flat. The UI needs a nested tree. Three ways a
   * naive builder breaks, all handled here:
   *   (a) ORPHAN  — a reply whose parentId points at a missing post, or a post
   *                 in a different thread. We re-parent it to the thread root
   *                 rather than dropping it.
   *   (b) CYCLE   — editing could make A reply to B while B replies to A. A
   *                 naive recursion stack-overflows. We detect any node that
   *                 cannot reach the root by walking parents, and re-parent it.
   *   (c) ORDER   — siblings are sorted by (createdAt, id) so the tree is
   *                 stable no matter what order posts arrived in.
   */
  buildTree(threadId) {
    const posts = this.postsIn(threadId);
    const byId = new Map(posts.map((p) => [p.id, p]));
    const root = posts.find((p) => p.parentId === null) || null;
    if (!root) return null;

    // (a)+(b) Resolve an EFFECTIVE parent for every post.
    const effParent = new Map(); // postId -> effective parentId (or null)
    const resolve = (p) => {
      if (p.id === root.id) return null;
      // Walk up the declared-parent chain. If we reach the root, the declared
      // parent is usable. If we hit a missing parent, a cross-thread parent,
      // or revisit a node (cycle), fall back to the root.
      const seen = new Set();
      let cur = p;
      while (true) {
        if (cur.parentId === null) {
          // Reached a root. Only the thread's own root counts.
          return cur.id === root.id ? p.parentId : root.id;
        }
        if (seen.has(cur.id)) return root.id; // cycle
        seen.add(cur.id);
        const next = byId.get(cur.parentId);
        if (!next || next.threadId !== threadId) return root.id; // orphan
        cur = next;
      }
    };
    for (const p of posts) effParent.set(p.id, resolve(p));

    // (c) Group children by effective parent and sort each sibling group.
    const children = new Map();
    for (const p of posts) {
      if (p.id === root.id) continue;
      const par = effParent.get(p.id);
      if (!children.has(par)) children.set(par, []);
      children.get(par).push(p);
    }
    const sortSibs = (arr) =>
      arr.sort((a, b) =>
        a.createdAt !== b.createdAt
          ? a.createdAt - b.createdAt
          : numId(a.id) - numId(b.id)
      );

    const build = (post, visited) => {
      // visited guards against any cycle the resolver somehow let through.
      if (visited.has(post.id)) return null;
      visited.add(post.id);
      const kids = sortSibs((children.get(post.id) || []).slice());
      return {
        post,
        children: kids
          .map((k) => build(k, visited))
          .filter(Boolean),
      };
    };
    return build(root, new Set());
  }

  /* Total node count of a built tree — handy for tests and UI counts. */
  static countTree(node) {
    if (!node) return 0;
    return 1 + node.children.reduce((n, c) => n + Board.countTree(c), 0);
  }

  /* Max nesting depth of a built tree (root = depth 1). */
  static treeDepth(node) {
    if (!node) return 0;
    if (node.children.length === 0) return 1;
    return 1 + Math.max(...node.children.map((c) => Board.treeDepth(c)));
  }
}

/* ------------------------------------------------------------------ *
 * small helpers
 * ------------------------------------------------------------------ */
function normalizeText(s) {
  if (s == null) return '';
  return String(s).trim();
}

// "p17" -> 17, "t3" -> 3, used for deterministic tiebreaks.
function numId(id) {
  const m = /(\d+)\s*$/.exec(String(id));
  return m ? parseInt(m[1], 10) : 0;
}

const Forum = {
  escapeHtml,
  autolink,
  renderBody,
  excerpt,
  Board,
  TOMBSTONE,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Forum;
}
if (typeof window !== 'undefined') {
  window.Forum = Forum;
}
