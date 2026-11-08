# Page Scraper

> Source 2 (karan/Projects) · **Web** · project 1 of 9
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Page Scraper — Create an application that
connects to a site and pulls out all links, or images, and saves them to a
list. (web)"*

"Pull out all the links" sounds like a one-liner: find every `href`, done. It
isn't, and the reason is the thing a scraper spends almost all of its real
complexity on — **turning a reference into a usable URL**. The `href` you pull
out of a tag is almost never a URL you can fetch. It's `../about`, or `/logo.png`,
or `//cdn.example/app.js`, or `?page=2`, or `#top`. The job of a scraper is to
turn each of those into an absolute URL, and the string-concatenation version
everyone writes first gets it wrong in a dozen ways.

## The bug the naive version has

The first scraper everybody writes glues the base and the reference together:

```js
const url = baseUrl + href;   // base + "../about"  →  ".../catalog/../about"
```

Open the demo with **"Compare with naïve `base + href`"** ticked and you can
watch it fail in real time on an ordinary page:

| `<base href>` is `https://shop.example/catalog/` | `base + href` (naive) | correct (RFC 3986) |
| --- | --- | --- |
| `href="/"` | `https://shop.example/catalog//` ❌ | `https://shop.example/` |
| `href="../about"` | `https://shop.example/catalog/../about` ❌ | `https://shop.example/about` |
| `href="//cdn.example/x.js"` | `https://shop.example/catalog///cdn…` ❌ | `https://cdn.example/x.js` |
| `href="https://blog.example/"` | `…catalog/https://blog.example/` ❌ | `https://blog.example/` |

Every one of those is a link type that appears on virtually every real page.
A root-relative `/` href, a `../` that climbs a directory, a protocol-relative
CDN URL, an already-absolute external link — the naive join mangles all four,
and the "list of links" it saves is full of URLs that 404 or point nowhere.

## The fix is a real algorithm, not a bigger regex

Resolving a reference against a base is specified exactly, in **RFC 3986 §5**,
and `scraper-core.js` implements it as written:

- **§5.3 recompose / Appendix B parse** — split any reference into its five
  components (scheme, authority, path, query, fragment), keeping *absent*
  distinct from *present-but-empty* (`http://host` has no path but an empty
  authority), because the resolution rules switch on exactly that distinction.
- **§5.2.2 transform references** — the case analysis that decides, component by
  component, whether to take the reference's part or inherit the base's.
- **§5.2.3 merge** — splice a relative path onto the base's directory.
- **§5.2.4 remove_dot_segments** — the five-case loop that interprets `.` and
  `..`, so `a/b/../c` collapses to `a/c` and `../../../g` can't climb above the
  root. This is the step the naive version skips entirely.

Because it's the real algorithm, it passes the real test vectors — see below.

## Finding the references without a browser

The *other* half of a scraper is pulling the references out of markup when all
you have is tag soup, not a DOM. `scraper-core.js` walks the markup once and:

- reads URL-bearing attributes across the elements that actually carry them —
  `a/area[href]`, `img[src]`, `link[href]`, `script[src]`, `source[src]`,
  `iframe`, `video[poster]`, `form[action]`, and more (the map the HTML spec
  itself maintains);
- **skips the content of `<script>`, `<style>`, comments and CDATA**, so an
  `href="…"` sitting inside a JavaScript string is not mistaken for a link;
- **decodes entities** — `&amp;` above all, because `a?x=1&amp;y=2` must become
  `a?x=1&y=2` or every two-parameter query string comes out broken;
- honours a document's own **`<base href>`**, which overrides the fetch URL for
  resolution (the demo shows this: the page re-bases itself to `/catalog/`);
- parses **`srcset`** properly — it is *not* "split on commas", because a URL
  may contain a comma and the descriptor (`2x`, `640w`) is optional;
- is tolerant of unquoted and single-quoted attributes, and of a `>` sitting
  inside an attribute value (`title="1 > 0"` doesn't end the tag early).

Results come back **de-duplicated** (with a repeat count), **classified**
internal vs external against the base's host, and tagged with the source element
so you can see where each one came from.

## The tests are the RFC's own vectors

The centre of gravity of `tests.js` is not made-up cases — it's the canonical
**normal and abnormal example tables from RFC 3986 §5.4**, the exact vectors
every URL library is validated against:

```
base = http://a/b/c/d;p?q

  g           → http://a/b/c/g          ?y          → http://a/b/c/d;p?y
  ./g         → http://a/b/c/g          #s          → http://a/b/c/d;p?q#s
  /g          → http://a/g              ..          → http://a/b/
  //g         → http://g                ../../g     → http://a/g
  ../../../g  → http://a/g  (can't climb above root — abnormal §5.4.2)
  g;x=1/../y  → http://a/b/c/y          g?y/../x    → http://a/b/c/g?y/../x
```

A scraper that passes those is correct in exactly the way a scraper needs to be.
The naive `base + href` version fails about a third of them.

## Files

| file | what it is |
| --- | --- |
| `scraper-core.js` | the whole engine — RFC 3986 URL parse/resolve/`remove_dot_segments`, a tolerant tag/attribute scanner, `srcset` parsing, entity decoding, and `extract()` which ties them together. No network, no fs, no DOM. |
| `scraper-node.js` | the real I/O layer — fetches a URL over `http`/`https` (following redirects, resolving against the *post-redirect* URL), or reads a local HTML file, then prints or **saves the lists** to `links.txt` / `images.txt` / `assets.txt`. Zero dependencies. |
| `index.html` + `script.js` + `style.css` | a browser demo: paste markup and a base URL, see every reference resolved and classified, with a one-click **side-by-side against the naïve `base + href`** so you can watch it break. |
| `tests.js` | dependency-free checks anchored on the **RFC 3986 §5.4 vector tables**, plus `srcset`, entity decoding, `<base>` handling, dedup and internal/external classification. |

## Run it

**The browser demo** — open `index.html`. It loads a sample page on first view;
tick *Compare with naïve `base + href`* to see which links the naive scraper
gets wrong. (A browser can't fetch another site's HTML — the same-origin policy
blocks it — so the demo works on markup you paste. The resolving is the hard
part and is identical to what the server does.)

**The CLI** (Node, no dependencies):

```bash
# a built-in sample page, no network needed:
node scraper-node.js --demo

# scrape a live site and print the links:
node scraper-node.js https://example.com --only links

# fetch and SAVE the lists to a directory (links.txt, images.txt, assets.txt):
node scraper-node.js https://example.com --out ./scraped

# only same-host links; or only external:
node scraper-node.js https://example.com --only links --internal

# scrape a saved HTML file, giving the base it came from:
node scraper-node.js --file saved.html --base https://site.test/dir/ --json
```

**The tests:**

```bash
node tests.js
#  ✓ all 25 checks passing
```

## What this demonstrates about the web

Connecting to a site and reading the HTML is the easy, boring part — a dozen
lines of `https.get`. The part that makes a scraper *correct* is everything that
happens to the strings afterward: resolving each reference against the page's
base per a real specification, finding those references in markup that was never
as clean as the spec, and not being fooled by script bodies, entities, `srcset`
commas, or already-absolute URLs. Get the resolver right and the "save them to a
list" the task asks for is trivial. Get it wrong — reach for `base + href` — and
every list you save is quietly full of broken URLs.

---

*Part of a daily automated [Claude Code](https://claude.com/claude-code)
routine that builds one project per day. See the repository
[`README.md`](../../../README.md) and [`PROGRESS.md`](../../../PROGRESS.md).*
