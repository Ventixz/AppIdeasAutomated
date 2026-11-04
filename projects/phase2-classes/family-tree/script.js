'use strict';
/*
 * script.js — the browser demo for the Family Tree. It reads clicks and <select>
 * changes and calls the objects from family-core.js; every relationship label,
 * the derived queries and the kinship algorithm live in the core, never here.
 * This file only paints.
 */

(function () {
  const { sampleTree } = window.FamilyFixtures;

  const { tree, people } = sampleTree();
  let selected = people.emma; // the person whose relatives are shown

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function renderTiles() {
    const gens = Math.max(...tree.roots().map((r) => maxDepth(r))) + 1;
    const living = tree.people.filter((p) => p.isAlive).length;
    const tiles = [
      { num: tree.size, lbl: 'people in the tree' },
      { num: gens, lbl: 'generations' },
      { num: living, lbl: 'living' },
      { num: tree.roots().length, lbl: 'family lines (roots)' },
    ];
    $('tiles').innerHTML = tiles
      .map((t) => `<div class="tile"><div class="num">${t.num}</div><div class="lbl">${t.lbl}</div></div>`)
      .join('');
  }

  function maxDepth(person, seen = new Set()) {
    if (seen.has(person)) return 0;
    seen.add(person);
    const kids = tree.childrenOf(person);
    if (kids.length === 0) return 0;
    return 1 + Math.max(...kids.map((k) => maxDepth(k, seen)));
  }

  function renderSelectors() {
    const opts = tree.people
      .map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.lifespan ? ` (${esc(p.lifespan)})` : ''}</option>`)
      .join('');
    $('selA').innerHTML = opts;
    $('selB').innerHTML = opts;
    $('selA').value = 'Susan';
    $('selB').value = 'Daniel';
  }

  function renderRelationship() {
    const a = tree.find($('selA').value);
    const b = tree.find($('selB').value);
    const out = $('relOut');
    if (!a || !b) { out.innerHTML = ''; return; }
    const k = tree.kinship(a, b);
    let headline;
    if (k.label === 'the same person') headline = `${esc(a.name)} and ${esc(b.name)} are <strong>the same person</strong>`;
    else if (k.label === 'no blood relation') headline = `${esc(a.name)} is <strong>no blood relation</strong> of ${esc(b.name)}`;
    else headline = `${esc(a.name)} is ${esc(b.name)}'s <strong>${esc(k.label)}</strong>`;

    const detail = (k.da != null)
      ? `Lowest common ancestor: <code>${k.via.map((x) => esc(x.name)).join(', ')}</code> · distances <code>(${k.da}, ${k.db})</code> — the pair that names the relationship.`
      : `No shared ancestor in the tree — any link would be by marriage, which this engine doesn't model.`;

    out.innerHTML = `<div class="card ok">
      <p class="headline">${headline}</p>
      <p class="detail">${detail}</p>
    </div>`;
  }

  function renderTree() {
    const shown = new Set();
    const lines = [];
    const walk = (person, depth) => {
      const pad = '  '.repeat(depth);
      if (shown.has(person)) {
        lines.push(`<span class="row" data-name="${esc(person.name)}">${pad}${esc(person.name)} <span class="repeat">↑</span></span>`);
        return;
      }
      shown.add(person);
      const yrs = person.lifespan ? ` <span class="yrs">(${esc(person.lifespan)})</span>` : '';
      lines.push(`<span class="row${person === selected ? ' sel' : ''}" data-name="${esc(person.name)}">${pad}${esc(person.name)}${yrs}</span>`);
      for (const child of tree.childrenOf(person)) walk(child, depth + 1);
    };
    for (const root of tree.roots()) walk(root, 0);
    $('treeView').innerHTML = lines.join('\n');
  }

  function relatives(list) {
    if (!list.length) return '<span class="none">—</span>';
    return list.map((p) => esc(p.name)).join(', ');
  }

  function renderWho() {
    const p = selected;
    const living = p.isAlive ? '<span class="pill living">living</span>' : '';
    const age = p.age() !== undefined ? ` · age ${p.age()}` : '';
    $('whoView').innerHTML = `
      <p class="name-head">${esc(p.name)} <span class="life">${esc(p.lifespan)}${age}</span>${living}</p>
      <dl>
        <dt>parents</dt><dd>${relatives(tree.parentsOf(p))}</dd>
        <dt>children</dt><dd>${relatives(tree.childrenOf(p))}</dd>
        <dt>siblings</dt><dd>${relatives(tree.siblingsOf(p))}</dd>
        <dt>grandparents</dt><dd>${relatives(tree.grandparentsOf(p))}</dd>
        <dt>aunts / uncles</dt><dd>${relatives(tree.auntsUnclesOf(p))}</dd>
        <dt>first cousins</dt><dd>${relatives(tree.cousinsOf(p))}</dd>
      </dl>`;
  }

  function renderAll() { renderTiles(); renderSelectors(); renderRelationship(); renderTree(); renderWho(); }

  // --- events ---------------------------------------------------------------
  $('selA').addEventListener('change', renderRelationship);
  $('selB').addEventListener('change', renderRelationship);
  $('treeView').addEventListener('click', (ev) => {
    const row = ev.target.closest('.row');
    if (!row) return;
    const person = tree.find(row.dataset.name);
    if (!person) return;
    selected = person;
    renderTree();
    renderWho();
  });

  renderAll();
})();
