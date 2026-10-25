/*
 * inventory-fixtures.js — a sample catalogue shared by the browser demo, the
 * CLI's `--demo` mode and the tests, so all three talk about the same stock.
 *
 * Prices are written as human dollar strings and parsed into cents by the
 * Product constructor — exactly how a real import would arrive. The quantities
 * are picked so the demo shows every state: healthy stock, low stock, and a
 * sold-out line.
 */
'use strict';

const CATALOGUE = [
  { id: 'A-100', name: 'USB-C Cable (1m)', price: '8.99', quantity: 240 },
  { id: 'A-205', name: 'Mechanical Keyboard', price: '79.50', quantity: 12 },
  { id: 'A-310', name: 'Wireless Mouse', price: '24.00', quantity: 3 },
  { id: 'B-012', name: '27" Monitor', price: '229.99', quantity: 7 },
  { id: 'B-044', name: 'Laptop Stand', price: '34.95', quantity: 0 },
  { id: 'C-900', name: 'Webcam 1080p', price: '49.99', quantity: 18 },
  { id: 'C-915', name: 'Desk Mat (XL)', price: '19.00', quantity: 5 },
];

if (typeof module !== 'undefined' && module.exports) module.exports = { CATALOGUE };
if (typeof window !== 'undefined') window.ProductInventoryFixtures = { CATALOGUE };
