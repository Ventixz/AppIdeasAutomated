// Bundled episode snapshot for the Podcast Directory app.
//
// In the original app-ideas spec, this data is produced at runtime by a
// Puppeteer scraper that walks each podcast's Podbean page (see scrape.js).
// A pure-browser app can't run Puppeteer and can't fetch podbean.com directly
// (cross-origin requests are blocked), so the browser app renders this
// snapshot instead. `scrape.js` produces data in exactly this shape, so the
// two stay interchangeable.
//
// Shape: { podcast, title, date (ISO yyyy-mm-dd), url }
window.PODCAST_EPISODES = [
  // --- JavaScript Jabber -------------------------------------------------
  { podcast: 'JavaScript Jabber', title: 'Signals and Fine-Grained Reactivity', date: '2024-05-14', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'The State of Build Tools in 2024', date: '2024-04-30', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'Testing Front-End Apps Without the Pain', date: '2024-04-16', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'TypeScript at Scale', date: '2024-04-02', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'Edge Functions and the New Server', date: '2024-03-19', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'Accessibility Is a Feature', date: '2024-03-05', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'Web Components, Revisited', date: '2024-02-20', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'Monorepos That Do not Hurt', date: '2024-02-06', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'Streaming SSR and Suspense', date: '2024-01-23', url: 'https://javascriptjabber.podbean.com/' },
  { podcast: 'JavaScript Jabber', title: 'Careers in Front-End', date: '2024-01-09', url: 'https://javascriptjabber.podbean.com/' },

  // --- Techpoint Charlie -------------------------------------------------
  { podcast: 'Techpoint Charlie', title: 'Building for the Next Billion Users', date: '2024-05-07', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'Fintech Beyond the Hype', date: '2024-04-23', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'Founders Who Ship on Weekends', date: '2024-04-09', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'Data Centers on the Continent', date: '2024-03-26', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'The Remote-First Startup', date: '2024-03-12', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'Hardware Is Hard', date: '2024-02-27', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'Payments, Rails, and Regulation', date: '2024-02-13', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'From Side Project to Series A', date: '2024-01-30', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'Open Source as a Business', date: '2024-01-16', url: 'https://techpointcharlie.podbean.com/' },
  { podcast: 'Techpoint Charlie', title: 'What Investors Actually Read', date: '2024-01-02', url: 'https://techpointcharlie.podbean.com/' },
];
