# Minimum Spanning Tree

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**fifth and final entry of its Graph category**, and the thirty-first Source 2
project overall. It follows [Dijkstra's Algorithm](../dijkstra/).

> "Minimum Spanning Tree — Prim's and Kruskal's algorithm[s]."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

A **minimum spanning tree** answers a very practical question: *what is the
cheapest set of links that still keeps everything connected?* Lay cable to every
house, build roads between every town, wire up a circuit — using the least total
length, with no redundant loop. This page computes that, and draws it.

- **Type a weighted graph.** One link per line, with a cost: `home -- shop : 2`.
  Edges are undirected — a tree has no direction, so an arrow is read as a plain
  link.
- **The headline number.** The banner shows the **minimum total weight** and how
  many edges the tree uses (always one fewer than the number of nodes, for a
  connected graph).
- **The tree, drawn.** The chosen edges light up <span>green</span>; the edges
  left out — too heavy to be worth it — fade into the background. Every edge is
  labelled with its weight.
- **Two algorithms, one answer.** Switch between **Kruskal's** (sort all edges,
  add the lightest that doesn't close a loop) and **Prim's** (grow one tree
  outward, always taking the cheapest edge leaving it). They take completely
  different routes to the *same* total — and the page checks that they agree.
- **Watch it build.** *Watch it build* animates the chosen algorithm: Kruskal's
  sweeps edges lightest-first, each one flashing <span>amber</span> as it's
  considered and <span>red</span> (dashed) when it's rejected for closing a
  cycle; Prim's grows the tree outward from its seed node.
- **Disconnected? A forest, honestly.** If the graph comes in separate pieces
  there is no single spanning tree, so the page returns a **minimum spanning
  forest** — one MST per piece — and says so, rather than pretending otherwise.
- **The edge table** lists every edge lightest-first and marks each one *kept* or
  *dropped*, so you can see exactly which links made the cut.
- **Six worked examples**, from the CLRS textbook graph (total 37) to a triangle
  shortcut, a square with a useless diagonal, a road network, two disconnected
  islands, and a 3×3 grid.

## The two algorithms

Both rest on one fact, the **cut property**: for any way of splitting the nodes
into two groups, the single cheapest edge crossing between them is safe to put in
*some* MST. Kruskal's and Prim's are just two disciplines for repeatedly applying
it.

**Kruskal's — cheapest edge first, skip anything that loops.** Sort every edge by
weight. Walk them lightest to heaviest; add an edge **only if its two endpoints
are not already connected** (otherwise it would close a cycle and waste weight).
The "already connected?" test is the job of a **disjoint-set / union-find**
structure, which answers it — and merges two groups — in effectively constant
time. When you run out of edges you have an MST (or, on a disconnected graph, a
forest).

**Prim's — grow one tree outward.** Start from any node. Repeatedly add the
**cheapest edge that leads from the tree to a node not yet in it**, pulling that
node in. A **binary min-heap** of the edges on the frontier makes "cheapest
crossing edge" fast to find. To cover a disconnected graph, restart from the next
untouched node once the current tree can grow no further.

Different data structures, different order of work — **identical total weight**,
every time.

## Why the answer is trustworthy

"Trust me, this is minimal" is not good enough, so every answer is backed by
**independent checks** — in [`mst-core.js`](./mst-core.js) and exercised by
[`tests.js`](./tests.js) — that share no logic with the algorithm they judge:

- **Kruskal's total ↔ Prim's total.** Two different algorithms; if they ever
  disagree on the total weight, something is wrong.
- **Small totals ↔ brute force.** For tiny graphs, *every* spanning forest is
  enumerated exhaustively and the lightest kept — the definition of the answer,
  computed the slow, unarguable way.
- **Optimality ↔ the cycle property.** A spanning tree is minimal **iff** for
  every edge *not* in it, that edge is at least as heavy as the heaviest edge on
  the tree path between its endpoints. (If some left-out edge were lighter,
  swapping it in for that heavy edge would give a cheaper tree.) The code looks
  for a violating edge; finding none is a self-contained *proof* of minimality —
  and a deliberately-wrong tree in the tests confirms the check actually fires.
- **Structure ↔ re-checked.** The result is re-verified to be a genuine spanning
  forest: acyclic, every edge real, and exactly `nodes − components` of them.

The page shows a **✓ Verified** line summarising these checks live, so the proof
travels with the picture.

## Run the tests

```bash
node projects/phase2-graph/minimum-spanning-tree/tests.js
```

Hand-worked classics (a line, a triangle, the CLRS graph, a disconnected forest,
negative weights, a parallel edge that must collapse to the cheaper one, an
ignored self-loop) plus a randomised fuzz loop that throws hundreds of small
weighted graphs at both algorithms and all the oracles and demands they agree on
every one.

## Files

| File | What's in it |
| --- | --- |
| [`index.html`](./index.html) | The page: input, SVG canvas, controls, read-out. |
| [`style.css`](./style.css) | The dark house-style theme. |
| [`mst-core.js`](./mst-core.js) | All the logic: parsing, Kruskal's, Prim's, union-find, the oracles, and a deterministic graph layout. No DOM, runs under Node. |
| [`script.js`](./script.js) | The DOM controller: draws the graph, highlights the tree, animates the build, fills the table. Owns no algorithm. |
| [`tests.js`](./tests.js) | The dependency-free verification suite. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
