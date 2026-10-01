# Dijkstra's Algorithm

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**fourth entry of its Graph category**, and the thirtieth Source 2 project
overall. It follows [Connected Graph](../connected-graph/).

> "Dijkstra's Algorithm — ... find the shortest path between two nodes of a
> graph."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

Dijkstra's algorithm answers a question with a deceptively small name — *what is
the shortest path?* — and this page answers the fuller version of it: from one
**source**, the cheapest cost to **every** node at once, and the actual route to
each.

- **Type a weighted graph.** One link per line, with a cost:
  `home -- park : 4`. Pick a node to start **from**, and optionally a node to go
  **to**.
- **The headline number.** When you pick a target, the banner shows its cheapest
  cost and the route that realises it — e.g. *9, via `s → y → t → x`*. No target
  means "show me everything": the distance to every node, in the table below.
- **The whole shortest-path tree, drawn.** Every node is labelled with its
  distance from the source; the <span>blue</span> edges are the **shortest-path
  tree** (one parent per node — the last hop on its cheapest route), and the
  chosen target's path is picked out in <span>amber</span>.
- **Watch it settle.** *Watch it settle* animates the algorithm the way it
  actually runs: the source lights up at distance 0, then the **nearest
  unsettled node** is finalised next, and the next-nearest after that — the
  frontier (in <span>purple</span>) always one hop ahead of the settled region.
  Seeing the order *is* the intuition for why the algorithm is correct.
- **Directed or undirected**, with a toggle. A directed `a → b → c` can strand
  you — there may be no way back — while the same links undirected let you return.
- **Unreachable is a real answer.** A node on its own island reports distance ∞
  and no route, rather than a wrong number.
- **Six worked examples**, from the CLRS textbook graph to a triangle where the
  long way round is cheaper, a road map, an unreachable island, parallel roads,
  and a 3×3 grid.

## The idea it rests on

**Settle the nearest node, then relax its edges — repeat.** Keep a *tentative*
distance for every node (0 for the source, ∞ for the rest). Repeatedly take the
unsettled node with the smallest tentative distance, declare it **settled** (its
distance is now final), and **relax** each of its out-edges: if reaching a
neighbour *through* this node is cheaper than its current tentative distance,
lower it and remember this node as the neighbour's predecessor.

Why is a settled node's distance final? Because edge weights are **non-negative**,
no path discovered later can be shorter — any such path would have to leave the
settled region through some unsettled node that is already at least as far away.
That single fact is the whole proof, and it is also exactly why Dijkstra needs
non-negative weights: with a negative edge, a longer-looking route could still
turn out cheaper, and settling early would lock in a wrong answer. The page
detects a negative weight and says so.

**The priority queue.** "Take the nearest unsettled node" is a
`extract-min`, so the settled-node loop is driven by a **binary min-heap**. Rather
than implement decrease-key, the heap uses **lazy deletion**: when a node's
tentative distance drops we push a fresh entry, and a popped entry whose distance
is stale (no longer the best known) is simply skipped. That keeps the heap to
O(E) entries and every operation O(log E) — the standard, robust formulation —
for an overall O((V + E) log V).

**Reconstructing the path.** Each node remembers the predecessor that gave it its
cheapest distance. Following those pointers back from any target to the source,
then reversing, is its shortest path — and the union of all of them is the
shortest-path tree the page draws.

## The one design choice everything rests on — simple, cheapest-edge graph

The stored graph is **simple**: if two links run between the same ordered pair,
they collapse to the **cheaper** one — which is the only one a shortest path
would ever take — and the collapse is counted. A self-loop can never shorten a
path, so it is kept only as a count and left out of the adjacency. Neither choice
can change a single shortest distance, and both keep the picture honest: the
*Parallel roads* example gives `a → b` twice (costs 9 and 3), and the route uses
the 3.

## Everything is independently verified

Because "trust me, this is the shortest path" isn't good enough, every answer is
confirmed against methods that share no code with Dijkstra, and the page prints
"✓ Verified …" when they all agree:

| Claim | Fast algorithm | Independent check |
| --- | --- | --- |
| the distances | Dijkstra + binary heap | **Bellman–Ford** (relax every edge V−1 times) |
| the distances (small graphs) | Dijkstra | brute-force enumeration of every simple path |
| the labelling is **optimal** | — | the **relaxation invariant**: once done, *no* edge (u,v,w) has `dist[u] + w < dist[v]`. A labelling with no relaxable edge *is* a shortest-path labelling. |
| each reconstructed path | predecessor pointers | re-walked edge by edge, its cost re-summed to equal `dist[target]` |

## Tests

`tests.js` is a dependency-free suite (65 checks). Run it with Node:

```bash
node projects/phase2-graph/dijkstra/tests.js
```

It verifies:

1. **Parsing** — every separator and weight marker, decimals, the default
   weight of 1, comments, isolated nodes, a negative-weight flag, and the
   deliberate rule that a digit inside a *name* (`node2 -> node3`) is never
   mistaken for a weight.
2. **Building** — parallel links collapse to the cheaper weight, self-loops are
   counted but dropped from the adjacency, undirected edges mirror both ways.
3. **Dijkstra** on hand-worked shapes: a straight line, a triangle where the
   long way round wins, zero-weight edges, an unreachable target, and the
   directed-vs-undirected difference.
4. **The CLRS textbook graph** — the canonical example, pinned to its known
   distances (`s0 t8 x9 y5 z7`) and agreeing with Bellman–Ford, with no edge
   left relaxable.
5. **The oracles themselves** — path re-walking and the relaxation invariant.
6. **The heap** empties in sorted order, and the **layout** is deterministic
   (same seed ⇒ identical, in-bounds coordinates; degenerate sizes don't throw).
7. **A randomised fuzz loop** — 500 small weighted graphs, directed and
   undirected, where Dijkstra is checked against Bellman–Ford, against
   brute-force all-paths enumeration, against the no-relaxable-edge invariant,
   and where every reconstructed path is re-walked (thousands of checks in all).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The workbench: the links textarea, from/to pickers, the verdict banner, the SVG picture, and the distance table. |
| `style.css` | Dark theme, the two-column layout, the source / tree / path / frontier styling and weight labels. |
| `dijkstra-core.js` | Parsing, simple cheapest-edge building, the binary-heap Dijkstra, path reconstruction & tree, the Bellman–Ford / brute-force / relaxation-invariant / path-rewalk verifiers, and the force layout. UMD-ish: works under Node and as a browser global. |
| `script.js` | DOM controller — draws the weighted network (arrows, weight labels, in-node distance labels), paints the tree and chosen path, fills the table, and animates the algorithm settling nodes in order. |
| `tests.js` | The Node test suite described above. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
