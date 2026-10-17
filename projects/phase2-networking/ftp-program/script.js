/*
 * script.js — browser glue for the FTP visualizer.
 *
 * Wires a FtpClient to a MemoryFtpServer (both from ftp-core.js) over the
 * in-memory wire, drives it from the UI, and streams every control line into
 * the transcript. All server I/O goes through real protocol commands — the
 * file listing you see is parsed from what LIST actually returned, not read
 * out of the filesystem behind the protocol's back.
 */
'use strict';

const { MemoryFileSystem, MemoryFtpServer, FtpClient } = window.FTP;

const $ = (id) => document.getElementById(id);
const transcriptEl = $('transcript');
const listingEl = $('listing').querySelector('tbody');

// ---- a seeded server filesystem --------------------------------------
function seedFs() {
  return new MemoryFileSystem({
    pub: {
      'readme.txt': 'Welcome to the in-memory FTP server.\n\n' +
        'Everything here is served over a faithful RFC 959 implementation\n' +
        'running entirely in your browser — control channel, data channel,\n' +
        'passive-mode handshake and all.\n',
      'quote.txt': '"The network is the computer." — John Gage, 1984\n',
      docs: {
        'rfc959.txt': 'RFC 959 — FILE TRANSFER PROTOCOL (FTP), October 1985.\n' +
          'Defines the control/data channel split this project models.\n',
        'ciphers.txt': 'See also: the Vigenere/Vernam/Caesar project, one level up.\n',
      },
      uploads: {},
    },
  });
}

// ---- transcript ------------------------------------------------------
function codeClass(code) {
  if (code >= 100 && code < 200) return 'c1';
  if (code >= 200 && code < 300) return 'c2';
  if (code >= 300 && code < 400) return 'c3';
  return 'c45';
}

function addLine(dir, text) {
  const line = document.createElement('span');
  line.className = 'ln';
  if (dir === '>') {
    line.classList.add('cmd');
    line.innerHTML = `<span class="dir">&gt;</span>${escapeHtml(text)}`;
  } else {
    const m = /^(\d{3})/.exec(text);
    line.classList.add(m ? codeClass(Number(m[1])) : 'c2');
    line.innerHTML = `<span class="dir">&lt;</span>${escapeHtml(text)}`;
  }
  transcriptEl.appendChild(line);
  follow();
}

function addData(text) {
  const line = document.createElement('span');
  line.className = 'ln data';
  line.innerHTML = `<span class="dir">⇅</span>${escapeHtml(text)}`;
  transcriptEl.appendChild(line);
  follow();
}

function follow() {
  if ($('auto-scroll').checked) transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---- build the session ----------------------------------------------
let server, client;

function connect() {
  server = new MemoryFtpServer(seedFs(), { users: { anonymous: '', ftp: '' } });
  const baseTransport = server.clientTransport();
  // Wrap openData so each data connection shows up in the transcript with a
  // byte count once it closes.
  const transport = {
    control: baseTransport.control,
    async openData(host, port) {
      const ch = await baseTransport.openData(host, port);
      let bytes = 0;
      ch.onData((c) => { bytes += c.length; });
      ch.onClose(() => addData(`data connection ${host}:${port} closed — ${bytes} byte(s)`));
      addData(`data connection opened to ${host}:${port}`);
      return ch;
    },
  };
  client = new FtpClient(transport, { log: addLine });
}

// ---- a strict request/response queue --------------------------------
// FTP is one-command-at-a-time on the control channel; never let two UI
// actions interleave their commands.
let chain = Promise.resolve();
function enqueue(fn) {
  chain = chain.then(fn).catch((e) => {
    $('session-state').textContent = 'error: ' + (e && e.message);
    $('session-state').style.color = 'var(--bad)';
  });
  return chain;
}

// ---- listing rendering (parsed from LIST output) --------------------
function parseListLine(line) {
  const parts = line.split(/\s+/);
  const perms = parts[0];
  const size = Number(parts[4]) || 0;
  const name = parts.slice(8).join(' ');
  return { name, size, isDir: perms[0] === 'd' };
}

async function refresh() {
  const cwd = await client.pwd();
  $('cwd').textContent = cwd;
  $('btn-up').disabled = cwd === '/';
  const lines = await client.list();
  const entries = lines.map(parseListLine).filter((e) => e.name);
  renderListing(entries);
  $('session-state').textContent = 'logged in · anonymous';
  $('session-state').style.color = '';
}

function renderListing(entries) {
  listingEl.innerHTML = '';
  if (entries.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="empty" colspan="3">(empty directory)</td>';
    listingEl.appendChild(tr);
    return;
  }
  for (const e of entries) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'name ' + (e.isDir ? 'dir' : 'file');
    name.textContent = e.name;
    if (e.isDir) name.onclick = () => enqueue(async () => { await client.cwd(e.name); await refresh(); });
    else name.onclick = () => download(e.name);

    const size = document.createElement('td');
    size.className = 'size';
    size.textContent = e.isDir ? '—' : e.size;

    const ops = document.createElement('td');
    ops.className = 'ops';
    if (!e.isDir) {
      const dl = mkOp('download', () => download(e.name));
      ops.appendChild(dl);
    }
    const del = mkOp('delete', () => enqueue(async () => {
      if (e.isDir) await client.rmd(e.name); else await client.dele(e.name);
      hideViewer();
      await refresh();
    }), 'del');
    ops.appendChild(del);

    tr.append(name, size, ops);
    listingEl.appendChild(tr);
  }
}

function mkOp(label, onclick, extra) {
  const a = document.createElement('a');
  a.className = 'op' + (extra ? ' ' + extra : '');
  a.textContent = label;
  a.onclick = onclick;
  return a;
}

// ---- file viewer -----------------------------------------------------
function download(name) {
  enqueue(async () => {
    const text = await client.retr(name);
    $('viewer-name').textContent = name;
    $('viewer-size').textContent = `(${text.length} bytes)`;
    $('viewer-body').textContent = text;
    $('viewer').classList.remove('hidden');
  });
}
function hideViewer() { $('viewer').classList.add('hidden'); }

// ---- wire up the controls -------------------------------------------
$('btn-up').onclick = () => enqueue(async () => { await client.cdup(); await refresh(); });
$('btn-refresh').onclick = () => enqueue(refresh);
$('btn-clear').onclick = () => { transcriptEl.innerHTML = ''; };
$('viewer-close').onclick = hideViewer;

$('btn-upload').onclick = () => {
  const name = $('up-name').value.trim();
  if (!name) { $('up-name').focus(); return; }
  const body = $('up-body').value;
  enqueue(async () => {
    await client.stor(name, body);
    $('up-name').value = '';
    await refresh();
  });
};

$('btn-mkd').onclick = () => {
  const name = $('mkd-name').value.trim();
  if (!name) { $('mkd-name').focus(); return; }
  enqueue(async () => {
    await client.mkd(name);
    $('mkd-name').value = '';
    await refresh();
  });
};

// ---- go --------------------------------------------------------------
$('up-body').value = 'hello from the browser client\n';
connect();
enqueue(async () => {
  await client.readGreeting();
  await client.login('anonymous', '');
  await client.cwd('pub');
  await refresh();
});
