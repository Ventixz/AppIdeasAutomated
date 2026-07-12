# Calculator CLI

A tiny arithmetic **command-line** calculator — `add`, `sub`, `mul`, `div`,
`pow`, and `sqrt` — with integer-by-default numbers, an opt-in float flag, and
`even`/`odd` operand filters.

Source idea: [app-ideas / Calculator CLI](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/Calculator-CLI.md)

## Two front-ends, one engine

Because a "CLI" wants a terminal, this project ships both:

| File | What it is |
| --- | --- |
| `calc.js` | The real CLI — run it with `node calc.js …` |
| `calc-core.js` | The shared engine: arithmetic + argument parsing |
| `index.html` + `script.js` + `style.css` | A browser terminal that runs the **same** `calc-core.js` |

Both front-ends call the identical `calc-core.js`, so they can never disagree
about what `add even 1 2 3 4` returns.

## Using the CLI

```
calc <operation> [even|odd] [-f] <numbers...>
```

```bash
node calc.js add 2 3 5          # -> 10
node calc.js add even 1 2 3 4   # -> 6      (keeps 2 and 4)
node calc.js add odd 1 2 3 4    # -> 4      (keeps 1 and 3)
node calc.js add -f 1.5 2.5     # -> 4      (floats need -f)
node calc.js sub 10 3 2         # -> 5
node calc.js mul 2 3 4          # -> 24
node calc.js div 100 5 2        # -> 10
node calc.js pow 2 10           # -> 1024
node calc.js sqrt 144           # -> 12
node calc.js --help             # top-level help
node calc.js div --help         # help for one sub-command
```

Open `index.html` to try the same commands in the browser (type `help` there
for the built-in cheatsheet; `↑`/`↓` walk your history).

## Features (mapped to the spec)

- **`add` multiple numbers** — the core user story: `add` sums any count of
  operands.
- **`-f` / `--float` flag** — numbers are integers by default (mirroring the
  spec's note about statically-typed languages); `-f` opts into floating-point
  operands. Passing a float without it fails with a clear message.
- **`even` / `odd` sub-commands** — filter operands to only even or only odd
  numbers before the operation runs.
- **`--help` / `-h`** — top-level help, *and* per-sub-command help
  (`calc add -h`).

### Bonus features (from the spec)

- **All four basic operations** — `add`, `sub`, `mul`, `div` (with a
  divide-by-zero guard).
- **Exponentiation & square root** — `pow` and `sqrt`.
- **Help flags that describe sub-commands** — every operation has its own
  usage line.

## Behaviour notes

- **Exit codes** — success prints to stdout and exits `0`; a bad command prints
  `calc: <reason>` to stderr and exits `1`. That makes it scriptable:
  `node calc.js div 5 0 || echo "caught the error"`.
- **Clean numbers** — results are trimmed of floating-point fuzz, so
  `add -f 0.1 0.2` prints `0.3`, not `0.30000000000000004`.
- **Zero dependencies** — pure Node built-ins; nothing to `npm install`.

## Running

```bash
node calc.js --help          # the CLI
open index.html              # the browser terminal
```
