'use strict';

// All episodes come from the bundled snapshot in episodes.js. scrape.js can
// regenerate that file from live Podbean pages using Puppeteer.
const ALL_EPISODES = (window.PODCAST_EPISODES || []).slice();

// Distinct podcast names, in first-seen order.
const PODCASTS = ALL_EPISODES.reduce((names, ep) => {
  if (!names.includes(ep.podcast)) names.push(ep.podcast);
  return names;
}, []);

// Which podcasts are currently included in the table. Starts with all on.
const included = new Set(PODCASTS);

const summaryList = document.getElementById('summary-list');
const totalLine = document.getElementById('total-line');
const rowsBody = document.getElementById('episode-rows');
const emptyNote = document.getElementById('empty-note');

// Count episodes per podcast once — this never changes.
const countFor = (name) => ALL_EPISODES.filter((ep) => ep.podcast === name).length;

function formatDate(iso) {
  // iso is yyyy-mm-dd; render as e.g. "14 May 2024" without timezone drift.
  const [y, m, d] = iso.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${d} ${month} ${y}`;
}

function buildSummary() {
  PODCASTS.forEach((name, i) => {
    const li = document.createElement('li');
    li.className = 'summary-item';

    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.podcast = name;
    box.addEventListener('change', () => {
      if (box.checked) included.add(name);
      else included.delete(name);
      renderRows();
    });

    const swatch = document.createElement('span');
    swatch.className = `swatch swatch-${i}`;

    const text = document.createElement('span');
    text.className = 'summary-text';
    text.textContent = name;

    const count = document.createElement('span');
    count.className = 'count-pill';
    count.textContent = `${countFor(name)} episodes`;

    label.append(box, swatch, text, count);
    li.append(label);
    summaryList.append(li);
  });

  totalLine.textContent = `${ALL_EPISODES.length} episodes across ${PODCASTS.length} podcasts.`;
}

function renderRows() {
  const visible = ALL_EPISODES
    .filter((ep) => included.has(ep.podcast))
    // Newest first; combined across both podcasts.
    .sort((a, b) => b.date.localeCompare(a.date));

  rowsBody.textContent = '';
  emptyNote.hidden = visible.length !== 0;

  visible.forEach((ep) => {
    const tr = document.createElement('tr');
    tr.dataset.podcast = ep.podcast;

    // Clickable episode icon → opens the episode on Podbean.
    const iconCell = document.createElement('td');
    iconCell.className = 'col-icon';
    const link = document.createElement('a');
    link.href = ep.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'play-link';
    link.setAttribute('aria-label', `Open "${ep.title}" on Podbean`);
    link.title = 'Open on Podbean';
    link.textContent = '▶'; // ▶
    iconCell.append(link);

    const titleCell = document.createElement('td');
    titleCell.className = 'col-title';
    titleCell.textContent = ep.title;

    const podCell = document.createElement('td');
    const dot = document.createElement('span');
    dot.className = `swatch swatch-${PODCASTS.indexOf(ep.podcast)}`;
    podCell.append(dot, document.createTextNode(' ' + ep.podcast));

    const dateCell = document.createElement('td');
    dateCell.className = 'col-date';
    dateCell.textContent = formatDate(ep.date);

    tr.append(iconCell, titleCell, podCell, dateCell);
    rowsBody.append(tr);
  });
}

buildSummary();
renderRows();
