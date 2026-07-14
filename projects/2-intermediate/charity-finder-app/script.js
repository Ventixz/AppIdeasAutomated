"use strict";

const charities = window.CHARITIES || [];

const splash = document.getElementById("splash");
const finder = document.getElementById("finder");
const getStarted = document.getElementById("get-started");

const form = document.getElementById("search-form");
const nameSel = document.getElementById("f-name");
const homeSel = document.getElementById("f-home");
const servesSel = document.getElementById("f-serves");
const themeSel = document.getElementById("f-theme");
const resetBtn = document.getElementById("reset");

const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const dialog = document.getElementById("project-dialog");
const projectBody = document.getElementById("project-body");

// --- Populate the dropdown filters from the data --------------------------

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function addOptions(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function buildFilters() {
  addOptions(
    nameSel,
    charities.map((c) => c.name).sort((a, b) => a.localeCompare(b))
  );
  addOptions(homeSel, uniqueSorted(charities.map((c) => c.home)));
  addOptions(servesSel, uniqueSorted(charities.flatMap((c) => c.serves)));
  addOptions(themeSel, uniqueSorted(charities.flatMap((c) => c.themes)));
}

// --- Filtering ------------------------------------------------------------

function matches(charity) {
  if (nameSel.value && charity.name !== nameSel.value) return false;
  if (homeSel.value && charity.home !== homeSel.value) return false;
  if (servesSel.value && !charity.serves.includes(servesSel.value)) return false;
  if (themeSel.value && !charity.themes.includes(themeSel.value)) return false;
  return true;
}

function search() {
  const found = charities.filter(matches);
  render(found);
}

// --- Rendering ------------------------------------------------------------

function render(list) {
  resultsEl.innerHTML = "";

  if (list.length === 0) {
    setStatus("No charities match those filters. Try clearing one.", "empty");
    return;
  }

  setStatus(
    `Showing ${list.length} ${list.length === 1 ? "charity" : "charities"}.`
  );

  for (const charity of list) {
    resultsEl.append(card(charity));
  }
}

function card(charity) {
  const el = document.createElement("article");
  el.className = "card";

  const themes = charity.themes
    .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
    .join("");

  el.innerHTML = `
    <a class="card__logo" href="${escapeAttr(charity.website)}"
       target="_blank" rel="noopener" title="Visit ${escapeAttr(charity.name)}">
      <img src="${charity.logo}" alt="${escapeAttr(charity.name)} logo" />
    </a>
    <div class="card__body">
      <p class="card__id">#${charity.id}</p>
      <h3 class="card__name">
        <a href="${escapeAttr(charity.website)}" target="_blank" rel="noopener">
          ${escapeHtml(charity.name)}
        </a>
      </h3>
      <p class="card__address">${escapeHtml(charity.address)}</p>
      <p class="card__mission">${escapeHtml(charity.mission)}</p>
      <div class="card__themes">${themes}</div>
      <div class="card__meta">
        <span><strong>Home:</strong> ${escapeHtml(charity.home)}</span>
        <span><strong>Serves:</strong> ${escapeHtml(charity.serves.join(", "))}</span>
      </div>
    </div>
    <div class="card__actions">
      <a class="btn btn--primary" href="${escapeAttr(charity.website)}"
         target="_blank" rel="noopener">Visit website</a>
      <button class="btn" type="button" data-project="${charity.id}">
        View project
      </button>
    </div>
  `;

  el.querySelector("[data-project]").addEventListener("click", () =>
    openProject(charity)
  );

  return el;
}

// --- Project detail dialog (bonus) ----------------------------------------

function openProject(charity) {
  const p = charity.project;
  const pct = Math.min(100, Math.round((p.raised / p.goal) * 100));

  projectBody.innerHTML = `
    <p class="dialog__org">${escapeHtml(charity.name)} · #${charity.id}</p>
    <h2 class="dialog__title">${escapeHtml(p.title)}</h2>
    <p class="dialog__summary">${escapeHtml(p.summary)}</p>
    <div class="progress" role="img"
         aria-label="${pct}% of goal funded">
      <div class="progress__bar" style="width:${pct}%"></div>
    </div>
    <p class="dialog__funding">
      <strong>${money(p.raised)}</strong> raised of ${money(p.goal)} goal
      <span class="dialog__pct">(${pct}%)</span>
    </p>
    <a class="btn btn--primary" href="${escapeAttr(charity.website)}"
       target="_blank" rel="noopener">Support this project</a>
  `;

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

dialog.addEventListener("click", (event) => {
  // click on backdrop or the close button
  if (event.target === dialog || event.target.hasAttribute("data-close")) {
    dialog.close();
  }
});

// --- Helpers --------------------------------------------------------------

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = "status" + (kind ? ` status--${kind}` : "");
}

function money(n) {
  return "$" + n.toLocaleString("en-US");
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch]
  );
}

function escapeAttr(str) {
  return escapeHtml(str);
}

// --- Wire up --------------------------------------------------------------

getStarted.addEventListener("click", () => {
  splash.hidden = true;
  finder.hidden = false;
  search();
  finder.scrollIntoView({ behavior: "smooth" });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  search();
});

resetBtn.addEventListener("click", () => {
  // let the native reset clear the selects first, then re-render
  setTimeout(search, 0);
});

buildFilters();
