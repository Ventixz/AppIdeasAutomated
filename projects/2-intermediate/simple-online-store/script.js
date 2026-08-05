/*
 * script.js — DOM wiring + a tiny hash router.
 *
 * All the interesting math lives in store-core.js; this file only translates
 * user clicks into cart operations and renders the result. Views:
 *
 *   #/               Landing page
 *   #/products       Product grid
 *   #/product/:id    Product details
 *   #/cart           Shopping cart
 *   #/confirmed/:no  Order confirmation
 *
 * The cart survives reloads via localStorage, so a shopper's unpurchased
 * items are preserved when they navigate away and come back (per the spec).
 */
'use strict';

(function () {
  var Core = window.StoreCore;
  var CATALOG = window.CATALOG;
  var BY_ID = Core.indexCatalog(CATALOG);
  var STORAGE_KEY = 'corner-shop-cart';

  var viewEl = document.getElementById('view');
  var badgeEl = document.getElementById('cartBadge');

  /* ---- cart persistence ------------------------------------------------ */
  function loadCart() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function saveCart(cart) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (_) {}
    updateBadge(cart);
  }
  var cart = loadCart();

  function updateBadge(c) {
    var n = Core.itemCount(c);
    badgeEl.textContent = n;
    badgeEl.hidden = n === 0;
  }

  /* ---- small DOM helpers ---------------------------------------------- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  function money(cents) { return Core.formatMoney(cents); }
  function go(hash) { location.hash = hash; }

  /* ---- views ----------------------------------------------------------- */
  function renderLanding() {
    return el('section', { class: 'hero' }, [
      el('h1', { text: '🛍️ Welcome to Corner Shop' }),
      el('p', { text: 'A tiny demo storefront — browse, fill your cart, and check out. No account, no server, no real charge.' }),
      el('div', { class: 'cta' }, [
        el('button', { class: 'btn', onclick: function () { go('#/products'); } }, ['View Products']),
        el('button', { class: 'btn secondary', onclick: function () { go('#/cart'); } }, ['Shopping Cart'])
      ])
    ]);
  }

  function productCard(p) {
    return el('article', { class: 'card' }, [
      el('div', { class: 'thumb', text: p.thumb || '📦' }),
      el('h3', { text: p.name }),
      el('p', { class: 'blurb', text: p.blurb }),
      el('div', { class: 'price', text: money(p.price) }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn secondary', onclick: function () { go('#/product/' + p.id); } }, ['Details']),
        el('button', { class: 'btn', onclick: function () { addAndFeedback(p); } }, ['Add'])
      ])
    ]);
  }

  function renderProducts() {
    var head = el('div', { class: 'page-head' }, [
      el('h2', { text: 'Products' }),
      el('button', { class: 'link-btn', onclick: function () { go('#/cart'); } }, ['Go to Cart →'])
    ]);
    var grid = el('div', { class: 'grid' }, CATALOG.map(productCard));
    return el('section', {}, [head, grid]);
  }

  function renderDetail(id) {
    var p = BY_ID[id];
    if (!p) return renderNotFound();
    var out = typeof p.stock === 'number' && p.stock <= 0;
    return el('section', {}, [
      el('button', { class: 'link-btn', style: 'margin-bottom:1rem', onclick: function () { go('#/products'); } }, ['← Back to products']),
      el('div', { class: 'detail' }, [
        el('div', { class: 'bigthumb', text: p.thumb || '📦' }),
        el('div', {}, [
          el('h2', { text: p.name }),
          el('div', { class: 'id', text: 'Product ID: ' + p.id }),
          el('div', { class: 'price', text: money(p.price) }),
          typeof p.stock === 'number'
            ? el('div', { class: 'stock' + (out ? ' out' : ''), text: out ? 'Out of stock' : (p.stock + ' in stock') })
            : null,
          el('p', { text: p.description }),
          el('div', { class: 'actions' }, [
            el('button', { class: 'btn', disabled: out ? 'disabled' : null, onclick: function () { addAndFeedback(p); go('#/cart'); } }, ['Add to Cart']),
            el('button', { class: 'btn secondary', onclick: function () { go('#/products'); } }, ['Keep Browsing'])
          ])
        ])
      ])
    ]);
  }

  function renderCart() {
    var lines = Core.lineItems(cart, BY_ID);
    if (lines.length === 0) {
      return el('section', {}, [
        el('div', { class: 'empty' }, [
          el('p', { text: '🧺 Your cart is empty.' }),
          el('button', { class: 'btn', onclick: function () { go('#/products'); } }, ['Browse products'])
        ])
      ]);
    }

    var rows = lines.map(function (line) {
      return el('tr', {}, [
        el('td', {}, [
          el('div', { text: line.name }),
          el('div', { class: 'id', style: 'color:#6b7280;font-size:.75rem', text: line.id })
        ]),
        el('td', { class: 'num', text: money(line.price) }),
        el('td', {}, [
          el('input', {
            class: 'qty-input', type: 'number', min: '0', step: '1', value: String(line.qty),
            onchange: function (e) {
              cart = Core.setQuantity(cart, line.id, parseInt(e.target.value, 10) || 0);
              saveCart(cart);
              render();
            }
          })
        ]),
        el('td', { class: 'num', text: money(line.subtotal) }),
        el('td', { class: 'num' }, [
          el('button', { class: 'link-remove', onclick: function () {
            cart = Core.removeFromCart(cart, line.id); saveCart(cart); render();
          } }, ['Remove'])
        ])
      ]);
    });

    var total = Core.cartTotal(cart, BY_ID);
    var table = el('table', { class: 'cart-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Item' }),
          el('th', { class: 'num', text: 'Price' }),
          el('th', { text: 'Qty' }),
          el('th', { class: 'num', text: 'Subtotal' }),
          el('th', { class: 'num', text: '' })
        ])
      ]),
      el('tbody', {}, rows),
      el('tfoot', {}, [
        el('tr', { class: 'cart-total-row' }, [
          el('td', { colspan: '3', text: 'Total' }),
          el('td', { class: 'num', text: money(total) }),
          el('td', {})
        ])
      ])
    ]);

    var actions = el('div', { class: 'cart-actions' }, [
      el('button', { class: 'btn', onclick: placeOrder }, ['Place Order']),
      el('button', { class: 'btn secondary', onclick: function () { go('#/products'); } }, ['Continue Shopping']),
      el('button', { class: 'btn danger', onclick: cancelOrder }, ['Cancel Order'])
    ]);

    return el('section', {}, [
      el('div', { class: 'page-head' }, [el('h2', { text: 'Shopping Cart' })]),
      table,
      actions
    ]);
  }

  function renderConfirmed(orderNo) {
    return el('section', {}, [
      el('div', { class: 'confirm' }, [
        el('div', { class: 'check', text: '✅' }),
        el('h2', { text: 'Thank you for your order!' }),
        el('p', { text: 'Your confirmation number is' }),
        el('div', { class: 'order-no', text: orderNo }),
        el('p', { class: 'blurb', style: 'color:#6b7280', text: 'This is a demo store, so nothing was actually charged or shipped.' }),
        el('button', { class: 'btn', onclick: function () { go('#/products'); } }, ['Continue Shopping'])
      ])
    ]);
  }

  function renderNotFound() {
    return el('div', { class: 'empty' }, [
      el('p', { text: '🤔 Nothing here.' }),
      el('button', { class: 'btn', onclick: function () { go('#/products'); } }, ['Back to products'])
    ]);
  }

  /* ---- actions --------------------------------------------------------- */
  function addAndFeedback(p) {
    cart = Core.addToCart(cart, p);
    saveCart(cart);
  }

  function placeOrder() {
    try {
      // Seed the confirmation number from the clock; the *logic* stays pure and
      // testable because the seed is passed in rather than read inside core.
      var order = Core.placeOrder(cart, BY_ID, Date.now());
      cart = {};
      saveCart(cart);
      go('#/confirmed/' + order.confirmation);
    } catch (e) {
      alert(e.message);
    }
  }

  function cancelOrder() {
    if (Core.itemCount(cart) === 0 || confirm('Cancel this order and empty the cart?')) {
      cart = {};
      saveCart(cart);
      go('#/products');
    }
  }

  /* ---- router ---------------------------------------------------------- */
  function render() {
    var hash = location.hash.replace(/^#/, '') || '/';
    var parts = hash.split('/').filter(Boolean); // e.g. ['product','MUG-01']
    var node;

    if (parts.length === 0) node = renderLanding();
    else if (parts[0] === 'products') node = renderProducts();
    else if (parts[0] === 'product') node = renderDetail(decodeURIComponent(parts[1] || ''));
    else if (parts[0] === 'cart') node = renderCart();
    else if (parts[0] === 'confirmed') node = renderConfirmed(decodeURIComponent(parts[1] || ''));
    else node = renderNotFound();

    viewEl.innerHTML = '';
    viewEl.appendChild(node);
    window.scrollTo(0, 0);
  }

  // Nav buttons in the top bar use data-nav rather than real links.
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-nav]');
    if (t) { e.preventDefault(); go('#' + t.getAttribute('data-nav')); }
  });

  window.addEventListener('hashchange', render);

  updateBadge(cart);
  render();
})();
