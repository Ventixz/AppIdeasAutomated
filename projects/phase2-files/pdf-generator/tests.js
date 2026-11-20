/*
 * tests.js — exercises pdf-core.js with no browser.
 *
 * Two kinds of checks:
 *   1. An INDEPENDENT PDF reader (parsePdf, below) that shares no code with the
 *      writer: it walks startxref -> xref table -> objects -> page tree exactly
 *      as a real reader does, and verifies every cross-reference offset lands on
 *      the object it claims and every stream's /Length is byte-exact.
 *   2. A REAL-WORLD grader: if poppler's `pdfinfo` / `pdftotext` are installed
 *      (a completely separate PDF implementation), the generated files are run
 *      through them and the page count and extracted text are checked. These
 *      checks are skipped, not failed, when the tools are absent.
 *
 * Run:  node tests.js
 */
'use strict';
var PDF = require('./pdf-core.js');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var pass = 0, fail = 0, skip = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + a + ', want ' + b + ')'); }
function section(t) { console.log('\n' + t); }

/* ------------------------------------------------------------------ *
 * Independent PDF reader
 * ------------------------------------------------------------------ */
function parsePdf(bytes) {
  var bin = Buffer.from(bytes).toString('latin1'); // 1 byte == 1 char == 1 offset
  if (bin.slice(0, 7) !== '%PDF-1.') throw new Error('bad header');

  var sx = bin.lastIndexOf('startxref');
  if (sx < 0) throw new Error('no startxref');
  var xrefStart = parseInt(bin.slice(sx + 9).trim().split(/\s/)[0], 10);
  if (bin.slice(xrefStart, xrefStart + 4) !== 'xref') throw new Error('startxref does not point at xref');

  // Parse the single xref subsection.
  var rest = bin.slice(xrefStart + 4).replace(/^\s+/, '');
  var mHead = rest.match(/^(\d+)\s+(\d+)\s*\r?\n/);
  if (!mHead) throw new Error('bad xref subsection header');
  var first = parseInt(mHead[1], 10), count = parseInt(mHead[2], 10);
  var entriesStart = xrefStart + 4 + (rest.length - rest.slice(mHead[0].length).length) -
                     (rest.length - rest.length); // = position after header
  // Simpler: recompute entries region directly.
  var afterHeader = bin.indexOf(mHead[0], xrefStart) + mHead[0].length;
  var entries = {};
  var badOffsets = [];
  for (var i = 0; i < count; i++) {
    var line = bin.substr(afterHeader + i * 20, 20);
    var m = line.match(/^(\d{10}) (\d{5}) (n|f)/);
    if (!m) throw new Error('bad xref entry ' + i + ': ' + JSON.stringify(line));
    var objNum = first + i;
    entries[objNum] = { offset: parseInt(m[1], 10), type: m[3] };
    if (m[3] === 'n') {
      var at = bin.slice(entries[objNum].offset);
      if (!new RegExp('^' + objNum + ' 0 obj').test(at)) badOffsets.push(objNum);
    }
  }

  // Trailer
  var tIdx = bin.indexOf('trailer', xrefStart);
  var trailer = bin.slice(tIdx);
  var size = parseInt((trailer.match(/\/Size\s+(\d+)/) || [])[1], 10);
  var root = parseInt((trailer.match(/\/Root\s+(\d+)\s+0\s+R/) || [])[1], 10);
  var info = parseInt((trailer.match(/\/Info\s+(\d+)\s+0\s+R/) || [])[1], 10);

  function objBody(num) {
    var e = entries[num];
    if (!e || e.type !== 'n') return null;
    var start = bin.indexOf('obj', e.offset) + 3;
    var end = bin.indexOf('endobj', start);
    return { text: bin.slice(start, end), start: start, end: end };
  }

  // Stream /Length verification.
  var streamsOk = true, streamCount = 0;
  for (var num in entries) {
    if (entries[num].type !== 'n') continue;
    var body = objBody(+num).text;
    var lm = body.match(/\/Length\s+(\d+)/);
    var si = body.indexOf('stream');
    if (lm && si >= 0) {
      streamCount++;
      var declared = parseInt(lm[1], 10);
      // content starts right after 'stream' + EOL, ends right before '\nendstream'
      var contentStart = si + 'stream'.length;
      if (body[contentStart] === '\r') contentStart++;
      if (body[contentStart] === '\n') contentStart++;
      var es = body.indexOf('endstream', contentStart);
      var contentEnd = es;
      if (body[contentEnd - 1] === '\n') contentEnd--;
      if (body[contentEnd - 1] === '\r') contentEnd--;
      var actual = contentEnd - contentStart;
      if (actual !== declared) { streamsOk = false; }
    }
  }

  // Page tree
  var catalog = objBody(root).text;
  var pagesRef = parseInt((catalog.match(/\/Pages\s+(\d+)\s+0\s+R/) || [])[1], 10);
  var pagesObj = objBody(pagesRef).text;
  var pageCount = parseInt((pagesObj.match(/\/Count\s+(\d+)/) || [])[1], 10);
  var kids = (pagesObj.match(/\/Kids\s*\[([^\]]*)\]/) || [])[1] || '';
  var kidRefs = (kids.match(/\d+\s+0\s+R/g) || []).length;

  return {
    size: size, root: root, info: info, entryCount: count, xrefStart: xrefStart,
    badOffsets: badOffsets, streamsOk: streamsOk, streamCount: streamCount,
    pageCount: pageCount, kidRefs: kidRefs, objBody: objBody, bin: bin
  };
}

/* ------------------------------------------------------------------ *
 * 1. Metrics sanity — the embedded widths must be the real Adobe values
 * ------------------------------------------------------------------ */
section('Font metrics');
eq(PDF.codeWidth('Helvetica', 65, 1000), 667, 'Helvetica "A" advance');   // AFM: 667
eq(PDF.codeWidth('Helvetica', 32, 1000), 278, 'Helvetica space advance'); // AFM: 278
eq(PDF.codeWidth('Times-Roman', 65, 1000), 722, 'Times-Roman "A" advance');
eq(PDF.codeWidth('Times-Roman', 32, 1000), 250, 'Times-Roman space advance');
eq(PDF.codeWidth('Courier', 65, 1000), 600, 'Courier is monospaced (A)');
eq(PDF.codeWidth('Courier', 109, 1000), 600, 'Courier is monospaced (m)');
ok(PDF.codeWidth('Helvetica', 105, 1000) < PDF.codeWidth('Helvetica', 109, 1000),
   'Helvetica is proportional: i narrower than m');
ok(Math.abs(PDF.measure('iiiii', 'Courier', 12) - PDF.measure('WWWWW', 'Courier', 12)) < 1e-9,
   'Courier: five narrow == five wide chars');

/* ------------------------------------------------------------------ *
 * 2. Word wrap and preformatted wrap
 * ------------------------------------------------------------------ */
section('Text layout');
(function () {
  var maxW = PDF.codeWidth('Courier', 65, 12) * 10; // room for exactly 10 monospaced chars
  var lines = PDF.wrapWord('aaa bbb ccc ddd eee', 'Courier', 12, maxW);
  lines.forEach(function (l) {
    ok(PDF.measure(l, 'Courier', 12) <= maxW + 1e-6, 'wrapped line within width: "' + l + '"');
  });
  ok(lines.length >= 2, 'long paragraph wrapped onto multiple lines');

  // A single token wider than the line must be hard-split, never dropped.
  var long = 'x'.repeat(50);
  var hs = PDF.wrapWord(long, 'Courier', 12, maxW);
  eq(hs.join('').length, 50, 'hard-split preserves every character');
  hs.forEach(function (l) { ok(PDF.measure(l, 'Courier', 12) <= maxW + 1e-6, 'hard-split piece fits'); });

  // Preformatted mode keeps interior spaces.
  var pre = PDF.wrapPre('a    b', 'Courier', 12, 10000);
  eq(pre[0], 'a    b', 'preformatted mode preserves runs of spaces');

  // Tab expansion to 4-column stops.
  eq(PDF.expandTabs('a\tb', 4), 'a   b', 'tab expands to next 4-col stop (col 1 -> 4)');
  eq(PDF.expandTabs('\tx', 4), '    x', 'leading tab -> 4 spaces');
})();

/* ------------------------------------------------------------------ *
 * 3. HTML -> text
 * ------------------------------------------------------------------ */
section('HTML to text');
(function () {
  var t = PDF.htmlToText('<h1>Title</h1><p>Hello &amp; welcome &mdash; <b>bold</b>.</p><ul><li>one</li><li>two</li></ul>');
  ok(/Title/.test(t), 'keeps heading text');
  ok(/Hello & welcome — bold\./.test(t), 'decodes entities and strips inline tags');
  ok(/• one/.test(t) && /• two/.test(t), 'list items become bullets');
  ok(!/</.test(t) && !/>/.test(t), 'no angle brackets survive');
  eq(PDF.htmlToText('<script>var x=1<2;</script>keep'), 'keep', 'script contents removed');
})();

/* ------------------------------------------------------------------ *
 * 4. Structural round-trip via the independent reader
 * ------------------------------------------------------------------ */
section('PDF structure (independent reader)');
(function () {
  var pdf = PDF.buildPdf({
    title: 'Structure Test',
    text: 'Hello, world.\nThis is a from-scratch PDF.\n\nParentheses ( ) and a backslash \\ must be escaped.',
    font: 'Helvetica', fontSize: 12
  });
  ok(pdf instanceof Uint8Array, 'buildPdf returns bytes');
  var r = parsePdf(pdf);
  eq(r.badOffsets.length, 0, 'every xref offset points at its object');
  eq(r.size, r.entryCount, 'trailer /Size equals xref entry count');
  ok(r.root >= 1, 'trailer has a /Root');
  ok(r.streamsOk, 'every stream /Length is byte-exact');
  ok(r.streamCount >= 1, 'at least one content stream present');
  eq(r.pageCount, r.kidRefs, '/Count matches number of /Kids');
  // The last bytes must be the EOF marker.
  var tail = Buffer.from(pdf.slice(pdf.length - 6)).toString('latin1');
  eq(tail.trim(), '%%EOF', 'file ends with %%EOF');
  // Escaping: the content stream must contain escaped parens/backslash, not raw.
  var allObjs = r.bin;
  ok(allObjs.indexOf('\\(') >= 0 && allObjs.indexOf('\\)') >= 0, 'parentheses escaped in content');
  ok(allObjs.indexOf('\\\\') >= 0, 'backslash escaped in content');
})();

/* ------------------------------------------------------------------ *
 * 5. Pagination — lots of lines must span multiple pages
 * ------------------------------------------------------------------ */
section('Pagination');
(function () {
  var many = [];
  for (var i = 1; i <= 400; i++) many.push('Line number ' + i + ' of the long document.');
  var pdf = PDF.buildPdf({ text: many.join('\n'), font: 'Times-Roman', fontSize: 11, pageSize: 'a4' });
  var r = parsePdf(pdf);
  ok(r.pageCount > 1, 'a 400-line document spans multiple pages (got ' + r.pageCount + ')');
  eq(r.pageCount, r.kidRefs, 'page /Count matches /Kids after pagination');
  eq(r.badOffsets.length, 0, 'xref still exact with many objects');
  ok(r.streamsOk, 'all stream lengths exact across many pages');
})();

/* ------------------------------------------------------------------ *
 * 6. Multiple fonts (body + bold title) resolve to distinct resources
 * ------------------------------------------------------------------ */
section('Fonts and resources');
(function () {
  var pdf = PDF.buildPdf({ title: 'Bold Heading', text: 'Body in the base font.', font: 'Helvetica' });
  var r = parsePdf(pdf);
  ok(r.bin.indexOf('/BaseFont /Helvetica-Bold') >= 0, 'title pulls in the bold variant');
  ok(r.bin.indexOf('/BaseFont /Helvetica ') >= 0 || r.bin.indexOf('/BaseFont /Helvetica\n') >= 0 ||
     r.bin.indexOf('/BaseFont /Helvetica/') >= 0 || /\/BaseFont \/Helvetica[ >\n]/.test(r.bin),
     'body keeps the base font');
  eq(r.badOffsets.length, 0, 'two-font document still has exact xref');
})();

/* ------------------------------------------------------------------ *
 * 7. Real-world grader: poppler (pdfinfo / pdftotext)
 * ------------------------------------------------------------------ */
section('Real-world check (poppler)');
function have(tool) { try { cp.execSync('command -v ' + tool, { stdio: 'ignore' }); return true; } catch (e) { return false; } }
(function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfgen-'));
  var sentence = 'The quick brown fox jumps over the lazy dog.';
  var words = ['quickbrownfox', 'jumpsover', 'ZanzibarMarmalade', 'Watermelon'];
  var body = sentence + '\n' + words.join(' ') + '\n' + 'Page one content here.';
  // Make it long enough to force two pages.
  var filler = [];
  for (var i = 0; i < 120; i++) filler.push('Filler line ' + i + ' lorem ipsum dolor sit amet.');
  var pdf = PDF.buildPdf({ title: 'Poppler Grader', text: body + '\n' + filler.join('\n'), pageSize: 'letter' });
  var file = path.join(dir, 'out.pdf');
  fs.writeFileSync(file, Buffer.from(pdf));
  var r = parsePdf(pdf);

  if (have('pdfinfo')) {
    var info = cp.execSync('pdfinfo ' + JSON.stringify(file), { encoding: 'utf8' });
    var pm = info.match(/Pages:\s+(\d+)/);
    ok(pm && parseInt(pm[1], 10) === r.pageCount,
       'pdfinfo agrees on page count (' + (pm && pm[1]) + ' == ' + r.pageCount + ')');
  } else { skip++; console.log('  SKIP: pdfinfo not installed'); }

  if (have('pdftotext')) {
    var txt = cp.execSync('pdftotext ' + JSON.stringify(file) + ' -', { encoding: 'utf8' });
    var flat = txt.replace(/\s+/g, '');
    words.forEach(function (w) { ok(flat.indexOf(w) >= 0, 'pdftotext recovers token "' + w + '"'); });
    ok(txt.replace(/\s+/g, ' ').indexOf('The quick brown fox jumps over the lazy dog') >= 0,
       'pdftotext recovers the pangram in order');
  } else { skip++; console.log('  SKIP: pdftotext not installed'); }

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
})();

/* ------------------------------------------------------------------ *
 * 8. Edge cases
 * ------------------------------------------------------------------ */
section('Edge cases');
(function () {
  var empty = PDF.buildPdf({ text: '' });
  var r = parsePdf(empty);
  ok(r.pageCount >= 1, 'empty document still produces a page');
  eq(r.badOffsets.length, 0, 'empty document xref exact');

  var uni = PDF.buildPdf({ text: 'Smart “quotes”, em—dash, bullet •, euro €, café.' });
  var ru = parsePdf(uni);
  ok(ru.streamsOk, 'unicode/WinAnsi text keeps stream length exact');
  eq(ru.badOffsets.length, 0, 'unicode document xref exact');
})();

/* ------------------------------------------------------------------ */
console.log('\n----------------------------------------');
console.log(pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
if (fail > 0) process.exit(1);
