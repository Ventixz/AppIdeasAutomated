/*
 * script.js — browser glue for the Web Board. All forum logic lives in
 * forum-core.js (and is unit-tested there); this file only renders and wires
 * up events. Nothing here constructs HTML from raw user input without going
 * through Forum.renderBody / escapeHtml.
 */

'use strict';

(function () {
  const { Board } = window.Forum;
  const STORE_KEY = 'web-board-forum:v1';

  // ---- persistence (fails soft in private mode) ---------------------
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? new Board(JSON.parse(raw)) : new Board();
    } catch (_) {
      return new Board();
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(board.toJSON()));
    } catch (_) {
      /* ignore quota / disabled storage */
    }
  }

  let board = load();
  let openThreadId = null;

  // ---- element refs --------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const indexView = $('indexView');
  const threadView = $('threadView');
  const threadList = $('threadList');
  const emptyThreads = $('emptyThreads');

  function fmtTime(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  // ---- INDEX view ----------------------------------------------------
  function renderIndex() {
    const threads = board.listThreads();
    threadList.innerHTML = '';
    emptyThreads.hidden = threads.length > 0;

    for (const t of threads) {
      const li = document.createElement('li');
      li.className = 'thread-item' + (t.sticky ? ' sticky' : '');
      li.dataset.id = t.id;

      const root = board.postsIn(t.id).find((p) => p.parentId === null);
      const previewText = root ? window.Forum.excerpt(root.body, 120) : '';

      // Title + author are user text -> escape. Preview also escaped.
      const h3 = document.createElement('h3');
      if (t.sticky) {
        const pin = document.createElement('span');
        pin.className = 'pin';
        pin.textContent = '📌 PINNED';
        h3.appendChild(pin);
      }
      h3.appendChild(document.createTextNode(t.title));
      li.appendChild(h3);

      const prev = document.createElement('p');
      prev.className = 'preview';
      prev.textContent = previewText;
      li.appendChild(prev);

      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent =
        `by ${t.author} · ${t.replies} ${t.replies === 1 ? 'reply' : 'replies'}` +
        ` · active ${fmtTime(t.lastActivity)}`;
      li.appendChild(meta);

      li.addEventListener('click', () => openThread(t.id));
      threadList.appendChild(li);
    }
  }

  // ---- THREAD view ---------------------------------------------------
  function openThread(id) {
    openThreadId = id;
    const t = board.getThread(id);
    if (!t) return showIndex();
    $('threadTitle').textContent = t.title;
    const replies = board.replyCount(id);
    $('threadMeta').textContent =
      `started by ${t.author} on ${fmtTime(t.createdAt)} · ` +
      `${replies} ${replies === 1 ? 'reply' : 'replies'}`;
    renderTree();
    indexView.hidden = true;
    threadView.hidden = false;
    window.scrollTo(0, 0);
  }

  function renderTree() {
    const container = $('postTree');
    container.innerHTML = '';
    const tree = board.buildTree(openThreadId);
    if (!tree) return;
    container.appendChild(renderNode(tree, true));
  }

  function renderNode(node, isRoot) {
    const post = node.post;
    const el = document.createElement('div');
    el.className = 'post' + (isRoot ? ' root' : '') + (post.deleted ? ' tomb' : '');

    const head = document.createElement('div');
    head.className = 'phead';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = post.deleted ? '—' : post.author; // author escaped via textContent
    head.appendChild(who);
    head.appendChild(document.createTextNode(' · ' + fmtTime(post.createdAt)));
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'pbody';
    if (post.deleted) {
      body.textContent = window.Forum.TOMBSTONE;
    } else {
      // The ONE place we trust HTML — and only because renderBody escapes the
      // raw text first and then re-introduces only anchors/<br> it built itself.
      body.innerHTML = window.Forum.renderBody(post.body);
    }
    el.appendChild(body);

    if (!post.deleted) {
      const actions = document.createElement('div');
      actions.className = 'pactions';

      const replyBtn = document.createElement('button');
      replyBtn.className = 'linklike';
      replyBtn.textContent = 'Reply';
      replyBtn.addEventListener('click', () => showReplyForm(el, post.id));
      actions.appendChild(replyBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'linklike danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        board.deletePost(post.id);
        save();
        renderTree();
      });
      actions.appendChild(delBtn);
      el.appendChild(actions);
    }

    if (node.children.length) {
      const kids = document.createElement('div');
      kids.className = 'kids';
      for (const child of node.children) kids.appendChild(renderNode(child, false));
      el.appendChild(kids);
    }
    return el;
  }

  function showReplyForm(afterEl, parentId) {
    // Only one reply form open at a time.
    document.querySelectorAll('.reply-composer').forEach((f) => f.remove());
    const frag = $('replyTpl').content.cloneNode(true);
    const form = frag.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const author = form.querySelector('.r-author').value;
      const bodyText = form.querySelector('.r-body').value;
      if (!bodyText.trim()) return;
      board.reply({ threadId: openThreadId, parentId, author, body: bodyText });
      save();
      renderTree();
    });
    form.querySelector('.r-cancel').addEventListener('click', () => form.remove());
    afterEl.appendChild(form);
    form.querySelector('.r-body').focus();
  }

  function showIndex() {
    openThreadId = null;
    threadView.hidden = true;
    indexView.hidden = false;
    renderIndex();
  }

  // ---- new-thread composer ------------------------------------------
  const ntForm = $('newThreadForm');
  $('newThreadBtn').addEventListener('click', () => {
    ntForm.hidden = !ntForm.hidden;
    if (!ntForm.hidden) $('ntTitle').focus();
  });
  $('ntCancel').addEventListener('click', () => (ntForm.hidden = true));
  ntForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('ntTitle').value;
    const body = $('ntBody').value;
    if (!title.trim() || !body.trim()) return;
    board.createThread({
      title,
      author: $('ntAuthor').value,
      body,
      sticky: $('ntSticky').checked,
    });
    save();
    ntForm.reset();
    ntForm.hidden = true;
    renderIndex();
  });

  $('backBtn').addEventListener('click', showIndex);

  // ---- footer tools --------------------------------------------------
  $('seedBtn').addEventListener('click', () => {
    seedDemo();
    save();
    showIndex();
  });
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(board.toJSON(), null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'web-board.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Delete all threads and start fresh?')) return;
    board = new Board();
    save();
    showIndex();
  });

  function seedDemo() {
    board = new Board();
    const t0 = 1700000000000;
    const welcome = board.createThread({
      title: 'Welcome — read me first',
      author: 'mod',
      body:
        'This board is a tiny demo. Posts support links like ' +
        'https://github.com/florinpop17/app-ideas and nested replies. ' +
        'Try replying to a reply.',
      createdAt: t0,
      sticky: true,
    });
    const q = board.createThread({
      title: 'Best way to learn to build small apps?',
      author: 'ada',
      body: 'I want to build one small project a day. Any lists to follow?',
      createdAt: t0 + 60000,
    });
    const r1 = board.reply({
      threadId: q.thread.id,
      parentId: q.post.id,
      author: 'bob',
      body: 'karan/Projects and florinpop17/app-ideas are both great.',
      createdAt: t0 + 120000,
    });
    board.reply({
      threadId: q.thread.id,
      parentId: r1.id,
      author: 'ada',
      body: 'Thanks! Starting today. (see https://github.com/karan/Projects).',
      createdAt: t0 + 180000,
    });
    board.reply({
      threadId: q.thread.id,
      parentId: q.post.id,
      author: 'anon',
      body: 'This reply will be deleted to show the tombstone behaviour.',
      createdAt: t0 + 200000,
    });
    // Delete that last one so the demo shows a [deleted] node with no bump.
    const posts = board.postsIn(q.thread.id);
    board.deletePost(posts[posts.length - 1].id);
    // Keep welcome referenced for lint clarity.
    void welcome;
  }

  // ---- first paint ---------------------------------------------------
  showIndex();
})();
