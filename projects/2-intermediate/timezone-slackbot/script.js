// script.js — DOM wiring for the Timezone Slackbot mock.
// All the real logic lives in tz-core.js (window.TZCore); this file only turns
// results into Slack-style messages and handles the composer.

(function () {
  const { DIRECTORY, handleMessage } = window.TZCore;

  const messages = document.getElementById('messages');
  const form = document.getElementById('composer');
  const input = document.getElementById('input');
  const roster = document.getElementById('roster');

  // Populate the "known members" hint from the directory itself.
  roster.textContent = Object.values(DIRECTORY).map((m) => m.display).join(', ');

  // Append a user's own message (the command they typed) to the transcript.
  function renderUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = `
      <div class="avatar user-avatar">you</div>
      <div class="msg-body">
        <div class="msg-head"><span class="author">You</span></div>
        <div class="msg-text"><code></code></div>
      </div>`;
    el.querySelector('code').textContent = text;
    messages.appendChild(el);
  }

  // Build the alternating-row timezone table (user story #2).
  function renderTable(rows) {
    const table = document.createElement('table');
    table.className = 'tz-table';
    table.innerHTML = `
      <thead>
        <tr><th>Member</th><th>Local time</th><th>Zone</th><th>Offset</th></tr>
      </thead>
      <tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.className = r.stripe === 1 ? 'stripe' : '';
      const cells = [r.name, r.localTime, r.abbr, r.offset];
      cells.forEach((value, i) => {
        const td = document.createElement('td');
        td.textContent = value;
        if (i === 2) td.className = 'abbr';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    return table;
  }

  // Append a bot reply built from a handleMessage() result.
  function renderBotReply(result) {
    const el = document.createElement('div');
    el.className = 'msg bot';
    el.innerHTML = `
      <div class="avatar bot-avatar">tz</div>
      <div class="msg-body">
        <div class="msg-head"><span class="author">Timezone Bot</span> <span class="badge">APP</span></div>
        <div class="msg-text"></div>
      </div>`;
    const text = el.querySelector('.msg-text');

    if (!result.ok) {
      if (result.error === 'no-users') {
        text.textContent = 'Usage: /tz name name … — give me at least one member.';
      } else {
        text.textContent = "I only understand /tz. Try: /tz alice bob";
      }
    } else if (result.rows.length === 0) {
      text.textContent = `I don't know anyone named: ${result.unknown.join(', ')}.`;
    } else {
      text.appendChild(renderTable(result.rows));
      if (result.unknown.length > 0) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = `Couldn't find: ${result.unknown.join(', ')}.`;
        text.appendChild(note);
      }
    }
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  function submit(text) {
    const value = text.trim();
    if (!value) return;
    renderUserMessage(value);
    // Read the clock once here — the pure core stays deterministic by taking
    // this instant as an argument.
    const result = handleMessage(DIRECTORY, value, Date.now());
    renderBotReply(result);
    messages.scrollTop = messages.scrollHeight;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(input.value);
    input.value = '';
    input.focus();
  });

  document.getElementById('examples').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    submit(btn.dataset.cmd);
  });
})();
