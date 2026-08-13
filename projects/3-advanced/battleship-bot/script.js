// script.js — the browser chat shell around battleship-core.js.
//
// Everything impure lives here: the DOM, the message log, the clock used only
// for message timestamps, and turning the bot's replies into Discord-style
// message rows (including the graphical board card, the spec's bonus feature).
// Every command still flows through the pure core's `handleCommand`.

(function () {
  'use strict';

  const core = window.battleshipCore;

  const logEl = document.getElementById('log');
  const formEl = document.getElementById('composer');
  const inputEl = document.getElementById('input');

  let session = core.createSession();

  // ---- time-stamps (display only) ---------------------------------------
  function now() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ---- lightweight, safe markdown (**bold**, `code`, line breaks) --------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderInline(s) {
    // escape first, then re-introduce a tiny, closed set of markup
    let out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return out;
  }

  function renderMultiline(text) {
    return text
      .split('\n')
      .map((line) =>
        line.trim() === ''
          ? '<span class="line blank"></span>'
          : `<span class="line">${renderInline(line)}</span>`
      )
      .join('');
  }

  // ---- message rows ------------------------------------------------------
  function addMessage({ who, name, tag, text, kind, card }) {
    const msg = document.createElement('div');
    msg.className = `msg ${who}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = who === 'bot' ? '🤖' : 'Y';

    const body = document.createElement('div');
    body.className = 'body';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = name;
    meta.appendChild(nm);
    if (tag) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = tag;
      meta.appendChild(t);
    }
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = now();
    meta.appendChild(time);
    body.appendChild(meta);

    const txt = document.createElement('div');
    txt.className = 'text' + (kind ? ` kind-${kind}` : '');
    txt.innerHTML = renderMultiline(text);
    body.appendChild(txt);

    if (card) body.appendChild(card);

    msg.append(avatar, body);
    logEl.appendChild(msg);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---- the graphical board card (bonus: a card, not a text grid) ---------
  function buildBoardCard(game, reveal) {
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = reveal ? 'Board — revealed' : 'Board';
    card.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'grid';

    // column header row
    const head = document.createElement('div');
    head.className = 'grid-row';
    const corner = document.createElement('div');
    corner.className = 'axis';
    head.appendChild(corner);
    for (let c = 0; c < core.BOARD_SIZE; c += 1) {
      const a = document.createElement('div');
      a.className = 'axis';
      a.textContent = c;
      head.appendChild(a);
    }
    grid.appendChild(head);

    for (let r = 0; r < core.BOARD_SIZE; r += 1) {
      const row = document.createElement('div');
      row.className = 'grid-row';
      const label = document.createElement('div');
      label.className = 'axis';
      label.textContent = r;
      row.appendChild(label);

      for (let c = 0; c < core.BOARD_SIZE; c += 1) {
        const shot = game.shots[r][c];
        const cell = document.createElement('div');
        let state = shot; // 'unknown' | 'hit' | 'miss'
        if (reveal && shot === 'unknown' && game.occupied[r][c] !== null) {
          state = 'ship';
        }
        cell.className = `cell ${state}`;
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
    card.appendChild(grid);

    // fleet ledger
    const fleet = document.createElement('div');
    fleet.className = 'fleet';
    game.ships.forEach((s) => {
      const chip = document.createElement('span');
      chip.className = 'ship-chip' + (s.sunk ? ' sunk' : '');
      const pip = document.createElement('span');
      pip.className = 'pip';
      chip.appendChild(pip);
      chip.appendChild(document.createTextNode(
        `${s.name} ${s.sunk ? 'sunk' : `${s.hits}/${s.size}`}`
      ));
      fleet.appendChild(chip);
    });
    card.appendChild(fleet);

    return card;
  }

  // ---- dispatch ----------------------------------------------------------
  function botReply(reply) {
    const card = reply.game ? buildBoardCard(reply.game, !!reply.reveal) : null;
    addMessage({
      who: 'bot',
      name: 'Battleship Bot',
      tag: 'BOT',
      text: reply.text,
      kind: reply.kind,
      card,
    });
  }

  function submit(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Echo the player's line as their own message.
    addMessage({ who: 'you', name: 'You', text: trimmed });

    const out = core.handleCommand(session, trimmed, Math.random);
    session = out.session;
    out.replies.forEach(botReply);

    // Gentle nudge if the line wasn't addressed to the bot at all.
    if (out.replies.length === 0) {
      addMessage({
        who: 'bot',
        name: 'Battleship Bot',
        tag: 'BOT',
        text: 'Talk to me with the `bb` prefix — e.g. `bb help` or `bb start`.',
        kind: 'error',
      });
    }
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(inputEl.value);
    inputEl.value = '';
    inputEl.focus();
  });

  // ---- opening message with clickable hint chips -------------------------
  function greet() {
    addMessage({
      who: 'bot',
      name: 'Battleship Bot',
      tag: 'BOT',
      text:
        "Ahoy! I'm **Battleship Bot**. I hide a fleet on a 10×10 grid and you " +
        'try to sink it. Type `bb help` for the rules, or `bb start` to dive in.',
      kind: 'help',
    });

    // quick-reply chips wired to send common commands
    const wrap = document.createElement('div');
    wrap.className = 'msg bot';
    const spacer = document.createElement('div');
    spacer.className = 'avatar';
    spacer.style.visibility = 'hidden';
    const body = document.createElement('div');
    body.className = 'body';
    const hints = document.createElement('div');
    hints.className = 'hints';
    ['bb help', 'bb start', 'bb shoot 4,5', 'bb surrender'].forEach((cmd) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hint';
      b.textContent = cmd;
      b.addEventListener('click', () => {
        submit(cmd);
        inputEl.focus();
      });
      hints.appendChild(b);
    });
    body.appendChild(hints);
    wrap.append(spacer, body);
    logEl.appendChild(wrap);
  }

  greet();
  inputEl.focus();
})();
