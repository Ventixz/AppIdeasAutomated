// sample-data.js — a small bundled library of Podbean-shaped podcast records
// so MyPodcast Library works with zero configuration. These emulate what a
// Puppeteer scrape of Podbean would hand the engine: podcasts, each with a few
// recent episodes. Dates are fixed strings (no live clock) so the demo is
// deterministic. Icons are inline data-URI SVGs so nothing is fetched.
//
// Exposes SAMPLE_PODCASTS plus a tiny `find(url)` helper that emulates the
// "look up a podcast by its Podbean URL" step the real Add flow performs.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  else root.SampleData = api;                                             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // A tiny coloured-disc SVG icon, inlined so it needs no network.
  function icon(bg, ch) {
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>" +
      "<rect width='96' height='96' rx='18' fill='" + bg + "'/>" +
      "<text x='48' y='62' font-size='46' text-anchor='middle' " +
      "font-family='Arial, sans-serif' fill='white'>" + ch + "</text></svg>";
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  const SAMPLE_PODCASTS = [
    {
      id: 'signals',
      name: 'Signals & Noise',
      icon: icon('#4f46e5', '📡'),
      url: 'https://www.podbean.com/podcast-detail/signals-noise',
      episodes: [
        { id: 'sn-42', title: 'The Edge of Compute', date: '2026-08-24', url: 'https://www.podbean.com/ew/pb-sn42', hashtags: ['tech', 'hardware'] },
        { id: 'sn-41', title: 'What Latency Really Costs', date: '2026-08-17', url: 'https://www.podbean.com/ew/pb-sn41', hashtags: ['tech', 'networks'] },
        { id: 'sn-40', title: 'Rebuilding the Feed', date: '2026-08-10', url: 'https://www.podbean.com/ew/pb-sn40', hashtags: ['tech', 'design'] },
        { id: 'sn-39', title: 'A Year Without Passwords', date: '2026-07-06', url: 'https://www.podbean.com/ew/pb-sn39', hashtags: ['security'] },
      ],
    },
    {
      id: 'kitchen',
      name: 'Slow Kitchen',
      icon: icon('#e11d48', '🍲'),
      url: 'https://slowkitchen.podbean.com/',
      episodes: [
        { id: 'sk-18', title: 'Braises for a Long Week', date: '2026-08-22', url: 'https://www.podbean.com/ew/pb-sk18', hashtags: ['food', 'comfort'] },
        { id: 'sk-17', title: 'The Case for Anchovies', date: '2026-08-08', url: 'https://www.podbean.com/ew/pb-sk17', hashtags: ['food'] },
        { id: 'sk-16', title: 'Bread, Slowly', date: '2026-06-30', url: 'https://www.podbean.com/ew/pb-sk16', hashtags: ['food', 'baking'] },
      ],
    },
    {
      id: 'orbit',
      name: 'Low Orbit',
      icon: icon('#0891b2', '🛰️'),
      url: 'https://www.podbean.com/podcast-detail/low-orbit',
      episodes: [
        { id: 'lo-07', title: 'Mapping the Exoplanets', date: '2026-08-19', url: 'https://www.podbean.com/ew/pb-lo07', hashtags: ['space', 'science'] },
        { id: 'lo-06', title: 'The Long Wait for Light', date: '2026-08-05', url: 'https://www.podbean.com/ew/pb-lo06', hashtags: ['space'] },
        { id: 'lo-05', title: 'Rockets Nobody Remembers', date: '2026-07-15', url: 'https://www.podbean.com/ew/pb-lo05', hashtags: ['space', 'history'] },
      ],
    },
    {
      id: 'ledger',
      name: 'The Small Ledger',
      icon: icon('#16a34a', '📒'),
      url: 'https://smallledger.podbean.com/',
      episodes: [
        { id: 'tl-30', title: 'Pricing Without Fear', date: '2026-08-21', url: 'https://www.podbean.com/ew/pb-tl30', hashtags: ['business', 'money'] },
        { id: 'tl-29', title: 'The First Hire', date: '2026-08-12', url: 'https://www.podbean.com/ew/pb-tl29', hashtags: ['business'] },
        { id: 'tl-28', title: 'Invoices That Get Paid', date: '2026-07-28', url: 'https://www.podbean.com/ew/pb-tl28', hashtags: ['business', 'money'] },
      ],
    },
  ];

  const PodcastCore = (typeof require === 'function')
    ? require('./podcast-core.js')
    : (root.PodcastCore);

  // Emulate the "fetch a podcast by URL" step. Returns { ok, status, podcast }.
  function find(url) {
    const clean = PodcastCore ? PodcastCore.canonicalUrl(url) : String(url || '');
    const match = SAMPLE_PODCASTS.find((p) =>
      (PodcastCore ? PodcastCore.canonicalUrl(p.url) : p.url) === clean);
    if (match) {
      // Return a fresh deep-ish copy so callers can't mutate the sample.
      return { ok: true, status: 200, podcast: JSON.parse(JSON.stringify(match)) };
    }
    return { ok: false, status: 404, podcast: null };
  }

  function all() {
    return JSON.parse(JSON.stringify(SAMPLE_PODCASTS));
  }

  return { SAMPLE_PODCASTS, find, all };
});
