/*
 * cms-core.js — a dependency-free content-management core.
 *
 * This is the whole CMS minus the chrome: a content store (posts and pages
 * with status, tags, slugs and timestamps), a hand-written Markdown renderer
 * that is safe against injection, slug derivation with collision handling, and
 * a static-site renderer that turns the store into a set of HTML pages.
 *
 * It has no dependencies and no I/O. The browser admin (script.js) and the
 * Node test suite (tests.js) both drive this same object, so every behaviour
 * the UI shows is the behaviour the tests assert.
 *
 * Works both as a CommonJS module (Node) and as a browser global (window.CMS).
 */

'use strict';

/* ------------------------------------------------------------------ *
 * HTML escaping — the first line of defence.
 * ------------------------------------------------------------------ */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape the five characters that are dangerous in HTML text/attributes. */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/* ------------------------------------------------------------------ *
 * URL sanitisation — reject dangerous schemes in links and images.
 * ------------------------------------------------------------------ */

// Schemes we allow in hrefs/srcs. Anything else (javascript:, data:, vbscript:)
// is dropped. We also allow protocol-relative (//…), fragment (#…), root (/…)
// and plain relative URLs.
const SAFE_SCHEME = /^(https?:|mailto:|tel:|ftp:)/i;

/**
 * Return url if it is safe to put in an href/src, otherwise return '#'.
 * The check is deliberately strict: a URL that declares *any* scheme must
 * declare one of the allowed ones.
 */
function sanitizeUrl(url) {
  const trimmed = String(url).trim();
  if (trimmed === '') return '#';

  // Strip control characters (incl. tab/newline) that browsers tolerate
  // inside "java\tscript:" — a classic filter-bypass trick.
  const cleaned = trimmed.replace(/[\u0000-\u001F\u007F]/g, '');

  // A scheme is letters/digits/+/-/./ followed by a colon, before any / ? #.
  const schemeMatch = cleaned.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    return SAFE_SCHEME.test(cleaned) ? cleaned : '#';
  }
  // No scheme at all → relative/fragment/root/protocol-relative: allowed.
  return cleaned;
}

/* ------------------------------------------------------------------ *
 * Slugs — URL-safe identifiers derived from titles.
 * ------------------------------------------------------------------ */

/**
 * Turn an arbitrary title into a lowercase, hyphen-separated slug.
 * Accented letters are folded to ASCII where possible; everything that is
 * not a letter or digit becomes a hyphen; runs collapse; ends are trimmed.
 * An empty result falls back to 'untitled'.
 */
function slugify(title) {
  const folded = String(title)
    .normalize('NFKD')               // é → e +  ́  so the mark can be stripped
    .replace(/[̀-ͯ]/g, ''); // drop combining marks

  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '');    // trim leading/trailing hyphens

  return slug || 'untitled';
}

/**
 * Derive a slug that does not collide with any in `taken` (an array or Set of
 * existing slugs). On collision, append -2, -3, … until free.
 */
function uniqueSlug(title, taken) {
  const set = taken instanceof Set ? taken : new Set(taken || []);
  const base = slugify(title);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* ------------------------------------------------------------------ *
 * Markdown → HTML. A small, safe, well-defined subset.
 * ------------------------------------------------------------------ */

/**
 * Render inline markdown (within a single line/paragraph): code spans, links,
 * images, bold, italic. Everything is HTML-escaped; only the tags we generate
 * ourselves are real HTML.
 *
 * Order matters. Code spans are pulled out FIRST so their contents are never
 * reinterpreted as emphasis or links (`*not italic*` stays literal), then
 * restored at the end.
 */
function renderInline(text) {
  const codeSpans = [];
  // Pull out `code` spans, leaving a placeholder that cannot appear in user
  // text (it contains a null byte).
  let out = String(text).replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  // Escape everything else now that code is safely parked.
  out = escapeHtml(out);

  // Images: ![alt](url) — must run before links (same bracket syntax).
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    return `<img src="${escapeHtml(sanitizeUrl(url))}" alt="${alt}">`;
  });

  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    return `<a href="${escapeHtml(sanitizeUrl(url))}">${label}</a>`;
  });

  // Bold then italic. Bold first so **x** isn't eaten as two italics.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Restore code spans.
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
  return out;
}

/**
 * Render a full Markdown document to HTML. Block-level handling:
 * fenced code (```), ATX headings (#), horizontal rules (---), blockquotes
 * (>), unordered lists (- or *), ordered lists (1.), and paragraphs.
 */
function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;

  // Buffers for the two multi-line structures that aren't code.
  let para = [];
  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(para.join(' '))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      flushPara();
      const lang = fence[1].trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or run off the end)
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      html.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Blank line → paragraph break.
    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      html.push('<hr>');
      i++;
      continue;
    }

    // ATX heading.
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote (one or more consecutive > lines).
    if (/^\s*>/.test(line)) {
      flushPara();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      html.push(`<blockquote>${renderInline(quote.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      html.push(
        `<ul>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</ul>`
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      html.push(
        `<ol>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</ol>`
      );
      continue;
    }

    // Otherwise, part of a paragraph.
    para.push(line.trim());
    i++;
  }
  flushPara();
  return html.join('\n');
}

/**
 * A plain-text excerpt (for list views / meta descriptions): strip markdown
 * syntax, collapse whitespace, truncate on a word boundary with an ellipsis.
 */
function excerpt(src, maxLen = 160) {
  const text = String(src)
    .replace(/```[\s\S]*?```/g, ' ')      // code blocks
    .replace(/`[^`]*`/g, ' ')             // code spans
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/[#>*_~-]/g, ' ')            // residual markdown punctuation
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/* ------------------------------------------------------------------ *
 * The content store.
 * ------------------------------------------------------------------ */

const STATUS = Object.freeze({ DRAFT: 'draft', PUBLISHED: 'published' });

/**
 * A CMS instance holds an ordered list of content items. Each item:
 *   { id, type, title, slug, body, tags[], status, createdAt, updatedAt }
 *
 * `now` and `idgen` are injectable so tests are deterministic.
 */
class CMS {
  constructor(options = {}) {
    this.items = [];
    this._now = options.now || (() => new Date().toISOString());
    let counter = 0;
    this._idgen = options.idgen || (() => `c${++counter}`);
  }

  _slugsExcept(id) {
    const set = new Set();
    for (const it of this.items) if (it.id !== id) set.add(it.slug);
    return set;
  }

  /** Create a post (type 'post') or page (type 'page'). Returns the item. */
  create({ title = '', body = '', tags = [], status = STATUS.DRAFT, type = 'post', slug } = {}) {
    if (status !== STATUS.DRAFT && status !== STATUS.PUBLISHED) {
      throw new Error(`invalid status: ${status}`);
    }
    const ts = this._now();
    const finalSlug = uniqueSlug(slug || title, this._slugsExcept(null));
    const item = {
      id: this._idgen(),
      type,
      title: String(title),
      slug: finalSlug,
      body: String(body),
      tags: normalizeTags(tags),
      status,
      createdAt: ts,
      updatedAt: ts,
    };
    this.items.push(item);
    return item;
  }

  get(id) {
    return this.items.find((it) => it.id === id) || null;
  }

  getBySlug(slug) {
    return this.items.find((it) => it.slug === slug) || null;
  }

  /**
   * Patch an item. Changing the title does NOT change the slug (published
   * links stay valid); pass an explicit `slug` to re-slug on purpose, and it
   * will be de-duplicated against the other items.
   */
  update(id, patch = {}) {
    const item = this.get(id);
    if (!item) throw new Error(`no such item: ${id}`);
    if ('title' in patch) item.title = String(patch.title);
    if ('body' in patch) item.body = String(patch.body);
    if ('tags' in patch) item.tags = normalizeTags(patch.tags);
    if ('type' in patch) item.type = patch.type;
    if ('status' in patch) {
      if (patch.status !== STATUS.DRAFT && patch.status !== STATUS.PUBLISHED) {
        throw new Error(`invalid status: ${patch.status}`);
      }
      item.status = patch.status;
    }
    if ('slug' in patch && patch.slug) {
      item.slug = uniqueSlug(patch.slug, this._slugsExcept(id));
    }
    item.updatedAt = this._now();
    return item;
  }

  publish(id) {
    return this.update(id, { status: STATUS.PUBLISHED });
  }

  unpublish(id) {
    return this.update(id, { status: STATUS.DRAFT });
  }

  remove(id) {
    const n = this.items.length;
    this.items = this.items.filter((it) => it.id !== id);
    return this.items.length < n;
  }

  /** List items, optionally filtered. Returns a new array (newest first). */
  list({ status, type, tag, query } = {}) {
    let out = this.items.slice();
    if (status) out = out.filter((it) => it.status === status);
    if (type) out = out.filter((it) => it.type === type);
    if (tag) out = out.filter((it) => it.tags.includes(tag.toLowerCase()));
    if (query) {
      const q = query.toLowerCase();
      out = out.filter(
        (it) =>
          it.title.toLowerCase().includes(q) ||
          it.body.toLowerCase().includes(q)
      );
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return out;
  }

  /** Published items only — what the public site shows. */
  published(filter = {}) {
    return this.list({ ...filter, status: STATUS.PUBLISHED });
  }

  /** All tags in use across published items, with counts, sorted by count. */
  tagCloud() {
    const counts = new Map();
    for (const it of this.published()) {
      for (const t of it.tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** Serialise the whole store to a JSON string (for export / localStorage). */
  toJSON() {
    return JSON.stringify({ version: 1, items: this.items }, null, 2);
  }

  /** Rebuild a store from toJSON() output. Ignores malformed input safely. */
  static fromJSON(json, options = {}) {
    const cms = new CMS(options);
    let data;
    try {
      data = typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
      return cms;
    }
    if (data && Array.isArray(data.items)) {
      cms.items = data.items.map((it) => ({
        ...it,
        tags: normalizeTags(it.tags || []),
      }));
    }
    return cms;
  }
}

function normalizeTags(tags) {
  const list = Array.isArray(tags)
    ? tags
    : String(tags).split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw).trim().toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Static-site renderer — turn published content into HTML pages.
 * ------------------------------------------------------------------ */

const PAGE_SHELL = (title, body) =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body>
${body}
</body>
</html>`;

/**
 * Render the full published site to a map of { path: htmlString }.
 * Produces index.html plus one page per published item at <slug>.html.
 */
function renderSite(cms, { siteTitle = 'My Site' } = {}) {
  const pages = {};
  const posts = cms.published({ type: 'post' });

  const indexBody =
    `<h1>${escapeHtml(siteTitle)}</h1>\n<ul class="post-list">\n` +
    posts
      .map(
        (p) =>
          `  <li><a href="${escapeHtml(p.slug)}.html">${escapeHtml(p.title)}</a>` +
          ` — ${escapeHtml(excerpt(p.body, 100))}</li>`
      )
      .join('\n') +
    `\n</ul>`;
  pages['index.html'] = PAGE_SHELL(siteTitle, indexBody);

  for (const item of cms.published()) {
    const tags = item.tags.length
      ? `\n<p class="tags">${item.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}</p>`
      : '';
    const body =
      `<article>\n<h1>${escapeHtml(item.title)}</h1>` +
      tags +
      `\n${renderMarkdown(item.body)}\n</article>\n` +
      `<p><a href="index.html">← back</a></p>`;
    pages[`${item.slug}.html`] = PAGE_SHELL(`${item.title} — ${siteTitle}`, body);
  }
  return pages;
}

/* ------------------------------------------------------------------ */

const api = {
  escapeHtml,
  sanitizeUrl,
  slugify,
  uniqueSlug,
  renderInline,
  renderMarkdown,
  excerpt,
  normalizeTags,
  CMS,
  STATUS,
  renderSite,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.CMS = api;
}
