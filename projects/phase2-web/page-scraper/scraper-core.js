/*
 * scraper-core.js — the whole engine for the Page Scraper, with no I/O.
 *
 * A page scraper has exactly two hard parts, and neither is "download the
 * page". They are:
 *
 *   1. RESOLVING a reference. The href you pull out of a tag is almost never a
 *      usable URL. It is "../about", or "/logo.png", or "//cdn.example/x.js",
 *      or "?page=2", or "#top". Turning that into an absolute URL is the
 *      RFC 3986 §5 reference-resolution algorithm — remove_dot_segments, merge
 *      paths, the whole thing — and string concatenation (base + href) gets it
 *      wrong in a dozen ways. This file implements it properly.
 *
 *   2. FINDING the references without a browser. You have a blob of tag soup,
 *      not a DOM. You need every URL-bearing attribute (href, src, srcset,
 *      poster, data, ...) while NOT matching text inside <script>, <style> or
 *      comments. This file scans the markup tolerantly, the way a real
 *      extractor has to on markup that is never as clean as the spec.
 *
 * Nothing here touches the network, the filesystem, the DOM, or a timer. Pass
 * in markup and a base URL as strings; get structured results back. That is
 * what makes the same engine run under Node and in the browser, and what makes
 * it testable against the RFC's own canonical vectors (see tests.js).
 */
'use strict';

/* ================================================================== *
 * 1. URL parsing — RFC 3986 Appendix B
 * ================================================================== *
 *
 * The appendix gives one regular expression that splits any URI reference into
 * its five components. We keep the pieces as `undefined` when absent (which is
 * NOT the same as present-but-empty — "http://host" has no path-query-fragment
 * but an empty authority is still an authority), because §5.2.2 and §5.3 both
 * switch on "is this component defined?".
 */
const URI_RE = /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

function parseUri(uri) {
  const m = URI_RE.exec(String(uri));
  // The regex matches everything, but guard anyway.
  if (!m) return { scheme: undefined, authority: undefined, path: '', query: undefined, fragment: undefined };
  return {
    scheme: m[1],            // without the trailing ':'
    authority: m[2],         // without the leading '//'
    path: m[3] || '',        // always a string (possibly empty)
    query: m[4],             // without the leading '?'
    fragment: m[5],          // without the leading '#'
  };
}

/* Recompose a parsed reference back into a string — RFC 3986 §5.3. */
function recompose({ scheme, authority, path, query, fragment }) {
  let out = '';
  if (scheme !== undefined) out += scheme + ':';
  if (authority !== undefined) out += '//' + authority;
  out += path;
  if (query !== undefined) out += '?' + query;
  if (fragment !== undefined) out += '#' + fragment;
  return out;
}

/* ================================================================== *
 * 2. remove_dot_segments — RFC 3986 §5.2.4
 * ================================================================== *
 *
 * The heart of path resolution. It interprets "." and ".." segments and
 * removes them, producing a path with no relative-traversal left in it. This
 * is the step naive scrapers skip, which is why "a/b/../c" stays literally
 * "a/b/../c" in their output instead of collapsing to "a/c".
 *
 * The algorithm is a literal transcription of the five-case loop in the RFC.
 */
function removeDotSegments(path) {
  let input = path;
  let output = '';
  while (input.length > 0) {
    if (input.startsWith('../')) {
      input = input.slice(3);
    } else if (input.startsWith('./')) {
      input = input.slice(2);
    } else if (input.startsWith('/./')) {
      input = '/' + input.slice(3);
    } else if (input === '/.') {
      input = '/';
    } else if (input.startsWith('/../')) {
      input = '/' + input.slice(4);
      output = removeLastSegment(output);
    } else if (input === '/..') {
      input = '/';
      output = removeLastSegment(output);
    } else if (input === '.' || input === '..') {
      input = '';
    } else {
      // Move the first path segment (including any leading '/') to output.
      let i = input.startsWith('/') ? input.indexOf('/', 1) : input.indexOf('/');
      if (i === -1) i = input.length;
      output += input.slice(0, i);
      input = input.slice(i);
    }
  }
  return output;
}

function removeLastSegment(output) {
  const i = output.lastIndexOf('/');
  return i === -1 ? '' : output.slice(0, i);
}

/* merge — RFC 3986 §5.2.3: combine a base path with a relative reference's
 * path when the reference has no authority of its own. */
function mergePaths(base, refPath) {
  // If the base has an authority and an empty path, the merged path is just
  // the reference path with a leading slash.
  if (base.authority !== undefined && base.path === '') {
    return '/' + refPath;
  }
  const i = base.path.lastIndexOf('/');
  return i === -1 ? refPath : base.path.slice(0, i + 1) + refPath;
}

/* ================================================================== *
 * 3. resolveUrl — RFC 3986 §5.2.2 (transform references)
 * ================================================================== *
 *
 * Given a base URI and a reference, produce the target absolute URI. This is
 * THE function. Everything a scraper collects runs through it.
 *
 * `strict` (the default) follows the spec exactly. Non-strict mode adds the
 * one widely-implemented quirk the RFC itself calls out: a reference whose
 * scheme equals the base's scheme is treated as if it had no scheme (so
 * "http:about" resolves relative to an http base instead of being a new URI).
 */
function resolveUrl(baseUri, ref, { strict = true } = {}) {
  const base = parseUri(baseUri);
  const R = parseUri(ref);
  const T = {};

  let refScheme = R.scheme;
  if (!strict && refScheme !== undefined && refScheme === base.scheme) {
    refScheme = undefined;
  }

  if (refScheme !== undefined) {
    T.scheme = refScheme;
    T.authority = R.authority;
    T.path = removeDotSegments(R.path);
    T.query = R.query;
  } else {
    if (R.authority !== undefined) {
      T.authority = R.authority;
      T.path = removeDotSegments(R.path);
      T.query = R.query;
    } else {
      if (R.path === '') {
        T.path = base.path;
        T.query = R.query !== undefined ? R.query : base.query;
      } else {
        if (R.path.startsWith('/')) {
          T.path = removeDotSegments(R.path);
        } else {
          T.path = removeDotSegments(mergePaths(base, R.path));
        }
        T.query = R.query;
      }
      T.authority = base.authority;
    }
    T.scheme = base.scheme;
  }
  T.fragment = R.fragment;
  return recompose(T);
}

/* ================================================================== *
 * 4. HTML scanning — find the URL-bearing attributes
 * ================================================================== *
 *
 * We need attributes from tags, but must NOT read the text content of
 * <script>, <style>, comments, or CDATA as markup (a quoted href="..." inside
 * a script string is not a link). So we walk the markup once, skipping those
 * regions wholesale, and emit a {tag, attrs} record for every start tag.
 */

// Which attribute on which element carries a URL (or a URL list). This is the
// map the HTML spec itself maintains; we cover the ones a scraper cares about.
const URL_ATTRS = {
  a: ['href'],
  area: ['href'],
  link: ['href'],
  base: ['href'],
  img: ['src', 'srcset', 'longdesc'],
  source: ['src', 'srcset'],
  script: ['src'],
  iframe: ['src'],
  frame: ['src'],
  embed: ['src'],
  object: ['data'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  input: ['src'],
  form: ['action'],
  blockquote: ['cite'],
  q: ['cite'],
  del: ['cite'],
  ins: ['cite'],
};

// Attributes whose value is a srcset-style candidate list, not a single URL.
const SRCSET_ATTRS = new Set(['srcset']);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

/*
 * Walk markup and invoke `onTag(tagName, attrsObject)` for each start tag.
 * Lower-cases tag and attribute names. Decodes the handful of HTML entities
 * that actually show up in URLs (&amp; above all — "a?b&amp;c" must become
 * "a?b&c" or every query string with two params is mangled).
 */
function forEachTag(html, onTag) {
  const s = String(html);
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) break;

    // Comment / CDATA / doctype — skip to the matching close.
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') {
      const end = s.indexOf('>', lt + 1);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Find the end of this tag, honouring quotes so a '>' inside an attribute
    // value doesn't end the tag early.
    let j = lt + 1;
    let quote = null;
    while (j < n) {
      const c = s[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    const inner = s.slice(lt + 1, j); // tag contents without < >
    i = j + 1;

    const isClose = inner[0] === '/';
    const body = isClose ? inner.slice(1) : inner;
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(body);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();

    if (!isClose) {
      const attrs = parseAttrs(body.slice(nameMatch[0].length));
      onTag(tag, attrs);

      // Raw-text elements: skip their content so we never read it as markup.
      // (Self-closing <script/> has no content to skip.)
      if (RAW_TEXT_ELEMENTS.has(tag) && !inner.endsWith('/')) {
        const closeRe = new RegExp('</' + tag + '[\\s/>]', 'i');
        closeRe.lastIndex = 0;
        const rest = s.slice(i);
        const m = closeRe.exec(rest);
        i = m ? i + m.index : n;
      }
    }
  }
}

/* Parse the attribute portion of a start tag into a lower-cased name→value
 * object. Tolerant of unquoted values, single quotes, and bare attributes. */
function parseAttrs(str) {
  const attrs = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const name = m[1].toLowerCase();
    let value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/* Decode the entities that occur in real URLs. &amp; is the critical one;
 * numeric entities show up in some generators. */
function decodeEntities(str) {
  if (str.indexOf('&') === -1) return str;
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)));
}
function safeCodePoint(cp) {
  try { return String.fromCodePoint(cp); } catch { return ''; }
}

/* ================================================================== *
 * 5. srcset parsing — WHATWG HTML §image-candidate-strings
 * ================================================================== *
 *
 * srcset is NOT just "split on comma": a URL may itself contain a comma, and
 * the descriptor (a width like "640w" or a density like "2x") is optional. The
 * spec algorithm keys off the fact that a candidate's URL is a run of
 * non-whitespace, and only a *trailing* comma on that run separates candidates.
 */
function parseSrcset(value) {
  const out = [];
  const s = String(value);
  let i = 0;
  const n = s.length;
  const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  while (i < n) {
    while (i < n && (isWs(s[i]) || s[i] === ',')) i++; // skip whitespace and stray commas
    if (i >= n) break;
    // Collect the URL: non-whitespace run.
    let start = i;
    while (i < n && !isWs(s[i])) i++;
    let url = s.slice(start, i);
    // A trailing comma on the URL token both ends the URL and the candidate.
    let trailingComma = false;
    while (url.endsWith(',')) { url = url.slice(0, -1); trailingComma = true; }
    // Skip whitespace, then the descriptor up to the next comma (unless the
    // URL already carried its separating comma).
    let descriptor = '';
    if (!trailingComma) {
      while (i < n && isWs(s[i])) i++;
      let dStart = i;
      let inParen = false;
      while (i < n) {
        const c = s[i];
        if (c === '(') inParen = true;
        else if (c === ')') inParen = false;
        else if (c === ',' && !inParen) break;
        i++;
      }
      descriptor = s.slice(dStart, i).trim();
      if (s[i] === ',') i++;
    }
    if (url.length > 0) out.push({ url, descriptor });
  }
  return out;
}

/* ================================================================== *
 * 6. extract — the public entry point
 * ================================================================== *
 *
 * Pull every reference out of a page and resolve each against the base URL
 * (overridden by any <base href> the document declares, per the HTML spec).
 * Returns links (anchors), images, and other assets, de-duplicated and
 * classified internal vs external against the base's host.
 */
function extract(html, baseUrl, { strict = true } = {}) {
  // First pass: honour <base href>. The first <base> with an href wins.
  let effectiveBase = baseUrl || '';
  forEachTag(html, (tag, attrs) => {
    if (tag === 'base' && attrs.href && effectiveBase === baseUrl) {
      effectiveBase = resolveUrl(baseUrl || '', attrs.href, { strict });
    }
  });

  const baseHost = hostOf(effectiveBase);
  const links = new Collector(effectiveBase, baseHost, strict);
  const images = new Collector(effectiveBase, baseHost, strict);
  const assets = new Collector(effectiveBase, baseHost, strict);

  forEachTag(html, (tag, attrs) => {
    if (tag === 'base') return; // a directive, consumed above — not a resource
    const spec = URL_ATTRS[tag];
    if (!spec) return;
    for (const attr of spec) {
      const raw = attrs[attr];
      if (raw === undefined || raw === '') continue;

      const values = SRCSET_ATTRS.has(attr)
        ? parseSrcset(raw).map((c) => c.url)
        : [raw];

      for (const v of values) {
        if (skipRef(v)) continue;
        const target = (tag === 'img' || tag === 'source' || attr === 'poster') ? images
          : (tag === 'a' || tag === 'area') ? links
          : assets;
        target.add(v, tag, attr);
      }
    }
  });

  return {
    base: effectiveBase,
    links: links.list(),
    images: images.list(),
    assets: assets.list(),
    counts: {
      links: links.size(),
      images: images.size(),
      assets: assets.size(),
    },
  };
}

/* References that are not fetchable URLs — fragments, javascript:, mailto:,
 * tel:, data:, blank — are skipped so they don't pollute the link list. */
function skipRef(ref) {
  const r = ref.trim();
  if (r === '' || r === '#') return true;
  if (r.startsWith('#')) return true; // same-page anchor
  return /^(javascript|mailto|tel|data|about|blob):/i.test(r);
}

class Collector {
  constructor(base, baseHost, strict) {
    this.base = base;
    this.baseHost = baseHost;
    this.strict = strict;
    this.seen = new Map(); // resolved URL → record
  }
  add(ref, tag, attr) {
    const resolved = this.base ? resolveUrl(this.base, ref, { strict: this.strict }) : ref;
    if (this.seen.has(resolved)) {
      this.seen.get(resolved).count++;
      return;
    }
    const host = hostOf(resolved);
    this.seen.set(resolved, {
      url: resolved,
      raw: ref,
      tag,
      attr,
      host,
      internal: this.baseHost ? host === this.baseHost : null,
      count: 1,
    });
  }
  list() { return [...this.seen.values()]; }
  size() { return this.seen.size; }
}

/* The host (authority minus any userinfo and port) of an absolute URL, lower-
 * cased, or '' if it has no authority. Used for internal/external tagging. */
function hostOf(url) {
  const { authority } = parseUri(url);
  if (authority === undefined) return '';
  let a = authority;
  const at = a.lastIndexOf('@');
  if (at !== -1) a = a.slice(at + 1);
  // Strip port, but not inside an IPv6 literal.
  if (a.startsWith('[')) {
    const close = a.indexOf(']');
    a = close === -1 ? a : a.slice(0, close + 1);
  } else {
    const colon = a.indexOf(':');
    if (colon !== -1) a = a.slice(0, colon);
  }
  return a.toLowerCase();
}

const API = {
  parseUri,
  recompose,
  removeDotSegments,
  resolveUrl,
  parseSrcset,
  forEachTag,
  parseAttrs,
  decodeEntities,
  extract,
  hostOf,
  skipRef,
  URL_ATTRS,
};

// Universal export: CommonJS under Node, a global under the browser. The same
// file backs the CLI, the tests, and index.html.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else if (typeof window !== 'undefined') {
  window.Scraper = API;
}
