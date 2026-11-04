#!/usr/bin/env node
'use strict';
/*
 * tests.js — dependency-free checks for the Family Tree engine. Run:
 *   node tests.js
 *
 * The Classes category is about design, so these lean on the GUARANTEES the
 * design makes, not on surface output:
 *
 *   - ONE SOURCE OF TRUTH: the two edge maps never disagree; every relationship
 *     (siblings, grandparents, cousins, ancestors) is derived from parent→child
 *     edges, so adding one relative updates every query with no stale lists.
 *   - INVARIANTS: no cycles, at most two parents, no duplicate people, no links
 *     to strangers — an impossible family cannot be built.
 *   - ONE KINSHIP ALGORITHM: the distance pair (dA, dB) to the lowest common
 *     ancestor names every blood relationship — siblings, first/second cousins,
 *     cousins "removed", aunts/uncles, nieces/nephews, direct lines — and the
 *     gendered wording is correct. Marriage-only pairs are "no blood relation".
 */

const core = require('./family-core');
const { FamilyError, CycleError, UnknownPersonError, Person, FamilyTree, kinshipLabel } = core;
const { sampleTree } = require('./family-fixtures');

let passed = 0;
const failures = [];
function check(name, cond) { if (cond) passed++; else failures.push(name); }
function throws(name, fn, Type) {
  try { fn(); failures.push(name + ' (expected throw)'); }
  catch (e) { if (Type && !(e instanceof Type)) failures.push(`${name} (wrong type: ${e.name})`); else passed++; }
}

// --- Person: a frozen value object ------------------------------------------

const walter = new Person('Walter', { born: 1918, died: 1995, sex: 'm' });
check('person keeps its fields', walter.name === 'Walter' && walter.born === 1918 && walter.died === 1995);
check('person is immutable', Object.isFrozen(walter));
check('dead person is not alive', !walter.isAlive);
check('dead person age = lifespan', walter.age() === 77);
check('living person age counts to asOf', new Person('Zoe', { born: 2000 }).age(2026) === 26);
check('living person isAlive', new Person('Zoe', { born: 2000 }).isAlive);
check('lifespan formats both years', walter.lifespan === '1918–1995');
check('lifespan of the living is open-ended', new Person('Zoe', { born: 2000 }).lifespan === '2000–');
throws('person without a name refused', () => new Person(''), FamilyError);
throws('died-before-born refused', () => new Person('X', { born: 2000, died: 1990 }), FamilyError);
throws('bad sex refused', () => new Person('X', { sex: 'q' }), FamilyError);
throws('non-integer year refused', () => new Person('X', { born: 19.5 }), FamilyError);

// --- FamilyTree: invariants at the single chokepoint ------------------------

function tri() {
  // grandparent → parent → child, a minimal 3-generation line
  const gp = new Person('GP', { sex: 'f' });
  const par = new Person('Par', { sex: 'm' });
  const kid = new Person('Kid', { sex: 'f' });
  const t = new FamilyTree('T');
  t.add(gp).add(par).add(kid);
  t.connect(gp, par).connect(par, kid);
  return { t, gp, par, kid };
}

{
  const { t, gp, par, kid } = tri();
  check('parentsOf is the stored edge', t.parentsOf(par)[0] === gp);
  check('childrenOf is the mirror edge', t.childrenOf(gp)[0] === par);
  check('edges agree both ways', t.parentsOf(kid)[0] === par && t.childrenOf(par)[0] === kid);
  check('roots() is the person with no parents', t.roots().length === 1 && t.roots()[0] === gp);
}

throws('adding the same person twice refused', () => {
  const t = new FamilyTree(); const a = new Person('A');
  t.add(a); t.add(a);
}, FamilyError);

throws('connecting a stranger refused', () => {
  const t = new FamilyTree(); const a = new Person('A'); const b = new Person('B');
  t.add(a); t.connect(a, b); // b never added
}, UnknownPersonError);

throws('being your own parent refused', () => {
  const t = new FamilyTree(); const a = new Person('A'); t.add(a); t.connect(a, a);
}, FamilyError);

throws('a third parent refused', () => {
  const t = new FamilyTree();
  const kid = new Person('Kid'), m = new Person('M'), f = new Person('F'), x = new Person('X');
  t.add(kid).add(m).add(f).add(x);
  t.connect(m, kid).connect(f, kid).connect(x, kid);
}, FamilyError);

throws('a cycle refused (child cannot parent its own ancestor)', () => {
  const { t, gp, kid } = tri();
  t.connect(kid, gp); // kid is gp's descendant → would be a cycle
}, CycleError);

{
  const { t, gp, par } = tri();
  const before = t.parentsOf(par).length;
  t.connect(gp, par); // already linked
  check('re-connecting the same edge is idempotent', t.parentsOf(par).length === before);
}

// --- Derived queries: nothing is stored, everything is computed -------------

const { tree, people: p } = sampleTree();

check('tree holds all 14 people', tree.size === 14);
check('find is case-insensitive', tree.find('SUSAN') === p.susan);
check('Emma has two parents', tree.parentsOf(p.emma).length === 2);
check('grandparents are at distance 2', new Set(tree.grandparentsOf(p.emma)).has(p.margaret));
check('Walter is Emma\'s ancestor at distance 3', tree.ancestorsOf(p.emma).get(p.walter) === 3);
check('Emma is Walter\'s descendant at distance 3', tree.descendantsOf(p.walter).get(p.emma) === 3);

// siblings share a parent; Emma & Jack do, Emma & Thomas do not
check('Emma & Jack are siblings', tree.siblingsOf(p.emma).includes(p.jack));
check('Emma has exactly one sibling', tree.siblingsOf(p.emma).length === 1);
check('Susan & Thomas are siblings', tree.siblingsOf(p.susan).includes(p.thomas));

// aunts/uncles and cousins are derived, not stored
check('George is Susan\'s uncle (aunt/uncle of the parent line)', tree.auntsUnclesOf(p.susan).includes(p.george));
check('Daniel is Susan\'s first cousin', tree.cousinsOf(p.susan).includes(p.daniel));
check('Emma\'s first cousins are empty (Daniel is one generation up)', tree.cousinsOf(p.emma).length === 0);

// adding one new relative changes a derived query with NO manual bookkeeping
{
  const { tree: t2, people: q } = sampleTree();
  const sisterBefore = t2.siblingsOf(q.emma).length;
  const lucy = new Person('Lucy', { born: 2005, sex: 'f' });
  t2.add(lucy);
  t2.connect(q.susan, lucy).connect(q.paul, lucy);
  check('a new child instantly appears as a sibling (derived, not stored)',
    t2.siblingsOf(q.emma).length === sisterBefore + 1 && t2.siblingsOf(q.emma).includes(lucy));
  check('…and the other branch instantly relates to her, with no bookkeeping',
    t2.kinship(lucy, q.daniel).label === 'first cousin once removed');
}

// --- The one kinship algorithm names every relationship ---------------------

function rel(a, b) { return tree.kinship(a, b).label; }

// direct lines (one person is the common ancestor)
check('Walter → Emma: great-grandfather', rel(p.walter, p.emma) === 'great-grandfather');
check('Augusta → Emma: great-grandmother', rel(p.augusta, p.emma) === 'great-grandmother');
check('Margaret → Emma: grandmother', rel(p.margaret, p.emma) === 'grandmother');
check('Susan → Emma: mother', rel(p.susan, p.emma) === 'mother');
check('Emma → Walter: great-granddaughter', rel(p.emma, p.walter) === 'great-granddaughter');
check('Emma → Susan: daughter', rel(p.emma, p.susan) === 'daughter');
check('Jack → Walter: great-grandson', rel(p.jack, p.walter) === 'great-grandson');

// siblings
check('Emma & Jack: sister', rel(p.emma, p.jack) === 'sister');
check('Thomas & Susan: brother', rel(p.thomas, p.susan) === 'brother');

// aunts / uncles / nieces / nephews
check('George → Susan: uncle', rel(p.george, p.susan) === 'uncle');
check('Susan → George: niece', rel(p.susan, p.george) === 'niece');
check('George → Emma: great-uncle (one more generation down)', rel(p.george, p.emma) === 'great-uncle');
check('Emma → George: great-niece', rel(p.emma, p.george) === 'great-niece');

// cousins — the heart of it
check('Susan & Daniel: first cousins', rel(p.susan, p.daniel) === 'first cousin');
check('Emma & Oliver: second cousins', rel(p.emma, p.oliver) === 'second cousin');
check('Emma & Daniel: first cousin once removed', rel(p.emma, p.daniel) === 'first cousin once removed');
check('Daniel & Emma: first cousin once removed (symmetric label)', rel(p.daniel, p.emma) === 'first cousin once removed');

// marriage-only and self
check('Susan & Paul: no blood relation (married in)', rel(p.susan, p.paul) === 'no blood relation');
check('Henry & George: no blood relation', rel(p.henry, p.george) === 'no blood relation');
check('Emma & Emma: the same person', rel(p.emma, p.emma) === 'the same person');

// the lowest common ancestor is the most recent one
check('Susan & Daniel share Walter/Augusta at distance (2,2)',
  (() => { const l = tree.lowestCommonAncestors(p.susan, p.daniel); return l.da === 2 && l.db === 2 && l.ancestors.length === 2; })());
check('Susan & Thomas\' LCA is their own parents (distance 1), not the grandparents',
  (() => { const l = tree.lowestCommonAncestors(p.susan, p.thomas); return l.da === 1 && l.db === 1; })());

// the relationship() sentence reads correctly
check('relationship() phrases A relative to B',
  tree.relationship(p.susan, p.daniel) === "Susan is Daniel's first cousin");

// --- kinshipLabel wording rules, pinned directly ----------------------------

check('(0,1,m) = father', kinshipLabel(0, 1, 'm') === 'father');
check('(0,2,f) = grandmother', kinshipLabel(0, 2, 'f') === 'grandmother');
check('(0,4,m) = great-great-grandfather', kinshipLabel(0, 4, 'm') === 'great-great-grandfather');
check('(1,1,f) = sister', kinshipLabel(1, 1, 'f') === 'sister');
check('(1,1,undefined) = sibling', kinshipLabel(1, 1, undefined) === 'sibling');
check('(1,2,m) = uncle', kinshipLabel(1, 2, 'm') === 'uncle');
check('(3,1,f) = great-niece', kinshipLabel(3, 1, 'f') === 'great-niece');
check('(2,2) = first cousin', kinshipLabel(2, 2, 'f') === 'first cousin');
check('(3,3) = second cousin', kinshipLabel(3, 3, 'm') === 'second cousin');
check('(2,4) = first cousin twice removed', kinshipLabel(2, 4, 'f') === 'first cousin twice removed');

// --- JSON round-trips --------------------------------------------------------

check('tree JSON lists people with their edges',
  (() => { const j = tree.toJSON(); const e = j.people.find((x) => x.name === 'Emma'); return e.parents.length === 2 && j.people.length === 14; })());

// --- report -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('All Family Tree assertions passed.');
