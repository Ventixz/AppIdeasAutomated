/*
 * pdf-core.js — a PDF writer built from the bytes up. No PDF library.
 *
 * Takes text (from a .txt file, pasted input, or stripped-down HTML) and emits
 * the raw bytes of a valid PDF 1.7 document: the object graph, the page tree,
 * positioned text content streams, the cross-reference table with exact byte
 * offsets, and the trailer. It uses only the 14 standard PDF fonts (built into
 * every reader, so nothing is embedded) and measures text with the real Adobe
 * AFM advance widths, so word-wrap, centering, right-alignment and justification
 * land where a reader will actually draw the glyphs.
 *
 * Runs unchanged in Node (module.exports) and the browser (window.PDFCore).
 * The companion tests.js exercises it with no browser, and — because poppler's
 * `pdfinfo`/`pdftotext` are a completely separate implementation — grades the
 * output by parsing it back with a tool that shares none of this code.
 */
(function (root) {
  'use strict';

  /* ----------------------------------------------------------------------- *
   * Font metrics — real Adobe AFM advance widths (1000-unit em), codes 32..255
   * in WinAnsiEncoding. Parsed from the published Core-14 AFM files. A width of
   * 0 marks a code with no glyph in that font.
   * ----------------------------------------------------------------------- */
  var METRICS_RAW = {
    'Helvetica': "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,0,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,0,0,333,333,350,556,1000,333,1000,500,333,944,0,500,667,0,333,556,556,556,556,260,556,333,737,370,556,584,0,737,333,400,584,0,0,333,556,537,278,333,0,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500",
    'Helvetica-Bold': "278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,0,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,0,0,500,500,350,556,1000,333,1000,556,333,944,0,500,667,0,333,556,556,556,556,280,556,333,737,370,556,584,0,737,333,400,584,0,0,333,611,556,278,333,0,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556",
    'Helvetica-Oblique': "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,0,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,0,0,333,333,350,556,1000,333,1000,500,333,944,0,500,667,0,333,556,556,556,556,260,556,333,737,370,556,584,0,737,333,400,584,0,0,333,556,537,278,333,0,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500",
    'Times-Roman': "250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,0,0,0,333,500,444,1000,500,500,333,1000,556,333,889,0,611,0,0,0,0,444,444,350,500,1000,333,980,389,333,722,0,444,722,0,333,500,500,500,500,200,500,333,760,276,500,564,0,760,333,400,564,0,0,333,500,453,250,333,0,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500",
    'Times-Bold': "250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,0,0,0,333,500,500,1000,500,500,333,1000,556,333,1000,0,667,0,0,0,0,500,500,350,500,1000,333,1000,389,333,722,0,444,722,0,333,500,500,500,500,220,500,333,747,300,500,570,0,747,333,400,570,0,0,333,556,540,250,333,0,330,500,750,750,750,500,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,500,556,500",
    'Times-Italic': "250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,541,0,0,0,333,500,556,889,500,500,333,1000,500,333,944,0,556,0,0,0,0,556,556,350,500,889,333,980,389,333,667,0,389,556,0,389,500,500,500,500,275,500,333,760,276,500,675,0,760,333,400,675,0,0,333,500,523,250,333,0,310,500,750,750,750,500,611,611,611,611,611,611,889,667,611,611,611,611,333,333,333,333,722,667,722,722,722,722,722,675,722,722,722,722,722,556,611,500,500,500,500,500,500,500,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,675,500,500,500,500,500,444,500,444",
    'Courier': "600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,0,0,0,600,600,600,600,600,600,600,600,600,600,600,0,600,0,0,0,0,600,600,600,600,600,600,600,600,600,600,0,600,600,0,600,600,600,600,600,600,600,600,600,600,600,600,0,600,600,600,600,0,0,600,600,600,600,600,0,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600"
  };

  var METRICS = {};
  Object.keys(METRICS_RAW).forEach(function (name) {
    METRICS[name] = METRICS_RAW[name].split(',').map(Number);
  });

  // Fonts we expose, and the bold variant used for titles.
  var FONTS = Object.keys(METRICS_RAW);
  var BOLD_OF = {
    'Helvetica': 'Helvetica-Bold',
    'Helvetica-Oblique': 'Helvetica-Bold',
    'Helvetica-Bold': 'Helvetica-Bold',
    'Times-Roman': 'Times-Bold',
    'Times-Italic': 'Times-Bold',
    'Times-Bold': 'Times-Bold',
    'Courier': 'Courier'
  };

  var PAGE_SIZES = {
    letter: [612, 792],
    legal: [612, 1008],
    a4: [595.28, 841.89],
    a5: [419.53, 595.28],
    tabloid: [792, 1224]
  };

  /* ----------------------------------------------------------------------- *
   * Unicode -> WinAnsiEncoding. 0x20..0x7E and 0xA0..0xFF pass straight
   * through (Latin-1); the 0x80..0x9F slots that WinAnsi fills with typography
   * are mapped from their Unicode code points so smart quotes, dashes, the
   * euro sign etc. survive.
   * ----------------------------------------------------------------------- */
  var UNI_TO_WIN = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F
  };

  // Map one JS string to an array of WinAnsi byte codes (0..255).
  function toWinAnsi(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp > 0xFFFF) i++; // surrogate pair consumed
      var code;
      if (cp >= 0x20 && cp <= 0x7E) code = cp;
      else if (cp >= 0xA0 && cp <= 0xFF) code = cp;
      else if (UNI_TO_WIN[cp] != null) code = UNI_TO_WIN[cp];
      else if (cp === 0x09) code = 0x20;       // tab handled before layout; guard anyway
      else code = 0x3F;                        // '?' for anything we can't encode
      out.push(code);
    }
    return out;
  }

  // Advance width (in text-space units) of one WinAnsi code at a given size.
  function codeWidth(fontName, code, size) {
    var table = METRICS[fontName] || METRICS['Helvetica'];
    var w = (code >= 32 && code <= 255) ? table[code - 32] : 0;
    if (!w) w = 500; // fallback for unmapped printable codes
    return w * size / 1000;
  }

  // Width of a whole string (already-arbitrary text) in a font at a size.
  function measure(str, fontName, size) {
    var codes = toWinAnsi(str), total = 0;
    for (var i = 0; i < codes.length; i++) total += codeWidth(fontName, codes[i], size);
    return total;
  }

  /* ----------------------------------------------------------------------- *
   * Text layout
   * ----------------------------------------------------------------------- */

  // Hard-split a single token that is itself wider than maxWidth.
  function splitLongToken(token, fontName, size, maxWidth) {
    var pieces = [], cur = '', curW = 0;
    for (var i = 0; i < token.length; i++) {
      var ch = token[i];
      var w = measure(ch, fontName, size);
      if (cur && curW + w > maxWidth) { pieces.push(cur); cur = ''; curW = 0; }
      cur += ch; curW += w;
    }
    if (cur) pieces.push(cur);
    return pieces;
  }

  // Greedy word-wrap of one paragraph (runs of whitespace collapse to a space).
  function wrapWord(paragraph, fontName, size, maxWidth) {
    var words = paragraph.split(/\s+/).filter(function (w) { return w.length; });
    if (!words.length) return [''];
    var lines = [], line = '', lineW = 0, spaceW = measure(' ', fontName, size);
    for (var i = 0; i < words.length; i++) {
      var word = words[i], wordW = measure(word, fontName, size);
      if (wordW > maxWidth) {
        // flush current line, then hard-split the oversized token
        if (line) { lines.push(line); line = ''; lineW = 0; }
        var parts = splitLongToken(word, fontName, size, maxWidth);
        for (var p = 0; p < parts.length - 1; p++) lines.push(parts[p]);
        line = parts[parts.length - 1];
        lineW = measure(line, fontName, size);
        continue;
      }
      var add = (line ? spaceW : 0) + wordW;
      if (line && lineW + add > maxWidth) { lines.push(line); line = word; lineW = wordW; }
      else { line = line ? line + ' ' + word : word; lineW += add; }
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  }

  // Preformatted wrap: keep every space, only break lines that overflow, at
  // character boundaries. Used for monospaced / code-style output.
  function wrapPre(logicalLine, fontName, size, maxWidth) {
    if (measure(logicalLine, fontName, size) <= maxWidth || logicalLine === '') return [logicalLine];
    return splitLongToken(logicalLine, fontName, size, maxWidth);
  }

  // Expand tabs to the next multiple of `tabSize` columns (preformatted mode).
  function expandTabs(line, tabSize) {
    if (line.indexOf('\t') < 0) return line;
    var out = '', col = 0;
    for (var i = 0; i < line.length; i++) {
      if (line[i] === '\t') {
        var n = tabSize - (col % tabSize);
        out += ' '.repeat(n); col += n;
      } else { out += line[i]; col++; }
    }
    return out;
  }

  /* ----------------------------------------------------------------------- *
   * PDF string escaping + a tiny byte writer that tracks offsets
   * ----------------------------------------------------------------------- */

  // Escape a WinAnsi code array into the bytes of a PDF literal string body
  // (without the surrounding parentheses).
  function escapeLiteral(codes) {
    var out = [];
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      if (c === 0x28 || c === 0x29 || c === 0x5C) { out.push(0x5C, c); }      // ( ) \
      else if (c === 0x0D) { out.push(0x5C, 0x72); }                          // \r
      else if (c === 0x0A) { out.push(0x5C, 0x6E); }                          // \n
      else if (c === 0x09) { out.push(0x5C, 0x74); }                          // \t
      else out.push(c);
    }
    return out;
  }

  function Writer() { this.chunks = []; this.len = 0; }
  Writer.prototype.ascii = function (s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    this.chunks.push(b); this.len += b.length; return this;
  };
  Writer.prototype.bytes = function (arr) {
    var b = arr instanceof Uint8Array ? arr : Uint8Array.from(arr);
    this.chunks.push(b); this.len += b.length; return this;
  };
  Writer.prototype.toUint8 = function () {
    var out = new Uint8Array(this.len), o = 0;
    for (var i = 0; i < this.chunks.length; i++) { out.set(this.chunks[i], o); o += this.chunks[i].length; }
    return out;
  };

  // 10-digit, zero-padded offset for the xref table.
  function pad10(n) { var s = String(n); return '0000000000'.slice(s.length) + s; }
  function pdfDate(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return 'D:' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ----------------------------------------------------------------------- *
   * buildPdf — the public entry point. Returns a Uint8Array of a PDF file.
   * ----------------------------------------------------------------------- */
  function buildPdf(opts) {
    opts = opts || {};
    var text = opts.text == null ? '' : String(opts.text);
    var fontName = METRICS[opts.font] ? opts.font : 'Helvetica';
    var size = opts.fontSize > 0 ? opts.fontSize : 12;
    var lineHeight = opts.lineHeight > 0 ? opts.lineHeight : 1.35;
    var leading = size * lineHeight;
    var sizeKey = (opts.pageSize || 'letter').toLowerCase();
    var dims = PAGE_SIZES[sizeKey] || PAGE_SIZES.letter;
    var pageW = dims[0], pageH = dims[1];
    var m = opts.margin > 0 ? opts.margin : 56; // ~0.78in default
    var align = ['left', 'right', 'center', 'justify'].indexOf(opts.align) >= 0 ? opts.align : 'left';
    var mode = opts.wrap === 'pre' ? 'pre' : 'word';
    var tabSize = opts.tabSize > 0 ? opts.tabSize : 4;
    var title = opts.title ? String(opts.title) : '';
    var date = opts.date instanceof Date ? opts.date : new Date();

    var contentW = pageW - 2 * m;
    var contentBottom = m;

    // ----- 1. Build positioned text ops, paginating as we go -----
    var pages = [];          // each: { ops: [ {font,size,x,y,codes,tw} ] }
    var fontsUsed = {};
    fontsUsed[fontName] = true;
    var cur = null, y = 0;

    function newPage() { cur = { ops: [] }; pages.push(cur); y = pageH - m - size; }
    function ensureRoom(advance) { if (!cur || y < contentBottom) newPage(); return; }

    function placeLine(lineText, lineFont, lineSize, lineAlign) {
      if (!cur || y - 0 < contentBottom) newPage();
      var codes = toWinAnsi(lineText);
      var lineW = 0, i;
      for (i = 0; i < codes.length; i++) lineW += codeWidth(lineFont, codes[i], lineSize);
      var x = m, tw = 0;
      if (lineAlign === 'right') x = m + (contentW - lineW);
      else if (lineAlign === 'center') x = m + (contentW - lineW) / 2;
      else if (lineAlign === 'justify') {
        var spaces = 0;
        for (i = 0; i < codes.length; i++) if (codes[i] === 0x20) spaces++;
        if (spaces > 0 && lineW < contentW) tw = (contentW - lineW) / spaces;
      }
      cur.ops.push({ font: lineFont, size: lineSize, x: x, y: y, codes: codes, tw: tw });
      fontsUsed[lineFont] = true;
    }

    newPage();

    // Title block (bold, larger), wrapped, never justified.
    if (title) {
      var tFont = BOLD_OF[fontName] || fontName;
      var tSize = size * 1.6;
      var tLeading = tSize * 1.25;
      var titleLines = wrapWord(title, tFont, tSize, contentW);
      for (var ti = 0; ti < titleLines.length; ti++) {
        if (y < contentBottom) newPage();
        placeLine(titleLines[ti], tFont, tSize, align === 'justify' ? 'left' : align);
        y -= tLeading;
      }
      y -= leading * 0.5; // gap under the title
    }

    // Body. Split the source into logical lines on CR/LF, preserving blank lines
    // (they become vertical gaps). Each logical line is wrapped per the mode.
    var logical = text.replace(/\r\n?/g, '\n').split('\n');
    for (var li = 0; li < logical.length; li++) {
      var raw = logical[li];
      if (raw === '') { // blank line = paragraph break
        if (y < contentBottom) newPage(); else y -= leading;
        continue;
      }
      var wrapped = mode === 'pre'
        ? wrapPre(expandTabs(raw, tabSize), fontName, size, contentW)
        : wrapWord(raw, fontName, size, contentW);
      for (var wi = 0; wi < wrapped.length; wi++) {
        if (y < contentBottom) newPage();
        // Justify every wrapped line except the final visual line of the paragraph.
        var isLastOfPara = (wi === wrapped.length - 1);
        var la = (align === 'justify' && !isLastOfPara) ? 'justify' : (align === 'justify' ? 'left' : align);
        placeLine(wrapped[wi], fontName, size, la);
        y -= leading;
      }
    }
    if (pages.length && pages[pages.length - 1].ops.length === 0 && pages.length > 1) pages.pop();

    // ----- 2. Assign object numbers -----
    var fontList = Object.keys(fontsUsed);
    var fontRef = {};                       // name -> "/Fn" and object number
    var objNum = 3;                         // 1=Catalog, 2=Pages
    fontList.forEach(function (name, idx) {
      fontRef[name] = { tag: '/F' + (idx + 1), num: objNum++ };
    });
    var pageObjs = [];
    for (var pi = 0; pi < pages.length; pi++) {
      pageObjs.push({ page: objNum++, content: objNum++ });
    }
    var infoNum = objNum++;
    var totalObjs = objNum - 1;

    // ----- 3. Build each content stream's bytes -----
    function contentBytes(page) {
      var w = new Writer();
      w.ascii('BT\n');
      var lastFont = null, lastSize = null, lastTw = null;
      for (var i = 0; i < page.ops.length; i++) {
        var op = page.ops[i];
        if (op.font !== lastFont || op.size !== lastSize) {
          w.ascii(fontRef[op.font].tag + ' ' + fmt(op.size) + ' Tf\n');
          lastFont = op.font; lastSize = op.size;
        }
        if (op.tw !== lastTw) { w.ascii(fmt(op.tw) + ' Tw\n'); lastTw = op.tw; }
        w.ascii('1 0 0 1 ' + fmt(op.x) + ' ' + fmt(op.y) + ' Tm\n');
        w.ascii('(').bytes(escapeLiteral(op.codes)).ascii(') Tj\n');
      }
      w.ascii('ET\n');
      return w.toUint8();
    }
    function fmt(n) {
      if (!isFinite(n)) n = 0;
      var s = n.toFixed(2);
      return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }

    // ----- 4. Serialize the whole file, recording xref offsets -----
    var out = new Writer();
    var offsets = new Array(totalObjs + 1).fill(0);

    out.ascii('%PDF-1.7\n');
    out.bytes([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]); // binary marker comment

    function beginObj(n) { offsets[n] = out.len; out.ascii(n + ' 0 obj\n'); }
    function endObj() { out.ascii('endobj\n'); }

    // 1: Catalog
    beginObj(1);
    out.ascii('<< /Type /Catalog /Pages 2 0 R >>\n');
    endObj();

    // 2: Pages tree
    beginObj(2);
    var kids = pageObjs.map(function (p) { return p.page + ' 0 R'; }).join(' ');
    out.ascii('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids + '] >>\n');
    endObj();

    // Font objects
    fontList.forEach(function (name) {
      var ref = fontRef[name];
      beginObj(ref.num);
      out.ascii('<< /Type /Font /Subtype /Type1 /BaseFont /' + name +
                ' /Encoding /WinAnsiEncoding >>\n');
      endObj();
    });

    // Page + content objects
    for (var pj = 0; pj < pages.length; pj++) {
      var ids = pageObjs[pj];
      var fontDict = fontList.map(function (name) {
        return fontRef[name].tag + ' ' + fontRef[name].num + ' 0 R';
      }).join(' ');
      beginObj(ids.page);
      out.ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(pageW) + ' ' + fmt(pageH) + ']' +
                ' /Resources << /Font << ' + fontDict + ' >> >>' +
                ' /Contents ' + ids.content + ' 0 R >>\n');
      endObj();

      var cbytes = contentBytes(pages[pj]);
      beginObj(ids.content);
      out.ascii('<< /Length ' + cbytes.length + ' >>\n');
      out.ascii('stream\n');
      out.bytes(cbytes);
      out.ascii('\nendstream\n');
      endObj();
    }

    // Info dictionary
    beginObj(infoNum);
    out.ascii('<< /Title (').bytes(escapeLiteral(toWinAnsi(title || 'Document'))).ascii(')');
    out.ascii(' /Producer (pdf-core.js \\(from-scratch PDF writer\\))');
    out.ascii(' /Creator (AppIdeasAutomated PDF Generator)');
    out.ascii(' /CreationDate (' + pdfDate(date) + ') >>\n');
    endObj();

    // ----- 5. xref table + trailer -----
    var xrefStart = out.len;
    out.ascii('xref\n');
    out.ascii('0 ' + (totalObjs + 1) + '\n');
    out.ascii('0000000000 65535 f \n');
    for (var n = 1; n <= totalObjs; n++) {
      out.ascii(pad10(offsets[n]) + ' 00000 n \n');
    }
    out.ascii('trailer\n');
    out.ascii('<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R /Info ' + infoNum + ' 0 R >>\n');
    out.ascii('startxref\n' + xrefStart + '\n');
    out.ascii('%%EOF\n');

    var bytes = out.toUint8();
    bytes._meta = { pages: pages.length, objects: totalObjs, fonts: fontList, xrefStart: xrefStart };
    return bytes;
  }

  /* ----------------------------------------------------------------------- *
   * HTML -> text. Minimal, dependency-free: strips tags, decodes a handful of
   * entities, turns block elements into line breaks. Enough to satisfy the
   * task's "html file or some other file" without pulling in a parser.
   * ----------------------------------------------------------------------- */
  function htmlToText(html) {
    var s = String(html);
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|ul|ol|table|blockquote|pre)>/gi, '\n');
    s = s.replace(/<li[^>]*>/gi, '• ');
    s = s.replace(/<[^>]+>/g, '');
    var ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
                mdash: '—', ndash: '–', hellip: '…', copy: '©',
                reg: '®', trade: '™', ldquo: '“', rdquo: '”',
                lsquo: '‘', rsquo: '’' };
    s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (full, body) {
      if (body[0] === '#') {
        var cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return isFinite(cp) ? String.fromCodePoint(cp) : full;
      }
      var k = body.toLowerCase();
      return ent[k] != null ? ent[k] : full;
    });
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }

  var API = {
    buildPdf: buildPdf,
    htmlToText: htmlToText,
    measure: measure,
    wrapWord: wrapWord,
    wrapPre: wrapPre,
    expandTabs: expandTabs,
    toWinAnsi: toWinAnsi,
    codeWidth: codeWidth,
    FONTS: FONTS,
    PAGE_SIZES: PAGE_SIZES,
    METRICS: METRICS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.PDFCore = API;
})(typeof window !== 'undefined' ? window : this);
