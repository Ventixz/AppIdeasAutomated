'use strict';
/*
 * script.js — the browser UI. All the hard logic (serialisation, wrapping,
 * escaping, validation) lives in ecard-core.js; this file is glue: read the
 * form into a card, draw the card onto a canvas, and wire the share/download
 * buttons. It also hydrates from a #card=… link on load, so a shared URL opens
 * straight into the received card.
 */
(function () {
  const C = window.ECardCore;
  const $ = (id) => document.getElementById(id);

  const els = {
    occasions: $('occasions'),
    heading: $('heading'),
    message: $('message'),
    signature: $('signature'),
    emoji: $('emoji'),
    font: $('font'),
    bg1: $('bg1'), bg2: $('bg2'), text: $('text'),
    msgCount: $('msg-count'),
    warnings: $('warnings'),
    canvas: $('canvas'),
    toast: $('toast'),
  };
  const ctx = els.canvas.getContext('2d');

  // ---- build the occasion chips & font options from the registry ----------
  Object.entries(C.OCCASIONS).forEach(([key, occ]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = occ.emoji + ' ' + occ.label;
    btn.dataset.occasion = key;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.addEventListener('click', () => applyOccasion(key));
    els.occasions.appendChild(btn);
  });
  Object.entries(C.FONTS).forEach(([key, f]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = f.label;
    els.font.appendChild(opt);
  });

  // When an occasion chip is clicked, load its preset — but keep whatever the
  // user already typed into the message/signature, since those are personal.
  function applyOccasion(key) {
    const occ = C.OCCASIONS[key];
    els.heading.value = occ.heading;
    els.emoji.value = occ.emoji;
    els.bg1.value = occ.bg1;
    els.bg2.value = occ.bg2;
    els.text.value = occ.text;
    current.occasion = key;
    render();
  }

  // ---- read the form into a card object -----------------------------------
  let current = { occasion: C.DEFAULT_OCCASION };
  function readForm() {
    return C.clampCard({
      occasion: current.occasion,
      heading: els.heading.value,
      message: els.message.value,
      signature: els.signature.value,
      emoji: els.emoji.value,
      font: els.font.value,
      bg1: els.bg1.value,
      bg2: els.bg2.value,
      text: els.text.value,
    });
  }

  function writeForm(card) {
    current.occasion = card.occasion;
    els.heading.value = card.heading;
    els.message.value = card.message;
    els.signature.value = card.signature;
    els.emoji.value = card.emoji;
    els.font.value = card.font;
    els.bg1.value = card.bg1;
    els.bg2.value = card.bg2;
    els.text.value = card.text;
  }

  // ---- canvas rendering ----------------------------------------------------
  function render() {
    const card = readForm();
    const w = els.canvas.width, h = els.canvas.height;

    // mark the active occasion chip
    els.occasions.querySelectorAll('.chip').forEach((chip) => {
      chip.setAttribute('aria-checked', String(chip.dataset.occasion === card.occasion));
    });

    // gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, card.bg1);
    grad.addColorStop(1, card.bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // soft inner panel
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, 36, 36, w - 72, h - 72, 24);
    ctx.fill();

    ctx.fillStyle = card.text;
    ctx.textAlign = 'center';
    const fontStack = C.FONTS[card.font].stack;

    // emoji
    ctx.font = '72px ' + fontStack;
    ctx.textBaseline = 'middle';
    ctx.fillText(card.emoji, w / 2, 130);

    // heading
    ctx.font = '600 44px ' + fontStack;
    ctx.fillText(truncateToWidth(card.heading, w - 140, '600 44px ' + fontStack), w / 2, 210);

    // message — word-wrapped via the core, then measured against the canvas so
    // lines that are character-short but pixel-long still fit.
    ctx.font = '26px ' + fontStack;
    const lines = layoutMessage(card.message, w - 160, '26px ' + fontStack, 7);
    const lineHeight = 36;
    let y = 290;
    for (const line of lines) {
      ctx.fillText(line, w / 2, y);
      y += lineHeight;
    }

    // signature, pinned near the bottom
    if (card.signature) {
      ctx.font = 'italic 24px ' + fontStack;
      ctx.fillText(truncateToWidth(card.signature, w - 140, 'italic 24px ' + fontStack), w / 2, h - 70);
    }

    updateChrome(card);
  }

  // Wrap by characters first (core), then, for each wrapped line, fall back to a
  // pixel hard-break if the font makes it wider than the canvas allows.
  function layoutMessage(message, maxWidthPx, font, maxLines) {
    ctx.font = font;
    // Estimate a character budget from the width of an average glyph.
    const sample = ctx.measureText('average sentence here').width / 'average sentence here'.length;
    const charsPerLine = Math.max(8, Math.floor(maxWidthPx / Math.max(1, sample)));
    const wrapped = C.wrapText(message, charsPerLine, maxLines);
    const out = [];
    for (const line of wrapped.lines) {
      if (ctx.measureText(line).width <= maxWidthPx) { out.push(line); continue; }
      // rare: break further on width
      let cur = '';
      for (const ch of line) {
        if (ctx.measureText(cur + ch).width > maxWidthPx && cur) { out.push(cur); cur = ch; }
        else cur += ch;
      }
      if (cur) out.push(cur);
    }
    return out.slice(0, maxLines);
  }

  function truncateToWidth(text, maxWidthPx, font) {
    ctx.font = font;
    if (ctx.measureText(text).width <= maxWidthPx) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidthPx) {
      s = Array.from(s).slice(0, -1).join('');
    }
    return s + '…';
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---- warnings + char count ----------------------------------------------
  function updateChrome(card) {
    const used = Array.from(els.message.value).length;
    els.msgCount.textContent = used + ' / ' + C.LIMITS.message;
    const v = C.validateCard({
      message: els.message.value, bg1: els.bg1.value, bg2: els.bg2.value, text: els.text.value,
    });
    els.warnings.textContent = v.valid ? '' : v.errors.join('  ');
  }

  // ---- actions -------------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.textContent = ''; }, 2600);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label + ' copied to clipboard.');
    } catch (e) {
      // Fallback for insecure contexts / older browsers.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(label + ' copied.'); }
      catch (_) { toast('Copy failed — here it is: ' + text.slice(0, 60) + '…'); }
      document.body.removeChild(ta);
    }
  }

  $('download').addEventListener('click', () => {
    render();
    const a = document.createElement('a');
    a.href = els.canvas.toDataURL('image/png');
    a.download = 'ecard.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('Downloaded ecard.png.');
  });

  $('copy-link').addEventListener('click', () => {
    const url = C.buildShareUrl(location.href, readForm());
    // reflect it into the address bar too, so a refresh keeps the card
    try { history.replaceState(null, '', url); } catch (_) {}
    copy(url, 'Share link');
  });

  $('copy-text').addEventListener('click', () => {
    const card = readForm();
    const parts = [card.heading, '', card.message];
    if (card.signature) parts.push('', card.signature);
    copy(parts.join('\n'), 'Message');
  });

  // ---- live updates --------------------------------------------------------
  ['heading', 'message', 'signature', 'emoji', 'font', 'bg1', 'bg2', 'text'].forEach((id) => {
    els[id].addEventListener('input', render);
  });

  // ---- hydrate from a shared link, else a friendly default -----------------
  const fromUrl = C.parseShareUrl(location.href);
  if (fromUrl) {
    writeForm(fromUrl);
  } else {
    writeForm(C.clampCard({
      occasion: 'birthday',
      message: 'Wishing you a wonderful day filled with everything you love. 🎈',
      signature: 'With love',
    }));
  }
  render();
})();
