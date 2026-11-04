'use strict';
/*
 * family-fixtures.js — one sample family, shared by the CLI, the tests and the
 * browser demo so all three show the same people. It is four generations deep
 * and chosen to exercise every corner of the kinship engine: direct lines
 * (great-grandparent → great-grandchild), siblings, aunts/uncles and
 * nieces/nephews, first cousins, second cousins, a first cousin ONCE REMOVED,
 * and two people related only by marriage (so: no blood relation).
 *
 *   Walter ∞ Augusta                 (great-grandparents, generation 1)
 *      ├── Margaret ∞ Henry
 *      │      ├── Susan ∞ Paul
 *      │      │      ├── Emma
 *      │      │      └── Jack
 *      │      └── Thomas
 *      └── George ∞ Linda
 *             └── Daniel ∞ Rachel
 *                    └── Oliver
 *
 * Henry, Paul, Linda and Rachel marry in — they are parents, but share no blood
 * ancestor with the Walter/Augusta line, which the engine reports correctly.
 *
 * Works under Node (require) and the browser (global).
 */

(function (factory) {
  const core = (typeof require !== 'undefined') ? require('./family-core') : window.FamilyCore;
  const api = factory(core);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FamilyFixtures = api;
})(function (core) {
  const { Person, FamilyTree } = core;

  function sampleTree() {
    const p = {
      walter:   new Person('Walter',   { born: 1918, died: 1995, sex: 'm' }),
      augusta:  new Person('Augusta',  { born: 1920, died: 2001, sex: 'f' }),
      margaret: new Person('Margaret', { born: 1945, sex: 'f' }),
      henry:    new Person('Henry',    { born: 1943, died: 2018, sex: 'm' }), // married in
      george:   new Person('George',   { born: 1948, sex: 'm' }),
      linda:    new Person('Linda',    { born: 1950, sex: 'f' }),             // married in
      susan:    new Person('Susan',    { born: 1970, sex: 'f' }),
      paul:     new Person('Paul',     { born: 1968, sex: 'm' }),             // married in
      thomas:   new Person('Thomas',   { born: 1972, sex: 'm' }),
      daniel:   new Person('Daniel',   { born: 1975, sex: 'm' }),
      rachel:   new Person('Rachel',   { born: 1977, sex: 'f' }),             // married in
      emma:     new Person('Emma',     { born: 1998, sex: 'f' }),
      jack:     new Person('Jack',     { born: 2001, sex: 'm' }),
      oliver:   new Person('Oliver',   { born: 2003, sex: 'm' }),
    };

    const tree = new FamilyTree('The Family');
    for (const person of Object.values(p)) tree.add(person);

    // generation 1 → 2
    tree.connect(p.walter, p.margaret).connect(p.augusta, p.margaret);
    tree.connect(p.walter, p.george).connect(p.augusta, p.george);
    // generation 2 → 3
    tree.connect(p.margaret, p.susan).connect(p.henry, p.susan);
    tree.connect(p.margaret, p.thomas).connect(p.henry, p.thomas);
    tree.connect(p.george, p.daniel).connect(p.linda, p.daniel);
    // generation 3 → 4
    tree.connect(p.susan, p.emma).connect(p.paul, p.emma);
    tree.connect(p.susan, p.jack).connect(p.paul, p.jack);
    tree.connect(p.daniel, p.oliver).connect(p.rachel, p.oliver);

    return { tree, people: p };
  }

  return { sampleTree };
});
