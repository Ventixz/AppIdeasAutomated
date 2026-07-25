/* Image Scanner — extract phone numbers, emails and URLs from a photo.
 *
 * OCR strategy, no dependencies allowed:
 *   1. If the browser exposes the experimental Shape Detection `TextDetector`
 *      API, run it on the imported image and read the text on-device.
 *   2. Otherwise (most browsers today) fall back to a manual text layer: the
 *      user types/pastes the text they can read and the SAME regex extraction
 *      pipeline runs on it. The extraction — the real deliverable — is
 *      identical either way.
 */

const HISTORY_KEY = 'image-scanner:history:v1';

const els = {
  captureInput: document.getElementById('captureInput'),
  importInput: document.getElementById('importInput'),
  preview: document.getElementById('preview'),
  previewImg: document.getElementById('previewImg'),
  ocrStatus: document.getElementById('ocrStatus'),
  textFallback: document.getElementById('textFallback'),
  manualText: document.getElementById('manualText'),
  extractBtn: document.getElementById('extractBtn'),
  results: document.getElementById('results'),
  saveScanBtn: document.getElementById('saveScanBtn'),
  history: document.getElementById('history'),
  historySearch: document.getElementById('historySearch'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
};

// The scan currently on screen (not yet saved).
let current = { text: '', items: [], imageName: '' };

/* ---------- Extraction ---------------------------------------------------- */

// Phone: a run of digits with the usual separators (+, spaces, dashes, dots,
// parens), possibly opening with `(` or `+`. Loosely matched here, then
// validated by digit count and screened against date-like shapes below.
const PHONE_RE = /\+?\(?\d[\d\s().-]{5,}\d/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"]/gi;

// Rejects e.g. ISO dates (2026-07-25) that otherwise pass the digit-count test.
const DATE_RE = /^\d{2,4}-\d{1,2}-\d{1,4}$/;

function normalizePhone(raw) {
  const trimmed = raw.trim();
  if (DATE_RE.test(trimmed)) return null;
  const count = trimmed.replace(/\D/g, '').length;
  return count >= 7 && count <= 15 ? trimmed : null;
}

function extract(text) {
  const found = [];
  const seen = new Set();
  const push = (kind, value) => {
    const key = kind + ':' + value.toLowerCase();
    if (!seen.has(key)) { seen.add(key); found.push({ kind, value }); }
  };

  (text.match(EMAIL_RE) || []).forEach((m) => push('email', m));
  (text.match(URL_RE) || []).forEach((m) => push('url', m));
  (text.match(PHONE_RE) || []).forEach((m) => {
    const p = normalizePhone(m);
    if (p) push('phone', p);
  });

  return found;
}

/* ---------- OCR ----------------------------------------------------------- */

async function runOcr(imgEl) {
  if (!('TextDetector' in window)) {
    setStatus('On-device OCR isn’t available here — paste the text below.', 'warn');
    els.textFallback.open = true;
    return null;
  }
  try {
    setStatus('Reading text from the image…', 'working');
    const detector = new window.TextDetector();
    const blocks = await detector.detect(imgEl);
    const text = blocks.map((b) => b.rawValue).join('\n');
    if (!text.trim()) {
      setStatus('No text detected. Try the paste box below.', 'warn');
      els.textFallback.open = true;
      return null;
    }
    setStatus('Text extracted on-device ✓', 'ok');
    return text;
  } catch (err) {
    setStatus('OCR failed (' + err.message + '). Paste the text below.', 'warn');
    els.textFallback.open = true;
    return null;
  }
}

/* ---------- Image loading ------------------------------------------------- */

function loadImage(file) {
  current.imageName = file.name || 'photo';
  const url = URL.createObjectURL(file);
  els.previewImg.onload = async () => {
    URL.revokeObjectURL(url);
    const text = await runOcr(els.previewImg);
    if (text != null) {
      els.manualText.value = text;
      processText(text);
    }
  };
  els.previewImg.src = url;
  els.preview.hidden = false;
}

/* ---------- Pipeline + rendering ------------------------------------------ */

function processText(text) {
  current.text = text;
  current.items = extract(text);
  renderResults();
}

function setStatus(msg, cls) {
  els.ocrStatus.textContent = msg;
  els.ocrStatus.className = 'status' + (cls ? ' ' + cls : '');
}

const ICONS = { phone: '📞', email: '✉️', url: '🔗' };
const LABELS = { phone: 'Phone', email: 'Email', url: 'Website' };

function valueMarkup(item) {
  if (item.kind === 'email') return '<a href="mailto:' + esc(item.value) + '">' + esc(item.value) + '</a>';
  if (item.kind === 'phone') return '<a href="tel:' + esc(item.value.replace(/[^\d+]/g, '')) + '">' + esc(item.value) + '</a>';
  const href = /^https?:\/\//i.test(item.value) ? item.value : 'https://' + item.value;
  return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(item.value) + '</a>';
}

function renderResults() {
  const items = current.items;
  els.saveScanBtn.disabled = items.length === 0;
  if (!items.length) {
    els.results.innerHTML = '<p class="empty">No phone numbers, emails or links found in that text.</p>';
    return;
  }
  els.results.innerHTML = items.map((it, i) =>
    '<div class="card">' +
      '<span class="icon">' + ICONS[it.kind] + '</span>' +
      '<div class="body">' +
        '<div class="kind">' + LABELS[it.kind] + '</div>' +
        '<div class="value">' + valueMarkup(it) + '</div>' +
      '</div>' +
      '<button class="btn save" data-i="' + i + '" type="button">👤 Save</button>' +
    '</div>'
  ).join('');
}

/* ---------- Save a single detail as a contact (vCard) --------------------- */

function saveContact(item) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Scanned contact'];
  if (item.kind === 'phone') lines.push('TEL;TYPE=CELL:' + item.value.replace(/[^\d+]/g, ''));
  if (item.kind === 'email') lines.push('EMAIL:' + item.value);
  if (item.kind === 'url') lines.push('URL:' + (/^https?:/i.test(item.value) ? item.value : 'https://' + item.value));
  lines.push('END:VCARD');
  download('contact.vcf', lines.join('\r\n'), 'text/vcard');
}

function download(name, content, type) {
  const blob = new Blob([content], { type: type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- History (localStorage) ---------------------------------------- */

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}
function saveHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function saveCurrentScan() {
  if (!current.items.length) return;
  const list = loadHistory();
  list.unshift({
    id: 's' + list.length + '-' + current.imageName + '-' + current.items.length,
    when: new Date().toISOString(),
    image: current.imageName,
    text: current.text,
    items: current.items,
    tags: [],
  });
  saveHistory(list);
  renderHistory();
  setStatus('Scan saved to history ✓', 'ok');
}

function counts(items) {
  const c = { phone: 0, email: 0, url: 0 };
  items.forEach((i) => c[i.kind]++);
  const parts = [];
  if (c.phone) parts.push(c.phone + ' phone' + (c.phone > 1 ? 's' : ''));
  if (c.email) parts.push(c.email + ' email' + (c.email > 1 ? 's' : ''));
  if (c.url) parts.push(c.url + ' link' + (c.url > 1 ? 's' : ''));
  return parts.join(' · ') || 'no details';
}

// A scan matches the query if the query hits its text, image name, any tag,
// or any extracted value. Tag-based search is thus covered for free.
function matches(scan, q) {
  if (!q) return true;
  q = q.toLowerCase();
  if (scan.image.toLowerCase().includes(q)) return true;
  if (scan.text.toLowerCase().includes(q)) return true;
  if (scan.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return scan.items.some((i) => i.value.toLowerCase().includes(q));
}

function renderHistory() {
  const list = loadHistory();
  const q = els.historySearch.value.trim();
  const shown = list.filter((s) => matches(s, q));

  if (!list.length) {
    els.history.innerHTML = '<p class="empty">No saved scans yet.</p>';
    return;
  }
  if (!shown.length) {
    els.history.innerHTML = '<p class="empty">No scans match “' + esc(q) + '”.</p>';
    return;
  }

  els.history.innerHTML = shown.map((s) => {
    const date = new Date(s.when).toLocaleString();
    const tags = s.tags.map((t) =>
      '<span class="tag">' + esc(t) +
        '<button data-untag="' + esc(t) + '" data-id="' + esc(s.id) + '" title="Remove tag">×</button>' +
      '</span>'
    ).join('');
    return (
      '<div class="hist-item">' +
        '<div class="meta"><span>' + esc(s.image) + '</span><span>' + esc(date) + '</span></div>' +
        '<div class="summary"><b>' + esc(counts(s.items)) + '</b></div>' +
        '<div class="tags">' + tags +
          '<button class="add-tag" data-addtag="' + esc(s.id) + '">+ tag</button>' +
        '</div>' +
        '<div class="hist-actions">' +
          '<button class="btn" data-load="' + esc(s.id) + '" type="button">↩ Reopen</button>' +
          '<button class="btn btn-danger" data-del="' + esc(s.id) + '" type="button">Delete</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

/* ---------- Utilities ----------------------------------------------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Events -------------------------------------------------------- */

els.captureInput.addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0]); });
els.importInput.addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0]); });

els.extractBtn.addEventListener('click', () => {
  const text = els.manualText.value.trim();
  if (!text) { setStatus('Type or paste some text first.', 'warn'); return; }
  if (!current.imageName) current.imageName = 'pasted text';
  processText(text);
  setStatus('Extracted from text ✓', 'ok');
});

els.results.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-i]');
  if (btn) saveContact(current.items[+btn.dataset.i]);
});

els.saveScanBtn.addEventListener('click', saveCurrentScan);

els.clearHistoryBtn.addEventListener('click', () => {
  if (!loadHistory().length) return;
  if (confirm('Delete every saved scan?')) { saveHistory([]); renderHistory(); }
});

els.historySearch.addEventListener('input', renderHistory);

els.history.addEventListener('click', (e) => {
  const t = e.target;
  const list = loadHistory();

  if (t.dataset.del) {
    saveHistory(list.filter((s) => s.id !== t.dataset.del));
    renderHistory();
  } else if (t.dataset.load) {
    const s = list.find((x) => x.id === t.dataset.load);
    if (s) {
      current = { text: s.text, items: s.items, imageName: s.image };
      els.manualText.value = s.text;
      renderResults();
      setStatus('Reopened “' + s.image + '”.', 'ok');
      els.results.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else if (t.dataset.addtag) {
    const s = list.find((x) => x.id === t.dataset.addtag);
    const tag = (prompt('Add a tag') || '').trim();
    if (s && tag && !s.tags.includes(tag)) { s.tags.push(tag); saveHistory(list); renderHistory(); }
  } else if (t.dataset.untag) {
    const s = list.find((x) => x.id === t.dataset.id);
    if (s) { s.tags = s.tags.filter((x) => x !== t.dataset.untag); saveHistory(list); renderHistory(); }
  }
});

/* ---------- Init ---------------------------------------------------------- */

if (!('TextDetector' in window)) {
  els.textFallback.open = true;
}
renderHistory();
