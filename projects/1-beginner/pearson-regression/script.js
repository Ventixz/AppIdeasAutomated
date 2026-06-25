"use strict";

// ---- State ---------------------------------------------------------------
/** @type {{x:number,y:number}[]} */
const points = [];

const els = {
  form: document.getElementById("point-form"),
  x: document.getElementById("x"),
  y: document.getElementById("y"),
  error: document.getElementById("error"),
  calculate: document.getElementById("calculate"),
  sample: document.getElementById("sample"),
  clear: document.getElementById("clear"),
  file: document.getElementById("file"),
  body: document.getElementById("data-body"),
  count: document.getElementById("count"),
  emptyTable: document.getElementById("empty-table"),
  results: document.getElementById("results"),
  resultsEmpty: document.getElementById("results-empty"),
  meanX: document.getElementById("mean-x"),
  meanY: document.getElementById("mean-y"),
  stdX: document.getElementById("std-x"),
  stdY: document.getElementById("std-y"),
  coefficient: document.getElementById("coefficient"),
  interpretation: document.getElementById("interpretation"),
  chart: document.getElementById("chart"),
  chartCaption: document.getElementById("chart-caption"),
};

// ---- Statistics (implemented by hand, no libraries) ----------------------
const mean = (nums) => nums.reduce((a, b) => a + b, 0) / nums.length;

// Population standard deviation: sqrt(mean of squared deviations).
function stdDev(nums, avg = mean(nums)) {
  const variance =
    nums.reduce((sum, n) => sum + (n - avg) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * Pearson correlation coefficient:
 *   r = Σ(xi - x̄)(yi - ȳ) / sqrt( Σ(xi - x̄)² · Σ(yi - ȳ)² )
 * Returns null when either variable has no spread (division by zero).
 */
function pearson(xs, ys, meanX = mean(xs), meanY = mean(ys)) {
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? null : cov / denom;
}

function interpret(r) {
  if (r === null) {
    return "undefined — one variable doesn't vary, so correlation can't be measured.";
  }
  const a = Math.abs(r);
  const dir = r > 0 ? "positive" : "negative";
  if (a < 0.1) return "essentially no linear correlation.";
  if (a < 0.4) return `weak ${dir} correlation.`;
  if (a < 0.7) return `moderate ${dir} correlation.`;
  if (a < 0.9) return `strong ${dir} correlation.`;
  return `very strong ${dir} correlation.`;
}

const fmt = (n) =>
  Number.isFinite(n) ? Number(n.toFixed(4)).toString() : "—";

// ---- Parsing & validation ------------------------------------------------
function parseNumber(raw) {
  const trimmed = String(raw).trim();
  if (trimmed === "") return NaN;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
}

function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
}

// ---- Rendering -----------------------------------------------------------
function render() {
  els.body.innerHTML = "";
  points.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${i + 1}</td>` +
      `<td>${p.x}</td>` +
      `<td>${p.y}</td>` +
      `<td><button class="row-remove" type="button" data-i="${i}" aria-label="Remove row ${i + 1}">×</button></td>`;
    els.body.appendChild(tr);
  });

  els.count.textContent = `(${points.length})`;
  els.emptyTable.hidden = points.length > 0;

  const ready = points.length >= 2;
  els.calculate.disabled = !ready;
  els.clear.disabled = points.length === 0;
}

function addPoint(x, y) {
  points.push({ x, y });
  render();
}

// ---- Calculation ---------------------------------------------------------
function calculate() {
  if (points.length < 2) return;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const mx = mean(xs);
  const my = mean(ys);
  const r = pearson(xs, ys, mx, my);

  els.meanX.textContent = fmt(mx);
  els.meanY.textContent = fmt(my);
  els.stdX.textContent = fmt(stdDev(xs, mx));
  els.stdY.textContent = fmt(stdDev(ys, my));

  els.coefficient.textContent = r === null ? "n/a" : fmt(r);
  els.interpretation.textContent = interpret(r);

  els.results.hidden = false;
  els.resultsEmpty.hidden = true;

  drawChart(xs, ys, mx, my, r);
}

// ---- Scatter plot + regression line (bonus) ------------------------------
function drawChart(xs, ys, mx, my, r) {
  const c = els.chart;
  const ctx = c.getContext("2d");
  const W = c.width;
  const H = c.height;
  const pad = 44;

  ctx.clearRect(0, 0, W, H);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const sx = (x) => pad + ((x - minX) / spanX) * (W - pad * 2);
  const sy = (y) => H - pad - ((y - minY) / spanY) * (H - pad * 2);

  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue("--line").trim() || "#3b4061";
  const accent = css.getPropertyValue("--accent").trim() || "#7aa2f7";
  const good = css.getPropertyValue("--good").trim() || "#9ece6a";
  const muted = css.getPropertyValue("--muted").trim() || "#7a82ab";

  // Axes
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, H - pad);
  ctx.lineTo(W - pad, H - pad);
  ctx.stroke();

  ctx.fillStyle = muted;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(minX.toString(), pad, H - pad + 16);
  ctx.fillText(maxX.toString(), W - pad - 18, H - pad + 16);
  ctx.fillText(maxY.toString(), 6, pad + 4);
  ctx.fillText(minY.toString(), 6, H - pad);

  // Regression line via least squares: slope b = r * (σy / σx), through (x̄, ȳ).
  if (r !== null) {
    const sdX = stdDev(xs, mx);
    const sdY = stdDev(ys, my);
    const b = r * (sdY / sdX);
    const a = my - b * mx;
    const yAt = (x) => a + b * x;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(minX), sy(yAt(minX)));
    ctx.lineTo(sx(maxX), sy(yAt(maxX)));
    ctx.stroke();
  }

  // Points
  ctx.fillStyle = good;
  for (let i = 0; i < xs.length; i++) {
    ctx.beginPath();
    ctx.arc(sx(xs[i]), sy(ys[i]), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  els.chartCaption.textContent =
    r === null
      ? `${xs.length} points plotted. Regression line omitted (no spread in one variable).`
      : `${xs.length} points plotted with the least-squares regression line (r = ${fmt(r)}).`;
}

// ---- File upload (bonus): parse two-column CSV / whitespace data ----------
function ingestText(text) {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const parsed = [];
  let skipped = 0;
  for (const row of rows) {
    const parts = row.split(/[,;\t ]+/);
    if (parts.length < 2) {
      skipped++;
      continue;
    }
    const x = parseNumber(parts[0]);
    const y = parseNumber(parts[1]);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      skipped++; // header rows and junk land here
      continue;
    }
    parsed.push({ x, y });
  }

  if (parsed.length === 0) {
    showError("No numeric x,y pairs found in that file.");
    return;
  }
  clearError();
  parsed.forEach((p) => points.push(p));
  render();
  if (skipped > 0) {
    showError(`Loaded ${parsed.length} points (${skipped} non-numeric line(s) skipped).`);
  }
}

// ---- Events --------------------------------------------------------------
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const x = parseNumber(els.x.value);
  const y = parseNumber(els.y.value);
  if (Number.isNaN(x) || Number.isNaN(y)) {
    showError("Both x and y must be valid numbers.");
    return;
  }
  clearError();
  addPoint(x, y);
  els.x.value = "";
  els.y.value = "";
  els.x.focus();
});

els.body.addEventListener("click", (e) => {
  const btn = e.target.closest(".row-remove");
  if (!btn) return;
  points.splice(Number(btn.dataset.i), 1);
  render();
});

els.calculate.addEventListener("click", calculate);

els.clear.addEventListener("click", () => {
  points.length = 0;
  render();
  els.results.hidden = true;
  els.resultsEmpty.hidden = false;
  els.chartCaption.textContent =
    "Scatter plot & regression line appear after you calculate.";
  const ctx = els.chart.getContext("2d");
  ctx.clearRect(0, 0, els.chart.width, els.chart.height);
  clearError();
});

els.sample.addEventListener("click", () => {
  // Hours studied vs. exam score — a clear positive correlation.
  const sample = [
    [1, 52], [2, 58], [3, 61], [4, 67], [5, 71],
    [6, 74], [7, 80], [8, 83], [9, 88], [10, 95],
  ];
  points.length = 0;
  sample.forEach(([x, y]) => points.push({ x, y }));
  clearError();
  render();
  calculate();
});

els.file.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => ingestText(String(reader.result));
  reader.onerror = () => showError("Couldn't read that file.");
  reader.readAsText(file);
  e.target.value = ""; // allow re-uploading the same file
});

// Initial paint
render();

// Expose pure helpers for quick console/sanity checks.
window.__pearson = { mean, stdDev, pearson, interpret };
