// script.js — the browser layer for the Chat App.
//
// The pure engine (chat-core.js) does all the parsing and message-building. This
// file is only glue: it moves messages between the DOM, localStorage (persistent
// storage — a bonus story) and a BroadcastChannel (real-time delivery to every
// other open tab — the "all connected users see messages" bonus, achieved with
// no server). Each open tab counts as one connected user.
//
// User-typed text is NEVER injected as HTML. Every token from ChatCore.parseTokens
// is written with textContent / safe element creation, so a message can't smuggle
// markup into the page.

(function () {
  'use strict';

  const C = window.ChatCore;
  const STORE_KEY = 'chat-app:v1';
  const NAME_KEY = 'chat-app:username';
  const THEME_KEY = 'chat-app:theme';
  const DEFAULT_CHANNEL = 'general';

  // Cross-tab real-time bus. BroadcastChannel where available; otherwise we fall
  // back to the storage event, which also fires across tabs.
  const bus = ('BroadcastChannel' in window) ? new BroadcastChannel('chat-app') : null;

  // --- Persistent store -----------------------------------------------------

  // Load the message log, tolerating a corrupt/absent store (recover to empty).
  function loadMessages() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(isMessage) : [];
    } catch (e) {
      return [];
    }
  }
  function isMessage(m) {
    return m && typeof m.id === 'string' && typeof m.channel === 'string' && typeof m.text === 'string';
  }
  function saveMessages(messages) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(messages));
    } catch (e) { /* quota / private mode — stay in-memory */ }
  }

  // --- App state ------------------------------------------------------------

  const state = {
    username: localStorage.getItem(NAME_KEY) || null,
    messages: loadMessages(),
    channels: [],
    activeKey: DEFAULT_CHANNEL,   // channel slug OR a dm:key
    unread: {},                   // key -> count
    seq: 0,
  };

  // Rebuild the channel list from defaults + whatever history already contains.
  function refreshChannels() {
    const set = [DEFAULT_CHANNEL];
    C.channelsInUse(state.messages).forEach((c) => { if (set.indexOf(c) === -1) set.push(c); });
    state.channels = set;
  }
  refreshChannels();

  // A per-tab unique, monotonic id so two tabs never collide and ordering is stable.
  const TAB = Math.floor(performance.now() * 1000).toString(36) + '-' + tabRandom();
  function tabRandom() {
    // performance.now-based; avoids Math.random for determinism-friendliness.
    return (performance.now() % 1 * 1e9).toFixed(0).slice(-6);
  }
  function nextId() {
    state.seq += 1;
    return C.makeId(TAB + '-' + state.seq);
  }
  function now() { return Date.now(); }

  // --- DOM handles ----------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const gate = $('gate'), app = $('app');
  const gateForm = $('gate-form'), gateInput = $('gate-input'), gateError = $('gate-error');
  const channelList = $('channel-list'), dmList = $('dm-list');
  const messagesEl = $('messages'), composer = $('composer'), composerInput = $('composer-input');
  const chatTitle = $('chat-title'), chatSub = $('chat-sub'), presenceEl = $('presence');
  const emojiBtn = $('emoji-btn'), emojiTray = $('emoji-tray');

  // --- Theme ----------------------------------------------------------------

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('theme-toggle').textContent = t === 'dark' ? '☀️ Theme' : '🌙 Theme';
  }
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  $('theme-toggle') && $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  // --- Presence (how many tabs are open) ------------------------------------

  const PRESENCE_KEY = 'chat-app:presence';
  function heartbeat() {
    const map = readPresence();
    map[TAB] = now();
    writePresence(map);
    renderPresence();
  }
  function readPresence() {
    try { return JSON.parse(localStorage.getItem(PRESENCE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writePresence(map) {
    const fresh = {};
    const cutoff = now() - 15000;
    Object.keys(map).forEach((k) => { if (map[k] > cutoff) fresh[k] = map[k]; });
    try { localStorage.setItem(PRESENCE_KEY, JSON.stringify(fresh)); } catch (e) {}
  }
  function presenceCount() {
    const map = readPresence();
    const cutoff = now() - 15000;
    return Object.keys(map).filter((k) => map[k] > cutoff).length;
  }
  function renderPresence() {
    const n = presenceCount();
    presenceEl.textContent = n <= 1 ? '● 1 tab connected' : `● ${n} tabs connected`;
  }
  window.addEventListener('beforeunload', () => {
    const map = readPresence();
    delete map[TAB];
    writePresence(map);
  });

  // --- Delivering messages --------------------------------------------------

  // Append a freshly-built message to the log, persist it, broadcast it to other
  // tabs, and render it if it belongs to the open conversation.
  function deliver(msg) {
    state.messages.push(msg);
    saveMessages(state.messages);
    if (bus) bus.postMessage({ type: 'msg', msg });
    receive(msg, /*local*/ true);
  }

  // Handle a message (local or from another tab): store if new, then render/notify.
  function receive(msg, local) {
    if (!local) {
      if (state.messages.some((m) => m.id === msg.id)) return; // de-dupe
      state.messages.push(msg);
      saveMessages(state.messages);
      // A brand-new channel from someone else should appear in the sidebar.
      if (msg.kind !== 'private') refreshChannels();
    }
    const key = msg.channel;
    if (key === state.activeKey) {
      appendMessage(msg);
      scrollToBottom();
    } else if (relevantTo(msg)) {
      state.unread[key] = (state.unread[key] || 0) + 1;
    }
    renderSidebar();
  }

  // Does this message belong in one of *my* views? All channel messages do;
  // private messages only if I'm a participant.
  function relevantTo(msg) {
    if (msg.kind !== 'private') return true;
    return msg.user === state.username || msg.to === state.username;
  }

  // --- Rendering the message list -------------------------------------------

  function renderConversation() {
    messagesEl.innerHTML = '';
    const msgs = C.messagesFor(state.messages, state.activeKey).filter(relevantTo);
    msgs.forEach(appendMessage);
    scrollToBottom();
  }

  function appendMessage(msg) {
    const li = document.createElement('li');
    li.className = 'msg';
    if (msg.kind === 'system') {
      li.classList.add('system');
      const bubble = div('bubble');
      bubble.appendChild(renderTokens(msg.text, msg));
      li.appendChild(bubble);
      messagesEl.appendChild(li);
      return;
    }

    const mine = msg.user === state.username;
    if (mine) li.classList.add('me');
    if (msg.kind === 'private') li.classList.add('private');

    const who = div('who');
    // For a DM, show direction so both sides read naturally.
    if (msg.kind === 'private') {
      who.textContent = mine ? `you → ${msg.to}` : `${msg.user} → you`;
    } else {
      who.textContent = mine ? 'You' : msg.user;
    }
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = formatTime(msg.ts);
    who.appendChild(t);

    const bubble = div('bubble');
    bubble.appendChild(renderTokens(msg.text, msg));

    li.appendChild(who);
    li.appendChild(bubble);
    messagesEl.appendChild(li);
  }

  // Turn message text into safe DOM nodes using the engine's token parser.
  function renderTokens(text, msg) {
    const frag = document.createDocumentFragment();
    C.parseTokens(text).forEach((tok) => {
      if (tok.type === 'text') {
        frag.appendChild(document.createTextNode(tok.value));
      } else if (tok.type === 'link') {
        frag.appendChild(anchor(tok.value));
      } else if (tok.type === 'image') {
        frag.appendChild(anchor(tok.value)); // keep the link too…
        const img = document.createElement('img');
        img.className = 'embed';
        img.src = tok.value;
        img.alt = 'shared image';
        img.loading = 'lazy';
        frag.appendChild(img);
      } else if (tok.type === 'mention') {
        const span = document.createElement('span');
        span.className = 'mention';
        span.textContent = tok.value;
        frag.appendChild(span);
      }
    });
    return frag;
  }

  function anchor(url) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
  function formatTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // --- Sidebar --------------------------------------------------------------

  function renderSidebar() {
    // Channels
    channelList.innerHTML = '';
    state.channels.forEach((ch) => {
      channelList.appendChild(sideItem('# ' + ch, ch));
    });
    // DMs
    dmList.innerHTML = '';
    C.dmThreadsFor(state.messages, state.username).forEach((thread) => {
      dmList.appendChild(sideItem('@ ' + thread.other, thread.key));
    });
    $('me-name').textContent = state.username || '';
  }

  function sideItem(label, key) {
    const li = document.createElement('li');
    if (key === state.activeKey) li.classList.add('active');
    const span = document.createElement('span');
    span.textContent = label;
    li.appendChild(span);
    const count = state.unread[key] || 0;
    if (count > 0 && key !== state.activeKey) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = String(count);
      li.appendChild(b);
    }
    li.addEventListener('click', () => openConversation(key));
    return li;
  }

  function openConversation(key) {
    state.activeKey = key;
    state.unread[key] = 0;
    if (key.indexOf('dm:') === 0) {
      const thread = C.dmThreadsFor(state.messages, state.username).find((t) => t.key === key);
      chatTitle.textContent = '@ ' + (thread ? thread.other : 'direct message');
      chatSub.textContent = 'private conversation';
    } else {
      chatTitle.textContent = '# ' + key;
      chatSub.textContent = '';
    }
    renderSidebar();
    renderConversation();
    composerInput.focus();
  }

  // --- Handling composer input ----------------------------------------------

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = composerInput.value;
    const intent = C.parseCommand(raw);
    composerInput.value = '';

    switch (intent.type) {
      case 'empty':
        return;
      case 'chat':
        sendChat(intent.text);
        break;
      case 'msg':
        sendPrivate(intent.to, intent.text);
        break;
      case 'me':
        deliver(C.systemMessage({ channel: currentChannel(), text: `${state.username} ${intent.text}`, now: now(), id: nextId() }));
        markActionOnLast();
        break;
      case 'nick':
        changeName(intent.name);
        break;
      case 'join':
        joinChannel(intent.channel);
        break;
      case 'help':
        showHelp();
        break;
      case 'error':
        notice(intent.message);
        break;
    }
    composerInput.focus();
  });

  // A channel context for actions issued from a DM view falls back to general.
  function currentChannel() {
    return state.activeKey.indexOf('dm:') === 0 ? DEFAULT_CHANNEL : state.activeKey;
  }

  function sendChat(text) {
    if (state.activeKey.indexOf('dm:') === 0) {
      // Typing in a DM view sends a private reply to the other participant.
      const thread = C.dmThreadsFor(state.messages, state.username).find((t) => t.key === state.activeKey);
      if (thread) return sendPrivate(thread.other, text);
    }
    deliver(C.chatMessage({ user: state.username, channel: state.activeKey, text, now: now(), id: nextId() }));
  }

  function sendPrivate(to, text) {
    if (C.cleanSpace(to).toLowerCase() === C.cleanSpace(state.username).toLowerCase()) {
      return notice("You can't private-message yourself.");
    }
    const msg = C.privateMessage({ user: state.username, to, text, now: now(), id: nextId() });
    deliver(msg);
    openConversation(msg.channel);
  }

  function joinChannel(ch) {
    if (state.channels.indexOf(ch) === -1) state.channels.push(ch);
    deliver(C.systemMessage({ channel: ch, text: `${state.username} joined #${ch}`, now: now(), id: nextId() }));
    openConversation(ch);
  }

  // The /me action reformats the just-appended system line as an action.
  function markActionOnLast() {
    const last = messagesEl.lastElementChild;
    if (last) { last.classList.remove('system'); last.classList.add('action'); }
  }

  function showHelp() {
    const lines = [
      'Commands:',
      '/nick <name> — change your username',
      '/join <channel> — create or switch to a channel',
      '/msg <user> <text> — send a private message',
      '/me <action> — post an action, e.g. /me waves',
      'Type :smile: :fire: etc. for emoji, @name to mention, paste a link or image URL to embed.',
    ];
    appendLocalNotice(lines.join('\n'));
  }

  // A notice only this tab sees (not broadcast, not stored).
  function notice(text) { appendLocalNotice(text); }
  function appendLocalNotice(text) {
    const li = document.createElement('li');
    li.className = 'msg system';
    const bubble = div('bubble');
    text.split('\n').forEach((line, i) => {
      if (i) bubble.appendChild(document.createElement('br'));
      bubble.appendChild(document.createTextNode(line));
    });
    li.appendChild(bubble);
    messagesEl.appendChild(li);
    scrollToBottom();
  }

  // --- Username gate --------------------------------------------------------

  function changeName(name) {
    const old = state.username;
    state.username = name;
    localStorage.setItem(NAME_KEY, name);
    $('me-name').textContent = name;
    if (old && old !== name) {
      deliver(C.systemMessage({ channel: currentChannel(), text: `${old} is now known as ${name}`, now: now(), id: nextId() }));
    }
  }

  gateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const name = C.validateUsername(gateInput.value);
      gateError.textContent = '';
      enterApp(name, /*announce*/ true);
    } catch (err) {
      gateError.textContent = err.message;
    }
  });

  function enterApp(name, announce) {
    state.username = name;
    localStorage.setItem(NAME_KEY, name);
    gate.hidden = true;
    app.hidden = false;
    heartbeat();
    if (announce) {
      // Join notification to everyone in the default channel (bonus story).
      deliver(C.systemMessage({ channel: DEFAULT_CHANNEL, text: `${name} joined the chat`, now: now(), id: nextId() }));
    }
    openConversation(DEFAULT_CHANNEL);
  }

  $('leave').addEventListener('click', () => {
    localStorage.removeItem(NAME_KEY);
    state.username = null;
    app.hidden = true;
    gate.hidden = false;
    gateInput.value = '';
    gateInput.focus();
  });

  // --- Sidebar buttons ------------------------------------------------------

  $('add-channel').addEventListener('click', () => {
    const raw = window.prompt('New channel name:');
    if (raw == null) return;
    try {
      joinChannel(C.validateChannel(raw));
    } catch (err) {
      notice(err.message);
    }
  });

  // --- Emoji tray -----------------------------------------------------------

  Object.keys(C.EMOJI).forEach((code) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = ':' + code + ':';
    b.textContent = C.EMOJI[code];
    b.addEventListener('click', () => {
      composerInput.value += (composerInput.value && !composerInput.value.endsWith(' ') ? ' ' : '') + C.EMOJI[code] + ' ';
      emojiTray.hidden = true;
      composerInput.focus();
    });
    emojiTray.appendChild(b);
  });
  emojiBtn.addEventListener('click', () => { emojiTray.hidden = !emojiTray.hidden; });
  document.addEventListener('click', (e) => {
    if (!emojiTray.hidden && !emojiTray.contains(e.target) && e.target !== emojiBtn) emojiTray.hidden = true;
  });

  // --- Real-time bus wiring -------------------------------------------------

  if (bus) {
    bus.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'msg') receive(e.data.msg, /*local*/ false);
    });
  }
  // Fallback / presence sync: react to storage writes from other tabs.
  window.addEventListener('storage', (e) => {
    if (e.key === PRESENCE_KEY) renderPresence();
    if (e.key === STORE_KEY && !bus) {
      state.messages = loadMessages();
      refreshChannels();
      renderConversation();
      renderSidebar();
    }
  });

  // Presence heartbeat every few seconds.
  setInterval(heartbeat, 5000);

  // --- Boot -----------------------------------------------------------------

  if (state.username) {
    enterApp(state.username, /*announce*/ false);
  } else {
    gate.hidden = false;
    gateInput.focus();
  }
})();
