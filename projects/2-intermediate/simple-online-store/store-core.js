/*
 * store-core.js — the pure, testable heart of the store.
 *
 * No DOM, no globals mutated behind your back. A `Cart` is just a map of
 * productId -> quantity, and every operation returns a *new* cart rather than
 * mutating the old one, which keeps the logic easy to reason about and test.
 *
 * Money is handled in whole cents everywhere and only formatted to dollars at
 * the very edges, so we never accumulate floating-point rounding errors.
 *
 * Works in the browser (window.StoreCore) and in Node (module.exports).
 */
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.StoreCore = api;
})(typeof window !== 'undefined' ? window : null, function () {

  /* Build a quick id -> product lookup from a catalog array. */
  function indexCatalog(catalog) {
    var byId = {};
    catalog.forEach(function (p) {
      if (byId[p.id]) throw new Error('duplicate product id: ' + p.id);
      byId[p.id] = p;
    });
    return byId;
  }

  /* Add `qty` (default 1) of a product to the cart, returning a new cart.
     Quantity is clamped to available stock when the product exposes `stock`. */
  function addToCart(cart, product, qty) {
    if (!product || !product.id) throw new Error('addToCart: invalid product');
    qty = qty == null ? 1 : qty;
    if (qty <= 0) throw new Error('addToCart: qty must be positive');
    var next = Object.assign({}, cart);
    var wanted = (next[product.id] || 0) + qty;
    if (typeof product.stock === 'number') wanted = Math.min(wanted, product.stock);
    next[product.id] = wanted;
    return next;
  }

  /* Set an exact quantity for a product. A quantity of 0 (or less) removes the
     line entirely. Returns a new cart. */
  function setQuantity(cart, productId, qty) {
    var next = Object.assign({}, cart);
    if (qty == null || qty <= 0) {
      delete next[productId];
    } else {
      next[productId] = Math.floor(qty);
    }
    return next;
  }

  /* Remove a line outright. Returns a new cart. */
  function removeFromCart(cart, productId) {
    var next = Object.assign({}, cart);
    delete next[productId];
    return next;
  }

  /* Total number of individual units across all lines. */
  function itemCount(cart) {
    return Object.keys(cart).reduce(function (sum, id) {
      return sum + cart[id];
    }, 0);
  }

  /* Expand a cart into detailed line items, joining against the catalog index.
     Each line has { id, name, price, qty, subtotal }. Unknown ids are skipped. */
  function lineItems(cart, byId) {
    return Object.keys(cart).map(function (id) {
      var p = byId[id];
      if (!p) return null;
      var qty = cart[id];
      return {
        id: id,
        name: p.name,
        price: p.price,
        qty: qty,
        subtotal: p.price * qty
      };
    }).filter(Boolean);
  }

  /* Grand total in cents: sum of (unit price × quantity) across the cart. */
  function cartTotal(cart, byId) {
    return lineItems(cart, byId).reduce(function (sum, line) {
      return sum + line.subtotal;
    }, 0);
  }

  /* Format a cents amount as a $-prefixed dollar string. */
  function formatMoney(cents) {
    var sign = cents < 0 ? '-' : '';
    var abs = Math.abs(Math.round(cents));
    var dollars = Math.floor(abs / 100);
    var rem = abs % 100;
    return sign + '$' + dollars + '.' + (rem < 10 ? '0' + rem : rem);
  }

  /* Deterministic-ish confirmation number from the cart + a caller-supplied
     seed (a timestamp in the app, a fixed value in tests). Never random, so it
     stays testable and resumable. */
  function confirmationNumber(cart, seed) {
    var basis = itemCount(cart) * 31 + Number(seed || 0);
    var hash = Math.abs(basis).toString(36).toUpperCase();
    while (hash.length < 6) hash = '0' + hash;
    return 'ORD-' + hash.slice(-6);
  }

  /* "Place" an order: validate the cart is non-empty, then return an immutable
     order record. Does not mutate the cart — the caller decides when to clear. */
  function placeOrder(cart, byId, seed) {
    var lines = lineItems(cart, byId);
    if (lines.length === 0) throw new Error('placeOrder: cart is empty');
    return {
      confirmation: confirmationNumber(cart, seed),
      lines: lines,
      itemCount: itemCount(cart),
      total: cartTotal(cart, byId)
    };
  }

  return {
    indexCatalog: indexCatalog,
    addToCart: addToCart,
    setQuantity: setQuantity,
    removeFromCart: removeFromCart,
    itemCount: itemCount,
    lineItems: lineItems,
    cartTotal: cartTotal,
    formatMoney: formatMoney,
    confirmationNumber: confirmationNumber,
    placeOrder: placeOrder
  };
});
