#!/usr/bin/env node
'use strict';
/*
 * family-node.js — a CLI over the same classes the browser demo and the tests
 * use. No build step, no dependencies. This is the "query the family tree" part
 * of the brief, at a terminal.
 *
 * Usage:
 *   node family-node.js                      # the family: everyone, by generation
 *   node family-node.js --people             # everyone with lifespans
 *   node family-node.js --tree               # an indented tree from the roots
 *   node family-node.js --json               # the whole tree as JSON
 *   node family-node.js who Emma             # one person and their close kin
 *   node family-node.js rel Susan Daniel     # how Susan is related to Daniel
 *   node family-node.js --repl               # interactive; also reads stdin
 *   echo "rel Emma Oliver; who George" | node family-node.js
 *
 * REPL / stdin commands (';'-separated also accepted on stdin):
 *   people               list everyone with their lifespans
 *   tree                 an indented family tree from the roots
 *   who <name>           a person's parents, children, siblings, cousins, …
 *   rel <A> <B>          how A is related to B (and B to A)
 *   ancestors <name>     everyone above, by generation
 *   descendants <name>   everyone below, by generation
 *   json                 the whole tree as JSON
 *   help                 this list
 *   quit                 exit
 */

const core = require('./family-core');
const { FamilyError } = core;
const { sampleTree } = require('./family-fixtures');

function resolve(ctx, name) {
  const matches = ctx.tree.findAll(name);
  if (matches.length === 0) return null;
  return matches[0];
}

function names(list) { return list.length ? list.map((x) => x.name).join(', ') : '—'; }

function printPeople(ctx) {
  console.log(`${ctx.tree.name} — ${ctx.tree.size} people:`);
  for (const person of ctx.tree.people) {
    const alive = person.isAlive ? ' (living)' : '';
    console.log(`  ${person.describe()}${alive}`);
  }
}

// An indented tree from each root, following children; a person reached through
// two parents is shown under the first and marked "↑" under the rest.
function printTree(ctx) {
  const shown = new Set();
  const walk = (person, depth) => {
    const indent = '  '.repeat(depth);
    if (shown.has(person)) { console.log(`${indent}${person.name} ↑`); return; }
    shown.add(person);
    console.log(`${indent}${person.describe()}`);
    for (const child of ctx.tree.childrenOf(person)) walk(child, depth + 1);
  };
  for (const root of ctx.tree.roots()) walk(root, 0);
}

function printWho(ctx, name) {
  const person = resolve(ctx, name);
  if (!person) { console.log(`no one named "${name}"`); return; }
  const t = ctx.tree;
  console.log(`${person.describe()}${person.isAlive ? ' — living' : ''}`);
  if (person.age() !== undefined) console.log(`  age: ${person.age()}`);
  console.log(`  parents:      ${names(t.parentsOf(person))}`);
  console.log(`  children:     ${names(t.childrenOf(person))}`);
  console.log(`  siblings:     ${names(t.siblingsOf(person))}`);
  console.log(`  grandparents: ${names(t.grandparentsOf(person))}`);
  console.log(`  aunts/uncles: ${names(t.auntsUnclesOf(person))}`);
  console.log(`  cousins:      ${names(t.cousinsOf(person))}`);
}

function printRel(ctx, aName, bName) {
  const a = resolve(ctx, aName);
  const b = resolve(ctx, bName);
  if (!a) { console.log(`no one named "${aName}"`); return; }
  if (!b) { console.log(`no one named "${bName}"`); return; }
  console.log(ctx.tree.relationship(a, b) + '.');
  if (a !== b) console.log(ctx.tree.relationship(b, a) + '.');
  const k = ctx.tree.kinship(a, b);
  if (k.via && k.via.length) console.log(`  (via common ancestor: ${names(k.via)})`);
}

function printGenerations(ctx, name, dir) {
  const person = resolve(ctx, name);
  if (!person) { console.log(`no one named "${name}"`); return; }
  const map = dir === 'up' ? ctx.tree.ancestorsOf(person) : ctx.tree.descendantsOf(person);
  if (map.size === 0) { console.log(`${person.name} has no recorded ${dir === 'up' ? 'ancestors' : 'descendants'}`); return; }
  const byGen = new Map();
  for (const [who, d] of map) { if (!byGen.has(d)) byGen.set(d, []); byGen.get(d).push(who.name); }
  console.log(`${dir === 'up' ? 'Ancestors' : 'Descendants'} of ${person.name}:`);
  for (const d of [...byGen.keys()].sort((x, y) => x - y)) {
    console.log(`  ${d} generation${d > 1 ? 's' : ''} ${dir === 'up' ? 'up' : 'down'}: ${byGen.get(d).join(', ')}`);
  }
}

function freshContext() { return sampleTree(); }

// --- REPL -------------------------------------------------------------------

function runRepl(ctx) {
  const run = (line) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) return true;
    const tokens = raw.split(/\s+/);
    const cmd = tokens[0].toLowerCase();
    try {
      switch (cmd) {
        case 'help':
          console.log('Commands: people, tree, who <name>, rel <A> <B>, ancestors <name>, descendants <name>, json, help, quit');
          break;
        case 'people': printPeople(ctx); break;
        case 'tree': printTree(ctx); break;
        case 'json': console.log(JSON.stringify(ctx.tree.toJSON(), null, 2)); break;
        case 'who':
          if (tokens.length < 2) { console.log('usage: who <name>'); break; }
          printWho(ctx, tokens.slice(1).join(' ')); break;
        case 'rel':
          if (tokens.length < 3) { console.log('usage: rel <A> <B>'); break; }
          printRel(ctx, tokens[1], tokens[2]); break;
        case 'ancestors':
          if (tokens.length < 2) { console.log('usage: ancestors <name>'); break; }
          printGenerations(ctx, tokens.slice(1).join(' '), 'up'); break;
        case 'descendants':
          if (tokens.length < 2) { console.log('usage: descendants <name>'); break; }
          printGenerations(ctx, tokens.slice(1).join(' '), 'down'); break;
        case 'quit': case 'exit': return false;
        default: console.log(`unknown command "${cmd}" — try "help"`);
      }
    } catch (e) {
      if (e instanceof FamilyError) console.log('error: ' + e.message);
      else throw e;
    }
    return true;
  };

  if (!process.stdin.isTTY) {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => { for (const part of buf.split(/[;\n]/)) if (!run(part)) break; });
    return;
  }

  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, prompt: 'family> ' });
  console.log(`${ctx.tree.name} — interactive. Type "help" for commands, "quit" to exit.`);
  rl.prompt();
  rl.on('line', (line) => { if (!run(line)) { rl.close(); return; } rl.prompt(); });
  rl.on('close', () => process.exit(0));
}

// --- main -------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const ctx = freshContext();

  if (args.length === 0) {
    if (!process.stdin.isTTY) { runRepl(ctx); return; }
    printTree(ctx);
    console.log('\n(use --people, --tree, --json, `who <name>`, `rel <A> <B>`, or --repl)');
    return;
  }
  switch (args[0]) {
    case '--repl': runRepl(ctx); return;
    case '--people': printPeople(ctx); return;
    case '--tree': printTree(ctx); return;
    case '--json': console.log(JSON.stringify(ctx.tree.toJSON(), null, 2)); return;
    case '--help': case '-h':
      console.log('Flags: --people, --tree, --json, --repl\nQuery: who <name> | rel <A> <B> | ancestors <name> | descendants <name>');
      return;
    case 'who':
      if (args.length < 2) { console.error('usage: who <name>'); process.exit(1); }
      printWho(ctx, args.slice(1).join(' ')); return;
    case 'rel':
      if (args.length < 3) { console.error('usage: rel <A> <B>'); process.exit(1); }
      printRel(ctx, args[1], args[2]); return;
    case 'ancestors':
      if (args.length < 2) { console.error('usage: ancestors <name>'); process.exit(1); }
      printGenerations(ctx, args.slice(1).join(' '), 'up'); return;
    case 'descendants':
      if (args.length < 2) { console.error('usage: descendants <name>'); process.exit(1); }
      printGenerations(ctx, args.slice(1).join(' '), 'down'); return;
    default:
      console.error(`unknown argument "${args[0]}" — try --help`);
      process.exit(1);
  }
}

if (require.main === module) main(process.argv);
module.exports = { main, resolve };
