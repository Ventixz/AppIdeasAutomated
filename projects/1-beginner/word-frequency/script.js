"use strict";

const form = document.getElementById("form");
const textEl = document.getElementById("text");
const usedEl = document.getElementById("used");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const summaryEl = document.getElementById("summary");
const chartEl = document.getElementById("chart");
const rowsEl = document.getElementById("rows");
const clearBtn = document.getElementById("clear");
const urlEl = document.getElementById("url");
const fetchBtn = document.getElementById("fetch");

// Show at most this many bars in the visual chart to keep it readable.
const MAX_BARS = 12;

function setStatus(message, kind) {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// Split into words: keep letters, digits and internal apostrophes/hyphens,
// lowercase everything, drop empties. "Don't" and "don't" count as one word.
function tally(text) {
  const counts = new Map();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);

  for (const word of words) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  // Sort by count descending, then alphabetically for stable ties.
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  return { sorted, total: words.length };
}

function renderChart(sorted) {
  chartEl.innerHTML = "";
  const top = sorted.slice(0, MAX_BARS);
  if (!top.length) return;
  const max = top[0][1];

  for (const [word, count] of top) {
    const row = document.createElement("div");
    row.className = "bar-row";

    const label = document.createElement("span");
    label.className = "bar-word";
    label.textContent = word;

    const track = document.createElement("div");
    track.className = "bar-track";

    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = (count / max) * 100 + "%";

    const val = document.createElement("span");
    val.className = "bar-val";
    val.textContent = count;

    track.append(fill, val);
    row.append(label, track);
    chartEl.append(row);
  }
}

function renderTable(sorted) {
  rowsEl.innerHTML = "";
  sorted.forEach(([word, count], i) => {
    const tr = document.createElement("tr");

    const rank = document.createElement("td");
    rank.className = "rank";
    rank.textContent = i + 1;

    const w = document.createElement("td");
    w.textContent = word;

    const c = document.createElement("td");
    c.className = "num";
    c.textContent = count;

    tr.append(rank, w, c);
    rowsEl.append(tr);
  });
}

function analyze() {
  const text = textEl.value.trim();
  if (!text) {
    resultsEl.hidden = true;
    setStatus("Please enter some text to analyze.", "error");
    textEl.focus();
    return;
  }

  const { sorted, total } = tally(text);
  if (!sorted.length) {
    resultsEl.hidden = true;
    setStatus("No words found — try adding some letters or numbers.", "error");
    return;
  }

  summaryEl.innerHTML =
    `<strong>${total}</strong> word${total === 1 ? "" : "s"} · ` +
    `<strong>${sorted.length}</strong> unique · ` +
    `most frequent: <strong>${sorted[0][0]}</strong> (${sorted[0][1]}×)`;

  renderChart(sorted);
  renderTable(sorted);
  resultsEl.hidden = false;
  setStatus("");
}

// --- Bonus: pull the visible text from a web page URL ---------------------
async function fetchUrl() {
  const url = urlEl.value.trim();
  if (!url) {
    setStatus("Enter a URL to fetch.", "error");
    return;
  }

  fetchBtn.disabled = true;
  setStatus("Fetching page…");
  // A public CORS-friendly reader proxy; the browser can't hit arbitrary
  // origins directly. If it's unavailable, we fail gracefully.
  const proxy = "https://r.jina.ai/" + url;

  try {
    const res = await fetch(proxy);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const body = await res.text();
    textEl.value = body.slice(0, 2048);
    updateCount();
    setStatus("Page loaded — press Translate to analyze.", "ok");
  } catch (err) {
    setStatus(
      "Couldn't fetch that page (network or CORS). Paste the text manually instead.",
      "error"
    );
  } finally {
    fetchBtn.disabled = false;
  }
}

function updateCount() {
  usedEl.textContent = textEl.value.length;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  analyze();
});

clearBtn.addEventListener("click", () => {
  textEl.value = "";
  urlEl.value = "";
  updateCount();
  resultsEl.hidden = true;
  setStatus("");
  textEl.focus();
});

textEl.addEventListener("input", updateCount);
fetchBtn.addEventListener("click", fetchUrl);

updateCount();
