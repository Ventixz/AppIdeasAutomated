#!/usr/bin/env node
/*
 * gallery-node.js — a CLI over the same classes the browser demo and the tests
 * use. No build step, no dependencies.
 *
 * With no arguments it loads the sample gallery and prints it. You can also
 * drive it as a tiny REPL, or pipe ';'-separated commands on stdin.
 *
 * Usage:
 *   node gallery-node.js                     # sample gallery, listed
 *   node gallery-node.js --json              # the whole gallery as JSON
 *   node gallery-node.js --stats             # one-line stats
 *   node gallery-node.js --albums            # every album and its images
 *   node gallery-node.js --empty             # start empty, then REPL
 *   echo "convert img-logo jpeg; show img-logo" | node gallery-node.js
 *
 * REPL commands (also accepted on stdin, ';'-separated):
 *   list                             every image (title · format · effective dims)
 *   show <id>                        one image in full (JSON)
 *   tags                             tags in use
 *   bytag <tag>                      images carrying <tag>
 *   byformat <fmt>                   images of one format
 *   search <text>                    images whose title contains <text>
 *   sort <key>                       title|newest|oldest|largest|heaviest
 *   albums                           albums and their contents
 *   convert <id> <fmt>               convert an image, printing any capability loss
 *   transform <id> <op> [args]       crop W H | resize W H | scale N | rotate K | fliph | flipv
 *   stats                            gallery stats
 *   add <fmt> <title> <W> <H>        add a new image
 *   rm <id>                          remove an image
 *   help                             this list
 */
'use strict';

const core = require('./gallery-core');
const fixtures = require('./gallery-fixtures');
const { GalleryError } = core;

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function line(img) {
  const d = img.dimensions;
  const t = img.transforms.isEmpty() ? '' : `  (${img.transforms.describe().join(' → ')})`;
  const tags = img.tags.size ? `  #${[...img.tags].sort().join(' #')}` : '';
  return `  ${img.id.padEnd(14)} ${img.format.toUpperCase().padEnd(5)} ` +
    `${String(d.width + 'x' + d.height).padEnd(11)} ${fmtBytes(img.estimatedBytes()).padStart(8)}  ${img.title}${tags}${t}`;
}

function listAll(g) {
  if (g.size === 0) { console.log('(empty gallery)'); return; }
  console.log(`${g.name} — ${g.size} image(s)`);
  for (const img of g.sortedBy('title')) console.log(line(img));
}

function showAlbums(g) {
  if (g.albumNames().length === 0) { console.log('(no albums)'); return; }
  for (const name of g.albumNames()) {
    console.log(`${name}:`);
    for (const img of g.album(name)) console.log(line(img));
  }
}

function printConvert(g, id, fmt) {
  const img = g.get(id);
  if (!img) { console.log(`no image ${id}`); return; }
  const FormatClass = core.FORMATS[String(fmt).toLowerCase()];
  if (!FormatClass) { console.log(`unknown format ${fmt}`); return; }
  const { image, losses } = img.convertTo(FormatClass);
  console.log(`${img.describe()}  →  ${image.describe()}`);
  if (losses.length === 0) console.log('  lossless conversion — the target keeps everything this image uses');
  else for (const l of losses) console.log(`  ⚠ ${l}`);
}

function applyTransform(g, id, op, rest) {
  const img = g.get(id);
  if (!img) { console.log(`no image ${id}`); return; }
  const builders = {
    crop:   (p) => (t) => t.crop(Number(p[0]), Number(p[1])),
    resize: (p) => (t) => t.resize(Number(p[0]), Number(p[1])),
    scale:  (p) => (t) => t.scale(p[0]),
    rotate: (p) => (t) => t.rotate(Number(p[0])),
    fliph:  () => (t) => t.flipH(),
    flipv:  () => (t) => t.flipV(),
  };
  const b = builders[String(op).toLowerCase()];
  if (!b) { console.log(`unknown transform ${op}`); return; }
  const next = img.withTransform(b(rest));
  g.remove(img.id);
  g.add(next);
  console.log(line(next).trim());
}

function run(g, cmdLine) {
  const parts = cmdLine.trim().split(/\s+/);
  const cmd = (parts.shift() || '').toLowerCase();
  if (!cmd) return;
  try {
    switch (cmd) {
      case 'list': listAll(g); break;
      case 'show': {
        const img = g.get(parts[0]);
        console.log(img ? JSON.stringify(img.toJSON(), null, 2) : `no image ${parts[0]}`);
        break;
      }
      case 'tags': console.log(g.tags().join(', ') || '(none)'); break;
      case 'bytag': g.byTag(parts[0]).forEach((i) => console.log(line(i))); break;
      case 'byformat': g.byFormat(parts[0]).forEach((i) => console.log(line(i))); break;
      case 'search': g.search({ text: parts.join(' ') }).forEach((i) => console.log(line(i))); break;
      case 'sort': g.sortedBy(parts[0] || 'title').forEach((i) => console.log(line(i))); break;
      case 'albums': showAlbums(g); break;
      case 'convert': printConvert(g, parts[0], parts[1]); break;
      case 'transform': applyTransform(g, parts[0], parts[1], parts.slice(2)); break;
      case 'stats': console.log(JSON.stringify(g.stats(), null, 2)); break;
      case 'add': {
        const [fmt, ...rest] = parts;
        const h = Number(rest.pop()), w = Number(rest.pop());
        const title = rest.join(' ') || 'untitled';
        const img = core.makeImage(fmt, { title, width: w, height: h });
        g.add(img);
        console.log(`added ${img.id}: ${img.describe()}`);
        break;
      }
      case 'rm': console.log(g.remove(parts[0]) ? `removed ${parts[0]}` : `no image ${parts[0]}`); break;
      case 'help': printHelp(); break;
      default: console.log(`unknown command: ${cmd} (try 'help')`);
    }
  } catch (e) {
    if (e instanceof GalleryError) console.log(`error: ${e.message}`);
    else throw e;
  }
}

function printHelp() {
  console.log(`commands: list | show <id> | tags | bytag <t> | byformat <f> | search <text> |
  sort <title|newest|oldest|largest|heaviest> | albums | convert <id> <fmt> |
  transform <id> <crop|resize|scale|rotate|fliph|flipv> [args] | stats |
  add <fmt> <title> <W> <H> | rm <id> | help`);
}

function main() {
  const args = process.argv.slice(2);
  const g = args.includes('--empty') ? new core.Gallery('My Gallery') : fixtures.buildGallery(core);

  if (args.includes('--json')) { console.log(JSON.stringify(g.toJSON(), null, 2)); return; }
  if (args.includes('--stats')) { console.log(JSON.stringify(g.stats(), null, 2)); return; }
  if (args.includes('--albums')) { showAlbums(g); return; }

  // Piped stdin?
  if (!process.stdin.isTTY) {
    let buf = '';
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => {
      const cmds = buf.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
      if (cmds.length === 0) { listAll(g); return; }
      for (const c of cmds) { console.log(`> ${c}`); run(g, c); }
    });
    return;
  }

  if (args.includes('--empty')) {
    console.log("Empty gallery. Type 'help' for commands, Ctrl-D to exit.");
    repl(g);
    return;
  }

  listAll(g);
  console.log("\n(Try: node gallery-node.js --albums, or pipe commands, e.g.");
  console.log(" echo \"convert img-logo jpeg; transform img-sunset scale 1/2; list\" | node gallery-node.js)");
}

function repl(g) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  rl.on('line', (l) => { run(g, l); rl.prompt(); });
  rl.on('close', () => process.exit(0));
}

if (require.main === module) main();
