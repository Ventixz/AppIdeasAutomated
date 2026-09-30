# Connected Graph

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**third entry of its Graph category**, and the twenty-ninth Source 2 project
overall. It follows [Eulerian Path](../eulerian-path/).

> "Connected Graph — Create a program which takes a graph as an input and
> outputs whether every node is connected or not."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

"Connected" is one word that hides two questions, and the page answers both —
and, more usefully, shows **why** the answer is what it is.

- **The headline yes/no.** Type a list of links — one edge per line — and the
  page tells you whether *every node can reach every other*. An isolated node,
  or two clusters with no link between them, means **not connected**, and the
  separate pieces are listed.
- **Undirected: how *robustly* connected?** A path `a–b–c–d–e` is connected but
  fragile — cut the node in the middle and it falls in two. So when the graph is
  connected, the page finds its **single points of failure**:
  - **Cut vertices** (articulation points), coloured **amber** — remove one and
    the graph splits.
  - **Bridges** (cut edges), drawn in **orange** — remove one and the graph
    splits.

  No cut vertex ⇒ the graph is **2-connected** (biconnected); no bridge ⇒
  **2-edge-connected**. That is the gap between "connected" and "connected *and*
  resilient", and the verdict banner reports both.
- **Directed: weak vs strong.** `a → b → c` is one piece if you ignore the arrow
  directions (**weakly** connected) but you can't get back from `c` to `a`
  (**not strongly** connected). The page separates the two and, when it isn't
  strongly connected, colours the **strongly-connected components** — the
  clusters of mutually-reachable nodes.
- **Watch it for yourself.** Click any node (or use the control) to run an
  animated **flood fill** from it: the reachable nodes light up one hop at a
  time, following the arrows on a directed graph. If the flood reaches every
  node, that *is* the connectivity proof, drawn.
- **Eight worked examples**, from a resilient ring to a fragile path, a barbell
  with one bridge, three disconnected islands, a parallel edge that saves a
  bridge, and directed graphs that are weakly-but-not-strongly connected.

## The ideas it rests on

**Connectivity by search.** Whether a graph is connected is answered by one
graph search: flood out from any node and count how many you reach. Reach them
all ⇒ connected. For a directed graph, "weakly connected" floods ignoring
arrow directions; the page's animated flood *follows* arrows, which is why it can
also show that a weakly-connected graph fails the stronger test.

**Cut vertices & bridges — Tarjan's low-link DFS.** You could find every cut
vertex by removing each node and re-checking connectivity (O(V·(V+E))), and the
tests do exactly that as an oracle. But one depth-first search finds them all at
once. For each node it records a discovery time `disc` and a `low` value — the
earliest node reachable from its DFS subtree using at most one "back" edge. A
non-root node `u` is a cut vertex when it has a child `v` whose subtree can't
reach above `u` (`low[v] ≥ disc[u]`); the DFS root is a cut vertex exactly when
it has two or more DFS children. An edge is a **bridge** when `low[v] > disc[u]`
— the child's subtree has *no* way back at all.

**Strong connectivity — Tarjan's SCC.** A second low-link DFS, with a stack of
the current path, groups nodes into strongly-connected components in linear time:
when a node's low-link equals its own index, it's the root of an SCC and the
stack is popped down to it. One SCC ⇒ strongly connected.

## The one design choice everything rests on — multiplicity for bridges

The stored graph is a **simple** graph: parallel links collapse to one edge and
self-loops are kept, both *counted*. Neither changes whether a graph is
connected, so a simple graph is the honest model for the headline question.

But a bridge finder that treated two roads between the same pair of towns as one
edge would **lie** — it would call that doubled road a bridge when in fact either
road can fail and the towns stay joined. So `buildGraph` records the true
**multiplicity** of every undirected pair, and the bridge test refuses to flag an
edge that has a parallel. The *Parallel saves it* example demonstrates exactly
this: `a–b` given twice is not a bridge, while the single `b–c` is.

## Everything is independently verified

Because "trust me, it's connected" isn't good enough, every non-trivial answer
is confirmed against a second, simpler method, and the page prints
"✓ Verified …" when they agree:

| Claim | Fast algorithm | Independent check |
| --- | --- | --- |
| connected? | flood fill / component scan | a *second* flood fill (`verifyConnectedByFlood`) |
| cut vertices | Tarjan low-link | remove each vertex, recount pieces |
| bridges | Tarjan low-link | remove each edge, recount pieces |
| strongly-connected comps | Tarjan SCC | all-pairs mutual reachability |

## Tests

`tests.js` is a dependency-free suite (84 checks). Run it with Node:

```bash
node projects/phase2-graph/connected-graph/tests.js
```

It verifies:

1. **Parsing & building** — every separator style, comments, isolated nodes,
   parallel-link and self-loop counting, and recorded multiplicity.
2. **Connectivity** on the classics (path, triangle, two islands, isolated node,
   empty graph) and agreement with the independent flood fill.
3. **Cut vertices & bridges** on hand-worked shapes (path, cycle, star, barbell,
   a parallel edge that defeats a bridge) *and* against a brute-force
   remove-and-recount oracle.
4. **Strong connectivity** on directed classics (a chain, a ring, two cycles
   joined one-way) *and* against an all-pairs-reachability oracle.
5. **The one-shot `analyze` verdict** — `connected`, `biconnected`,
   `twoEdgeConnected`, `weaklyConnected`, `stronglyConnected`, `sccCount`.
6. **A randomised fuzz loop** — 600 small graphs, directed and undirected, where
   connectivity, cut vertices, bridges, and SCCs from the fast algorithms are all
   checked against the brute-force oracles (1,469 checks in all).
7. **The layout** is deterministic (same seed ⇒ identical coordinates), places
   every node at a finite, in-bounds point, and degenerate sizes don't throw.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The workbench: the links textarea, the verdict banner, the SVG picture, the read-out. |
| `style.css` | Dark theme, the two-column layout, the node/edge/cut-vertex/bridge/flood styling. |
| `connectivity-core.js` | Parsing, simple-graph building, connectivity, Tarjan cut vertices & bridges, Tarjan SCC, the verifiers/oracles, and the force layout. UMD-ish: works under Node and as a browser global. |
| `script.js` | DOM controller — draws the network (arrows, self-loops, component tint rings), paints the verdict and findings, and animates the flood fill. |
| `tests.js` | The Node test suite described above. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
