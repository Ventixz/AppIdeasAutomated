/*
 * tests.js — dependency-free checks for the whiteboard engine.
 *
 *   node tests.js
 *
 * The centre of gravity is the CONVERGENCE test: a set of operations delivered
 * to several replicas in shuffled, duplicated order must leave every replica
 * with a byte-identical document. That is the property a real collaborative
 * whiteboard lives or dies by, and it is checked here directly.
 */
'use strict';
const WB = require('./whiteboard-core.js');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}
function eq(name, a, b) {
  const pass = JSON.stringify(a) === JSON.stringify(b);
  if (!pass) console.log('    expected ' + JSON.stringify(b) + '\n    got      ' + JSON.stringify(a));
  ok(name, pass);
}
function approx(name, a, b, eps) { ok(name, Math.abs(a - b) <= (eps || 1e-9)); }

/* ------------------------------------------------------------------ */
console.log('\nGeometry & smoothing');

(function () {
  // point-to-segment distance
  approx('point on the segment has distance 0', WB.pointSegmentDistance(5, 0, 0, 0, 10, 0), 0);
  approx('perpendicular distance to a segment', WB.pointSegmentDistance(5, 3, 0, 0, 10, 0), 3);
  approx('beyond the end clamps to the endpoint', WB.pointSegmentDistance(13, 4, 0, 0, 10, 0), 5);
  // midpoint
  eq('midpoint is the average of two points', WB.midpoint({ x: 0, y: 0 }, { x: 4, y: 2 }), { x: 2, y: 1 });
})();

(function () {
  // Smoothing: a 4-point stroke must become quadratic curves, not line-tos.
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }];
  const smooth = WB.pathD(pts);
  const naive = WB.pathDNaive(pts);
  ok('smoothed path uses quadratic (Q) commands', smooth.indexOf('Q') !== -1);
  ok('smoothed path has no L segments between samples', smooth.indexOf(' L ') === -1);
  ok('naive path is all line (L) segments', naive.indexOf('Q') === -1 && naive.indexOf(' L ') !== -1);
  ok('smoothed and naive differ', smooth !== naive);

  // A midpoint must actually appear in the smoothed path (10,10)->(20,0) mid = 15,5
  ok('a sample midpoint appears as a curve endpoint', smooth.indexOf('15 5') !== -1);

  // Degenerate inputs
  eq('empty stroke -> empty path', WB.pathD([]), '');
  ok('single-point stroke draws a dot', WB.pathD([{ x: 3, y: 4 }]).indexOf('M 3 4') === 0);
  ok('two-point stroke is a straight line', WB.pathD([{ x: 0, y: 0 }, { x: 5, y: 5 }]).indexOf('L') !== -1);
})();

/* ------------------------------------------------------------------ */
console.log('\nReplica: local editing');

(function () {
  const a = WB.createReplica('A');
  a.addElement({ type: 'pen', color: '#f00', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  a.addElement({ type: 'rect', color: '#00f', width: 2, a: { x: 0, y: 0 }, b: { x: 10, y: 10 } });
  const doc = a.document();
  eq('two adds -> two elements', doc.length, 2);
  ok('element ids are stamped from the site', doc[0].id.indexOf('A@') === 0);
  ok('elements keep creation (lamport) order', doc[0].type === 'pen' && doc[1].type === 'rect');

  const rid = doc[1].id;
  a.deleteElement(rid);
  eq('delete tombstones the element', a.document().length, 1);
  ok('the remaining element is the pen stroke', a.document()[0].type === 'pen');

  a.clear();
  eq('clear empties the board', a.document().length, 0);

  // adding after a clear survives it
  a.addElement({ type: 'text', color: '#000', x: 5, y: 5, text: 'after clear', fontSize: 16 });
  eq('an element added after clear survives', a.document().length, 1);
})();

/* ------------------------------------------------------------------ */
console.log('\nReplica: convergence (the headline property)');

(function () {
  // Two replicas each make edits; every op is delivered to the other, but in a
  // DIFFERENT, shuffled, partly-duplicated order. They must converge.
  const a = WB.createReplica('A');
  const b = WB.createReplica('B');

  const ops = [];
  ops.push(a.addElement({ type: 'pen', color: '#111', width: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }));
  ops.push(b.addElement({ type: 'ellipse', color: '#2a2', width: 2, a: { x: 1, y: 1 }, b: { x: 9, y: 9 } }));
  ops.push(a.addElement({ type: 'line', color: '#c33', width: 4, a: { x: 0, y: 10 }, b: { x: 10, y: 0 } }));
  ops.push(b.addElement({ type: 'text', color: '#000', x: 2, y: 2, text: 'hi', fontSize: 14 }));
  const penId = ops[0].el.id;
  ops.push(b.deleteElement(penId));           // B erases A's stroke
  ops.push(a.addElement({ type: 'rect', color: '#06c', width: 1, a: { x: 3, y: 3 }, b: { x: 7, y: 7 } }));

  // Deliver each op to the replica that did NOT originate it, shuffled + dupes.
  function deliverShuffled(replica, seed) {
    const own = replica.site;
    const foreign = ops.filter(function (o) { return o.site !== own; });
    // deterministic shuffle by seed
    const arr = foreign.concat(foreign.slice(0, 2)); // duplicate the first two
    for (let i = arr.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    for (const o of arr) replica.receive(o);
  }
  deliverShuffled(a, 7);
  deliverShuffled(b, 999999);

  const sa = WB.serialize(a.document());
  const sb = WB.serialize(b.document());
  ok('replicas A and B converge to an identical document', sa === sb);
  ok("B's delete of A's stroke is respected on both", JSON.parse(sa).elements.every(function (e) { return e.id !== penId; }));
  eq('converged document has the expected element count', a.document().length, 4);

  // A third replica that loads everything as a snapshot also converges.
  const c = WB.createReplica('C');
  c.loadSnapshot(a.snapshot());
  ok('a fresh replica loading a snapshot converges too', WB.serialize(c.document()) === sa);
})();

(function () {
  // Idempotence: receiving the same op many times changes nothing.
  const a = WB.createReplica('A');
  const op = a.addElement({ type: 'pen', color: '#000', width: 2, points: [{ x: 0, y: 0 }] });
  const before = a.opCount;
  a.receive(op); a.receive(op); a.receive(op);
  eq('re-delivering an op is a no-op', a.opCount, before);
  eq('document is unchanged after duplicate delivery', a.document().length, 1);
})();

(function () {
  // Concurrent clears resolve deterministically by (lamport, site).
  const a = WB.createReplica('A');
  const b = WB.createReplica('B');
  const oa = a.addElement({ type: 'pen', color: '#000', width: 2, points: [{ x: 0, y: 0 }] });
  b.receive(oa);
  // both clear "concurrently" (same lamport is possible), then both add
  const ca = a.clear();
  const cb = b.clear();
  const la = a.addElement({ type: 'text', color: '#000', x: 0, y: 0, text: 'A', fontSize: 12 });
  const lb = b.addElement({ type: 'text', color: '#000', x: 1, y: 1, text: 'B', fontSize: 12 });
  // cross-deliver everything
  a.receive(cb); a.receive(lb);
  b.receive(ca); b.receive(la);
  ok('concurrent clears converge', WB.serialize(a.document()) === WB.serialize(b.document()));
  ok('both post-clear additions survive on both replicas', a.document().length === 2);
})();

/* ------------------------------------------------------------------ */
console.log('\nPersistence: save / load round-trip');

(function () {
  const a = WB.createReplica('A');
  a.addElement({ type: 'pen', color: '#f0a', width: 3, opacity: 0.5, points: [{ x: 0, y: 0 }, { x: 2, y: 3 }, { x: 5, y: 1 }] });
  a.addElement({ type: 'text', color: '#000', x: 10, y: 20, text: 'note with <angle> & "quote"', fontSize: 18 });
  const doc = a.document();
  const json = WB.serialize(doc, { title: 'board' });
  const back = WB.deserialize(json);
  eq('document survives a serialize/deserialize round-trip', back, doc);
  ok('serialized form declares its format', JSON.parse(json).format === WB.FORMAT);
  let threw = false;
  try { WB.deserialize('{"format":"nope"}'); } catch (e) { threw = true; }
  ok('deserialize rejects a foreign format', threw);
})();

/* ------------------------------------------------------------------ */
console.log('\nSVG export');

(function () {
  const a = WB.createReplica('A');
  a.addElement({ type: 'pen', color: '#111', width: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }] });
  a.addElement({ type: 'rect', color: '#06c', width: 1, fill: '#eef', a: { x: 5, y: 5 }, b: { x: 25, y: 15 } });
  a.addElement({ type: 'ellipse', color: '#2a2', width: 2, a: { x: 0, y: 0 }, b: { x: 8, y: 8 } });
  a.addElement({ type: 'line', color: '#c33', width: 3, a: { x: 0, y: 0 }, b: { x: 30, y: 30 } });
  a.addElement({ type: 'text', color: '#000', x: 2, y: 40, text: 'a & b < c', fontSize: 16 });
  const svg = WB.toSVG(a.document(), { width: 100, height: 100, background: '#fff' });
  ok('svg has a root element', svg.indexOf('<svg') === 0);
  ok('svg is closed', svg.trim().slice(-6) === '</svg>');
  ok('stroke path exported as <path> with Q curves', svg.indexOf('<path') !== -1 && svg.indexOf('Q') !== -1);
  ok('rect exported', svg.indexOf('<rect') !== -1);
  ok('ellipse exported', svg.indexOf('<ellipse') !== -1);
  ok('line exported', svg.indexOf('<line') !== -1);
  ok('text exported with XML-escaped content', svg.indexOf('a &amp; b &lt; c') !== -1);
  ok('background rect present', svg.indexOf('fill="#fff"') !== -1);
})();

/* ------------------------------------------------------------------ */
console.log('\nHit testing (eraser) & bounds');

(function () {
  const a = WB.createReplica('A');
  const pen = a.addElement({ type: 'pen', color: '#000', width: 4, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
  const rect = a.addElement({ type: 'rect', color: '#000', width: 2, a: { x: 200, y: 200 }, b: { x: 300, y: 300 } });
  const doc = a.document();

  let hits = WB.hitTest(doc, 50, 1, 5);
  ok('eraser near a stroke hits it', hits.indexOf(pen.el.id) !== -1);
  ok('eraser near a stroke does not hit a far rect', hits.indexOf(rect.el.id) === -1);

  hits = WB.hitTest(doc, 50, 60, 5);
  eq('eraser far from everything hits nothing', hits.length, 0);

  hits = WB.hitTest(doc, 250, 250, 5);
  ok('eraser inside a rect hits it', hits.indexOf(rect.el.id) !== -1);

  const b = WB.documentBounds(doc);
  ok('document bounds cover the stroke on the left', b.x <= 0);
  ok('document bounds cover the rect on the right', b.x + b.w >= 300);
  eq('bounds of an empty document is null', WB.documentBounds([]), null);
})();

/* ------------------------------------------------------------------ */
const total = passed + failed;
console.log('\n' + (failed === 0 ? '✓' : '✗') + ' ' + passed + '/' + total + ' checks passing\n');
process.exit(failed === 0 ? 0 : 1);
