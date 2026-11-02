#!/usr/bin/env node
'use strict';
/*
 * shape-node.js — a CLI over the same classes the browser demo and the tests use.
 * No build step, no dependencies. This is the "accept values from the user and
 * print the area and perimeter" part of the brief.
 *
 * Usage:
 *   node shape-node.js                       # the sample collection, listed
 *   node shape-node.js --json                # the sample collection as JSON
 *   node shape-node.js --totals              # total area / perimeter + exact split
 *   node shape-node.js circle 7              # one shape, computed and printed
 *   node shape-node.js triangle 13 14 15     # exact Heron area (84)
 *   node shape-node.js polygon 5 4           # a shape whose area is approximate
 *   node shape-node.js --repl                # interactive; also reads stdin
 *   echo "circle 7; square 6; totals" | node shape-node.js
 *
 * REPL / stdin commands (';'-separated also accepted on stdin):
 *   <shape> <args...>   compute one shape (see `help` for the catalog)
 *   add <shape> <args>  add a shape to the running collection
 *   list                list the collection
 *   totals              total area + perimeter of the collection, exact where possible
 *   sample              load the 9-shape sample collection
 *   clear               empty the collection
 *   json                the collection as JSON
 *   help                the shape catalog
 *   quit                exit
 */

const core = require('./shape-core');
const { ShapeError, SHAPE_REGISTRY, makeShape, ShapeCollection } = core;
const { sampleCollection } = require('./shape-fixtures');

function catalog() {
  return Object.entries(SHAPE_REGISTRY)
    .map(([name, { args }]) => `  ${name} ${args.map((a) => '<' + a + '>').join(' ')}`)
    .join('\n');
}

function shapeLine(s) {
  const a = s.area(), p = s.perimeter();
  const flag = s.isExact() ? '' : '   (≈ approximate)';
  return `${s.describe()}\n    area      = ${a.toString()}${a.exact ? `   (≈ ${a.toNumber().toFixed(4)})` : ''}\n    perimeter = ${p.toString()}${p.exact ? `   (≈ ${p.toNumber().toFixed(4)})` : ''}${flag}`;
}

function printCollection(col) {
  if (col.size === 0) { console.log('(collection is empty)'); return; }
  col.shapes.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${shapeLine(s)}`));
}

function printTotals(col) {
  const ta = col.totalArea(), tp = col.totalPerimeter();
  console.log(`shapes:          ${col.size}`);
  console.log(`total area:      ${ta.toString()}${ta.exact ? '' : '  (approximate — includes a non-closed-form shape)'}`);
  console.log(`total perimeter: ${tp.toString()}${tp.exact ? '' : '  (approximate — includes a non-closed-form shape)'}`);
  console.log(`exact figures:   ${col.exactOnes().length} of ${col.size}`);
  const approx = col.approximateOnes();
  if (approx.length) console.log(`approximated:    ${approx.map((s) => s.kind).join(', ')}`);
}

// Build one shape from a token list ["circle","7"] → prints or throws cleanly.
function computeOne(tokens) {
  const [name, ...args] = tokens;
  const shape = makeShape(name, args);
  console.log(shapeLine(shape));
  return shape;
}

// --- REPL -------------------------------------------------------------------

function runRepl(initial) {
  const col = initial || new ShapeCollection();
  const run = (line) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) return true;
    const tokens = raw.split(/\s+/);
    const cmd = tokens[0].toLowerCase();
    try {
      switch (cmd) {
        case 'help': console.log('Shapes:\n' + catalog() +
          '\nCommands: add <shape> <args>, list, totals, sample, clear, json, help, quit'); break;
        case 'list': printCollection(col); break;
        case 'totals': printTotals(col); break;
        case 'json': console.log(JSON.stringify(col.toJSON(), null, 2)); break;
        case 'clear': col.shapes.length = 0; console.log('cleared'); break;
        case 'sample':
          col.shapes.length = 0;
          for (const s of sampleCollection().shapes) col.add(s);
          console.log(`loaded ${col.size} sample shapes`); break;
        case 'add': {
          const s = makeShape(tokens[1], tokens.slice(2));
          col.add(s);
          console.log('added: ' + s.describe());
          break;
        }
        case 'quit': case 'exit': return false;
        default:
          if (SHAPE_REGISTRY[cmd]) computeOne(tokens);
          else console.log(`unknown command "${cmd}" — try "help"`);
      }
    } catch (e) {
      if (e instanceof ShapeError) console.log('error: ' + e.message);
      else throw e;
    }
    return true;
  };

  // Non-interactive stdin (piped) → run each ';'-separated command then exit.
  if (!process.stdin.isTTY) {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => {
      for (const part of buf.split(/[;\n]/)) if (!run(part)) break;
    });
    return;
  }

  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, prompt: 'shape> ' });
  console.log('Interactive shapes. Type "help" for the catalog, "quit" to exit.');
  rl.prompt();
  rl.on('line', (line) => { if (!run(line)) { rl.close(); return; } rl.prompt(); });
  rl.on('close', () => process.exit(0));
}

// --- main -------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);

  if (args.length === 0) {
    // Piped stdin with no args → REPL over stdin; otherwise show the sample.
    if (!process.stdin.isTTY) { runRepl(new ShapeCollection()); return; }
    printCollection(sampleCollection());
    console.log('\n(use --totals, --json, "<shape> <args>", or --repl)');
    return;
  }
  if (args[0] === '--repl') { runRepl(sampleCollection()); return; }
  if (args[0] === '--json') { console.log(JSON.stringify(sampleCollection().toJSON(), null, 2)); return; }
  if (args[0] === '--totals') { printTotals(sampleCollection()); return; }
  if (args[0] === '--help' || args[0] === '-h') {
    console.log('Shapes:\n' + catalog() + '\n\nFlags: --json, --totals, --repl');
    return;
  }

  // Otherwise treat the args as one shape spec: "<shape> <values...>".
  try {
    computeOne(args);
  } catch (e) {
    if (e instanceof ShapeError) { console.error('error: ' + e.message); process.exit(1); }
    throw e;
  }
}

if (require.main === module) main(process.argv);
module.exports = { main };
