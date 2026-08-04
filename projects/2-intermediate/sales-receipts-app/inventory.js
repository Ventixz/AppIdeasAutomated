/*
 * inventory.js — the shop's catalogue, defined in source per the spec.
 *
 * Each item has a UNIQUE itemNo, a description, and a unitPrice (in dollars).
 * `emoji` stands in for the bonus "thumbnail image" — it's drawn on each button
 * with zero network requests, keeping the app fully offline.
 */
(function (global) {
  'use strict';

  var INVENTORY = [
    { itemNo: 101, description: 'Espresso',        unitPrice: 2.50, emoji: '☕' },
    { itemNo: 102, description: 'Cappuccino',      unitPrice: 3.75, emoji: '🥛' },
    { itemNo: 103, description: 'Latte',           unitPrice: 4.00, emoji: '🍶' },
    { itemNo: 104, description: 'Croissant',       unitPrice: 3.25, emoji: '🥐' },
    { itemNo: 105, description: 'Bagel',           unitPrice: 2.75, emoji: '🥯' },
    { itemNo: 106, description: 'Muffin',          unitPrice: 3.00, emoji: '🧁' },
    { itemNo: 107, description: 'Sandwich',        unitPrice: 6.50, emoji: '🥪' },
    { itemNo: 108, description: 'Fresh Juice',     unitPrice: 4.25, emoji: '🧃' },
    { itemNo: 109, description: 'Cookie',          unitPrice: 1.75, emoji: '🍪' },
    { itemNo: 110, description: 'Bottled Water',   unitPrice: 1.50, emoji: '💧' },
    { itemNo: 111, description: 'Hot Chocolate',   unitPrice: 3.50, emoji: '🍫' },
    { itemNo: 112, description: 'Banana',          unitPrice: 0.90, emoji: '🍌' }
  ];

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = INVENTORY;
  } else {
    global.INVENTORY = INVENTORY;
  }
})(typeof window !== 'undefined' ? window : globalThis);
