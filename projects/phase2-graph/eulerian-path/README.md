# Eulerian Path

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**second entry of its Graph category**, and the twenty-eighth Source 2 project
overall. It follows [Graph from Links](../graph-from-links/).

> "Eulerian Path — An Eulerian path is a path in a graph which visits every edge
> exactly once. Write a program that finds one."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

- **Decides the question first.** Type a list of links — one edge per line — and
  the page tells you, before drawing anything, whether the graph can be traced
  in one unbroken stroke that crosses every edge exactly once: an Eulerian
  **circuit** (returns to its start), an Eulerian **path** (starts and ends
  somewhere different), or **neither** — with the reason spelled out.
- **Then walks one out.** When a trail exists, [Hierholzer's
  algorithm](https://en.wikipedia.org/wiki/Eulerian_path#Hierholzer's_algorithm)
  produces an actual route in O(V + E), and the page **animates it**, numbering
  each edge in the order it is crossed and lighting up the current step.
- **Colours the tell-tale vertices.** Odd-degree vertices are amber; on a path,
  the forced **start** (green) and **end** (yellow) are marked, so you can see
  *why* the answer is what it is.
- **Six worked examples**, including the **Seven Bridges of Königsberg** — the
  1736 problem that started graph theory — both as Euler found it (no trail) and
  with one bridge removed (a path appears).

## Euler's theorem — you can answer without searching

The remarkable thing is that you never have to hunt for a trail to know whether
one exists. Just count degrees (a vertex's degree is how many edge-ends touch
it; a self-loop counts **twice**):

**Undirected** graph — ignoring isolated vertices, and requiring the edges to
form **one connected piece**:

| Odd-degree vertices | Result |
| --- | --- |
| 0 | Eulerian **circuit** (start anywhere, return there) |
| exactly 2 | Eulerian **path** — it *must* start at one odd vertex and end at the other |
| any other count | **no** Eulerian trail |

**Directed** graph — edges forming one weakly-connected piece:

| Balance | Result |
| --- | --- |
| every vertex `in == out` | Eulerian **circuit** |
| one vertex `out − in = +1` (start), one `in − out = +1` (end), rest balanced | Eulerian **path** |
| anything else | **no** Eulerian trail |

The intuition: every time a trail *passes through* a vertex it uses one edge to
arrive and one to leave, consuming degrees two at a time. So every vertex needs
even degree — except the two ends of an open path, which are entered (or left)
one extra time.

## The one design choice everything rests on — this is a *multigraph*

Königsberg has **two** bridges between the same pair of banks, and a walk must
cross **both**. So, unlike the sibling [Graph from
Links](../graph-from-links/) project (which stores a *simple* graph and
collapses parallel links into one), this project keeps **every parsed link as a
distinct edge** with its own id, and **self-loops are real edges** that must be
traversed. Parallel links and self-loops are counted and shown, never dropped —
they are exactly what the degree counting and the trail depend on.

## How the trail is found, and checked

**Hierholzer's algorithm** builds the trail without backtracking: from the
required start vertex it walks down unused edges until it gets stuck (necessarily
back at the start, for a circuit), then splices in the side-cycles it skipped.
It's iterative here, with a per-vertex cursor that skips already-used edges, so
each edge stub is examined once — O(V + E) overall.

Because "trust me, it's Eulerian" is not good enough, `graph-core.js` also ships
an **independent verifier** (`verifyTrail`): it re-walks the returned trail edge
by edge, checking that consecutive vertices really are joined by the claimed
edge, that no edge is used twice, and that *every* edge is used. The UI runs it
on every answer and prints "Verified: every edge used exactly once, in order".

## Tests

`tests.js` is a dependency-free suite (51 checks). Run it with Node:

```bash
node projects/phase2-graph/eulerian-path/tests.js
```

It verifies:

1. **Multigraph building** — parallel links and self-loops are kept as distinct
   edges and counted; degrees are right (a self-loop is +2 undirected, +1/+1
   directed).
2. **Classification on the classics** — the Seven Bridges of Königsberg has four
   odd vertices and yields **no trail**; removing one bridge leaves exactly two
   odd vertices and yields a **path** between them; a square is all-even and
   yields a **circuit**; disjoint edges yield **none** (disconnected).
3. **Directed classification** — a directed cycle is a circuit, a directed path
   is a path (with the right start/end), unbalanced in/out degrees give none,
   and a directed self-loop stays balanced.
4. **Trail construction + independent verification** — every trail the solver
   returns is re-walked by `verifyTrail`; the verifier is shown to reject a
   tampered trail that reuses an edge.
5. **A randomised fuzz loop** — 400 small multigraphs, directed and undirected,
   where the solver's yes/no (and circuit-vs-path) is checked against a
   **brute-force backtracking oracle**, and every trail the solver produces is
   independently verified.
6. **The layout** is deterministic (same seed ⇒ identical coordinates), places
   every node at a finite, in-bounds point, and degenerate sizes don't throw.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The workbench: the links textarea, the SVG picture, the verdict read-out. |
| `style.css` | Dark theme, the two-column layout, the SVG node/edge/trail styling. |
| `graph-core.js` | Parsing, multigraph building, Euler classification, Hierholzer's algorithm, the verifier, and the force layout. UMD-ish: works under Node and as a browser global. |
| `script.js` | DOM controller — draws the network (curving parallels, looping self-loops), numbers and animates the trail, paints the verdict. |
| `tests.js` | The Node test suite described above. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
