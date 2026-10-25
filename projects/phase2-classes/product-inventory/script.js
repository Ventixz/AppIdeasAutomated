/*
 * script.js — the browser front end. It owns zero business logic: it builds one
 * Inventory from the shared fixtures, calls the class methods on every action,
 * and re-renders from the inventory's own state. All the rules (no oversell, no
 * negative stock, no duplicate ids, exact money) live in inventory-core.js, so
 * this file can't accidentally disagree with the CLI or the tests.
 */
'use strict';

(function () {
  const { Money, Product, Inventory, InventoryError } = window.ProductInventory;
  const { CATALOGUE } = window.ProductInventoryFixtures;

  const inv = new Inventory();
  for (const spec of CATALOGUE) inv.add(spec);

  const $ = (id) => document.getElementById(id);
  const rowsEl = $('rows');
  const msgEl = $('msg');

  function flash(text, kind) {
    msgEl.textContent = text || ' ';
    msgEl.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function statePill(qty) {
    if (qty === 0) return '<span class="pill out">sold out</span>';
    if (qty <= 5) return '<span class="pill low">low</span>';
    return '<span class="pill ok">ok</span>';
  }

  function renderTiles() {
    const s = inv.summary();
    $('t-value').textContent = Money.format(s.totalValueCents);
    $('t-skus').textContent = s.skuCount;
    $('t-units').textContent = s.totalUnits.toLocaleString('en-US');
    $('t-low').textContent = s.lowStockCount;
  }

  function render() {
    rowsEl.innerHTML = '';
    for (const p of inv.byValue()) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="id">${p.id}</td>` +
        `<td>${escapeHtml(p.name)}</td>` +
        `<td class="r">${Money.format(p.priceCents)}</td>` +
        `<td class="r">${p.quantity} ${statePill(p.quantity)}</td>` +
        `<td class="r">${Money.format(p.lineValue())}</td>` +
        `<td class="r"><span class="move">` +
          `<input type="number" min="1" value="1" aria-label="amount for ${p.id}" />` +
          `<button class="ghost" data-act="receive" data-id="${p.id}">+ in</button>` +
          `<button class="ghost" data-act="ship" data-id="${p.id}">− out</button>` +
          `<button class="ghost" data-act="remove" data-id="${p.id}">✕</button>` +
        `</span></td>`;
      rowsEl.appendChild(tr);
    }
    renderTiles();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // One handler for every per-row button — read the amount from its row.
  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    try {
      if (act === 'remove') {
        inv.remove(id);
        flash(`removed ${id}`, 'ok');
      } else {
        const amount = Number(btn.parentElement.querySelector('input').value);
        if (act === 'receive') { inv.receive(id, amount); flash(`received ${amount} of ${id}`, 'ok'); }
        else { inv.ship(id, amount); flash(`shipped ${amount} of ${id}`, 'ok'); }
      }
      render();
    } catch (err) {
      if (err instanceof InventoryError) flash(err.message, 'err');
      else throw err;
    }
  });

  // Add-product form routes straight through the Product constructor, so its
  // validation (blank id, bad price, …) surfaces as the same friendly message.
  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      inv.add(new Product({
        id: $('f-id').value,
        name: $('f-name').value,
        price: $('f-price').value || '0',
        quantity: Number($('f-qty').value || 0),
      }));
      flash(`added ${$('f-id').value.trim()}`, 'ok');
      e.target.reset();
      $('f-id').focus();
      render();
    } catch (err) {
      if (err instanceof InventoryError) flash(err.message, 'err');
      else throw err;
    }
  });

  render();
})();
