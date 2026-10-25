#!/usr/bin/env node
/*
 * inventory-node.js — a CLI front end over the same Product/Inventory classes
 * the browser demo uses. No build step, no dependencies.
 *
 * With no arguments it loads the sample catalogue and prints the stock report
 * plus the total inventory value — the task's headline number. You can also
 * drive it as a tiny REPL of inventory commands, or pipe commands in.
 *
 * Usage:
 *   node inventory-node.js                    # demo catalogue + report
 *   node inventory-node.js --json             # same, as JSON
 *   node inventory-node.js --empty            # start with no stock, then REPL
 *   echo "add Z-1 'Thing' 4.99 10; report" | node inventory-node.js --empty
 *
 * REPL commands (also accepted on stdin, ';'-separated):
 *   add <id> <name> <price> <qty>   receive <id> <n>   ship <id> <n>
 *   remove <id>                     report             value
 *   low [threshold]                 json               help / quit
 *
 * Names with spaces go in single or double quotes: add Z-1 "Thing Name" 4.99 10
 */
'use strict';

const readline = require('readline');
const { InventoryError, Money, Product, Inventory } = require('./inventory-core');
const { CATALOGUE } = require('./inventory-fixtures');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const startEmpty = args.includes('--empty');

const inv = new Inventory();
if (!startEmpty) for (const spec of CATALOGUE) inv.add(spec);

/* ---- rendering ---------------------------------------------------- */

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function report() {
  const rows = inv.byValue();
  if (!rows.length) return '(inventory is empty)';
  const lines = [];
  lines.push(
    pad('ID', 8) + pad('NAME', 24) + padL('PRICE', 11) + padL('QTY', 6) + padL('LINE VALUE', 14)
  );
  lines.push('-'.repeat(63));
  for (const p of rows) {
    const flag = p.quantity === 0 ? ' ✗' : p.quantity <= 5 ? ' ·' : '';
    lines.push(
      pad(p.id, 8) +
      pad(p.name.length > 23 ? p.name.slice(0, 22) + '…' : p.name, 24) +
      padL(Money.format(p.priceCents), 11) +
      padL(p.quantity + flag, 6) +
      padL(Money.format(p.lineValue()), 14)
    );
  }
  lines.push('-'.repeat(63));
  const s = inv.summary();
  lines.push(
    pad(`${s.skuCount} SKUs`, 8) + pad('', 24) + padL('', 11) +
    padL(s.totalUnits, 6) + padL(Money.format(s.totalValueCents), 14)
  );
  const low = inv.lowStock();
  if (low.length) {
    lines.push('');
    lines.push(`Low stock (≤5): ${low.map((p) => `${p.id} (${p.quantity})`).join(', ')}`);
  }
  return lines.join('\n');
}

function showAll() {
  if (asJson) { console.log(JSON.stringify(inv.toJSON(), null, 2)); return; }
  console.log(report());
}

/* ---- command handling (shared by one-shot and REPL) --------------- */

// Split a line into tokens, honouring single/double quotes for names.
function tokenize(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function runCommand(line) {
  const [cmd, ...rest] = tokenize(line.trim());
  if (!cmd) return;
  switch (cmd.toLowerCase()) {
    case 'add': {
      const [id, name, price, qty] = rest;
      inv.add(new Product({ id, name, price, quantity: Number(qty || 0) }));
      console.log(`added ${id}`);
      break;
    }
    case 'receive': inv.receive(rest[0], Number(rest[1])); console.log(`${rest[0]} now ${inv.get(rest[0]).quantity}`); break;
    case 'ship':    inv.ship(rest[0], Number(rest[1]));    console.log(`${rest[0]} now ${inv.get(rest[0]).quantity}`); break;
    case 'remove':  inv.remove(rest[0]); console.log(`removed ${rest[0]}`); break;
    case 'report':  console.log(report()); break;
    case 'value':   console.log(`Total inventory value: ${Money.format(inv.totalValueCents())}`); break;
    case 'low':     {
      const t = rest[0] ? Number(rest[0]) : 5;
      const low = inv.lowStock(t);
      console.log(low.length ? low.map((p) => `${p.id} ${p.name} — ${p.quantity}`).join('\n') : `nothing at or below ${t}`);
      break;
    }
    case 'json':    console.log(JSON.stringify(inv.toJSON(), null, 2)); break;
    case 'help':    console.log('add receive ship remove report value low json quit'); break;
    case 'quit': case 'exit': return 'quit';
    default: console.log(`unknown command: ${cmd} (try "help")`);
  }
}

function safe(line) {
  try { return runCommand(line); }
  catch (e) {
    if (e instanceof InventoryError) console.error(`error: ${e.message}`);
    else throw e;
  }
}

/* ---- entry point -------------------------------------------------- */

const positional = args.filter((a) => !a.startsWith('--'));

if (positional.length) {
  // Treat the rest of the line as ';'-separated commands.
  for (const c of positional.join(' ').split(';')) if (c.trim()) safe(c);
} else if (process.stdin.isTTY) {
  // Interactive: show the demo report, then take commands.
  showAll();
  console.log('\nType commands ("help" for the list, "quit" to exit).');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'inv> ' });
  rl.prompt();
  rl.on('line', (line) => { if (safe(line) === 'quit') rl.close(); else rl.prompt(); });
  rl.on('close', () => process.exit(0));
} else {
  // Piped stdin: run the commands, or just print the report if none.
  let buf = '';
  process.stdin.on('data', (d) => (buf += d));
  process.stdin.on('end', () => {
    const cmds = buf.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!cmds.length) showAll();
    else for (const c of cmds) safe(c);
  });
}
