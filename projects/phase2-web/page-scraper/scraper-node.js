#!/usr/bin/env node
/*
 * scraper-node.js — the real I/O layer around scraper-core.js.
 *
 * This is the part the core deliberately does NOT do: connect to a site over
 * the network, read the HTML, and save the extracted lists to disk. It uses
 * only Node's built-in http/https modules — zero dependencies — and leans on
 * scraper-core for every bit of parsing and URL resolution, so the thing that
 * is actually hard (resolving references correctly) is shared with the browser
 * demo and the tests.
 *
 * Usage:
 *   node scraper-node.js <url> [options]
 *   node scraper-node.js --file page.html --base https://site.test/dir/ [options]
 *
 * Options:
 *   --out DIR         write links.txt / images.txt / assets.txt into DIR
 *   --only links|images|assets   print just that list
 *   --internal        keep only same-host URLs
 *   --external        keep only other-host URLs
 *   --json            emit the full structured result as JSON
 *   --max-redirects N follow up to N redirects (default 5)
 *   --demo            run against a built-in sample page, no network
 *
 * Examples:
 *   node scraper-node.js https://example.com --only links
 *   node scraper-node.js https://example.com --out ./scraped
 *   node scraper-node.js --file saved.html --base https://site.test/ --json
 *   node scraper-node.js --demo
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { extract } = require('./scraper-core.js');

/* ---- argument parsing ------------------------------------------------- */
function parseArgs(argv) {
  const opts = {
    url: null, file: null, base: null, out: null, only: null,
    internal: false, external: false, json: false, maxRedirects: 5, demo: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') opts.file = argv[++i];
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--only') opts.only = argv[++i];
    else if (a === '--internal') opts.internal = true;
    else if (a === '--external') opts.external = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--max-redirects') opts.maxRedirects = parseInt(argv[++i], 10);
    else if (a === '--demo') opts.demo = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!a.startsWith('-') && !opts.url) opts.url = a;
  }
  return opts;
}

/* ---- fetching --------------------------------------------------------- *
 * A minimal GET that follows redirects and only reads text/html-ish bodies.
 * Returns { finalUrl, status, body }. finalUrl is the URL after redirects —
 * crucial, because references must resolve against where the page actually
 * came from, not where we first asked.
 */
function fetchPage(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const visit = (current, redirectsLeft) => {
      let mod;
      try {
        mod = new URL(current).protocol === 'http:' ? http : https;
      } catch {
        return reject(new Error(`not a valid URL: ${current}`));
      }
      const req = mod.get(current, {
        headers: {
          // A generic client name. Do not leak the operator's identity.
          'User-Agent': 'page-scraper/1.0 (+https://github.com/karan/Projects)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      }, (res) => {
        const { statusCode, headers } = res;
        // Redirects.
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume(); // drain
          if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
          const next = new URL(headers.location, current).toString();
          return visit(next, redirectsLeft - 1);
        }
        if (statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} for ${current}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ finalUrl: current, status: statusCode, body }));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(new Error('request timed out')); });
    };
    visit(url, maxRedirects);
  });
}

/* ---- output ----------------------------------------------------------- */
function applyFilters(result, opts) {
  const keep = (rec) => {
    if (opts.internal && rec.internal === false) return false;
    if (opts.external && rec.internal === true) return false;
    return true;
  };
  return {
    ...result,
    links: result.links.filter(keep),
    images: result.images.filter(keep),
    assets: result.assets.filter(keep),
  };
}

function printHuman(result, opts) {
  const sections = opts.only
    ? [[opts.only, result[opts.only]]]
    : [['links', result.links], ['images', result.images], ['assets', result.assets]];

  console.log(`\nBase URL: ${result.base}`);
  for (const [name, list] of sections) {
    if (!list) continue;
    console.log(`\n${name.toUpperCase()} (${list.length})`);
    console.log('-'.repeat(name.length + 6));
    if (list.length === 0) { console.log('  (none)'); continue; }
    for (const rec of list) {
      const tag = rec.internal === true ? 'int' : rec.internal === false ? 'ext' : '  -';
      const repeat = rec.count > 1 ? `  (×${rec.count})` : '';
      console.log(`  [${tag}] ${rec.url}${repeat}`);
    }
  }
  console.log('');
}

function writeLists(result, dir, opts) {
  fs.mkdirSync(dir, { recursive: true });
  const sections = opts.only
    ? [[opts.only, result[opts.only]]]
    : [['links', result.links], ['images', result.images], ['assets', result.assets]];
  const written = [];
  for (const [name, list] of sections) {
    if (!list) continue;
    const file = path.join(dir, `${name}.txt`);
    fs.writeFileSync(file, list.map((r) => r.url).join('\n') + (list.length ? '\n' : ''));
    written.push(`${file}  (${list.length})`);
  }
  console.log(`\nWrote:\n  ${written.join('\n  ')}\n`);
}

/* ---- a self-contained demo page (no network needed) ------------------- */
const DEMO_HTML = `<!DOCTYPE html>
<html><head>
  <title>Demo</title>
  <base href="https://shop.example/catalog/">
  <link rel="stylesheet" href="../assets/site.css">
  <script src="//cdn.example/bundle.js"></script>
</head><body>
  <nav>
    <a href="/">Home</a>
    <a href="shoes/">Shoes</a>
    <a href="shoes/running?sort=price">Running (sorted)</a>
    <a href="../about">About</a>
    <a href="https://blog.example/post/1">Blog (external)</a>
    <a href="#top">Back to top</a>
    <a href="mailto:hi@shop.example">Contact</a>
  </nav>
  <main>
    <img src="img/banner.png" alt="banner">
    <img src="img/logo.png" srcset="img/logo-1x.png 1x, img/logo-2x.png 2x" alt="logo">
    <picture>
      <source srcset="img/hero-480.webp 480w, img/hero-960.webp 960w" type="image/webp">
      <img src="img/hero.jpg" alt="hero">
    </picture>
    <a href="/">Home again</a>
  </main>
</body></html>`;

/* ---- main ------------------------------------------------------------- */
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || (!opts.url && !opts.file && !opts.demo)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 34).join('\n').replace(/^ \* ?/gm, ''));
    return;
  }

  let html, base;

  if (opts.demo) {
    html = DEMO_HTML;
    base = 'https://shop.example/catalog/index.html';
    console.log('(demo mode — using a built-in sample page, no network)');
  } else if (opts.file) {
    html = fs.readFileSync(opts.file, 'utf8');
    base = opts.base || 'file://' + path.resolve(opts.file);
  } else {
    process.stderr.write(`Fetching ${opts.url} ...\n`);
    const res = await fetchPage(opts.url, opts.maxRedirects);
    html = res.body;
    base = res.finalUrl; // resolve against the post-redirect URL
    if (res.finalUrl !== opts.url) process.stderr.write(`  (redirected to ${res.finalUrl})\n`);
  }

  let result = extract(html, base);
  result = applyFilters(result, opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.out) {
    writeLists(result, opts.out, opts);
  } else {
    printHuman(result, opts);
  }
}

main().catch((err) => {
  console.error('Error: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
