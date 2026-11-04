# Family Tree Creator

> Source 2 (karan/Projects) · **Classes (Object-Oriented Programming)** · project 10 of 10
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Create a class called Person that will have a
name, when they were born and when (and if) they died. Then create instances for
your relatives, set up their relationships (parent, child, …), and query the tree
to find relationships — who is X's grandfather, who are Y's cousins, …"*

Like every task in this category, the point is the **design**, not how many
relatives are on screen. The naive version stores a `parent` string and a
`children` list on each `Person`, hand-writes a method per relationship
(`grandparents()`, `cousins()`, `auntsUncles()`…), and gets "second cousin once
removed" wrong because nobody can keep the kinship rules in their head. It gets
three things wrong, each about *where facts and behaviour should live*.

## The design in three ideas

### 1. One source of truth — relationships are *derived*, not stored

A `Person` is a frozen value object: a name, a birth year, an optional death
year, an optional sex. It holds **no** relatives at all. The only fact ever
stored is an atomic **parent→child edge**, owned by the `FamilyTree`. Everything
else — siblings, grandparents, aunts, first cousins, every ancestor and
descendant — is **computed by walking those edges**.

The trap is `person.siblings = [...]`, `person.grandparents = [...]` kept as
separate lists: the moment you add one more relative they're stale, and you're
back to manually poking a dozen arrays to keep them in sync. Here there is one
kind of stored fact and ~12 relationship queries that are all *views* over it.
A test pins this: add a new child to the tree and the other branch's "first
cousin once removed" query answers correctly **with zero bookkeeping**, because
nothing was cached to go stale.

### 2. The tree enforces its own invariants — an impossible family won't build

Every edge goes through **one chokepoint**, `connect(parent, child)`, which
updates both directions at once (so the parent map and child map can never
disagree) and refuses anything that would corrupt the tree:

- a person can't be their **own parent**;
- a child can't have a **third** parent;
- a person can't be **added twice**, or linked to someone **not in the tree**;
- a link that would make someone **their own ancestor** throws `CycleError`.

The naive version lets you write `child.parent = child` and only finds out when
a traversal spins forever. Here a malformed tree is simply *unconstructable* —
the invariant lives in the one method that can change the graph.

### 3. One kinship algorithm names *every* blood relationship

This is the real payoff of modelling the family as a graph. There is **no**
special-case method per relationship name. Instead:

> Find the **lowest common ancestor** of two people, measure how many generations
> each sits below it, and the pair of distances **(dA, dB) _is_ the relationship.**

| (dA, dB) | relationship of A to B |
| --- | --- |
| (0, k) | ancestor — parent / grandparent / great-grandparent |
| (k, 0) | descendant — child / grandchild / great-grandchild |
| (1, 1) | sibling |
| (1, 2) / (2, 1) | aunt-uncle / niece-nephew |
| (2, 2) | first cousin |
| (3, 3) | second cousin |
| (2, 3) | first cousin **once removed** |
| no common ancestor | no blood relation (married in) |

The general rule: with both distances ≥ 1, the cousin **degree** is
`min(dA, dB) − 1` and the **"removed"** count is `|dA − dB|`. Sex only chooses the
word (mother/father, niece/nephew); it never changes the logic. One function
names the relationship between *any* two people, and adding "great-great-aunt"
needs no new code — it's just a larger `removed`.

## Running it

**The browser demo** — open `index.html`. Pick any two people and the tree tells
you how they're related, showing the lowest common ancestor and the `(dA, dB)`
pair it used. Click any name in the family tree to see all of their relatives,
each one a live query over the edges.

**The CLI** (same classes, no dependencies):

```sh
node family-node.js                   # the family tree, indented from the roots
node family-node.js --people          # everyone with lifespans
node family-node.js who Emma          # parents, children, siblings, cousins…
node family-node.js rel Susan Daniel  # → "Susan is Daniel's first cousin."
node family-node.js rel Emma Daniel   # → "…first cousin once removed."
node family-node.js ancestors Emma    # everyone above, by generation
node family-node.js --repl            # interactive

# pipe ';'-separated commands:
echo "rel Emma Oliver; who George" | node family-node.js
```

REPL / stdin commands: `people`, `tree`, `who <name>`, `rel <A> <B>`,
`ancestors <name>`, `descendants <name>`, `json`, `help`, `quit`.

**The tests:**

```sh
node tests.js        # 70 dependency-free assertions, exit code 0 on success
```

They lean on the guarantees, not the surface: the two edge maps never disagree;
the invariants reject cycles, third parents, duplicates and strangers; a newly
added relative shows up in derived queries with no manual sync; and the kinship
algorithm is checked across the whole table above — great-grandparent, sibling,
aunt/uncle, great-niece, first and second cousins, cousins once and twice
removed, marriage-only (no blood relation), and the gendered wording.

## The sample family

Four generations, chosen so every relationship kind exists:

```
Walter ∞ Augusta                 (great-grandparents)
   ├── Margaret ∞ Henry
   │      ├── Susan ∞ Paul
   │      │      ├── Emma
   │      │      └── Jack
   │      └── Thomas
   └── George ∞ Linda
          └── Daniel ∞ Rachel
                 └── Oliver
```

Susan & Daniel are first cousins; Emma & Oliver are second cousins; Emma &
Daniel are first cousins once removed; George is Emma's great-uncle; Henry,
Paul, Linda and Rachel married in, so each is "no blood relation" of the
Walter/Augusta line.

## Files

| File | What's in it |
| --- | --- |
| `family-core.js` | the engine: `Person` (a frozen value object), `FamilyTree` (owns every edge + the invariants), the derived relationship queries, and the one kinship algorithm (`lowestCommonAncestors` → `kinshipLabel`) |
| `family-fixtures.js` | the four-generation sample family shared by the CLI, tests and browser |
| `family-node.js` | the CLI / REPL over the same classes |
| `tests.js` | dependency-free assertions |
| `index.html`, `style.css`, `script.js` | the browser demo (all relationships live in the core; this only paints) |

---

*This project is one entry in a daily automated series. A [Claude Code](https://claude.com/claude-code)
routine builds one project from a public project list each day, writes it up, and
merges it. See the repository root `README.md` and `PROGRESS.md` for the full run.*
