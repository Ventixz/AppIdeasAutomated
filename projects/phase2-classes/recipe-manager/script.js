/*
 * script.js — the browser front end. It does no recipe logic of its own: every
 * amount, scale, index lookup and "can I make it?" verdict comes from the exact
 * same classes in recipe-core.js that the CLI and the tests use. This file only
 * reads the DOM, calls the engine, and paints the result.
 */
'use strict';

(function () {
const core = window.RecipeManager;
const { RecipeError } = core;

/* ---- state ---------------------------------------------------------- */

let book = window.RecipeFixtures.buildCookbook(core);
let pantry = window.RecipeFixtures.buildPantry(core);
let view = 'category';          // 'category' | 'main'
let filter = '';
let selectedId = null;
let scaleServings = null;       // the serving count the detail panel is showing

const $ = (id) => document.getElementById(id);

/* ---- which recipes match the current filter ------------------------- */

function filteredRecipes() {
  if (!filter) return book.all();
  const q = filter.trim().toLowerCase();
  // match on title OR any ingredient name — the two things a cook searches by.
  return book.all().filter((r) =>
    r.title.toLowerCase().includes(q) || r.ingredientKeys().some((k) => k.includes(q)));
}

function groupsFor(recipes) {
  const keyOf = (r) => (view === 'category' ? r.category : r.mainIngredient);
  const map = new Map();
  for (const r of recipes.sort((a, b) => keyOf(a).localeCompare(keyOf(b)) || a.title.localeCompare(b.title))) {
    if (!map.has(keyOf(r))) map.set(keyOf(r), []);
    map.get(keyOf(r)).push(r);
  }
  return map;
}

/* ---- rendering ------------------------------------------------------ */

function renderTiles() {
  $('t-recipes').textContent = book.size;
  $('t-cats').textContent = book.categories().length;
  $('t-ings').textContent = book.ingredientsUsed().length;
  $('t-make').textContent = book.makeable(pantry).length;
}

function renderBrowser() {
  const recipes = filteredRecipes();
  $('browse-count').textContent = `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`;
  const host = $('browser');
  host.innerHTML = '';
  if (!recipes.length) { host.innerHTML = '<p class="empty">No recipes match that filter.</p>'; return; }

  for (const [label, rs] of groupsFor(recipes)) {
    const group = document.createElement('div');
    group.className = 'group';
    const head = document.createElement('div');
    head.className = 'group-head';
    head.textContent = `${label}  ·  ${rs.length}`;
    group.appendChild(head);
    for (const r of rs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'recipe-chip' + (r.id === selectedId ? ' active' : '');
      chip.innerHTML = `<span>${escapeHtml(r.title)}</span>` +
        `<span class="meta">serves ${r.servings} · ${escapeHtml(r.mainIngredient)}</span>`;
      chip.addEventListener('click', () => select(r.id));
      group.appendChild(chip);
    }
    host.appendChild(group);
  }
}

function renderDetail() {
  const host = $('detail');
  if (!selectedId || !book.has(selectedId)) {
    host.className = 'detail-empty';
    host.textContent = 'Pick a recipe on the left to see it here.';
    return;
  }
  const base = book.get(selectedId);
  const servings = scaleServings || base.servings;
  const shown = servings === base.servings ? base : base.scaleToServings(servings);

  host.className = 'detail';
  const scaled = servings !== base.servings;
  host.innerHTML = `
    <h2>${escapeHtml(base.title)}</h2>
    <div class="sub">
      <span class="tag">${escapeHtml(base.category)}</span>
      <span class="tag">main: ${escapeHtml(base.mainIngredient)}</span>
      written for ${base.servings} serving${base.servings === 1 ? '' : 's'}
    </div>
    <div class="scaler">
      <span class="label" style="margin:0">Scale to</span>
      <button type="button" class="step" id="s-minus">−</button>
      <input class="n" id="s-input" value="${servings}" />
      <button type="button" class="step" id="s-plus">+</button>
      <span class="note">serving${servings === 1 ? '' : 's'}${scaled ? ` · ×${ratioLabel(servings, base.servings)}, exact` : ''}</span>
    </div>
    <h3>Ingredients</h3>
    <ul class="ing-list">${shown.ingredients.map(ingLi).join('')}</ul>
    ${shown.instructions.length ? `<h3>Instructions</h3><ol class="steps">${shown.instructions.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
  `;

  const setServ = (n) => { scaleServings = Math.max(1, n | 0); renderDetail(); };
  $('s-minus').addEventListener('click', () => setServ(servings - 1));
  $('s-plus').addEventListener('click', () => setServ(servings + 1));
  $('s-input').addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10);
    if (Number.isInteger(n) && n >= 1) setServ(n); else renderDetail();
  });
}

function ingLi(ing) {
  const amt = ing.quantity
    ? `<span class="amt">${escapeHtml(ing.quantity.toString())}</span>`
    : `<span class="amt taste">to taste</span>`;
  const note = ing.note ? `<span class="note">(${escapeHtml(ing.note)})</span>` : '';
  return `<li>${amt}<span>${escapeHtml(ing.item)}</span>${note}</li>`;
}

function renderMake() {
  const rows = $('make-rows');
  rows.innerHTML = '';
  for (const res of book.whatCanIMake(pantry)) {
    const tr = document.createElement('tr');
    const blockers = res.blockers.map((b) => {
      if (b.reason === 'missing') return `<span class="miss">no ${escapeHtml(b.item)}</span>`;
      if (b.reason === 'short') return `<span class="short">only ${escapeHtml(b.have.toString())} ${escapeHtml(b.item)} (need ${escapeHtml(b.need.toString())})</span>`;
      if (b.reason === 'incomparable') return `<span class="inc">${escapeHtml(b.item)}: can't compare units</span>`;
      return escapeHtml(b.item);
    }).join(', ');
    tr.innerHTML =
      `<td>${escapeHtml(res.recipe.title)}</td>` +
      `<td class="${res.ok ? 'verdict-yes' : 'verdict-no'}">${res.ok ? '✓ yes' : '✗ no'}</td>` +
      `<td class="blk">${res.ok ? '—' : blockers}</td>`;
    rows.appendChild(tr);
  }
}

function renderAll() { renderTiles(); renderBrowser(); renderDetail(); renderMake(); }

/* ---- helpers -------------------------------------------------------- */

function select(id) { selectedId = id; scaleServings = null; renderBrowser(); renderDetail(); }

function ratioLabel(a, b) {
  const { Rational } = core;
  return new Rational(BigInt(a), BigInt(b)).toString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setMsg(text, kind) {
  const el = $('pantry-msg');
  el.textContent = text || ' ';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

/* ---- events --------------------------------------------------------- */

$('view').addEventListener('change', (e) => { view = e.target.value; renderBrowser(); });
$('q').addEventListener('input', (e) => { filter = e.target.value; renderBrowser(); });

$('pantry-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const item = $('pi-item').value.trim();
  const qty = $('pi-qty').value.trim();
  if (!item) { setMsg('Enter an item to add.', 'err'); return; }
  try {
    pantry.add(item, qty || null);
    $('pi-item').value = ''; $('pi-qty').value = '';
    setMsg(`Added ${qty ? qty + ' ' : ''}${item} to the pantry.`, 'ok');
    renderTiles(); renderMake();
  } catch (err) {
    setMsg((err instanceof RecipeError ? '' : 'Unexpected: ') + err.message, 'err');
  }
});

$('pantry-reset').addEventListener('click', () => {
  pantry = window.RecipeFixtures.buildPantry(core);
  setMsg('Pantry reset to the sample contents.', 'ok');
  renderTiles(); renderMake();
});

/* ---- go ------------------------------------------------------------- */

select(book.all()[0].id);
renderAll();
})();
