/*
 * script.js — the browser demo's glue. All the real work (parsing, resolving)
 * lives in scraper-core.js, shared with the Node CLI and the tests; this file
 * only wires the DOM to it and renders the results.
 */
'use strict';

(function () {
  const S = window.Scraper;
  const $ = (id) => document.getElementById(id);

  const baseInput = $('base');
  const htmlInput = $('html');
  const resultsEl = $('results');
  const summaryEl = $('summary');
  const panelEl = $('panel');
  const naiveToggle = $('naive');

  let current = null;       // last extract() result
  let activeTab = 'links';

  const SAMPLE = `<!DOCTYPE html>
<html>
<head>
  <base href="https://shop.example/catalog/">
  <link rel="stylesheet" href="../assets/site.css">
  <script src="//cdn.example/bundle.js"><\/script>
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="shoes/">Shoes</a>
    <a href="shoes/running?sort=price#reviews">Running shoes</a>
    <a href="../about">About us</a>
    <a href="https://blog.example/post/42">On our blog</a>
    <a href="#top">Back to top</a>
    <a href="mailto:hi@shop.example">Email us</a>
    <a href="/">Home (again)</a>
  </nav>
  <main>
    <img src="img/banner.png" alt="banner">
    <img src="img/logo.png"
         srcset="img/logo.png 1x, img/logo@2x.png 2x" alt="logo">
    <picture>
      <source srcset="img/hero-480.webp 480w, img/hero-960.webp 960w">
      <img src="img/hero.jpg" alt="hero">
    </picture>
  </main>
</body>
</html>`;

  function scrape() {
    if (!S) {
      summaryEl.textContent = 'Could not load scraper-core.js (open this page over a server, not file://, if your browser blocks local scripts).';
      resultsEl.hidden = false;
      return;
    }
    const base = baseInput.value.trim();
    const html = htmlInput.value;
    if (!html.trim()) { resultsEl.hidden = true; return; }

    current = S.extract(html, base);
    renderSummary(current, base);
    renderTab(activeTab);
    resultsEl.hidden = false;
  }

  function renderSummary(result, base) {
    const total = result.counts.links + result.counts.images + result.counts.assets;
    const rebased = result.base !== base
      ? ` A <code>&lt;base href&gt;</code> in the page overrode it to <code>${esc(result.base)}</code>.`
      : '';
    summaryEl.innerHTML =
      `Found <strong>${total}</strong> reference${total === 1 ? '' : 's'} ` +
      `(<strong>${result.counts.links}</strong> links, ` +
      `<strong>${result.counts.images}</strong> images, ` +
      `<strong>${result.counts.assets}</strong> other assets), ` +
      `each resolved against <code>${esc(base || '(none)')}</code>.${rebased}`;

    $('count-links').textContent = result.counts.links;
    $('count-images').textContent = result.counts.images;
    $('count-assets').textContent = result.counts.assets;
  }

  function renderTab(tab) {
    activeTab = tab;
    for (const b of document.querySelectorAll('#tabs button')) {
      b.classList.toggle('active', b.dataset.tab === tab);
    }
    if (!current) return;
    const list = current[tab];
    if (!list.length) {
      panelEl.innerHTML = '<p class="empty">No ' + tab + ' found.</p>';
      return;
    }
    const naive = naiveToggle.checked;
    const rows = list.map((rec) => {
      const cls = rec.internal === true ? 'int' : rec.internal === false ? 'ext' : 'none';
      const label = rec.internal === true ? 'internal' : rec.internal === false ? 'external' : '—';
      const repeat = rec.count > 1 ? `<span class="repeat">×${rec.count}</span>` : '';
      let naiveCell = '';
      if (naive) {
        const n = naiveJoin(current.base, rec.raw);
        const differs = n !== rec.url;
        naiveCell = `<div class="naive ${differs ? 'bad' : 'ok'}">`
          + `<span class="nlabel">base + href →</span> <code>${esc(n)}</code>`
          + (differs ? ' <span class="wrong">wrong</span>' : ' <span class="same">same</span>')
          + `</div>`;
      }
      return `<li class="row ${cls}">
        <div class="main">
          <span class="pill ${cls}">${label}</span>
          <a href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer">${esc(rec.url)}</a>
          ${repeat}
        </div>
        <div class="meta">from <code>&lt;${rec.tag} ${rec.attr}="${esc(rec.raw)}"&gt;</code></div>
        ${naiveCell}
      </li>`;
    }).join('');
    panelEl.innerHTML = `<ul class="rows">${rows}</ul>`;
  }

  // The naïve scraper everyone writes first: just glue the strings together.
  // Shown side by side so you can see exactly where it goes wrong.
  function naiveJoin(base, ref) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;        // already absolute
    if (ref.startsWith('//')) return ref;                    // protocol-relative (mangled anyway)
    return base + ref;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ---- events ---- */
  $('scrape').addEventListener('click', scrape);
  $('sample').addEventListener('click', () => {
    baseInput.value = 'https://shop.example/catalog/index.html';
    htmlInput.value = SAMPLE;
    scrape();
  });
  $('clear').addEventListener('click', () => {
    htmlInput.value = '';
    resultsEl.hidden = true;
    current = null;
  });
  naiveToggle.addEventListener('change', () => renderTab(activeTab));
  for (const b of document.querySelectorAll('#tabs button')) {
    b.addEventListener('click', () => renderTab(b.dataset.tab));
  }
  htmlInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') scrape();
  });

  // Load the sample on first visit so the page is never blank.
  baseInput.value = 'https://shop.example/catalog/index.html';
  htmlInput.value = SAMPLE;
  scrape();
})();
