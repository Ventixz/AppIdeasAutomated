# Graph from Links

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**first entry of its Graph category**, and the twenty-seventh Source 2 project
overall. It opens a new category after the
[Sieve of Eratosthenes](../../phase2-classic-algorithms/sieve-of-eratosthenes/)
finished Classic Algorithms.

> "Graph from links — create a program that will create a graph or network from
> a series of links."

Open `index.html` in a browser. **No build step, no server, no dependencies,
and no network** — one HTML page, a stylesheet, and two scripts.

## What it does

- **Turns a list of links into a network.** Type one connection per line —
  `home -> about`, `paris -- london`, `a, b`, or just a lone word for an isolated
  node — and the page parses it into a real graph and **draws it**, laid out by a
  from-scratch force-directed simulation.
- **Reads off the graph's shape.** Node and edge counts, density, average
  degree, the most-connected node, how many connected pieces it splits into,
  and — for directed graphs — whether it's a **DAG** (with a topological order)
  or contains a **cycle**.
- **Lights up reachability.** Pick a node (or click one) and every node
  reachable from it lights up, the rest dim — a breadth-first walk you can see.
- **Five worked examples** to load: a website's hyperlinks, a friendship
  network, a task-dependency DAG, three disconnected islands, and a pure cycle.

## Links in, a graph out

A "link" is just a line naming two connected things. The parser accepts the
separators people actually type, tried in priority order:

| You type | Reads as |
| --- | --- |
| `a -> b` or `a → b` | directed edge a → b |
| `a -- b` | edge a–b |
| `a - b` / `a-b` | edge a–b |
| `a, b` &nbsp; `a: b` &nbsp; `a b` | edge a–b |
| `island` | a lone node, no edges |
| `# …` | a comment (to end of line) |

Because a line is only ever split **once**, at the earliest separator, an
explicit arrow keeps hyphens inside the names it produces: `node-1 -> node-2`
splits at `->` into `node-1` and `node-2`, untouched. (The one trade-off: a bare
`a-b` reads as an *edge*, so a standalone hyphenated token like `big-city` on its
own line reads as the edge `big–city` — use an underscore, or an arrow, when you
mean a single node.)

## Two design choices the tests lean on

**The stored graph is a *simple* graph.** Parallel links (the same edge given
twice) collapse to one, and we *count* how many collapsed rather than silently
dropping them. Self-loops (`a -> a`) are kept — they're legal and they matter to
cycle detection — and also counted. Keeping the graph simple is exactly what
makes the **handshake lemma** hold on the nose:

> For an undirected graph, `sum of all degrees = 2 · |E|`, with a self-loop
> contributing 2 to its node. For a directed graph,
> `sum of out-degrees = sum of in-degrees = |E|`.

**The layout is deterministic.** Node positions come from a
[Fruchterman–Reingold](https://en.wikipedia.org/wiki/Force-directed_graph_drawing)
force simulation — nodes repel, edges pull, a cooling temperature caps each step
— seeded by a small PRNG. Same graph and same seed ⇒ identical coordinates,
which is what lets the tests assert the layout is *reproducible* instead of
hand-waving at "looks about right". The **Shuffle** button just advances the
seed.

## What it measures, and how

| Question | Algorithm |
| --- | --- |
| Which nodes are in the same piece? | **Union–find** (weak connectivity — every edge treated as undirected) |
| What's reachable from here? | **BFS** over out-neighbours (directed) or all neighbours (undirected) |
| Is there a cycle? | **DFS three-colouring** (directed) / **DFS with parent** (undirected); a self-loop is a cycle |
| A valid order for a DAG? | **Kahn's algorithm** (topological sort), which returns `null` exactly when a cycle exists |

Every one of these is verified against an *independent* brute-force oracle in the
test suite — a flood fill for components, a transitive closure for reachability,
a reaches-itself check for cycles, an all-edges-point-forward check for the topo
order.

## Tests

`tests.js` is a dependency-free suite (60 checks). Run it with Node:

```bash
node projects/phase2-graph/graph-from-links/tests.js
```

It verifies:

1. **Parsing** — every separator style, comments, blank lines, isolated nodes,
   and that an explicit arrow preserves hyphenated names while a bare `a-b`
   reads as an edge.
2. **Building** — parallel links collapse (and are counted), self-loops are kept
   and counted, undirected `a--b`/`b--a` are the same edge.
3. **The handshake lemma** holds for undirected graphs (self-loop = +2) and
   `sum(outDeg) = sum(inDeg) = |E|` for directed ones.
4. **Components** match an independent flood fill across many graphs, both
   directed and undirected.
5. **BFS reachability** equals the transitive closure, and BFS distances along a
   path are the hop counts.
6. **Cycle detection** matches a brute-force reaches-itself oracle; a
   **topological order** places every edge forward and is `null` exactly when
   the graph is cyclic.
7. **Stats** — density, average degree, isolated-node count, and the
   most-connected node on hand-worked graphs (a complete triangle, a star).
8. **The layout** is deterministic (same seed ⇒ identical coordinates), places
   every node with finite in-bounds coordinates, and degenerate sizes (empty,
   single node) don't throw.
9. **An end-to-end example** — a small hyperlink graph — with every derived fact
   (node/edge counts, two components, a cycle, an unreachable orphan) checked.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The workbench: the links textarea, the SVG picture, the stats read-out. |
| `style.css` | Dark theme, the two-column layout, the SVG node/edge styling. |
| `graph-core.js` | Parsing, graph building, all the measurements, and the force layout. UMD-ish: works under Node and as a browser global. |
| `script.js` | DOM controller — draws the SVG network and paints the stats. |
| `tests.js` | The Node test suite described above. |

---

*Built automatically by a scheduled [Claude Code](https://claude.com/claude-code)
routine — one project per day. See the [repository README](../../../README.md)
for how the routine works.*
