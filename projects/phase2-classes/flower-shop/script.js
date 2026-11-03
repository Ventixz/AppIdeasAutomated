'use strict';
/*
 * script.js — the browser demo for the Flower Shop. It reads clicks and calls the
 * objects from flower-core.js; every price, stem count and the atomic inventory
 * rule live in the core, never here. This file only paints.
 */

(function () {
  const { Cart, OutOfStockError } = window.FlowerCore;
  const { sampleShop } = window.FlowerFixtures;

  let ctx, cart;
  function reset() {
    ctx = sampleShop();
    cart = new Cart();
    renderAll();
  }

  const $ = (id) => document.getElementById(id);

  function renderTiles() {
    const flowerCount = ctx.shop.flowers.length;
    const bouquetCount = Object.keys(ctx.bouquets).length;
    const low = ctx.shop.lowStock().length;
    const tiles = [
      { num: flowerCount, lbl: 'flower varieties' },
      { num: bouquetCount, lbl: 'bouquets on offer' },
      { num: ctx.shop.register.toString(), lbl: 'in the register' },
      { num: low, lbl: 'low on stock', warn: low > 0 },
    ];
    $('tiles').innerHTML = tiles
      .map((t) => `<div class="tile${t.warn ? ' warn' : ''}"><div class="num">${t.num}</div><div class="lbl">${t.lbl}</div></div>`)
      .join('');
  }

  function flowerChip(f) {
    return `<button class="chip" data-kind="flower" data-key="${f.key}">
      <span><span class="nm">${esc(f.name)}</span> <span class="sub">${esc(f.color)}</span></span>
      <span class="pr">${f.price()} <span class="sub">/stem</span></span>
    </button>`;
  }

  function bouquetChip(key, b) {
    const disc = b.discountPercent
      ? `<span class="strike">${b.gross()}</span>` : '';
    return `<button class="chip" data-kind="bouquet" data-key="${key}">
      <span><span class="nm">${esc(b.name)}</span>
        <span class="sub">${b.items.map((i) => `${i.qty}× ${esc(i.item.name)}`).join(', ')} · ${b.stemCount()} stems</span></span>
      <span class="pr">${disc}${b.price()}</span>
    </button>`;
  }

  function renderMenu() {
    $('flowerMenu').innerHTML = ctx.shop.flowers.map(flowerChip).join('');
    $('bouquetMenu').innerHTML = Object.entries(ctx.bouquets).map(([k, b]) => bouquetChip(k, b)).join('');
  }

  function renderCart() {
    const rows = $('cartRows'), foot = $('cartFoot'), empty = $('cartEmpty');
    if (cart.isEmpty()) {
      rows.innerHTML = ''; foot.innerHTML = ''; empty.hidden = false;
      $('checkoutBtn').disabled = true;
      return;
    }
    empty.hidden = true;
    $('checkoutBtn').disabled = false;
    rows.innerHTML = cart.lines.map((l, i) => `<tr>
      <td>${esc(l.item.name)}</td>
      <td class="num">${l.qty}</td>
      <td class="num">${l.item.price()}</td>
      <td class="num">${l.item.price().times(l.qty)}</td>
      <td class="num"><button class="link" data-remove="${i}" title="remove">×</button></td>
    </tr>`).join('');
    foot.innerHTML = `<tr><td colspan="3">Total · ${cart.size} item(s)</td><td class="num">${cart.total()}</td><td></td></tr>`;
  }

  function renderStock() {
    const low = new Set(ctx.shop.lowStock().map((l) => l.flower.key));
    $('stockRows').innerHTML = ctx.shop.flowers.map((f) => {
      const n = ctx.shop.stockOf(f);
      const isLow = low.has(f.key);
      const status = isLow ? '<span class="pill low">reorder</span>' : '<span class="pill ok">ok</span>';
      return `<tr><td>${esc(f.color)} ${esc(f.name)}</td><td class="num">${n}</td><td>${status}</td></tr>`;
    }).join('');
    $('register').textContent = `Register: ${ctx.shop.register}`;
  }

  function renderAll() { renderTiles(); renderMenu(); renderCart(); renderStock(); }

  function addToCart(kind, key) {
    const item = kind === 'flower'
      ? ctx.shop.flowers.find((f) => f.key === key)
      : ctx.bouquets[key];
    if (!item) return;
    // merge with an existing identical line for a tidy cart
    const existing = cart.lines.find((l) => l.item === item);
    if (existing) existing.qty += 1; else cart.add(item, 1);
    $('checkoutOut').innerHTML = '';
    renderCart();
  }

  function checkout() {
    const out = $('checkoutOut');
    try {
      const receipt = ctx.shop.checkout(cart);
      cart = new Cart();
      out.innerHTML = `<div class="card ok">
        <h3>Sold — thank you! 💐</h3>
        <pre>${esc(receipt.toString())}</pre>
      </div>`;
      renderAll();
    } catch (e) {
      if (e instanceof OutOfStockError) {
        const list = e.shortfalls.map((s) => `${esc(s.name)} — need ${s.need}, have ${s.have}`).join('<br>');
        out.innerHTML = `<div class="card err">
          <h3 class="err-text">Order refused</h3>
          <p class="small">The shop is short on:</p>
          <p class="small">${list}</p>
          <p class="muted small">Nothing was charged and nothing left the shelves — the order is atomic.</p>
        </div>`;
      } else {
        out.innerHTML = `<div class="card err"><p class="err-text small">${esc(e.message)}</p></div>`;
      }
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // --- events ---------------------------------------------------------------
  document.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (chip) { addToCart(chip.dataset.kind, chip.dataset.key); return; }
    const rm = ev.target.closest('[data-remove]');
    if (rm) { cart.lines.splice(Number(rm.dataset.remove), 1); $('checkoutOut').innerHTML = ''; renderCart(); return; }
  });
  $('checkoutBtn').addEventListener('click', checkout);
  $('clearCartBtn').addEventListener('click', () => { cart = new Cart(); $('checkoutOut').innerHTML = ''; renderCart(); });
  $('resetBtn').addEventListener('click', () => { reset(); $('checkoutOut').innerHTML = ''; });

  reset();
})();
