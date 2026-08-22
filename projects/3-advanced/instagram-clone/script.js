// script.js — the browser client for the Instagram Clone.
//
// It owns ONLY presentation: reading the DOM, turning a chosen file into a data
// URL, and painting whatever instagram-core.js (the "backend") returns. All the
// rules — accounts, the follow graph, feeds, likes — live in the core, which
// this file talks to exactly like a client talks to an API. State is persisted
// through a localStorage-backed store, so a reload restores your session, your
// posts, and everyone you follow.

'use strict';

(function () {
  const Core = window.InstagramCore;

  // --- localStorage-backed store (the "database") -------------------------
  const KEY = 'instagage.v1';
  const localStore = {
    get() {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : Core.blankState();
      } catch (e) {
        return Core.blankState();
      }
    },
    set(state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota / private mode */ }
    },
  };

  const app = Core.createApp(localStore);

  // A monotonic clock for createdAt/joinedAt. We avoid Date.now for ordering so
  // ordering is stable, but a wall-clock stamp is nice for display; use both.
  function now() { return Date.now(); }

  // --- Tiny DOM helpers ---------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // Escape user text before it ever touches innerHTML.
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('is-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('is-hidden'), 2200);
  }

  // ======================================================================
  // Auth screen
  // ======================================================================
  const authEl = $('#auth');
  const appEl = $('#app');

  $('#tab-login').addEventListener('click', () => switchAuth('login'));
  $('#tab-register').addEventListener('click', () => switchAuth('register'));

  function switchAuth(which) {
    $('#tab-login').classList.toggle('is-active', which === 'login');
    $('#tab-register').classList.toggle('is-active', which === 'register');
    $('#login-form').classList.toggle('is-hidden', which !== 'login');
    $('#register-form').classList.toggle('is-hidden', which !== 'register');
    $('#login-error').textContent = '';
    $('#register-error').textContent = '';
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      app.login($('#login-id').value, $('#login-pw').value);
      enterApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  $('#register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $$('.field-error').forEach((el) => (el.textContent = ''));
    $('#register-error').textContent = '';
    try {
      app.register({
        name: $('#reg-name').value,
        email: $('#reg-email').value,
        username: $('#reg-username').value,
        password: $('#reg-pw').value,
      }, { at: now() });
      enterApp();
    } catch (err) {
      // Route field-specific codes to the matching input; fall back to a banner.
      const map = {
        EMPTY_NAME: 'reg-name', NAME_TOO_LONG: 'reg-name',
        EMPTY_EMAIL: 'reg-email', EMAIL_INVALID: 'reg-email', EMAIL_TAKEN: 'reg-email',
        EMPTY_USERNAME: 'reg-username', USERNAME_TOO_SHORT: 'reg-username',
        USERNAME_TOO_LONG: 'reg-username', USERNAME_INVALID: 'reg-username', USERNAME_TAKEN: 'reg-username',
        EMPTY_PASSWORD: 'reg-pw', PASSWORD_TOO_SHORT: 'reg-pw',
      };
      const target = map[err.code];
      if (target) $(`.field-error[data-for="${target}"]`).textContent = err.message;
      else $('#register-error').textContent = err.message;
    }
  });

  // ======================================================================
  // Router
  // ======================================================================
  let currentView = 'home';
  let profileTarget = null; // username being viewed on the profile page

  function enterApp() {
    authEl.classList.add('is-hidden');
    appEl.classList.remove('is-hidden');
    go('home');
  }

  function go(view, arg) {
    currentView = view;
    if (view === 'profile') profileTarget = arg || app.currentUser().username;
    $$('.nav-btn[data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    render();
  }

  $$('.nav-btn[data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  $('#go-home').addEventListener('click', () => go('home'));
  $('#nav-profile').addEventListener('click', () => go('profile'));
  $('#logout').addEventListener('click', () => {
    app.logout();
    appEl.classList.add('is-hidden');
    authEl.classList.remove('is-hidden');
    $('#login-form').reset();
  });

  // ======================================================================
  // Rendering
  // ======================================================================
  function render() {
    const root = $('#view');
    if (currentView === 'home') root.innerHTML = renderFeed(app.homeFeed(), 'home');
    else if (currentView === 'explore') root.innerHTML = renderFeed(app.globalFeed(), 'explore');
    else if (currentView === 'people') root.innerHTML = renderPeople();
    else if (currentView === 'profile') root.innerHTML = renderProfile(profileTarget);
    wire(root);
  }

  function postCard(p) {
    return `
      <article class="card" data-id="${p.id}">
        <div class="card-head">
          <div class="avatar" data-user="${esc(p.author)}">${esc(initials(p.authorName))}</div>
          <div class="who">
            <b data-user="${esc(p.author)}">${esc(p.author)}</b>
            <small>${esc(p.authorName)}</small>
          </div>
          <div class="spacer"></div>
          ${p.mine ? `<button class="del" data-del="${p.id}">Delete</button>` : ''}
        </div>
        <img class="card-img" src="${esc(p.image)}" alt="Post by ${esc(p.author)}" />
        <div class="card-body">
          <div class="actions">
            <button class="icon-btn like ${p.likedByMe ? 'liked' : ''}" data-like="${p.id}" title="Like">
              ${p.likedByMe ? '♥' : '♡'}
            </button>
            <span class="likes">${p.likeCount} ${p.likeCount === 1 ? 'like' : 'likes'}</span>
          </div>
          ${p.caption ? `<p class="caption"><b data-user="${esc(p.author)}">${esc(p.author)}</b>${esc(p.caption)}</p>` : ''}
        </div>
      </article>`;
  }

  function renderFeed(posts, kind) {
    if (!posts.length) {
      const msg = kind === 'home'
        ? { icon: '📭', title: 'Your feed is quiet', sub: 'Follow people from <b>Explore</b> or <b>People</b>, or share your first post.' }
        : { icon: '🌍', title: 'No posts yet', sub: 'Be the first — hit <b>+ New post</b>.' };
      return `<div class="empty"><div class="big">${msg.icon}</div><h3>${msg.title}</h3><p>${msg.sub}</p></div>`;
    }
    return `<div class="feed">${posts.map(postCard).join('')}</div>`;
  }

  function renderPeople() {
    const me = app.currentUser().username;
    const rows = app.allUsers().filter((u) => u.username !== me).map((u) => {
      const c = app.counts(u.username);
      const following = app.isFollowing(u.username);
      return `
        <div class="person">
          <div class="avatar" data-user="${esc(u.username)}">${esc(initials(u.name))}</div>
          <div class="who">
            <b data-user="${esc(u.username)}">${esc(u.username)}</b>
            <small>${esc(u.name)} · ${c.posts} posts · ${c.followers} followers</small>
          </div>
          <div class="spacer"></div>
          <button class="follow-btn ${following ? 'following' : ''}" data-follow="${esc(u.username)}">
            ${following ? 'Following' : 'Follow'}
          </button>
        </div>`;
    }).join('');
    return `<h2 class="section-title">People on Instagage</h2>
      <div class="people">${rows || '<p class="empty">You are the only one here — invite a friend by loading the demo world!</p>'}</div>`;
  }

  function renderProfile(username) {
    const u = app.getUser(username);
    if (!u) return '<div class="empty">That user does not exist.</div>';
    const c = app.counts(u.username);
    const me = app.currentUser().username;
    const isMe = u.username === me;
    const following = app.isFollowing(u.username);
    const posts = app.postsBy(u.username);

    const grid = posts.length
      ? `<div class="grid">${posts.map((p) => `
          <a data-open="${p.id}">
            <img src="${esc(p.image)}" alt="${esc(p.caption) || 'post'}" />
            <span class="glike">♥ ${p.likeCount}</span>
          </a>`).join('')}</div>`
      : `<div class="empty"><div class="big">📷</div><p>${isMe ? 'You have not posted yet.' : 'No posts yet.'}</p></div>`;

    return `
      <div class="profile-head">
        <div class="avatar lg">${esc(initials(u.name))}</div>
        <div class="profile-meta">
          <h2>${esc(u.name)}</h2>
          <p class="handle">@${esc(u.username)}</p>
          <div class="stats">
            <div><b>${c.posts}</b><span>posts</span></div>
            <div><b>${c.followers}</b><span>followers</span></div>
            <div><b>${c.following}</b><span>following</span></div>
          </div>
        </div>
        <div class="spacer"></div>
        ${isMe
          ? ''
          : `<button class="follow-btn ${following ? 'following' : ''}" data-follow="${esc(u.username)}">${following ? 'Following' : 'Follow'}</button>`}
      </div>
      ${grid}`;
  }

  // Attach handlers to freshly-rendered content.
  function wire(root) {
    $$('[data-like]', root).forEach((btn) => btn.addEventListener('click', () => {
      app.toggleLike(btn.dataset.like);
      render();
    }));
    $$('[data-del]', root).forEach((btn) => btn.addEventListener('click', () => {
      app.deletePost(btn.dataset.del);
      toast('Post deleted');
      render();
    }));
    $$('[data-follow]', root).forEach((btn) => btn.addEventListener('click', () => {
      const who = btn.dataset.follow;
      if (app.isFollowing(who)) app.unfollow(who);
      else { app.follow(who); toast(`You now follow @${who}`); }
      render();
    }));
    $$('[data-user]', root).forEach((el) => el.addEventListener('click', () => go('profile', el.dataset.user)));
    $$('[data-open]', root).forEach((el) => el.addEventListener('click', () => go('home')));
  }

  // ======================================================================
  // Composer
  // ======================================================================
  const composer = $('#composer');
  let pendingImage = '';

  $('#open-composer').addEventListener('click', openComposer);
  $('#composer-cancel').addEventListener('click', closeComposer);
  composer.addEventListener('click', (e) => { if (e.target === composer) closeComposer(); });

  function openComposer() {
    pendingImage = '';
    $('#post-caption').value = '';
    $('#composer-error').textContent = '';
    $('#post-preview').classList.add('is-hidden');
    $('#drop-text').classList.remove('is-hidden');
    composer.classList.remove('is-hidden');
  }
  function closeComposer() { composer.classList.add('is-hidden'); }

  const drop = $('#drop');
  const fileInput = $('#post-image');
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) readImage(fileInput.files[0]); });
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) readImage(f);
  });

  function readImage(file) {
    if (!/^image\//.test(file.type)) { $('#composer-error').textContent = 'Please choose an image file.'; return; }
    const reader = new FileReader();
    reader.onload = () => {
      pendingImage = reader.result;
      const img = $('#post-preview');
      img.src = pendingImage;
      img.classList.remove('is-hidden');
      $('#drop-text').classList.add('is-hidden');
      $('#composer-error').textContent = '';
    };
    reader.readAsDataURL(file);
  }

  $('#composer-share').addEventListener('click', () => {
    try {
      app.createPost({ image: pendingImage, caption: $('#post-caption').value }, { at: now() });
      closeComposer();
      toast('Shared!');
      go('home');
    } catch (err) {
      $('#composer-error').textContent = err.message;
    }
  });

  // ======================================================================
  // Theme
  // ======================================================================
  const THEME_KEY = 'instagage.theme';
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('#theme-toggle').textContent = t === 'dark' ? '☀️' : '🌙';
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
  }
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
  (function initTheme() {
    let saved = 'light';
    try { saved = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { /* ignore */ }
    applyTheme(saved);
  })();

  // ======================================================================
  // Demo world — a few tiny SVG "photos" so the app has life on first open.
  // ======================================================================
  function svgPhoto(from, to, label) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'>
      <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/>
      </linearGradient></defs>
      <rect width='600' height='600' fill='url(#g)'/>
      <text x='50%' y='52%' font-family='sans-serif' font-size='64' fill='rgba(255,255,255,0.92)'
        text-anchor='middle' font-weight='700'>${label}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  $('#seed-demo').addEventListener('click', () => {
    const seed = [
      { u: 'ada', n: 'Ada Lovelace', posts: [['#f09433', '#bc1888', '⚙️ engine day'], ['#654ea3', '#eaafc8', 'algorithms 🌸']] },
      { u: 'grace', n: 'Grace Hopper', posts: [['#00c6ff', '#0072ff', '🐛 first bug'], ['#11998e', '#38ef7d', 'compiling…']] },
      { u: 'linus', n: 'Linus T.', posts: [['#232526', '#414345', 'kernel panic 🐧']] },
      { u: 'margaret', n: 'Margaret H.', posts: [['#ff512f', '#dd2476', '🚀 to the moon'], ['#4568dc', '#b06ab3', 'onboard sw']] },
    ];
    const pw = 'demo123';
    try {
      seed.forEach((person, pi) => {
        try { app.register({ username: person.u, name: person.n, email: `${person.u}@ex.com`, password: pw }, { at: now() + pi }); }
        catch (e) { app.login(person.u, pw); }
        person.posts.forEach((p, idx) => {
          app.createPost({ image: svgPhoto(p[0], p[1], p[2]), caption: p[2] }, { at: now() + pi * 10 + idx });
        });
      });
      // Log in as ada and follow a couple of people so the home feed isn't empty.
      app.login('ada', pw);
      ['grace', 'margaret'].forEach((w) => { try { app.follow(w); } catch (e) { /* already */ } });
      // Sprinkle a couple of likes.
      const g = app.globalFeed();
      if (g[0]) app.toggleLike(g[0].id);
      if (g[2]) app.toggleLike(g[2].id);
      toast('Demo world loaded — logged in as @ada (password: demo123)');
      enterApp();
    } catch (err) {
      toast(err.message);
    }
  });

  // ======================================================================
  // Boot — restore an existing session if the store has one.
  // ======================================================================
  if (app.currentUser()) enterApp();
})();
