'use strict';
/*
 * flower-fixtures.js — one sample shop, shared by the CLI, the tests and the
 * browser demo so all three show the same flowers, bouquets and stock. Chosen to
 * exercise every corner: a plain flower, a bouquet with an arrangement fee, a
 * discounted bouquet, and a composite bouquet that contains another bouquet.
 * Works under Node (require) and the browser (global).
 */

(function (factory) {
  const core = (typeof require !== 'undefined') ? require('./flower-core') : window.FlowerCore;
  const api = factory(core);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FlowerFixtures = api;
})(function (core) {
  const { Flower, Bouquet, Shop } = core;

  // The catalogue of single flowers (name|color is the inventory key).
  function flowers() {
    return {
      rose:       new Flower('Rose', { color: 'red', pricePerStem: '2.50' }),
      whiteRose:  new Flower('Rose', { color: 'white', pricePerStem: '2.75' }),
      tulip:      new Flower('Tulip', { color: 'yellow', pricePerStem: '1.20' }),
      lily:       new Flower('Lily', { color: 'white', pricePerStem: '3.40' }),
      carnation:  new Flower('Carnation', { color: 'pink', pricePerStem: '0.90' }),
      babysbreath:new Flower('Baby’s Breath', { color: 'white', pricePerStem: '0.60' }),
    };
  }

  // The arrangements. `dozenRoses` carries a discount; `anniversary` is a
  // composite — a bouquet that *contains* the dozen-roses bouquet plus lilies.
  function bouquets(f) {
    const dozenRoses = new Bouquet('Dozen Red Roses', {
      items: [[f.rose, 12], [f.babysbreath, 6]],
      arrangementFee: '4.00',
      discountPercent: 10,
    });
    const springMix = new Bouquet('Spring Mix', {
      items: [[f.tulip, 6], [f.carnation, 4], [f.babysbreath, 3]],
      arrangementFee: '3.50',
    });
    const anniversary = new Bouquet('Anniversary Grand', {
      items: [[dozenRoses, 1], [f.lily, 5], [f.whiteRose, 6]],
      arrangementFee: '8.00',
      discountPercent: 5,
    });
    return { dozenRoses, springMix, anniversary };
  }

  function sampleShop() {
    const f = flowers();
    const b = bouquets(f);
    const shop = new Shop('Petal & Stem', { register: '0.00' });
    shop
      .stock(f.rose, 40, { reorderAt: 24 })
      .stock(f.whiteRose, 30, { reorderAt: 12 })
      .stock(f.tulip, 50, { reorderAt: 20 })
      .stock(f.lily, 18, { reorderAt: 10 })
      .stock(f.carnation, 60, { reorderAt: 24 })
      .stock(f.babysbreath, 25, { reorderAt: 30 }); // starts BELOW reorder → low-stock demo
    return { shop, flowers: f, bouquets: b };
  }

  return { flowers, bouquets, sampleShop };
});
