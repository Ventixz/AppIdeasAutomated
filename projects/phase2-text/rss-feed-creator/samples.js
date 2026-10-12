/*
 * samples.js — a handful of real-shaped feeds, shared by the browser app and
 * the test suite so the parser is exercised against the same bytes in both.
 *
 * These are hand-written, not downloaded, so the app stays offline and
 * dependency-free. They deliberately cover the awkward bits a feed reader must
 * survive: CDATA, numeric and named entities, namespaced extensions
 * (dc:creator, content:encoded), both date formats, comments, and an Atom feed
 * whose <content> is xhtml wrapped in a <div>.
 */
"use strict";

(function (root) {

  var RSS_2_0 = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- a typical RSS 2.0 feed, with namespaced extensions -->',
    '<rss version="2.0"',
    '     xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    '     xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    '    <title>The Daily Widget</title>',
    '    <link>https://example.com/</link>',
    '    <description>News &amp; notes about widgets</description>',
    '    <item>',
    '      <title>Widgets &gt; Gadgets: the case for &amp;</title>',
    '      <link>https://example.com/posts/1</link>',
    '      <guid isPermaLink="false">tag:example.com,2026:1</guid>',
    '      <pubDate>Wed, 07 Oct 2026 09:30:00 +0000</pubDate>',
    '      <dc:creator>Ada Lovelace</dc:creator>',
    '      <description>A short summary with a &#8220;curly quote&#8221;.</description>',
    '      <content:encoded><![CDATA[<p>Full HTML body, where <b>a < b</b> & tags are literal.</p>]]></content:encoded>',
    '    </item>',
    '    <item>',
    '      <title>Second post</title>',
    '      <link>https://example.com/posts/2</link>',
    '      <guid isPermaLink="false">tag:example.com,2026:2</guid>',
    '      <pubDate>Tue, 06 Oct 2026 18:00:00 -0500</pubDate>',
    '      <dc:creator>Grace Hopper</dc:creator>',
    '      <description>No encoded content on this one.</description>',
    '    </item>',
    '  </channel>',
    '</rss>'
  ].join("\n");

  var ATOM_1_0 = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <title>Example Atom Feed</title>',
    '  <subtitle>Everything, in Atom</subtitle>',
    '  <link href="https://example.net/" rel="alternate"/>',
    '  <link href="https://example.net/feed.atom" rel="self"/>',
    '  <updated>2026-10-07T12:00:00Z</updated>',
    '  <entry>',
    '    <title>Atom handles dates differently</title>',
    '    <link rel="alternate" href="https://example.net/a"/>',
    '    <link rel="edit" href="https://example.net/a/edit"/>',
    '    <id>urn:uuid:aaaa-1111</id>',
    '    <published>2026-10-05T08:15:30Z</published>',
    '    <updated>2026-10-06T09:00:00+01:00</updated>',
    '    <author><name>Alan Turing</name><email>alan@example.net</email></author>',
    '    <summary>A plain-text summary.</summary>',
    '    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Rich content in a div.</p></div></content>',
    '  </entry>',
    '  <entry>',
    '    <title type="html">HTML title with &lt;tags&gt;</title>',
    '    <link href="https://example.net/b"/>',
    '    <id>urn:uuid:bbbb-2222</id>',
    '    <updated>2026-10-04T23:59:59Z</updated>',
    '    <author><name>Katherine Johnson</name></author>',
    '    <content>Inline content, no summary present.</content>',
    '  </entry>',
    '</feed>'
  ].join("\n");

  var SAMPLES = {
    rss: { label: "RSS 2.0 — The Daily Widget", xml: RSS_2_0 },
    atom: { label: "Atom 1.0 — Example Atom Feed", xml: ATOM_1_0 }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SAMPLES;
  } else {
    root.FEED_SAMPLES = SAMPLES;
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
