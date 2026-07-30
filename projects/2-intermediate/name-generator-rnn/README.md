# Name Generator (RNN)

A character-level **recurrent neural network** — a GRU cell trained with
backpropagation through time — that learns the letter patterns of real names and
then invents brand-new ones. It trains **live in your browser** every time you
open the page: no libraries, no server, no pre-baked weights. You can watch the
loss curve fall as it learns.

Source idea: [app-ideas / Name Generation using RNNs](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Name-Generator.md)

## Running

Open `index.html` in any modern browser — nothing to install:

```bash
open projects/2-intermediate/name-generator-rnn/index.html
```

The page trains for ~130 steps (about a second) the moment it loads, then it's
ready to generate.

## What it does

Both user stories from the spec:

- **Seed the first 2–3 letters** — type a prefix like `ma` or `el` into
  *Start with*, and every generated name begins there while the network fills in
  a plausible ending (user story 1).
- **See and use the generated names** — results appear as chips; **click one to
  copy** it to your clipboard (user story 2).

Plus a few extras that make the network legible:

- **Live loss chart** — the descending curve is the real training loss, so you
  can see the model actually learning rather than trust a claim.
- **Creativity slider** — this is the softmax *temperature*. Low keeps names safe
  and familiar; high makes them wild and weird.
- **Retrain** — reinitialise the weights with a new random seed and train again,
  so you get a genuinely different network.

## How it works

The interesting part is `rnn.js`, which is a **from-scratch GRU** in plain
JavaScript — no ML library involved:

- **The idea.** A name is a sequence of characters. The network is trained to
  predict the next character given all the previous ones, including a special
  "end of name" marker so it learns where names stop. That prediction is a
  probability distribution over the alphabet.
- **The cell.** A GRU with update and reset gates over a hidden state, followed
  by a softmax output layer. The forward pass, the full **backpropagation through
  time**, gradient clipping, and the **Adam** optimiser are all hand-written.
- **Generating.** Sampling picks the next letter from the learned distribution
  and feeds it back in, one character at a time, until the end marker. A prefix
  simply *seeds* the hidden state before sampling begins.

The model is kept deliberately small (a 24-unit hidden state) and trained only
briefly, which is what gives it room to *blend* names into new ones instead of
just memorising the training list. The training data lives in `corpus.js`.

Because the whole thing is real gradient descent, the network is unit-tested
under Node: `rnn.js` and `corpus.js` both export cleanly, and the test trains the
model and confirms the loss falls and that sampling produces new names.

## Files

| File | Role |
| --- | --- |
| `index.html` | Page structure |
| `style.css` | Styling |
| `rnn.js` | The GRU network — forward, BPTT, Adam, sampling (DOM-free) |
| `corpus.js` | ~260 names the network learns from |
| `script.js` | UI: chunked training with progress, controls, copy-to-clipboard |

---

*Part of an automated [Claude Code](https://claude.com/claude-code) routine that
builds one app-ideas project per day.*
