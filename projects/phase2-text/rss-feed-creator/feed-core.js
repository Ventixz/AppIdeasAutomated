/*
 * feed-core.js — the engine behind the RSS Feed Creator.
 *
 * karan/Projects asks, in one line, for a tool that is "given a link to an
 * RSS/Atom feed, get all posts and display them." The easy reading is "fetch a
 * URL and dump the <item> titles," and almost every tutorial stops there. But
 * the two words that carry the whole project are RSS *and* Atom: they are two
 * different XML vocabularies, with two different date formats, two different
 * link conventions, and a thicket of namespaced extensions (dc:, content:) that
 * real feeds lean on. The honest core is therefore a reader that:
 *
 *   1. PARSES XML by hand — no DOMParser, so it runs in Node and the test
 *      suite can fuzz it. CDATA, comments, processing instructions, numeric and
 *      named entities, self-closing tags and namespace prefixes are all handled,
 *      because real feeds in the wild contain every one of them.
 *
 *   2. NORMALISES RSS 2.0 *and* Atom 1.0 into ONE post model, so "get all
 *      posts" means the same shape regardless of which vocabulary the feed
 *      happens to speak: {title, link, id, date, author, summary, content}.
 *      pubDate (RFC-822) and <updated> (RFC-3339) both become a real Date;
 *      <guid>/<id>, <link>/<link href>, <description>/<summary>,
 *      content:encoded/<content> and <author>/dc:creator all land in the same
 *      field.
 *
 *   3. RE-EMITS a canonical RSS 2.0 feed — the "Creator" half — so the reader
 *      and the writer are inverses. That inverse is not a flourish: it is how
 *      the whole thing is VERIFIED. parseFeed(toRss(feed)) must return the feed
 *      it started from, over a large random fuzz, which pins the parser, the
 *      serialiser, the entity table and the two date formats all at once.
 *
 * Everything here is DOM-free and dependency-free, so it loads in Node (for
 * tests.js) and in the browser (for script.js) from the one file.
 */
"use strict";

(function (root) {

  /* ------------------------------------------------------------------ *
   * Errors                                                             *
   * ------------------------------------------------------------------ */

  function FeedError(message) {
    this.name = "FeedError";
    this.message = message;
  }
  FeedError.prototype = Object.create(Error.prototype);
  FeedError.prototype.constructor = FeedError;

  /* ------------------------------------------------------------------ *
   * XML entities                                                       *
   * ------------------------------------------------------------------ */

  var NAMED = {
    lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'"
  };

  // Decode the five predefined XML entities plus numeric character references.
  // Unknown named entities are left verbatim (XML without a DTD defines only
  // these five; leaving &nbsp; alone is more honest than guessing).
  function decodeEntities(s) {
    if (s.indexOf("&") === -1) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (whole, body) {
      if (body.charAt(0) === "#") {
        var cp;
        if (body.charAt(1) === "x" || body.charAt(1) === "X") {
          cp = parseInt(body.slice(2), 16);
        } else {
          cp = parseInt(body.slice(1), 10);
        }
        if (!isFinite(cp) || cp < 0 || cp > 0x10FFFF) return whole;
        try { return String.fromCodePoint(cp); } catch (e) { return whole; }
      }
      return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : whole;
    });
  }

  // Escape text for placement inside an element. Ampersand first, always.
  // Quotes are escaped too so the same routine is safe inside an attribute.
  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /* ------------------------------------------------------------------ *
   * A small, lenient XML parser                                        *
   *                                                                    *
   * Produces a tree of { name, local, attrs, children, text } nodes.   *
   * `local` is the name with any namespace prefix stripped, which is   *
   * how feeds are actually read (dc:creator and creator are the same   *
   * field to us). `text` is the concatenation of the element's direct  *
   * text and CDATA sections; child elements live in `children`.        *
   * ------------------------------------------------------------------ */

  function localName(name) {
    var c = name.indexOf(":");
    return c === -1 ? name : name.slice(c + 1);
  }

  function node(name) {
    return { name: name, local: localName(name), attrs: {}, children: [], text: "" };
  }

  var NAME_END = /[\s/>]/;
  var ATTR_NAME_END = /[\s=/>]/;
  var WS = /\s/;

  function readTag(src, lt) {
    var i = lt + 1, n = src.length;
    var start = i;
    while (i < n && !NAME_END.test(src.charAt(i))) i++;
    var name = src.slice(start, i);
    var attrs = {};
    var selfClose = false;
    while (i < n) {
      while (i < n && WS.test(src.charAt(i))) i++;
      if (i >= n) break;
      var c = src.charAt(i);
      if (c === "/") { selfClose = true; i++; continue; }
      if (c === ">") { i++; break; }
      var aStart = i;
      while (i < n && !ATTR_NAME_END.test(src.charAt(i))) i++;
      var aName = src.slice(aStart, i);
      while (i < n && WS.test(src.charAt(i))) i++;
      if (src.charAt(i) === "=") {
        i++;
        while (i < n && WS.test(src.charAt(i))) i++;
        var q = src.charAt(i);
        if (q === "\"" || q === "'") {
          i++;
          var vStart = i;
          while (i < n && src.charAt(i) !== q) i++;
          attrs[localName(aName)] = decodeEntities(src.slice(vStart, i));
          i++; // closing quote
        } else {
          var uStart = i;
          while (i < n && !/[\s>]/.test(src.charAt(i))) i++;
          attrs[localName(aName)] = decodeEntities(src.slice(uStart, i));
        }
      } else if (aName) {
        attrs[localName(aName)] = "";
      }
    }
    return { name: name, attrs: attrs, selfClose: selfClose, end: i };
  }

  function parseXml(src) {
    if (typeof src !== "string") throw new TypeError("parseXml expects a string");
    var n = src.length, i = 0;
    if (n && src.charCodeAt(0) === 0xFEFF) i = 1; // BOM
    var rootNode = node("#document");
    var stack = [rootNode];
    function top() { return stack[stack.length - 1]; }

    while (i < n) {
      var lt = src.indexOf("<", i);
      if (lt === -1) {
        top().text += decodeEntities(src.slice(i));
        break;
      }
      if (lt > i) top().text += decodeEntities(src.slice(i, lt));

      if (src.substr(lt, 4) === "<!--") {
        var ce = src.indexOf("-->", lt + 4);
        if (ce === -1) throw new FeedError("unterminated comment");
        i = ce + 3; continue;
      }
      if (src.substr(lt, 9) === "<![CDATA[") {
        var de = src.indexOf("]]>", lt + 9);
        if (de === -1) throw new FeedError("unterminated CDATA section");
        top().text += src.slice(lt + 9, de); // raw — CDATA is not entity-decoded
        i = de + 3; continue;
      }
      if (src.charAt(lt + 1) === "?") {
        var pe = src.indexOf("?>", lt + 2);
        if (pe === -1) throw new FeedError("unterminated processing instruction");
        i = pe + 2; continue;
      }
      if (src.charAt(lt + 1) === "!") { // <!DOCTYPE ...>
        var be = src.indexOf(">", lt + 2);
        if (be === -1) throw new FeedError("unterminated declaration");
        i = be + 1; continue;
      }
      if (src.charAt(lt + 1) === "/") { // closing tag
        var cte = src.indexOf(">", lt + 2);
        if (cte === -1) throw new FeedError("unterminated closing tag");
        var cname = localName(src.slice(lt + 2, cte).trim());
        // pop until we find a matching open (tolerant of stray/mismatched tags)
        for (var s = stack.length - 1; s >= 1; s--) {
          if (stack[s].local === cname) { stack.length = s; break; }
        }
        i = cte + 1; continue;
      }
      var tag = readTag(src, lt);
      var el = node(tag.name);
      el.attrs = tag.attrs;
      top().children.push(el);
      if (!tag.selfClose) stack.push(el);
      i = tag.end;
    }
    return rootNode;
  }

  /* ------------------------------------------------------------------ *
   * Tree helpers                                                       *
   * ------------------------------------------------------------------ */

  function firstElement(parent) {
    var kids = parent.children;
    return kids.length ? kids[0] : null;
  }

  function child(parent, local) {
    if (!parent) return null;
    var kids = parent.children;
    for (var k = 0; k < kids.length; k++) if (kids[k].local === local) return kids[k];
    return null;
  }

  function childrenNamed(parent, local) {
    var out = [];
    if (!parent) return out;
    var kids = parent.children;
    for (var k = 0; k < kids.length; k++) if (kids[k].local === local) out.push(kids[k]);
    return out;
  }

  // Trimmed text of a named child, or "" when absent.
  function leaf(parent, local) {
    var c = child(parent, local);
    return c ? c.text.trim() : "";
  }

  // First non-empty leaf among several candidate local names.
  function firstLeaf(parent, names) {
    for (var k = 0; k < names.length; k++) {
      var v = leaf(parent, names[k]);
      if (v) return v;
    }
    return "";
  }

  /* ------------------------------------------------------------------ *
   * Dates — RFC-822 (RSS) and RFC-3339 / ISO-8601 (Atom)               *
   * ------------------------------------------------------------------ */

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTH_INDEX = {};
  (function () { for (var m = 0; m < 12; m++) MONTH_INDEX[MONTHS[m].toLowerCase()] = m; })();

  // Named time zones RSS feeds still use, mapped to a minute offset from UTC.
  var ZONES = {
    ut: 0, gmt: 0, z: 0,
    est: -300, edt: -240, cst: -360, cdt: -300,
    mst: -420, mdt: -360, pst: -480, pdt: -420
  };

  function zoneOffsetMinutes(tz) {
    if (!tz) return 0;
    tz = tz.trim();
    var m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
    if (m) {
      var mins = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
      return m[1] === "-" ? -mins : mins;
    }
    var key = tz.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ZONES, key) ? ZONES[key] : null;
  }

  // RFC-822 / RFC-1123, e.g. "Wed, 02 Oct 2002 13:00:00 +0000" (day name and
  // seconds optional). Returns a Date or null.
  function parseRfc822(s) {
    var m = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[+-]\d{2}:\d{2}|[A-Za-z]{1,3})?\s*$/.exec(s.trim());
    if (!m) return null;
    var day = parseInt(m[1], 10);
    var mon = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    var year = parseInt(m[3], 10);
    if (m[3].length === 2) year += year < 70 ? 2000 : 1900;
    var hh = parseInt(m[4], 10), mm = parseInt(m[5], 10), ss = m[6] ? parseInt(m[6], 10) : 0;
    var off = zoneOffsetMinutes(m[7]);
    if (off === null) return null;
    var t = Date.UTC(year, mon, day, hh, mm, ss) - off * 60000;
    var d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }

  // RFC-3339 / ISO-8601, e.g. "2003-12-13T18:30:02Z" or "...+01:00".
  function parseRfc3339(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/.exec(s.trim());
    if (!m) return null;
    var off = zoneOffsetMinutes(m[8] || "Z");
    if (off === null) return null;
    var ms = m[7] ? parseInt((m[7] + "000").slice(0, 3), 10) : 0;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, ms) - off * 60000;
    var d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }

  // Try both; this is what the feed reader calls. Returns Date or null — a feed
  // with an unparseable date is still a valid feed, the date is just unknown.
  function parseDate(s) {
    if (!s) return null;
    return parseRfc822(s) || parseRfc3339(s);
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  // Canonical RSS pubDate, always in UTC: "Wed, 02 Oct 2002 13:00:00 +0000".
  function toRfc822(d) {
    return DAYS[d.getUTCDay()] + ", " + pad(d.getUTCDate()) + " " +
      MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear() + " " +
      pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" +
      pad(d.getUTCSeconds()) + " +0000";
  }

  /* ------------------------------------------------------------------ *
   * Feed parsing — RSS 2.0 and Atom 1.0 into one post model            *
   * ------------------------------------------------------------------ */

  function makePost(fields) {
    return {
      title: fields.title || "",
      link: fields.link || "",
      id: fields.id || fields.link || "",
      date: fields.date || null,
      dateText: fields.dateText || "",
      author: fields.author || "",
      summary: fields.summary || "",
      content: fields.content || ""
    };
  }

  function parseRss(rssEl) {
    var channel = child(rssEl, "channel");
    if (!channel) throw new FeedError("<rss> feed has no <channel>");
    var items = childrenNamed(channel, "item").map(function (item) {
      var dateText = firstLeaf(item, ["pubDate", "date"]); // date = dc:date
      var summary = leaf(item, "description");
      return makePost({
        title: leaf(item, "title"),
        link: leaf(item, "link"),
        id: leaf(item, "guid") || leaf(item, "link"),
        date: parseDate(dateText),
        dateText: dateText,
        author: firstLeaf(item, ["creator", "author"]), // creator = dc:creator
        summary: summary,
        content: leaf(item, "encoded") || summary // encoded = content:encoded
      });
    });
    return {
      kind: "rss",
      title: leaf(channel, "title"),
      link: leaf(channel, "link"),
      description: leaf(channel, "description"),
      posts: items
    };
  }

  // Atom <link>: prefer rel="alternate" (or a link with no rel), else the first.
  function atomLink(parent) {
    var links = childrenNamed(parent, "link");
    if (!links.length) return "";
    var best = null, fallback = null;
    for (var k = 0; k < links.length; k++) {
      var rel = links[k].attrs.rel || "";
      var href = links[k].attrs.href || "";
      if (!href) continue;
      if (rel === "alternate" || rel === "") { best = href; break; }
      if (!fallback) fallback = href;
    }
    return best || fallback || "";
  }

  // All text in a subtree, in no particular order (our node model keeps an
  // element's direct text separate from its children, so exact interleaving is
  // not preserved — but for pulling the words out of an xhtml construct that is
  // exactly what's wanted).
  function deepText(n) {
    var s = n.text;
    for (var k = 0; k < n.children.length; k++) s += deepText(n.children[k]);
    return s;
  }

  // Atom text constructs can carry type="html|xhtml"; the payload is either the
  // element's own text (text/html) or, for xhtml, nested markup (a <div> with
  // <p>s inside). Take the direct text if there is any, else all nested text.
  function atomText(parent, local) {
    var c = child(parent, local);
    if (!c) return "";
    var t = c.text.trim();
    return t || deepText(c).trim();
  }

  function parseAtom(feedEl) {
    var entries = childrenNamed(feedEl, "entry").map(function (entry) {
      var dateText = firstLeaf(entry, ["updated", "published", "issued", "modified"]);
      var summary = atomText(entry, "summary");
      var content = atomText(entry, "content");
      return makePost({
        title: atomText(entry, "title"),
        link: atomLink(entry),
        id: leaf(entry, "id") || atomLink(entry),
        date: parseDate(dateText),
        dateText: dateText,
        author: leaf(child(entry, "author"), "name"),
        summary: summary,
        content: content || summary
      });
    });
    return {
      kind: "atom",
      title: atomText(feedEl, "title"),
      link: atomLink(feedEl),
      description: atomText(feedEl, "subtitle"),
      posts: entries
    };
  }

  // The one entry point: XML string in, normalised feed out.
  function parseFeed(xml) {
    if (typeof xml !== "string") throw new TypeError("parseFeed expects a string");
    if (!xml.trim()) throw new FeedError("empty input — paste a feed's XML");
    var doc = parseXml(xml);
    var el = firstElement(doc);
    if (!el) throw new FeedError("no XML element found — is this a feed?");
    if (el.local === "rss") return parseRss(el);
    if (el.local === "feed") return parseAtom(el);
    if (el.local === "RDF") throw new FeedError("RSS 1.0 (RDF) is not supported — only RSS 2.0 and Atom 1.0");
    throw new FeedError("unrecognised feed: root <" + el.name + "> is neither <rss> nor <feed>");
  }

  function detectKind(xml) {
    try {
      var el = firstElement(parseXml(xml));
      if (!el) return null;
      if (el.local === "rss") return "rss";
      if (el.local === "feed") return "atom";
      return null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ *
   * Feed creation — emit a canonical RSS 2.0 document                  *
   *                                                                    *
   * This is the inverse of parseFeed for the fields the post model      *
   * carries, which is exactly what lets the test suite pin both at once *
   * with parseFeed(toRss(feed)) === feed.                               *
   * ------------------------------------------------------------------ */

  function tag(name, value) {
    if (value === "" || value == null) return "";
    return "    <" + name + ">" + escapeXml(value) + "</" + name + ">\n";
  }

  function toRss(feed) {
    feed = feed || {};
    var posts = feed.posts || [];
    var out = "";
    out += "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    out += "<rss version=\"2.0\" " +
      "xmlns:content=\"http://purl.org/rss/1.0/modules/content/\" " +
      "xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n";
    out += "  <channel>\n";
    out += "  " + tag("title", feed.title).trimStart();
    out += "  " + tag("link", feed.link).trimStart();
    out += "  " + tag("description", feed.description || " ").trimStart();
    for (var k = 0; k < posts.length; k++) {
      var p = posts[k];
      out += "    <item>\n";
      out += "  " + tag("title", p.title);
      out += "  " + tag("link", p.link);
      if (p.id) out += "      <guid isPermaLink=\"false\">" + escapeXml(p.id) + "</guid>\n";
      if (p.date instanceof Date && !isNaN(p.date.getTime())) {
        out += "      <pubDate>" + toRfc822(p.date) + "</pubDate>\n";
      }
      if (p.author) out += "      <dc:creator>" + escapeXml(p.author) + "</dc:creator>\n";
      if (p.summary) out += "      <description>" + escapeXml(p.summary) + "</description>\n";
      if (p.content && p.content !== p.summary) {
        out += "      <content:encoded>" + escapeXml(p.content) + "</content:encoded>\n";
      }
      out += "    </item>\n";
    }
    out += "  </channel>\n";
    out += "</rss>\n";
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Public API                                                         *
   * ------------------------------------------------------------------ */

  var API = {
    FeedError: FeedError,
    decodeEntities: decodeEntities,
    escapeXml: escapeXml,
    parseXml: parseXml,
    parseDate: parseDate,
    parseRfc822: parseRfc822,
    parseRfc3339: parseRfc3339,
    toRfc822: toRfc822,
    parseFeed: parseFeed,
    detectKind: detectKind,
    toRss: toRss
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  } else {
    root.FEED = API;
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
