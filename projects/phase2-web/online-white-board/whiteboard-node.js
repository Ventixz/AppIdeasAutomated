#!/usr/bin/env node
/*
 * whiteboard-node.js — a headless CLI over the same engine, so the vector model
 * is useful without a browser. It can:
 *
 *   - build a sample board and SAVE it as a .wbd document and/or export SVG,
 *   - replay a saved .wbd document to SVG (the "save them" the task asks for,
 *     end to end, with no DOM),
 *   - run a two-replica convergence demo and print the result.
 *
 * Zero dependencies.
 *
 *   node whiteboard-node.js --demo                 # build a sample, print SVG
 *   node whiteboard-node.js --demo --out ./board   # write board.wbd + board.svg
 *   node whiteboard-node.js --to-svg board.wbd     # convert a saved doc to SVG
 *   node whiteboard-node.js --converge             # show replicas converging
 */
'use strict';
const WB = require('./whiteboard-core.js');
const fs = require('fs');

const args = process.argv.slice(2);
function flag(name) { return args.indexOf(name) !== -1; }
function val(name) { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; }

function sampleBoard() {
  const r = WB.createReplica('demo');
  // a smooth freehand wave
  const wave = [];
  for (let i = 0; i <= 40; i++) wave.push({ x: 40 + i * 12, y: 120 + Math.sin(i / 3) * 40 });
  r.addElement({ type: 'pen', color: '#1f6feb', width: 4, points: wave });
  r.addElement({ type: 'rect', color: '#2ea043', width: 3, fill: '#eafbee', a: { x: 80, y: 220 }, b: { x: 260, y: 320 } });
  r.addElement({ type: 'ellipse', color: '#f85149', width: 3, a: { x: 300, y: 220 }, b: { x: 460, y: 330 } });
  r.addElement({ type: 'line', color: '#a371f7', width: 5, a: { x: 80, y: 360 }, b: { x: 460, y: 360 } });
  r.addElement({ type: 'text', color: '#111111', x: 90, y: 60, text: 'Ideas for the project', fontSize: 28 });
  r.addElement({ type: 'text', color: '#8b949e', x: 90, y: 410, text: 'drawn, saved and exported with no browser', fontSize: 16 });
  return r;
}

function main() {
  if (flag('--converge')) {
    const a = WB.createReplica('A'), b = WB.createReplica('B');
    const ops = [];
    ops.push(a.addElement({ type: 'pen', color: '#111', width: 2, points: [{ x: 0, y: 0 }, { x: 9, y: 9 }] }));
    ops.push(b.addElement({ type: 'rect', color: '#06c', width: 2, a: { x: 1, y: 1 }, b: { x: 8, y: 8 } }));
    ops.push(a.addElement({ type: 'line', color: '#c33', width: 3, a: { x: 0, y: 9 }, b: { x: 9, y: 0 } }));
    ops.push(b.deleteElement(ops[0].el.id));   // B erases A's stroke
    // deliver foreign ops to each side in opposite order
    ops.filter(o => o.site === 'B').reverse().forEach(o => a.receive(o));
    ops.filter(o => o.site === 'A').reverse().forEach(o => b.receive(o));
    const sa = WB.serialize(a.document()), sb = WB.serialize(b.document());
    console.log('replica A: ' + a.document().length + ' elements');
    console.log('replica B: ' + b.document().length + ' elements');
    console.log('identical documents after shuffled delivery: ' + (sa === sb ? 'YES ✓' : 'NO ✗'));
    process.exit(sa === sb ? 0 : 1);
  }

  const toSvg = val('--to-svg');
  if (toSvg) {
    const els = WB.deserialize(fs.readFileSync(toSvg, 'utf8'));
    const svg = WB.toSVG(els, { background: '#ffffff' });
    const out = val('--out');
    if (out) { fs.writeFileSync(out + '.svg', svg); console.log('wrote ' + out + '.svg'); }
    else console.log(svg);
    return;
  }

  if (flag('--demo') || args.length === 0) {
    const r = sampleBoard();
    const doc = r.document();
    const out = val('--out');
    const svg = WB.toSVG(doc, { width: 560, height: 440, background: '#ffffff' });
    if (out) {
      fs.writeFileSync(out + '.wbd', WB.serialize(doc, { app: 'online-white-board' }));
      fs.writeFileSync(out + '.svg', svg);
      console.log('wrote ' + out + '.wbd (' + doc.length + ' elements) and ' + out + '.svg');
    } else {
      console.log('# sample board — ' + doc.length + ' vector elements');
      console.log('# re-run with --out ./board to save board.wbd and board.svg\n');
      console.log(svg);
    }
    return;
  }

  console.log('usage: node whiteboard-node.js [--demo] [--out PREFIX] [--to-svg FILE.wbd] [--converge]');
}

main();
