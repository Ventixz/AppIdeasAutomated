/*
 * script.js — the browser shell. All the real work (smoothing, the document
 * model, convergence, export) lives in whiteboard-core.js; this file is just:
 * a hi-DPI canvas, pointer input, a live preview, undo/redo as operations, the
 * save/load/export buttons, and a BroadcastChannel so tabs collaborate live.
 */
(function () {
  'use strict';
  const WB = window.Whiteboard;

  // ---- elements ----
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const textLayer = document.getElementById('textLayer');
  const cursorsLayer = document.getElementById('cursors');
  const statusEl = document.getElementById('status');
  const countEl = document.getElementById('count');
  const collabStatus = document.getElementById('collabStatus');

  // ---- state ----
  const siteId = 'u-' + Math.random().toString(36).slice(2, 8);
  let replica = WB.createReplica(siteId);
  let tool = 'pen';
  let color = '#1f6feb';
  let width = 4;
  let fillShapes = false;
  let draft = null;            // in-progress element, not yet committed
  let drawing = false;
  const history = [];          // local undo stack
  const redoStack = [];
  const myColor = pickCursorColor(siteId);

  // ---------------------------------------------------------------- DPI
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // draw in CSS pixels; stay crisp
    render();
  }
  window.addEventListener('resize', fitCanvas);

  // ---------------------------------------------------------------- render
  function cssSize() {
    const rect = canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  function render() {
    const s = cssSize();
    ctx.clearRect(0, 0, s.w, s.h);
    WB.renderDocument(ctx, replica.document(), { background: null });
    if (draft) WB.drawElement(ctx, draft);
    countEl.textContent = replica.document().length + ' element' + (replica.document().length === 1 ? '' : 's');
  }

  // ---------------------------------------------------------------- pointer
  function pt(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const p = pt(e);

    if (tool === 'text') { placeNote(p); return; }
    if (tool === 'eraser') { drawing = true; eraseAt(p); return; }

    drawing = true;
    if (tool === 'pen' || tool === 'highlighter') {
      draft = {
        type: tool, color: color, width: tool === 'highlighter' ? width * 2.2 : width,
        opacity: tool === 'highlighter' ? 0.35 : 1, points: [p]
      };
    } else { // line / rect / ellipse
      draft = {
        type: tool, color: color, width: width,
        opacity: 1, fill: (fillShapes && tool !== 'line') ? color : null,
        a: p, b: p
      };
    }
    render();
  }

  function onMove(e) {
    const p = pt(e);
    broadcastCursor(p);
    if (!drawing) return;
    if (tool === 'eraser') { eraseAt(p); return; }
    if (!draft) return;
    if (draft.type === 'pen' || draft.type === 'highlighter') {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.1) draft.points.push(p);
    } else {
      if (e.shiftKey && (draft.type === 'rect' || draft.type === 'ellipse')) {
        // square / circle with shift
        const dx = p.x - draft.a.x, dy = p.y - draft.a.y;
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        draft.b = { x: draft.a.x + Math.sign(dx || 1) * m, y: draft.a.y + Math.sign(dy || 1) * m };
      } else {
        draft.b = p;
      }
    }
    render();
  }

  function onUp() {
    if (tool === 'eraser') { drawing = false; return; }
    if (!draft) { drawing = false; return; }
    drawing = false;
    // Discard a stroke/shape too small to matter.
    const b = WB.elementBounds(draft);
    const tiny = (draft.type === 'pen' || draft.type === 'highlighter')
      ? draft.points.length < 1
      : (b.w < 2 && b.h < 2);
    if (!tiny) commitElement(draft);
    draft = null;
    render();
  }

  // ---------------------------------------------------------------- commit / history
  function commitElement(el) {
    const op = replica.addElement(el);
    broadcast(op);
    history.push({ type: 'add', id: op.el.id, data: el });
    redoStack.length = 0;
    render();
  }

  function eraseAt(p) {
    const ids = WB.hitTest(replica.document(), p.x, p.y, Math.max(8, width));
    if (!ids.length) return;
    const doc = replica.document();
    const removed = doc.filter(function (el) { return ids.indexOf(el.id) !== -1; });
    for (const id of ids) broadcast(replica.deleteElement(id));
    history.push({ type: 'del', elements: removed });
    redoStack.length = 0;
    render();
  }

  // ---------------------------------------------------------------- undo / redo
  // Undo/redo are expressed as more operations, so they stay consistent with
  // collaboration. Reviving an element re-adds it (with a fresh id).
  function undo() {
    const entry = history.pop();
    if (!entry) return;
    if (entry.type === 'add') {
      broadcast(replica.deleteElement(entry.id));
      redoStack.push(entry);
    } else if (entry.type === 'del' || entry.type === 'clear') {
      const newIds = [];
      for (const el of entry.elements) {
        const op = replica.addElement(stripId(el));
        broadcast(op); newIds.push(op.el.id);
      }
      redoStack.push({ type: entry.type, elements: entry.elements, newIds: newIds });
    }
    render();
  }
  function redo() {
    const entry = redoStack.pop();
    if (!entry) return;
    if (entry.type === 'add') {
      const op = replica.addElement(stripId(entry.data));
      broadcast(op);
      history.push({ type: 'add', id: op.el.id, data: entry.data });
    } else if (entry.type === 'del' || entry.type === 'clear') {
      for (const id of entry.newIds) broadcast(replica.deleteElement(id));
      history.push({ type: entry.type, elements: entry.elements });
    }
    render();
  }
  function stripId(el) { const c = Object.assign({}, el); delete c.id; return c; }

  // ---------------------------------------------------------------- text notes
  function placeNote(p) {
    const ta = document.createElement('textarea');
    ta.className = 'note-input';
    ta.style.left = p.x + 'px';
    ta.style.top = (p.y - 16) + 'px';
    ta.style.color = color;
    ta.rows = 1;
    textLayer.appendChild(ta);
    ta.focus();
    function commit() {
      const text = ta.value.replace(/\s+$/, '');
      if (ta.parentNode) ta.parentNode.removeChild(ta);
      if (text) commitElement({ type: 'text', color: color, x: p.x, y: p.y, text: text, fontSize: Math.max(12, width * 3) });
    }
    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); }
      if (ev.key === 'Escape') { ta.value = ''; ta.blur(); }
    });
  }

  // ---------------------------------------------------------------- collaboration
  let channel = null;
  let roomId = null;
  const peers = {};   // siteId -> {cursorEl, lastSeen}

  function startCollab(room) {
    roomId = room;
    if (channel) channel.close();
    channel = new BroadcastChannel('whiteboard:' + room);
    channel.onmessage = onChannelMessage;
    // Announce ourselves and ask existing peers for the current board.
    channel.postMessage({ t: 'hello', from: siteId });
    channel.postMessage({ t: 'sync-request', from: siteId });
    collabStatus.textContent = 'live · room ' + room;
    collabStatus.classList.add('live');
    document.getElementById('collabBtn').classList.add('on');
    updateUrlRoom(room);
  }

  function onChannelMessage(ev) {
    const msg = ev.data;
    if (!msg || msg.from === siteId) return;
    switch (msg.t) {
      case 'op':
        if (replica.receive(msg.op)) render();
        break;
      case 'hello':
        // greet the newcomer and offer our board
        channel.postMessage({ t: 'snapshot', from: siteId, to: msg.from, ops: replica.snapshot().ops });
        break;
      case 'sync-request':
        channel.postMessage({ t: 'snapshot', from: siteId, to: msg.from, ops: replica.snapshot().ops });
        break;
      case 'snapshot':
        if (msg.to && msg.to !== siteId) break;
        let changed = false;
        for (const op of msg.ops) if (replica.receive(op)) changed = true;
        if (changed) render();
        break;
      case 'cursor':
        showRemoteCursor(msg.from, msg.x, msg.y, msg.color);
        break;
    }
  }

  function broadcast(op) { if (channel) channel.postMessage({ t: 'op', from: siteId, op: op }); }

  let lastCursorSent = 0;
  function broadcastCursor(p) {
    if (!channel) return;
    const now = Date.now();
    if (now - lastCursorSent < 40) return;
    lastCursorSent = now;
    channel.postMessage({ t: 'cursor', from: siteId, x: p.x, y: p.y, color: myColor });
  }

  function showRemoteCursor(id, x, y, c) {
    let peer = peers[id];
    if (!peer) {
      const el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML = '<span class="dot"></span><span class="name"></span>';
      el.querySelector('.dot').style.background = c || '#888';
      el.querySelector('.name').textContent = id;
      cursorsLayer.appendChild(el);
      peer = peers[id] = { el: el };
    }
    peer.el.style.left = x + 'px';
    peer.el.style.top = y + 'px';
    peer.lastSeen = Date.now();
  }
  // retire cursors that went quiet
  setInterval(function () {
    const now = Date.now();
    for (const id in peers) {
      if (now - peers[id].lastSeen > 4000) {
        if (peers[id].el.parentNode) peers[id].el.parentNode.removeChild(peers[id].el);
        delete peers[id];
      }
    }
  }, 2000);

  function updateUrlRoom(room) {
    try {
      const u = new URL(location.href);
      u.hash = 'room=' + room;
      if (window.history && window.history.replaceState) window.history.replaceState(null, '', u.toString());
      document.getElementById('roomLink').value = u.toString();
    } catch (e) { /* file:// may not allow; ignore */ }
  }

  function pickCursorColor(seed) {
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return 'hsl(' + h + ' 70% 45%)';
  }

  // ---------------------------------------------------------------- save / load / export
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function save() {
    const json = WB.serialize(replica.document(), { app: 'online-white-board', savedAt: new Date().toISOString() });
    download('whiteboard-' + Date.now() + '.wbd', new Blob([json], { type: 'application/json' }));
    flash('Saved vector document (.wbd)');
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let els;
      try { els = WB.deserialize(reader.result); }
      catch (e) { flash('Not a whiteboard document'); return; }
      // Rebuild a fresh document from the loaded elements.
      replica = WB.createReplica(siteId);
      history.length = 0; redoStack.length = 0;
      for (const el of els) {
        const op = replica.addElement(stripId(el));
        broadcast(op);
      }
      render();
      flash('Loaded ' + els.length + ' elements');
    };
    reader.readAsText(file);
  }

  function exportPNG() {
    const doc = replica.document();
    const b = WB.documentBounds(doc);
    const s = cssSize();
    const pad = 16;
    const w = b ? Math.ceil(b.w + pad * 2) : s.w;
    const h = b ? Math.ceil(b.h + pad * 2) : s.h;
    const scale = 2;
    const off = document.createElement('canvas');
    off.width = w * scale; off.height = h * scale;
    const octx = off.getContext('2d');
    octx.setTransform(scale, 0, 0, scale, 0, 0);
    octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, w, h);
    if (b) octx.translate(-b.x + pad, -b.y + pad);
    WB.renderDocument(octx, doc, {});
    off.toBlob(function (blob) { download('whiteboard-' + Date.now() + '.png', blob); flash('Exported PNG @2x'); });
  }

  function exportSVG() {
    const doc = replica.document();
    const b = WB.documentBounds(doc);
    const pad = 16;
    const opts = b
      ? { width: Math.ceil(b.w + pad * 2), height: Math.ceil(b.h + pad * 2), background: '#ffffff' }
      : { width: cssSize().w, height: cssSize().h, background: '#ffffff' };
    // shift elements into view by translating the doc
    let svg;
    if (b) {
      const shifted = doc.map(function (el) { return translateEl(el, -b.x + pad, -b.y + pad); });
      svg = WB.toSVG(shifted, opts);
    } else {
      svg = WB.toSVG(doc, opts);
    }
    download('whiteboard-' + Date.now() + '.svg', new Blob([svg], { type: 'image/svg+xml' }));
    flash('Exported SVG (vector)');
  }

  function translateEl(el, dx, dy) {
    const c = JSON.parse(JSON.stringify(el));
    if (c.points) c.points = c.points.map(function (p) { return { x: p.x + dx, y: p.y + dy }; });
    if (c.a) { c.a = { x: c.a.x + dx, y: c.a.y + dy }; }
    if (c.b) { c.b = { x: c.b.x + dx, y: c.b.y + dy }; }
    if (c.x != null) c.x += dx;
    if (c.y != null) c.y += dy;
    return c;
  }

  // ---------------------------------------------------------------- UI wiring
  const PALETTE = ['#111111', '#ffffff', '#1f6feb', '#2ea043', '#e3b341', '#f85149', '#a371f7', '#db61a2'];
  const swatchWrap = document.getElementById('swatches');
  PALETTE.forEach(function (c) {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c; b.title = c;
    b.setAttribute('aria-pressed', c === color ? 'true' : 'false');
    b.addEventListener('click', function () { setColor(c); });
    swatchWrap.appendChild(b);
  });
  function setColor(c) {
    color = c;
    document.getElementById('customColor').value = toHex(c);
    [].forEach.call(swatchWrap.children, function (s) {
      s.setAttribute('aria-pressed', s.title === c ? 'true' : 'false');
    });
    updateStatus();
  }
  function toHex(c) { return /^#/.test(c) ? c : '#1f6feb'; }

  document.getElementById('customColor').addEventListener('input', function (e) { setColor(e.target.value); });

  [].forEach.call(document.querySelectorAll('.tool'), function (btn) {
    btn.addEventListener('click', function () { setTool(btn.dataset.tool); });
  });
  function setTool(t) {
    tool = t;
    [].forEach.call(document.querySelectorAll('.tool'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false');
    });
    canvas.style.cursor = (t === 'text') ? 'text' : (t === 'eraser' ? 'cell' : 'crosshair');
    updateStatus();
  }

  document.getElementById('width').addEventListener('input', function (e) { width = +e.target.value; updateStatus(); });
  document.getElementById('fill').addEventListener('change', function (e) { fillShapes = e.target.checked; });

  document.getElementById('undo').addEventListener('click', undo);
  document.getElementById('redo').addEventListener('click', redo);
  document.getElementById('clear').addEventListener('click', function () {
    if (!replica.document().length) return;
    const all = replica.document().slice();
    broadcast(replica.clear());
    history.push({ type: 'clear', elements: all });
    redoStack.length = 0;
    render();
  });

  document.getElementById('save').addEventListener('click', save);
  document.getElementById('load').addEventListener('click', function () { document.getElementById('fileInput').click(); });
  document.getElementById('fileInput').addEventListener('change', function (e) { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
  document.getElementById('pngBtn').addEventListener('click', exportPNG);
  document.getElementById('svgBtn').addEventListener('click', exportSVG);

  // collab panel
  const panel = document.getElementById('collabPanel');
  document.getElementById('collabBtn').addEventListener('click', function () {
    if (!roomId) startCollab(Math.random().toString(36).slice(2, 8));
    panel.hidden = false;
  });
  document.getElementById('closePanel').addEventListener('click', function () { panel.hidden = true; });
  document.getElementById('copyLink').addEventListener('click', function () {
    const inp = document.getElementById('roomLink'); inp.select();
    try { navigator.clipboard.writeText(inp.value); flash('Room link copied'); }
    catch (e) { document.execCommand && document.execCommand('copy'); }
  });
  document.getElementById('openTab').addEventListener('click', function () {
    window.open(document.getElementById('roomLink').value || location.href, '_blank');
  });

  // keyboard
  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const map = { p: 'pen', h: 'highlighter', l: 'line', r: 'rect', o: 'ellipse', t: 'text', e: 'eraser' };
    if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  });

  function updateStatus() {
    const names = { pen: 'Pen', highlighter: 'Highlighter', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Note', eraser: 'Eraser' };
    statusEl.textContent = names[tool] + ' · ' + width + 'px · ' + color;
  }
  let flashTimer = null;
  function flash(msg) {
    statusEl.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(updateStatus, 1600);
  }

  // pointer listeners
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  // join a room if the URL carries one
  (function initRoom() {
    const m = /room=([a-z0-9]+)/i.exec(location.hash || '');
    if (m) startCollab(m[1]);
  })();

  // boot
  fitCanvas();
  updateStatus();
})();
