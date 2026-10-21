/*
 * script.js — browser glue for the Mail Checker demo. No framework, no build.
 *
 * It wires the controls to the real client in mailcheck-core.js, run against an
 * in-memory simulated POP3/IMAP server (also from the core). A logging wrapper
 * around the Connection mirrors every line in both directions into the "session
 * log" panel, so you can watch the actual protocol exchange — the whole point of
 * the exercise is visible, not hidden behind a spinner.
 */
'use strict';

const M = window.MailCheck;

/* A few simulated mailboxes. POP3 boxes have sizes; IMAP boxes have seen/recent
 * flags (POP3 has no such concept, so those fields are simply ignored there). */
const MAILBOXES = {
  alice: {
    label: 'alice — a normal inbox',
    user: 'alice', pass: 'hunter2',
    messages: [
      { uid: 'u1', size: 2048, from: 'statements@bank.example', subject: 'Your October statement is ready', date: 'Mon, 20 Oct 2026 09:02:11 +0000', seen: true, recent: false },
      { uid: 'u2', size: 5120, from: 'noreply@news.example', subject: 'Weekly digest: 7 stories you missed', date: 'Tue, 21 Oct 2026 06:30:00 +0000', seen: false, recent: true },
      { uid: 'u3', size: 880, from: 'ci@build.example', subject: '✅ Build #482 passed on main', date: 'Tue, 21 Oct 2026 10:14:52 +0000', seen: false, recent: true },
      { uid: 'u4', size: 1460, from: 'team@work.example', subject: 'Re: lunch Thursday?', date: 'Tue, 21 Oct 2026 11:40:08 +0000', seen: false, recent: true },
    ],
  },
  empty: {
    label: 'empty — nothing waiting',
    user: 'alice', pass: 'hunter2',
    messages: [],
  },
  full: {
    label: 'busy — everything already read',
    user: 'alice', pass: 'hunter2',
    messages: [
      { uid: 'f1', size: 700, from: 'a@x.example', subject: 'Receipt #1', date: 'Sun, 19 Oct 2026 08:00:00 +0000', seen: true, recent: false },
      { uid: 'f2', size: 700, from: 'b@x.example', subject: 'Receipt #2', date: 'Sun, 19 Oct 2026 08:05:00 +0000', seen: true, recent: false },
      { uid: 'f3', size: 700, from: 'c@x.example', subject: 'Receipt #3', date: 'Sun, 19 Oct 2026 08:10:00 +0000', seen: true, recent: false },
    ],
  },
};

const $ = (id) => document.getElementById(id);
let protocol = 'pop3';

/* ---- protocol toggle ---- */
function setProtocol(p) {
  protocol = p;
  $('p-pop3').classList.toggle('on', p === 'pop3');
  $('p-imap').classList.toggle('on', p === 'imap');
  $('p-imap').classList.toggle('imap', p === 'imap');
}
$('p-pop3').addEventListener('click', () => setProtocol('pop3'));
$('p-imap').addEventListener('click', () => setProtocol('imap'));

/* ---- populate mailbox selector ---- */
for (const [key, box] of Object.entries(MAILBOXES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = box.label;
  $('account').appendChild(opt);
}

/* ---- wire-log helpers ---- */
const wire = $('wire');
function logReset() { wire.innerHTML = ''; }
function logLine(cls, prefix, text) {
  const div = document.createElement('div');
  div.className = cls;
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  div.innerHTML = `<span style="font-weight:650">${prefix}</span> ${esc}`;
  wire.appendChild(div);
  wire.scrollTop = wire.scrollHeight;
}

/*
 * Wrap a Connection so each line in or out is echoed to the log. readExact
 * (an IMAP literal body) is shown as a dimmed multi-line block so the
 * byte-counted framing is visible.
 */
function loggingConn(conn) {
  return {
    writeLine(line) { logLine('c', 'C:', line); conn.writeLine(line); },
    writeRaw(str) { conn.writeRaw(str); },
    async readLine() {
      const line = await conn.readLine();
      if (line !== null) logLine('s', 'S:', line);
      return line;
    },
    async readExact(n) {
      const body = await conn.readExact(n);
      if (body != null) {
        for (const l of String(body).split('\r\n')) {
          if (l !== '') logLine('lit', '  ▒', l);
        }
      }
      return body;
    },
    close() { conn.close(); },
  };
}

/* ---- rendering ---- */
function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderStatus(st) {
  $('status-note').textContent = `${st.protocol.toUpperCase()} · ${st.mailbox}`;
  $('s-total').textContent = st.total;
  const unseenEl = $('s-unseen');
  if (st.unseen === null) { unseenEl.textContent = 'n/a'; unseenEl.classList.add('na'); unseenEl.title = 'POP3 has no read/unread concept'; }
  else { unseenEl.textContent = st.unseen; unseenEl.classList.remove('na'); unseenEl.title = ''; }
  const recentEl = $('s-recent');
  if (st.recent === null) { recentEl.textContent = 'n/a'; recentEl.classList.add('na'); }
  else { recentEl.textContent = st.recent; recentEl.classList.remove('na'); }
  $('s-size').textContent = st.sizeOctets === null ? 'n/a' : fmtBytes(st.sizeOctets);
}

function renderMessages(messages) {
  const ul = $('mail');
  ul.innerHTML = '';
  if (!messages || messages.length === 0) {
    $('mail-empty').style.display = '';
    $('mail-empty').textContent = 'This mailbox is empty.';
    return;
  }
  $('mail-empty').style.display = 'none';
  for (const m of messages) {
    const li = document.createElement('li');
    // POP3 can't know seen state (m.seen === null) — treat as "unseen" visually
    // is misleading, so POP3 messages render neutral (no unseen bar).
    const isUnseen = m.seen === false;
    li.className = isUnseen ? 'unseen' : (m.seen === true ? 'seen' : '');
    const subject = (m.subject || '(no subject)');
    const meta = m.from || '';
    li.innerHTML =
      `<span class="dot"></span>` +
      `<div class="body"><div class="subject"></div><div class="meta"></div></div>` +
      `<div class="date"></div>`;
    li.querySelector('.subject').textContent = subject;
    li.querySelector('.meta').textContent = meta;
    li.querySelector('.date').textContent = (m.date || '').replace(/\s*\+0000$/, '');
    ul.appendChild(li);
  }
}

/* ---- the check ---- */
async function check() {
  const btn = $('btn-check');
  btn.disabled = true;
  $('err').textContent = '';
  logReset();
  renderMessages([]);
  $('mail-empty').style.display = '';
  $('mail-empty').textContent = '…';

  const box = MAILBOXES[$('account').value];
  const creds = { user: $('user').value, pass: $('pass').value, mailbox: 'INBOX' };

  try {
    const conn = loggingConn(M.simulate(protocol, box));
    const status = protocol === 'pop3'
      ? await M.pop3Preview(conn, creds)
      : await M.imapPreview(conn, creds);
    renderStatus(status);
    renderMessages(status.messages);
  } catch (e) {
    $('err').textContent = `${e.name || 'Error'}: ${e.message}`;
    $('status-note').textContent = '';
    ['s-total', 's-unseen', 's-recent', 's-size'].forEach((id) => { $(id).textContent = '—'; $(id).classList.remove('na'); });
    $('mail-empty').style.display = '';
    $('mail-empty').textContent = 'No messages — the check did not complete.';
  } finally {
    btn.disabled = false;
  }
}

$('btn-check').addEventListener('click', check);

/* Keep the prefilled password in step with the IMAP box's trickier password so
 * a first-time click "just works" for either protocol. */
$('account').addEventListener('change', () => {
  const box = MAILBOXES[$('account').value];
  $('user').value = box.user;
  $('pass').value = box.pass;
});
