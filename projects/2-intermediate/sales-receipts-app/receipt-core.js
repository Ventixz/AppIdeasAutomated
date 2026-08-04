/*
 * receipt-core.js — pure, DOM-free point-of-sale logic.
 *
 * Everything here works on plain data (the inventory array and a "cart" object)
 * so it can be unit-tested in Node without a browser or IndexedDB. script.js
 * paints these results into the page; db.js persists finished receipts.
 *
 * A "cart" is an array of line objects: { itemNo, description, unitPrice, qty }.
 */
(function (global) {
  'use strict';

  // Money is kept in whole cents internally to avoid floating-point drift, then
  // formatted only at the edges.
  function toCents(dollars) {
    return Math.round(Number(dollars) * 100);
  }

  function formatMoney(cents) {
    var sign = cents < 0 ? '-' : '';
    var abs = Math.abs(cents);
    return sign + '$' + (abs / 100).toFixed(2);
  }

  function findItem(inventory, itemNo) {
    for (var i = 0; i < inventory.length; i++) {
      if (inventory[i].itemNo === itemNo) return inventory[i];
    }
    return null;
  }

  // Return a NEW cart with one unit of itemNo added (bumping qty if present).
  function addItem(cart, inventory, itemNo) {
    var item = findItem(inventory, itemNo);
    if (!item) throw new Error('Unknown item number: ' + itemNo);

    var next = cart.map(function (line) {
      return { itemNo: line.itemNo, description: line.description,
               unitPrice: line.unitPrice, qty: line.qty };
    });

    for (var i = 0; i < next.length; i++) {
      if (next[i].itemNo === itemNo) {
        next[i].qty += 1;
        return next;
      }
    }
    next.push({ itemNo: item.itemNo, description: item.description,
                unitPrice: item.unitPrice, qty: 1 });
    return next;
  }

  // Bonus: "Clear Entry" removes the most recently added unit. Dropping the last
  // unit of a line removes the line entirely.
  function clearEntry(cart) {
    if (cart.length === 0) return [];
    var next = cart.map(function (line) {
      return { itemNo: line.itemNo, description: line.description,
               unitPrice: line.unitPrice, qty: line.qty };
    });
    var last = next[next.length - 1];
    if (last.qty > 1) {
      last.qty -= 1;
    } else {
      next.pop();
    }
    return next;
  }

  // Bonus: "Cancel All" empties the pre-checkout cart.
  function cancelAll() {
    return [];
  }

  function lineTotalCents(line) {
    return toCents(line.unitPrice) * line.qty;
  }

  function totalCents(cart) {
    return cart.reduce(function (sum, line) {
      return sum + lineTotalCents(line);
    }, 0);
  }

  function itemCount(cart) {
    return cart.reduce(function (n, line) { return n + line.qty; }, 0);
  }

  // Freeze a cart into a receipt record ready for persistence. `now` is passed
  // in (never read from the clock here) so the function stays pure and testable.
  function buildReceipt(cart, now, customer) {
    if (cart.length === 0) throw new Error('Cannot check out an empty cart.');
    return {
      timestamp: now,
      customer: (customer || '').trim() || 'Guest',
      items: cart.map(function (line) {
        return { itemNo: line.itemNo, description: line.description,
                 unitPrice: line.unitPrice, qty: line.qty,
                 lineTotalCents: lineTotalCents(line) };
      }),
      totalCents: totalCents(cart),
      itemCount: itemCount(cart)
    };
  }

  // Sum a set of stored receipts (the "Daily Sales" report).
  function summarize(receipts) {
    return receipts.reduce(function (acc, r) {
      acc.totalCents += r.totalCents;
      acc.itemCount += r.itemCount;
      acc.receiptCount += 1;
      return acc;
    }, { totalCents: 0, itemCount: 0, receiptCount: 0 });
  }

  var api = {
    toCents: toCents,
    formatMoney: formatMoney,
    findItem: findItem,
    addItem: addItem,
    clearEntry: clearEntry,
    cancelAll: cancelAll,
    lineTotalCents: lineTotalCents,
    totalCents: totalCents,
    itemCount: itemCount,
    buildReceipt: buildReceipt,
    summarize: summarize
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ReceiptCore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
