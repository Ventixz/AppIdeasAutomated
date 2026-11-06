# Bulk Thumbnail Creator

> Source 2 (karan/Projects) · **Threading** · project 2 of 2
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Bulk Thumbnail Creator — Generate thumbnails
from a batch of images. Learn about threads and processes. Use the
multiprocessing library and the threading library to compare performance.
(threading)"*

Making one thumbnail is trivial: fit the image into a box, resample, save. The
task is to make *thousands*, and that is the Threading problem. The job is
embarrassingly parallel — every image is independent — which is exactly why the
obvious "parallel" version is a trap. This project is about the one data
structure that makes a batch of independent jobs behave: a **bounded worker
pool** fed by a shared queue.

## The bug the naive version has

The image-per-promise one-liner looks like the textbook parallel answer:

```js
const thumbs = await Promise.all(files.map(makeThumbnail));
```

It is concurrent, all right — *catastrophically* so. `.map` doesn't process the
files, it **starts every one of them before the first has finished**. Ten
thousand files means ten thousand decode buffers resident at the same instant,
ten thousand open file descriptors, and a scheduler oversubscribed by orders of
magnitude. Throughput doesn't climb with that fan-out, it **collapses** under
the memory pressure and context-switching, and on a real batch the process
usually dies on `EMFILE: too many open files` or runs out of heap long before
it finishes.

And `Promise.all` is **fail-fast**: the first image that fails to decode rejects
the whole batch and *discards every thumbnail that already succeeded*. One
corrupt file and nine-thousand-nine-hundred good results evaporate.

Capping it with a magic number (`files.slice(0, 50)`, loop, repeat) half-fixes
the resource blow-up but reintroduces a worse one: a **static partition** makes
each chunk wait for its slowest member. One 40-megapixel panorama in chunk three
and that whole chunk stalls while finished workers sit idle. Stragglers win.

## The design: a fixed crew pulling from one queue

```
            ┌─────────────── shared queue (just a cursor into the batch) ───────────────┐
 batch:     │  img0  img1  img2  img3  img4  img5  img6  img7 … imgN                     │
            └───┬─────────────┬─────────────┬─────────────┬──────────────────────────────┘
          pull  │        pull │        pull │        pull │     (each worker takes the
                ▼             ▼             ▼             ▼      next index, resizes it,
            worker0       worker1       worker2       worker3    then pulls again)
```

> A **fixed number of workers** (`concurrency`) each loop: take the next index
> from a shared cursor, resize that image, repeat until the queue is drained.
> In-flight work is capped at the worker count — *independent of the batch size* —
> and each job is isolated, so a failure is recorded and the batch rolls on.

Three properties fall out of that shape, and they are the whole lesson:

| property | why it holds | what it fixes |
| --- | --- | --- |
| **bounded resource use** | at most `concurrency` jobs are ever live | the fan-out OOM / `EMFILE` blow-up |
| **self-balancing load** | a worker that draws a slow job just pulls its next one later; fast workers naturally do more | the straggler stall of static partitioning |
| **failure isolation** | each job is wrapped in its own try/catch; a throw becomes a `{status:'rejected'}` record | `Promise.all`'s fail-fast that discards the whole batch |

`runPool(items, worker, {concurrency})` returns one settled record per item, in
**original order** (`{status:'fulfilled', value}` or `{status:'rejected',
reason}` — the shape of `Promise.allSettled`, plus which worker ran it), so the
caller can render results in place and report the failures without ever losing
the successes.

### The queue is a single integer — and that's the point

The only shared mutable state is a cursor: `const i = cursor++`. On JS's single
event loop that read-and-increment runs to completion without interleaving, so
no two workers ever draw the same index — the runtime hands us, for free, the
atomic "take next job" that a real multithreaded pool needs a lock or an atomic
fetch-add to guarantee. That is *why* the robust pattern is workers **pulling**
from a tiny shared counter rather than each mutating a shared result set: you
shrink the contended state down to one number instead of guarding the whole
output. (It's the same instinct as this category's other project, the download
progress bar: don't lock the big shared thing — restructure so the shared thing
is trivial.)

## The honest part: a pool is necessary but not sufficient for CPU speedup

karan's task says to compare the **threading** and **multiprocessing**
libraries, and the reason is the sharp edge every beginner hits here. Resizing
is **CPU-bound**. Python threads share one interpreter lock (the GIL) and
JavaScript has one execution thread, so pure in-process concurrency **overlaps
I/O but does not run two resizes at literally the same time**. Run the Node
benchmark and you can watch it:

```
pool │ time    │ throughput │ result
─────┼─────────┼────────────┼────────────────
   1 │   0.14s │   115.1/s  │ 16 ok, 2 failed
   2 │   0.12s │   137.9/s  │ 16 ok, 2 failed
   4 │   0.10s │   152.4/s  │ 16 ok, 2 failed
   8 │   0.10s │   158.4/s  │ 16 ok, 2 failed
```

Throughput rises a little — the gain is the file **reads and writes overlapping**
(those genuinely run on libuv's background threads) — then flattens, because the
resizes themselves still queue through one CPU thread. The lesson is the one the
task is steering you toward: **the pool bounds concurrency and isolates
failures, but true CPU parallelism needs real parallelism** — `worker_threads`
in Node, `multiprocessing` (separate processes, separate interpreters) in
Python. The pool is the right structure either way; swapping the execution
backend under it is a one-line change precisely because the queue/worker shape
doesn't care whether a "worker" is a coroutine, a thread or a process.

## The resampler is real

So the per-job work isn't a mock, `pool-core.js` includes an **area-averaging
box downscale**: each output pixel is the coverage-weighted average of the
source pixels its footprint covers. That's the correct way to shrink an image —
it uses every source pixel, so it doesn't alias and sparkle the way
nearest-neighbour does — and it's genuine CPU load, which is what makes the
threading discussion above concrete instead of hand-wavy. Three fit modes
(`contain` letterboxes, `cover` crops to fill, `stretch` ignores aspect) cover
what a real thumbnailer needs.

## Files

| file | what it is |
| --- | --- |
| `pool-core.js` | the whole engine — `runPool` (the bounded pool), `fitDimensions`, `resizeArea` (area-average resampler), `makeThumbnail`. No DOM, no fs, no timers. |
| `thumbnail-node.js` | real I/O: reads a directory of **PPM** images, thumbnails them through the pool, writes them out, and benchmarks throughput across pool sizes. Zero dependencies. |
| `index.html` + `script.js` + `style.css` | a browser demo that does **real canvas resizes** through the same pool, with live worker lanes, a bad-file injector, and a one-click comparison against unbounded `Promise.all` fan-out. |
| `tests.js` | dependency-free checks: the pool's concurrency cap, pull-balancing, failure isolation and ordering, plus the geometry and resampler math. |

## Run it

**The browser demo** — open `index.html`. Set a batch size and a pool size, hit
*Generate thumbnails*, and watch the worker lanes: in-flight work never exceeds
the pool size however large the batch. Tick *Inject bad files* to see failures
isolated (✗ cells) while the rest succeed, and press *Compare vs `Promise.all`
fan-out* to see the unbounded version light up every job at once.

**Real thumbnails + the throughput benchmark** (Node, no dependencies):

```bash
# synthesise a batch, then benchmark pool sizes 1..2×cores:
node thumbnail-node.js --demo --count=48 --size=160

# thumbnail a real directory of .ppm files (ImageMagick:
#   convert photo.jpg photo.ppm   makes input;
#   convert out.thumb.ppm out.png  views the result):
node thumbnail-node.js ./photos ./thumbs --size=160 --concurrency=4 --mode=cover
```

**The tests:**

```bash
node tests.js
#  ✓ all 17 checks passing
```

## What this demonstrates about threading

A batch of independent jobs is not "just call them all" — doing that
oversubscribes the machine and throws away partial work on the first error. The
durable pattern is a **fixed pool of workers pulling from a shared queue**: it
caps resource use regardless of batch size, balances load without planning,
and isolates failures. And it cleanly separates *how many things run at once*
(the pool) from *what a worker actually is* (coroutine, thread, or process) —
so when you discover your work is CPU-bound and needs real parallelism, you swap
the backend and keep the exact same structure.

---

*Part of a daily automated [Claude Code](https://claude.com/claude-code)
routine that builds one project per day. See the repository
[`README.md`](../../../README.md) and [`PROGRESS.md`](../../../PROGRESS.md).*
