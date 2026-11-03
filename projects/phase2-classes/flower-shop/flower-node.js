#!/usr/bin/env node
'use strict';
/*
 * flower-node.js — a CLI over the same classes the browser demo and the tests
 * use. No build step, no dependencies. This is the "order flowers to go" part of
 * the brief, at a terminal.
 *
 * Usage:
 *   node flower-node.js                     # the shop: catalogue + stock
 *   node flower-node.js --menu              # flowers and bouquets with prices
 *   node flower-node.js --stock             # inventory, low-stock flagged
 *   node flower-node.js --json              # the shop as JSON
 *   node flower-node.js order "Spring Mix"  # buy one, print the receipt
 *   node flower-node.js order Rose 10       # buy 10 red-rose stems
 *   node flower-node.js --repl              # interactive; also reads stdin
 *   echo "cart Spring Mix; cart Rose 6; checkout" | node flower-node.js
 *
 * REPL / stdin commands (';'-separated also accepted on stdin):
 *   menu                 list flowers and bouquets with prices
 *   stock                show inventory, flagging low stock
 *   cart <name> [qty]    add a flower or bouquet to the cart
 *   cart                 show the current cart and its running total
 *   checkout             buy the cart as one atomic order → a receipt
 *   order <name> [qty]   shortcut: buy one item straight away
 *   register             how much money is in the till
 *   reset                reload the sample shop and empty the cart
 *   json                 the shop as JSON
 *   help                 this list
 *   quit                 exit
 */

const core = require('./flower-core');
const { ShopError, OutOfStockError, Cart } = core;
const { sampleShop } = require('./flower-fixtures');

// Resolve a name typed by the user to a flower or bouquet object.
function findSaleable(ctx, name) {
  const want = name.trim().toLowerCase();
  const all = [...Object.values(ctx.bouquets), ...Object.values(ctx.flowers)];
  // Exact name (or "color name") match first, then a loose contains-match.
  return (
    all.find((s) => s.name.toLowerCase() === want) ||
    all.find((s) => s.describe().toLowerCase().split(' — ')[0] === want) ||
    all.find((s) => s.name.toLowerCase().includes(want)) ||
    null
  );
}

function printMenu(ctx) {
  console.log('Flowers (per stem):');
  for (const f of Object.values(ctx.flowers)) console.log(`  ${f.describe()}`);
  console.log('\nBouquets:');
  for (const b of Object.values(ctx.bouquets)) {
    console.log(`  ${b.describe()}  [${b.stemCount()} stems]`);
  }
}

function printStock(ctx) {
  const low = new Set(ctx.shop.lowStock().map((l) => l.flower.key));
  console.log(`${ctx.shop.name} — inventory:`);
  for (const f of ctx.shop.flowers) {
    const n = ctx.shop.stockOf(f);
    const flag = low.has(f.key) ? '   ⚠ low — reorder' : '';
    console.log(`  ${String(n).padStart(3)} × ${f.color} ${f.name}${flag}`);
  }
  console.log(`register: ${ctx.shop.register}`);
}

function doCheckout(ctx) {
  if (ctx.cart.isEmpty()) { console.log('cart is empty'); return; }
  try {
    const receipt = ctx.shop.checkout(ctx.cart);
    console.log(receipt.toString());
    console.log(`  register now: ${ctx.shop.register}`);
    ctx.cart = new Cart();
  } catch (e) {
    if (e instanceof OutOfStockError) console.log('order refused — ' + e.message + '\n(nothing was charged, nothing left the shelves)');
    else throw e;
  }
}

function freshContext() {
  const ctx = sampleShop();
  ctx.cart = new Cart();
  return ctx;
}

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
          console.log('Commands: menu, stock, cart [<name> [qty]], checkout, order <name> [qty], register, reset, json, help, quit');
          break;
        case 'menu': printMenu(ctx); break;
        case 'stock': printStock(ctx); break;
        case 'register': console.log(`register: ${ctx.shop.register}`); break;
        case 'json': console.log(JSON.stringify(ctx.shop.toJSON(), null, 2)); break;
        case 'reset': { const n = freshContext(); Object.assign(ctx, n); console.log('sample shop reloaded'); break; }
        case 'checkout': doCheckout(ctx); break;
        case 'cart': {
          if (tokens.length === 1) {
            if (ctx.cart.isEmpty()) { console.log('cart is empty'); break; }
            ctx.cart.lines.forEach((l) => console.log(`  ${l.qty}× ${l.item.name}  ${l.item.price().times(l.qty)}`));
            console.log(`  total: ${ctx.cart.total()}`);
            break;
          }
          const { name, qty } = parseItemArgs(tokens.slice(1));
          const item = findSaleable(ctx, name);
          if (!item) { console.log(`no flower or bouquet matching "${name}"`); break; }
          ctx.cart.add(item, qty);
          console.log(`added ${qty}× ${item.name} — cart total ${ctx.cart.total()}`);
          break;
        }
        case 'order': {
          const { name, qty } = parseItemArgs(tokens.slice(1));
          const item = findSaleable(ctx, name);
          if (!item) { console.log(`no flower or bouquet matching "${name}"`); break; }
          try {
            const receipt = ctx.shop.order(item, qty);
            console.log(receipt.toString());
            console.log(`  register now: ${ctx.shop.register}`);
          } catch (e) {
            if (e instanceof OutOfStockError) console.log('order refused — ' + e.message);
            else throw e;
          }
          break;
        }
        case 'quit': case 'exit': return false;
        default: console.log(`unknown command "${cmd}" — try "help"`);
      }
    } catch (e) {
      if (e instanceof ShopError) console.log('error: ' + e.message);
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

  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, prompt: 'shop> ' });
  console.log('Petal & Stem — interactive. Type "help" for commands, "quit" to exit.');
  rl.prompt();
  rl.on('line', (line) => { if (!run(line)) { rl.close(); return; } rl.prompt(); });
  rl.on('close', () => process.exit(0));
}

// Parse ["Spring", "Mix", "2"] → { name: "Spring Mix", qty: 2 }. A trailing
// integer is the quantity; everything before it is the (possibly multi-word) name.
function parseItemArgs(tokens) {
  if (tokens.length === 0) throw new ShopError('need an item name');
  let qty = 1;
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && /^\d+$/.test(last)) { qty = Number(last); tokens = tokens.slice(0, -1); }
  return { name: tokens.join(' '), qty };
}

// --- main -------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const ctx = freshContext();

  if (args.length === 0) {
    if (!process.stdin.isTTY) { runRepl(ctx); return; }
    printMenu(ctx);
    console.log('');
    printStock(ctx);
    console.log('\n(use --menu, --stock, --json, `order <name> [qty]`, or --repl)');
    return;
  }
  switch (args[0]) {
    case '--repl': runRepl(ctx); return;
    case '--menu': printMenu(ctx); return;
    case '--stock': printStock(ctx); return;
    case '--json': console.log(JSON.stringify(ctx.shop.toJSON(), null, 2)); return;
    case '--help': case '-h':
      console.log('Flags: --menu, --stock, --json, --repl\nOrder: order <name> [qty]');
      return;
    case 'order': {
      try {
        const { name, qty } = parseItemArgs(args.slice(1));
        const item = findSaleable(ctx, name);
        if (!item) { console.error(`no flower or bouquet matching "${name}"`); process.exit(1); }
        const receipt = ctx.shop.order(item, qty);
        console.log(receipt.toString());
        console.log(`  register now: ${ctx.shop.register}`);
      } catch (e) {
        if (e instanceof ShopError) { console.error('error: ' + e.message); process.exit(1); }
        throw e;
      }
      return;
    }
    default:
      console.error(`unknown argument "${args[0]}" — try --help`);
      process.exit(1);
  }
}

if (require.main === module) main(process.argv);
module.exports = { main, findSaleable, parseItemArgs };
