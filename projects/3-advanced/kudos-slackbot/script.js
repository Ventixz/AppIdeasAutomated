// script.js — the browser glue for the Kudos Slackbot demo.
//
// All the logic lives in kudos-core.js. This file only: owns a store, wires the
// composer + "posting as" selector to handleCommand(), and renders each reply
// as a Slack-style message in the transcript. No network, no persistence beyond
// the page — refresh and the seeded demo comes back.

(function () {
  'use strict';

  const Core = window.KudosCore;

  // A live clock and monotonically increasing ids for the demo store.
  let counter = 0;
  const store = Core.createStore({
    seq: () => (counter += 1),
    now: () => Date.now(),
  });

  const transcript = document.getElementById('transcript');
  const form = document.getElementById('composer');
  const input = document.getElementById('input');
  const meSelect = document.getElementById('me');
  const quick = document.getElementById('quick');

  function currentUser() {
    return '@' + meSelect.value;
  }

  // ---- rendering -----------------------------------------------------------

  // A very small, safe subset of Slack's mrkdwn: *bold*, `code`, and newlines.
  // Everything is escaped first, so no user text can inject markup.
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function mrkdwn(s) {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br />');
  }

  function timeLabel() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // A message from a human (the command you typed).
  function renderUserMessage(user, text) {
    const el = document.createElement('div');
    el.className = 'msg';
    const initial = user.replace(/^@/, '').charAt(0).toUpperCase();
    el.innerHTML =
      `<span class="avatar user">${initial}</span>` +
      '<div class="body">' +
      `<p class="meta"><span class="author">${escapeHtml(user)}</span>` +
      `<span class="time">${timeLabel()}</span></p>` +
      `<p class="text mono">${escapeHtml(text)}</p>` +
      '</div>';
    transcript.appendChild(el);
  }

  // A reply from the bot.
  function renderBotReply(reply) {
    const el = document.createElement('div');
    el.className = 'msg bot ' + reply.type;
    el.innerHTML =
      '<span class="avatar botavatar">K</span>' +
      '<div class="body">' +
      '<p class="meta"><span class="author">Kudos</span>' +
      '<span class="badge">APP</span>' +
      `<span class="time">${timeLabel()}</span></p>` +
      `<div class="text">${mrkdwn(reply.text)}</div>` +
      '</div>';
    transcript.appendChild(el);
  }

  function scrollToEnd() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  // ---- command flow --------------------------------------------------------

  function run(raw) {
    const text = raw.trim();
    if (text === '') return;
    // Show what the user "posted" (Slack echoes the slash command back).
    renderUserMessage(currentUser(), text.startsWith('/') ? text : '/kudo ' + text);
    const reply = Core.handleCommand(store, text, currentUser());
    renderBotReply(reply);
    scrollToEnd();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const value = input.value;
    input.value = '';
    // The composer already implies "/kudo"; accept both "/kudo add …" and "add …".
    run(value.trim().startsWith('/') ? value : '/kudo ' + value);
    input.focus();
  });

  quick.addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    run(btn.getAttribute('data-cmd'));
    input.focus();
  });

  // ---- seed a small, believable channel history ----------------------------
  // Seeded through the real command path so the demo mirrors actual behaviour.
  function seed() {
    const seeds = [
      ['@carol', '/kudo add @grace carried the release over the line 🚀'],
      ['@bob', '/kudo add @grace patient code review on my messy PR'],
      ['@alice', '/kudo add @hiroshi debugged the flaky test nobody else could'],
      ['@dan', '/kudo add @grace mentored two new folks this sprint'],
      ['@grace', '/kudo add @dan kept the on-call docs actually usable'],
    ];
    for (const [who, cmd] of seeds) {
      Core.handleCommand(store, cmd, who);
    }
    // A welcome note plus the current standings, without echoing every seed.
    renderBotReply({ type: 'help', text: Core.USAGE });
    renderBotReply(Core.handleCommand(store, '/kudo top', currentUser()));
    scrollToEnd();
  }

  seed();
  input.focus();
})();
