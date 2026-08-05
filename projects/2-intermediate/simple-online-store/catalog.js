/*
 * catalog.js — the in-memory product inventory.
 *
 * Per the spec, product data starts life as a plain in-memory data structure.
 * Each product carries a unique `id`, a `name`, a `price` (in whole cents to
 * avoid floating-point money bugs), a short blurb for the card, a longer
 * description for the details view, an emoji `thumb`, and how many units are
 * in `stock` (used by the optional inventory-validation enhancement).
 *
 * Works in the browser (attaches to window) and in Node (module.exports).
 */
'use strict';

var CATALOG = [
  {
    id: 'TSHIRT-01',
    name: 'Classic Tee',
    price: 1999,
    thumb: '👕',
    blurb: 'Soft cotton crew-neck in heather grey.',
    description:
      'A wardrobe staple: 100% combed ring-spun cotton, pre-shrunk, with a ' +
      'tear-away label and reinforced shoulder seams. Runs true to size.',
    stock: 12
  },
  {
    id: 'MUG-01',
    name: 'Ceramic Mug',
    price: 1249,
    thumb: '☕',
    blurb: '11oz stoneware mug, dishwasher safe.',
    description:
      'Chunky 11oz stoneware mug with a comfortable C-handle and a glossy ' +
      'glaze. Microwave and dishwasher safe. Holds exactly one good morning.',
    stock: 30
  },
  {
    id: 'CAP-01',
    name: 'Six-Panel Cap',
    price: 2450,
    thumb: '🧢',
    blurb: 'Adjustable cotton cap, one size fits most.',
    description:
      'Structured six-panel cap with an embroidered eyelet on each panel and ' +
      'a brass buckle strap at the back. One size, endlessly adjustable.',
    stock: 8
  },
  {
    id: 'BOTTLE-01',
    name: 'Insulated Bottle',
    price: 2999,
    thumb: '🍶',
    blurb: 'Keeps drinks cold 24h, hot 12h.',
    description:
      'Double-walled vacuum-insulated 500ml stainless-steel bottle. Sweat-free ' +
      'exterior, leak-proof lid, and a powder-coated finish that shrugs off scratches.',
    stock: 15
  },
  {
    id: 'STICKER-01',
    name: 'Sticker Pack',
    price: 599,
    thumb: '🏷️',
    blurb: 'Ten die-cut vinyl stickers.',
    description:
      'A pack of ten weatherproof die-cut vinyl stickers with a matte laminate ' +
      'top-coat. UV-resistant, dishwasher-tested, laptop-approved.',
    stock: 50
  },
  {
    id: 'TOTE-01',
    name: 'Canvas Tote',
    price: 1799,
    thumb: '👜',
    blurb: 'Heavy 12oz canvas, roomy interior.',
    description:
      'A sturdy 12oz natural-canvas tote with reinforced 60cm handles and a ' +
      'flat bottom so it stands up on its own. Carries far more than it looks.',
    stock: 20
  },
  {
    id: 'NOTEBOOK-01',
    name: 'Dot-Grid Notebook',
    price: 1399,
    thumb: '📓',
    blurb: 'A5 hardcover, 160 numbered pages.',
    description:
      'A5 hardcover notebook with 160 numbered dot-grid pages on 100gsm ' +
      'ivory paper, a ribbon marker, an elastic closure, and a back pocket.',
    stock: 25
  },
  {
    id: 'PEN-01',
    name: 'Gel Pen Trio',
    price: 899,
    thumb: '🖊️',
    blurb: 'Three 0.5mm gel pens, smudge-free.',
    description:
      'Set of three retractable 0.5mm gel pens with quick-drying, smudge-free ' +
      'ink and a cushioned grip. Writes smoothly on even the cheapest paper.',
    stock: 40
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CATALOG;
}
if (typeof window !== 'undefined') {
  window.CATALOG = CATALOG;
}
