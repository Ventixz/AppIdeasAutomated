'use strict';
/*
 * family-core.js — the engine behind "Family Tree Creator".
 *
 * karan/Projects brief (Classes category): "Create a class called Person that
 * will have a name, when they were born and when (and if) they died. Then allow
 * the user to create instances of relatives, set up their relationships (parent,
 * child, …), and query the tree to find relationships (who is X's grandfather,
 * who are Y's cousins, …)."
 *
 * The Classes category is about DESIGN, not feature count, so this file is built
 * around three ideas — each one a place where the naive version gets it wrong:
 *
 *   1. ONE SOURCE OF TRUTH — the only fact ever stored is an atomic parent→child
 *      edge. Grandparents, siblings, aunts, cousins, ancestors and descendants
 *      are never stored; they are *derived* by walking those edges. The naive
 *      version keeps `person.siblings`, `person.grandparents`, … as separate
 *      lists that go stale the instant one more relative is added. Here there is
 *      exactly one kind of stored fact, and every relationship is a view over it.
 *
 *   2. THE TREE ENFORCES ITS OWN INVARIANTS — you cannot build an impossible
 *      family. A person can't be their own ancestor (no cycles), can't have more
 *      than two biological parents, can't be added twice, can't be linked to
 *      someone who isn't in the tree. Those checks live in the single chokepoint
 *      `connect()`, so a malformed tree is simply unconstructable. The naive
 *      version lets you set `child.parent = child` and only finds out when a
 *      traversal hangs forever.
 *
 *   3. ONE KINSHIP ALGORITHM, NOT A SPECIAL CASE PER NAME — grandparent, cousin,
 *      aunt/uncle, "second cousin once removed" are NOT fifteen bespoke methods.
 *      They all fall out of one computation: find the lowest common ancestor of
 *      two people, measure how many generations each is below it, and the pair of
 *      distances (dA, dB) *is* the relationship. (1,1)=siblings, (2,2)=first
 *      cousins, (1,2)=aunt/uncle, (2,3)=first cousin once removed, (0,k)=direct
 *      ancestor. One function names every blood relationship between any two
 *      people — that is the real payoff of modelling the family as a graph.
 *
 * No dependencies, no build step. Shared by the CLI, the tests and the browser.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class FamilyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FamilyError';
  }
}

/** A link that would make someone their own ancestor. */
class CycleError extends FamilyError {
  constructor(parent, child) {
    super(`"${parent.name}" is already a descendant of "${child.name}" — that link would create a cycle`);
    this.name = 'CycleError';
  }
}

/** A person referenced who was never added to the tree. */
class UnknownPersonError extends FamilyError {
  constructor(who) {
    super(`"${who}" is not in this family tree`);
    this.name = 'UnknownPersonError';
  }
}

// ---------------------------------------------------------------------------
// Person — a frozen descriptive value object. Holds NO relationship state.
// ---------------------------------------------------------------------------

/**
 * A person is just a description: a name, a birth year, an optional death year,
 * and an optional sex used only to pick gendered relationship words
 * (mother/father, niece/nephew, …). It deliberately stores no parents or
 * children — who is related to whom is the tree's job, not the person's, so a
 * Person can never carry a stale list. Immutable and frozen.
 */
class Person {
  constructor(name, { born, died, sex } = {}) {
    if (!name || typeof name !== 'string') throw new FamilyError('a person needs a name');
    if (born !== undefined && !Number.isInteger(born)) throw new FamilyError(`${name}: "born" must be a whole year`);
    if (died !== undefined) {
      if (!Number.isInteger(died)) throw new FamilyError(`${name}: "died" must be a whole year`);
      if (born !== undefined && died < born) throw new FamilyError(`${name}: died (${died}) before born (${born})`);
    }
    if (sex !== undefined && sex !== 'f' && sex !== 'm') throw new FamilyError(`${name}: sex must be 'f', 'm' or omitted`);
    this.name = name;
    this.born = born;
    this.died = died;
    this.sex = sex;
    Object.freeze(this);
  }

  get isAlive() { return this.died === undefined; }

  /** Age in whole years as of `asOf` (default: now). Undefined if birth unknown. */
  age(asOf = new Date().getFullYear()) {
    if (this.born === undefined) return undefined;
    const end = this.died !== undefined ? this.died : asOf;
    return end - this.born;
  }

  /** "1945–1998" / "1970–" / "b. 1970" / "" when nothing is known. */
  get lifespan() {
    if (this.born === undefined && this.died === undefined) return '';
    if (this.died !== undefined) return `${this.born !== undefined ? this.born : '?'}–${this.died}`;
    return this.born !== undefined ? `${this.born}–` : '';
  }

  describe() {
    const span = this.lifespan ? ` (${this.lifespan})` : '';
    return `${this.name}${span}`;
  }

  toString() { return this.name; }
  toJSON() { return { name: this.name, born: this.born, died: this.died, sex: this.sex }; }
}

// ---------------------------------------------------------------------------
// Relationship wording — pure functions from (dA, dB, sex) to a kinship label.
// This is where the single kinship algorithm's output is turned into English.
// ---------------------------------------------------------------------------

const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times'];

function ordinal(n) { return ORDINALS[n] || `${n}th`; }
function timesRemoved(n) { return n === 0 ? '' : ` ${TIMES[n] || n + ' times'} removed`; }

/** Pick a word by sex: female / male / neutral fallback. */
function bySex(sex, female, male, neutral) {
  return sex === 'f' ? female : sex === 'm' ? male : neutral;
}

/** "great-" × n, e.g. greats(2) === "great-great-". */
function greats(n) { return 'great-'.repeat(n); }

/**
 * Turn the distance pair (da, db) — A's and B's generations up to their lowest
 * common ancestor — into the label for A *relative to* B, gendered by A's sex.
 * `null` when the pair means A and B are the same person is handled by caller.
 */
function kinshipLabel(da, db, sexOfA) {
  // Lineal: A is an ancestor of B (da === 0) or a descendant of B (db === 0).
  if (da === 0) return ancestorWord(db, sexOfA);   // A is B's parent / grandparent / …
  if (db === 0) return descendantWord(da, sexOfA); // A is B's child / grandchild / …

  const nearer = Math.min(da, db);
  const removed = Math.abs(da - db);

  if (nearer === 1) {
    // A or B is a child of the common ancestor → sibling / avuncular line.
    if (removed === 0) return bySex(sexOfA, 'sister', 'brother', 'sibling');       // (1,1)
    // da < db → A sits closer to the ancestor → A is B's aunt/uncle (grand-, …).
    // da > db → A sits farther → A is B's niece/nephew (grand-, …).
    return da < db ? avuncularWord(removed, sexOfA) : niblingWord(removed, sexOfA);
  }

  // Cousins: degree = (generations to the nearer side) − 1; "removed" = the gap.
  const degree = nearer - 1;
  return `${ordinal(degree)} cousin${timesRemoved(removed)}`;
}

function ancestorWord(gen, sex) {
  if (gen === 1) return bySex(sex, 'mother', 'father', 'parent');
  // gen 2 = grandparent, 3 = great-grandparent, …
  return greats(gen - 2) + bySex(sex, 'grandmother', 'grandfather', 'grandparent');
}

function descendantWord(gen, sex) {
  if (gen === 1) return bySex(sex, 'daughter', 'son', 'child');
  return greats(gen - 2) + bySex(sex, 'granddaughter', 'grandson', 'grandchild');
}

function avuncularWord(removed, sex) {
  // removed 1 = aunt/uncle, 2 = great-aunt/uncle, …
  return greats(removed - 1) + bySex(sex, 'aunt', 'uncle', 'aunt or uncle');
}

function niblingWord(removed, sex) {
  // removed 1 = niece/nephew, 2 = great-niece/nephew, …
  return greats(removed - 1) + bySex(sex, 'niece', 'nephew', 'niece or nephew');
}

// ---------------------------------------------------------------------------
// FamilyTree — owns every edge and every invariant. All relationships derive.
// ---------------------------------------------------------------------------

class FamilyTree {
  constructor(name = 'Family') {
    this.name = name;
    this._people = new Set();            // every Person in the tree
    this._parents = new Map();           // Person -> Set<Person> (its parents)
    this._children = new Map();          // Person -> Set<Person> (its children)
  }

  // --- building the tree (the only mutating methods) ------------------------

  /** Add a person. Adding the same Person object twice is refused. */
  add(person) {
    if (!(person instanceof Person)) throw new FamilyError('only Person objects can be added');
    if (this._people.has(person)) throw new FamilyError(`"${person.name}" is already in the tree`);
    this._people.add(person);
    this._parents.set(person, new Set());
    this._children.set(person, new Set());
    return this;
  }

  has(person) { return this._people.has(person); }

  _require(person, label = 'person') {
    if (!(person instanceof Person)) throw new FamilyError(`${label} must be a Person`);
    if (!this._people.has(person)) throw new UnknownPersonError(person.name);
    return person;
  }

  /**
   * The ONE chokepoint: record that `parent` is a parent of `child`. Updates both
   * directions at once (so the two maps can never disagree), and enforces every
   * invariant here so a bad tree cannot be built:
   *   - both people must already be in the tree;
   *   - a person cannot be their own parent;
   *   - a child cannot have more than two parents;
   *   - the link must not create a cycle (parent already a descendant of child).
   */
  connect(parent, child) {
    this._require(parent, 'parent');
    this._require(child, 'child');
    if (parent === child) throw new FamilyError(`"${parent.name}" cannot be their own parent`);

    const existing = this._parents.get(child);
    if (existing.has(parent)) return this; // idempotent — already linked
    if (existing.size >= 2) throw new FamilyError(`"${child.name}" already has two parents`);
    // A cycle would occur iff `parent` is already a descendant of `child`.
    if (this._isDescendant(parent, child)) throw new CycleError(parent, child);

    existing.add(parent);
    this._children.get(parent).add(child);
    return this;
  }

  /** True if `maybe` is `of` itself or appears anywhere below `of`. */
  _isDescendant(maybe, of) {
    if (maybe === of) return true;
    const seen = new Set();
    const stack = [...this._children.get(of)];
    while (stack.length) {
      const node = stack.pop();
      if (node === maybe) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const c of this._children.get(node)) stack.push(c);
    }
    return false;
  }

  // --- looking people up ----------------------------------------------------

  get people() { return [...this._people]; }
  get size() { return this._people.size; }

  /** First person whose name matches (case-insensitive). */
  find(name) {
    const want = String(name).trim().toLowerCase();
    return this.people.find((p) => p.name.toLowerCase() === want) || null;
  }

  findAll(name) {
    const want = String(name).trim().toLowerCase();
    return this.people.filter((p) => p.name.toLowerCase() === want);
  }

  // --- the immediate (stored) edges, as arrays ------------------------------

  parentsOf(p) { return [...this._parents.get(this._require(p))]; }
  childrenOf(p) { return [...this._children.get(this._require(p))]; }

  /** People with no recorded parents — the top of the tree. */
  roots() { return this.people.filter((p) => this._parents.get(p).size === 0); }

  // --- everything else is DERIVED from those edges --------------------------

  /** Map of every ancestor → its minimum distance above `p` (self excluded). */
  ancestorsOf(p) { return this._climb(this._require(p), this._parents, false); }

  /** Map of every descendant → its minimum distance below `p` (self excluded). */
  descendantsOf(p) { return this._climb(this._require(p), this._children, false); }

  /** BFS over a direction map, returning Map<Person, distance>. */
  _climb(start, edges, includeSelf) {
    const dist = new Map();
    if (includeSelf) dist.set(start, 0);
    let frontier = [start];
    let d = 0;
    while (frontier.length) {
      d += 1;
      const next = [];
      for (const node of frontier) {
        for (const neighbour of edges.get(node)) {
          if (!dist.has(neighbour)) { dist.set(neighbour, d); next.push(neighbour); }
        }
      }
      frontier = next;
    }
    if (!includeSelf) dist.delete(start);
    return dist;
  }

  /** Ancestor distances including `p` itself at 0 — the basis for kinship. */
  _ancestorDistances(p) { return this._climb(p, this._parents, true); }

  grandparentsOf(p) { return this._atDistance(this.ancestorsOf(p), 2); }
  grandchildrenOf(p) { return this._atDistance(this.descendantsOf(p), 2); }

  _atDistance(map, n) {
    const out = [];
    for (const [person, d] of map) if (d === n) out.push(person);
    return out;
  }

  /** People sharing at least one parent with `p` (p excluded). */
  siblingsOf(p) {
    this._require(p);
    const sibs = new Set();
    for (const parent of this._parents.get(p)) {
      for (const child of this._children.get(parent)) if (child !== p) sibs.add(child);
    }
    return [...sibs];
  }

  /** Blood siblings of `p`'s parents — the aunts and uncles. */
  auntsUnclesOf(p) {
    this._require(p);
    const out = new Set();
    for (const parent of this._parents.get(p)) for (const s of this.siblingsOf(parent)) out.add(s);
    return [...out];
  }

  /** Children of `p`'s aunts and uncles — the first cousins. */
  cousinsOf(p) {
    const out = new Set();
    for (const au of this.auntsUnclesOf(p)) for (const c of this._children.get(au)) out.add(c);
    return [...out];
  }

  /**
   * The lowest (most recent) common ancestor(s) of A and B, with each one's
   * distance up to it. Returns { ancestors, da, db } or null if no blood path.
   * "Lowest" = the common ancestor minimising (da + db); ties keep them all.
   */
  lowestCommonAncestors(a, b) {
    this._require(a, 'a'); this._require(b, 'b');
    const da = this._ancestorDistances(a);
    const db = this._ancestorDistances(b);
    let best = Infinity;
    let picked = [];
    for (const [anc, d1] of da) {
      if (!db.has(anc)) continue;
      const d2 = db.get(anc);
      const sum = d1 + d2;
      if (sum < best) { best = sum; picked = [{ ancestor: anc, da: d1, db: d2 }]; }
      else if (sum === best) picked.push({ ancestor: anc, da: d1, db: d2 });
    }
    if (picked.length === 0) return null;
    return { ancestors: picked.map((x) => x.ancestor), da: picked[0].da, db: picked[0].db };
  }

  /**
   * Structured kinship of A relative to B: { label, da, db, via }. One call
   * covers every blood relationship. `null`-ish cases are returned as labels so
   * callers never have to special-case them.
   */
  kinship(a, b) {
    this._require(a, 'a'); this._require(b, 'b');
    if (a === b) return { label: 'the same person', da: 0, db: 0, via: [] };
    const lca = this.lowestCommonAncestors(a, b);
    if (!lca) return { label: 'no blood relation', da: null, db: null, via: [] };
    return { label: kinshipLabel(lca.da, lca.db, a.sex), da: lca.da, db: lca.db, via: lca.ancestors };
  }

  /** "Susan is Daniel's first cousin." — A described relative to B. */
  relationship(a, b) {
    const k = this.kinship(a, b);
    if (k.label === 'the same person') return `${a.name} and ${b.name} are the same person`;
    if (k.label === 'no blood relation') return `${a.name} is no blood relation of ${b.name}`;
    return `${a.name} is ${b.name}'s ${k.label}`;
  }

  toJSON() {
    return {
      name: this.name,
      people: this.people.map((p) => ({
        ...p.toJSON(),
        parents: this.parentsOf(p).map((x) => x.name),
        children: this.childrenOf(p).map((x) => x.name),
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// Module export — works under Node (require) and the browser (global).
// ---------------------------------------------------------------------------

const coreApi = {
  FamilyError, CycleError, UnknownPersonError,
  Person, FamilyTree,
  // exposed for the tests that pin the wording rules directly:
  kinshipLabel,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.FamilyCore = coreApi;
