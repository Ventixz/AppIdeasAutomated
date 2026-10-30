#!/usr/bin/env node
/*
 * recipe-node.js — a CLI over the same Recipe classes and RecipeBook manager the
 * browser demo uses. No build step, no dependencies.
 *
 * With no arguments it loads the sample cookbook and prints it grouped by
 * category. You can also drive it as a tiny REPL, or pipe ';'-separated commands.
 *
 * Usage:
 *   node recipe-node.js                          # sample cookbook, by category
 *   node recipe-node.js --by-ingredient          # grouped by main ingredient
 *   node recipe-node.js --json                   # the whole cookbook as JSON
 *   node recipe-node.js --make                   # what the sample pantry can make
 *   node recipe-node.js --empty                  # start empty, then REPL
 *   echo "show pancakes; scale pancakes 8; make" | node recipe-node.js
 *
 * REPL commands (also accepted on stdin, ';'-separated):
 *   list                                 every recipe (title · category · servings)
 *   categories                           recipes grouped by category
 *   mains                                recipes grouped by main ingredient
 *   show <id|title>                      one recipe in full
 *   scale <id|title> <servings>          print the recipe scaled to N servings
 *   find <ingredient> [ingredient...]    recipes using ALL these ingredients
 *   search <text>                        recipes whose title contains <text>
 *   make                                 what the sample pantry can make (and why not)
 *   help                                 this list
 */
'use strict';

const core = require('./recipe-core');
const { RecipeError } = core;
const fixtures = require('./recipe-fixtures');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

const book = flag('--empty') ? new core.RecipeBook('My Cookbook') : fixtures.buildCookbook(core);
const pantry = fixtures.buildPantry(core);

/* ---- rendering ----------------------------------------------------- */

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function renderList(recipes) {
  if (!recipes.length) return '(no recipes)';
  const rows = recipes.map((r) => [r.id, r.title, r.category, `serves ${r.servings}`, `main: ${r.mainIngredient}`]);
  const head = ['ID', 'Title', 'Category', 'Servings', 'Main'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => '  ' + r.map((c, i) => pad(c, widths[i])).join('  ');
  return [line(head), '  ' + widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

function renderGroups(groups) {
  const out = [];
  for (const [label, recipes] of groups) {
    out.push(`\n${label}`);
    out.push('  ' + '-'.repeat(label.length));
    for (const r of recipes) out.push(`  • ${r.title} (serves ${r.servings})`);
  }
  return out.join('\n').trimStart();
}

function renderRecipe(r) {
  const lines = [`${r.title}  —  ${r.category}, serves ${r.servings} (main: ${r.mainIngredient})`, ''];
  lines.push('Ingredients:');
  for (const ing of r.ingredients) lines.push(`  - ${ing.toString()}`);
  if (r.instructions.length) {
    lines.push('', 'Instructions:');
    r.instructions.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
  }
  return lines.join('\n');
}

function renderMake() {
  const results = book.whatCanIMake(pantry);
  const out = ['With what the sample pantry holds:', ''];
  for (const res of results) {
    if (res.ok) { out.push(`  ✓ ${res.recipe.title}`); continue; }
    const why = res.blockers.map((b) => {
      if (b.reason === 'missing') return `no ${b.item}`;
      if (b.reason === 'short') return `only ${b.have} ${b.item} (need ${b.need})`;
      if (b.reason === 'incomparable') return `${b.item}: can't compare units`;
      return b.item;
    }).join(', ');
    out.push(`  ✗ ${res.recipe.title} — ${why}`);
  }
  return out.join('\n');
}

/* ---- command interpreter ------------------------------------------- */

function resolve(ref) {
  if (book.has(ref)) return book.get(ref);
  const hit = book.all().find((r) => r.title.toLowerCase() === String(ref).toLowerCase());
  if (hit) return hit;
  // allow a title fragment if unambiguous
  const frag = book.all().filter((r) => r.title.toLowerCase().includes(String(ref).toLowerCase()));
  if (frag.length === 1) return frag[0];
  throw new RecipeError(`no recipe matching "${ref}"`);
}

function run(line) {
  const parts = line.trim().split(/\s+/);
  const cmd = (parts.shift() || '').toLowerCase();
  if (!cmd) return '';
  switch (cmd) {
    case 'list': return renderList(book.all().sort((a, b) => a.title.localeCompare(b.title)));
    case 'categories': return renderGroups(book.groupByCategory());
    case 'mains': return renderGroups(book.groupByMainIngredient());
    case 'show': return renderRecipe(resolve(parts.join(' ')));
    case 'scale': {
      const n = Number(parts.pop());
      return renderRecipe(resolve(parts.join(' ')).scaleToServings(n));
    }
    case 'find': {
      const found = book.search({ ingredients: parts });
      return found.length ? renderList(found) : `(nothing uses all of: ${parts.join(', ')})`;
    }
    case 'search': {
      const found = book.search({ text: parts.join(' ') });
      return found.length ? renderList(found) : '(no match)';
    }
    case 'make': return renderMake();
    case 'help': return HELP;
    default: return `unknown command: ${cmd} (try "help")`;
  }
}

const HELP = [
  'commands:',
  '  list                              every recipe',
  '  categories                        grouped by category',
  '  mains                             grouped by main ingredient',
  '  show <id|title>                   one recipe in full',
  '  scale <id|title> <servings>       the recipe scaled to N servings',
  '  find <ingredient> [ingredient…]   recipes using ALL these ingredients',
  '  search <text>                     recipes whose title contains <text>',
  '  make                              what the sample pantry can make',
  '  help                              this list',
].join('\n');

/* ---- entry points --------------------------------------------------- */

function once(output) { console.log(output); }

if (flag('--json')) { once(JSON.stringify(book.toJSON(), null, 2)); process.exit(0); }
if (flag('--by-ingredient')) { once(renderGroups(book.groupByMainIngredient())); process.exit(0); }
if (flag('--make')) { once(renderMake()); process.exit(0); }

function printDefault() {
  console.log(`${book.name} — ${book.size} recipe(s)\n`);
  console.log(renderGroups(book.groupByCategory()));
  console.log('\n(Pipe commands in, e.g.  echo "show lemonade; scale lemonade 16; make" | node recipe-node.js\n also try --by-ingredient, --make, --json. Command list: pipe in "help".)');
}

if (process.stdin.isTTY) {
  // No piped input — just show the cookbook.
  printDefault();
} else {
  // Read whatever was piped in; run it as ';'-separated commands. If nothing
  // was piped, fall back to the default view so a bare run still prints.
  const stdin = [];
  process.stdin.on('data', (d) => stdin.push(d));
  process.stdin.on('end', () => {
    const script = Buffer.concat(stdin).toString('utf8').split(';').map((s) => s.trim()).filter(Boolean);
    if (!script.length) { printDefault(); return; }
    for (const line of script) {
      try { const out = run(line); if (out) console.log(out + '\n'); }
      catch (e) { console.log((e instanceof RecipeError ? 'error: ' : 'ERROR: ') + e.message + '\n'); }
    }
  });
}
